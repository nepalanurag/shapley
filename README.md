# Shapley

**Fair revenue splits for collaborative work, calculated by AI, executed by PayPal.**

When 3-5 people collaborate on a project, splitting revenue fairly is impossible. Line counts don't measure impact — a 10-line security fix can be worth more than 500 lines of boilerplate. Shapley uses AI to semantically evaluate each contributor's actual impact, applies cooperative game theory (Shapley values) to calculate mathematically fair shares, and executes the split via PayPal Payouts.

Built for the PayPal AI Hackathon 2026.

## Quickstart: a working demo in under five minutes

Demo mode needs **no credentials at all**. The commands below are the
exact commands this repository's cold-clone CI job runs
(`.github/workflows/ci.yml`), in the same order.

### Prerequisites

- **Python >= 3.10** — the backend uses PEP 604 union types
  (`int | None`); Python 3.9 fails on import.
- **Node.js >= 20.9** (Node 20 LTS or newer) — required by Next.js 16
  (`frontend/package.json` pins `next` 16.4.0, whose engine range is
  `node >= 20.9.0`). CI verifies with Node 20; this README was
  cold-verified locally with Node 24.
- **git**

### 1. Clone, install the backend, copy the env template

Run from wherever you keep projects:

```bash
git clone https://github.com/nepalanurag/shapley.git
cd shapley
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cp .env.example .env
```

Notes:

- `python3` is the interpreter name on stock macOS/Linux; if your
  `python` already points at Python >= 3.10, `python -m venv .venv`
  is equivalent. On Windows, use `py -m venv .venv` and
  `.venv\Scripts\...` in place of `.venv/bin/...` below.
- The commands call the virtual environment's binaries directly
  (`.venv/bin/pip`, `.venv/bin/python`), so no activation step is
  needed. If you prefer an activated shell,
  `source .venv/bin/activate` makes plain `pip` / `python` mean the
  same thing.
- Leave the copied `.env` exactly as it ships for the demo. Its
  placeholder values are never called in demo mode; it exists so the
  file the backend looks for at the repository root is present.

### 2. Start the backend (terminal 1, leave it running)

From the repository root:

```bash
.venv/bin/python backend/main.py
```

The API is now at `http://localhost:8000`. Check it in another
terminal:

```bash
curl http://localhost:8000/api/health
# {"status":"ok","version":"1.0.0"}
```

### 3. Start the frontend (terminal 2, leave it running)

```bash
cd frontend
npm ci
npm run dev
```

The app is now at `http://localhost:3000`. (`npm ci` installs exactly
what `frontend/package-lock.json` pins; it is the same install command
CI uses.)

### 4. Open the demo

Open `http://localhost:3000` and click **Try Demo**. (Going straight
to `http://localhost:3000/results?demo=true` does the same thing.)

What you should see, so you know it worked:

- The results view for the frozen demo repo `demo/acme-project`: a
  $1,000 pool split across 4 contributors — Maya Chen 47.0%
  ($470.00), Sara Ahmed 31.6% ($316.00), David Park 16.0% ($160.00),
  Tom Rivera 5.4% ($54.00) — with "16 coalitions evaluated" in the
  header.
- The **Coalition lattice** directly below the summary: the full
  2^4 grid of every coalition the engine evaluated, each cell showing
  that coalition's value v(S). Clicking a cell selects that coalition
  and traces its marginal-contribution ledger (the waterfall beside
  the lattice) step by step.
- No loading spinner that never ends and no sign-in prompt: the demo
  data is frozen and deterministic, served by the backend's
  `GET /api/demo` with zero API calls, so this page renders the same
  numbers on every run.

That is the whole demo. Everything below is optional.

## Verify your setup

After the demo path above, from the repository root:

```bash
.venv/bin/python backend/validation/run_all_tests.py
cd frontend
npm run build
```

The validation runner executes 18 suites (game-theory axioms,
exact-penny financial math, Monte Carlo convergence, Merkle audit,
PayPal escrow invariants, hardening suites, golden fixtures, and
more) and ends with an `AUDIT SUMMARY` line; the frontend build must
finish with no errors. These are the same commands CI runs.

