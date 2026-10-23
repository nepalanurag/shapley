# Phase 0 — Evidence Audit

**Commit audited:** `de84623` (local HEAD; `docs(hardening): phased hardening plan`)
**Date:** 2026-10-22
**Method:** every row traced to current code with `file:line` evidence, the validation
suite and the frontend build actually run (outputs in §3), a redacted secrets scan over
the full git history and working tree (§2), and the repository checked through the
GitHub API (§1.3). Input evidence was `AUDIT_2026-10-22.md`, which audited `07c112b`;
its claims were re-verified against current code, not assumed — the five fix commits
on top of `07c112b` (F2 `ea95026`, F1 `0a05022`, F3 `6574501`, F8 `004f1c8`, F4 `bc7bf47`)
had already fixed several of them (verified individually in §4).
**Rules observed:** no live Gemini calls, no push, no visibility change.

Verdicts: **pass** = evidence supports the claim as stated; **partial** = real
substance present with a documented gap; **missing** = no evidence in the repo.

---

## 1. Criteria, Stage-One gate, and repository requirements

### 1.1 Five criteria

| # | Criterion | Verdict | Evidence (current code) |
|---|-----------|---------|-------------------------|
| 1 | Technological Implementation | **partial** | Strong core: exact Shapley over all 2ⁿ coalitions `backend/shapley.py:36` (`compute_shapley`), Monte Carlo path `backend/shapley.py:190`; exact-penny Hare-Niemeyer allocation with conservation assert `backend/financial_math.py:41,110-122`; RFC-6962 Merkle receipt `backend/merkle_audit.py:19-26,83`; Gemini coalition scorer `backend/semantic_scorer.py:209` (`score_coalition`); full validation suite passes 12/12 in this environment (§3). Gaps the original audit raised that the five fix commits did **not** touch and that are still in the code: a second Shapley re-derivation inside `backend/main.py:103` (`_compute_share_cis`, inner `shapley_shares` at `main.py:124`) with per-marginal clamping and unseeded noise (`main.py:155`, `random.uniform`); unseeded `random.shuffle` in Monte Carlo (`backend/shapley.py:232`) and per-step upward clamp `max(0.0, v_next - v_current)` (`backend/shapley.py:244`); monotonicity repair + zero-clamp/renormalise in the exact path (`backend/shapley.py:90-117,139`). These are correctness-claim caveats on a working implementation, not absence of one. |
| 2 | Design | **partial** | Complete flows exist: landing `frontend/src/app/page.tsx`, analyze `frontend/src/app/analyze/page.tsx`, results `frontend/src/app/results/page.tsx`, audit `frontend/src/app/audit/page.tsx`, OAuth callback `frontend/src/app/oauth/callback/page.tsx`; coalition explorer is present as a grid tab (`frontend/src/app/results/page.tsx:89,1636-1643`, "Coalition Explorer (2^N Subsets)"). But the visual language the original audit flagged (F12, explicitly excluded from the fix run) is unchanged: near-black canvas `--background: #0c0d0e` (`frontend/src/app/globals.css:4`), single blue action `#2563eb` (`globals.css:9`), green ledger accent `#22c55e` (`globals.css:10`), tracked uppercase mono badge in the header (`frontend/src/app/layout.tsx:38`); the results component is still 2,225 lines with 32 `useState` calls in one file. Nothing on the surface is derived from Shapley values themselves. |
| 3 | Potential Impact | **partial** | The problem and mechanism are concrete (`README.md:5-15`: repo in, semantic coalition scores, Shapley shares, PayPal payout out; multi-agent/MCP surface at `backend/agent_tool.py:75`). Credibility is limited by the repo's own validation record: inter-rater reliability **Not run** (`VALIDATION.md:17`, again at `VALIDATION.md:246-248` — test-retest and identity-bias probes quota-blocked), and the only scorer-vs-baseline evidence is the 4-repo bake-off with n=3/n=5 (see F2 in §4), which the submission itself now frames as a rank-correlation study, not validated fair shares (`DEVPOST_SUBMISSION.md:65-69`). No reference customer or deployment evidence exists in the repo. |
| 4 | Innovation / Idea | **pass** | The uncommon combination is implemented, not just described: AI semantic evaluation of *coalitions* (not individuals) `backend/semantic_scorer.py:209`; game-theoretic split `backend/shapley.py:36,190`; money executed by PayPal (§1.2); cryptographic provenance over every coalition evaluation `backend/merkle_audit.py:83-135` plus a zero-dependency offline verifier `verify_audit_proof.py`; prompt-injection quarantine in the scoring path `backend/ast_quarantine.py`, `backend/semantic_scorer.py:37` (`sanitize_diff`), applied at `:240`; MCP/agent disbursement tools `backend/agent_tool.py:27,75`. |
| 5 | Presentation | **partial** | Submission text now matches committed evidence (§4, F2) and a demo script exists (`DEMO_VIDEO_SCRIPT.md`); README is runnable (§4, F1). Remaining defects in the presentation layer itself: `DEVPOST_SUBMISSION.md:125` still claims end-to-end "in under 10 seconds", which is contradicted for live runs by the scorer's 4.0 s minimum call interval (`backend/semantic_scorer.py:34`, `MIN_INTERVAL`) — 8 coalitions for n=3 alone imply ≥32 s of pacing; the claim is only true of demo mode. No demo video asset exists in the repo (script only). The F12 design gap (row 2) is also a presentation gap. |

