#!/usr/bin/env python3
"""Shapley Phase 2.2: FastAPI backend.

Endpoints:
  POST /api/analyze        - Start analysis job (async)
  GET  /api/analyze/{id}   - Poll job status/results
  POST /api/payout         - Execute PayPal batch payout (human-confirmed)
  GET  /api/payout/{id}    - Check payout status
  GET  /api/demo           - Frozen demo data (deterministic)
  GET  /api/health         - Health check
"""
import os
import sys
import time
import uuid
import threading
import logging
import urllib.parse
from contextlib import asynccontextmanager

# Structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("shapley")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# In-memory job store (fine for hackathon; use Redis in production)
_jobs = {}
_jobs_lock = threading.Lock()

# GitHub OAuth sessions: session_id -> {access_token, username, expires_at}
_oauth_sessions = {}
_oauth_lock = threading.Lock()

JOB_TIMEOUT_SEC = 600  # 10 minutes max per analysis job
JOB_TTL_SEC = 3600     # Keep completed jobs for 1 hour
OAUTH_TTL_SEC = 3600   # OAuth sessions last 1 hour


def _cleanup_jobs():
    """Remove expired jobs. Called periodically."""
    now = time.time()
    with _jobs_lock:
        expired = [jid for jid, j in _jobs.items()
                   if now - j.get("created_at", now) > JOB_TTL_SEC]
        for jid in expired:
            del _jobs[jid]
    return len(expired)


