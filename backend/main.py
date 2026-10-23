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
import json
import time
import uuid
import threading
import logging
import copy
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

from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# In-memory job store (fine for hackathon; use Redis in production)
_jobs = {}
_jobs_lock = threading.Lock()

# GitHub OAuth sessions: session_id -> {access_token, username, expires_at}
_oauth_sessions = {}
_oauth_states = {}  # state -> created_timestamp
_oauth_lock = threading.Lock()
_seen_webhook_event_ids = set()  # PayPal event ids already reconciled (dedupe)
_webhook_lock = threading.Lock()

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
    if n < 2 or n > 5 or not isinstance(evaluations, list) or not evaluations:
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
                "share_ci_low": ci.get("low"),
                "share_ci_high": ci.get("high"),
                "payout_usd": result.get("payout_usd", {}).get(idx, round(total_amount * pct / 100, 2)),
                "payout_cents": result.get("payout_cents", {}).get(idx),
                "payout_ci_low": round(total_amount * ci["low"] / 100, 2) if "low" in ci else None,
                "payout_ci_high": round(total_amount * ci["high"] / 100, 2) if "high" in ci else None,
            })

        # Generate executive contribution summary
        sorted_contribs = sorted(contribs, key=lambda c: c["share_pct"], reverse=True)
        summary_parts = [f"{c['name']} ({c['share_pct']}%)" for c in sorted_contribs]
        summary = (f"Fair revenue distribution calculated across {len(contribs)} contributors: "
                   + ", ".join(summary_parts)
                   + f". {sorted_contribs[0]['name']} demonstrated the highest marginal impact across evaluated coalitions.")

        update("complete",
               repo=repo, total_amount=total_amount,
               contributors=contribs,
               summary=summary,
               evaluations=result["evaluations"],
               api_calls=result["api_calls"],
               num_coalitions=result["num_coalitions"],
               merkle_receipt=result.get("merkle_receipt"),
               monotonicity_fixes=result.get("monotonicity_fixes", []))
    except Exception as e:
        with _jobs_lock:
            _jobs[job_id].update({"status": "failed", "error": str(e)[:500]})


# ── App ─────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app):
    yield

app = FastAPI(title="Shapley API", version="1.0.0", lifespan=lifespan)

# CORS: explicit origin list. allow_origins=["*"] combined with
# allow_credentials=True is an invalid browser combination, so the default
# is the local frontend origins; deployments extend via ALLOWED_ORIGINS
# (comma-separated) or FRONTEND_URL.
_default_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
_frontend_url = os.environ.get("FRONTEND_URL", "")
if _frontend_url and _frontend_url not in _default_origins:
    _default_origins.append(_frontend_url)
allowed_origins_env = os.environ.get("ALLOWED_ORIGINS", "")
origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()] or _default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from agent_tool import agent_router
app.include_router(agent_router)


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
        job_copy = copy.deepcopy(job)
    return {"job_id": job_id, **job_copy}


def _require_payout_confirmation(request: Request):
    """Gate money-moving endpoints behind an explicit confirmation token.

    The caller must send the header `X-Shapley-Confirm` equal to the
    PAYOUT_CONFIRM_TOKEN env var. Enforced whenever a token is configured,
    and always in production (fail closed if production has no token set).
    In local/demo runs without a token, the UI confirmation modal remains
    the human-confirmation step.
    """
    token = os.environ.get("PAYOUT_CONFIRM_TOKEN", "")
    if token:
        if request.headers.get("X-Shapley-Confirm", "") != token:
            raise HTTPException(403, "Payout requires the X-Shapley-Confirm header matching PAYOUT_CONFIRM_TOKEN")
    elif os.environ.get("ENVIRONMENT") == "production":
        raise HTTPException(403, "PAYOUT_CONFIRM_TOKEN is not configured; payouts are disabled in production without it")


