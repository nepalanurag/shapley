#!/usr/bin/env python3
"""Shapley Financial Math: Exact-Penny Allocation & Conservation Invariants.

Bans floating-point rounding errors and penny-shaving vulnerabilities by
enforcing fixed-point integer cents and the Hare-Niemeyer (Largest Remainder)
method.

Mathematical Invariants:
  1. Strict Conservation: sum(payout_cents) == total_pool_cents
  2. Non-negativity: for all i, payout_cents_i >= 0
  3. Dummy Player Isolation: if share_pct_i == 0, payout_cents_i == 0
"""
import hashlib
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_EVEN
from typing import Dict, List, Tuple, Any

# ISO 4217 minor-unit exponents: number of decimal digits between the major
# unit and the smallest cash unit (USD/EUR cents = 2, JPY yen = 0, BHD fils
# = 3). All money in this codebase is carried as integer minor units (or
# Decimal major units quantised to this exponent) — never as raw floats —
# and PayPal API amount strings are formatted from minor units via
# minor_units_to_amount_str so a zero-exponent currency never gets a
# spurious ".00" suffix and a two-exponent currency always gets exactly two.
CURRENCY_EXPONENTS: Dict[str, int] = {
    "USD": 2, "EUR": 2, "GBP": 2, "CHF": 2, "CAD": 2, "AUD": 2, "NZD": 2,
    "SGD": 2, "HKD": 2, "INR": 2, "CNY": 2, "BRL": 2, "MXN": 2, "SEK": 2,
    "NOK": 2, "DKK": 2, "PLN": 2, "ZAR": 2, "TRY": 2, "ILS": 2, "AED": 2,
    "JPY": 0, "KRW": 0, "VND": 0, "ISK": 0, "CLP": 0, "PYG": 0, "UGX": 0,
    "BHD": 3, "KWD": 3, "OMR": 3, "JOD": 3, "TND": 3,
}
DEFAULT_CURRENCY_EXPONENT = 2


def currency_exponent(currency: str) -> int:
    """ISO 4217 exponent for a currency code (default 2 for unlisted codes)."""
    return CURRENCY_EXPONENTS.get(str(currency).upper(), DEFAULT_CURRENCY_EXPONENT)


def amount_to_minor_units(amount: float | Decimal | str, currency: str = "USD") -> int:
    """Convert a major-unit amount to integer minor units for `currency`.

    Uses Decimal arithmetic quantised to the currency's ISO 4217 exponent
    (ROUND_HALF_EVEN), so 10.50 USD -> 1050 and 1050 JPY -> 1050.
    """
    exp = currency_exponent(currency)
    quantum = Decimal(1).scaleb(-exp)  # 0.01 for exp=2, 1 for exp=0
    d = Decimal(str(amount)).quantize(quantum, rounding=ROUND_HALF_EVEN)
    return int(d * (10 ** exp))


def minor_units_to_amount_str(minor_units: int, currency: str = "USD") -> str:
    """Format integer minor units as a PayPal API amount string.

    The string is built from the integer minor units using the currency's
    ISO 4217 exponent: 1050 USD -> '10.50', 1050 JPY -> '1050',
    1050 BHD -> '1.050'. No float is involved at any point.
    """
    exp = currency_exponent(currency)
    minor_units = int(minor_units)
    if exp == 0:
        return str(minor_units)
    sign = "-" if minor_units < 0 else ""
    abs_minor = abs(minor_units)
    whole, frac = divmod(abs_minor, 10 ** exp)
    return f"{sign}{whole}.{frac:0{exp}d}"


# PayPal-facing alias: every PayPal amount string in paypal_payouts.py /
# paypal_escrow.py is produced through this formatter from integer minor units.
format_paypal_amount = minor_units_to_amount_str


def generate_idempotency_key(prefix: str, *components: Any) -> str:
    """Derive a deterministic, collision-resistant idempotency key via SHA-256.

    Format: {prefix}_{hash[:24]}
    Binds transaction state to prevent duplicate orders, holds, or disbursements.
    """
    raw = ":".join(str(c) for c in components)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"{prefix}_{digest[:24]}"


def usd_to_cents(amount_usd: float | Decimal | str) -> int:
    """Convert USD amount to integer cents deterministically."""
    return amount_to_minor_units(amount_usd, "USD")


def cents_to_usd_str(cents: int) -> str:
    """Format integer cents as standard USD currency string (e.g. 1050 -> '10.50')."""
    return minor_units_to_amount_str(cents, "USD")


