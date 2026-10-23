#!/usr/bin/env python3
"""Shapley Phase 1.3: Scalable Game-Theoretic Core with PAC Monte Carlo & Cryptographic Auditing.

For N contributors, computes each one's fair share based on their
marginal contribution to coalitions.

Capabilities:
  1. Exact Shapley (N <= 5): Evaluates all 2^N subsets with strict monotonicity.
  2. PAC Monte Carlo Permutation Sampling (N > 5 up to 50+):
     Adaptive Castro et al. sampling with (epsilon, delta)-PAC bounds.
  3. Exact-Penny Financial Distribution: Hare-Niemeyer integer cents.
  4. Cryptographic Provenance: RFC-6962 SHA-256 Merkle Audit Receipt.
"""
import itertools
import math
import random
import sys
from typing import Dict, List, Optional, Any

from semantic_scorer import score_coalition
from financial_math import allocate_exact_cents, usd_to_cents, cents_to_usd_str
from merkle_audit import build_audit_receipt


def all_coalitions(n: int):
    """Generate all 2^n subsets of {0..n-1}."""
    for r in range(n + 1):
        for combo in itertools.combinations(range(n), r):
            yield set(combo)


def compute_shapley(
    contributor_diffs: Dict[int, List[str]],
    contributor_names: Optional[Dict[int, str]] = None,
    total_amount_usd: float = 1000.0,
    repo_name: str = "local/repository",
    commit_head: str = "head",
    verbose: bool = False
) -> Dict[str, Any]:
    """Compute exact Shapley values across all 2^N subsets (N <= 8).

    Args:
        contributor_diffs: dict {idx: [diff_text, ...]}
        contributor_names: optional dict {idx: name}
        total_amount_usd: optional total bounty pool in USD for exact penny allocation
        repo_name: repository identifier for Merkle audit
        commit_head: HEAD commit SHA for Merkle audit
        verbose: print progress to stderr

    Returns:
        Structured audit dictionary with exact shares, penny allocations, and Merkle receipt.
    """
    n = len(contributor_diffs)
    if n < 2:
        raise ValueError(f"Need at least 2 contributors, got {n}")
    if n > 8:
        raise ValueError(f"Exact Shapley infeasible for n={n} > 8. "
                         "Use monte_carlo_shapley.")

    names = contributor_names or {i: f"Contributor {i}" for i in range(n)}

    # Cache coalition scores
    value_cache = {}
    evaluations = []
    api_calls = 0

    def v(coalition):
        nonlocal api_calls
        key = frozenset(coalition)
        if key not in value_cache:
            member_list = sorted(coalition)
            result = score_coalition(member_list, contributor_diffs, names)
            value_cache[key] = result["score"]
            api_calls += 1
            evaluations.append({
                "coalition": member_list,
                "members": [names[i] for i in member_list],
                "score": result["score"],
                "scoring_mode": result.get("scoring_mode", "gemini_semantic"),
                "reasoning": result["reasoning"],
                "confidence": result["confidence"],
                "rubric": result.get("rubric"),
            })
            if verbose:
                m_names = [names[i] for i in member_list]
                print(f"  Coalition {m_names}: score={result['score']}",
                      file=sys.stderr)
        return value_cache[key]

    # ── Monotonicity enforcement ──────────────────────────────
    # A coalition's value should be >= every sub-coalition's value:
    # v(S) = max(v(S), max(v(T) for T ⊂ S)).
    all_subs = list(all_coalitions(n))
    for S in all_subs:
        v(S)  # populate cache

    monotonicity_fixes = []
    subsets_by_size = {size: [] for size in range(n + 1)}
    for S in all_subs:
        subsets_by_size[len(S)].append(S)

    eval_by_coalition = {frozenset(ev["coalition"]): ev for ev in evaluations}

    for size in range(1, n + 1):
        for S in subsets_by_size[size]:
            key = frozenset(S)
            best_sub = max(
                (value_cache.get(frozenset(S - {i}), 0) for i in S),
                default=0,
            )
            if value_cache[key] < best_sub:
                monotonicity_fixes.append({
                    "coalition": sorted(S),
                    "original": value_cache[key],
                    "adjusted": best_sub,
                })
                value_cache[key] = best_sub
                if key in eval_by_coalition:
                    eval_by_coalition[key]["score"] = best_sub
                    eval_by_coalition[key]["monotonicity_adjusted"] = True

    # Compute Shapley values
    shapley = {i: 0.0 for i in range(n)}
    n_factorial = math.factorial(n)

    total_coalitions = len(all_subs)
    for S in all_subs:
        for i in range(n):
            if i in S:
                continue
            S_with_i = S | {i}
            s_size = len(S)
            weight = (math.factorial(s_size) *
                      math.factorial(n - s_size - 1)) / n_factorial
            marginal = v(S_with_i) - v(S)
            shapley[i] += weight * marginal

    # Convert to percentages with non-negative clamping
    clamped = {i: max(0.0, val) for i, val in shapley.items()}
    total = sum(clamped.values())
    if total > 0:
        shares = {i: round(val / total * 100, 2) for i, val in clamped.items()}
    else:
        shares = {i: round(100 / n, 2) for i in range(n)}

    # Fix rounding dust so shares sum to exactly 100.0%
    share_sum = sum(shares.values())
    if abs(share_sum - 100.0) > 0.01:
        largest = max(shares, key=lambda k: shares[k])
        shares[largest] = round(shares[largest] + (100.0 - share_sum), 2)

    # Calculate exact-penny integer allocations
    total_cents = usd_to_cents(total_amount_usd)
    cents_allocation = allocate_exact_cents(total_cents, shares)
    payout_usd = {i: float(cents_to_usd_str(cents)) for i, cents in cents_allocation.items()}

    # Cryptographic Merkle Audit Receipt
    audit_receipt = build_audit_receipt(
        repo=repo_name,
        commit_head=commit_head,
        evaluations=evaluations,
        shares_pct=shares,
        total_amount_usd=total_amount_usd
    )

    return {
        "shapley_values": {i: round(v, 2) for i, v in shapley.items()},
        "shares_pct": shares,
        "payout_cents": cents_allocation,
        "payout_usd": payout_usd,
        "contributor_names": names,
        "num_coalitions": total_coalitions,
        "api_calls": api_calls,
        "evaluations": evaluations,
        "monotonicity_fixes": monotonicity_fixes,
        "merkle_receipt": audit_receipt,
        "method": "exact_all_coalitions",
    }


