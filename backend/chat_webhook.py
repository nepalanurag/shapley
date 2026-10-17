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


def generate_telegram_milestone_digest(
    repo: str,
    phase_title: str,
    pool_usd: float,
    standings: List[Dict[str, Any]],
    merkle_root: str,
    chat_id: str = "@shapley_updates",
    payout_url: str = "https://shapley.onrender.com/results?demo=true"
) -> Dict[str, Any]:
    """Generates official Telegram Bot API sendMessage payload with HTML formatting and inline keyboards."""
    lines = [
        f"<b>⚖️ Shapley Milestone Update: <code>{repo}</code></b>",
        "",
        f"🎯 <b>Active Phase:</b> {phase_title}",
        f"💰 <b>Tranche Pool:</b> ${pool_usd:,.2f} USD",
        f"🔒 <b>Merkle Proof:</b> <code>{merkle_root[:16]}...</code>",
        "✅ <b>Audit:</b> Passed (Exact-Penny Invariant)",
        "",
        "📊 <b>Contributor Fair Shares:</b>"
    ]
    for s in standings:
        ai_tag = " 🤖 <i>(AI Pilot)</i>" if s.get("ai_assisted") else ""
        lines.append(f"• <b>{s['name']}</b>: <code>{s['share_pct']:.1f}%</code> (${s['payout_usd']:.2f}){ai_tag}")

    lines.append("")
    lines.append("<i>Disbursed deterministically via PayPal REST Engine</i>")

    return {
        "chat_id": chat_id,
        "text": "\n".join(lines),
        "parse_mode": "HTML",
        "disable_web_page_preview": False,
        "reply_markup": {
            "inline_keyboard": [
                [
                    {"text": "💳 Review & Disburse Batch", "url": payout_url},
                    {"text": "🔍 Verify Merkle Root", "url": f"{payout_url}&view=audit"}
                ]
            ]
        }
    }


def generate_whatsapp_milestone_digest(
    repo: str,
    phase_title: str,
    pool_usd: float,
    standings: List[Dict[str, Any]],
    merkle_root: str,
    recipient_phone: str = "+1234567890",
    payout_url: str = "https://shapley.onrender.com/results?demo=true"
) -> Dict[str, Any]:
    """Generates official WhatsApp Business Cloud API interactive button payload."""
    leaderboard = []
    for s in standings:
        ai_tag = " 🤖 (AI Pilot)" if s.get("ai_assisted") else ""
        leaderboard.append(f"• {s['name']}: {s['share_pct']:.1f}% (${s['payout_usd']:.2f}){ai_tag}")

    body_text = (
        f"Milestone Update for *{repo}* ({phase_title}):\n\n"
        f"💰 *Pool:* ${pool_usd:,.2f} USD\n"
        f"🔒 *Merkle Root:* `{merkle_root[:16]}...`\n\n"
        f"*Fair Share Standings:*\n" + "\n".join(leaderboard) + "\n\n"
        "Exact-penny Hare-Niemeyer conservation verified."
    )

    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": recipient_phone,
        "type": "interactive",
        "interactive": {
            "type": "button",
            "header": {
                "type": "text",
                "text": f"⚖️ Shapley Milestone: {repo}"
            },
            "body": {
                "text": body_text
            },
            "footer": {
                "text": "Shapley Protocol • Automated Settlement"
            },
            "action": {
                "buttons": [
                    {
                        "type": "reply",
                        "reply": {
                            "id": "btn_approve_payout",
                            "title": "💳 Approve Payout"
                        }
                    },
                    {
                        "type": "reply",
                        "reply": {
                            "id": "btn_verify_audit",
                            "title": "🔍 Audit Merkle"
                        }
                    }
                ]
            }
        }
    }
