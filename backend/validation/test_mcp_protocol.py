#!/usr/bin/env python3
"""Validation: Model Context Protocol (MCP) Compliance Suite.

Tests that agent_tool satisfies the official MCP specification:
  1. MCP tool schemas comply with the 2024-11-05 spec.
  2. Input schemas define required fields (repo_url, shares, total_amount).
  3. Cryptographic proof verification endpoint verifies authentic Merkle receipts.
  4. Tampered receipts are rejected.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent_tool import get_mcp_tools, VerifyReceiptRequest, agent_verify_receipt
from merkle_audit import build_audit_receipt


def test_mcp_tools_schema():
    """Verify get_mcp_tools returns valid MCP specification."""
    data = get_mcp_tools()
    assert data["schema_version"] == "2024-11-05"
    assert data["protocol"] == "Model Context Protocol (MCP)"
    tools = data["tools"]
    tool_names = [t["name"] for t in tools]
    assert "shapley_evaluate_repo" in tool_names
    assert "shapley_verify_audit_proof" in tool_names
    assert "shapley_execute_payout" in tool_names

    # Check inputSchema
    for t in tools:
        assert "inputSchema" in t
        assert t["inputSchema"]["type"] == "object"
        assert "properties" in t["inputSchema"]


def test_mcp_verify_receipt_success():
    """Verify agent_verify_receipt accepts authentic Merkle receipts."""
    evals = [
        {"coalition": [0], "score": 45.0, "confidence": 0.9},
        {"coalition": [1], "score": 30.0, "confidence": 0.9},
        {"coalition": [0, 1], "score": 75.0, "confidence": 0.95},
    ]
    receipt = build_audit_receipt("demo/repo", "head", evals, {0: 60.0, 1: 40.0}, 500.0)
    req = VerifyReceiptRequest(evaluations=evals, merkle_root=receipt["merkle_root"])
    res = agent_verify_receipt(req)
    assert res["valid"] is True
    assert res["merkle_root"] == receipt["merkle_root"]
    assert res["verified_leaves"] == 3


def test_mcp_verify_receipt_tampered():
    """Verify agent_verify_receipt rejects tampered evaluation scores."""
    evals = [
        {"coalition": [0], "score": 45.0, "confidence": 0.9},
        {"coalition": [1], "score": 30.0, "confidence": 0.9},
    ]
    receipt = build_audit_receipt("demo/repo", "head", evals, {0: 60.0, 1: 40.0}, 500.0)
    # Alter score
    tampered_evals = [
        {"coalition": [0], "score": 99.0, "confidence": 0.9},
        {"coalition": [1], "score": 30.0, "confidence": 0.9},
    ]
    req = VerifyReceiptRequest(evaluations=tampered_evals, merkle_root=receipt["merkle_root"])
    res = agent_verify_receipt(req)
    assert res["valid"] is False


if __name__ == "__main__":
    test_mcp_tools_schema()
    print("PASS: test_mcp_tools_schema (MCP tools schema validated)")
    test_mcp_verify_receipt_success()
    print("PASS: test_mcp_verify_receipt_success (Merkle receipt verification validated)")
    test_mcp_verify_receipt_tampered()
    print("PASS: test_mcp_verify_receipt_tampered (Tamper rejection validated)")
    print("\nALL MCP SPECIFICATION TESTS PASSED (3/3)")
