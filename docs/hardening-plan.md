# Hardening Plan — Shapley (PayPal AI Hackathon)

Base: `07c112b` + five fix commits (F2 ea95026, F1 0a05022, F3 6574501, F8 004f1c8, F4 bc7bf47).
Those commits are a head start to verify, not ground truth.
Deadline: submissions close 2026-11-12 12:00 PT. Judging Dec 1–15.

## Rules for every phase

- Phases run strictly in order; each phase's done-criteria gate the next.
- Verify before fixing: trace every claim to current code with file:line evidence.
- One local commit per phase, clear message. **Never push to GitHub.**
- **Never change repo visibility** (currently private). Report status only.
- **No live Gemini API calls.** Validation uses fixtures/demo data only.
- Behavior-preserving refactors only in Step 1; no new framework; no data-model redesign.
- New dependency only when it replaces a worse one, justified in the phase report.
- Scratch/venvs under `~/` (never `/tmp`, it is a 512MB tmpfs). Reuse `~/shapley-test-venv`.
- If a phase proves infeasible: do the closest feasible thing, report the deviation plainly.

## Phase 0 — Evidence audit (`docs/audit.md`)

Files to read: `README.md`, `LICENSE`, `backend/requirements.txt`, `frontend/package.json`,
`backend/shapley.py`, `backend/semantic_scorer.py`, `backend/financial_math.py`,
`backend/paypal_payouts.py`, `backend/paypal_escrow.py`, `backend/main.py`,
`backend/merkle_audit.py`, `backend/credentials.py`, `backend/validation/*`,
`.github/workflows/shapley.yml`, `.env.example`, `DEVPOST_SUBMISSION.md`.

Deliverable: `docs/audit.md` mapping what exists onto:
1. Five criteria (Technological Implementation, Design, Potential Impact, Innovation/Idea,
   Presentation) — each row pass / partial / missing with file:line evidence.
2. Stage-One gate: theme fit; PayPal integration is load-bearing (real money movement:
   Orders v2 authorize/capture + Payouts), not a read-only pull.
3. Repository requirements: visibility status (report only); LICENSE detectable by GitHub
   (standard MIT text); buildable from README alone.
4. Secrets scan over the full git history and working tree (patterns: PayPal secret/client
   values, API keys, private keys, `.env` contents). Verdict: safe / not safe to go public.
   Never print secret values — counts and file paths only.
5. Baseline verification: run `backend/validation/run_all_tests.py` and
   `frontend: npm ci && npm run build`; record real outputs. PayPal escrow suite:
   credential-blocked is an acceptable reported outcome; everything else must run.
6. Confirm or refute each of the five fix commits (F1, F2, F3, F8, F4) with evidence.

Done when: audit.md committed; every row has evidence; baseline test/build outputs recorded;
secrets verdict stated. Nothing outside this map gets proposed.

## Phase 1 — Correctness core (behavior-preserving refactor)

Scope only: attribution engine (`backend/shapley.py`), PayPal client
(`backend/paypal_payouts.py`, `backend/paypal_escrow.py`), money handling
(`backend/financial_math.py`), and the provenance plumbing in `backend/main.py` + results UI
read path (`frontend/src/app/results/page.tsx`, `frontend/src/lib/api.ts`).

Invariants — asserted at runtime and covered by tests:
- (a) Efficiency: |Σφᵢ − (v(N) − v(∅))| ≤ 1e-9 pre-clamp; the display path refuses to render
  a result that violates it (explicit error state, never silent).
- (b) Dummy player ⇒ φ = 0.
- (c) Bit-identical reproduction from (seed, n_samples, algorithm, baseline): seeded RNG
  everywhere; same inputs ⇒ byte-identical result JSON.
- (d) Exact enumeration for n ≤ 15 via ONE shared (n+1)·2ⁿ marginal table (no duplicate
  Shapley code — the `main.py` CI re-derivation is deleted and imports the core);
  permutation Monte Carlo with antithetic pairs + bootstrap CIs for n > 15.
- (e) Money in integer minor units / Decimal with ISO 4217 exponents; Σ allocations ==
  captured − fees exactly, largest-remainder rounding.
- (f) Provenance: every rendered number reads from a persisted provenance record
  (input hash, feature-extractor commit, model hash, baseline, seed, CI). No
  computed-on-the-fly numbers in the UI.

Done when: invariants (a)–(f) have failing-before/passing-after tests or runtime assertions;
validation suite green (minus credential-blocked escrow suite); frontend build green;
demo determinism check (3 runs byte-compare) still passes.

