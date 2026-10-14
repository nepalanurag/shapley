#!/usr/bin/env python3
"""Validation 5: Sensitivity analysis.

Perturb every coalition score by uniform noise in [-5, +5],
recompute Shapley shares 500 times via Monte Carlo.
Report 95% confidence interval per contributor's payout share.

Usage:
    python sensitivity.py --scores scores.json --n 500 --output sensitivity.json

scores.json format:
    {"0": 72, "1": 35, "0,1": 78, ...}
    Keys are comma-separated coalition member indices, values are scores.
    (Use tools/dump_demo_scores.py to generate from demo data.)
"""
import argparse
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def shapley_from_scores(coalition_scores, n):
    """Exact Shapley from a score dict. Keys: frozenset -> score."""
    def v(S):
        return coalition_scores.get(frozenset(S), 0)

    shapley = {i: 0.0 for i in range(n)}
    n_fact = math.factorial(n)
    # Iterate all subsets
    for mask in range(2 ** n):
        S = {i for i in range(n) if mask & (1 << i)}
        for i in range(n):
            if i in S:
                continue
            s_size = len(S)
            weight = (math.factorial(s_size) *
                      math.factorial(n - s_size - 1)) / n_fact
            shapley[i] += weight * (v(S | {i}) - v(S))

    # Clamp negatives, normalize (same as production)
    clamped = {i: max(0.0, v) for i, v in shapley.items()}
    total = sum(clamped.values())
    if total > 0:
        return {i: v / total * 100 for i, v in clamped.items()}
    return {i: 100.0 / n for i in range(n)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scores", required=True)
    ap.add_argument("--n", type=int, default=500)
    ap.add_argument("--noise", type=float, default=5.0,
                    help="Uniform noise half-width")
    ap.add_argument("--names", default=None,
                    help="JSON list of contributor names")
    ap.add_argument("--output", default="sensitivity.json")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    random.seed(args.seed)
    with open(args.scores) as f:
        raw = json.load(f)
    scores = {frozenset(int(x) for x in k.split(",") if x.strip()): v
              for k, v in raw.items() if k.strip()}
    # Handle empty coalition key
    if "" in raw:
        scores[frozenset()] = raw[""]

    n = max((max(s) for s in scores if s), default=-1) + 1
    names = json.load(open(args.names)) if args.names else \
        [f"Contributor {i}" for i in range(n)]

    print(f"Contributors: {n}, Monte Carlo runs: {args.n}, "
          f"noise: ±{args.noise}\n")

    # Baseline (no noise)
    base_shares = shapley_from_scores(scores, n)
    print("Baseline shares (no noise):")
    for i in range(n):
        print(f"  {names[i]}: {base_shares[i]:.1f}%")

    # Monte Carlo
    all_shares = {i: [] for i in range(n)}
    for run in range(args.n):
        noisy = {}
        for coalition, score in scores.items():
            if len(coalition) == 0:
                noisy[coalition] = 0  # Empty stays zero
            else:
                noisy[coalition] = max(0, min(100,
                    score + random.uniform(-args.noise, args.noise)))
        shares = shapley_from_scores(noisy, n)
        for i in range(n):
            all_shares[i].append(shares[i])
        if (run + 1) % 100 == 0:
            print(f"  ... {run+1}/{args.n} runs")

    # 95% CI per contributor
    print(f"\n--- 95% Confidence Intervals ---")
    results = {"baseline": {names[i]: round(base_shares[i], 1)
                            for i in range(n)},
               "contributors": {}}
    for i in range(n):
        vals = sorted(all_shares[i])
        lo = vals[int(0.025 * args.n)]
        hi = vals[int(0.975 * args.n)]
        mean = sum(vals) / len(vals)
        width = hi - lo
        results["contributors"][names[i]] = {
            "mean": round(mean, 1),
            "ci_low": round(lo, 1),
            "ci_high": round(hi, 1),
            "ci_width": round(width, 1),
        }
        flag = "  <-- WIDE" if width > 15 else ""
        print(f"  {names[i]}: {mean:.1f}% [{lo:.1f}, {hi:.1f}] "
              f"(width={width:.1f}){flag}")

    mean_width = sum(r["ci_width"]
                     for r in results["contributors"].values()) / n
    print(f"\n  Mean CI width: {mean_width:.1f}pp")
    if mean_width > 15:
        print("  WARNING: shares are highly sensitive to score noise")
    else:
        print("  Shares are reasonably robust to ±5 score noise")

    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to {args.output}")


if __name__ == "__main__":
    main()
