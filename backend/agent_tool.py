#!/usr/bin/env python3
"""Shapley Agentic Commerce & MCP (Model Context Protocol) Interface.

Enables autonomous AI agents, GitHub bots, and multi-agent systems to:
1. Discover Shapley tools via standard MCP schema.
2. Evaluate repository contributions autonomously.
3. Propose or execute fair batch payouts via PayPal.

Built for the PayPal AI Hackathon 2026 - Best Use of Agentic Commerce.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import time
import uuid

agent_router = APIRouter(prefix="/api/agent", tags=["Agentic Commerce"])

# Standard MCP / Function Tool Definitions
MCP_TOOLS = [
    {
        "name": "shapley_evaluate_repo",
        "description": "Semantically evaluate a GitHub repository's contributor contributions using cooperative game theory (Shapley values) and calculate fair payout shares.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "repo_url": {
                    "type": "string",
                    "description": "GitHub repository in owner/repo or full URL format (e.g. 'pallets/jinja')"
                },
                "total_amount": {
                    "type": "number",
                    "description": "Total revenue or bounty amount in USD to distribute"
                },
                "max_commits": {
                    "type": "integer",
                    "description": "Maximum number of recent commits to analyze (default 30, max 50)",
                    "default": 30
                }
            },
            "required": ["repo_url", "total_amount"]
        }
    },
    {
        "name": "shapley_execute_payout",
        "description": "Execute a batch payout to contributors via PayPal Payouts API based on agreed fair shares.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "shares": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "email": {"type": "string", "description": "Recipient PayPal email"},
                            "amount": {"type": "number", "description": "Payout amount in USD"},
                            "note": {"type": "string", "description": "Optional memo for recipient"}
                        },
                        "required": ["email", "amount"]
                    }
                },
                "total_amount": {
                    "type": "number",
                    "description": "Total amount verifying the sum of shares"
                }
            },
            "required": ["shares", "total_amount"]
        }
    }
]


class AgentEvaluateRequest(BaseModel):
    repo_url: str = Field(..., description="GitHub owner/repo or URL")
    total_amount: float = Field(100.0, gt=0, description="Total amount in USD")
    max_commits: int = Field(30, ge=5, le=50)


class AgentShareItem(BaseModel):
    email: str
    amount: float = Field(..., gt=0)
    note: str = ""


class AgentPayoutRequest(BaseModel):
    shares: list[AgentShareItem]
    total_amount: float = Field(..., gt=0)
    idempotency_key: str | None = None


@agent_router.get("/tools")
def get_mcp_tools():
    """Return MCP tool definitions for AI agents."""
    return {
        "schema_version": "2024-11-05",
        "provider": "Shapley Fair Revenue Splits",
        "tools": MCP_TOOLS
    }


@agent_router.post("/evaluate")
def agent_evaluate(req: AgentEvaluateRequest):
    """Synchronous evaluation endpoint tailored for autonomous agent tool-calling."""
    from github_ingest import get_commits, parse_repo_url
    from shapley import compute_shapley, monte_carlo_shapley
    from semantic_scorer import clear_cache

    try:
        repo = parse_repo_url(req.repo_url)
        contributors = get_commits(repo, req.max_commits)
    except Exception as e:
        raise HTTPException(400, f"Failed to ingest repo: {e}")

    if len(contributors) < 2:
        raise HTTPException(400, f"Need at least 2 contributors, found {len(contributors)}")

    contributor_diffs, contributor_names = {}, {}
    for idx, (email, data) in enumerate(contributors.items()):
        diffs = []
        for commit in data["commits"]:
            for f in commit["files"]:
                if f.get("patch"):
                    diffs.append(f"[{commit['message']}] {f['patch'][:2000]}")
        contributor_diffs[idx] = diffs
        contributor_names[idx] = data["name"]

    clear_cache()
    if len(contributors) > 5:
        result = monte_carlo_shapley(contributor_diffs, contributor_names, num_samples=150)
    else:
        result = compute_shapley(contributor_diffs, contributor_names)

    shares = []
    for idx, (email, data) in enumerate(contributors.items()):
        pct = result["shares_pct"][idx]
        shares.append({
            "contributor": data["name"],
            "email": email,
            "share_pct": pct,
            "payout_usd": round(req.total_amount * pct / 100, 2),
            "shapley_value": result["shapley_values"][idx]
        })

    return {
        "status": "success",
        "repo": repo,
        "total_amount": req.total_amount,
        "shares": shares,
        "num_coalitions_evaluated": result["num_coalitions"],
        "api_calls": result["api_calls"]
    }


@agent_router.post("/payout")
def agent_payout(req: AgentPayoutRequest):
    """Trigger verified PayPal Batch Payout from an autonomous agent workflow."""
    from paypal_payouts import create_batch_payout
    shares_data = [{"email": s.email, "amount": s.amount, "note": s.note or "Shapley agentic payout"}
                   for s in req.shares]
    try:
        payout_result = create_batch_payout(
            shares_data,
            total_amount=req.total_amount,
            idempotency_key=req.idempotency_key or f"agent_{uuid.uuid4().hex[:12]}"
        )
        return {
            "status": "success",
            "batch_id": payout_result.get("batch_id"),
            "sender_batch_id": payout_result.get("sender_batch_id"),
            "paypal_status": payout_result.get("status")
        }
    except Exception as e:
        raise HTTPException(400, f"PayPal payout failed: {e}")
