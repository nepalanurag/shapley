#!/usr/bin/env python3
"""Validation 1: Inter-rater reliability.

Takes N coalition diffs, collects Gemini scores, and computes agreement
against human scores provided in a CSV.

Usage:
    python inter_rater.py --diffs diffs.json --human human_scores.csv

diffs.json format:
    {"0": ["diff text...", ...], "1": [...], ...}
    Keys are coalition IDs, values are lists of diff strings.

human_scores.csv format:
    coalition_id,rater,score
    0,alice,72
    0,bob,68
    ...

Output: per-coalition agreement and aggregate ICC(2,1).
Requires: pip install pingouin
"""
import argparse
import csv
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from semantic_scorer import score_coalition, clear_cache


def load_diffs(path):
    with open(path) as f:
        raw = json.load(f)
    return {k: v for k, v in raw.items()}


def load_human_scores(path):
    """Returns {coalition_id: {rater: score}}."""
    scores = {}
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            cid = row["coalition_id"]
            scores.setdefault(cid, {})[row["rater"]] = float(row["score"])
    return scores


def compute_icc(data):
    """Compute ICC(2,1) using pingouin. data: list of dicts with rater/score."""
    try:
        import pingouin as pg
        import pandas as pd
    except ImportError:
        return None, "pingouin not installed (pip install pingouin)"

    df = pd.DataFrame(data)
    try:
        icc = pg.intraclass_corr(data=df, targets="coalition",
                                 raters="rater", ratings="score")
        # ICC2,1 = two-way random, single rater, absolute agreement
        row = icc[icc["Type"] == "ICC2,1"].iloc[0] if "ICC2,1" in icc["Type"].values else icc.iloc[0]
        return float(row["ICC"]), None
    except Exception as e:
        return None, str(e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diffs", required=True, help="JSON file of coalition diffs")
    ap.add_argument("--human", required=True, help="CSV of human scores")
    ap.add_argument("--output", default="inter_rater_results.json")
    args = ap.parse_args()

    diffs = load_diffs(args.diffs)
    human = load_human_scores(args.human)

    print(f"Loaded {len(diffs)} coalitions, human scores for {len(human)}")
    print("\nScoring coalitions with Gemini (cache cleared each time)...")

    # Collect Gemini scores
    gemini_scores = {}
    for cid, diff_list in sorted(diffs.items()):
        clear_cache()
        result = score_coalition([0], {0: diff_list},
                                 {0: f"Coalition {cid}"})
        gemini_scores[cid] = result["score"]
        print(f"  Coalition {cid}: Gemini={result['score']}")

    # Build long-format data for ICC
    long_data = []
    for cid in sorted(set(list(diffs.keys()) + list(human.keys()))):
        if cid in gemini_scores:
            long_data.append({"coalition": cid, "rater": "gemini",
                              "score": gemini_scores[cid]})
        for rater, score in human.get(cid, {}).items():
            long_data.append({"coalition": cid, "rater": rater,
                              "score": score})

    # Per-coalition: mean human vs gemini absolute difference
    print("\n--- Per-coalition ---")
    per_coalition = {}
    for cid in sorted(diffs.keys()):
        h_scores = list(human.get(cid, {}).values())
        g = gemini_scores[cid]
        if h_scores:
            h_mean = sum(h_scores) / len(h_scores)
            h_std = (sum((s - h_mean) ** 2 for s in h_scores) / len(h_scores)) ** 0.5
            per_coalition[cid] = {
                "gemini": g,
                "human_mean": round(h_mean, 1),
                "human_std": round(h_std, 1),
                "human_n": len(h_scores),
                "abs_diff": round(abs(g - h_mean), 1),
            }
            print(f"  {cid}: Gemini={g} Human={h_mean:.1f}±{h_std:.1f} "
                  f"(n={len(h_scores)}) diff={abs(g-h_mean):.1f}")

    # Aggregate ICC
    print("\n--- Aggregate ICC(2,1) ---")
    icc_val, err = compute_icc(long_data)
    if err:
        print(f"  Could not compute ICC: {err}")
        print("  Install with: pip install pingouin")
    else:
        print(f"  ICC(2,1) = {icc_val:.3f}")
        if icc_val >= 0.75:
            print("  Interpretation: good to excellent agreement")
        elif icc_val >= 0.50:
            print("  Interpretation: moderate agreement")
        else:
            print("  Interpretation: POOR agreement - scorer needs work")

    # Save
    results = {
        "per_coalition": per_coalition,
        "icc_2_1": icc_val,
        "icc_error": err,
        "gemini_scores": gemini_scores,
    }
    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to {args.output}")


if __name__ == "__main__":
    main()
