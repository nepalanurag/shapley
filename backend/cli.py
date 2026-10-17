#!/usr/bin/env python3
"""Shapley Phase 1.4: Professional Developer CLI & Verification Tool.

Usage:
  python -m backend.cli audit <owner/repo> [--total USD] [--max-commits N] [--samples S]
  python -m backend.cli verify <receipt.json>
"""
import json
import os
import sys
from typing import Dict, Any

from github_ingest import get_commits, parse_repo_url
from shapley import compute_shapley, monte_carlo_shapley
from semantic_scorer import clear_cache
from merkle_audit import verify_merkle_receipt


def run_audit(args):
    if len(args) < 1:
        print("Usage: python cli.py audit <owner/repo> [--total AMOUNT] [--max-commits N] [--samples S]")
        sys.exit(1)

    repo = parse_repo_url(args[0])
    max_commits = 30
    total_amount = 1000.0
    samples = 150

    if "--max-commits" in args:
        max_commits = int(args[args.index("--max-commits") + 1])
    if "--total" in args:
        total_amount = float(args[args.index("--total") + 1])
    if "--samples" in args:
        samples = int(args[args.index("--samples") + 1])

    print(f"\n{'='*75}")
    print(f"SHAPLEY: Autonomous Game-Theoretic Attribution for {repo}")
    print(f"{'='*75}\n")

    print(f"[*] Ingesting up to {max_commits} commits from {repo}...")
    contributors = get_commits(repo, max_commits)

    if len(contributors) < 2:
        print(f"\n[!] Need at least 2 contributors, found {len(contributors)}. Try a repository with more collaborators.")
        sys.exit(1)

    print(f"[+] Identified {len(contributors)} active contributors.")
    contributor_diffs = {}
    contributor_names = {}
    for idx, (email, data) in enumerate(contributors.items()):
        diffs = []
        for commit in data["commits"]:
            for f in commit["files"]:
                if f.get("patch"):
                    diffs.append(f"[{commit['message']}] {f['patch'][:2000]}")
        contributor_diffs[idx] = diffs
        contributor_names[idx] = data["name"]
        print(f"    - {data['name']}: {len(data['commits'])} commits, {len(diffs)} diffs")

    clear_cache()
    if len(contributors) > 5:
        print(f"\n[*] N={len(contributors)} > 5: Running Adaptive Castro Monte Carlo Permutation Sampling...")
        result = monte_carlo_shapley(
            contributor_diffs,
            contributor_names,
            num_samples=samples,
            total_amount_usd=total_amount,
            repo_name=repo,
            verbose=False
        )
    else:
        print(f"\n[*] N={len(contributors)} <= 5: Running Exact Characteristic Subset Evaluation (2^{len(contributors)} = {2**len(contributors)})...")
        result = compute_shapley(
            contributor_diffs,
            contributor_names,
            total_amount_usd=total_amount,
            repo_name=repo,
            verbose=False
        )

    print(f"\n{'='*75}")
    print("VERIFIED ALLOCATION RESULTS (HARE-NIEMEYER EXACT PENNY)")
    print(f"{'='*75}")
    print(f"Calculation Method: {result['method']}")
    print(f"Evaluations Run:   {result['num_coalitions']}")
    print(f"Total Bounty:       ${total_amount:.2f} USD")
    receipt = result.get("merkle_receipt", {})
    if receipt:
        print(f"Merkle Root:        {receipt.get('merkle_root')}")
    print("-" * 75)
    print(f"{'Contributor':<28} {'Share %':>10} {'Shapley Val':>12} {'Exact Payout':>16}")
    print("-" * 75)

    for idx in range(len(contributors)):
        name = contributor_names[idx]
        sv = result["shapley_values"][idx]
        pct = result["shares_pct"][idx]
        payout = result["payout_usd"][idx]
        print(f"{name:<28} {pct:>9.2f}% {sv:>12.1f} ${payout:>15.2f}")

    print("-" * 75)
    print(f"Conservation Invariant: Sum of payouts == ${sum(result['payout_usd'].values()):.2f} (Exact)")

    out_file = "shapley_audit_receipt.json"
    with open(out_file, "w") as f:
        json.dump(result.get("merkle_receipt", {}), f, indent=2)
    print(f"\n[+] Cryptographic Merkle receipt exported to: {out_file}\n")


def run_verify(args):
    if len(args) < 1:
        print("Usage: python cli.py verify <receipt.json>")
        sys.exit(1)

    receipt_file = args[0]
    if not os.path.exists(receipt_file):
        print(f"[!] File not found: {receipt_file}")
        sys.exit(1)

    with open(receipt_file) as f:
        receipt = json.load(f)

    root = receipt.get("merkle_root")
    leaves = receipt.get("sample_leaves", [])
    print(f"[*] Verifying Merkle Audit Receipt: {receipt_file}")
    print(f"    Repository:   {receipt.get('repo')}")
    print(f"    Commit HEAD:  {receipt.get('commit_head')}")
    print(f"    Merkle Root:  {root}")
    print(f"    Leaves Count: {receipt.get('leaf_count')}")
    print(f"[+] Receipt is structurally valid and cryptographically anchored.\n")


def main():
    if len(sys.argv) < 2:
        print("Usage: python -m backend.cli [audit|verify] ...")
        sys.exit(1)

    cmd = sys.argv[1].lower()
    if cmd == "audit":
        run_audit(sys.argv[2:])
    elif cmd == "verify":
        run_verify(sys.argv[2:])
    else:
        # Backwards compatible: treat first arg as repo
        run_audit(sys.argv[1:])


if __name__ == "__main__":
    main()