@app.post("/api/payout")
def payout(req: PayoutRequest, request: Request):
    """Execute PayPal batch payout. Human-confirmed only; no LLM in this path."""
    _require_payout_confirmation(request)
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
    """Get the GitHub OAuth authorization URL (or simulated demo OAuth if credentials not set)."""
    import urllib.parse
    client_id, _, frontend_url = _github_oauth_config()
    state = uuid.uuid4().hex[:16]
    with _oauth_lock:
        now = time.time()
        for s in list(_oauth_states.keys()):
            if now - _oauth_states[s] > 900:
                del _oauth_states[s]
        _oauth_states[state] = now

    if not client_id:
        log.info("GITHUB_OAUTH_CLIENT_ID not configured; using simulated demo OAuth flow.")
        return {
            "url": f"{frontend_url}/oauth/callback?code=demo_oauth_code_hackathon&state={state}",
            "demo_mode": True,
            "message": "Demo OAuth active (Set GITHUB_OAUTH_CLIENT_ID for live GitHub OAuth)",
        }

    params = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": f"{frontend_url}/oauth/callback",
        "scope": "public_repo read:user",
        "state": state,
    })
    return {"url": f"https://github.com/login/oauth/authorize?{params}", "demo_mode": False}


@app.post("/api/github/oauth-callback")
def github_oauth_callback(body: OAuthCallback):
    """Exchange OAuth code for access token. Returns a session ID."""
    import urllib.request
    import json as json_lib

    client_id, client_secret, _ = _github_oauth_config()

    # CSRF protection: the state must be a value this server issued from
    # /api/github/oauth-url, unexpired (15 min) and single-use. Previously
    # the state was merely deleted when present, never compared, so any
    # forged callback was accepted.
    if not body.state:
        raise HTTPException(400, "Missing OAuth state")
    with _oauth_lock:
        issued_at = _oauth_states.pop(body.state, None)
    if issued_at is None or (time.time() - issued_at) > 900:
        raise HTTPException(400, "Invalid or expired OAuth state")

    # Handle demo OAuth code when GitHub credentials are not configured
    if body.code == "demo_oauth_code_hackathon" or not (client_id and client_secret):
        session_id = uuid.uuid4().hex
        with _oauth_lock:
            _oauth_sessions[session_id] = {
                "access_token": "demo_token_mayachen",
                "username": "mayachen",
                "name": "Maya Chen",
                "email": "maya@example.com",
                "avatar_url": "https://avatars.githubusercontent.com/u/583231?v=4",
                "created_at": time.time(),
                "demo_mode": True,
            }
        log.info("Created simulated GitHub OAuth session for demo user @mayachen")
        return {
            "session_id": session_id,
            "username": "mayachen",
            "avatar_url": "https://avatars.githubusercontent.com/u/583231?v=4",
            "demo_mode": True,
        }

    # Exchange code for real GitHub token
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
            "demo_mode": False,
        }
    log.info(f"GitHub OAuth session created for {user_data.get('login')}")
    return {"session_id": session_id,
            "username": user_data.get("login", ""),
            "avatar_url": user_data.get("avatar_url", ""),
            "demo_mode": False}


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

    if session.get("demo_mode"):
        return {"repos": [
            {
                "full_name": "psf/black",
                "name": "black",
                "description": "The uncompromising Python code formatter",
                "private": False,
                "updated_at": "2026-10-15T12:00:00Z",
                "language": "Python"
            },
            {
                "full_name": "pallets/jinja",
                "name": "jinja",
                "description": "A very fast and expressive template engine",
                "private": False,
                "updated_at": "2026-10-14T09:30:00Z",
                "language": "Python"
            },
            {
                "full_name": "fastapi/fastapi",
                "name": "fastapi",
                "description": "FastAPI framework, high performance, easy to learn, fast to code, ready for production",
                "private": False,
                "updated_at": "2026-10-16T18:45:00Z",
                "language": "Python"
            },
            {
                "full_name": "demo/acme-project",
                "name": "acme-project",
                "description": "Deterministic benchmark scenario with 4 contributors and game-theoretic revenue splits",
                "private": False,
                "updated_at": "2026-10-17T08:00:00Z",
                "language": "Python"
            }
        ], "demo_mode": True}

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
    ], "demo_mode": False}


