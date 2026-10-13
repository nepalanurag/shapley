# Shapley — Detailed Build Plan

## Project Overview

**Name:** Shapley
**Tagline:** Fair revenue splits for collaborative work, calculated by AI, executed by PayPal.
**Hackathon:** PayPal AI Hackathon 2026
**Deadline:** November 12, 2026, 12:00 PM Pacific
**Team:** Solo (Anurag Nepal)

### The Problem
When 3-5 people collaborate on a project (code, research, content), splitting revenue fairly is impossible. Line counts don't measure impact. A 10-line security fix can be worth more than 500 lines of boilerplate. Current tools (GitHub Sponsors, Open Collective) only do flat tips or manual splits.

### The Solution
Shapley uses AI to semantically evaluate each contributor's actual impact, applies cooperative game theory (Shapley values) to calculate mathematically fair shares, and executes the split via PayPal Payouts in a single batch transaction.

### Why It Wins
1. **AI is structurally essential.** Evaluating "this 10-line commit fixed a critical race condition" requires reading comprehension, not line counting.
2. **Stats moat.** Shapley values, Monte Carlo approximation, confidence calibration — this is data science, not prompt engineering.
3. **PayPal is the product.** Without batch Payouts, fair fractional splits are administratively impossible.
4. **Novel.** Zero existing products combine semantic evaluation with game-theoretic payouts.

---

## Technical Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Next.js   │────▶│   FastAPI    │────▶│   Gemini    │
│  + AG Grid  │     │   Backend    │     │   API       │
│  Frontend   │◀────│              │     │             │
└─────────────┘     │  ┌────────┐  │     └─────────────┘
                    │  │Shapley │  │
                    │  │ Engine │  │     ┌─────────────┐
                    │  └────────┘  │────▶│  GitHub     │
                    │              │     │  API        │
                    │  ┌────────┐  │     └─────────────┘
                    │  │ PayPal │  │
                    │  │Payouts │  │     ┌─────────────┐
                    │  └────────┘  │────▶│  PayPal     │
                    └──────────────┘     │  Payouts    │
                                         └─────────────┘
