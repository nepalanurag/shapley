#!/usr/bin/env python3
"""Validation: AI Co-Authorship & Human Pilot Disambiguation Suite.

Tests:
1. `Co-authored-by: Claude <noreply@anthropic.com>` allocates payout to verified Human Pilot.
2. AI assist ratio is appropriately calculated based on human unit tests and GPG signatures.
3. Unattended autonomous bots (Dependabot) are quarantined to project infrastructure reserve.
4. Pure human commits retain 100% human provenance.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_attribution import disambiguate_commit_attribution


def test_claude_coauthorship_disambiguation():
    """Verify commits with Co-authored-by: Claude credit the human pilot."""
    msg = """feat(tests): add e2e test fixtures for async parser

Co-authored-by: Claude <noreply@anthropic.com>
"""
    info = disambiguate_commit_attribution(
        author_name="David Park",
        author_email="dpark.qa@corp.net",
        commit_message=msg,
        tests_added=15,
        gpg_verified=True
    )
    assert info.ai_agent_detected is True
    assert "Claude" in info.ai_model_name
    assert info.payout_recipient == "David Park"
    assert info.provenance_classification == "HUMAN_PILOT_AI_ASSISTED"
    assert info.ai_assist_ratio_pct == 40.0  # Heavy human tests + GPG verified


def test_autonomous_bot_quarantine():
    """Verify autonomous bot commits (Dependabot) do not receive human payouts."""
    msg = "chore(deps): bump urllib3 from 1.26.5 to 1.26.18"
    info = disambiguate_commit_attribution(
        author_name="dependabot[bot]",
        author_email="49699333+dependabot[bot]@users.noreply.github.com",
        commit_message=msg,
        tests_added=0,
        gpg_verified=False
    )
    assert info.ai_agent_detected is True
    assert info.provenance_classification == "AUTONOMOUS_BOT"
    assert info.payout_recipient == "Project Infrastructure Reserve"


def test_pure_human_provenance():
    """Verify human commits without AI trailers retain 100% pure human classification."""
    msg = "fix(security): resolve use-after-free pointer corruption in parser buffer"
    info = disambiguate_commit_attribution(
        author_name="Sara Ahmed",
        author_email="sara.sec@gmail.com",
        commit_message=msg,
        tests_added=6,
        gpg_verified=True
    )
    assert info.ai_agent_detected is False
    assert info.ai_assist_ratio_pct == 0.0
    assert info.provenance_classification == "PURE_HUMAN"
    assert info.payout_recipient == "Sara Ahmed"


if __name__ == "__main__":
    test_claude_coauthorship_disambiguation()
    print("PASS: test_claude_coauthorship_disambiguation")
    test_autonomous_bot_quarantine()
    print("PASS: test_autonomous_bot_quarantine")
    test_pure_human_provenance()
    print("PASS: test_pure_human_provenance")
    print("\nALL AI ATTRIBUTION TESTS PASSED (3/3)")
