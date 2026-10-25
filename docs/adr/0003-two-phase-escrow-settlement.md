# 0003: Two-Phase Escrow Settlement via Orders v2 and Payouts v1

Holding sponsor funds in a custodial escrow account introduces regulatory money transmitter liabilities and custody risk. We implement a non-custodial two-phase settlement architecture: Phase 1 creates a 29-day pre-authorized hold directly on the sponsor's payment source using PayPal Orders v2 (`intent: "AUTHORIZE"`), and Phase 2 disburses batch payouts via PayPal Payouts v1 once milestone dual-quorum criteria are met.

## Status
Accepted

## Context
Traditional escrow platforms act as financial intermediaries, taking custody of funds. This requires specialized banking licenses, KYC overhead, and exposes contributors to platform insolvency.

## Consequences
- Funds remain in the sponsor's account under a 29-day authorization hold until settlement consensus is reached.
- Contributors verify solvency before writing code via real-time PayPal Orders v2 status verification.
- If a milestone is rejected or cancelled within the dispute window, the authorization is voided without funds ever leaving the sponsor's account.