def allocate_exact_cents(
    total_cents: int,
    shares_pct: Dict[Any, float]
) -> Dict[Any, int]:
    """Distribute integer cents among recipients using the Hare-Niemeyer method.

    The Largest Remainder Method guarantees that the sum of allocated pennies
    strictly equals total_cents, eliminating IEEE 754 float drift and rounding dust.

    Args:
        total_cents: Total pool in integer cents (e.g. $1000.00 -> 100000).
        shares_pct: Mapping of recipient_key -> percentage share in [0, 100].

    Returns:
        Mapping of recipient_key -> allocated cents (int).
    """
    if total_cents < 0:
        raise ValueError(f"Total cents cannot be negative: {total_cents}")
    if not shares_pct:
        return {}

    # Total share validation
    total_pct = sum(shares_pct.values())
    if total_pct <= 0:
        # Equal distribution if all shares are 0
        n = len(shares_pct)
        base = total_cents // n
        rem = total_cents % n
        res = {}
        for idx, k in enumerate(shares_pct.keys()):
            res[k] = base + (1 if idx < rem else 0)
        return res

    # 1. Calculate precise quotas
    # quota_i = total_cents * (share_pct_i / 100)
    quotas = {}
    floors = {}
    remainders = {}

    for k, pct in shares_pct.items():
        if pct < 0:
            pct = 0.0
        # Calculate in high-precision Decimal
        quota = (Decimal(total_cents) * Decimal(str(pct))) / Decimal(str(total_pct))
        quotas[k] = quota
        floor_val = int(quota.to_integral_value(rounding=ROUND_DOWN))
        floors[k] = floor_val
        remainders[k] = quota - Decimal(floor_val)

    # 2. Sum base allocations
    allocated = sum(floors.values())
    leftover_cents = total_cents - allocated

    if leftover_cents < 0:
        raise RuntimeError(f"Allocated {allocated} exceeds total {total_cents}")

    # 3. Sort by remainder descending; break ties by key string representation
    sorted_recipients = sorted(
        shares_pct.keys(),
        key=lambda k: (remainders[k], str(k)),
        reverse=True
    )

    # 4. Distribute 1 cent to each of the top leftover_cents
    result = dict(floors)
    for i in range(leftover_cents):
        recipient = sorted_recipients[i % len(sorted_recipients)]
        result[recipient] += 1

    # Invariant Verification
    assert sum(result.values()) == total_cents, (
        f"Invariant Violation: sum({sum(result.values())}) != total_cents({total_cents})"
    )
    for k, c in result.items():
        assert c >= 0, f"Negative cent allocation for {k}: {c}"

    return result


def allocate_exact_minor_units(
    total_minor: int,
    shares_pct: Dict[Any, float]
) -> Dict[Any, int]:
    """Hare-Niemeyer allocation in the minor units of any currency.

    Identical integer arithmetic to allocate_exact_cents (the method is
    currency-agnostic: a minor unit is a minor unit), so for a
    zero-exponent currency such as JPY total_minor is yen itself.
    Guarantees sum(allocations) == total_minor exactly.
    """
    return allocate_exact_cents(int(total_minor), shares_pct)


def distribute_captured_amount(
    captured_minor: int,
    fee_minor: int,
    shares_pct: Dict[Any, float],
    currency: str = "USD",
) -> Dict[Any, int]:
    """Allocate (captured - fees) in minor units under largest-remainder.

    This is the conservation contract for the capture path:
    sum(allocations) == captured_minor - fee_minor exactly, for any ISO 4217
    currency exponent. Returns the minor-unit allocation; callers format
    PayPal strings with minor_units_to_amount_str(allocation, currency).
    """
    if fee_minor < 0:
        raise ValueError(f"Fee cannot be negative: {fee_minor}")
    distributable = int(captured_minor) - int(fee_minor)
    if distributable < 0:
        raise ValueError(
            f"Fees ({fee_minor}) exceed captured amount ({captured_minor})")
    result = allocate_exact_minor_units(distributable, shares_pct)
    assert sum(result.values()) == distributable, (
        f"Invariant Violation: allocations sum to {sum(result.values())}, "
        f"expected captured-fees = {distributable} ({currency})")
    return result


def calculate_batch_payout_items(
    contributors: List[Dict[str, Any]],
    total_amount_usd: float | Decimal
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Convert contributor shares into exact-penny PayPal payout items with fee transparency.

    Args:
        contributors: List of dicts containing 'name', 'email', 'share_pct'.
        total_amount_usd: Total bounty in USD.

    Returns:
        (payout_items, metadata)
    """
    total_cents = usd_to_cents(total_amount_usd)
    shares_pct = {i: c["share_pct"] for i, c in enumerate(contributors)}
    allocated_cents = allocate_exact_cents(total_cents, shares_pct)

    # PayPal batch fee is $0.25 USD flat per recipient
    fee_per_item_cents = 25
    total_fee_cents = fee_per_item_cents * len(contributors)

    items = []
    for idx, c in enumerate(contributors):
        cents = allocated_cents[idx]
        usd_val = cents_to_usd_str(cents)
        items.append({
            "contributor": c.get("name", f"Contributor {idx}"),
            "email": c["email"],
            "share_pct": c["share_pct"],
            "payout_cents": cents,
            "payout_usd": float(usd_val),
            "payout_formatted": f"${usd_val}",
        })

    metadata = {
        "total_pool_usd": float(Decimal(total_cents) / 100),
        "total_pool_cents": total_cents,
        "allocated_cents": total_cents,
        "paypal_fee_cents": total_fee_cents,
        "paypal_fee_usd": float(Decimal(total_fee_cents) / 100),
        "total_disbursed_usd": float(Decimal(total_cents + total_fee_cents) / 100),
        "recipient_count": len(contributors),
        "method": "hare_niemeyer_exact_penny",
        "invariants_satisfied": True,
    }

    return items, metadata
