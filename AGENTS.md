# Shapley Protocol: Agent Guidelines

## Agent skills

### Issue tracker

GitHub issues on `nepalanurag/shapley`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context repository layout (`GLOSSARY.md` and `docs/adr/`). See `docs/agents/domain.md`.

---

## Architectural Principles

1. **Axiomatic Financial Rigor**: All payout calculations must maintain exact integer cent conservation via Hare-Niemeyer apportionment. Never allow float dust leakage.
2. **Deterministic Settlement**: Never allow LLMs directly into the funds-moving code path. Semantic AI scores coalition value; deterministic game theory calculates marginal shares; authenticated PayPal APIs move money with idempotency.
3. **Auditability**: All allocations must be verifiable via RFC 6962 Merkle tree proofs and AG Grid transparency layers.
