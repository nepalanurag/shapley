#!/usr/bin/env python3
"""Validation: PayPal Multi-Stakeholder Escrow Invariants.

Tests:
1. Escrow creation binds Sponsor funds under PayPal delayed authorization hold.
2. Dual-stakeholder quorum sign-off (Sponsor deposit + Maintainer AST validation).
3. Exact-Penny conservation from Escrow Vault to contributor disbursements ($0.00 leak).
4. 48-Hour Dispute Challenge Window halts disbursement upon contention.
5. Invariant integrity of pre-configured demo vault (ESCROW-PP-JINJA-02).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from paypal_escrow import PayPalEscrowManager


def test_escrow_creation_and_authorization_hold():
    """Verify escrow initialization binds funds under PayPal custody."""
    mgr = PayPalEscrowManager()
    vault = mgr.create_escrow_vault(
        repo_url="fastapi/fastapi",
        phase_id="phase1",
        pool_usd=1000.00,
        sponsor_email="sponsor@tiangolo-fund.org",
        sponsor_name="Tiangolo Foundation",
        maintainer_email="maintainer@fastapi.tiangolo.com",
        maintainer_name="FastAPI Maintainers",
        merkle_root="f0a1b2c3d4e5f6...",
        challenge_window_hours=48
    )

    assert vault.status == "HELD_IN_ESCROW"
    assert vault.pool_cents == 100000
    assert vault.pool_usd == 1000.00
    assert vault.authorization_id.startswith("AUTH-PP-")
    assert vault.stakeholders["sponsor"].approved is True
    assert vault.stakeholders["maintainer"].approved is False


def test_stakeholder_dual_quorum_approval():
    """Verify Maintainer approval satisfies dual quorum."""
    mgr = PayPalEscrowManager()
    vault = mgr.create_escrow_vault(
        repo_url="astral-sh/uv",
        phase_id="phase1",
        pool_usd=2000.00,
        sponsor_email="sponsor@astral.sh",
        sponsor_name="Astral Funder",
        maintainer_email="charlie@astral.sh",
        maintainer_name="Charlie Marsh",
        merkle_root="a1b2c3d4..."
    )

    assert vault.status == "HELD_IN_ESCROW"
    vault = mgr.submit_maintainer_approval(vault.escrow_id, "charlie@astral.sh")
    assert vault.status == "QUORUM_APPROVED"
    assert vault.stakeholders["maintainer"].approved is True
    assert vault.stakeholders["maintainer"].signature_hash is not None


def test_exact_penny_release():
    """Verify exact penny release and failure on penny leakage."""
    mgr = PayPalEscrowManager()
    vault = mgr.create_escrow_vault(
        repo_url="encode/httpx",
        phase_id="phase1",
        pool_usd=100.00,
        sponsor_email="sponsor@encode.io",
        sponsor_name="Encode Funder",
        maintainer_email="tom@encode.io",
        maintainer_name="Tom Christie",
        merkle_root="e5f6..."
    )
    mgr.submit_maintainer_approval(vault.escrow_id, "tom@encode.io")

    # Attempt release with penny leakage (sum = 99.99 instead of 100.00)
    leak_shares = [
        {"email": "dev1@encode.io", "amount": 60.00},
        {"email": "dev2@encode.io", "amount": 39.99}
    ]
    try:
        mgr.release_escrow(vault.escrow_id, leak_shares)
        assert False, "Should have rejected penny leakage"
    except ValueError as e:
        assert "Disbursement mismatch" in str(e)

    # Valid exact penny release (sum = 100.00)
    valid_shares = [
        {"email": "dev1@encode.io", "amount": 60.00},
        {"email": "dev2@encode.io", "amount": 40.00}
    ]
    result = mgr.release_escrow(vault.escrow_id, valid_shares)
    assert result["status"] == "RELEASED"
    assert result["disbursed_pool_usd"] == 100.00
    assert result["paypal_fee_usd"] == 0.50  # 2 * 0.25


def test_dispute_challenge_lock():
    """Verify filing a dispute during challenge window freezes release."""
    mgr = PayPalEscrowManager()
    vault = mgr.create_escrow_vault(
        repo_url="tiangolo/sqlmodel",
        phase_id="phase1",
        pool_usd=500.00,
        sponsor_email="sponsor@sqlmodel.org",
        sponsor_name="Sponsor",
        maintainer_email="maint@sqlmodel.org",
        maintainer_name="Maintainer",
        merkle_root="99aa..."
    )
    mgr.submit_maintainer_approval(vault.escrow_id, "maint@sqlmodel.org")
    mgr.file_dispute(vault.escrow_id, "dev_challenger@sqlmodel.org", "Attribution calculation excludes PR #42")

    assert vault.status == "DISPUTED"
    assert vault.disputed is True

    valid_shares = [{"email": "dev1@sqlmodel.org", "amount": 500.00}]
    try:
        mgr.release_escrow(vault.escrow_id, valid_shares)
        assert False, "Should have blocked release under dispute"
    except ValueError as e:
        assert "locked under dispute" in str(e)


def test_default_demo_vault_jinja_phase2():
    """Verify demo vault ESCROW-PP-JINJA-02 has correct invariants."""
    mgr = PayPalEscrowManager()
    vault = mgr.get_vault("ESCROW-PP-JINJA-02")
    assert vault is not None
    assert vault.pool_usd == 2500.00
    assert vault.stakeholders["sponsor"].approved is True
    assert vault.stakeholders["maintainer"].approved is True
    assert vault.custodian == "PayPal Inc. (Delayed Disbursement Custody)"


if __name__ == "__main__":
    test_escrow_creation_and_authorization_hold()
    print("PASS: test_escrow_creation_and_authorization_hold")
    test_stakeholder_dual_quorum_approval()
    print("PASS: test_stakeholder_dual_quorum_approval")
    test_exact_penny_release()
    print("PASS: test_exact_penny_release")
    test_dispute_challenge_lock()
    print("PASS: test_dispute_challenge_lock")
    test_default_demo_vault_jinja_phase2()
    print("PASS: test_default_demo_vault_jinja_phase2")
    print("\nALL PAYPAL ESCROW INVARIANT TESTS PASSED (5/5)")
