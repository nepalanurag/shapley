#!/usr/bin/env python3
"""Shapley Phase 1.3: Exact Shapley value computation.

For N contributors, computes each one's fair share based on their
marginal contribution to every possible coalition.

Shapley value for player i:
  phi_i = sum over S not containing i of:
    |S|! * (n - |S| - 1)! / n! * (v(S U {i}) - v(S))

Uses coalition value caching to minimize Gemini API calls.
"""
import itertools
import math
import sys
from semantic_scorer import score_coalition


def all_coalitions(n):
    """Generate all 2^n subsets of {0..n-1}."""
    for r in range(n + 1):
        for combo in itertools.combinations(range(n), r):
            yield set(combo)


def compute_shapley(contributor_diffs, contributor_names=None,
                    verbose=False):
    """Compute exact Shapley values.

    Args:
        contributor_diffs: dict {idx: [diff_text, ...]}
        contributor_names: optional dict {idx: name}

    Returns:
        {
            "shapley_values": {idx: float},
            "shares_pct": {idx: float},
            "num_coalitions": int,
            "api_calls": int,
            "evaluations": [  # audit trail
                {"coalition": [idx...], "score": float, "reasoning": str}
            ],
        }
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
                "reasoning": result["reasoning"],
                "confidence": result["confidence"],
            })
            if verbose:
                m_names = [names[i] for i in member_list]
                print(f"  Coalition {m_names}: score={result['score']}",
                      file=sys.stderr)
        return value_cache[key]

    # Compute Shapley values
    shapley = {i: 0.0 for i in range(n)}
    n_factorial = math.factorial(n)

    total_coalitions = 0
    for S in all_coalitions(n):
        total_coalitions += 1
        for i in range(n):
            if i in S:
                continue
            S_with_i = S | {i}
            # Shapley weight
            s_size = len(S)
            weight = (math.factorial(s_size) *
                      math.factorial(n - s_size - 1)) / n_factorial
            marginal = v(S_with_i) - v(S)
            shapley[i] += weight * marginal

    # Convert to percentages.
    # Handle negative Shapley values: a negative value means the AI judged
    # that contributor's marginal impact as harmful (e.g., inconsistent
    # scoring across coalitions). For payouts, clamp negatives to zero —
    # you can't pay someone a negative share — then renormalize.
    clamped = {i: max(0.0, v) for i, v in shapley.items()}
    total = sum(clamped.values())
    if total > 0:
        shares = {i: round(v / total * 100, 2) for i, v in clamped.items()}
    else:
        # Edge case: all zero or negative, split equally
        shares = {i: round(100 / n, 2) for i in range(n)}

    # Fix rounding dust so shares sum to exactly 100
    share_sum = sum(shares.values())
    if abs(share_sum - 100.0) > 0.01:
        # Adjust the largest share by the difference
        largest = max(shares, key=lambda k: shares[k])
        shares[largest] = round(shares[largest] + (100.0 - share_sum), 2)

    return {
        "shapley_values": {i: round(v, 2) for i, v in shapley.items()},
        "shares_pct": shares,
        "contributor_names": names,
        "num_coalitions": total_coalitions,
        "api_calls": api_calls,
        "evaluations": evaluations,
    }


def monte_carlo_shapley(contributor_diffs, contributor_names=None,
                        num_samples=200, verbose=False):
    """Approximate Shapley via random permutation sampling. For n > 5."""
    import random

    n = len(contributor_diffs)
    names = contributor_names or {i: f"Contributor {i}" for i in range(n)}

    value_cache = {}
    api_calls = 0

    def v(coalition):
        nonlocal api_calls
        key = frozenset(coalition)
        if key not in value_cache:
            member_list = sorted(coalition)
            result = score_coalition(member_list, contributor_diffs, names)
            value_cache[key] = result["score"]
            api_calls += 1
        return value_cache[key]

    shapley = {i: 0.0 for i in range(n)}

    for _ in range(num_samples):
        perm = list(range(n))
        random.shuffle(perm)
        coalition = set()
        for i in perm:
            before = v(coalition)
            coalition.add(i)
            after = v(coalition)
            shapley[i] += (after - before)

    shapley = {i: v / num_samples for i, v in shapley.items()}
    # Clamp negatives to zero for payouts (see compute_shapley for rationale)
    clamped = {i: max(0.0, v) for i, v in shapley.items()}
    total = sum(clamped.values())
    if total > 0:
        shares = {i: round(v / total * 100, 2) for i, v in clamped.items()}
    else:
        shares = {i: round(100 / n, 2) for i in range(n)}
    # Fix rounding dust
    share_sum = sum(shares.values())
    if abs(share_sum - 100.0) > 0.01:
        largest = max(shares, key=lambda k: shares[k])
        shares[largest] = round(shares[largest] + (100.0 - share_sum), 2)

    return {
        "shapley_values": {i: round(v, 2) for i, v in shapley.items()},
        "shares_pct": shares,
        "contributor_names": names,
        "num_samples": num_samples,
        "api_calls": api_calls,
        "method": "monte_carlo",
    }


def test_known_values():
    """Unit test with mock value function where Shapley values are known."""
    # Simple additive game: v(S) = sum of player values
    # Shapley = each player's own value
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
