#!/usr/bin/env python3
"""Validation 2: Test-retest stability.

Scores each coalition in a set N times (cache bypassed each time).
Reports mean, std dev, and max spread per coalition.

Usage:
    python test_retest.py --diffs diffs.json --n 10 --output retest_results.json

diffs.json format: {"coalition_id": ["diff...", ...], ...}
"""
import argparse
import json
import os
import sys
import statistics

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from semantic_scorer import score_coalition, clear_cache


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diffs", required=True)
    ap.add_argument("--n", type=int, default=10, help="Repetitions per coalition")
    ap.add_argument("--output", default="retest_results.json")
    args = ap.parse_args()

    with open(args.diffs) as f:
        diffs = json.load(f)

    print(f"Scoring {len(diffs)} coalitions × {args.n} repetitions...")
    print("(cache cleared before every call to force fresh API calls)\n")

    results = {}
    for cid, diff_list in sorted(diffs.items()):
        scores = []
        for i in range(args.n):
            clear_cache()  # Force fresh API call
            r = score_coalition([0], {0: diff_list},
                                {0: f"Coalition {cid}"})
            scores.append(r["score"])
            print(f"  {cid} rep {i+1}/{args.n}: {r['score']}", end="\r")
        print()

        mean = statistics.mean(scores)
        stdev = statistics.stdev(scores) if len(scores) > 1 else 0.0
        spread = max(scores) - min(scores)
        results[cid] = {
            "scores": scores,
            "mean": round(mean, 2),
            "stdev": round(stdev, 2),
            "min": min(scores),
            "max": max(scores),
            "spread": spread,
        }
        flag = "  <-- HIGH VARIANCE" if spread > 15 else ""
        print(f"  {cid}: mean={mean:.1f} sd={stdev:.1f} "
              f"range=[{min(scores)},{max(scores)}] spread={spread}{flag}")

    # Aggregate
    all_spreads = [r["spread"] for r in results.values()]
    all_stdevs = [r["stdev"] for r in results.values()]
    print(f"\n--- Aggregate ---")
    print(f"  Mean spread: {statistics.mean(all_spreads):.1f}")
    print(f"  Max spread: {max(all_spreads)}")
    print(f"  Mean stdev: {statistics.mean(all_stdevs):.1f}")
    unstable = sum(1 for s in all_spreads if s > 15)
    print(f"  Unstable coalitions (spread > 15): {unstable}/{len(results)}")

    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to {args.output}")


if __name__ == "__main__":
    main()
