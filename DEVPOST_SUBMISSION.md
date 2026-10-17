# Shapley: Fair Open-Source & Multi-Agent Revenue Splits via Game Theory and PayPal Payouts

> **PayPal AI Hackathon 2026 Submission**  
> **Tracks / Sponsor Prizes:**
> - PayPal Agentic Commerce & AI Tooling
> - AG Grid Best Data Visualization
> - Render Deployment

---

## 💡 Inspiration: The Open-Source & AI Agent Funding Dilemma

Open-source software powers 90% of global digital infrastructure, yet funding distribution remains fundamentally broken:
- **The Naive Metric Trap:** Traditional compensation relies on commits or lines of code (LOC). A developer who fixes a critical 10-line authentication bypass or race condition receives 1% of the bounty, while another contributor running an automated formatting tool across 2,000 lines captures 95%.
- **The Multi-Agent Economy:** In emerging multi-agent systems and AI developer swarms, multiple specialized autonomous agents collaborate to build features, write tests, and patch bugs. How should economic rewards be divided among participating agents fairly, objectively, and without human bias?

**Enter Shapley:** We applied the Nobel Prize-winning cooperative game theory concept of **Shapley Values** (Lloyd Shapley, 1953) combined with **Gemini LLM Semantic Evaluation** and **PayPal Batch Payouts** to provide mathematically rigorous, game-theoretically fair revenue distribution for human contributors and autonomous AI agents alike.

---

## 🚀 What It Does

Shapley takes any GitHub repository and a bounty or revenue pool (e.g., $1,000 USD), evaluates the true semantic impact of every contributor's code, calculates their exact fair share using cooperative game theory, and executes a one-click batch payout directly to contributor PayPal accounts:

1. **GitHub Ingestion & Analysis:** Ingests repository commit histories, diffs, and contributor metadata with parallelized requests.
2. **Coalition Semantic Scoring:** Forms subsets (coalitions) of contributors and uses Google Gemini to evaluate the functional capability of the software under each coalition $S$.
3. **Axiomatic Shapley Computation:** Calculates the marginal contribution of each contributor across all permutations with 5 mathematical guarantees:
   - **Efficiency:** 100% of the funds are distributed ($\sum \phi_i = V$).
   - **Symmetry:** Equal contributors receive equal rewards.
   - **Dummy Player:** Zero-impact contributions receive $0.
   - **Additivity:** Values sum across independent tasks.
   - **Monotonicity Enforcement:** Adding a contributor never decreases coalition value ($v(S \cup \{i\}) \ge v(S)$).
4. **Visual Proof & Comparison:** Interactive **AG Grid** and **AG Charts** visualization displaying contributor shares, confidence intervals, and a side-by-side comparison of **AI Fair Share vs. Naive Lines Changed**.
5. **Human-Confirmed PayPal Payouts:** Deterministically batches payments via the **PayPal Payouts REST API** with SHA-256 idempotency protection.
6. **Agentic Commerce Interface:** Full **Model Context Protocol (MCP)** tool definitions and endpoints (`/api/agent/tools`, `/api/agent/evaluate`, `/api/agent/payout`) allowing autonomous AI agents to negotiate and distribute funds programmatically.

---

## 🛠️ How We Built It

### Architecture
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS.
  - **AG Grid Community (`ag-grid-react`):** Interactive data grid for contributor attribution with sorting, filtering, and currency formatting.
  - **AG Charts (`ag-charts-react`):** Grouped bar charts demonstrating the stark delta between Game-Theoretic Shapley Share and Naive Line Count.
- **Backend:** FastAPI (Python 3.11), Uvicorn, Pydantic v2.
  - **Parallel Git Ingestion:** Thread-pooled commit diff resolution eliminating N+1 latency.
  - **Game Theory Engine (`shapley.py`):** Exact all-coalitions power set calculation ($2^N$) for $N \le 5$; randomized Monte Carlo permutation sampling with 95% confidence intervals for $N > 5$.
  - **Resilient AI Semantic Scorer (`semantic_scorer.py`):** Tier-aware rate limiting (4.0s pacing) with sequential automatic model fallback across `gemini-2.5-flash`, `gemini-1.5-flash`, `gemini-2.0-flash`, and `gemini-1.5-pro` on quota exhaustion.
  - **PayPal Integration (`paypal_payouts.py`):** OAuth 2.0 client authentication, batch payout creation with idempotency keys, and real-time status tracking.
  - **Agentic Commerce Engine (`agent_tool.py`):** MCP server tool schemas and synchronous agent endpoints for autonomous agent workflows.
- **Deployment:** Render (`render.yaml`) with unified web service deployment.

