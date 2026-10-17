#!/usr/bin/env python3
"""Validation 4: Baseline bake-off.

On N real multi-contributor repos, compute payout splits four ways:
  1. AI Shapley (Gemini semantic scoring + exact Shapley)
  2. Lines changed (additions + deletions)
  3. Commit count
  4. Files touched

Report Spearman rank correlation between AI and each baseline.

Usage:
    python baseline_bakeoff.py --repos octocat/Hello-World,torvalds/linux \
        --max-commits 15 --output bakeoff_results.json
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from github_ingest import get_commits
from shapley import compute_shapley
from semantic_scorer import clear_cache


def spearman(x, y):
    """Spearman rank correlation. Returns None if undefined."""
    try:
        from scipy.stats import spearmanr
        r, _ = spearmanr(x, y)
        return None if r != r else float(r)  # NaN check
    except ImportError:
        # Manual implementation
        n = len(x)
        if n < 2:
            return None
        rx = _rank(x)
        ry = _rank(y)
        mean_rx = sum(rx) / n
        mean_ry = sum(ry) / n
        num = sum((a - mean_rx) * (b - mean_ry) for a, b in zip(rx, ry))
        den = (sum((a - mean_rx) ** 2 for a in rx) *
               sum((b - mean_ry) ** 2 for b in ry)) ** 0.5
        return num / den if den > 0 else None


def _rank(values):
    sorted_idx = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0] * len(values)
    for rank, idx in enumerate(sorted_idx):
        ranks[idx] = rank + 1
    return ranks


def compute_baselines(contributors):
    """contributors: {email: {name, commits: [{additions, deletions, files}]}}"""
    lines, commits, files = {}, {}, {}
    for email, data in contributors.items():
        lines[email] = sum(c["additions"] + c["deletions"]
                           for c in data["commits"])
        commits[email] = len(data["commits"])
        fset = set()
        for c in data["commits"]:
            for f in c.get("files", []):
                fset.add(f.get("filename", ""))
        files[email] = len(fset)
    return {"lines_changed": lines, "commit_count": commits,
            "files_touched": files}


def to_shares(values):
    total = sum(values.values())
    if total <= 0:
        n = len(values)
        return {k: 100.0 / n for k in values}
    return {k: v / total * 100 for k, v in values.items()}


def analyze_repo(repo, max_commits):
    print(f"\n{'='*60}\n  {repo}\n{'='*60}")
    contributors = get_commits(repo, max_commits)
    emails = list(contributors.keys())
    print(f"  Contributors: {len(emails)}")

    if len(emails) < 2:
        print("  SKIP: need >= 2 contributors")
        return None
    if len(emails) > 5:
        # Take top 5 by commit count for exact Shapley (finer than n=3)
        by_commits = sorted(emails, key=lambda e: len(contributors[e]["commits"]), reverse=True)
        emails = by_commits[:5]
        contributors = {e: contributors[e] for e in emails}
        print(f"  (capped to top 5 by commits)")

    # Baselines
    baselines = compute_baselines(contributors)
    baseline_shares = {k: to_shares(v) for k, v in baselines.items()}

    # AI Shapley
    contributor_diffs, contributor_names = {}, {}
    for idx, email in enumerate(emails):
        data = contributors[email]
        diffs = []
        for commit in data["commits"]:
            for f in commit.get("files", []):
                if f.get("patch"):
                    diffs.append(f"[{commit['message']}] {f['patch'][:2000]}")
        contributor_diffs[idx] = diffs
        contributor_names[idx] = data["name"]

    clear_cache()
    print(f"  Scoring {2**len(emails)} coalitions with Gemini...")
    result = compute_shapley(contributor_diffs, contributor_names)
    ai_shares = {emails[idx]: pct
                 for idx, pct in result["shares_pct"].items()}

    # Correlations (rank by email order for consistency)
    order = sorted(emails)
    ai_vals = [ai_shares[e] for e in order]
    corrs = {}
    for bname, bshares in baseline_shares.items():
        b_vals = [bshares[e] for e in order]
        r = spearman(ai_vals, b_vals)
        corrs[bname] = round(r, 3) if r is not None else None
        flag = "  <-- HIGH" if r is not None and r > 0.8 else ""
        print(f"  AI vs {bname}: Spearman r = {r}{flag}")

    # Also report: does AI rank #1 contributor same as baselines?
    ai_top = max(ai_shares, key=ai_shares.get)
    top_match = {b: (max(bs, key=bs.get) == ai_top)
                 for b, bs in baseline_shares.items()}
    print(f"  AI top contributor: {contributors[ai_top]['name']}")
    print(f"  Top matches baseline: {top_match}")

    return {
        "repo": repo,
        "contributors": {e: contributors[e]["name"] for e in emails},
        "ai_shares": {e: round(v, 1) for e, v in ai_shares.items()},
        "baseline_shares": {b: {e: round(v, 1) for e, v in s.items()}
                            for b, s in baseline_shares.items()},
        "correlations": corrs,
        "top_match": top_match,
        "num_coalitions": result["num_coalitions"],
        "api_calls": result["api_calls"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repos", required=True,
                    help="Comma-separated owner/repo list")
    ap.add_argument("--max-commits", type=int, default=15)
    ap.add_argument("--output", default="bakeoff_results.json")
    args = ap.parse_args()

    repos = [r.strip() for r in args.repos.split(",")]
    all_results = []
    for repo in repos:
        try:
            r = analyze_repo(repo, args.max_commits)
            if r:
                all_results.append(r)
        except Exception as e:
            print(f"  ERROR on {repo}: {e}")

    # Aggregate
    print(f"\n{'='*60}\n  AGGREGATE\n{'='*60}")
    for bname in ["lines_changed", "commit_count", "files_touched"]:
        vals = [r["correlations"][bname] for r in all_results
                if r["correlations"].get(bname) is not None]
        if vals:
            mean = sum(vals) / len(vals)
            print(f"  AI vs {bname}: mean r = {mean:.3f} (n={len(vals)})")
            if mean > 0.8:
                print(f"    WARNING: AI closely tracks {bname} - "
                      f"is the AI adding value?")

    with open(args.output, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\nSaved to {args.output}")


if __name__ == "__main__":
    main()