### 1.2 Stage-One gate

| # | Gate item | Verdict | Evidence |
|---|-----------|---------|----------|
| 6 | Theme fit | **pass** | Built for the PayPal AI Hackathon (`README.md:9`); submission targets the PayPal Agentic Commerce track (`DEVPOST_SUBMISSION.md:5-8`); the product's core loop is GitHub repo → AI coalition scoring → Shapley shares → PayPal money movement (§1.1 row 4, §1.2 row 7). |
| 7 | PayPal integration is load-bearing | **pass** | The money path is real API calls, traced end to end below — not a read-only pull and not decorative. Removing PayPal removes the product's execution step (`README.md:15`). |

**Money-path trace (what this repo actually does):**

1. **OAuth** — `backend/paypal_payouts.py:96` (`get_access_token`) POSTs
   `client_credentials` to `{PAYPAL_BASE}/v1/oauth2/token` (`paypal_payouts.py:109`),
   with `PAYPAL_BASE = "https://api-m.sandbox.paypal.com"` (`paypal_payouts.py:49`).
   Credentials come from env/`.env` only (`paypal_payouts.py:102-105`).
2. **Orders v2 authorize** — `backend/paypal_escrow.py:71`
   (`create_orders_v2_authorization`) builds `intent: "AUTHORIZE"`
   (`paypal_escrow.py:92`) and POSTs to `/v2/checkout/orders`
   (`paypal_escrow.py:112`) with a `PayPal-Request-Id` idempotency header
   (`paypal_escrow.py:117`). Exposed as `POST /api/escrow/order` (`backend/main.py:624`).
3. **Capture / void** — capture POSTs to
   `/v2/payments/authorizations/{authorization_id}/capture`
   (`paypal_escrow.py:187`, request-id at `:192`); void POSTs to
   `/v2/payments/authorizations/{authorization_id}/void` (`paypal_escrow.py:212`);
   live order status is queried via GET `/v2/checkout/orders/{order_id}`
   (`paypal_escrow.py:239`). `capture_authorization` (`paypal_escrow.py:253`)
   enforces exact-penny conservation against the vault before capturing
   (`paypal_escrow.py:267-276`) and then chains into the batch payout
   (`paypal_escrow.py:288`). Exposed as `POST /api/escrow/capture` (`backend/main.py:643`).
4. **Payouts** — `backend/paypal_payouts.py:145` (`create_batch_payout`) validates
   shares, applies a batch ceiling and replay protection
   (`paypal_payouts.py:193,249`), and POSTs to `/v1/payments/payouts`
   (`paypal_payouts.py:223`); status is read back from
   `/v1/payments/payouts/{payout_batch_id}` (`paypal_payouts.py:257`). Exposed as
   `POST /api/payout` (`backend/main.py:357`) and via the MCP tool
   `shapley_execute_payout` (`backend/agent_tool.py:75`).
5. **Webhooks** — `POST /api/paypal/webhook` (`backend/main.py:656`) verifies via
   `escrow_manager.verify_webhook_signature` (`backend/main.py:671`), rejects
   invalid signatures with 401 in every environment (`main.py:679-680`), and
   dedupes on the PayPal event id (`main.py:686-691`; seen-id set at `main.py:46`).
   Evidence caveat: the underlying check in
   `backend/paypal_escrow.py:440` (`verify_webhook_signature`) is a
   header-presence/timestamp check that returns a bool — it does **not** call
   PayPal's verify-webhook-signature API. The handler's `verified` flag now
   honestly reflects that check (see F8, §4); the check's cryptographic strength
   is a separate, later-phase question.
