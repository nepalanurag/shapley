#!/usr/bin/env python3
"""Shapley Phase 1.4: CLI end-to-end demo.

Usage: python cli.py <owner/repo> [--max-commits N] [--total AMOUNT]
"""
import json
import sys
from github_ingest import get_commits, parse_repo_url
from shapley import compute_shapley
from semantic_scorer import clear_cache


def main():
    if len(sys.argv) < 2:
        print("Usage: python cli.py <owner/repo> [--max-commits N] [--total AMOUNT]")
        sys.exit(1)

    repo = parse_repo_url(sys.argv[1])
    max_commits = 30
    total_amount = 100.0

    if "--max-commits" in sys.argv:
        max_commits = int(sys.argv[sys.argv.index("--max-commits") + 1])
    if "--total" in sys.argv:
        total_amount = float(sys.argv[sys.argv.index("--total") + 1])

    print(f"\n{'='*70}")
    print(f"SHAPLEY: Fair revenue splits for {repo}")
    print(f"{'='*70}\n")

    # Step 1: Ingest
    print("Step 1: Ingesting commits...")
    contributors = get_commits(repo, max_commits)

    if len(contributors) < 2:
        print(f"\nNeed at least 2 contributors, found {len(contributors)}. "
              "Try a repo with more collaborators.")
        sys.exit(1)
    if len(contributors) > 5:
        print(f"\nWarning: {len(contributors)} contributors found. "
              f"Using top 5 by commit count for demo.")
        sorted_c = sorted(contributors.items(),
                          key=lambda x: len(x[1]["commits"]), reverse=True)
        contributors = dict(sorted_c[:5])

    # Step 2: Build diff map
    print(f"\nStep 2: Building coalition data for {len(contributors)} contributors...")
    contributor_diffs = {}
    contributor_names = {}
    for idx, (email, data) in enumerate(contributors.items()):
        diffs = []
        for commit in data["commits"]:
            for f in commit["files"]:
                if f["patch"]:
                    diffs.append(f"[{commit['message']}] {f['patch'][:2000]}")
        contributor_diffs[idx] = diffs
        contributor_names[idx] = data["name"]
        print(f"  {data['name']}: {len(data['commits'])} commits, "
              f"{len(diffs)} diffs")

    # Step 3: Compute Shapley
    print(f"\nStep 3: Computing Shapley values "
          f"({2**len(contributors)} coalitions)...")
    clear_cache()
    result = compute_shapley(contributor_diffs, contributor_names, verbose=True)

    # Step 4: Display results
    print(f"\n{'='*70}")
    print("RESULTS")
    print(f"{'='*70}")
    print(f"\nCoalitions evaluated: {result['num_coalitions']}")
    print(f"Gemini API calls: {result['api_calls']}")
    print(f"\n{'Contributor':<30} {'Shapley':>10} {'Share':>8} {'Payout':>10}")
    print("-" * 70)

    for idx in range(len(contributors)):
        name = contributor_names[idx]
        sv = result["shapley_values"][idx]
        pct = result["shares_pct"][idx]
        payout = total_amount * pct / 100
        print(f"{name:<30} {sv:>10.1f} {pct:>7.1f}% ${payout:>9.2f}")

    print(f"\nTotal: ${total_amount:.2f}")

    # Save for frontend
    output = {
        "repo": repo,
        "total_amount": total_amount,
        "contributors": [
            {
                "name": contributor_names[idx],
                "email": email,
                "shapley_value": result["shapley_values"][idx],
                "share_pct": result["shares_pct"][idx],
                "payout_usd": round(total_amount * result["shares_pct"][idx] / 100, 2),
                "commits": len(data["commits"]),
            }
            for idx, (email, data) in enumerate(contributors.items())
        ],
        "evaluations": result["evaluations"],
        "api_calls": result["api_calls"],
    }
    with open("/tmp/shapley_results.json", "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nResults saved to /tmp/shapley_results.json")


if __name__ == "__main__":
    main()
