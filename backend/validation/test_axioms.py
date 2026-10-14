#!/usr/bin/env python3
"""Validation 6: Game-theoretic axiom tests (pytest).

Checks that the Shapley implementation satisfies the core axioms:
  - Efficiency: shares sum to exactly 100
  - Symmetry: identical contributors get equal shares
  - Dummy player: zero marginal contribution -> ~0 share
  - Additivity spot-check via known additive game

Uses a MOCKED scorer (no API calls) to isolate the math from LLM variance.

Run: pytest test_axioms.py -v
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import shapley as S


def make_mock_scorer(score_map):
    """Build a scorer that returns fixed scores from a dict.

    score_map: {frozenset(members): score}
    """
    def mock(member_indices, contributor_diffs, contributor_names=None):
        key = frozenset(member_indices)
        return {"score": score_map.get(key, 0),
                "reasoning": "mock", "confidence": 1.0}
    return mock


def run_with_mock(score_map, n):
    """Run exact Shapley with mocked scores."""
    orig = S.score_coalition
    S.score_coalition = make_mock_scorer(score_map)
    try:
        diffs = {i: ["dummy"] for i in range(n)}
        names = {i: f"P{i}" for i in range(n)}
        return S.compute_shapley(diffs, names)
    finally:
        S.score_coalition = orig


def all_coalitions(n):
    return [frozenset(i for i in range(n) if mask & (1 << i))
            for mask in range(2 ** n)]


# ── Tests ─────────────────────────────────────────────────────

def test_efficiency_random_games():
    """Shares sum to exactly 100 across random score assignments."""
    import random
    random.seed(123)
    for trial in range(20):
        n = random.randint(2, 5)
        scores = {c: random.randint(0, 100) for c in all_coalitions(n)}
        scores[frozenset()] = 0
        result = run_with_mock(scores, n)
        total = sum(result["shares_pct"].values())
        assert abs(total - 100.0) < 0.05, \
            f"Trial {trial}: shares sum to {total}, not 100"


def test_symmetry():
    """Two identical contributors get equal shares."""
    # P0 and P1 have identical marginal contributions everywhere
    scores = {
        frozenset(): 0,
        frozenset({0}): 30, frozenset({1}): 30, frozenset({2}): 10,
        frozenset({0, 1}): 50,
        frozenset({0, 2}): 35, frozenset({1, 2}): 35,
        frozenset({0, 1, 2}): 60,
    }
    result = run_with_mock(scores, 3)
    s0 = result["shares_pct"][0]
    s1 = result["shares_pct"][1]
    assert abs(s0 - s1) < 0.5, \
        f"Symmetric players got different shares: {s0} vs {s1}"


def test_dummy_player():
    """A player who adds nothing to any coalition gets ~0 share."""
    scores = {
        frozenset(): 0,
        frozenset({0}): 40, frozenset({1}): 0, frozenset({2}): 25,
        frozenset({0, 1}): 40,  # P1 adds nothing
        frozenset({0, 2}): 65, frozenset({1, 2}): 25,  # P1 adds nothing
        frozenset({0, 1, 2}): 65,  # P1 adds nothing
    }
    result = run_with_mock(scores, 3)
    s1 = result["shares_pct"][1]
    assert s1 < 1.0, f"Dummy player got {s1}% share, expected ~0"


def test_additive_game_known_answer():
    """Additive game: v(S) = sum of individual values.
    Shapley should recover exactly the individual values."""
    individual = {0: 30, 1: 50, 2: 20}
    scores = {}
    for c in all_coalitions(3):
        scores[c] = sum(individual[i] for i in c)
    result = run_with_mock(scores, 3)
    for i in range(3):
        expected_share = individual[i]  # total=100 so share = value
        actual = result["shares_pct"][i]
        assert abs(actual - expected_share) < 0.5, \
            f"P{i}: expected {expected_share}%, got {actual}%"


def test_monotonicity_sanity():
    """If P0 dominates P1 in every coalition, P0's share >= P1's."""
    # P0 always contributes at least as much as P1
    scores = {
        frozenset(): 0,
        frozenset({0}): 50, frozenset({1}): 20,
        frozenset({0, 1}): 60,
    }
    result = run_with_mock(scores, 2)
    assert result["shares_pct"][0] >= result["shares_pct"][1], \
        "Dominant player got smaller share"


def test_single_contributor():
    """Degenerate case: n=1 is rejected (production requires >= 2)."""
    scores = {frozenset(): 0, frozenset({0}): 75}
    try:
        run_with_mock(scores, 1)
        assert False, "Should have raised ValueError for n=1"
    except ValueError as e:
        assert "at least 2" in str(e)


def test_all_zero_scores():
    """All-zero game splits equally (no crash, no NaN)."""
    scores = {c: 0 for c in all_coalitions(3)}
    result = run_with_mock(scores, 3)
    for i in range(3):
        assert abs(result["shares_pct"][i] - 33.33) < 1.0
    assert all(v == v for v in result["shares_pct"].values())  # no NaN


def test_negative_clamping():
    """Negative Shapley values are clamped to 0, shares still sum to 100."""
    # Construct a game where someone has negative marginals
    # (non-monotonic value function, as LLMs sometimes produce)
    scores = {
        frozenset(): 0,
        frozenset({0}): 80, frozenset({1}): 10,
        frozenset({0, 1}): 70,  # Adding P1 REDUCES value
    }
    result = run_with_mock(scores, 2)
    for i in range(2):
        assert result["shares_pct"][i] >= 0, "Negative share!"
    total = sum(result["shares_pct"].values())
    assert abs(total - 100.0) < 0.05


def test_monotonicity_enforcement():
    """Incoherent scores (v(S) < v(subset)) get raised to subset max."""
    scores = {
        frozenset(): 0,
        frozenset({0}): 80, frozenset({1}): 10,
        frozenset({0, 1}): 70,  # Incoherent: less than v({0})
    }
    result = run_with_mock(scores, 2)
    # The {0,1} coalition should have been fixed to 80
    fixes = result.get("monotonicity_fixes", [])
    assert len(fixes) == 1, f"Expected 1 fix, got {len(fixes)}"
    assert fixes[0]["original"] == 70
    assert fixes[0]["adjusted"] == 80
    # No negative marginals should remain after enforcement
    for i in range(2):
        assert result["shapley_values"][i] >= 0, \
            f"P{i} has negative Shapley after monotonicity fix"


if __name__ == "__main__":
    import traceback
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_")]
    passed, failed = 0, 0
    for t in tests:
        try:
            t()
            print(f"  PASS {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL {t.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"  ERROR {t.__name__}: {e}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
