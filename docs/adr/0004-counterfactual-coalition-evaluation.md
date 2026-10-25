# 0004: Counterfactual Coalition Evaluation vs Direct LLM Scorecards

Directly prompting an LLM to assign contributor percentage shares produces non-deterministic allocations vulnerable to prompt injection, Sybil gaming, and hallucinated scores. We evaluate all $2^N$ counterfactual contributor coalitions under characteristic function $v(S)$, calculating marginal shares deterministically via Lloyd Shapley's cooperative game theory formulation.

## Status
Accepted

## Context
LLMs excel at evaluating semantic code impact across unified diffs, but fail at global multi-party mathematical consistency. Single-prompt percentage allocations violate game-theoretic axioms (Efficiency, Dummy Player, Symmetry, and Monotonicity).

## Consequences
- Requires evaluating $2^N$ subsets ($2^4=16$ for $N=4$; PAC Monte Carlo antithetic sampling for $N > 5$).
- Enables automated Monotonicity shielding: $v(S \cup \{i\}) \ge v(S)$ is enforced algorithmically to neutralize temperature jitter.
- Provides granular coalition synergy audit logs in AG Grid, showing exactly how each engineer's presence impacts every possible sub-team.