```

### Backend (`~/workspace/shapley/backend/`)
- `main.py` — FastAPI app, REST endpoints
- `github_ingest.py` — Pull commits, diffs, contributor mapping via GitHub API
- `semantic_scorer.py` — Gemini function-calling for coalition value estimation
- `shapley.py` — Exact Shapley computation + Monte Carlo approximation
- `paypal_payouts.py` — Batch payout execution with idempotency
- `models.py` — Pydantic models for API contracts
- `demo_data.py` — Frozen demo scenario for deterministic demo

### Frontend (`~/workspace/shapley/frontend/`)
- Next.js 14+ with App Router
- AG Grid Community for coalition matrix
- AG Charts Community for Shapley distribution visualization
- Pages:
  - `/` — Landing + repo URL input
  - `/analyze` — AG Grid showing contributors, commits, AI scores
  - `/results` — Shapley values, payout breakdown, confidence intervals
  - `/audit` — Full coalition evaluation log (transparency layer)

### Data Flow
1. User pastes GitHub repo URL + PayPal recipient emails per contributor
2. Backend pulls last N commits via GitHub API
3. For each coalition subset, Gemini scores the combined semantic value
4. Shapley engine computes each contributor's marginal contribution
5. Frontend displays results in AG Grid with confidence scores
6. User clicks "Execute Payout" → PayPal Payouts batch API
7. Audit trail logged and displayed

---

## Phase 1: Core Engine (Week 1: Oct 13–19)

### 1.1 GitHub Ingestion Module
**File:** `backend/github_ingest.py`
**Done when:** `python github_ingest.py <repo_url>` prints contributor list with commit SHAs and diffs.

- [ ] GitHub API client with `custom.github` credential
- [ ] Fetch commits for a repo (paginated, last 50)
- [ ] Map commits to contributors (author email → name)
- [ ] Fetch file diffs per commit (patch data)
- [ ] Filter: exclude merge commits, bot commits
- [ ] Group commits by contributor
- [ ] Output: `{contributor: {email, commits: [{sha, message, diff, additions, deletions}]}}`
- [ ] Test against 3 real repos (small, medium, large)

### 1.2 Semantic Scoring Function
**File:** `backend/semantic_scorer.py`
**Done when:** Scoring 5 sample coalitions produces differentiated, reasoned scores.

- [ ] Gemini API client with `custom.google-gemini` credential
- [ ] `score_coalition(coalition_diffs: list[str]) -> {score: float, reasoning: str, confidence: float}`
- [ ] Prompt engineering: structured JSON output, temperature 0.1
- [ ] Input: concatenated diffs for a coalition subset
- [ ] Output: 0-100 semantic value score + 2-sentence reasoning + confidence 0-1
- [ ] Caching: coalition → score (avoid redundant API calls)
- [ ] Rate limiting: max 1 call/sec to avoid 503s
- [ ] Test: score empty coalition (should be 0), single contributors, full team

### 1.3 Shapley Computation
**File:** `backend/shapley.py`
**Done when:** `python shapley.py` computes correct values for test cases with known answers.

- [ ] `exact_shapley(n, value_func)` — enumerate all 2^n coalitions
- [ ] `monte_carlo_shapley(n, value_func, samples)` — for N > 5
- [ ] Coalition caching to minimize Gemini calls
- [ ] Input validation: N between 2 and 8
- [ ] Output: `{contributor: {shapley_value, share_pct, marginal_contributions: [...]}}`
- [ ] Unit tests with mock value functions (known Shapley values)
- [ ] Performance: N=5 should complete in <5 minutes

### 1.4 CLI Demo
**File:** `backend/cli.py`
**Done when:** `python cli.py <repo_url>` prints Shapley splits without errors.

- [ ] End-to-end: ingest → score → compute → display
- [ ] Pretty-printed table of results
- [ ] Save results to JSON for frontend consumption
- [ ] Handle errors gracefully (API failures, empty repos, etc.)

---

## Phase 2: PayPal Integration (Week 2: Oct 20–26)

### 2.1 Payouts Module
**File:** `backend/paypal_payouts.py`
**Done when:** Test batch payout succeeds in sandbox with 3+ recipients.

- [ ] PayPal OAuth with existing sandbox credentials (`.env`)
- [ ] `create_batch_payout(shares: dict[email, amount]) -> batch_id`
- [ ] Idempotency: `sender_batch_id` prevents duplicate payouts
- [ ] Amount validation: sum of shares = total, min $0.01 per recipient
- [ ] Currency: USD only for hackathon
- [ ] `get_payout_status(batch_id)` — poll until complete
- [ ] Error handling: insufficient funds, invalid email, API errors

### 2.2 FastAPI Endpoints
**File:** `backend/main.py`
**Done when:** All endpoints respond correctly via curl.

- [ ] `POST /api/analyze` — Accept repo URL, return job ID (async)
- [ ] `GET /api/analyze/{job_id}` — Poll for results
- [ ] `POST /api/payout` — Accept shares + total amount, execute payout
- [ ] `GET /api/payout/{batch_id}` — Check payout status
- [ ] `GET /api/demo` — Return frozen demo data
- [ ] CORS configured for frontend
- [ ] Request/response logging

### 2.3 Demo Mode
**File:** `backend/demo_data.py`
**Done when:** Demo produces identical output on every run.

- [ ] Frozen: 4 contributors, 20 commits, pre-computed Gemini scores
- [ ] Frozen: Shapley values, payout amounts
- [ ] `DEMO_MODE=true` env var switches to frozen data
- [ ] No API calls in demo mode (deterministic)

---

## Phase 3: Frontend (Week 3: Oct 27 – Nov 2)

### 3.1 Project Setup
- [ ] Next.js 14+ with TypeScript, Tailwind
- [ ] Install `ag-grid-community`, `ag-grid-react`
- [ ] Install `ag-charts-community`, `ag-charts-react`
- [ ] Read breaking change docs before writing code (per `frontend/AGENTS.md` rule)

### 3.2 Landing Page (`/`)
- [ ] Hero: "Fair splits for collaborative work"
- [ ] Input: GitHub repo URL
- [ ] Input: Total payout amount ($)
- [ ] Input: Contributor PayPal emails (dynamic list)
- [ ] Button: "Analyze Contributions"
- [ ] Demo mode toggle

### 3.3 Analysis Page (`/analyze`)
- [ ] AG Grid: Contributors × Commits matrix
  - Columns: Contributor, Commits, Lines +/-, AI Score, Reasoning
  - Sortable, filterable
- [ ] Loading state with progress (coalition X of Y evaluated)
- [ ] Error handling for API failures

### 3.4 Results Page (`/results`)
- [ ] AG Grid: Final Shapley breakdown
  - Columns: Contributor, Shapley Value, Share %, Payout Amount, Confidence
- [ ] AG Charts: Bar chart of Shapley distribution
- [ ] AG Charts: Coalition value visualization
- [ ] "Execute Payout" button → confirmation modal → PayPal batch
- [ ] Payout status polling and display

### 3.5 Audit Page (`/audit`)
- [ ] AG Grid: Full coalition evaluation log
  - Columns: Coalition, Members, AI Score, Reasoning, API Latency
- [ ] Transparency: every Gemini call logged and displayed
- [ ] Export audit trail as JSON/CSV

---

## Phase 4: Polish & Submission (Week 4: Nov 3–12)

### 4.1 Testing
- [ ] End-to-end test with real repo (SahiSend itself)
- [ ] PayPal sandbox payout verified
- [ ] Demo mode produces identical output 3x in a row
- [ ] Mobile responsive check
- [ ] Error paths tested (bad URL, API down, etc.)

### 4.2 Deployment
- [ ] Frontend → Vercel
- [ ] Backend → Render
- [ ] Environment variables configured
- [ ] CORS origins updated for production
- [ ] Health check endpoints

### 4.3 Devpost Submission
- [ ] Project title, tagline, description
- [ ] Demo video (3 min max): problem → solution → live demo
- [ ] Screenshots: landing, analysis grid, results chart, audit trail
- [ ] GitHub repo link (make public at submission)
- [ ] "Built with" tags: PayPal Payouts API, Gemini, AG Grid, Next.js, FastAPI

### 4.4 README
- [ ] Problem statement
- [ ] How it works (with Shapley math explained)
- [ ] Tech stack
- [ ] Setup instructions
- [ ] Demo instructions
- [ ] Architecture diagram

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Gemini API 503s during demo | Medium | High | Demo mode with frozen data; retry logic with backoff |
| Shapley takes too long live | Low | Medium | N≤5 cap; show progress; pre-compute in demo |
| Prompt injection in code | Low | High | Sanitize diffs; system prompt isolation; human confirms before payout |
| PayPal sandbox down | Low | High | Demo mode; video backup |
| Judges don't understand Shapley | Medium | Medium | Landing page explains simply; "fairness math" not "game theory" |

---

## Success Criteria

**Minimum viable (must have for submission):**
- [ ] User pastes repo URL → sees AI-scored Shapley splits
- [ ] AG Grid displays coalition matrix and results
- [ ] PayPal sandbox payout executes successfully
- [ ] Demo mode works deterministically

**Stretch (nice to have):**
- [ ] Monte Carlo approximation for N=6-8
- [ ] Confidence calibration visualization
- [ ] Multi-repo comparison
- [ ] Contributor dispute/appeal flow

---

## Key Decisions (Locked)

- **Solo build.** No collaborators.
- **Repo private until submission.** Prevent copying.
- **PayPal Payouts for execution.** Orders API not needed (no buyer/seller).
- **Gemini for semantic scoring.** Claude as fallback only.
- **N≤5 for live demo.** Larger teams use Monte Carlo (stretch).
- **Demo mode is mandatory.** Not an afterthought — built in Phase 2.
- **No LLM in money path.** AI recommends shares; human clicks "Execute"; backend calls PayPal deterministically.
- **AG Grid is the audit layer.** Every AI decision is visible, explorable, exportable.