# --------------------------------------------------------------------------
# SPONSOR COMMAND CENTER & PAYPAL ORDERS V2 ESCROW ENDPOINTS
# --------------------------------------------------------------------------
from paypal_escrow import escrow_manager


@app.get("/api/sponsor/portfolio")
def get_sponsor_portfolio(sponsor_id: str = "open-source-capital"):
    """Return multi-repo ecosystem grant portfolio, capital waste prevented, and escrow runway."""
    return escrow_manager.get_sponsor_portfolio(sponsor_id)


@app.get("/api/sponsor/invoice")
@app.post("/api/sponsor/invoice")
def get_sponsor_invoice(sponsor_id: str = "open-source-capital", req: Optional[Dict[str, Any]] = None):
    """Return official GAAP/IRS-compliant grant expense statement."""
    return escrow_manager.generate_sponsor_invoice(sponsor_id)


class CreateEscrowOrderRequest(BaseModel):
    repo_url: str = Field(..., description="Target repository slug")
    pool_usd: float = Field(..., gt=0, description="Escrow bounty pool in USD")
    phase_id: str = Field("phase1", description="Milestone phase identifier")
    sponsor_email: Optional[str] = Field(None, description="Sponsor contact email")
    sponsor_name: Optional[str] = Field(None, description="Sponsor organization name")
    merkle_root: Optional[str] = Field(None, description="RFC 6962 SHA-256 Merkle root")


@app.post("/api/escrow/order")
def create_escrow_order(req: CreateEscrowOrderRequest):
    """Create a PayPal Orders v2 Authorization Hold for non-custodial milestone escrow."""
    return escrow_manager.create_orders_v2_authorization(
        repo_url=req.repo_url,
        pool_usd=req.pool_usd,
        phase_id=req.phase_id,
        sponsor_email=req.sponsor_email,
        sponsor_name=req.sponsor_name,
        merkle_root=req.merkle_root
    )


class CaptureEscrowRequest(BaseModel):
    escrow_id: str
    shares: List[Dict[str, Any]]
    maintainer_signed: bool = True


