#!/usr/bin/env python3
"""Validation: Merkle Audit Trail & Cryptographic Verification Suite.

Tests:
  1. Deterministic Root Generation.
  2. Proof Verification: authentic receipt passes.
  3. Tampering Detection: score modification invalidates root.
  4. Coalition Mutation Detection: member list modification invalidates root.
"""
import copy
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from merkle_audit import MerkleTree, build_audit_receipt, verify_merkle_receipt


def test_merkle_tree_reproducibility():
    """Merkle tree over identical leaves produces identical root."""
    leaves = ["leaf1", "leaf2", "leaf3", "leaf4"]
    t1 = MerkleTree(leaves)
    t2 = MerkleTree(leaves)
    assert t1.root == t2.root
    assert len(t1.root) == 64  # SHA-256 hex string


def test_audit_receipt_verification_pass():
    """Authentic evaluations produce a verified receipt."""
    evals = [
        {"coalition": [0], "score": 40.0, "confidence": 0.95},
        {"coalition": [1], "score": 25.0, "confidence": 0.90},
        {"coalition": [0, 1], "score": 75.0, "confidence": 0.92},
    ]
    receipt = build_audit_receipt(
        repo="pallets/jinja",
        commit_head="a1b2c3d",
        evaluations=evals,
        shares_pct={0: 55.0, 1: 45.0},
        total_amount_usd=1000.0
    )
    expected_root = receipt["merkle_root"]
    assert verify_merkle_receipt(evals, expected_root) is True


def test_audit_receipt_tamper_score_fails():
    """Modifying a single coalition score by 0.1 fails cryptographic verification."""
    evals = [
        {"coalition": [0], "score": 40.0, "confidence": 0.95},
        {"coalition": [1], "score": 25.0, "confidence": 0.90},
        {"coalition": [0, 1], "score": 75.0, "confidence": 0.92},
    ]
    receipt = build_audit_receipt(
        repo="pallets/jinja",
        commit_head="a1b2c3d",
        evaluations=evals,
        shares_pct={0: 55.0, 1: 45.0},
        total_amount_usd=1000.0
    )
    expected_root = receipt["merkle_root"]

    tampered_evals = copy.deepcopy(evals)
    # Alter score slightly
    tampered_evals[0]["score"] = 40.0001
    assert verify_merkle_receipt(tampered_evals, expected_root) is False


def test_audit_receipt_tamper_member_fails():
    """Altering member index in coalition fails verification."""
    evals = [
        {"coalition": [0], "score": 40.0, "confidence": 0.95},
        {"coalition": [1], "score": 25.0, "confidence": 0.90},
    ]
    receipt = build_audit_receipt(
        repo="pallets/jinja",
        commit_head="a1b2c3d",
        evaluations=evals,
        shares_pct={0: 60.0, 1: 40.0},
        total_amount_usd=100.0
    )
    expected_root = receipt["merkle_root"]

    tampered_evals = copy.deepcopy(evals)
    tampered_evals[1]["coalition"] = [2]
    assert verify_merkle_receipt(tampered_evals, expected_root) is False


if __name__ == "__main__":
    test_merkle_tree_reproducibility()
    print("PASS: test_merkle_tree_reproducibility")
    test_audit_receipt_verification_pass()
    print("PASS: test_audit_receipt_verification_pass")
    test_audit_receipt_tamper_score_fails()
    print("PASS: test_audit_receipt_tamper_score_fails")
    test_audit_receipt_tamper_member_fails()
    print("PASS: test_audit_receipt_tamper_member_fails")
    print("\nALL MERKLE AUDIT TESTS PASSED (4/4)")
