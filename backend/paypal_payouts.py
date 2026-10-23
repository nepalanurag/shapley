#!/usr/bin/env python3
"""Shapley Phase 2.1: PayPal Payouts Batch Engine with Institutional Safeguards.

Executes fair-share payouts via PayPal Payouts API with:
  1. Exact-Penny validation via Hare-Niemeyer.
  2. Cryptographic SHA-256 Idempotency Key derivation.
  3. Replay Protection & Duplicate Execution Prevention.
  4. Financial Circuit Breakers (per-batch dollar ceiling, max recipient caps).
  5. Flat PayPal Fee Transparency ($0.25/item).
"""
import base64
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from typing import Dict, List, Optional, Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from financial_math import (
    usd_to_cents,
    cents_to_usd_str,
    amount_to_minor_units,
    minor_units_to_amount_str,
    currency_exponent,
)

ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")


def load_env():
    env_vars = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                line = line.strip()
                if line and "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip().strip("'\"")
    return env_vars


ENV = load_env()


def env(key, default=None):
    """Read from os.environ first (Render/hosting), fall back to .env file."""
    return os.environ.get(key) or ENV.get(key, default)


PAYPAL_BASE = "https://api-m.sandbox.paypal.com"

# Financial Circuit Breaker Limits
MAX_BATCH_AMOUNT_USD = float(env("SHAPLEY_MAX_BATCH_USD", "10000.0"))
MAX_RECIPIENTS = 100
MIN_RECIPIENT_AMOUNT_USD = 0.01
PAYPAL_ITEM_FEE_USD = 0.25

# Token and Batch Caches
_token_cache = {"token": None, "expires_at": 0}
_executed_batches: Dict[str, Dict[str, Any]] = {}


def generate_payout_idempotency_key(
    repo_url: str,
    commit_head: str,
    total_amount_usd: float,
    shares: List[Dict[str, Any]],
    merkle_root: Optional[str] = None
) -> str:
    """Derive a deterministic, collision-resistant idempotency key.

    SHA-256(repo_url || commit_head || total_cents || merkle_root || sorted_recipients_fingerprint).
    """
    total_cents = usd_to_cents(total_amount_usd)
    recipients_repr = "|".join(
        f"{s['email']}:{usd_to_cents(s['amount'])}"
        for s in sorted(shares, key=lambda x: x["email"])
    )
    root_str = merkle_root or "unanchored"
    raw_payload = f"{repo_url}:{commit_head}:{total_cents}:{root_str}:{recipients_repr}"
    digest = hashlib.sha256(raw_payload.encode("utf-8")).hexdigest()
    return f"shapley_{digest[:20]}"


def calculate_paypal_batch_fee(num_recipients: int) -> Dict[str, Any]:
    """Calculate flat PayPal batch fee transparency."""
    fee_per_item = PAYPAL_ITEM_FEE_USD
    total_fee = round(fee_per_item * num_recipients, 2)
    return {
        "fee_per_item_usd": fee_per_item,
        "recipient_count": num_recipients,
        "total_fee_usd": total_fee,
        "currency": "USD"
    }


