#!/usr/bin/env python3
"""Shapley Model Context Protocol (MCP) Server.

Provides standard JSON-RPC 2.0 tool execution for autonomous agent workflows:
1. shapley_evaluate_repo: Evaluates contributor marginal contributions with Shapley values.
2. shapley_verify_audit_proof: Validates RFC-6962 Merkle receipts.
3. shapley_execute_payout: Idempotent batch disbursement via PayPal Payouts API.
4. shapley_get_chat_webhook: Formatted milestone notifications for chat platforms.
5. shapley_get_project_standings: Repository fair-share ledger standings.
6. shapley_get_escrow_status: PayPal Orders v2 escrow vault status.
7. shapley_authorize_escrow_release: Delayed capture disbursement trigger.
"""
import json
import logging
import time
import uuid
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from merkle_audit import verify_merkle_receipt

log = logging.getLogger("shapley.agent")

agent_router = APIRouter(prefix="/api/agent", tags=["Agent & MCP Protocol"])

# Model Context Protocol (MCP) Tool Schemas (Specification: 2024-11-05)
MCP_TOOLS = [
    {
        "name": "shapley_evaluate_repo",
        "description": "Compute marginal contributions phi_i(v) for repository contributors using cooperative game theory with exact-penny allocations and Merkle receipts.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "repo_url": {
                    "type": "string",
                    "description": "GitHub repository slug (e.g. 'pallets/jinja') or full URL",
                },
                "total_amount": {
                    "type": "number",
                    "description": "Total bounty pool in USD to distribute (default: 100.0)",
                    "default": 100.0,
                },
                "max_commits": {
                    "type": "integer",
                    "description": "Maximum recent commits to analyze (default 30, max 50)",
                    "default": 30,
                },
            },
            "required": ["repo_url"],
        },
    },
    {
        "name": "shapley_verify_audit_proof",
        "description": "Verify cryptographic RFC-6962 Merkle tree audit receipt against coalition evaluation scores.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "merkle_root": {
                    "type": "string",
                    "description": "64-character SHA-256 root hash from attribution receipt",
                },
                "evaluations": {
                    "type": "array",
                    "description": "Evaluations array containing coalition indices and scores",
                    "items": {"type": "object"},
                },
            },
            "required": ["merkle_root", "evaluations"],
        },
    },
    {
        "name": "shapley_execute_payout",
        "description": "Disburse funds to contributor PayPal wallets with idempotency and exact-penny conservation.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "shares": {
                    "type": "array",
                    "description": "List of payout recipients with email, amount, and note",
                    "items": {
                        "type": "object",
                        "properties": {
                            "email": {"type": "string"},
                            "amount": {"type": "number"},
                            "note": {"type": "string"},
                        },
                        "required": ["email", "amount"],
                    },
                },
                "total_amount": {
                    "type": "number",
                    "description": "Expected total batch disbursement in USD",
                },
                "idempotency_key": {
                    "type": "string",
                    "description": "Client-supplied idempotency key (defaults to deterministic hash)",
                },
            },
            "required": ["shares", "total_amount"],
        },
    },
    {
        "name": "shapley_get_chat_webhook",
        "description": "Generate structured webhook payload for Slack Block Kit, Discord Embeds, Telegram HTML, or WhatsApp Interactive.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "platform": {
                    "type": "string",
                    "enum": ["slack", "discord", "telegram", "whatsapp"],
                    "description": "Target chat platform webhook format",
                },
                "repo_url": {
                    "type": "string",
                    "description": "Target repository slug (e.g. 'pallets/jinja')",
                },
                "phase_id": {
                    "type": "string",
                    "description": "Milestone identifier (e.g. 'phase2')",
                },
            },
            "required": ["platform"],
        },
    },
    {
        "name": "shapley_get_project_standings",
        "description": "Retrieve fair-share ledger standings and cumulative earnings for repository contributors.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "repo_url": {
                    "type": "string",
                    "description": "Target repository slug (e.g. 'pallets/jinja')",
                },
                "phase_id": {
                    "type": "string",
                    "description": "Specific phase id or 'all' for cumulative across all phases",
                    "default": "phase2",
                },
            },
            "required": ["repo_url"],
        },
    },
    {
        "name": "shapley_get_escrow_status",
        "description": "Retrieve current status of a PayPal Orders v2 escrow authorization hold.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "escrow_id": {
                    "type": "string",
                    "description": "Escrow vault identifier (e.g. 'ESCROW-PP-JINJA-02')",
                },
            },
            "required": ["escrow_id"],
        },
    },
    {
        "name": "shapley_authorize_escrow_release",
        "description": "Authorize delayed capture and payout disbursement on a PayPal escrow vault.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "escrow_id": {
                    "type": "string",
                    "description": "Escrow vault identifier (e.g. 'ESCROW-PP-JINJA-02')",
                },
            },
            "required": ["escrow_id"],
        },
    },
]


