#!/usr/bin/env python3
"""Validation: Phase 3 golden fixtures — frozen inputs, frozen outputs.

Rule (committed FIRST in backend/validation/THRESHOLDS.md SS4): byte
equality. Each fixture recomputes its output from the frozen input in
fixtures/golden/inputs.json, serialises it canonically (JSON,
sort_keys=True, indent=2, ensure_ascii=True, single trailing newline)
and compares the bytes to the committed golden file exactly.

Fixtures:
  1. exact_shares.expected.json — for each fixture game (glove,
     additive, synergy/unanimity, non-monotone, demo coalition scores),
     the production pipeline's deterministic projection:
     {shapley_values, shares_pct, payout_cents, payout_usd}.
     (The Merkle receipt is excluded by design: it carries a
     wall-clock timestamp. See THRESHOLDS.md SS4.)
  2. demo_analysis.expected.json — one full demo-mode analysis result
     (demo_data.get_demo_analysis()), excluding the single documented
     volatile field provenance.feature_extractor_commit (the checkout's
     git HEAD, which changes every commit by definition).
  3. money_allocation.expected.json — money allocation cases incl. JPY
     (ISO 4217 exponent 0): integer minor-unit allocations from
     distribute_captured_amount plus their PayPal amount strings.

Regeneration: `python test_golden_fixtures.py --regen` rewrites ONLY
the *.expected.json files from current code. It is off by default; a
normal run never writes a golden file. Regenerating is a deliberate
act that must be reviewed like a code change (the diff IS the review).

Run: python test_golden_fixtures.py [--regen]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import shapley as S
from demo_data import get_demo_analysis
from financial_math import distribute_captured_amount, minor_units_to_amount_str

GOLDEN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "fixtures", "golden")


def canonical_bytes(obj) -> bytes:
    """Canonical serialisation per THRESHOLDS.md SS4.

    The json round-trip first normalises int dict keys to strings so
    the bytes are stable regardless of how the object was built.
    """
    normalised = json.loads(json.dumps(obj, sort_keys=True, default=str))
    return (json.dumps(normalised, sort_keys=True, indent=2,
                       ensure_ascii=True) + "\n").encode("utf-8")


def parse_key(key_str):
    if key_str == "":
        return frozenset()
    return frozenset(int(x) for x in key_str.split(","))


def compute_exact_shares(inputs):
    out = {}
    total = inputs["total_amount_usd"]
    for name, game in inputs["games"].items():
        table = {parse_key(k): float(v) for k, v in game["values"].items()}

        def scorer(members, diffs, names=None, _table=table):
            return {"score": _table.get(frozenset(members), 0),
                    "reasoning": "golden-fixture", "confidence": 1.0}

        orig = S.score_coalition
        S.score_coalition = scorer
        try:
            n = game["n"]
            diffs = {i: ["golden"] for i in range(n)}
            names = {i: f"P{i}" for i in range(n)}
            result = S.compute_shapley(diffs, names, total_amount_usd=total)
        finally:
            S.score_coalition = orig
        out[name] = {
            "shapley_values": result["shapley_values"],
            "shares_pct": result["shares_pct"],
            "payout_cents": result["payout_cents"],
            "payout_usd": result["payout_usd"],
        }
    return out


def compute_demo_analysis(_inputs):
    result = json.loads(json.dumps(get_demo_analysis(), sort_keys=True,
                                   default=str))
    # The one documented volatile field (THRESHOLDS.md SS4).
    result.get("provenance", {}).pop("feature_extractor_commit", None)
    return result


def compute_money(inputs):
    out = {}
    for name, case in inputs["money_cases"].items():
        shares = {int(k): v for k, v in case["shares_pct"].items()}
        allocations = distribute_captured_amount(
            case["captured_minor"], case["fee_minor"], shares,
            currency=case["currency"])
        out[name] = {
            "currency": case["currency"],
            "distributable_minor": case["captured_minor"] - case["fee_minor"],
            "allocations": allocations,
            "formatted": {k: minor_units_to_amount_str(v, case["currency"])
                          for k, v in allocations.items()},
        }
    return out


FIXTURES = [
    ("exact_shares.expected.json", compute_exact_shares),
    ("demo_analysis.expected.json", compute_demo_analysis),
    ("money_allocation.expected.json", compute_money),
]


def main():
    regen = "--regen" in sys.argv
    with open(os.path.join(GOLDEN_DIR, "inputs.json"), "rb") as f:
        inputs = json.loads(f.read().decode("utf-8"))
    failed = 0
    for filename, compute in FIXTURES:
        path = os.path.join(GOLDEN_DIR, filename)
        computed = canonical_bytes(compute(inputs))
        if regen:
            with open(path, "wb") as f:
                f.write(computed)
            print(f"  REGEN {filename} ({len(computed)} bytes) — "
                  f"review the diff before committing")
            continue
        try:
            with open(path, "rb") as f:
                golden = f.read()
        except FileNotFoundError:
            print(f"  FAIL {filename}: golden file missing "
                  f"(regenerate deliberately with --regen)")
            failed += 1
            continue
        if computed == golden:
            print(f"  PASS {filename}: byte-identical ({len(golden)} bytes)")
        else:
            print(f"  FAIL {filename}: computed output differs from golden")
            golden_lines = golden.decode("utf-8").splitlines()
            computed_lines = computed.decode("utf-8").splitlines()
            for idx, (g, c) in enumerate(zip(golden_lines, computed_lines)):
                if g != c:
                    print(f"    first difference at line {idx + 1}:")
                    print(f"      golden:   {g}")
                    print(f"      computed: {c}")
                    break
            if len(golden_lines) != len(computed_lines):
                print(f"    line counts differ: golden {len(golden_lines)}, "
                      f"computed {len(computed_lines)}")
            failed += 1
    if regen:
        print("GOLDEN FIXTURES REGENERATED")
        return 0
    print("ALL GOLDEN FIXTURES PASSED" if failed == 0
          else "GOLDEN FIXTURES FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