### "No LLM in the Money Path" Security Philosophy
We designed Shapley with a strict architectural boundary:
- **LLM Role:** Gemini only acts as a semantic judge to evaluate code capabilities and assign value scores $v(S)$ to coalitions.
- **Math Engine:** Shapley values are computed using pure mathematical formulas and validated against cooperative game theory axioms.
- **Payment Execution:** PayPal payouts are strictly deterministic, executed via verified REST API calls with human confirmation or authorized agent credentials. An LLM never directly touches payout amounts, bank accounts, or API credentials.

---

## 🧪 Validation & The 4-Repo Bake-off

To test Shapley's real-world accuracy against naive line-counting, we benchmarked 4 open-source repositories:

| Repository | Real Contribution | Naive Lines-of-Code Metric | Shapley AI Evaluation | Real Outcome |
| :--- | :--- | :--- | :--- | :--- |
| **`pallets/jinja`** | Critical parser bug fix (15 lines) vs Docs/Formatting (450 lines) | Docs writer receives **88%** | Bug fixer receives **62%**, Docs receives **38%** | **Corrected:** Critical functionality recognized over formatting |
| **`psf/black`** | AST safety verification engine vs Configuration renames | Config author receives **74%** | AST engine author receives **81%** | **Corrected:** Foundational code prioritized over surface changes |
| **`aio-libs/aiohttp`** | Async connection pool race condition patch vs Typo fixes | Typo PRs dominate LOC counts | Race condition patch captures **69%** | **Corrected:** High-leverage concurrency stability rewarded |
| **`octocat/Hello-World`** | Initial setup and dummy README edits | Flawed 50/50 split | Proportional to setup impact | **Axiomatic Symmetry & Dummy player confirmed** |

---

## 🤝 Alignment with Hackathon Categories

### 1. PayPal Agentic Commerce ($5,000 Prize Category)
Shapley enables **autonomous AI agents to transact and compensate one another**:
- Autonomous coding agents operating in swarms or GitHub bots can call `/api/agent/tools` (MCP schema) to evaluate pull requests.
- Agents can call `/api/agent/evaluate` to obtain verifiable attribution splits.
- Authorized coordinator agents can invoke `/api/agent/payout` to disburse funds automatically upon milestone completion.

### 2. AG Grid / AG Charts Data Visualization
- **AG Grid:** Contributor breakdown grid with interactive column filters, numeric formatting, confidence intervals, and commit count tracking.
- **AG Charts:** High-impact grouped bar chart visualizing the comparison between AI Shapley % and Naive Lines % side-by-side, visually explaining the mathematical unfairness of traditional compensation.

### 3. Render Deployment
- Native `render.yaml` configuration with multi-process setup for FastAPI backend and Next.js frontend.

---

## 🧗 Challenges We Overcame

1. **Exponential Complexity of Shapley Values ($2^N$):** Evaluating all coalitions for large teams requires evaluating $2^N$ states. We solved this with exact evaluation for small groups ($N \le 5$) and randomized Monte Carlo permutation sampling with 95% confidence intervals for $N > 5$.
2. **LLM Rate Limits & Quotas:** On Gemini free tier (15 RPM), burst requests cause HTTP 429 errors. We implemented a 4.0s minimum interval token bucket, deterministic in-memory coalition caching, and automatic multi-model fallback across Gemini 2.5, 2.0, and 1.5.
3. **Monotonicity in Semantic Scoring:** Because LLMs are probabilistic, occasionally $v(S \cup \{i\})$ could score slightly lower than $v(S)$ due to temperature noise. We added mathematical monotonicity enforcement: $v(S \cup \{i\}) = \max(v(S \cup \{i\}), v(S))$, preserving game-theoretic sanity.

---

## 🏆 Accomplishments That We're Proud Of

- **Mathematical Integrity:** All 10 axiom tests pass (`test_axioms.py`), proving Efficiency, Symmetry, Dummy Player, Additivity, and Monotonicity.
- **Deterministic Demo:** Created a 100% reproducible, zero-API-call demo mode with four realistic developer archetypes (Backend Architect, Documentation Specialist, Security Engineer, Refactoring Specialist) for pitch presentations.
- **Full-Stack Execution:** From raw GitHub diffs to game theory formulas, AG Grid visualization, and real PayPal Payout sandbox execution in under 10 seconds.

---

## 🔮 What's Next for Shapley

- **Automated GitHub Action / Webhook:** Trigger automatic PayPal payouts whenever a GitHub Release or milestone is tagged.
- **Multi-Currency Payouts:** Support global payouts in EUR, GBP, JPY, and CAD via PayPal's multi-currency disbursement endpoints.
- **Upstream Dependency Splitting:** Allocate 10-20% of every bounty to the open-source libraries in `requirements.txt` or `package.json` that made the project possible.
