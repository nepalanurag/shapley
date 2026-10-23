#!/usr/bin/env python3
"""Shapley attribution engine: exact enumeration + seeded Monte Carlo.

For N contributors, computes each one's fair share based on their
marginal contribution to coalitions. There is exactly ONE Shapley
implementation in this codebase (this module); callers such as
backend/main.py import the point estimates and confidence intervals from
here and never re-derive them.

Capabilities:
  1. Exact Shapley (N <= 15): evaluates v(S) once for every one of the 2^N
     subsets into ONE shared value table, builds one shared marginal
     table from it, and derives every player's Shapley value from that
     table. No coalition is ever re-scored.
  2. Permutation Monte Carlo (N > 15): seeded permutation sampling with
     antithetic pairs (each sampled permutation is paired with its
     reverse) and percentile-bootstrap confidence intervals over the
     per-permutation marginal samples. This is a plain Monte Carlo
     estimator with an empirical bootstrap interval — it is NOT an
     (epsilon, delta)-PAC procedure and makes no PAC guarantee.
  3. Exact-penny financial distribution: Hare-Niemeyer integer minor
     units (backend/financial_math.py).
  4. Cryptographic provenance: RFC-6962 SHA-256 Merkle audit receipt,
     plus a persisted provenance record on every result (see
     _build_provenance).

Honest-language notes on the two transforms applied to raw Shapley values:

  * Value-function repair (exact path; historically called
    "monotonicity enforcement"): the scorer's raw coalition values are
    rewritten so v(S) >= v(T) for every T subset of S, by raising v(S) to
    the maximum value of its subsets. Preserves: non-negative marginal
    contributions for every player/coalition pair in the repaired game.
    Costs: the repaired game is a different game from the one the scorer
    described — additivity and the scorer's original coalition ordering
    are not preserved, and values can only move upward.
  * Payout flooring (both paths; historically "zero-clamp +
    renormalise"): raw Shapley values are floored at zero and the
    remaining values are renormalised to sum to 100%. This is applied
    ONCE, at the end, to the final estimates — never per marginal step.
    Preserves: non-negative payout shares that sum to exactly 100%.
    Costs: a player whose raw Shapley value is negative is paid 0
    instead of a negative amount, and every other player's share is
    scaled down to fund that; the floored shares are therefore not the
    raw Shapley values of the (repaired) game whenever any raw value is
    negative.

Efficiency invariant: BEFORE any payout flooring, both paths assert
|sum(phi) - (v(N) - v(empty))| <= 1e-9 and raise ShapleyEfficiencyError
otherwise. The API layer surfaces that error as an explicit failed state;
no numbers from a failed result are ever rendered.
"""
import hashlib
import itertools
import json
import math
import os
import random
import subprocess
import sys
from typing import Dict, List, Optional, Any

from semantic_scorer import score_coalition
from financial_math import allocate_exact_cents, usd_to_cents, cents_to_usd_str
from merkle_audit import build_audit_receipt

# Exact enumeration is used for n <= EXACT_MAX_N; Monte Carlo above it.
EXACT_MAX_N = 15
EFFICIENCY_TOL = 1e-9


class ShapleyEfficiencyError(RuntimeError):
    """Raised when the efficiency identity fails before payout flooring.

    |sum(phi) - (v(N) - v(empty))| > 1e-9. The API surfaces this as an
    explicit error state; callers must not render numbers from a result
    that raised it (no result is returned at all).
    """


def assert_efficiency(shapley_values: Dict[Any, float], v_full: float,
                      v_empty: float, tol: float = EFFICIENCY_TOL) -> None:
    """Assert the efficiency identity on pre-flooring Shapley values."""
    total = sum(shapley_values.values())
    expected = v_full - v_empty
    # Written as `not (diff <= tol)` so a NaN sum also fails the check.
    if not (abs(total - expected) <= tol):
        raise ShapleyEfficiencyError(
            f"Efficiency violation: sum(phi)={total!r} != "
            f"v(N)-v(empty)={expected!r} (diff={abs(total - expected)!r} "
            f"> tol={tol})")


def all_coalitions(n: int):
    """Generate all 2^n subsets of {0..n-1}."""
    for r in range(n + 1):
        for combo in itertools.combinations(range(n), r):
            yield set(combo)


# ── Provenance helpers ─────────────────────────────────────────────