def _check_job_timeout(job_id):
    """Check if a job has exceeded its timeout. Returns True if timed out."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return False
        elapsed = time.time() - job.get("created_at", time.time())
        if elapsed > JOB_TIMEOUT_SEC and job.get("status") not in ("complete", "failed"):
            job["status"] = "failed"
            job["error"] = (f"Analysis timed out after {JOB_TIMEOUT_SEC}s. "
                            "Try a smaller repo or fewer commits.")
            return True
    return False


# ── Models ──────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    repo_url: str = Field(..., description="GitHub repo URL or owner/repo")
    total_amount: float = Field(100.0, gt=0, description="Total payout in USD")
    max_commits: int = Field(30, ge=5, le=50)
    demo: bool = Field(False, description="Use frozen demo data")


class PayoutShare(BaseModel):
    email: str
    amount: float = Field(..., gt=0)
    note: str = ""


class PayoutRequest(BaseModel):
    shares: list[PayoutShare]
    total_amount: float = Field(..., gt=0)
    idempotency_key: str | None = None


# ── Background analysis ─────────────────────────────────────────

def _compute_share_cis(result, n_runs=200, noise=5.0):
    """Monte Carlo confidence intervals for payout shares.

    Perturbs each coalition score by uniform noise in [-noise, +noise],
    recomputes Shapley shares, and returns 95% CI per contributor.
    Pure math, no API calls.
    """
    import math
    import random

    evaluations = result.get("evaluations", [])
    n = len(result.get("contributor_names", {}))
    if n < 2 or not evaluations:
        return {}

    # Build score map from evaluations
    base_scores = {}
    for ev in evaluations:
        key = frozenset(ev["coalition"])
        base_scores[key] = ev["score"]

    def shapley_shares(scores):
        # Exact Shapley from score dict
        shap = {i: 0.0 for i in range(n)}
        n_fact = math.factorial(n)
        for mask in range(2 ** n):
            S = {i for i in range(n) if mask & (1 << i)}
            for i in range(n):
                if i in S:
                    continue
                s_size = len(S)
                w = (math.factorial(s_size) *
                     math.factorial(n - s_size - 1)) / n_fact
                v_with = scores.get(frozenset(S | {i}), 0)
                v_without = scores.get(frozenset(S), 0)
                # Apply monotonicity: v(S|i) >= v(S)
                v_with = max(v_with, v_without)
                shap[i] += w * (v_with - v_without)
        clamped = {i: max(0.0, v) for i, v in shap.items()}
        total = sum(clamped.values())
        if total > 0:
            return {i: v / total * 100 for i, v in clamped.items()}
        return {i: 100.0 / n for i in range(n)}

    all_shares = {i: [] for i in range(n)}
    for _ in range(n_runs):
        noisy = {}
        for key, score in base_scores.items():
            if len(key) == 0:
                noisy[key] = 0
            else:
                noisy[key] = max(0, min(100,
                    score + random.uniform(-noise, noise)))
        shares = shapley_shares(noisy)
        for i in range(n):
            all_shares[i].append(shares[i])

    cis = {}
    for i in range(n):
        vals = sorted(all_shares[i])
        lo = vals[int(0.025 * n_runs)]
        hi = vals[int(0.975 * n_runs)]
        cis[i] = {"low": round(lo, 1), "high": round(hi, 1)}
    return cis


def _run_analysis(job_id, repo_url, total_amount, max_commits):
    """Background worker: ingest → score → Shapley."""
    def update(status, **kw):
        with _jobs_lock:
            _jobs[job_id].update({"status": status, **kw})

    try:
        from github_ingest import get_commits, parse_repo_url
        from shapley import compute_shapley
        from semantic_scorer import clear_cache

        update("ingesting")
        repo = parse_repo_url(repo_url)
        contributors = get_commits(repo, max_commits)

        if len(contributors) < 2:
            update("failed", error=f"Need ≥2 contributors, found {len(contributors)}")
            return
        use_monte_carlo = len(contributors) > 5
        if use_monte_carlo:
            update("scoring", note=f"Using Monte Carlo approximation for {len(contributors)} contributors")

        update("scoring", contributors=[
            {"name": d["name"], "email": e, "commits": len(d["commits"])}
            for e, d in contributors.items()
        ])

        contributor_diffs, contributor_names = {}, {}
        for idx, (email, data) in enumerate(contributors.items()):
            diffs = []
            for commit in data["commits"]:
                for f in commit["files"]:
                    if f.get("patch"):
                        diffs.append(f"[{commit['message']}] {f['patch'][:2000]}")
            contributor_diffs[idx] = diffs
            contributor_names[idx] = data["name"]

        update("computing_shapley")
        clear_cache()
        if use_monte_carlo:
            from shapley import monte_carlo_shapley
            result = monte_carlo_shapley(contributor_diffs, contributor_names)
            result["evaluations"] = result.get("num_samples", 200)
            result["num_coalitions"] = f"~{result.get('num_samples', 200)} sampled"
            result["monotonicity_fixes"] = 0
        else:
            result = compute_shapley(contributor_diffs, contributor_names)

        # Compute 95% confidence intervals via Monte Carlo perturbation.
        # Perturb each coalition score ±5, recompute shares 200 times.
        # This quantifies how sensitive payouts are to scoring noise.
        ci_data = _compute_share_cis(result, n_runs=200, noise=5.0)

        # Build response
        contribs = []
        for idx, (email, data) in enumerate(contributors.items()):
            pct = result["shares_pct"][idx]
            ci = ci_data.get(idx, {})
            contribs.append({
                "name": data["name"],
                "email": email,
                "commits": len(data["commits"]),
                "additions": sum(c["additions"] for c in data["commits"]),
                "deletions": sum(c["deletions"] for c in data["commits"]),
                "shapley_value": result["shapley_values"][idx],
                "share_pct": pct,
                "share_ci_low": ci.get("low", pct),
                "share_ci_high": ci.get("high", pct),
                "payout_usd": round(total_amount * pct / 100, 2),
                "payout_ci_low": round(total_amount * ci.get("low", pct) / 100, 2),
                "payout_ci_high": round(total_amount * ci.get("high", pct) / 100, 2),
            })

        update("complete",
               repo=repo, total_amount=total_amount,
               contributors=contribs,
               evaluations=result["evaluations"],
               api_calls=result["api_calls"],
               num_coalitions=result["num_coalitions"],
               monotonicity_fixes=result.get("monotonicity_fixes", []))
    except Exception as e:
        with _jobs_lock:
            _jobs[job_id].update({"status": "failed", "error": str(e)[:500]})


# ── App ─────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app):
    yield

app = FastAPI(title="Shapley API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/api/demo")
def demo():
    """Frozen deterministic demo data. No API calls."""
    from demo_data import get_demo_analysis
    return get_demo_analysis()


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    from demo_data import get_demo_analysis
    log.info(f"Analyze request: repo={req.repo_url} total=${req.total_amount} demo={req.demo}")
    if req.demo:
        job_id = f"demo_{uuid.uuid4().hex[:8]}"
        with _jobs_lock:
            _jobs[job_id] = {"status": "complete", "created_at": time.time(),
                             **get_demo_analysis()}
        log.info(f"Demo job {job_id} created")
        return {"job_id": job_id, "status": "complete", "demo": True}

    job_id = uuid.uuid4().hex[:12]
    with _jobs_lock:
        _jobs[job_id] = {"status": "queued", "created_at": time.time()}
    t = threading.Thread(target=_run_analysis,
                         args=(job_id, req.repo_url, req.total_amount,
                               req.max_commits), daemon=True)
    t.start()
    log.info(f"Analysis job {job_id} queued for {req.repo_url}")
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/analyze/{job_id}")
def analyze_status(job_id: str):
    _cleanup_jobs()  # Opportunistic cleanup
    _check_job_timeout(job_id)
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found or expired")
    return {"job_id": job_id, **job}


@app.post("/api/payout")
def payout(req: PayoutRequest):
    """Execute PayPal batch payout. Human-confirmed only; no LLM in this path."""
    from paypal_payouts import create_batch_payout
    log.info(f"Payout request: {len(req.shares)} recipients, total=${req.total_amount}")
    shares = [{"email": s.email, "amount": s.amount,
               "note": s.note or "Shapley fair-share payout"}
              for s in req.shares]
    try:
        result = create_batch_payout(shares, total_amount=req.total_amount,
                                     idempotency_key=req.idempotency_key)
        log.info(f"Payout batch {result.get('batch_id')} created: {result.get('status')}")
    except (ValueError, RuntimeError) as e:
        log.warning(f"Payout failed: {e}")
        raise HTTPException(400, str(e))
    return result


@app.get("/api/payout/{batch_id}")
def payout_status(batch_id: str):
    from paypal_payouts import get_payout_status
    try:
        return get_payout_status(batch_id)
    except Exception as e:
        raise HTTPException(400, str(e)[:300])


# ── GitHub OAuth ────────────────────────────────────────────────
# Lets users connect their GitHub account and pick repos from a list,
# instead of pasting URLs. Like Vercel's "import repository" flow.

class OAuthCallback(BaseModel):
    code: str
    state: str | None = None


def _github_oauth_config():
    client_id = os.environ.get("GITHUB_OAUTH_CLIENT_ID", "")
    client_secret = os.environ.get("GITHUB_OAUTH_CLIENT_SECRET", "")
    # Frontend URL for redirect after OAuth
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    return client_id, client_secret, frontend_url


@app.get("/api/github/oauth-url")
def github_oauth_url():
    """Get the GitHub OAuth authorization URL."""
    import urllib.parse
    client_id, _, frontend_url = _github_oauth_config()
    if not client_id:
        raise HTTPException(500,
            "GitHub OAuth not configured. Set GITHUB_OAUTH_CLIENT_ID.")
    params = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": f"{frontend_url}/oauth/callback",
        "scope": "repo read:user",
        "state": uuid.uuid4().hex[:16],
    })
    return {"url": f"https://github.com/login/oauth/authorize?{params}"}


@app.post("/api/github/oauth-callback")
def github_oauth_callback(body: OAuthCallback):
    """Exchange OAuth code for access token. Returns a session ID."""
    import urllib.request
    import json as json_lib

    client_id, client_secret, _ = _github_oauth_config()
    if not client_id or not client_secret:
        raise HTTPException(500, "GitHub OAuth not configured.")

    # Exchange code for token
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "code": body.code,
    }).encode()
    req = urllib.request.Request(
        "https://github.com/login/oauth/access_token",
        data=data,
        headers={"Accept": "application/json",
                 "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            token_data = json_lib.loads(resp.read().decode())
    except Exception as e:
        log.warning(f"OAuth token exchange failed: {e}")
        raise HTTPException(400, "GitHub authorization failed.")

    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(400,
            f"GitHub denied authorization: {token_data.get('error_description', 'unknown')}")

    # Get username
    req = urllib.request.Request(
        "https://api.github.com/user",
        headers={"Authorization": f"Bearer {access_token}",
                 "Accept": "application/vnd.github.v3+json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            user_data = json_lib.loads(resp.read().decode())
    except Exception:
        raise HTTPException(400, "Could not fetch GitHub user.")

    session_id = uuid.uuid4().hex
    with _oauth_lock:
        _oauth_sessions[session_id] = {
            "access_token": access_token,
            "username": user_data.get("login", ""),
            "avatar_url": user_data.get("avatar_url", ""),
            "created_at": time.time(),
        }
    log.info(f"GitHub OAuth session created for {user_data.get('login')}")
    return {"session_id": session_id,
            "username": user_data.get("login", ""),
            "avatar_url": user_data.get("avatar_url", "")}


@app.get("/api/github/repos")
def github_repos(session_id: str, per_page: int = 30):
    """List the authenticated user's repos (for the repo picker)."""
    import urllib.request
    import json as json_lib

    with _oauth_lock:
        session = _oauth_sessions.get(session_id)
    if not session:
        raise HTTPException(401, "Not connected to GitHub. Please reconnect.")
    if time.time() - session["created_at"] > OAUTH_TTL_SEC:
        with _oauth_lock:
            _oauth_sessions.pop(session_id, None)
        raise HTTPException(401, "GitHub session expired. Please reconnect.")

    token = session["access_token"]
    url = (f"https://api.github.com/user/repos?per_page={min(per_page, 100)}"
           f"&sort=updated&affiliation=owner,collaborator")
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github.v3+json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            repos = json_lib.loads(resp.read().decode())
    except Exception as e:
        log.warning(f"Failed to list repos: {e}")
        raise HTTPException(400, "Could not fetch your repositories.")

    return {"repos": [
        {"full_name": r["full_name"],
         "name": r["name"],
         "description": r.get("description") or "",
         "private": r["private"],
         "updated_at": r["updated_at"],
         "language": r.get("language") or ""}
        for r in repos
    ]}


@app.post("/api/github/disconnect")
def github_disconnect(session_id: str):
    """Revoke the OAuth session."""
    with _oauth_lock:
        _oauth_sessions.pop(session_id, None)
    return {"disconnected": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
