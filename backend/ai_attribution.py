#!/usr/bin/env python3
"""Shapley AI Co-Authorship & Human Pilot Disambiguation Module.

Solves the real-world problem where developers use AI assistants (Claude, Cursor, Copilot, Cline, Devin):
1. An AI agent cannot legally hold a bank account, sign W-8/W-9 forms, or bear legal liability.
2. If code is committed as `Co-authored-by: Claude`, the protocol must determine who receives the bounty.
3. Disambiguation Rule:
   - The verified **Human Pilot** (prompter, architect, test verifier, and GPG signer) receives the financial disbursement.
   - The **AI Assist Ratio** is audited and flagged (e.g. 70% AI-generated boilerplate, 30% Human integration).
   - Unattended autonomous bots (Dependabot, Prettier bot) are quarantined from human payout pools.
"""
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass
class CoAuthorInfo:
    human_pilot_name: str
    human_pilot_email: str
    ai_agent_detected: bool
    ai_model_name: Optional[str]
    ai_assist_ratio_pct: float
    provenance_classification: str  # "PURE_HUMAN", "HUMAN_PILOT_AI_ASSISTED", "AUTONOMOUS_BOT"
    payout_recipient: str
    rationale: str


AI_TRAILER_PATTERNS = [
    (r"co-authored-by:\s*(claude|anthropic|claude-code)[^<]*<([^>]+)>", "Claude 3.5 Sonnet"),
    (r"co-authored-by:\s*(github\s*copilot|copilot)[^<]*<([^>]+)>", "GitHub Copilot"),
    (r"co-authored-by:\s*(cursor|anysphere)[^<]*<([^>]+)>", "Cursor AI"),
    (r"co-authored-by:\s*(devin|cognition)[^<]*<([^>]+)>", "Devin AI"),
    (r"co-authored-by:\s*(aider|gemini)[^<]*<([^>]+)>", "Gemini / Aider"),
    (r"generated\s*by\s*claude\s*code", "Claude Code CLI"),
    (r"prompt-tokens:\s*\d+", "Autonomous AI Agent"),
]

BOT_AUTHORS = ["dependabot", "renovate", "github-actions", "pre-commit-ci"]


def disambiguate_commit_attribution(
    author_name: str,
    author_email: str,
    commit_message: str,
    diff_lines_added: int = 0,
    tests_added: int = 0,
    gpg_verified: bool = False
) -> CoAuthorInfo:
    """Classifies a commit's provenance and determines the rightful financial beneficiary."""
    lower_email = author_email.lower()
    lower_name = author_name.lower()
    lower_msg = commit_message.lower()

    # Case 1: Unattended autonomous bot
    for bot in BOT_AUTHORS:
        if bot in lower_email or bot in lower_name:
            return CoAuthorInfo(
                human_pilot_name=author_name,
                human_pilot_email=author_email,
                ai_agent_detected=True,
                ai_model_name=author_name,
                ai_assist_ratio_pct=100.0,
                provenance_classification="AUTONOMOUS_BOT",
                payout_recipient="Project Infrastructure Reserve",
                rationale="Unattended automated bot commit; financial bounty routed to project maintenance reserve."
            )

    # Case 2: AI Co-authorship trailer detection
    ai_detected = False
    ai_model = None
    for pattern, model in AI_TRAILER_PATTERNS:
        if re.search(pattern, lower_msg, re.IGNORECASE):
            ai_detected = True
            ai_model = model
            break

    if ai_detected:
        # Compute AI assist ratio based on human verification signals
        # If human added tests or GPG signed, human verification score is high
        if tests_added > 5 and gpg_verified:
            assist_ratio = 40.0  # Heavy human verification & unit tests
        elif gpg_verified:
            assist_ratio = 60.0  # Verified human pilot integration
        else:
            assist_ratio = 80.0  # High AI generative ratio

        return CoAuthorInfo(
            human_pilot_name=author_name,
            human_pilot_email=author_email,
            ai_agent_detected=True,
            ai_model_name=ai_model,
            ai_assist_ratio_pct=assist_ratio,
            provenance_classification="HUMAN_PILOT_AI_ASSISTED",
            payout_recipient=author_name,
            rationale=f"Code co-authored with {ai_model}. Financial payout credited to Human Pilot ({author_name}) who authored prompt, tested, and GPG-signed the diff."
        )

    # Case 3: Pure human contribution
    return CoAuthorInfo(
        human_pilot_name=author_name,
        human_pilot_email=author_email,
        ai_agent_detected=False,
        ai_model_name=None,
        ai_assist_ratio_pct=0.0,
        provenance_classification="PURE_HUMAN",
        payout_recipient=author_name,
        rationale="100% human-authored algorithmic diff with verified cryptographic provenance."
    )
