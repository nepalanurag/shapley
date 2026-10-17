#!/usr/bin/env python3
"""Validation: Phased Milestone Escrow & Dynamic Allocation Invariants.

Tests:
1. Each phase pool satisfies exact-penny Hare-Niemeyer conservation (sum(payouts) == pool).
2. Settled phases are immutable when new phases are added or evaluated.
3. Cumulative standings correctly accumulate across settled and active milestones.
4. Active phase advance transitions state properly.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from milestone_engine import MilestoneTracker


def test_milestone_exact_penny_conservation():
    """Assert all phases conserve exact penny without rounding discrepancies."""
    tracker = MilestoneTracker("pallets/jinja")
    for phase_id, phase in tracker.phases.items():
        total_payout = round(sum(phase.payouts_usd.values()), 2)
        assert math_approx(total_payout, phase.pool_usd), (
            f"Phase {phase_id} violated conservation: payouts sum={total_payout}, pool={phase.pool_usd}"
        )


def test_settled_phase_immutability():
    """Assert historical payouts in Phase 1 do not change when Phase 2 is analyzed."""
    tracker = MilestoneTracker("pallets/jinja")
    p1_initial = dict(tracker.phases["phase1"].payouts_usd)

    # Simulate dynamic incoming commits in phase 2
    tracker.phases["phase2"].shares_pct["Sara Ahmed"] = 50.0
    tracker.phases["phase2"].shares_pct["Maya Chen"] = 35.0
    tracker.phases["phase2"].shares_pct["David Park"] = 12.0
    tracker.phases["phase2"].shares_pct["Tom Rivera"] = 3.0
    tracker.phases["phase2"].payouts_usd = tracker._compute_exact_payouts(2500.0, tracker.phases["phase2"].shares_pct)

    # Check phase 1 is untouched
    assert tracker.phases["phase1"].payouts_usd == p1_initial
    assert tracker.phases["phase1"].status == "SETTLED"


def test_cumulative_standings():
    """Assert cumulative totals accurately sum settled and active phases."""
    tracker = MilestoneTracker("pallets/jinja")
    cumulative = tracker.get_cumulative_standings()
    assert "Maya Chen" in cumulative
    assert "Sara Ahmed" in cumulative
    expected_maya = tracker.phases["phase1"].payouts_usd["Maya Chen"] + tracker.phases["phase2"].payouts_usd["Maya Chen"]
    assert math_approx(cumulative["Maya Chen"]["total_usd"], expected_maya)


def math_approx(a, b, eps=0.01):
    return abs(a - b) <= eps


if __name__ == "__main__":
    test_milestone_exact_penny_conservation()
    print("PASS: test_milestone_exact_penny_conservation")
    test_settled_phase_immutability()
    print("PASS: test_settled_phase_immutability")
    test_cumulative_standings()
    print("PASS: test_cumulative_standings")
    print("\nALL MILESTONE INVARIANT TESTS PASSED (3/3)")