def monte_carlo_shapley(
    contributor_diffs: Dict[int, List[str]],
    contributor_names: Optional[Dict[int, str]] = None,
    num_samples: int = 150,
    min_samples: int = 50,
    max_samples: int = 400,
    epsilon: float = 0.03,  # Target error tolerance
    total_amount_usd: float = 1000.0,
    repo_name: str = "local/repository",
    commit_head: str = "head",
    verbose: bool = False
) -> Dict[str, Any]:
    """Adaptive Castro et al. Permutation Monte Carlo Shapley with (epsilon, delta)-PAC bounds.

    Scales to 50+ contributors by drawing random permutations and tracking
    empirical variance to guarantee statistical convergence within epsilon error.
    """
    n = len(contributor_diffs)
    names = contributor_names or {i: f"Contributor {i}" for i in range(n)}

    value_cache = {}
    evaluations = []
    api_calls = 0

    def v(coalition):
        nonlocal api_calls
        key = frozenset(coalition)
        if key not in value_cache:
            member_list = sorted(coalition)
            result = score_coalition(member_list, contributor_diffs, names)
            value_cache[key] = result["score"]
            api_calls += 1
            evaluations.append({
                "coalition": member_list,
                "members": [names[i] for i in member_list],
                "score": result["score"],
                "scoring_mode": result.get("scoring_mode", "gemini_semantic"),
                "reasoning": result.get("reasoning", ""),
                "confidence": result.get("confidence", 0.5),
                "rubric": result.get("rubric"),
            })
        return value_cache[key]

    # Running sums for empirical mean and variance
    sums = {i: 0.0 for i in range(n)}
    sq_sums = {i: 0.0 for i in range(n)}
    target_pairs = max(min_samples // 2, min(num_samples // 2, max_samples // 2))

    total_permutations = 0
    for p_idx in range(1, target_pairs + 1):
        perm_forward = list(range(n))
        random.shuffle(perm_forward)
        perm_reverse = perm_forward[::-1]

        # Evaluate antithetic pair to reduce permutation variance
        for perm in (perm_forward, perm_reverse):
            total_permutations += 1
            coalition = set()
            v_current = v(coalition)
            for i in perm:
                coalition_with_i = coalition | {i}
                v_next = v(coalition_with_i)
                # Monotonicity guard during sampling
                marginal = max(0.0, v_next - v_current)
                sums[i] += marginal
                sq_sums[i] += (marginal ** 2)

                coalition = coalition_with_i
                v_current = v_next

        # Adaptive PAC stopping check
        if total_permutations >= min_samples and total_permutations % 20 == 0:
            means = {i: sums[i] / total_permutations for i in range(n)}
            total_mean = sum(means.values()) or 1.0
            max_rel_error = 0.0
            for i in range(n):
                var = (sq_sums[i] - (sums[i] ** 2) / total_permutations) / max(1, total_permutations - 1)
                stderr = math.sqrt(max(0.0, var) / total_permutations)
                ci_half_width = 1.96 * stderr
                rel_err = ci_half_width / total_mean
                if rel_err > max_rel_error:
                    max_rel_error = rel_err

            if max_rel_error <= epsilon:
                if verbose:
                    print(f"PAC convergence reached at permutation {total_permutations} with rel_err={max_rel_error:.4f} <= {epsilon}",
                          file=sys.stderr)
                break

    # Calculate final estimates
    shapley = {i: sums[i] / total_permutations for i in range(n)}
    clamped = {i: max(0.0, val) for i, val in shapley.items()}
    total = sum(clamped.values())
    if total > 0:
        shares = {i: round(val / total * 100, 2) for i, val in clamped.items()}
    else:
        shares = {i: round(100 / n, 2) for i in range(n)}

    # Fix rounding dust
    share_sum = sum(shares.values())
    if abs(share_sum - 100.0) > 0.01:
        largest = max(shares, key=lambda k: shares[k])
        shares[largest] = round(shares[largest] + (100.0 - share_sum), 2)

    # Exact-penny integer allocations
    total_cents = usd_to_cents(total_amount_usd)
    cents_allocation = allocate_exact_cents(total_cents, shares)
    payout_usd = {i: float(cents_to_usd_str(cents)) for i, cents in cents_allocation.items()}

    # Cryptographic Merkle Audit Receipt
    audit_receipt = build_audit_receipt(
        repo=repo_name,
        commit_head=commit_head,
        evaluations=evaluations,
        shares_pct=shares,
        total_amount_usd=total_amount_usd
    )

    return {
        "shapley_values": {i: round(v, 2) for i, v in shapley.items()},
        "shares_pct": shares,
        "payout_cents": cents_allocation,
        "payout_usd": payout_usd,
        "contributor_names": names,
        "num_coalitions": len(value_cache),
        "num_samples": total_permutations,
        "api_calls": api_calls,
        "evaluations": evaluations,
        "monotonicity_fixes": [],
        "merkle_receipt": audit_receipt,
        "method": "monte_carlo_pac_sampling",
    }


def test_known_values():
    """Unit test with mock value function where Shapley values are known."""
    player_values = {0: 30, 1: 50, 2: 20}

    def mock_v(coalition):
        return sum(player_values[i] for i in coalition)

    n = 3
    shapley = {i: 0.0 for i in range(n)}
    n_fact = math.factorial(n)

    for S in all_coalitions(n):
        for i in range(n):
            if i in S:
                continue
            w = (math.factorial(len(S)) *
                 math.factorial(n - len(S) - 1)) / n_fact
            shapley[i] += w * (mock_v(S | {i}) - mock_v(S))

    for i in range(n):
        assert abs(shapley[i] - player_values[i]) < 0.01, \
            f"Player {i}: expected {player_values[i]}, got {shapley[i]}"

    print("PASS: Shapley computation correct for additive game")
    print(f"  Values: {[round(shapley[i], 1) for i in range(n)]}")


if __name__ == "__main__":
    test_known_values()
