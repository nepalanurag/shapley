# Phase 3 Verification Thresholds

Committed FIRST, in their own commit, before any Phase 3 test was written
or tuned (hardening plan, Phase 3: "Thresholds committed FIRST, in a
separate commit, before any tuning"). These numbers are the contract.
If a threshold proves impossible, the phase stops and reports; the
threshold is never edited to fit a result.

## 1. Axiom property tests (Hypothesis, raw exact core)

The properties are tested against the RAW exact Shapley core: Shapley
values computed from a complete value table with no value-function
repair and no payout flooring applied.

| Property | Bound |
|----------|-------|
| Efficiency: \|sum(phi) - (v(N) - v(empty))\| | <= 1e-9 |
| Dummy player: phi(dummy) | exactly 0.0 |
| Symmetry: \|phi(i) - phi(j)\| for interchangeable i, j | <= 1e-9 |
| Linearity: \|phi(v + w) - (phi(v) + phi(w))\| per player | <= 1e-9 |

Game generation: n in 2..6 players; every subset value drawn as an
integer in [-50, 200] (non-monotone games included; v(empty) is drawn,
not forced to 0). Dummy and symmetry games are generated so the
respective hypothesis holds by construction.

Hypothesis example counts (max_examples, deadline disabled so machine
speed never flakes a run):

| Property test | max_examples |
|---------------|--------------|
| Efficiency | 200 |
| Dummy player | 100 |
| Symmetry | 100 |
| Linearity | 100 |
| Floored-pipeline contract (below) | 100 |

## 2. Floored pipeline contract (separate from the axioms)

Payout flooring (floor at 0, renormalise) breaks linearity and the raw
efficiency identity by design, so NO axiom is claimed for it. Its own
stated contract, tested separately on the full `compute_shapley`
pipeline whenever v(N) > v(empty):

- every share >= 0;
- unrounded floored shares sum to 100 within 1e-9;
- published (2-decimal) shares sum to 100 within 0.02 (rounding dust:
  each share is rounded to 2 decimals and the dust fix in
  `_payout_flooring_shares` only corrects drift above 0.01).

## 3. Independent oracle agreement

- Bound: max abs difference between the backend exact enumeration and
  the independent oracle <= 1e-6 per player, at n <= 12.
- Oracle of choice: the `shap` library's exact enumeration. Justification
  (hardening plan rule, "new dependency replaces a worse one"): `shap`
  replaces the hand-rolled duplicate Shapley cross-check that Phase 1
  deleted from `main.py`.
- Fallback, only if `shap` cannot be installed or its exact API cannot
  be made to enumerate subsets in this environment: a second brute-force
  implementation written directly from the Shapley definition
  (factorial-weighted marginal sums) inside the test file, sharing no
  code with `backend/shapley.py`. Any substitution is reported plainly.
- Fixture games must include: glove game, additive game, a non-monotone
  game, a synergy game, and random games.

## 4. Golden fixtures

- Rule: byte equality. A test recomputes each fixture output from its
  frozen input, serialises it canonically (JSON, `sort_keys=True`,
  `indent=2`, `ensure_ascii=True`, single trailing newline) and compares
  the bytes to the committed golden file exactly.
- Volatile fields excluded from golden outputs, and only these:
  `provenance.feature_extractor_commit` in the demo-mode analysis
  result (it is the git HEAD of the checkout and changes every commit
  by definition). Golden projections of `compute_shapley` results carry
  only deterministic fields (Shapley values, shares, penny allocations),
  never the Merkle receipt (which contains a wall-clock timestamp).
- Regeneration: only via an explicit `--regen` flag on the golden test,
  off by default. A normal run never writes a golden file.

## 5. Accessibility target (axe)

- Target, to be MET by the end of Phase 4 (design pass): zero critical
  axe violations on the results/explanation view (`/results?demo=true`,
  demo mode).
- Phase 3 records the baseline only: violations by severity, rule ids
  and counts. No UI violation is fixed in Phase 3.

## 6. Cold-clone CI definition

The cold-clone CI job runs ONLY the commands the README gives a
stranger, in order, and nothing else:

1. Create a virtual environment (`python -m venv`).
2. `pip install -r backend/requirements.txt`
3. `cp .env.example .env` (repository root, per the README template
   location)
4. `python backend/validation/run_all_tests.py`
5. Frontend: `npm ci` then `npm run build` (in `frontend/`)

Matrix: Python 3.10 and 3.12 on a clean runner; Node 20 LTS.

Stated fact about this definition, recorded up front rather than
discovered later: `hypothesis` and `shap` are validation-only
dependencies installed in the local validation venv; they are not in
`backend/requirements.txt`, so under the cold-clone commands the
property suite reports an explicit SKIP line and the oracle suite uses
its brute-force fallback. The full property + `shap`-oracle
verification runs where those dependencies are installed. Divergences
between the README commands and CI needs are reported, never silently
fixed by giving CI different commands.