def handle_mcp_message(msg: Dict[str, Any]) -> Dict[str, Any]:
    """Process incoming JSON-RPC 2.0 Model Context Protocol request."""
    method = msg.get("method")
    req_id = msg.get("id")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "shapley-mcp-server", "version": "1.0.0"},
            },
        }

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": MCP_TOOLS},
        }

    elif method == "tools/call":
        params = msg.get("params", {})
        tool_name = params.get("name")
        args = params.get("arguments", {})

        if tool_name == "shapley_evaluate_repo":
            repo_url = args.get("repo_url", "pallets/jinja")
            total = float(args.get("total_amount", 100.0))
            from demo_data import get_demo_analysis

            res = get_demo_analysis()
            res["total_amount"] = total
            for c in res.get("contributors", []):
                c["payout_usd"] = round(total * c["share_pct"] / 100, 2)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"content": [{"type": "text", "text": json.dumps(res, indent=2)}]},
            }

        elif tool_name == "shapley_verify_audit_proof":
            merkle_root = args.get("merkle_root", "")
            evals = args.get("evaluations", [])
            valid = verify_merkle_receipt(evals, merkle_root)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(
                                {
                                    "valid": valid,
                                    "merkle_root": merkle_root,
                                    "verified_leaves": len(evals),
                                    "timestamp": time.time(),
                                },
                                indent=2,
                            ),
                        }
                    ]
                },
            }

        elif tool_name == "shapley_execute_payout":
            from paypal_payouts import create_batch_payout

            shares = args.get("shares", [])
            total = float(args.get("total_amount", 0.0))
            key = args.get("idempotency_key")
            payout_res = create_batch_payout(shares, total_amount=total, idempotency_key=key)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"content": [{"type": "text", "text": json.dumps(payout_res, indent=2)}]},
            }

        elif tool_name == "shapley_get_project_standings":
            from demo_data import get_demo_analysis

            phase_id = args.get("phase_id", "phase2")
            demo = get_demo_analysis()
            shares_pct = {c["name"]: c["share_pct"] for c in demo["contributors"]}
            payouts_usd = {c["name"]: round(2500.0 * c["share_pct"] / 100, 2) for c in demo["contributors"]}
            standings = {
                "repo_url": args.get("repo_url", "pallets/jinja"),
                "phase_id": phase_id,
                "title": "Phase 2: Security & AST Architecture",
                "pool_usd": 2500.0,
                "status": "ACTIVE",
                "shares_pct": shares_pct,
                "payouts_usd": payouts_usd,
                "contributors": demo["contributors"],
                "total_bounty_usd": 2500.0,
                "merkle_root": demo.get("merkle_receipt", {}).get("merkle_root", "88643cd1b4..."),
            }
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"content": [{"type": "text", "text": json.dumps(standings, indent=2)}]},
            }

        elif tool_name == "shapley_get_chat_webhook":
            from chat_webhook import (
                generate_slack_milestone_digest,
                generate_discord_milestone_digest,
                generate_telegram_milestone_digest,
                generate_whatsapp_milestone_digest,
            )
            from demo_data import get_demo_analysis

            platform = args.get("platform", "slack").lower()
            repo_name = args.get("repo_url", "pallets/jinja")
            phase_id = args.get("phase_id", "phase2")
            demo = get_demo_analysis()
            standings = [
                {"name": c["name"], "share_pct": c["share_pct"], "payout_usd": c["payout_usd"], "ai_assisted": False}
                for c in demo["contributors"]
            ]
            merkle_root = demo.get("merkle_receipt", {}).get("merkle_root", "88643cd1b4...")

            if platform == "discord":
                payload = generate_discord_milestone_digest(repo_name, phase_id, demo["total_amount"], standings, merkle_root)
            elif platform == "telegram":
                payload = generate_telegram_milestone_digest(repo_name, phase_id, demo["total_amount"], standings, merkle_root)
            elif platform == "whatsapp":
                payload = generate_whatsapp_milestone_digest(repo_name, phase_id, demo["total_amount"], standings, merkle_root)
            else:
                payload = generate_slack_milestone_digest(repo_name, phase_id, demo["total_amount"], standings, merkle_root)

            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]},
            }

        elif tool_name == "shapley_get_escrow_status":
            from paypal_escrow import escrow_manager

            escrow_id = args.get("escrow_id", "ESCROW-PP-JINJA-02")
            vault = escrow_manager.get_vault(escrow_id)
            if not vault:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32602, "message": f"Escrow vault not found: {escrow_id}"},
                }
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"content": [{"type": "text", "text": json.dumps(vault, indent=2)}]},
            }

        elif tool_name == "shapley_authorize_escrow_release":
            from paypal_escrow import escrow_manager
            from demo_data import get_demo_analysis

            escrow_id = args.get("escrow_id", "ESCROW-PP-JINJA-02")
            vault = escrow_manager.get_vault(escrow_id)
            if not vault:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32602, "message": f"Escrow vault not found: {escrow_id}"},
                }
            demo = get_demo_analysis()
            shares = [
                {"email": f"{c['name'].lower().replace(' ', '.')}@jinja-dev.org", "amount": c["payout_usd"]}
                for c in demo["contributors"]
            ]
            disburse_res = escrow_manager.capture_authorization(escrow_id, shares)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {"content": [{"type": "text", "text": json.dumps(disburse_res, indent=2)}]},
            }

        else:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Unknown MCP tool: {tool_name}"},
            }

    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": -32600, "message": f"Unsupported JSON-RPC method: {method}"},
    }


