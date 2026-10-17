#!/usr/bin/env python3
"""Validation: MCP Chat App Integration (Slack & Discord).

Tests:
1. `shapley_get_chat_webhook` returns valid Slack Block Kit format with header and action buttons.
2. `shapley_get_chat_webhook` returns valid Discord Rich Embed format with inline fields.
3. `shapley_get_project_standings` returns structured milestone standings.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent_tool import handle_mcp_message


def test_mcp_chat_slack_format():
    """Verify Slack Block Kit format generated via MCP message."""
    req = {
        "jsonrpc": "2.0",
        "id": "test-slack-1",
        "method": "tools/call",
        "params": {
            "name": "shapley_get_chat_webhook",
            "arguments": {
                "platform": "slack",
                "repo_url": "pallets/jinja",
                "phase_id": "phase2"
            }
        }
    }
    res = handle_mcp_message(req)
    assert res.get("id") == "test-slack-1"
    content = res["result"]["content"][0]["text"]
    import json
    data = json.loads(content)
    assert "blocks" in data
    types = [b["type"] for b in data["blocks"]]
    assert "header" in types
    assert "section" in types
    assert "actions" in types


def test_mcp_chat_discord_format():
    """Verify Discord Embed format generated via MCP message."""
    req = {
        "jsonrpc": "2.0",
        "id": "test-discord-1",
        "method": "tools/call",
        "params": {
            "name": "shapley_get_chat_webhook",
            "arguments": {
                "platform": "discord",
                "repo_url": "pallets/jinja",
                "phase_id": "phase2"
            }
        }
    }
    res = handle_mcp_message(req)
    content = res["result"]["content"][0]["text"]
    import json
    data = json.loads(content)
    assert "embeds" in data
    assert len(data["embeds"]) == 1
    assert "fields" in data["embeds"][0]
    assert data["embeds"][0]["title"].startswith("⚖️ Shapley Attribution Update")


def test_mcp_project_standings():
    """Verify shapley_get_project_standings returns phase 2 milestone details."""
    req = {
        "jsonrpc": "2.0",
        "id": "test-standings-1",
        "method": "tools/call",
        "params": {
            "name": "shapley_get_project_standings",
            "arguments": {
                "repo_url": "pallets/jinja",
                "phase_id": "phase2"
            }
        }
    }
    res = handle_mcp_message(req)
    content = res["result"]["content"][0]["text"]
    import json
    data = json.loads(content)
    assert data["phase_id"] == "phase2"
    assert data["pool_usd"] == 2500.0
    assert "Sara Ahmed" in data["shares_pct"]
    assert data["status"] == "ACTIVE"


def test_mcp_chat_telegram_format():
    """Verify Telegram Bot format generated via MCP message."""
    req = {
        "jsonrpc": "2.0",
        "id": "test-telegram-1",
        "method": "tools/call",
        "params": {
            "name": "shapley_get_chat_webhook",
            "arguments": {
                "platform": "telegram",
                "repo_url": "pallets/jinja",
                "phase_id": "phase2"
            }
        }
    }
    res = handle_mcp_message(req)
    assert res.get("id") == "test-telegram-1"
    content = res["result"]["content"][0]["text"]
    import json
    data = json.loads(content)
    assert data["parse_mode"] == "HTML"
    assert "chat_id" in data
    assert "<b>⚖️ Shapley Milestone Update:" in data["text"]
    assert "Sara Ahmed" in data["text"]
    assert "reply_markup" in data
    assert "inline_keyboard" in data["reply_markup"]
    assert len(data["reply_markup"]["inline_keyboard"][0]) >= 2


def test_mcp_chat_whatsapp_format():
    """Verify WhatsApp Cloud API interactive button format generated via MCP message."""
    req = {
        "jsonrpc": "2.0",
        "id": "test-whatsapp-1",
        "method": "tools/call",
        "params": {
            "name": "shapley_get_chat_webhook",
            "arguments": {
                "platform": "whatsapp",
                "repo_url": "pallets/jinja",
                "phase_id": "phase2"
            }
        }
    }
    res = handle_mcp_message(req)
    assert res.get("id") == "test-whatsapp-1"
    content = res["result"]["content"][0]["text"]
    import json
    data = json.loads(content)
    assert data["messaging_product"] == "whatsapp"
    assert data["type"] == "interactive"
    assert data["interactive"]["type"] == "button"
    assert "buttons" in data["interactive"]["action"]
    btn_ids = [b["reply"]["id"] for b in data["interactive"]["action"]["buttons"]]
    assert "btn_approve_payout" in btn_ids
    assert "Sara Ahmed" in data["interactive"]["body"]["text"]


if __name__ == "__main__":
    test_mcp_chat_slack_format()
    print("PASS: test_mcp_chat_slack_format")
    test_mcp_chat_discord_format()
    print("PASS: test_mcp_chat_discord_format")
    test_mcp_chat_telegram_format()
    print("PASS: test_mcp_chat_telegram_format")
    test_mcp_chat_whatsapp_format()
    print("PASS: test_mcp_chat_whatsapp_format")
    test_mcp_project_standings()
    print("PASS: test_mcp_project_standings")
    print("\nALL MCP CHAT INTEGRATION TESTS PASSED (5/5)")

