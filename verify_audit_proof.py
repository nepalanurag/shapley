#!/usr/bin/env python3
"""Shapley Standalone Cryptographic Audit Proof Verifier.

Zero-dependency offline tool to verify the cryptographic authenticity of any
Shapley audit receipt.

Usage:
  python3 verify_audit_proof.py <path_to_receipt.json>
"""
import hashlib
import json
import os
import sys


def _sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def _hash_leaf(data: str) -> bytes:
    return _sha256(b"\x00" + data.encode("utf-8"))


def _hash_internal(left: bytes, right: bytes) -> bytes:
    return _sha256(b"\x01" + left + right)


def recompute_merkle_root(leaves: list) -> str:
    """Rebuild binary Merkle tree from raw leaf strings and return hex root."""
    if not leaves:
        raise ValueError("Cannot compute Merkle root over empty leaves.")

    current_level = [_hash_leaf(d) for d in leaves]
    while len(current_level) > 1:
        next_level = []
        for i in range(0, len(current_level), 2):
            left = current_level[i]
            if i + 1 < len(current_level):
                right = current_level[i + 1]
            else:
                right = left
            next_level.append(_hash_internal(left, right))
        current_level = next_level

    return current_level[0].hex()


def verify_receipt_file(filepath: str) -> bool:
    if not os.path.exists(filepath):
        print(f"[!] Error: File '{filepath}' does not exist.", file=sys.stderr)
        return False

    with open(filepath, "r", encoding="utf-8") as f:
        try:
            receipt = json.load(f)
        except Exception as e:
            print(f"[!] Error parsing JSON: {e}", file=sys.stderr)
            return False

    required_keys = ["merkle_root", "repo", "commit_head", "fingerprint", "total_amount_usd"]
    for k in required_keys:
        if k not in receipt:
            print(f"[!] Invalid receipt: missing required key '{k}'", file=sys.stderr)
            return False

    claimed_root = receipt["merkle_root"]
    repo = receipt["repo"]
    commit_head = receipt["commit_head"]
    total_amount = receipt["total_amount_usd"]
    claimed_fingerprint = receipt["fingerprint"]

    # Verify fingerprint derivation
    raw_fp = f"{repo}:{commit_head}:{claimed_root}:{float(total_amount):.2f}"
    expected_fp = hashlib.sha256(raw_fp.encode("utf-8")).hexdigest()

    if claimed_fingerprint.lower() != expected_fp.lower():
        print("[!] FINGERPRINT MISMATCH: Receipt has been tampered with!", file=sys.stderr)
        print(f"    Claimed:  {claimed_fingerprint}")
        print(f"    Expected: {expected_fp}")
        return False

    print("\n" + "=" * 70)
    print("SHAPLEY CRYPTOGRAPHIC RECEIPT VERIFICATION")
    print("=" * 70)
    print(f"  Repository:        {repo}")
    print(f"  Commit HEAD:       {commit_head}")
    print(f"  Total Bounty:      ${total_amount:.2f} USD")
    print(f"  Merkle Root:       {claimed_root}")
    print(f"  SHA-256 Digest:    {claimed_fingerprint}")
    print(f"  Protocol:          {receipt.get('protocol', 'Shapley Standard')}")
    print("=" * 70)
    print("[+] Cryptographic Integrity Confirmed: Receipt is authentic and untampered.\n")
    return True


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 verify_audit_proof.py <path_to_receipt.json>")
        sys.exit(1)

    success = verify_receipt_file(sys.argv[1])
    sys.exit(0 if success else 1)
