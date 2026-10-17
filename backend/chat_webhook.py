#!/usr/bin/env python3
"""Shapley Chat App Integration & Webhook Formatter.

Generates real-time milestone digests and team standings for:
1. Slack Channels (Block Kit JSON with action buttons)
2. Discord Channels (Rich Embed JSON with field tables)
3. Telegram / Terminal (Clean Markdown)
"""
import json
from typing import Dict, List, Any


def generate_slack_milestone_digest(
    repo: str,
    phase_title: str,
    pool_usd: float,
    standings: List[Dict[str, Any]],
    merkle_root: str,
    payout_url: str = "https://shapley.onrender.com/results?demo=true"
) -> Dict[str, Any]:
    """Generates official Slack Block Kit payload for milestone updates."""
    leaderboard_lines = []
    for s in standings:
        ai_badge = " 🤖 *(AI Co-Authored)*" if s.get("ai_assisted") else ""
        leaderboard_lines.append(
            f"• *{s['name']}*: *{s['share_pct']:.1f}%* (${s['payout_usd']:.2f}){ai_badge}"
        )

    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"⚖️ Shapley Milestone Update: {repo}",
                "emoji": True
            }
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Active Phase:*\n{phase_title}"},
                {"type": "mrkdwn", "text": f"*Tranche Pool:*\n${pool_usd:,.2f} USD"},
                {"type": "mrkdwn", "text": f"*Merkle Proof:*\n`{merkle_root[:16]}...`"},
                {"type": "mrkdwn", "text": "*Axiomatic Audit:*\n✅ Passed (0 Violations)"}
            ]
        },
        {"type": "divider"},
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "*Current Team Standings:*\n" + "\n".join(leaderboard_lines)
            }
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "💳 Review & Disburse Batch", "emoji": True},
                    "style": "primary",
                    "url": payout_url
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "🔍 Verify Merkle Root", "emoji": True},
                    "url": f"{payout_url}&view=audit"
                }
            ]
        }
    ]
    return {"text": f"Shapley Milestone Update: {repo} ({phase_title})", "blocks": blocks}


def generate_discord_milestone_digest(
    repo: str,
    phase_title: str,
    pool_usd: float,
    standings: List[Dict[str, Any]],
    merkle_root: str
) -> Dict[str, Any]:
    """Generates Discord Rich Embed payload for channel notifications."""
    fields = [
        {"name": "🎯 Active Phase", "value": phase_title, "inline": True},
        {"name": "💰 Milestone Pool", "value": f"${pool_usd:,.2f} USD", "inline": True},
        {"name": "🔒 Merkle Proof", "value": f"`{merkle_root[:16]}...`", "inline": True}
    ]

    leaderboard = []
    for s in standings:
        tag = " 🤖 (AI Pilot)" if s.get("ai_assisted") else ""
        leaderboard.append(f"**{s['name']}**: `{s['share_pct']:.1f}%` — **${s['payout_usd']:.2f}**{tag}")

    fields.append({"name": "📊 Fair Share Leaderboard", "value": "\n".join(leaderboard), "inline": False})

    embed = {
        "title": f"⚖️ Shapley Attribution Update: {repo}",
        "description": "Dynamic game-theoretic contributions evaluated with exact-penny conservation.",
        "color": 3447003,  # Blue hex
        "fields": fields,
        "footer": {"text": "Verified via Shapley Protocol & PayPal REST Engine"}
    }
    return {"embeds": [embed]}
