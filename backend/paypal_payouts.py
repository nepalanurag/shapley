#!/usr/bin/env python3
"""Shapley Phase 2.1: PayPal Payouts batch module.

Executes fair-share payouts via PayPal Payouts API with idempotency.
No LLM in this path: AI recommends shares, human confirms, this code executes.
"""
import json
import os
import sys
import time
import urllib.request
import uuid

ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")

def load_env():
    env = {}
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                line = line.strip()
                if line and "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k] = v
    return env

ENV = load_env()

import os
def env(key, default=None):
    """Read from os.environ first (Render/hosting), fall back to .env file."""
    return os.environ.get(key) or ENV.get(key, default)
PAYPAL_BASE = "https://api-m.sandbox.paypal.com"

# Token cache: avoid fetching new token per API call
_token_cache = {"token": None, "expires_at": 0}


def get_access_token():
    # Return cached token if still valid (with 60s buffer)
    if (_token_cache["token"] and
            time.time() < _token_cache["expires_at"] - 60):
        return _token_cache["token"]

    client_id = env("PAYPAL_CLIENT_ID")
    secret = env("PAYPAL_CLIENT_SECRET")
    if not client_id or not secret:
        raise RuntimeError("PAYPAL_CLIENT_ID/SECRET not set in .env")

    import base64
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
        # PayPal tokens typically last 32400s (9h); use expires_in if present
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


def create_batch_payout(shares, total_amount=None, idempotency_key=None):
    """Create a batch payout.

    Args:
        shares: list of {"email": str, "amount": float, "note": str}
        total_amount: optional total to validate against
        idempotency_key: optional; generated if not provided

    Returns:
        {"batch_id": str, "status": str}
    """
    # Validation
    if not shares:
        raise ValueError("No shares provided")
    if len(shares) > 100:
        raise ValueError(f"Too many recipients: {len(shares)} (max 100)")

    total = 0.0
    for s in shares:
        if "email" not in s or "amount" not in s:
            raise ValueError(f"Share missing email/amount: {s}")
        amt = float(s["amount"])
        if amt < 0.01:
            raise ValueError(f"Amount too small for {s['email']}: {amt}")
        total += amt

    if total_amount is not None and abs(total - total_amount) > 0.01:
        raise ValueError(
            f"Share total ${total:.2f} != expected ${total_amount:.2f}")

    batch_id = idempotency_key or f"shapley_{uuid.uuid4().hex[:12]}_{int(time.time())}"

    items = []
    for s in shares:
        items.append({
            "recipient_type": "EMAIL",
            "amount": {"value": f"{float(s['amount']):.2f}", "currency": "USD"},
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
    return {
        "batch_id": header.get("payout_batch_id"),
        "sender_batch_id": batch_id,
        "status": header.get("batch_status"),
    }


def get_payout_status(payout_batch_id):
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


def wait_for_completion(payout_batch_id, timeout_sec=120, poll_sec=5):
    """Poll until batch reaches a terminal state."""
    start = time.time()
    while time.time() - start < timeout_sec:
        status = get_payout_status(payout_batch_id)
        if status["status"] in ("SUCCESS", "DENIED", "CANCELED"):
            return status
        time.sleep(poll_sec)
    return get_payout_status(payout_batch_id)


if __name__ == "__main__":
    # Self-test: dry run validation only (no real payout without --execute)
    if "--execute" in sys.argv:
        print("Executing test payout...", file=sys.stderr)
        result = create_batch_payout([
            {"email": env("PAYPAL_SANDBOX_RECIPIENT_EMAIL", "test@example.com"),
             "amount": 0.50, "note": "Shapley test A"},
            {"email": env("PAYPAL_SANDBOX_RECIPIENT_EMAIL", "test@example.com"),
             "amount": 0.30, "note": "Shapley test B"},
            {"email": env("PAYPAL_SANDBOX_RECIPIENT_EMAIL", "test@example.com"),
             "amount": 0.20, "note": "Shapley test C"},
        ], total_amount=1.00)
        print(json.dumps(result, indent=2))
    else:
        print("Dry run OK. Use --execute to send a real sandbox payout.")
        # Validate logic without API call
        try:
            create_batch_payout([], total_amount=1.0)
        except ValueError as e:
            print(f"  Validation works: {e}")
