# Shapley Demo Video Script (2:30 - 2:45)

> **Goal:** High-energy, visually compelling demonstration of Shapley for the PayPal AI Hackathon 2026.  
> **Key Themes:** The flaw of naive metrics, Cooperative Game Theory (Shapley Values), Gemini Semantic Evaluation, AG Grid & AG Charts visualization, PayPal Batch Payouts, and Agentic Commerce (MCP).

---

## ⏱️ Video Timeline & Shot List

```
0:00 - 0:25  | The Hook: The Open-Source Funding Paradox
0:25 - 0:50  | The Solution: Shapley Values + Gemini Semantic AI
0:50 - 1:35  | Live Demo: AG Grid & AG Charts "Fair Share vs. Naive Lines"
1:35 - 2:05  | One-Click PayPal Batch Payouts Execution
2:05 - 2:30  | Agentic Commerce: Autonomous AI Agent Payouts via MCP
2:30 - 2:45  | Vision & Call to Action
```

---

## 🎬 Detailed Script & Screen Actions

### [0:00 - 0:25] The Hook: The Open-Source Funding Paradox
- **Screen:** Show a GitHub PR with 2,000 lines of whitespace/formatting changes next to a 10-line security fix for an authentication bypass vulnerability.
- **Voiceover:**
  > "Open source software powers 90% of the world's digital infrastructure, but how we fund it is fundamentally broken.
  > If a sponsor donates $1,000 to a repo today, how do we split it?
  > If you count lines of code, a developer who runs an auto-linter across 2,000 lines gets $950. The engineer who spent 3 days tracking down a critical 10-line authentication bypass gets $15.
  > That's not just unfair — it's why open-source maintainers burn out."

---

### [0:25 - 0:50] The Solution: Shapley Values + Gemini Semantic AI
- **Screen:** Smooth transition to the Shapley landing page (`http://localhost:3000`). Highlight the tagline: *"Fair Open-Source & Multi-Agent Revenue Splits via Cooperative Game Theory."*
- **Voiceover:**
  > "Meet **Shapley**.
  > We brought Nobel Prize-winning cooperative game theory to code attribution.
  > Instead of counting lines, Shapley evaluates all possible combinations — or coalitions — of contributors.
  > Using Google Gemini, we evaluate what each coalition enables the software to do, and calculate each contributor's true marginal value.
  > It comes with mathematical guarantees: 100% efficiency, symmetry, and zero reward for zero impact."

---

### [0:50 - 1:35] Live Demo: AG Grid & AG Charts Visual Proof
- **Screen:**
  1. Click the **"pallets/jinja ($1,000)"** preset button on the home page.
  2. The analysis runs, displaying the **Results Page**.
  3. Zoom into the **AI Contribution Synthesis** banner at the top.
  4. Scroll to the **AG Grid** table showing contributors, emails, fair share %, and calculated USD payouts with 95% confidence intervals.
  5. Scroll to the **AG Charts** visualization: the side-by-side grouped bar chart comparing **"AI Shapley Fair %"** vs **"Lines Changed % (Naive)"**.
- **Voiceover:**
  > "Let's run a live analysis on a real repository with a $1,000 bounty pool.
  > In seconds, Shapley ingests the git diffs, analyzes the coalitions, and presents the audit results in an interactive AG Grid.
  > Look at this AG Chart comparing the naive line-count metric against Shapley's AI evaluation:
  > The developer who touched 1,500 lines of documentation and styling was awarded 75% under traditional metrics. But Shapley's game theory model reveals their true marginal value was 22%.
  > Meanwhile, the developer who wrote the core parser bug fix sees their share jump from 8% to 46%.
  > And notice our transparency: expand the 'How Shapley Math Works' card to see every evaluated coalition and mathematical proof."

---

### [1:35 - 2:05] One-Click PayPal Batch Payouts Execution
- **Screen:**
  1. Click **"Review & Execute Payout via PayPal"**.
  2. Modal opens displaying the itemized batch payout, recipient emails, and total sum ($1,000.00).
  3. Click **"Confirm & Disburse Funds"**.
  4. Instant success animation with green confirmation badge, PayPal Batch ID, and status `PENDING` / `SUCCESS`.
- **Voiceover:**
  > "Once the maintainer reviews the shares, executing payment takes one click.
  > We follow a strict 'No LLM in the Money Path' rule. Gemini only determines the attribution weights — the payment itself is 100% deterministic and cryptographically protected by SHA-256 idempotency keys.
  > Shapley calls the PayPal Payouts REST API to disburse funds simultaneously to every contributor's PayPal account in a single batch, with zero manual spreadsheet work."

---

### [2:05 - 2:30] Agentic Commerce: Autonomous AI Agent Payouts via MCP
- **Screen:**
  1. Switch to terminal or API schema view showing `GET /api/agent/tools` and `/api/agent/evaluate`.
  2. Show a simulated AI agent swarm (e.g. an autonomous code review agent or GitHub Action bot) invoking the endpoint and receiving structured JSON shares.
- **Voiceover:**
  > "We didn't just build this for humans. As autonomous AI developer agents and multi-agent swarms take over software development, agents need a way to fairly divide revenue amongst themselves.
  > Shapley exposes a full Model Context Protocol (MCP) server and agentic commerce API. Autonomous agents can discover Shapley's tools, evaluate repository contributions programmatically, and trigger PayPal disbursements autonomously."

---

### [2:30 - 2:45] Vision & Conclusion
- **Screen:** Return to the hero page showing the live badges: *Powered by PayPal Payouts • Google Gemini • AG Grid • Render*.
- **Voiceover:**
  > "Game-theoretic fairness for open-source maintainers.
  > Seamless economic infrastructure for the agentic economy.
  > That's Shapley — powered by PayPal and cooperative game theory.
  > Thank you!"

---

## 💡 Pitch Tips for Recording
- **Tone:** Confident, clear, and focused on the value proposition.
- **Resolution:** 1080p or 4K with 125% zoom on browser for maximum legibility of AG Grid cells and AG Chart bars.
- **Pointer:** Use an active cursor highlighter to draw attention to the chart comparison bars and the PayPal Batch ID.
