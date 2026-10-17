#!/usr/bin/env python3
"""Shapley Agentic Commerce & Model Context Protocol (MCP) Server.

Enables autonomous AI swarms, Claude Desktop, Cursor, Gemini CLI, and GitHub bots to:
1. Discover tools via standard MCP JSON-RPC 2.0 interface.
2. Evaluate repository contributions via hybrid cooperative game theory.
3. Verify cryptographic Merkle audit receipts independently.
4. Programmatically execute verified PayPal batch disbursements with idempotency.
"""
import json
import time
import uuid
from typing import Dict, List, Optional, Any
try:
    from fastapi import APIRouter, HTTPException, Request
    from pydantic import BaseModel, Field
except ImportError:
    class APIRouter:
        def __init__(self, *args, **kwargs): pass
        def get(self, *args, **kwargs): return lambda f: f
        def post(self, *args, **kwargs): return lambda f: f

    class HTTPException(Exception):
        def __init__(self, status_code, detail):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class Request: pass

    class BaseModel:
        def __init__(self, **data):
            for k, v in data.items():
                setattr(self, k, v)
        def dict(self):
            return self.__dict__

    def Field(default=..., **kwargs):
        return default

from merkle_audit import verify_merkle_receipt

agent_router = APIRouter(prefix="/api/agent", tags=["Agentic Commerce & MCP"])

# Standard Model Context Protocol (MCP) Tool Schemas
MCP_TOOLS = [
    {
        "name": "shapley_evaluate_repo",
        "description": "Semantically and structurally evaluate a GitHub repository's contributor contributions using cooperative game theory (Shapley values) with exact-penny allocations and Merkle audit receipts.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "repo_url": {
                    "type": "string",
                    "description": "GitHub repository in owner/repo or full URL format (e.g. 'pallets/jinja')"
                },
                "total_amount": {
                    "type": "number",
                    "description": "Total revenue or bounty amount in USD to distribute (default: 100.0)"
                },
                "max_commits": {
                    "type": "integer",
                    "description": "Maximum number of recent commits to analyze (default 30, max 50)",
                    "default": 30
                }
            },
            "required": ["repo_url"]
        }
    },
    {
        "name": "shapley_verify_audit_proof",
        "description": "Verify an offline cryptographic Merkle audit receipt for a previous Shapley evaluation run.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "evaluations": {
                    "type": "array",
                    "description": "List of evaluated coalition dictionaries"
                },
                "merkle_root": {
                    "type": "string",
                    "description": "The expected Merkle Root hex digest from the receipt"
                }
            },
            "required": ["evaluations", "merkle_root"]
        }
    },
    {
        "name": "shapley_execute_payout",
        "description": "Execute a batch payout to contributors via PayPal Payouts REST v1 based on verified Shapley allocations with flat fee transparency.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "shares": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "email": {"type": "string", "description": "Recipient PayPal email address"},
                            "amount": {"type": "number", "description": "Payout amount in USD"},
                            "note": {"type": "string", "description": "Optional memo for recipient"}
                        },
                        "required": ["email", "amount"]
                    }
                },
                "total_amount": {
                    "type": "number",
                    "description": "Total amount verifying the sum of shares"
                },
                "idempotency_key": {
                    "type": "string",
                    "description": "Optional custom idempotency key to prevent double disbursements"
                }
            },
            "required": ["shares", "total_amount"]
        }
    },
    {
        "name": "shapley_get_project_standings",
        "description": "Get current milestone standings, phase escrow status, and team member fair shares for a repository.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "repo_url": {
                    "type": "string",
                    "description": "GitHub repository in owner/repo format (default: 'pallets/jinja')"
                },
                "phase_id": {
                    "type": "string",
                    "description": "Milestone phase (e.g. 'phase1', 'phase2', or 'all')",
                    "default": "phase2"
                }
            }
        }
    },
    {
        "name": "shapley_get_chat_webhook",
        "description": "Generate a ready-to-dispatch Slack Block Kit, Discord Embed, Telegram Bot, or WhatsApp Cloud API JSON payload for team chat milestone updates.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "platform": {
                    "type": "string",
                    "enum": ["slack", "discord", "telegram", "whatsapp"],
                    "description": "Chat platform format (slack, discord, telegram, whatsapp)",
                    "default": "slack"
                },
                "repo_url": {
                    "type": "string",
                    "default": "pallets/jinja"
                },
                "phase_id": {
                    "type": "string",
                    "default": "phase2"
                }
            }
        }
    },
    {
        "name": "shapley_get_escrow_status",
        "description": "Get current multi-stakeholder PayPal Escrow status, custody holds, challenge window timer, and quorum signatures for a repository.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "escrow_id": {
                    "type": "string",
                    "description": "Escrow Vault ID (e.g. 'ESCROW-PP-JINJA-02')",
                    "default": "ESCROW-PP-JINJA-02"
                }
            }
        }
    },
    {
        "name": "shapley_authorize_escrow_release",
        "description": "Authorize and disburse a PayPal Escrow milestone tranche to contributors following dual-quorum stakeholder verification.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "escrow_id": {
                    "type": "string",
                    "description": "Escrow Vault ID to release",
                    "default": "ESCROW-PP-JINJA-02"
                },
                "signer_role": {
                    "type": "string",
                    "enum": ["maintainer", "sponsor"],
                    "description": "Authorizing stakeholder role",
                    "default": "maintainer"
                }
            },
            "required": ["escrow_id"]
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
    shares: List[AgentShareItem]
    total_amount: float = Field(..., gt=0)
    idempotency_key: Optional[str] = None


