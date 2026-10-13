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

JOB_TIMEOUT_SEC = 600  # 10 minutes max per analysis job
JOB_TTL_SEC = 3600     # Keep completed jobs for 1 hour


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
        if len(contributors) > 5:
            update("failed", error=f"Too many contributors ({len(contributors)}). Max 5 for live analysis.")
            return

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
        result = compute_shapley(contributor_diffs, contributor_names)

        # Build response
        contribs = []
        for idx, (email, data) in enumerate(contributors.items()):
            pct = result["shares_pct"][idx]
            contribs.append({
                "name": data["name"],
                "email": email,
                "commits": len(data["commits"]),
                "additions": sum(c["additions"] for c in data["commits"]),
                "deletions": sum(c["deletions"] for c in data["commits"]),
                "shapley_value": result["shapley_values"][idx],
                "share_pct": pct,
                "payout_usd": round(total_amount * pct / 100, 2),
            })

        update("complete",
               repo=repo, total_amount=total_amount,
               contributors=contribs,
               evaluations=result["evaluations"],
               api_calls=result["api_calls"],
               num_coalitions=result["num_coalitions"])
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
