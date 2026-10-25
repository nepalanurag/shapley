# 0002: Integer-Cent Hare-Niemeyer Apportionment

Floating-point shares introduce fractional cent rounding mismatches where the sum of individual payouts does not equal the authorized grant pool. We scale all currency pools into integer cents and allocate them using the largest-remainder method (Hare-Niemeyer), ensuring exact conservation of funds down to $0.00 float dust across all batch disbursements.

## Status
Accepted

## Context
When fractional percentages are rounded to two decimal places, rounding artifacts cause the sum of recipient payouts to diverge from the total pool by $\pm \$0.01$ to $\pm \$0.05$. In automated financial settlement, even a 1-cent mismatch causes PayPal batch verification to fail or creates cumulative ledger drift.

## Consequences
- Every monetary amount in the settlement path is handled as integer cents.
- Remainder pennies are awarded deterministically to contributors with the largest fractional remainders, eliminating arbitrary favoritism.
- Fuzz tests prove conservation across 10,000 randomized property tests.