class VerifyReceiptRequest(BaseModel):
    evaluations: List[Dict[str, Any]]
    merkle_root: str


@agent_router.get("/tools")
def get_mcp_tools():
    """Return MCP tool definitions for autonomous agents and swarms."""
    return {
        "schema_version": "2024-11-05",
        "provider": "Shapley Autonomous Revenue Infrastructure",
        "protocol": "Model Context Protocol (MCP)",
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
        result = monte_carlo_shapley(
            contributor_diffs,
            contributor_names,
            num_samples=150,
            total_amount_usd=req.total_amount,
            repo_name=repo
        )
    else:
        result = compute_shapley(
            contributor_diffs,
            contributor_names,
            total_amount_usd=req.total_amount,
            repo_name=repo
        )

    shares = []
    for idx, (email, data) in enumerate(contributors.items()):
        pct = result["shares_pct"][idx]
        usd = result["payout_usd"][idx]
        shares.append({
            "contributor": data["name"],
            "email": email,
            "share_pct": pct,
            "payout_usd": usd,
            "payout_cents": result["payout_cents"][idx],
            "shapley_value": result["shapley_values"][idx]
        })

    return {
        "status": "success",
        "repo": repo,
        "total_amount": req.total_amount,
        "shares": shares,
        "num_coalitions_evaluated": result["num_coalitions"],
        "api_calls": result["api_calls"],
        "method": result["method"],
        "merkle_receipt": result.get("merkle_receipt"),
    }


@agent_router.post("/verify")
def agent_verify_receipt(req: VerifyReceiptRequest):
    """Cryptographically verify that evaluation leaves hash to the claimed Merkle Root."""
    is_valid = verify_merkle_receipt(req.evaluations, req.merkle_root)
    return {
        "valid": is_valid,
        "merkle_root": req.merkle_root,
        "verified_leaves": len(req.evaluations),
        "protocol": "RFC-6962 SHA-256",
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
            idempotency_key=req.idempotency_key
        )
        return {
            "status": "success",
            "batch_id": payout_result.get("batch_id"),
            "sender_batch_id": payout_result.get("sender_batch_id"),
            "paypal_status": payout_result.get("status"),
            "fee_usd": payout_result.get("fee_usd"),
            "total_disbursed_usd": payout_result.get("total_disbursed_usd"),
        }
    except Exception as e:
        raise HTTPException(400, f"PayPal payout failed: {e}")


@agent_router.post("/mcp")
async def mcp_jsonrpc_endpoint(request: Request):
    """Official JSON-RPC 2.0 Model Context Protocol (MCP) transport endpoint."""
    try:
        body = await request.json()
    except Exception:
        return {"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error"}, "id": None}
    return handle_mcp_message(body)