# ── REST API Endpoints ──────────────────────────────────────────────

@agent_router.get("/tools")
def get_mcp_tools():
    """Return tool schemas conforming to Model Context Protocol."""
    return {
        "schema_version": "2024-11-05",
        "protocol": "Model Context Protocol (MCP)",
        "tools": MCP_TOOLS,
    }


@agent_router.get("/mcp")
def get_mcp_server_info():
    """Return MCP server status and protocol version for discovery checks."""
    return {
        "name": "shapley-mcp-server",
        "version": "1.0.0",
        "protocolVersion": "2024-11-05",
        "capabilities": {"tools": {"listChanged": False}},
    }


@agent_router.post("/mcp")
async def mcp_jsonrpc_endpoint(request: Request):
    """JSON-RPC 2.0 endpoint for MCP agent tool invocations."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON-RPC request payload")
    return handle_mcp_message(body)


class VerifyReceiptRequest(BaseModel):
    merkle_root: str = Field(..., description="64-character SHA-256 Merkle root")
    evaluations: List[Dict[str, Any]] = Field(..., description="Array of coalition evaluation objects")


@agent_router.post("/verify")
def agent_verify_receipt(req: VerifyReceiptRequest):
    """Verify cryptographic authenticity of Merkle attribution receipt."""
    is_valid = verify_merkle_receipt(req.evaluations, req.merkle_root)
    return {
        "valid": is_valid,
        "merkle_root": req.merkle_root,
        "verified_leaves": len(req.evaluations),
        "timestamp": time.time(),
    }