6. **Live proof in this run** — the escrow suite's live test called the real
   sandbox OAuth + Orders v2 endpoints and passed (§3), so the authorize path
   is exercised against PayPal, not only mocked.

### 1.3 Repository requirements

| # | Requirement | Verdict | Evidence |
|---|-------------|---------|----------|
| 8a | Visibility (report only — **not changed**) | **pass (already public)** | `gh-api GET /repos/nepalanurag/shapley` on 2026-10-22 returned `"private": false`, `"visibility": "public"`, `"default_branch": "main"`. This contradicts the hardening plan's "currently private" note: the repo is already public. No change was made. Material caveat: the public `main` tip is `07c112b` (same API, `/branches/main`), i.e. the five fix commits and this audit exist only locally and are **not** what a visitor to the public repo sees today. |
| 8b | LICENSE detectable by GitHub | **pass** | `LICENSE` at repo root is the canonical MIT text: title "MIT License" (`LICENSE:1`), copyright line (`LICENSE:3`), the standard permission grant and conditions (`LICENSE:5-21`), and the verbatim warranty disclaimer. This is the text GitHub's license detector identifies as MIT. |
| 8c | Buildable from README alone | **partial** | The README is now internally consistent and consistent with the manifests (see F1, §4): prerequisites Python ≥ 3.10 / Node 18+ (`README.md:58-59`), `cp ../.env.example ../.env` (`README.md:69`), env-var table mirroring `.env.example`, Render root directory `backend` (`README.md:137`) matching `render.yaml` (`rootDir: backend`); backend manifest is `backend/requirements.txt` (fastapi, uvicorn, pydantic), frontend manifest `frontend/package.json` (Next 16.4 / React 19.3, `build: next build`). Demo mode needs no credentials (`README.md:91`). Why not pass: a stranger's cold clone was **not** executed in this phase (that is Phase 5's done-criterion); the baseline in §3 ran in the existing venv / existing `node_modules`. One residual internal-path reference remains outside the README: `backend/credentials.py:12` inserts `/opt/hatch/skills/skill-creator/bin` — it is a try/except local-dev fallback (`credentials.py:9-15`) behind the env-var path, so it does not block a README follower who sets env vars, but the machinery still exists in the code. |

---

## 2. Secrets scan

**Method.** A scripted scan (counts and file paths only; no secret value was
printed or stored) over: (a) `git log -p --all` — all 66 commits, added lines
attributed to files via diff headers; (b) the working tree — 99 text files
(`.git`, `node_modules`, `.next`, `__pycache__` and binary assets excluded);
(c) a token-format grep at HEAD (`git grep`) for GitHub PATs, Google API keys,
OpenAI-style keys, AWS keys, PayPal access-token format, and private-key blocks.
Patterns: private-key blocks; `PAYPAL_CLIENT_SECRET` / `PAYPAL_CLIENT_ID`
assignments; `GEMINI_API_KEY` / `GITHUB_TOKEN` assignments; generic
`api_key` / `client_secret` / `access_token` / `password` assignments;
high-format token values (`ghp_`, `github_pat_`, `AIza`, `sk-`, `AKIA`, `E21`).

**History (66 commits, `git log -p --all`):**

| Pattern | Non-placeholder hits | Files |
|---|---|---|
| Private-key blocks | 0 | — |
| Token-format values (PAT / Google / `sk-` / AWS / PayPal `E21` / bearer literals) | 0 | — |
| Committed `.env` files | 0 | — (only `.env.example` appears in history) |
| `PAYPAL_CLIENT_SECRET` / `PAYPAL_CLIENT_ID` assignments with literal values | 0 | — (placeholder-context hits only, in `.env.example`: 2 each, values are `your_sandbox_...` placeholders) |
| Generic `api_key`/`client_secret`/`access_token` assignments | 2 | `backend/main.py` — inspected: both are code references, not literals (`client_secret = os.environ.get("GITHUB_OAUTH_CLIENT_SECRET", "")`, `access_token = token_data.get("access_token")`). False positives. |
| Placeholder-context assignment hits (env reads, `${{ secrets.* }}`-style references, `.env.example`) | 10 | `.env.example`, `backend/credentials.py`, `backend/main.py`, `backend/semantic_scorer.py` |

**Working tree (99 files scanned):**

