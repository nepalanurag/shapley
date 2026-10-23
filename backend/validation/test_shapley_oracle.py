#!/usr/bin/env python3
"""Validation: Phase 3 independent-oracle agreement for exact Shapley.

Threshold committed FIRST in backend/validation/THRESHOLDS.md SS3:
max abs difference per player <= 1e-6 at n <= 12. This file does not
move that bound.

Oracle of choice: the `shap` library's exact enumeration
(`shap.ExactExplainer` over a binary-mask model wrapping the value
function, with a single all-zeros background row so that "feature
hidden" means exactly "player absent" and the base value is v(empty)).
Justification (hardening plan, Phase 3): `shap` replaces the
hand-rolled duplicate Shapley cross-check that Phase 1 deleted from
main.py — the sanctioned "new dependency replaces a worse one" case.
`shap` is a validation-only dependency (installed in
~/shapley-test-venv), never a runtime dependency.

Fallback (per THRESHOLDS.md SS3): if `shap` cannot be imported in the
running environment, the oracle is `brute_force_shapley` below — a
second implementation written directly from the Shapley definition
(per-player, factorial-weighted marginal sums over the subsets of the
OTHER players), sharing no code with backend/shapley.py. The mode used
is printed in the run output and in this suite's PASS lines; a run on
the fallback is a real check, but it is not the shap check, and the
output says so.

The backend side of the comparison is the raw exact core,
`shapley.shapley_values_from_value_table` (pre-repair, pre-flooring):
`shap` computes the Shapley values of the game as given, so the
comparison must be against the enumeration of the game as given, not
against the production path's repaired/floored transforms.

Fixture games: glove game, additive game, non-monotone games, a
synergy (unanimity) game, and seeded random games up to n = 12.

Run: python test_shapley_oracle.py
"""
import itertools
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import shapley as S

BOUND = 1e-6  # THRESHOLDS.md SS3 — do not edit to fit results.

try:
    import numpy as np
    import shap as _shap_lib
    HAS_SHAP = True
except ImportError:
    HAS_SHAP = False


# ── Fallback oracle: written directly from the definition ──────────

def brute_force_shapley(value_table, n):
    """phi_i = sum over S subset of N\\{i} of
    |S|! (n-|S|-1)! / n! * (v(S + {i}) - v(S)).

    Deliberately structured per-player (unlike backend/shapley.py,
    which builds one shared marginal table for all players at once),
    so a bug in the backend's table construction cannot be mirrored
    here by construction.
    """
    phi = {}
    n_fact = math.factorial(n)
    for i in range(n):
        others = [j for j in range(n) if j != i]
        total = 0.0
        for r in range(len(others) + 1):
            weight = math.factorial(r) * math.factorial(n - r - 1) / n_fact
            for subset in itertools.combinations(others, r):
                s = frozenset(subset)
                total += weight * (value_table[s | {i}] - value_table[s])
        phi[i] = total
    return phi


# ── shap oracle ────────────────────────────────────────────────────

def shap_oracle_shapley(value_table, n):
    """Exact Shapley values via shap's ExactExplainer.

    The model maps a binary mask row to v(players with mask 1); the
    Independent masker's single background row is all zeros, so hiding
    a feature removes that player and the explainer's base value is
    v(empty). Explaining the all-ones row yields the game's Shapley
    values by exact subset enumeration.
    """
    def model(masks):
        masks = np.asarray(masks)
        out = []
        for row in masks:
            coalition = frozenset(i for i in range(n) if row[i] > 0.5)
            out.append(float(value_table[coalition]))
        return np.array(out)

    masker = _shap_lib.maskers.Independent(np.zeros((1, n)))
    explainer = _shap_lib.ExactExplainer(model, masker)
    explanation = explainer(np.ones((1, n)))
    values = np.asarray(explanation.values, dtype=float)
    if values.ndim == 2:
        values = values[0]
    return {i: float(values[i]) for i in range(n)}


ORACLE_MODE = "shap" if HAS_SHAP else "fallback-brute-force"
ORACLE_FN = shap_oracle_shapley if HAS_SHAP else brute_force_shapley


# ── Fixture games ──────────────────────────────────────────────────

def table_from_fn(n, fn):
    table = {}
    for r in range(n + 1):
        for combo in itertools.combinations(range(n), r):
            table[frozenset(combo)] = float(fn(set(combo)))
    return table


def fixture_games():
    games = []
    games.append(("glove (n=3)", 3, table_from_fn(
        3, lambda s: (100.0 if {0, 1} <= s else 0.0)
        + (10.0 if 2 in s else 0.0))))
    individual = {0: 30.0, 1: 50.0, 2: 20.0, 3: 10.0}
    games.append(("additive (n=4)", 4, table_from_fn(
        4, lambda s: sum(individual[i] for i in s))))
    games.append(("non-monotone (n=2)", 2, {
        frozenset(): 0.0, frozenset({0}): 80.0,
        frozenset({1}): 10.0, frozenset({0, 1}): 70.0}))
    games.append(("non-monotone random (n=5)", 5, _random_table(5, seed=77)))
    games.append(("synergy/unanimity (n=4)", 4, table_from_fn(
        4, lambda s: 100.0 if len(s) == 4 else 0.0)))
    games.append(("random (n=5)", 5, _random_table(5, seed=1234)))
    games.append(("random (n=8)", 8, _random_table(8, seed=2026)))
    games.append(("random (n=12)", 12, _random_table(12, seed=99)))
    return games


def _random_table(n, seed):
    rng = random.Random(seed)
    table = {}
    for r in range(n + 1):
        for combo in itertools.combinations(range(n), r):
            table[frozenset(combo)] = float(rng.randint(0, 200))
    table[frozenset()] = 0.0
    return table


# ── Runner ─────────────────────────────────────────────────────────

def main():
    print(f"Oracle mode: {ORACLE_MODE}"
          + ("" if HAS_SHAP else " (shap not importable in this "
                                 "environment; definition-level fallback)"))
    failed = 0
    for name, n, table in fixture_games():
        backend = S.shapley_values_from_value_table(table, n)
        oracle = ORACLE_FN(table, n)
        max_diff = max(abs(backend[i] - oracle[i]) for i in range(n))
        ok = max_diff <= BOUND
        status = "PASS" if ok else "FAIL"
        print(f"  {status} {name}: max abs diff = {max_diff:.3e} "
              f"(bound {BOUND:.0e}) via {ORACLE_MODE}")
        if not ok:
            failed += 1
    if HAS_SHAP:
        # The fallback is also cross-checked wherever shap exists, so
        # both oracles are exercised in the full validation venv.
        for name, n, table in fixture_games():
            backend = S.shapley_values_from_value_table(table, n)
            oracle = brute_force_shapley(table, n)
            max_diff = max(abs(backend[i] - oracle[i]) for i in range(n))
            ok = max_diff <= BOUND
            print(f"  {'PASS' if ok else 'FAIL'} {name} "
                  f"[fallback cross-check]: max abs diff = {max_diff:.3e}")
            if not ok:
                failed += 1
    print("ALL ORACLE TESTS PASSED" if failed == 0 else "ORACLE TESTS FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