def get_access_token():
    """Retrieve OAuth2 Bearer token from PayPal."""
    if (_token_cache["token"] and
            time.time() < _token_cache["expires_at"] - 60):
        return _token_cache["token"]

    client_id = env("PAYPAL_CLIENT_ID")
    secret = env("PAYPAL_CLIENT_SECRET")
    if not client_id or not secret:
        raise RuntimeError("PAYPAL_CLIENT_ID/SECRET not set in .env")

    creds = base64.b64encode(f"{client_id}:{secret}".encode()).decode()
    req = urllib.request.Request(
        f"{PAYPAL_BASE}/v1/oauth2/token",
        data=b"grant_type=client_credentials",
        headers={
            "Authorization": f"Basic {creds}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
        token = data["access_token"]
        expires_in = data.get("expires_in", 32400)
        _token_cache["token"] = token
        _token_cache["expires_at"] = time.time() + expires_in
        return token


def _friendly_paypal_error(code, body):
    """Translate PayPal API errors into user-friendly messages."""
    body_lower = body.lower()
    if "insufficient" in body_lower and "fund" in body_lower:
        return ("Insufficient PayPal sandbox balance. "
                "Add funds to your sandbox Business account at "
                "developer.paypal.com > Sandbox > Accounts.")
    if "payout_not_available" in body_lower:
        return ("Payouts not available for this account. "
                "Ensure your PayPal app has Payouts enabled and you're using "
                "a US-based Business sandbox account.")
    if "invalid" in body_lower and "email" in body_lower:
        return ("One or more recipient emails are invalid. "
                "Check the email addresses and try again.")
    if "duplicate" in body_lower or "already" in body_lower:
        return ("This payout appears to be a duplicate. "
                "Check the payout status instead of resubmitting.")
    return f"PayPal error ({code}): {body[:200]}"


def create_batch_payout(
    shares: List[Dict[str, Any]],
    total_amount: Optional[float] = None,
    idempotency_key: Optional[str] = None,
    currency: str = "USD"
) -> Dict[str, Any]:
    """Create a batch payout with institutional financial safeguards.

    All money is handled in integer minor units for `currency` (ISO 4217
    exponent: USD/EUR=2, JPY=0, ...); PayPal amount strings are formatted
    from those minor units via minor_units_to_amount_str, never from a
    float format spec.

    Args:
        shares: list of {"email": str, "amount": float, "note": str}
        total_amount: optional total to validate against
        idempotency_key: optional; generated if not provided
        currency: ISO 4217 currency code (default USD, the historical
            behaviour of this function)

    Returns:
        {"batch_id": str, "sender_batch_id": str, "status": str, "fee_usd": float}
    """
    if not shares:
        raise ValueError("No shares provided")
    if len(shares) > MAX_RECIPIENTS:
        raise ValueError(f"Too many recipients: {len(shares)} (max {MAX_RECIPIENTS})")

    # Minimum payable amount: 0.01 major units, at least 1 minor unit.
    min_minor = max(1, amount_to_minor_units(MIN_RECIPIENT_AMOUNT_USD, currency))
    total_cents = 0
    for s in shares:
        if "email" not in s or "amount" not in s:
            raise ValueError(f"Share missing email/amount: {s}")
        amt_cents = amount_to_minor_units(s["amount"], currency)
        if amt_cents < min_minor:
            raise ValueError(f"Amount too small for {s['email']}: {s['amount']}")
        total_cents += amt_cents

    calculated_total_str = minor_units_to_amount_str(total_cents, currency)
    calculated_total_usd = float(calculated_total_str)

    # Circuit breaker: maximum batch ceiling (denominated in the payout
    # currency's major units, as before for USD).
    if calculated_total_usd > MAX_BATCH_AMOUNT_USD:
        raise ValueError(
            f"Batch amount ${calculated_total_usd:.2f} exceeds financial ceiling of ${MAX_BATCH_AMOUNT_USD:.2f}"
        )

    if total_amount is not None:
        expected_cents = amount_to_minor_units(total_amount, currency)
        if total_cents != expected_cents:
            raise ValueError(
                f"Share total ${calculated_total_str} != expected ${total_amount:.2f}"
            )

    batch_id = idempotency_key or f"shapley_{uuid.uuid4().hex[:12]}_{int(time.time())}"

    # Replay protection: return cached batch if already executed
    if batch_id in _executed_batches:
        cached = _executed_batches[batch_id]
        return {
            **cached,
            "replayed": True,
            "message": "Idempotent response: batch already submitted."
        }

    items = []
    for s in shares:
        formatted_amt = minor_units_to_amount_str(
            amount_to_minor_units(s["amount"], currency), currency)
        items.append({
            "recipient_type": "EMAIL",
            "amount": {"value": formatted_amt, "currency": currency},
            "receiver": s["email"],
            "note": s.get("note", "Shapley fair-share payout")[:200],
            "sender_item_id": f"item_{uuid.uuid4().hex[:8]}",
        })

    payload = json.dumps({
        "sender_batch_header": {
            "sender_batch_id": batch_id,
            "email_subject": "You received a Shapley fair-share payout",
            "email_message": "Your share was calculated using AI-evaluated "
                             "Shapley values for fair revenue distribution.",
        },
        "items": items,
    }).encode()

    token = get_access_token()
    req = urllib.request.Request(
        f"{PAYPAL_BASE}/v1/payments/payouts",
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        raise RuntimeError(_friendly_paypal_error(e.code, body))

    header = result.get("batch_header", {})
    fee_data = calculate_paypal_batch_fee(len(shares))

    response_data = {
        "batch_id": header.get("payout_batch_id"),
        "sender_batch_id": batch_id,
        "status": header.get("batch_status"),
        "fee_usd": fee_data["total_fee_usd"],
        "total_disbursed_usd": round(calculated_total_usd + fee_data["total_fee_usd"], 2),
        "currency": currency,
        "total_minor_units": total_cents,
        "created_at": time.time(),
    }

    _executed_batches[batch_id] = response_data
    return response_data


def get_payout_status(payout_batch_id: str) -> Dict[str, Any]:
    """Get batch payout status and per-item details."""
    token = get_access_token()
    req = urllib.request.Request(
        f"{PAYPAL_BASE}/v1/payments/payouts/{payout_batch_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())

    items = []
    for item in result.get("items", []):
        pi = item.get("payout_item", {})
        items.append({
            "email": pi.get("receiver"),
            "amount": pi.get("amount", {}).get("value"),
            "currency": pi.get("amount", {}).get("currency"),
            "status": item.get("transaction_status"),
            "transaction_id": item.get("transaction_id"),
        })

    return {
        "batch_id": payout_batch_id,
        "status": result.get("batch_header", {}).get("batch_status"),
        "items": items,
    }


def wait_for_completion(payout_batch_id: str, timeout_sec: int = 120, poll_sec: int = 5) -> Dict[str, Any]:
    """Poll until batch reaches a terminal state."""
    start = time.time()
    while time.time() - start < timeout_sec:
        status = get_payout_status(payout_batch_id)
        if status["status"] in ("SUCCESS", "DENIED", "CANCELED"):
            return status
        time.sleep(poll_sec)
    return get_payout_status(payout_batch_id)


if __name__ == "__main__":
    if "--execute" in sys.argv:
        print("Executing test payout...", file=sys.stderr)
        res = create_batch_payout([
            {"email": env("PAYPAL_SANDBOX_RECIPIENT_EMAIL", "test@example.com"),
             "amount": 0.50, "note": "Shapley test A"},
            {"email": env("PAYPAL_SANDBOX_RECIPIENT_EMAIL", "test@example.com"),
             "amount": 0.30, "note": "Shapley test B"},
            {"email": env("PAYPAL_SANDBOX_RECIPIENT_EMAIL", "test@example.com"),
             "amount": 0.20, "note": "Shapley test C"},
        ], total_amount=1.00)
        print(json.dumps(res, indent=2))
    else:
        print("Dry run OK. Use --execute to send a real sandbox payout.")
        try:
            create_batch_payout([], total_amount=1.0)
        except ValueError as e:
            print(f"  Validation works: {e}")
