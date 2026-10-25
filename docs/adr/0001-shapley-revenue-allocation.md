# ADR-0001: Cooperative Game Theory & Exact-Penny Settlement

## Status
Accepted

## Context
Splitting shared revenue or grant bounties across open-source collaborators based on naive metrics (e.g. Lines of Code or raw commit counts) creates severe moral hazard and rewards boilerplate over high-leverage architectural or security contributions. Manual split negotiations lead to deadlock, while flat equal splits ignore asymmetric impact.

## Decision
1. **Game Theory Core**: Use Lloyd Shapley's cooperative game theory values to calculate the unique mathematically fair allocation satisfying all four fundamental axioms:
   - **Efficiency**: $\sum_{i \in N} \phi_i(v) = v(N)$ (100% of value distributed).
   - **Dummy Player**: Contributor with zero marginal contribution receives zero allocation.
   - **Symmetry**: Contributors with identical marginal contributions receive identical allocations.
   - **Monotonicity / Additivity**: Increasing a contributor's contribution cannot decrease their share.
2. **Semantic AST Scoring**: Evaluate coalition subsets $v(S)$ using semantic diff comprehension with strict prompt injection sanitization.
3. **Hare-Niemeyer Apportionment**: Apportion the monetary pool in integer cents via the largest remainder method to guarantee exact conservation of funds ($0.00 float dust loss).
4. **PayPal Settlement Architecture**:
   - Step 1: Sponsor locks grant funds into a 29-day authorization hold via PayPal Orders v2 API.
   - Step 2: Upon milestone approval, batch payouts are disbursed via PayPal Payouts v1 with SHA-256 idempotency keys.
   - Step 3: Every evaluation is hashed into an RFC 6962 Merkle tree proof.

## Consequences
- Requires evaluating $2^N$ coalitions (exact for $N \le 5$, PAC Monte Carlo antithetic sampling for $N > 5$).
- Eliminates float rounding bugs across international currency boundaries.
- Full cryptographic auditability for sponsors, maintainers, and contributors.