def handle_mcp_message(body: dict) -> dict:
    """Processes a JSON-RPC 2.0 Model Context Protocol request payload."""
    req_id = body.get("id")
    method = body.get("method")
    params = body.get("params", {})

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {"listChanged": False},
                    "resources": {"subscribe": False, "listChanged": False}
                },
                "serverInfo": {
                    "name": "shapley-mcp-server",
                    "version": "1.0.0"
                }
            }
        }

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": MCP_TOOLS}
        }

    elif method == "tools/call":
        tool_name = params.get("name")
        args = params.get("arguments", {})

        if tool_name == "shapley_evaluate_repo":
            req_obj = AgentEvaluateRequest(
                repo_url=args.get("repo_url", ""),
                total_amount=float(args.get("total_amount", 100.0)),
                max_commits=int(args.get("max_commits", 30))
            )
            eval_res = agent_evaluate(req_obj)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(eval_res, indent=2)}]
                }
            }

        elif tool_name == "shapley_verify_audit_proof":
            evals = args.get("evaluations", [])
            root = args.get("merkle_root", "")
            is_valid = verify_merkle_receipt(evals, root)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps({"valid": is_valid, "merkle_root": root})}]
                }
            }

        elif tool_name == "shapley_execute_payout":
            share_items = [
                AgentShareItem(email=s["email"], amount=float(s["amount"]), note=s.get("note", ""))
                for s in args.get("shares", [])
            ]
            payout_req = AgentPayoutRequest(
                shares=share_items,
                total_amount=float(args.get("total_amount", 0.0)),
                idempotency_key=args.get("idempotency_key")
            )
            payout_res = agent_payout(payout_req)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(payout_res, indent=2)}]
                }
            }

        elif tool_name == "shapley_get_project_standings":
            from milestone_engine import MilestoneTracker
            repo_name = args.get("repo_url", "pallets/jinja")
            phase_id = args.get("phase_id", "phase2")
            tracker = MilestoneTracker(repo_name)
            if phase_id == "all":
                res = tracker.get_cumulative_standings()
            else:
                phase = tracker.get_phase(phase_id)
                res = phase.__dict__ if phase else {"error": f"Unknown phase {phase_id}"}
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(res, indent=2)}]
                }
            }

        elif tool_name == "shapley_get_chat_webhook":
            from milestone_engine import MilestoneTracker
            from chat_webhook import (
                generate_slack_milestone_digest,
                generate_discord_milestone_digest,
                generate_telegram_milestone_digest,
                generate_whatsapp_milestone_digest,
            )
            platform = args.get("platform", "slack").lower()
            repo_name = args.get("repo_url", "pallets/jinja")
            phase_id = args.get("phase_id", "phase2")
            tracker = MilestoneTracker(repo_name)
            phase = tracker.get_phase(phase_id)
            standings = [
                {"name": name, "share_pct": phase.shares_pct[name], "payout_usd": phase.payouts_usd[name], "ai_assisted": (name == "David Park")}
                for name in phase.shares_pct
            ] if phase else []
            if platform == "discord":
                payload = generate_discord_milestone_digest(repo_name, phase.title if phase else phase_id, phase.pool_usd if phase else 1000.0, standings, phase.merkle_root or "88643cd1...")
            elif platform == "telegram":
                payload = generate_telegram_milestone_digest(repo_name, phase.title if phase else phase_id, phase.pool_usd if phase else 1000.0, standings, phase.merkle_root or "88643cd1...")
            elif platform == "whatsapp":
                payload = generate_whatsapp_milestone_digest(repo_name, phase.title if phase else phase_id, phase.pool_usd if phase else 1000.0, standings, phase.merkle_root or "88643cd1...")
            else:
                payload = generate_slack_milestone_digest(repo_name, phase.title if phase else phase_id, phase.pool_usd if phase else 1000.0, standings, phase.merkle_root or "88643cd1...")
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(payload, indent=2)}]
                }
            }

        elif tool_name == "shapley_get_escrow_status":
            from paypal_escrow import escrow_manager
            escrow_id = args.get("escrow_id", "ESCROW-PP-JINJA-02")
            vault = escrow_manager.get_vault(escrow_id)
            if not vault:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32602, "message": f"Escrow vault not found: {escrow_id}"}
                }
            data = {
                "escrow_id": vault.escrow_id,
                "status": vault.status,
                "custodian": vault.custodian,
                "pool_usd": vault.pool_usd,
                "authorization_id": vault.authorization_id,
                "merkle_root": vault.merkle_root,
                "challenge_window_hours": vault.challenge_window_hours,
                "challenge_expires_at": vault.challenge_expires_at,
                "time_remaining_seconds": max(0, vault.challenge_expires_at - time.time()),
                "stakeholders": {k: {"role": s.role, "name": s.name, "approved": s.approved, "signature_hash": s.signature_hash} for k, s in vault.stakeholders.items()}
            }
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(data, indent=2)}]
                }
            }

        elif tool_name == "shapley_authorize_escrow_release":
            from paypal_escrow import escrow_manager
            from milestone_engine import MilestoneTracker
            escrow_id = args.get("escrow_id", "ESCROW-PP-JINJA-02")
            vault = escrow_manager.get_vault(escrow_id)
            if not vault:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32602, "message": f"Escrow vault not found: {escrow_id}"}
                }
            tracker = MilestoneTracker(vault.repo_url)
            phase = tracker.get_phase(vault.phase_id)
            shares = [
                {"email": f"{name.lower().replace(' ', '.')}@jinja-dev.org", "amount": amt}
                for name, amt in phase.payouts_usd.items()
            ] if phase else []
            res = escrow_manager.release_escrow(escrow_id, shares)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(res, indent=2)}]
                }
            }

        else:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Method not found: {tool_name}"}
            }

    elif method == "resources/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "resources": [
                    {
                        "uri": "shapley://protocol/spec",
                        "name": "Shapley Protocol Specification",
                        "mimeType": "text/markdown"
                    }
                ]
            }
        }

    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Unknown method: {method}"}
        }