def _input_hash(contributor_diffs: Dict[int, List[str]],
                contributor_names: Dict[int, str]) -> str:
    """Hash of the scored inputs (diffs + names), canonical JSON, sha256."""
    payload = {
        "diffs": {str(k): list(v) for k, v in sorted(contributor_diffs.items())},
        "names": {str(k): v for k, v in sorted(contributor_names.items())},
    }
    canonical = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _derive_seed(contributor_diffs: Dict[int, List[str]],
                 contributor_names: Dict[int, str]) -> int:
    """Deterministic default seed derived from the inputs themselves.

    Same inputs => same seed => bit-identical Monte Carlo result JSON.
    """
    digest = hashlib.sha256(
        ("seed:" + _input_hash(contributor_diffs, contributor_names)).encode("utf-8")
    ).digest()
    return int.from_bytes(digest[:4], "big") % (2 ** 31)


def _feature_extractor_commit() -> str:
    """Git rev of this repo at runtime, or "unknown" outside a checkout."""
    try:
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        out = subprocess.run(
            ["git", "-C", repo_root, "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=5)
        rev = out.stdout.strip()
        if out.returncode == 0 and rev:
            return rev
    except Exception:
        pass
    return "unknown"


def _model_identifier() -> (str, str):
    """(model name, sha256 of model name) for the coalition scorer.

    When the scorer has been replaced by a test fixture (the module-level
    `score_coalition` no longer resolves to semantic_scorer's), the model
    is honestly recorded as "fixture-scorer".
    """
    try:
        import semantic_scorer as _ss
        if score_coalition is getattr(_ss, "score_coalition", None):
            model = getattr(_ss, "DEFAULT_MODEL", "unknown")
        else:
            model = "fixture-scorer"
    except Exception:
        model = "unknown"
    return model, hashlib.sha256(str(model).encode("utf-8")).hexdigest()


def _build_provenance(*, contributor_diffs, contributor_names, algorithm,
                      seed, n_samples, baseline, share_cis,
                      ci_method) -> Dict[str, Any]:
    """Persisted provenance record attached to every analysis result.

    The API returns this object and the results UI reads its displayed
    numbers' lineage from it; nothing is recomputed on the fly downstream.
    """
    model, model_hash = _model_identifier()
    return {
        "input_hash": _input_hash(contributor_diffs, contributor_names),
        "feature_extractor_commit": _feature_extractor_commit(),
        "model": model,
        "model_hash": model_hash,
        "baseline": baseline,
        "seed": seed,
        "n_samples": n_samples,
        "algorithm": algorithm,
        "ci_method": ci_method,
        "share_cis": share_cis,
        "efficiency_check": "passed",
        "efficiency_tol": EFFICIENCY_TOL,
    }


# ── Shared share/flooring/CI helpers ───────────────────────────────

def _payout_flooring_shares(shapley: Dict[int, float], n: int) -> Dict[int, float]:
    """Payout flooring: floor raw values at 0, renormalise to 100%.

    Applied ONCE to final estimates (see module docstring for what this
    preserves and what it costs). Rounding/dust handling is unchanged
    from the original implementation.
    """
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
    return shares


def _floored_shares_unrounded(shapley: Dict[int, float], n: int) -> Dict[int, float]:
    """Payout flooring without rounding (for bootstrap resamples)."""
    clamped = {i: max(0.0, val) for i, val in shapley.items()}
    total = sum(clamped.values())
    if total > 0:
        return {i: val / total * 100 for i, val in clamped.items()}
    return {i: 100.0 / n for i in range(n)}


def _percentile(sorted_vals: List[float], q: float) -> float:
    idx = min(len(sorted_vals) - 1, max(0, int(q * len(sorted_vals))))
    return sorted_vals[idx]


def bootstrap_share_cis(per_player_samples: Dict[int, List[float]],
                        seed: int, n: int,
                        n_bootstrap: int = 1000) -> (Dict[int, Dict[str, float]],
                                                     Dict[int, Dict[str, float]]):
    """Percentile-bootstrap CIs over per-permutation marginal samples.

    Resamples permutations with replacement (seeded, hence reproducible),
    recomputes the mean marginal per player and the payout-floored shares
    for each resample, and returns the 2.5%/97.5% percentiles. Because the
    resamples are drawn from the same per-permutation samples whose mean
    IS the published point estimate, the intervals are centred on that
    published estimate by construction rather than on a re-derived one.

    Returns (share_cis, shapley_value_cis), each {i: {"low":, "high":}}.
    """
    p = len(per_player_samples.get(0, [])) if n else 0
    if p == 0:
        empty = {i: {"low": 0.0, "high": 0.0} for i in range(n)}
        return empty, empty
    rng = random.Random((seed or 0) + 1_000_003)
    boot_shares: Dict[int, List[float]] = {i: [] for i in range(n)}
    boot_values: Dict[int, List[float]] = {i: [] for i in range(n)}
    for _ in range(n_bootstrap):
        indices = [rng.randrange(p) for _ in range(p)]
        means = {i: sum(per_player_samples[i][j] for j in indices) / p
                 for i in range(n)}
        shares_b = _floored_shares_unrounded(means, n)
        for i in range(n):
            boot_values[i].append(means[i])
            boot_shares[i].append(shares_b[i])
    share_cis, value_cis = {}, {}
    for i in range(n):
        s_sorted = sorted(boot_shares[i])
        v_sorted = sorted(boot_values[i])
        share_cis[i] = {"low": round(_percentile(s_sorted, 0.025), 2),
                        "high": round(_percentile(s_sorted, 0.975), 2)}
        value_cis[i] = {"low": round(_percentile(v_sorted, 0.025), 2),
                        "high": round(_percentile(v_sorted, 0.975), 2)}
    return share_cis, value_cis


# ── Exact Shapley (n <= 15) ────────────────────────────────────────

def shapley_values_from_marginal_table(
        marginal_table: Dict[Any, float], n: int) -> Dict[int, float]:
    """Shapley values from a marginal table: the ONE weighted-sum loop.

    marginal_table[(S, i)] must hold v(S + {i}) - v(S) for every
    S not containing i. This is the single factorial-weighted summation
    every exact path in this module funnels through.
    """
    shapley = {i: 0.0 for i in range(n)}
    n_factorial = math.factorial(n)
    for S in all_coalitions(n):
        s_size = len(S)
        for i in range(n):
            if i in S:
                continue
            weight = (math.factorial(s_size) *
                      math.factorial(n - s_size - 1)) / n_factorial
            shapley[i] += weight * marginal_table[(frozenset(S), i)]
    return shapley


def shapley_values_from_value_table(
        value_table: Dict[frozenset, float], n: int) -> Dict[int, float]:
    """RAW exact Shapley values from a complete value table.

    The pre-repair, pre-flooring core exposed for verification
    (Phase 3 property/oracle tests): the value table is used exactly
    as given — no value-function repair, no payout flooring — so the
    Shapley axioms can be tested against the mathematics itself rather
    than against the transforms the production path applies on top.
    Production callers should use compute_shapley, which repairs the
    scorer's table and floors payouts deliberately (module docstring).
    """
    marginal_table: Dict[Any, float] = {}
    for S in all_coalitions(n):
        for i in range(n):
            if i in S:
                continue
            marginal_table[(frozenset(S), i)] = (
                value_table[frozenset(S | {i})] - value_table[frozenset(S)])
    return shapley_values_from_marginal_table(marginal_table, n)


def compute_shapley(
    contributor_diffs: Dict[int, List[str]],
    contributor_names: Optional[Dict[int, str]] = None,
    total_amount_usd: float = 1000.0,
    repo_name: str = "local/repository",
    commit_head: str = "head",
    verbose: bool = False,
    seed: Optional[int] = None,
) -> Dict[str, Any]:
    """Compute exact Shapley values across all 2^N subsets (N <= 15).

    Every coalition is scored exactly once into a shared value table;
    every player's marginal contributions are derived from that table
    via one shared marginal table. Confidence intervals for the exact
    path are degenerate (low == high == published share): exact
    enumeration has no sampling error to interval-estimate, and stating
    that is more honest than manufacturing a width.

    Args:
        contributor_diffs: dict {idx: [diff_text, ...]}
        contributor_names: optional dict {idx: name}
        total_amount_usd: optional total bounty pool in USD for exact penny allocation
        repo_name: repository identifier for Merkle audit
        commit_head: HEAD commit SHA for Merkle audit
        verbose: print progress to stderr
        seed: recorded in provenance for uniformity; the exact path uses
            no randomness, so the seed does not affect the result.

    Returns:
        Structured audit dictionary with exact shares, penny allocations,
        Merkle receipt, share CIs and a persisted provenance record.
    """
    n = len(contributor_diffs)
    if n < 2:
        raise ValueError(f"Need at least 2 contributors, got {n}")
    if n > EXACT_MAX_N:
        raise ValueError(f"Exact Shapley infeasible for n={n} > {EXACT_MAX_N}. "
                         "Use monte_carlo_shapley.")

    names = contributor_names or {i: f"Contributor {i}" for i in range(n)}

    # ── Shared value table: v(S) evaluated ONCE per subset ─────
    value_table: Dict[frozenset, float] = {}
    evaluations = []
    api_calls = 0

    all_subs = list(all_coalitions(n))
    for coalition in all_subs:
        member_list = sorted(coalition)
        result = score_coalition(member_list, contributor_diffs, names)
        value_table[frozenset(coalition)] = result["score"]
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

    # ── Value-function repair ──────────────────────────────────
    # (Historically "monotonicity enforcement".) A coalition's value
    # should be >= every sub-coalition's value, so the raw scorer values
    # are repaired: v(S) = max(v(S), max(v(T) for T subset of S)).
    # Preserves: non-negative marginals in the repaired game. Costs: the
    # repaired game differs from the scorer's raw game (see module
    # docstring). The repair behaviour itself is unchanged.
    monotonicity_fixes = []
    subsets_by_size = {size: [] for size in range(n + 1)}
    for S in all_subs:
        subsets_by_size[len(S)].append(S)

    eval_by_coalition = {frozenset(ev["coalition"]): ev for ev in evaluations}

    for size in range(1, n + 1):
        for S in subsets_by_size[size]:
            key = frozenset(S)
            best_sub = max(
                (value_table.get(frozenset(S - {i}), 0) for i in S),
                default=0,
            )
            if value_table[key] < best_sub:
                monotonicity_fixes.append({
                    "coalition": sorted(S),
                    "original": value_table[key],
                    "adjusted": best_sub,
                })
                value_table[key] = best_sub
                if key in eval_by_coalition:
                    eval_by_coalition[key]["score"] = best_sub
                    eval_by_coalition[key]["monotonicity_adjusted"] = True

    # ── Shared marginal table ──────────────────────────────────
    # marginal_table[(S, i)] = v(S + {i}) - v(S), derived solely from
    # the shared value table above; no coalition is re-scored.
    marginal_table: Dict[Any, float] = {}
    for S in all_subs:
        for i in range(n):
            if i in S:
                continue
            marginal_table[(frozenset(S), i)] = (
                value_table[frozenset(S | {i})] - value_table[frozenset(S)])

    # Shapley values from the shared marginal table (the one
    # weighted-sum loop, shared with the raw verification core).
    shapley = shapley_values_from_marginal_table(marginal_table, n)

    # ── Efficiency assertion (pre-flooring) ────────────────────
    v_empty = value_table[frozenset()]
    v_full = value_table[frozenset(range(n))]
    assert_efficiency(shapley, v_full, v_empty)

    # Payout flooring, applied once at the end (module docstring).
    shares = _payout_flooring_shares(shapley, n)

    # Exact enumeration: no sampling error, so the CI is the point
    # estimate itself — centred on the published share by definition.
    share_cis = {i: {"low": shares[i], "high": shares[i]} for i in range(n)}
    value_cis = {i: {"low": round(shapley[i], 2), "high": round(shapley[i], 2)}
                 for i in range(n)}

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

    total_coalitions = len(all_subs)
    provenance = _build_provenance(
        contributor_diffs=contributor_diffs, contributor_names=names,
        algorithm="exact_all_coalitions", seed=seed,
        n_samples=total_coalitions, baseline=float(v_empty),
        share_cis=share_cis, ci_method="exact_no_sampling_error")

    return {
        "shapley_values": {i: round(v, 2) for i, v in shapley.items()},
        "shares_pct": shares,
        "share_cis": share_cis,
        "shapley_value_cis": value_cis,
        "payout_cents": cents_allocation,
        "payout_usd": payout_usd,
        "contributor_names": names,
        "num_coalitions": total_coalitions,
        "api_calls": api_calls,
        "evaluations": evaluations,
        "monotonicity_fixes": monotonicity_fixes,
        "merkle_receipt": audit_receipt,
        "method": "exact_all_coalitions",
        "algorithm": "exact_all_coalitions",
        "baseline": float(v_empty),
        "seed": seed,
        "provenance": provenance,
    }


# ── Monte Carlo Shapley (n > 15) ───────────────────────────────────

def monte_carlo_shapley(
    contributor_diffs: Dict[int, List[str]],
    contributor_names: Optional[Dict[int, str]] = None,
    num_samples: int = 150,
    min_samples: int = 50,
    max_samples: int = 400,
    epsilon: float = 0.03,  # Deprecated: retained for call compatibility only.
    total_amount_usd: float = 1000.0,
    repo_name: str = "local/repository",
    commit_head: str = "head",
    verbose: bool = False,
    seed: Optional[int] = None,
    n_bootstrap: int = 1000,
) -> Dict[str, Any]:
    """Permutation Monte Carlo Shapley with antithetic pairs + bootstrap CIs.

    Draws seeded random permutations; each sampled permutation is paired
    with its reverse (antithetic pair) to reduce permutation variance.
    Each player's marginal on a permutation is the RAW difference
    v(S + {i}) - v(S) — negative marginals are kept as-is during
    estimation; payout flooring (floor at zero + renormalise) is applied
    once, at the end, to the averaged estimates only.

    Uncertainty is reported as percentile-bootstrap confidence intervals
    over the per-permutation marginal samples. No (epsilon, delta)-PAC
    guarantee is claimed or implemented: `epsilon`, `min_samples` and
    `max_samples` are retained only for call compatibility with the
    previous adaptive-stopping signature and no longer stop sampling
    early — the sample count is fixed by `num_samples`/`min_samples`/
    `max_samples` exactly as the original pair-count formula computed
    it, which is what makes (seed, n_samples, algorithm, baseline)
    reproduce the result bit-identically.

    Efficiency: asserted two ways. (1) Per permutation, the estimator's
    bookkeeping identity — the sum of a permutation's raw marginals
    telescopes to v(N) - v(empty) — is asserted for every sampled
    permutation; this is the check that is feasible for a sampling
    estimator (an exact-recomputation check would require the 2^n
    enumeration this path exists to avoid). (2) The averaged estimates
    are asserted against v(N) - v(empty) before payout flooring, which
    follows from (1) but is checked directly as a guard.
    """
    n = len(contributor_diffs)
    names = contributor_names or {i: f"Contributor {i}" for i in range(n)}

    resolved_seed = seed if seed is not None else _derive_seed(
        contributor_diffs, names)
    rng = random.Random(resolved_seed)

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

    target_pairs = max(min_samples // 2, min(num_samples // 2, max_samples // 2))

    # Per-permutation marginal samples: samples[i][p] is player i's raw
    # marginal on permutation p. These are the bootstrap population and
    # the record from which the published point estimate is the mean.
    per_player_samples: Dict[int, List[float]] = {i: [] for i in range(n)}
    total_permutations = 0
    for _pair_idx in range(target_pairs):
        perm_forward = list(range(n))
        rng.shuffle(perm_forward)
        perm_reverse = perm_forward[::-1]

        # Antithetic pair: forward permutation + its reverse.
        for perm in (perm_forward, perm_reverse):
            total_permutations += 1
            coalition = set()
            v_current = v(coalition)
            perm_marginals: Dict[int, float] = {}
            for i in perm:
                coalition_with_i = coalition | {i}
                v_next = v(coalition_with_i)
                # Raw marginal difference. No per-step flooring: a
                # negative marginal is real information about the
                # scorer's value function and biasing it to zero here
                # (the previous max(0.0, ...) guard) systematically
                # inflated every estimate.
                marginal = v_next - v_current
                perm_marginals[i] = marginal
                coalition = coalition_with_i
                v_current = v_next
            # Bookkeeping identity: this permutation's marginals must
            # telescope to v(N) - v(empty).
            assert_efficiency(perm_marginals, v(set(range(n))), v(set()))
            for i in range(n):
                per_player_samples[i].append(perm_marginals[i])

    # Final estimates: means of the per-permutation samples.
    shapley = {i: sum(per_player_samples[i]) / total_permutations
               for i in range(n)}

    # Efficiency of the averaged estimator (pre-flooring guard).
    assert_efficiency(shapley, v(set(range(n))), v(set()))
    baseline = float(v(set()))

    # Payout flooring, applied once at the end (module docstring).
    shares = _payout_flooring_shares(shapley, n)

    # Bootstrap CIs over the per-permutation marginal samples.
    share_cis, value_cis = bootstrap_share_cis(
        per_player_samples, resolved_seed, n, n_bootstrap=n_bootstrap)

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

    provenance = _build_provenance(
        contributor_diffs=contributor_diffs, contributor_names=names,
        algorithm="monte_carlo_antithetic_bootstrap", seed=resolved_seed,
        n_samples=total_permutations, baseline=baseline,
        share_cis=share_cis, ci_method="percentile_bootstrap")

    return {
        "shapley_values": {i: round(v, 2) for i, v in shapley.items()},
        "shares_pct": shares,
        "share_cis": share_cis,
        "shapley_value_cis": value_cis,
        "payout_cents": cents_allocation,
        "payout_usd": payout_usd,
        "contributor_names": names,
        "num_coalitions": len(value_cache),
        "num_samples": total_permutations,
        "seed": resolved_seed,
        "baseline": baseline,
        "algorithm": "monte_carlo_antithetic_bootstrap",
        "api_calls": api_calls,
        "evaluations": evaluations,
        "monotonicity_fixes": [],
        "merkle_receipt": audit_receipt,
        "method": "monte_carlo_antithetic_bootstrap",
        "provenance": provenance,
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
