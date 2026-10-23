#!/usr/bin/env python3
"""Validation: Monte Carlo Permutation Sampling (antithetic pairs, seeded) Suite.

Tests:
  1. Convergence on Glove Game: Left + Right glove (symmetric 50/50).
  2. Convergence on Additive Game: Known ground-truth marginal contributions.
  3. Exact-Penny Conservation Invariant under Monte Carlo sampling.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import shapley as S


def test_monte_carlo_glove_game():
    """Glove game: Player 0 has L glove, Player 1 has R glove. Pair worth 100.

    Theoretical Shapley values: Player 0 = 50, Player 1 = 50.
    """
    orig = S.score_coalition

    def glove_scorer(members, diffs, names=None):
        s = set(members)
        val = 100 if (0 in s and 1 in s) else 0
        return {"score": val, "reasoning": "glove", "confidence": 1.0}

    import random
    random.seed(42)
    S.score_coalition = glove_scorer
    try:
        diffs = {0: ["L"], 1: ["R"]}
        names = {0: "L_Owner", 1: "R_Owner"}
        res = S.monte_carlo_shapley(diffs, names, num_samples=300, min_samples=200, total_amount_usd=1000.0)

        s0 = res["shares_pct"][0]
        s1 = res["shares_pct"][1]
        assert abs(s0 - 50.0) <= 5.0, f"Player 0 share {s0}% deviates from 50%"
        assert abs(s1 - 50.0) <= 5.0, f"Player 1 share {s1}% deviates from 50%"
        assert sum(res["payout_cents"].values()) == 100_000
    finally:
        S.score_coalition = orig


def test_monte_carlo_additive_game():
    """Additive game: Player values {0: 30, 1: 50, 2: 20}.

    Theoretical shares: 30%, 50%, 20%.
    """
    orig = S.score_coalition
    player_values = {0: 30, 1: 50, 2: 20}

    def additive_scorer(members, diffs, names=None):
        val = sum(player_values[i] for i in members)
        return {"score": val, "reasoning": "additive", "confidence": 1.0}

    S.score_coalition = additive_scorer
    try:
        diffs = {0: ["A"], 1: ["B"], 2: ["C"]}
        names = {0: "P0", 1: "P1", 2: "P2"}
        res = S.monte_carlo_shapley(diffs, names, num_samples=150, total_amount_usd=500.0)

        for i in range(3):
            expected = player_values[i]
            actual = res["shares_pct"][i]
            assert abs(actual - expected) <= 5.0, (
                f"Player {i} share {actual}% deviates from expected {expected}%"
            )
        # Verify strict exact penny conservation
        assert sum(res["payout_cents"].values()) == 50_000
    finally:
        S.score_coalition = orig


if __name__ == "__main__":
    test_monte_carlo_glove_game()
    print("PASS: test_monte_carlo_glove_game (50/50 convergence verified)")
    test_monte_carlo_additive_game()
    print("PASS: test_monte_carlo_additive_game (30/50/20 convergence verified)")
    print("\nALL MONTE CARLO ANTITHETIC TESTS PASSED (2/2)")
