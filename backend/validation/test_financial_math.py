#!/usr/bin/env python3
"""Validation: Financial Math Property-Based & Invariant Verification Suite.

Tests 10,000 generated cases across extreme dollar ranges and contributor cohort sizes:
  1. Strict Conservation: sum(cents) == total_cents down to the exact penny.
  2. Non-negativity: no recipient ever receives negative pennies.
  3. Dummy Player Isolation: a 0.0% share recipient receives 0 cents.
  4. Symmetry: identical shares receive identical amounts (differing by at most 1 cent from remainder).
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from financial_math import allocate_exact_cents, usd_to_cents, cents_to_usd_str, calculate_batch_payout_items


def test_hare_niemeyer_10000_fuzz():
    """Fuzz test 10,000 allocations across arbitrary amounts ($0.01 to $1,000,000) and N in [2, 50]."""
    random.seed(42)
    for trial in range(10_000):
        # Pick random total cents from 1 cent ($0.01) to 100,000,000 cents ($1,000,000.00)
        total_cents = random.randint(1, 100_000_000)
        n = random.randint(2, 50)

        # Generate random percentage shares that sum to ~100
        raw_weights = [random.uniform(0.0, 100.0) for _ in range(n)]
        weight_sum = sum(raw_weights)
        shares = {i: (w / weight_sum) * 100.0 for i, w in enumerate(raw_weights)}

        allocated = allocate_exact_cents(total_cents, shares)

        # Invariant 1: Strict Conservation
        assert sum(allocated.values()) == total_cents, (
            f"Trial {trial}: Sum of allocated cents {sum(allocated.values())} != total_cents {total_cents}"
        )

        # Invariant 2: Non-negativity
        for k, c in allocated.items():
            assert c >= 0, f"Trial {trial}: Negative cent allocated to {k}: {c}"


def test_dummy_player_gets_zero():
    """A contributor with 0.0% share must receive 0 cents when pool permits."""
    shares = {0: 70.0, 1: 30.0, 2: 0.0}
    for total_usd in [1.00, 10.00, 100.00, 1234.56]:
        cents = usd_to_cents(total_usd)
        allocated = allocate_exact_cents(cents, shares)
        assert allocated[2] == 0, f"Dummy player received {allocated[2]} cents for total ${total_usd}"


def test_symmetric_players_equal():
    """Symmetric players must receive identical amounts (+/- at most 1 cent from remainder)."""
    shares = {0: 50.0, 1: 50.0}
    # Even cents
    even_alloc = allocate_exact_cents(1000, shares)
    assert even_alloc[0] == even_alloc[1] == 500

    # Odd cents: 1 gets 501, other gets 500 (conservation holds, diff == 1)
    odd_alloc = allocate_exact_cents(1001, shares)
    assert abs(odd_alloc[0] - odd_alloc[1]) == 1
    assert sum(odd_alloc.values()) == 1001


def test_single_penny_distribution():
    """1 cent pool among 5 contributors: exactly 1 receives 1 cent, others receive 0."""
    shares = {0: 40.0, 1: 30.0, 2: 20.0, 3: 10.0}
    allocated = allocate_exact_cents(1, shares)
    assert sum(allocated.values()) == 1
    assert allocated[0] == 1
    assert allocated[1] == 0
    assert allocated[2] == 0
    assert allocated[3] == 0


def test_batch_payout_items_fee_transparency():
    """Verify batch payout item conversion and flat fee calculation."""
    contribs = [
        {"name": "Alice", "email": "alice@corp.net", "share_pct": 60.0},
        {"name": "Bob", "email": "bob@corp.net", "share_pct": 40.0},
    ]
    items, meta = calculate_batch_payout_items(contribs, 1000.00)
    assert meta["total_pool_cents"] == 100_000
    assert meta["allocated_cents"] == 100_000
    assert meta["paypal_fee_usd"] == 0.50  # 2 * $0.25
    assert meta["total_disbursed_usd"] == 1000.50
    assert items[0]["payout_usd"] == 600.00
    assert items[1]["payout_usd"] == 400.00


if __name__ == "__main__":
    test_hare_niemeyer_10000_fuzz()
    print("PASS: test_hare_niemeyer_10000_fuzz (10,000 property checks passed)")
    test_dummy_player_gets_zero()
    print("PASS: test_dummy_player_gets_zero")
    test_symmetric_players_equal()
    print("PASS: test_symmetric_players_equal")
    test_single_penny_distribution()
    print("PASS: test_single_penny_distribution")
    test_batch_payout_items_fee_transparency()
    print("PASS: test_batch_payout_items_fee_transparency")
    print("\nALL FINANCIAL MATH PROPERTY TESTS PASSED (5/5)")