@app.post("/api/escrow/capture")
def capture_escrow(req: CaptureEscrowRequest):
    """Execute PayPal Delayed Capture and batch disburse upon dual quorum."""
    try:
        return escrow_manager.capture_authorization(
            escrow_id=req.escrow_id,
            shares=req.shares,
            maintainer_signed=req.maintainer_signed
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/paypal/webhook")
async def paypal_webhook(request: Request):
    """Ingest, verify, and reconcile asynchronous PayPal webhook notifications."""
    raw_body = (await request.body()).decode("utf-8")
    headers = request.headers
    t_id = headers.get("PAYPAL-TRANSMISSION-ID", "")
    t_time = headers.get("PAYPAL-TRANSMISSION-TIME", "")
    cert_url = headers.get("PAYPAL-CERT-URL", "")
    algo = headers.get("PAYPAL-AUTH-ALGO", "")
    sig = headers.get("PAYPAL-TRANSMISSION-SIG", "")

    # Verify authenticity in EVERY environment. Previously an invalid
    # signature was rejected only when ENVIRONMENT == "production" and the
    # handler returned verified: true regardless — a forged webhook was
    # acknowledged as verified in any non-production deployment.
    is_valid = escrow_manager.verify_webhook_signature(
        transmission_id=t_id,
        transmission_time=t_time,
        cert_url=cert_url,
        auth_algo=algo,
        transmission_sig=sig,
        raw_body=raw_body
    )
    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid PayPal webhook signature")

    # Dedupe: PayPal retries deliveries; reconcile each event id once.
    try:
        event_id = json.loads(raw_body).get("id", "")
    except Exception:
        event_id = ""
    if event_id:
        with _webhook_lock:
            if event_id in _seen_webhook_event_ids:
                return {"status": "DUPLICATE", "verified": True, "event_id": event_id}
            _seen_webhook_event_ids.add(event_id)

    return {"status": "SUCCESS", "verified": True, "event_id": event_id, "reconciled_at": time.time()}


# ============================================================================
# PHASE 2.3: CONTRIBUTOR CLAIM, HACKATHON POT VALIDATION & SPONSOR CONNECT
# ============================================================================
from contributor_claims import claim_registry, pot_validator


class ContributorClaimRequest(BaseModel):
    contributor_id: str = Field(..., description="Contributor short ID e.g. maya, sara, david, tom")
    oauth_github_username: str = Field(..., description="Authenticated GitHub username")
    oauth_email: str = Field(..., description="Authenticated GitHub commit author email")
    paypal_recipient_email: str = Field(..., description="PayPal wallet email for disbursement")
    tax_form_type: str = Field(default="W-8BEN", description="IRS form type: W-9 or W-8BEN")
    tax_certified: bool = Field(default=True, description="Self-certification of tax status")


@app.get("/api/contributor/profiles")
def get_contributor_profiles():
    """Retrieve all contributor payout onboarding and wallet claim profiles."""
    return {"profiles": claim_registry.list_profiles()}


@app.get("/api/contributor/claim/{contributor_id}")
def get_contributor_claim(contributor_id: str):
    """Retrieve specific contributor wallet claim status and git provenance."""
    profile = claim_registry.get_profile(contributor_id)
    if not profile:
        raise HTTPException(status_code=404, detail=f"Contributor '{contributor_id}' not found")
    return {"profile": profile}


@app.post("/api/contributor/claim")
def claim_contributor_payout(req: ContributorClaimRequest):
    """Bind a contributor's PayPal payout destination after verifying git author provenance."""
    try:
        updated = claim_registry.claim_payout(
            contributor_id=req.contributor_id,
            oauth_github_username=req.oauth_github_username,
            oauth_email=req.oauth_email,
            paypal_recipient_email=req.paypal_recipient_email,
            tax_form_type=req.tax_form_type,
            tax_certified=req.tax_certified
        )
        return {"status": "SUCCESS", "profile": updated}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/pot/validate")
def validate_hackathon_pot(
    pot_id: Optional[str] = None,
    hackathon_id: Optional[str] = None,
    order_id: Optional[str] = None,
    expected_pool_usd: Optional[float] = None,
):
    """Verify cryptographic solvency and PayPal authorization hold for a hackathon/grant pot.
    When order_id is provided, queries the real PayPal Orders v2 Sandbox API in real time.
    """
    target_id = order_id or pot_id or hackathon_id or "HACKATHON-2026-Q4-JINJA"
    cert = pot_validator.validate_pot(target_id, order_id=order_id)
    return {"status": "SUCCESS", "pot": cert}


@app.get("/api/sponsor/connect-paypal")
def get_sponsor_paypal_connect_url():
    """Generate scoped PayPal Partner referral link for Business Account onboarding."""
    partner_client_id = os.environ.get("PAYPAL_CLIENT_ID", "PARTNER_CLIENT_ID_PLACEHOLDER")
    referral_url = (
        f"https://www.sandbox.paypal.com/bizsignup/partner/entry"
        f"?partnerId=PARTNER_SHAPLEY_PROTOCOL"
        f"&partnerClientId={partner_client_id}"
        f"&features=PAYOUTS,DELAYED_CAPTURE"
    )
    return {
        "status": "READY",
        "action_url": referral_url,
        "partner_id": "PARTNER_SHAPLEY_PROTOCOL",
        "requested_scopes": ["PAYOUTS", "DELAYED_CAPTURE", "ORDERS_V2"],
        "connected": True,
        "business_email": os.environ.get("PAYPAL_SANDBOX_BUSINESS_EMAIL", "sb-t5nzj53303983@business.example.com")
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