One honest caveat: two suites need test-only dependencies that are
deliberately **not** in `backend/requirements.txt`:

```bash
.venv/bin/pip install hypothesis shap
```

- Without `hypothesis`, the Phase 3 property-test suite
  (`test_axioms_property.py`) prints an explicit SKIP line and exits
  cleanly — it does not fail the run.
- Without `shap`, the independent-oracle suite
  (`test_shapley_oracle.py`) falls back to a second brute-force
  Shapley implementation written from the definition, and says so in
  its output.

With only `requirements.txt` installed (exactly the cold-clone CI
configuration) the master runner still passes; the two suites above
simply run in their skip/fallback modes.

## Live mode (optional): sandbox credentials

Demo mode is the product tour. To analyze a **real** repository or
execute a **sandbox** payout, fill in the relevant keys in the `.env`
file at the repository root (the one you created with
`cp .env.example .env`). The backend reads credentials from
environment variables, falling back to that `.env` file — there is no
other credential source to configure.

Shapley is **sandbox-only**: a live PayPal base URL
(`api-m.paypal.com`) or `PAYPAL_MODE=live` makes the backend refuse
to start. Never use production PayPal credentials here.

### For live analysis of a real repo

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | Yes, for live analysis | Google Gemini API key for coalition scoring (https://aistudio.google.com/apikey) |
| `GEMINI_MODEL` | No | Gemini model override (default `gemini-2.5-flash`) |
| `GEMINI_MIN_INTERVAL` | No | Minimum seconds between Gemini calls (default `4.0`) |
| `GITHUB_TOKEN` | No | GitHub token; raises API rate limits, needed for private repos |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | No | Only for the "Connect GitHub" repo picker |
| `FRONTEND_URL` | No (default `http://localhost:3000`) | Frontend origin for the OAuth redirect |

Live analysis is paced, by design: the scorer enforces the
`GEMINI_MIN_INTERVAL` minimum interval (4.0s by default) between
Gemini calls, and every non-empty coalition is scored once. Pacing
alone is roughly 30 seconds for 3 contributors (8 coalitions,
7 scored) and about 2 minutes for 5 contributors (32 coalitions,
31 scored), before network time. Demo mode has no such delay.

### For sandbox payouts

| Variable | Required | Purpose |
|----------|----------|---------|
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | Yes, for payouts | PayPal REST app credentials — **sandbox** app, from developer.paypal.com |
| `PAYPAL_MODE` | No (default `sandbox`) | Must stay `sandbox`; any live value refuses startup |
| `PAYPAL_BASE_URL` | No | PayPal API base URL override; a live host refuses startup |
| `PAYPAL_WEBHOOK_ID` | For real webhooks | Webhook id from developer.paypal.com; without it, webhook deliveries are rejected outside demo mode |
| `PAYPAL_SANDBOX_BUSINESS_EMAIL` | No | Sandbox Business account email (shown on the sponsor connect endpoint) |
| `PAYPAL_SANDBOX_RECIPIENT_EMAIL` | No | Sandbox Personal account email that receives test payouts in local runs |
| `SHAPLEY_MAX_BATCH_USD` | No | Financial circuit breaker: maximum total for a single payout batch (USD) |
| `PAYOUT_CONFIRM_TOKEN` | Recommended for deployments | When set, payout endpoints require an `X-Shapley-Confirm` header with this value; always required when `ENVIRONMENT=production` |

### Exercising the PayPal flow with no network or credentials

Set in `.env`:

```
PAYPAL_FIXTURE_REPLAY=1
```

With fixture replay on, every PayPal call is served from the
committed fixtures under `backend/fixtures/paypal/` with
deterministic ids and no network access, so the escrow/payout demo
flow runs end to end offline. Turn it back off (empty value) to use
the real sandbox API.

### Remaining variables in `.env.example`

| Variable | Required | Purpose |
|----------|----------|---------|
| `DEMO_MODE` | No | `true` marks a demo context (fixture replay / unverified-demo webhook handling) |
| `ENVIRONMENT` | No | `production` turns on fail-closed behavior (e.g. payouts refused unless `PAYOUT_CONFIRM_TOKEN` is set) |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins (default: the localhost frontend origins) |

## How It Works

1. **Paste a GitHub repo URL.** Shapley pulls commits and diffs via the GitHub API.
2. **AI evaluates contributions.** Gemini reads every diff and scores the semantic impact of each coalition of contributors (not line counts — actual value).
3. **Game theory calculates fair shares.** Shapley values measure each person's marginal contribution across every possible team combination.
4. **Review in AG Grid.** Every AI decision is visible, sortable, and auditable.
5. **Execute via PayPal.** One click sends the fair split as a batch Payout. No LLM in the money path — AI recommends, human confirms, backend executes deterministically.

## The Math

The Shapley value for contributor `i`:

```
φᵢ = Σ |S|! × (n - |S| - 1)! / n! × (v(S ∪ {i}) − v(S))
     S ⊆ N \ {i}
```

Where `v(S)` is the AI-evaluated semantic value of coalition `S`. For N≤5 contributors, we compute exact Shapley values (16-32 coalition evaluations). For larger teams, Monte Carlo approximation.

## Tech Stack

- **Frontend:** Next.js 16, TypeScript, AG Grid Community, AG Charts Community
- **Backend:** Python, FastAPI
- **AI:** Google Gemini (function calling, structured JSON output)
- **Payments:** PayPal Payouts API (batch)
- **Data:** GitHub REST API

## Project Structure

```
shapley/
├── backend/
│   ├── main.py              # FastAPI app
│   ├── github_ingest.py     # GitHub commit/diff ingestion
│   ├── semantic_scorer.py   # Gemini coalition scoring
│   ├── shapley.py           # Exact + Monte Carlo Shapley
│   ├── paypal_payouts.py    # PayPal batch payouts
│   ├── paypal_escrow.py     # PayPal Orders v2 escrow
│   ├── financial_math.py    # Exact-penny money handling
│   ├── merkle_audit.py      # Tamper-evident audit receipts
│   ├── demo_data.py         # Frozen deterministic demo
│   ├── cli.py               # CLI end-to-end demo
│   └── validation/          # Test suites (run_all_tests.py)
├── frontend/
│   └── src/app/
│       ├── page.tsx         # Landing + repo input
│       ├── results/page.tsx # Shapley breakdown + coalition lattice
│       └── audit/page.tsx   # Coalition evaluation log
└── PLAN.md
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/demo` | Frozen demo data (deterministic) |
| POST | `/api/analyze` | Start analysis job `{repo_url, total_amount, demo}` |
| GET | `/api/analyze/{job_id}` | Poll job status |
| POST | `/api/payout` | Execute PayPal batch payout |
| GET | `/api/payout/{batch_id}` | Check payout status |

The frontend talks to the backend at `NEXT_PUBLIC_API_URL` when that
variable is set at build time, and defaults to
`http://127.0.0.1:8000`.

## Demo Mode

Set `demo: true` in the analyze request, or click "Try Demo" on the landing page. Returns frozen pre-computed data with zero API calls. Output is identical on every run (verified).

## Deployment

### Frontend (Vercel)

```bash
cd frontend
vercel --prod
```

Or import the repo in the Vercel dashboard. Set `NEXT_PUBLIC_API_URL` to your backend URL.

### Backend (Render)

The repo ships a ready-made blueprint (`render.yaml`). Either deploy from
that blueprint, or create a Web Service manually:

1. Create a new Web Service from the repo
2. Root directory: `backend`
3. Build: `pip install -r requirements.txt`
4. Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add the environment variables from `.env.example` in the Render dashboard

## Key Design Decisions

- **No LLM in the money path.** The AI recommends share percentages. A human clicks "Execute." Deterministic backend code calls PayPal. The blast radius of an AI error is $0.
- **Demo mode is mandatory.** Built alongside the real path, not as an afterthought. Deterministic output verified across runs.
- **AG Grid is the audit layer.** Every Gemini evaluation — coalition members, score, reasoning, confidence — is displayed, sortable, and explorable. No black box.
- **N≤5 for live analysis.** Exact Shapley needs 2ⁿ coalition evaluations. Beyond 5, use Monte Carlo (implemented in `shapley.py`).

## License

MIT