## Phase 2 — Failure modes

Files: `backend/paypal_payouts.py`, `backend/paypal_escrow.py`, `backend/main.py`
(webhooks, payout routes), `backend/credentials.py`, `.env.example`, logging call sites
(grep for print/logging across `backend/`).

- PayPal-Request-Id idempotency key on ALL PayPal write calls (orders, captures, payouts).
- Webhook dedupe on event id (persist seen ids); verify-webhook-signature BEFORE any
  payload is trusted or acted on; `verified` reflects the actual check in every environment.
- Sandbox-only: hard fail at startup/client-init if live PayPal credentials or a live
  environment value is detected.
- Deterministic fixture-replay mode: demo/analysis runs end-to-end from committed fixtures
  with network disabled; document the flag in `.env.example`.
- Log audit: no PII, emails, or card/account identifiers in logs; redact or remove.
- `.env.example`: complete variable list, placeholder values only, zero secrets.

Done when: each item has a test or a demonstrable check (e.g., duplicate webhook POST is a
no-op; forged signature rejected in sandbox mode too; startup with live-looking creds exits
with an error); suite + build green.

## Phase 3 — Verification that doesn't ask for trust

Files: `backend/validation/` (new: `test_axioms_property.py`, `test_shapley_oracle.py`,
golden fixtures under `backend/validation/fixtures/`), `.github/workflows/shapley.yml`,
frontend Playwright tests (`frontend/tests/`).

- Thresholds committed FIRST, in a separate commit, before any tuning: axiom tolerances,
  oracle agreement bound, CI cold-clone steps.
- Hypothesis property tests: efficiency, dummy, symmetry, linearity (where the repaired
  value function permits — state where flooring breaks an axiom and test the pre-floor core).
- `shap` as independent oracle vs brute-force enumeration at n ≤ 12. Justification: `shap`
  replaces the hand-rolled cross-check (currently the duplicate implementation deleted in
  Phase 1) — it is the "new dependency replaces a worse one" case. If uninstallable in this
  environment, fall back to a second independent brute-force implementation written from the
  definition, and report the substitution.
- Golden fixtures: frozen inputs → frozen expected outputs, byte-compared in CI.
- Cold-clone CI job: clean matrix (Python 3.10/3.12, Node LTS), runs ONLY the commands the
  README lists, in order, nothing else.
- Playwright + axe-core on the explanation/results view: zero critical axe violations.

Done when: property tests + oracle tests pass at the pre-committed thresholds; CI workflow
contains the cold-clone job; Playwright/axe run recorded with real output.

## Phase 4 — Design, one deliberate pass

Files: `frontend/src/app/results/page.tsx` (coalition view), `frontend/src/app/globals.css`,
`frontend/src/app/layout.tsx`.

- Hero artifact: interactive 2ⁿ coalition grid — each cell shows v(S) and the marginal gain
  of adding a player; selection syncs with the waterfall (marginal-contribution ledger).
- Signed contributions: diverging semantic ramp (toward / against the decision).
- Tabular figures for every number; ONE type family for display and body.
- Forbidden: SaaS card kit (uniform radii + soft shadows), cream-plus-terracotta, gradient
  washes, tracked all-caps eyebrows, "→" appended to buttons.
- Responsive to 360px; visible keyboard focus; `prefers-reduced-motion` honored;
  contrast MEASURED (axe + manual ratio computation for text/background pairs), recorded
  in the phase report.

Done when: build green; Playwright + axe pass on the new view; 360px layout verified;
contrast ratios recorded with numbers, not adjectives.

## Phase 5 — README rewrite + cold verification

Files: `README.md`, `.env.example` (consistency check).

- README only: a stranger reaches a working sandbox demo in under five minutes.
  Exact commands, Python ≥ 3.10, Node version, `cp .env.example .env`, demo mode first
  (no credentials needed), sandbox credentials optional second step.
- Verify by executing the README commands cold: fresh clone into a new directory under `~/`,
  clean venv, follow the README literally, reach the running demo; time it; fix every
  stumble in the README (not in side notes) and re-verify.

Done when: cold run succeeds within five minutes of command-following; timing and any
README fixes recorded; final commit made.

## Non-goals (hard)

No new framework. No data-model redesign. No dependency that doesn't replace a worse one.
No scope beyond the Phase 0 audit map. No change to what the product claims to do (claims
may be restated accurately, never expanded). No live Gemini calls. No push. No visibility
change.