| Pattern | Non-placeholder hits | Files |
|---|---|---|
| Private-key blocks / token-format values | 0 | — (`git grep` at HEAD also returned 0) |
| Real credential assignments | 4 pattern hits, all in one file | `.env` (repo root, **untracked and gitignored** — `.gitignore:3`; `git ls-files` has no `.env`): it contains non-empty values for `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and a sandbox business **password** key, plus sandbox account e-mails, `PAYPAL_MODE`, `DEMO_MODE` (7 keys total). Key names and value lengths only were recorded; no values are reproduced here. |
| Generic assignment hits in tracked code | 1 | `backend/main.py` — same env-read false positive as above. |
| Placeholder-context hits | 7 | `.env.example` (placeholders), `backend/credentials.py`, `backend/main.py`, `backend/semantic_scorer.py` (env-var reads) |

Other evidence in scope: one sandbox account **e-mail identifier** (no password)
is hard-coded as a default in `backend/main.py:778`; 8 `__pycache__/*.pyc` files
are tracked despite `.gitignore` (compiled from the same scanned sources; the
HEAD token-format grep over tracked content returned 0).

**Verdict: SAFE to be public — for this repository's current history and
tracked tree.** No real secret value exists in any of the 66 commits or in any
tracked working-tree file; the only real credentials are in the local `.env`,
which is untracked, gitignored, and absent from history. Conditions and scope
limits of this verdict: (1) it holds only while `.env` stays untracked — it
holds real sandbox credentials and a sandbox password on disk; (2) the repo is
**already public** (§1.3 row 8a), so this is a statement about current state,
not a pre-publication clearance for a private repo; (3) the scan covers this
repo's current history only — the pre-2026-10-13 repo incarnation described in
project memory (deleted and recreated after a `.env` push) is not part of this
history and cannot be cleared by this scan.

---

## 3. Baseline verification (real outputs, run 2026-10-22)

### 3.1 Validation suite

Command: `~/shapley-test-venv/bin/python backend/validation/run_all_tests.py`
(existing venv reused). **Exit code 0 — 12 test suites passed, 0 failed.**
(The runner executes the 11 suites listed in `backend/validation/run_all_tests.py:20-32`
plus the frozen-demo determinism check.)

Tail of the actual output:

```
[*] Running PayPal Orders v2 Escrow Invariants (test_paypal_escrow.py)...
  [+] PASS: PayPal Orders v2 Escrow Invariants
        [+] PASS: test_orders_v2_authorization_creation (Real PayPal API called)
        [+] PASS: test_exact_penny_release
        [+] PASS: test_dispute_void_lock
        [+] PASS: test_default_demo_vault_jinja_phase2
        [+] PASS: test_sponsor_portfolio_and_invoice_accounting
        [+] PASS: test_paypal_webhook_signature_verification
      ALL PAYPAL ORDERS V2 INVARIANT TESTS PASSED.
--------------------------------------------------------------------------------
[*] Running Contributor Claims, RBAC & Hackathon Pot Solvency (test_claims_and_onboarding.py)...
  [+] PASS: Contributor Claims, RBAC & Hackathon Pot Solvency
--------------------------------------------------------------------------------
[*] Running Frozen Demo Scenario Determinism...
  [+] PASS: Frozen Demo Scenario (Deterministic across 3 runs)

================================================================================
AUDIT SUMMARY: 12 test suites passed, 0 failed.
================================================================================
```

Other suites in the same run, all PASS: Axiomatic Game Theory (10 tests),
Exact-Penny Financial Math (10,000 fuzz checks, 5/5), PAC Monte Carlo Antithetic
Convergence (2/2), Cryptographic Merkle Audit Trail (4/4), Adversarial Prompt
Injection Defense (2/2), MCP Compliance (3/3), Concurrency & Replay Defense
(2/2), AI Co-Authorship & Human Pilot Disambiguation (3/3), MCP Chat & Webhook
Protocol Integration (5/5).

**PayPal escrow suite — not credential-blocked in this environment.** Sandbox
credentials are present in the local untracked `.env` (§2), so
`HAS_PAYPAL_CREDS` was true and the live integration test
`test_orders_v2_authorization_creation` actually called the PayPal sandbox
OAuth + Orders v2 endpoints and **passed** — it did not skip and did not fail.
On a machine without credentials the same test skips by design
(`backend/validation/test_paypal_escrow.py:22-27`, `unittest.skipUnless` on
`PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` presence; the `__main__` runner
reports SKIP). No suite failed; there is no credential-blocked error to record
for this run. No Gemini calls were made by the suite.

### 3.2 Frontend build

`node_modules` was already present in `frontend/`, so per instructions
`npm ci` was not run. Command: `cd frontend && npm run build`.
**Result: PASS, exit 0.** The output quoted below is from a clean re-run. An
earlier first run was terminated (exit 143) after reaching "Compiled
successfully / Running TypeScript" when its lingering process was killed to
clear a stale `.next` lock; it did not itself exit 0.

Tail of the actual output:

```
▲ Next.js 16.4.0 (Turbopack)
⚠ Warning: Next.js ignored package-lock.json in /home/hatch/workspace because it is outside the current Git repository (/home/hatch/workspace/shapley).
 To use this directory, set `turbopack.root` in your Next.js config.

✓ Running next.config.ts took 36ms
- Cache Components enabled
- Partial Prefetching enabled

  Creating an optimized production build ...
✓ Compiled successfully in 4.7s
  Running TypeScript ...
  Finished TypeScript in 5.3s ...
  Collecting page data using 1 worker ...
  Generating static pages using 1 worker (8/8) in 953ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /analyze
├ ○ /audit
├ ○ /icon.svg
├ ○ /oauth/callback
└ ○ /results

○  (Static)  prerendered as static content

PIPE_EXIT:0
```

The only warning is the Turbopack root / `package-lock.json` notice above;
TypeScript finished with no errors and all 7 routes prerendered.

---

## 4. Fix-commit verification (F1, F2, F3, F8, F4)

Each fix commit was checked against the **current** code, not its commit message.

| Fix | Verdict | Evidence |
|---|---|---|
| **F2** — bake-off table from JSON + bot quarantine (`ea95026`) | **CONFIRMED** | Table in `DEVPOST_SUBMISSION.md:71-74` (and following rows) reproduces the committed JSON: jinja Kevin Brown-Silva 81.5 / David Lord 10.6 / Adam Englander 7.9 matches `backend/validation/bakeoff_results.json`; aiohttp Sam Bull 48.8 / J. Nick Koston 30.2 / patchback[bot] 21.0 matches the same file; black 35.6 / 31.9 / 24.0 / 5.9 / 2.5 matches `backend/validation/bakeoff_results_n5.json`. The fabricated 62% / 81% / 69% figures from the old submission are gone. Framing is now "a rank-correlation study … not validated fair-share outcomes" (`DEVPOST_SUBMISSION.md:65-69`), with bot contamination and the degenerate pytest split disclosed in the submission itself. Bot quarantine is generalized in code: `is_bot_login` accepts any `*[bot]` login plus `KNOWN_BOT_LOGINS` (`backend/github_ingest.py:28,32-37`), applied to author, committer, and unlinked git author name in `is_bot_commit` (`github_ingest.py:79-88`). The committed JSON was left as the historical record, as the fix states. |
| **F1** — README runnable (`0a05022`) | **CONFIRMED** | Placeholder `cp /path/to/.env` is gone; setup is `cd backend`, `pip install -r requirements.txt`, `cp ../.env.example ../.env` (`README.md:64-69`) — the root `.env` location matches `backend/paypal_payouts.py` (`ENV_PATH` resolves to the repo root). Prerequisites state Python ≥ 3.10 with the PEP 604 reason and Node 18+ (`README.md:58-59`), consistent with `backend/financial_math.py:29` union types. No internal "skill credential system / dynamic_credentials" wording remains in the README; the env-var table (`README.md` Setup) lists the same variables as `.env.example`, including `PAYOUT_CONFIRM_TOKEN` and `ALLOWED_ORIGINS`; the old README-only `PAYPAL_SANDBOX_BUSINESS_EMAIL` / `_RECIPIENT_EMAIL` setup entries are gone. Render instructions give root directory `backend` (`README.md:137`), matching `render.yaml`. Residual noted in §1.3 row 8c: the internal-path fallback still exists in `backend/credentials.py:12` (code, not README). |
| **F3** — CI on push/PR + escrow test skips without creds (`6574501`) | **CONFIRMED** | New `.github/workflows/ci.yml` triggers `on: push` and `pull_request` (`ci.yml:9-10`), installs `backend/requirements.txt` (`ci.yml:28`) and runs `python backend/validation/run_all_tests.py` (`ci.yml:31`); the frontend job runs `npm ci` (`ci.yml:47`) and `npm run build` (`ci.yml:51`). No secrets are configured in the workflow. The escrow live test carries `unittest.skipUnless(HAS_PAYPAL_CREDS, …)` (`backend/validation/test_paypal_escrow.py:22-27`) and the script runner catches `unittest.SkipTest` and prints SKIP (`test_paypal_escrow.py` `__main__` block). Evidence from §3: with creds present all 6 escrow tests pass; the skip path is what a clean CI machine takes. Note: the pre-existing release/`workflow_dispatch` payout workflow (`.github/workflows/shapley.yml`) still exists alongside CI — F3 added CI; it did not remove that workflow, and does not claim to. Whether the CI workflow has ever run green on GitHub cannot be verified from the local repo (the fix commits are unpushed, §1.3 row 8a). |
| **F8** — webhook honesty, OAuth state, payout gate, CORS (`004f1c8`) | **CONFIRMED** (with the §1.2 caveat) | Webhook: `verified` is no longer unconditional — invalid signatures raise 401 in **every** environment (`backend/main.py:679-680`), and `verified: true` appears only on the post-verification success path (`main.py:693`) and the post-verification duplicate path (`main.py:690`), with event-id dedupe at `main.py:686-691`. OAuth: callback rejects a missing state (`main.py:444`) and any state that was not issued by `/api/github/oauth-url`, is expired (>900 s), or was already used — states are popped on use (`main.py:447-448`); issuance stores the state with a timestamp (`main.py:412`); scope is now `public_repo read:user` (`main.py:425`). Payout gate: `_require_payout_confirmation` (`main.py:339-354`) requires header `X-Shapley-Confirm` == `PAYOUT_CONFIRM_TOKEN` whenever a token is set, and fails closed in production when no token is set; it is called by `POST /api/payout` (`main.py:359`) and the same check exists in the MCP payout tool (`backend/agent_tool.py:403-413`); the frontend sends the header from `NEXT_PUBLIC_PAYOUT_CONFIRM_TOKEN` (`frontend/src/lib/api.ts`, F8 diff). CORS: `allow_origins=["*"]` is gone — origins come from `ALLOWED_ORIGINS` or the localhost/`FRONTEND_URL` defaults (`backend/main.py:269-286`). Caveat carried from §1.2: `verify_webhook_signature` (`backend/paypal_escrow.py:440`) checks header presence, not a cryptographic signature via PayPal's API — F8's claim (the flag reflects the check; forged/missing-header webhooks are rejected in all environments) holds for that check. |
| **F4** — visible heuristic-fallback flag + path-based classifier (`bc7bf47`) | **CONFIRMED** | Scorer: Gemini success returns `"scoring_mode": "gemini_semantic"` (`backend/semantic_scorer.py:320`); the exception path returns `"scoring_mode": "heuristic_fallback"` (`semantic_scorer.py:338`) with reasoning that states plainly the score is "the objective line/branch metric only, NOT an AI semantic evaluation" (`semantic_scorer.py:340-342`) and confidence 0.4. Propagation: both Shapley paths copy `scoring_mode` into every evaluation record (`backend/shapley.py:79` exact, `:217` Monte Carlo), so it reaches the API response. UI: the results page renders a banner counting fallback-scored coalitions (`frontend/src/app/results/page.tsx:849-856`); the audit page has a Scoring Mode column rendering "⚠ Heuristic fallback" in red bold vs "AI semantic" (`frontend/src/app/audit/page.tsx:77-85`) and a conditional footer claim (`audit/page.tsx:194`). Classifier: `classify_path` (`backend/semantic_scorer.py:91`) classifies test/doc/core from the changed file's **path** — directory segments and filename patterns — and is applied from `diff --git` / `+++ b/` headers (`semantic_scorer.py:116,119`); the old whole-diff substring matching (`any(tp in diff.lower())`) is gone. |

---

## 5. Scope note

This audit reports evidence only, at `de84623`. Items the original audit raised
that remain open in current code (duplicate Shapley CI derivation and unseeded
Monte Carlo in §1.1 row 1; the "under 10 seconds" claim in row 5; the F12 design
surface in row 2; the presence-based webhook check in §1.2; tracked `.pyc`
files and the unpushed state of the fix commits in §1.3/§2) are recorded where
they bear on a row's verdict. Nothing outside the Phase 0 map is proposed here;
later phases of `docs/hardening-plan.md` scope what happens to each item.
