# Domain Glossary: Shapley Protocol

This glossary defines canonical terms used across the codebase, tests, documentation, and agent workflows.

### Characteristic Function $v(S)$
The real-valued utility function mapping any coalition subset $S \subseteq N$ of contributors to a collective value in $[0, 100]$. Satisfies boundary condition $v(\emptyset) = 0$ and monotonicity $S \subseteq T \implies v(S) \le v(T)$.

### Coalition
A subset $S$ drawn from the set of contributors $N$. For $N$ contributors, there are $2^N$ possible coalitions whose synergy is evaluated via semantic AST diff comprehension.

### Marginal Contribution
The delta in collective value produced when contributor $i$ joins a coalition $S$: $\Delta_i(S) = v(S \cup \{i\}) - v(S)$.

### Shapley Value $\phi_i(v)$
The unique payout share satisfying Efficiency, Dummy Player, Symmetry, and Additivity:
$$\phi_i(v) = \sum_{S \subseteq N \setminus \{i\}} \frac{|S|!(|N| - |S| - 1)!}{|N|!} (v(S \cup \{i\}) - v(S))$$

### Hare-Niemeyer Apportionment (Largest Remainder Method)
Exact-penny apportionment ensuring zero float loss:
1. Scale total pool to integer cents: $C = \lfloor P \times 100 \rceil$.
2. Compute baseline integer allocations: $c_i = \lfloor C \times \frac{\phi_i}{\sum \phi} \rfloor$.
3. Distribute remaining cents $R = C - \sum c_i$ one-by-one to contributors with the largest fractional remainders.
Guarantees $\sum c_i \equiv C$ to the exact cent ($0.00 dust leakage).

### Merkle Audit Tree (RFC 6962)
Cryptographically verifiable SHA-256 binary tree binding all coalition evaluations, contributor scores, and payout allocations into a root hash for immutable provenance verification.

### Orders v2 Authorization Hold
A 29-day pre-authorized escrow hold created via PayPal Orders v2 (`intent: "AUTHORIZE"`). Money is committed by the sponsor but remains locked until milestone acceptance criteria are satisfied.

### Payouts v1 Batch Disbursement
The PayPal Payouts v1 endpoint executing instant batch disbursement directly to contributor PayPal recipient emails with SHA-256 idempotency.

### Solvency Proof
A cryptographically verifiable certificate proving that hackathon or bounty escrow vaults are funded and held in an active PayPal authorization state before contributors begin work.
