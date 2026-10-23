#!/usr/bin/env python3
"""Validation: Phase 3 Hypothesis property tests for the Shapley axioms.

Thresholds were committed FIRST in backend/validation/THRESHOLDS.md
(commit "test(hardening): phase 3 thresholds committed before tuning");
this file implements exactly those bounds and example counts and does
not move them.

What is tested, and against what:

  RAW CORE — `shapley.shapley_values_from_value_table`, the exact
  Shapley computation over a complete value table with NO
  value-function repair and NO payout flooring. (The production entry
  point `compute_shapley` applies both transforms on top of this core;
  the axioms belong to the core, so the core is what is property-tested
  here.)

    (a) Efficiency:  sum(phi) == v(N) - v(empty)            within 1e-9
    (b) Dummy:       a player with zero marginal everywhere gets
                     phi == 0.0 exactly
    (c) Symmetry:    interchangeable players get equal phi within 1e-9
    (d) Linearity:   phi(v + w) == phi(v) + phi(w)         within 1e-9

  FLOORED PIPELINE — tested separately, for its OWN contract only
  (flooring breaks linearity/efficiency by design; no axiom is claimed
  for it): shares >= 0, unrounded floored shares sum to 100 within
  1e-9, published 2-decimal shares sum to 100 within 0.02, whenever
  v(N) > v(empty).

Games: n in 2..6, subset values are integers in [-50, 200]
(non-monotone games included; v(empty) drawn, not forced to 0).

If `hypothesis` is not installed (e.g. the cold-clone CI job, which
installs only backend/requirements.txt per THRESHOLDS.md SS6), this
suite prints an explicit SKIP and exits 0 — the same precedent as the
credential-blocked PayPal escrow suite. Run it in
~/shapley-test-venv, where hypothesis is installed, for the real check.

Run: python test_axioms_property.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from hypothesis import assume, given, settings, strategies as st
    HAS_HYPOTHESIS = True
except ImportError:
    HAS_HYPOTHESIS = False

if HAS_HYPOTHESIS:
    import shapley as S

    TOL = 1e-9  # THRESHOLDS.md SS1 — do not edit to fit results.

    def subsets_of(n):
        return [frozenset(s) for s in S.all_coalitions(n)]

    # ── Game generators ────────────────────────────────────────────

    @st.composite
    def random_games(draw):
        n = draw(st.integers(min_value=2, max_value=6))
        subs = subsets_of(n)
        values = draw(st.lists(st.integers(min_value=-50, max_value=200),
                               min_size=len(subs), max_size=len(subs)))
        return n, dict(zip(subs, values))

    @st.composite
    def dummy_games(draw):
        """A game plus a player who adds nothing to any coalition."""
        n = draw(st.integers(min_value=2, max_value=6))
        dummy = draw(st.integers(min_value=0, max_value=n - 1))
        base_subs = [s for s in subsets_of(n) if dummy not in s]
        values = draw(st.lists(st.integers(min_value=-50, max_value=200),
                               min_size=len(base_subs), max_size=len(base_subs)))
        table = dict(zip(base_subs, values))
        for s in base_subs:
            table[s | {dummy}] = table[s]
        return n, dummy, table

    @st.composite
    def symmetric_games(draw):
        """A game where players 0 and 1 are interchangeable."""
        n = draw(st.integers(min_value=2, max_value=6))

        def swap(s):
            return frozenset(
                1 if x == 0 else 0 if x == 1 else x for x in s)

        orbits = []
        seen = set()
        for s in subsets_of(n):
            if s in seen:
                continue
            seen.add(s)
            seen.add(swap(s))
            orbits.append(s)
        values = draw(st.lists(st.integers(min_value=-50, max_value=200),
                               min_size=len(orbits), max_size=len(orbits)))
        table = {}
        for orbit_rep, val in zip(orbits, values):
            table[orbit_rep] = val
            table[swap(orbit_rep)] = val
        return n, table

    # ── Raw-core axiom properties ──────────────────────────────────

    @settings(max_examples=200, deadline=None, database=None)
    @given(random_games())
    def test_efficiency_property(game):
        n, table = game
        phi = S.shapley_values_from_value_table(table, n)
        expected = table[frozenset(range(n))] - table[frozenset()]
        assert abs(sum(phi.values()) - expected) <= TOL, \
            f"efficiency: sum(phi)={sum(phi.values())} != {expected}"

    @settings(max_examples=100, deadline=None, database=None)
    @given(dummy_games())
    def test_dummy_property(game):
        n, dummy, table = game
        phi = S.shapley_values_from_value_table(table, n)
        assert phi[dummy] == 0.0, f"dummy player {dummy} got phi={phi[dummy]}"

    @settings(max_examples=100, deadline=None, database=None)
    @given(symmetric_games())
    def test_symmetry_property(game):
        n, table = game
        phi = S.shapley_values_from_value_table(table, n)
        assert abs(phi[0] - phi[1]) <= TOL, \
            f"symmetric players differ: {phi[0]} vs {phi[1]}"

    @settings(max_examples=100, deadline=None, database=None)
    @given(random_games(), random_games())
    def test_linearity_property(game_v, game_w):
        n_v, v = game_v
        n_w, w = game_w
        assume(n_v == n_w)
        n = n_v
        summed = {s: v[s] + w[s] for s in v}
        phi_v = S.shapley_values_from_value_table(v, n)
        phi_w = S.shapley_values_from_value_table(w, n)
        phi_sum = S.shapley_values_from_value_table(summed, n)
        for i in range(n):
            assert abs(phi_sum[i] - (phi_v[i] + phi_w[i])) <= TOL, \
                f"linearity player {i}: {phi_sum[i]} != {phi_v[i]} + {phi_w[i]}"

    # ── Floored pipeline contract (no axioms claimed) ──────────────

    def _mock_scorer(table):
        def scorer(members, diffs, names=None):
            return {"score": table.get(frozenset(members), 0),
                    "reasoning": "property-mock", "confidence": 1.0}
        return scorer

    @settings(max_examples=100, deadline=None, database=None)
    @given(random_games())
    def test_floored_pipeline_contract(game):
        n, table = game
        assume(table[frozenset(range(n))] > table[frozenset()])
        orig = S.score_coalition
        S.score_coalition = _mock_scorer(table)
        try:
            diffs = {i: ["x"] for i in range(n)}
            names = {i: f"P{i}" for i in range(n)}
            result = S.compute_shapley(diffs, names)
        finally:
            S.score_coalition = orig
        shares = result["shares_pct"]
        assert all(s >= 0 for s in shares.values()), \
            f"negative floored share: {shares}"
        assert abs(sum(shares.values()) - 100.0) <= 0.02, \
            f"published shares sum to {sum(shares.values())}, not 100"
        # Unrounded flooring of the game's raw values: exact 100.
        raw_phi = S.shapley_values_from_value_table(table, n)
        if sum(max(0.0, v) for v in raw_phi.values()) > 0:
            unrounded = S._floored_shares_unrounded(raw_phi, n)
            assert all(s >= 0 for s in unrounded.values())
            assert abs(sum(unrounded.values()) - 100.0) <= TOL, \
                f"unrounded floored shares sum to {sum(unrounded.values())}"

    PROPERTY_TESTS = [
        test_efficiency_property,
        test_dummy_property,
        test_symmetry_property,
        test_linearity_property,
        test_floored_pipeline_contract,
    ]


def main():
    if not HAS_HYPOTHESIS:
        print("SKIP: hypothesis not installed in this environment; "
              "property tests not run (see THRESHOLDS.md SS6).")
        print("ALL PROPERTY TESTS SKIPPED (hypothesis missing)")
        return 0
    import traceback
    passed, failed = 0, 0
    for t in PROPERTY_TESTS:
        try:
            t()
            print(f"  PASS {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"  FAIL {t.__name__}: {e}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    print("ALL PROPERTY TESTS PASSED" if failed == 0 else "PROPERTY TESTS FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
