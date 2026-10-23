#!/usr/bin/env python3
"""Validation: Phase 2 Hardening — Failure Modes.

Tests:
1. Webhook verification via PayPal's verify-webhook-signature API with a
   mocked HTTP layer: valid signature accepted, forged rejected, and a
   duplicate verified event processed exactly once by the HTTP handler.
2. Demo/fixture webhook path labels results unverified, never verified.
3. Every PayPal write call (order create, capture, void, payout create)
   carries a deterministic PayPal-Request-Id, stable across retries.
4. Sandbox-only guard: live base host or PAYPAL_MODE=live refuses at
   client init (subprocess) and via the guard function; sandbox passes.
5. Fixture replay (PAYPAL_FIXTURE_REPLAY=1): the escrow demo flow
   (create authorization -> capture -> payout -> status, plus void)
   completes with the base URL pointed at an unroutable host and the
   network hard-disabled, byte-identical across two runs excluding the
   named wall-clock fields `released_at`, `created_at`, and `voided_at`.
6. Log/PII audit: no log/print statement in backend/ references email,
   token, secret, password, or raw error-body variables; no hard-coded
   sandbox account email (sb-*@) remains in backend source.
7. .env.example completeness: every env var read in backend/ is listed.
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import urllib.request
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(BACKEND_DIR)

import paypal_payouts
import paypal_escrow
from paypal_escrow import PayPalEscrowManager
from paypal_payouts import get_payout_status

WEBHOOK_HEADERS = {
    "PAYPAL-TRANSMISSION-ID": "84920412-8821-4190-b183",
    "PAYPAL-TRANSMISSION-TIME": "2026-10-17T08:00:00Z",
    "PAYPAL-CERT-URL": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1234",
    "PAYPAL-AUTH-ALGO": "SHA256withRSA",
    "PAYPAL-TRANSMISSION-SIG": "MEUCIQC1x824...",
}


class _FakeResp:
    def __init__(self, payload=None, status=200, raw=b""):
        self.status = status
        self._body = raw if payload is None else json.dumps(payload).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _verify_transport(req, timeout=30):
    if "/v1/oauth2/token" in req.full_url:
        return _FakeResp({"access_token": "TEST-TOKEN", "expires_in": 32400})
    if "/v1/notifications/verify-webhook-signature" in req.full_url:
        payload = json.loads(req.data.decode("utf-8"))
        status = "FAILURE" if payload["transmission_sig"] == "FORGED" else "SUCCESS"
        return _FakeResp({"verification_status": status})
    raise AssertionError(f"Unexpected URL: {req.full_url}")


def _header(req, name):
    for k, v in req.headers.items():
        if k.lower() == name.lower():
            return v
    return None


# ---------------------------------------------------------------- webhook

def test_webhook_handler_valid_forged_duplicate():
    """Handler: valid signature processed once; duplicate is a no-op;
    forged signature rejected with 401 and never recorded as seen."""
    import main as backend_main
    from fastapi import HTTPException

    class StubRequest:
        def __init__(self, body, headers):
            self._body = body
            self.headers = headers

        async def body(self):
            return self._body

    event = json.dumps({"id": "WH-EVENT-PHASE2-001",
                        "event_type": "PAYMENT.AUTHORIZATION.CREATED"}).encode()
    backend_main._seen_webhook_event_ids.discard("WH-EVENT-PHASE2-001")
    with mock.patch.dict(os.environ, {"PAYPAL_WEBHOOK_ID": "TEST-WEBHOOK-ID"}):
        with mock.patch.object(urllib.request, "urlopen", _verify_transport):
            first = asyncio.run(backend_main.paypal_webhook(StubRequest(event, dict(WEBHOOK_HEADERS))))
            assert first["status"] == "SUCCESS" and first["verified"] is True

            second = asyncio.run(backend_main.paypal_webhook(StubRequest(event, dict(WEBHOOK_HEADERS))))
            assert second["status"] == "DUPLICATE" and second["verified"] is True
            assert list(backend_main._seen_webhook_event_ids).count("WH-EVENT-PHASE2-001") == 1

            forged_headers = dict(WEBHOOK_HEADERS, **{"PAYPAL-TRANSMISSION-SIG": "FORGED"})
            forged_event = json.dumps({"id": "WH-EVENT-PHASE2-FORGED",
                                       "event_type": "PAYMENT.AUTHORIZATION.CREATED"}).encode()
            try:
                asyncio.run(backend_main.paypal_webhook(StubRequest(forged_event, forged_headers)))
                assert False, "Forged webhook must be rejected"
            except HTTPException as e:
                assert e.status_code == 401
            assert "WH-EVENT-PHASE2-FORGED" not in backend_main._seen_webhook_event_ids


def test_webhook_demo_path_labels_unverified():
    """Fixture-replay webhook: processed in demo context but reported
    verified: False with verification='unverified_demo' — never true."""
    import main as backend_main

    class StubRequest:
        def __init__(self, body, headers):
            self._body = body
            self.headers = headers

        async def body(self):
            return self._body

    event = json.dumps({"id": "WH-EVENT-PHASE2-DEMO",
                        "event_type": "PAYMENT.AUTHORIZATION.CREATED"}).encode()
    backend_main._seen_webhook_event_ids.discard("WH-EVENT-PHASE2-DEMO")
    with mock.patch.dict(os.environ, {"PAYPAL_FIXTURE_REPLAY": "1"}):
        res = asyncio.run(backend_main.paypal_webhook(StubRequest(event, dict(WEBHOOK_HEADERS))))
    assert res["verified"] is False
    assert res["verification"] == "unverified_demo"


# ------------------------------------------------------------- idempotency

def _write_transport(captured):
    def transport(req, timeout=30):
        captured.append(req)
        url = req.full_url
        if "/v1/oauth2/token" in url:
            return _FakeResp({"access_token": "TEST-TOKEN", "expires_in": 32400})
        if url.endswith("/v2/checkout/orders"):
            return _FakeResp({"id": "ORDER123456789", "status": "CREATED",
                              "links": [{"rel": "approve",
                                         "href": "https://www.sandbox.paypal.com/checkoutnow?token=ORDER123456789"}]})
        if url.endswith("/capture"):
            return _FakeResp({"id": "CAPTURE123", "status": "COMPLETED"})
        if url.endswith("/void"):
            return _FakeResp(None, status=204)
        if url.endswith("/v1/payments/payouts"):
            return _FakeResp({"batch_header": {"payout_batch_id": "BATCH123",
                                                 "batch_status": "PENDING"}})
        raise AssertionError(f"Unexpected URL: {url}")
    return transport


def _run_write_flow():
    captured = []
    with mock.patch.object(urllib.request, "urlopen", _write_transport(captured)):
        mgr = PayPalEscrowManager()
        order = mgr.create_orders_v2_authorization(
            repo_url="pallets/jinja", pool_usd=100.0, phase_id="phase1")
        mgr.capture_authorization(order["escrow_id"],
                                  [{"email": "a@example.com", "amount": 100.0}])
        mgr2 = PayPalEscrowManager()
        mgr2.void_authorization("ESCROW-PP-JINJA-02", "test dispute")
    writes = []
    for req in captured:
        if req.get_method() != "POST":
            continue
        if "/v1/oauth2/token" in req.full_url:
            continue  # credential grant, not a state-mutating business write
        writes.append((req.full_url, _header(req, "PayPal-Request-Id")))
    return writes


def test_all_writes_carry_stable_request_id():
    """Every PayPal write carries a PayPal-Request-Id, and the keys are
    deterministic: a full retry of the same logical operations reuses
    exactly the same keys."""
    paypal_payouts._executed_batches.clear()
    writes1 = _run_write_flow()
    paypal_payouts._executed_batches.clear()
    paypal_payouts._token_cache["token"] = None
    writes2 = _run_write_flow()

    kinds = set()
    for url, key in writes1:
        assert key, f"Missing PayPal-Request-Id on write to {url}"
        if url.endswith("/v2/checkout/orders"):
            kinds.add("order")
        elif url.endswith("/capture"):
            kinds.add("capture")
        elif url.endswith("/void"):
            kinds.add("void")
        elif url.endswith("/v1/payments/payouts"):
            kinds.add("payout")
    assert kinds == {"order", "capture", "void", "payout"}, f"Writes seen: {kinds}"
    assert writes1 == writes2, f"Request ids not stable across retries:\n{writes1}\n{writes2}"


# ------------------------------------------------------------ sandbox guard

def test_sandbox_only_guard():
    """Live PayPal host or live mode refuses; sandbox passes."""
    for kwargs in ({"base_url": "https://api-m.paypal.com"},
                   {"mode": "live"},
                   {"mode": "production"}):
        try:
            paypal_payouts.assert_sandbox_only(**kwargs)
            assert False, f"Guard must refuse {kwargs}"
        except RuntimeError as e:
            assert "sandbox-only" in str(e)
    paypal_payouts.assert_sandbox_only("https://api-m.sandbox.paypal.com", "sandbox")

    # Client init (module import) hard-fails in a fresh interpreter.
    for extra in ({"PAYPAL_MODE": "live"},
                  {"PAYPAL_BASE_URL": "https://api-m.paypal.com"}):
        env = dict(os.environ, **extra)
        proc = subprocess.run([sys.executable, "-c", "import paypal_payouts"],
                              cwd=BACKEND_DIR, env=env, capture_output=True, text=True)
        assert proc.returncode != 0, f"Import must fail with {extra}"
        assert "sandbox-only" in proc.stderr, proc.stderr[-500:]
    proc = subprocess.run([sys.executable, "-c", "import paypal_payouts"],
                          cwd=BACKEND_DIR, env=dict(os.environ),
                          capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr[-500:]


# ----------------------------------------------------------- fixture replay

# Wall-clock timestamp fields excluded from the byte-identity comparison:
# `released_at` (capture result), `created_at` (payout batch record),
# `voided_at` (void result). Everything else must be byte-identical.
WALL_CLOCK_FIELDS = {"released_at", "created_at", "voided_at"}


def _strip_wall_clock(obj):
    if isinstance(obj, dict):
        return {k: _strip_wall_clock(v) for k, v in obj.items()
                if k not in WALL_CLOCK_FIELDS}
    if isinstance(obj, list):
        return [_strip_wall_clock(v) for v in obj]
    return obj


def _replay_flow():
    paypal_payouts._executed_batches.clear()
    mgr = PayPalEscrowManager()
    order = mgr.create_orders_v2_authorization(
        repo_url="pallets/jinja", pool_usd=100.0, phase_id="phase1")
    capture = mgr.capture_authorization(order["escrow_id"], [
        {"email": "a@example.com", "amount": 60.0},
        {"email": "b@example.com", "amount": 40.0},
    ])
    status = get_payout_status(capture["payout_batch_id"])
    mgr2 = PayPalEscrowManager()
    void = mgr2.void_authorization("ESCROW-PP-JINJA-02", "replay dispute")
    return {"order": order, "capture": capture, "payout_status": status, "void": void}


def test_fixture_replay_offline_flow():
    """With PAYPAL_FIXTURE_REPLAY=1 and an unroutable base URL (and the
    real network hard-disabled), create -> capture -> payout -> status
    and void all complete from fixtures, byte-identical across runs."""
    def _no_network(req, timeout=30):
        raise AssertionError("Network must not be touched in fixture replay")

    old_payouts_base = paypal_payouts.PAYPAL_BASE
    old_escrow_base = paypal_escrow.PAYPAL_BASE
    try:
        paypal_payouts.PAYPAL_BASE = "https://unroutable.invalid"
        paypal_escrow.PAYPAL_BASE = "https://unroutable.invalid"
        with mock.patch.dict(os.environ, {"PAYPAL_FIXTURE_REPLAY": "1"}):
            with mock.patch.object(urllib.request, "urlopen", _no_network):
                run1 = _replay_flow()
                run2 = _replay_flow()
    finally:
        paypal_payouts.PAYPAL_BASE = old_payouts_base
        paypal_escrow.PAYPAL_BASE = old_escrow_base

    assert run1["order"]["status"] == "CREATED"
    assert "https://www.sandbox.paypal.com/checkoutnow" in run1["order"]["approval_url"]
    assert run1["capture"]["status"] == "RELEASED"
    assert run1["capture"]["live_paypal_captured"] is True
    assert run1["payout_status"]["status"] == "SUCCESS"
    assert run1["void"]["status"] == "VOIDED_REFUNDED"
    assert run1["void"]["live_paypal_voided"] is True

    blob1 = json.dumps(_strip_wall_clock(run1), sort_keys=True)
    blob2 = json.dumps(_strip_wall_clock(run2), sort_keys=True)
    assert blob1 == blob2, f"Replay runs differ:\n{blob1}\n{blob2}"


# -------------------------------------------------------------- log / PII

def test_no_pii_in_logs():
    """Grep-based check: no print/log statement in backend/ references
    emails, tokens, secrets, passwords, or raw error bodies, and no
    hard-coded sandbox account email remains in backend source."""
    forbidden = re.compile(
        r"(email|access_token|client_secret|password|err_body)", re.IGNORECASE)
    callsite = re.compile(r"(log\.|logger\.|print\()")
    sandbox_email = re.compile(r"sb-[A-Za-z0-9]+@")
    offenders = []
    for name in os.listdir(BACKEND_DIR):
        if not name.endswith(".py"):
            continue
        path = os.path.join(BACKEND_DIR, name)
        with open(path) as f:
            for lineno, line in enumerate(f, 1):
                if sandbox_email.search(line):
                    offenders.append(f"{name}:{lineno}: hard-coded sandbox email")
                if callsite.search(line) and forbidden.search(line):
                    offenders.append(f"{name}:{lineno}: {line.strip()[:100]}")
    assert not offenders, "PII in log/print sites:\n" + "\n".join(offenders)


# ------------------------------------------------------------ .env.example

# Every environment variable read anywhere in backend/ (os.environ.get /
# os.getenv / paypal env() helper / pydantic-style constants), enumerated
# by grep over backend/*.py.
EXPECTED_ENV_VARS = [
    "ALLOWED_ORIGINS", "DEMO_MODE", "ENVIRONMENT", "FRONTEND_URL",
    "GEMINI_API_KEY", "GEMINI_MIN_INTERVAL", "GEMINI_MODEL",
    "GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET", "GITHUB_TOKEN",
    "PAYOUT_CONFIRM_TOKEN", "PAYPAL_BASE_URL", "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET", "PAYPAL_FIXTURE_REPLAY", "PAYPAL_MODE",
    "PAYPAL_SANDBOX_BUSINESS_EMAIL", "PAYPAL_SANDBOX_RECIPIENT_EMAIL",
    "PAYPAL_WEBHOOK_ID", "SHAPLEY_MAX_BATCH_USD",
]


def test_env_example_completeness():
    with open(os.path.join(REPO_ROOT, ".env.example")) as f:
        content = f.read()
    listed = set(re.findall(r"^([A-Z][A-Z0-9_]*)=", content, re.MULTILINE))
    missing = [v for v in EXPECTED_ENV_VARS if v not in listed]
    assert not missing, f".env.example is missing: {missing}"


if __name__ == "__main__":
    print("[*] Running Phase 2 Hardening (Failure Modes) Tests...")
    _tests = [
        ("test_webhook_handler_valid_forged_duplicate", test_webhook_handler_valid_forged_duplicate),
        ("test_webhook_demo_path_labels_unverified", test_webhook_demo_path_labels_unverified),
        ("test_all_writes_carry_stable_request_id", test_all_writes_carry_stable_request_id),
        ("test_sandbox_only_guard", test_sandbox_only_guard),
        ("test_fixture_replay_offline_flow", test_fixture_replay_offline_flow),
        ("test_no_pii_in_logs", test_no_pii_in_logs),
        ("test_env_example_completeness", test_env_example_completeness),
    ]
    for _label, _fn in _tests:
        _fn()
        print(f"  [+] PASS: {_label}")
    print("ALL PHASE 2 HARDENING TESTS PASSED.")
