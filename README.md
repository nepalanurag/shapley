# Shapley

**Fair revenue splits for collaborative work, calculated by AI, executed by PayPal.**

When 3-5 people collaborate on a project, splitting revenue fairly is impossible. Line counts don't measure impact — a 10-line security fix can be worth more than 500 lines of boilerplate. Shapley uses AI to semantically evaluate each contributor's actual impact, applies cooperative game theory (Shapley values) to calculate mathematically fair shares, and executes the split via PayPal Payouts.

Built for the PayPal AI Hackathon 2026.

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
│   ├── demo_data.py         # Frozen deterministic demo
│   └── cli.py               # CLI end-to-end demo
├── frontend/
│   └── src/app/
│       ├── page.tsx         # Landing + repo input
│       ├── results/page.tsx # Shapley breakdown + charts
│       └── audit/page.tsx   # Coalition evaluation log
└── PLAN.md
```

## Setup

### Backend

```bash
cd backend
pip install fastapi uvicorn pydantic

# Copy PayPal sandbox credentials
cp /path/to/.env .env
# .env needs: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET,
#             PAYPAL_SANDBOX_BUSINESS_EMAIL, PAYPAL_SANDBOX_RECIPIENT_EMAIL

# Run
python main.py
# API at http://localhost:8000
```

Credentials use the skill credential system:
- GitHub: `custom.github` via `dynamic_credentials`
- Gemini: `custom.google-gemini` via `dynamic_credentials`

### Frontend

```bash
cd frontend
npm install
npm run dev
# App at http://localhost:3000
```

Set `NEXT_PUBLIC_API_URL` to your backend URL (defaults to `http://localhost:8000`).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/demo` | Frozen demo data (deterministic) |
| POST | `/api/analyze` | Start analysis job `{repo_url, total_amount, demo}` |
| GET | `/api/analyze/{job_id}` | Poll job status |
| POST | `/api/payout` | Execute PayPal batch payout |
| GET | `/api/payout/{batch_id}` | Check payout status |

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

1. Create a new Web Service from the repo
2. Root directory: `shapley/backend`
3. Build: `pip install fastapi uvicorn pydantic`
4. Start: `python main.py`
5. Add environment variables from `.env`

## Key Design Decisions

- **No LLM in the money path.** The AI recommends share percentages. A human clicks "Execute." Deterministic backend code calls PayPal. The blast radius of an AI error is $0.
- **Demo mode is mandatory.** Built alongside the real path, not as an afterthought. Deterministic output verified across runs.
- **AG Grid is the audit layer.** Every Gemini evaluation — coalition members, score, reasoning, confidence — is displayed, sortable, and explorable. No black box.
- **N≤5 for live analysis.** Exact Shapley needs 2ⁿ coalition evaluations. Beyond 5, use Monte Carlo (implemented in `shapley.py`).

## License

MIT
