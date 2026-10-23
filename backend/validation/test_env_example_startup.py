#!/usr/bin/env python3
"""Validation: .env.example startup regression (Phase 4, step 0).

Bug: backend/paypal_payouts.py did
    float(env("SHAPLEY_MAX_BATCH_USD", "10000.0"))
and backend/semantic_scorer.py did
    float(os.environ.get("GEMINI_MIN_INTERVAL", "4.0"))
.env.example ships both keys EMPTY (``SHAPLEY_MAX_BATCH_USD=``), and the
README flow is ``cp .env.example .env``, so a cold clone crashed at import
with ``ValueError: could not convert string to float: ''`` — taking down
the Concurrency, PayPal Escrow, and Phase 2 Hardening suites, which all
import paypal_payouts. An empty/whitespace env value must count as unset.

This test loads the .env.example values VERBATIM two ways, with no real
credentials and no network use:
  1. As process environment variables: importing paypal_payouts,
     semantic_scorer, and the FastAPI app (main) must succeed, and the
     numeric settings must fall back to their defaults.
  2. As a cold clone: the backend tree is copied to a fresh directory,
     .env.example is copied to .env (the README flow), the environment
     is clean, and the three suites that failed in the cold clone must
     pass there.
"""
import os
import shutil
import subprocess
import sys
import tempfile

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(BACKEND_DIR)
EXAMPLE_PATH = os.path.join(REPO_ROOT, ".env.example")

IMPORT_CHECK = r"""
import sys
sys.path.insert(0, sys.argv[1])
import paypal_payouts
import semantic_scorer
import main
assert paypal_payouts.MAX_BATCH_AMOUNT_USD == 10000.0, paypal_payouts.MAX_BATCH_AMOUNT_USD
assert semantic_scorer.MIN_INTERVAL == 4.0, semantic_scorer.MIN_INTERVAL
assert semantic_scorer.DEFAULT_MODEL == "gemini-2.5-flash", semantic_scorer.DEFAULT_MODEL
assert main.app is not None
print("IMPORT_OK")
"""

COLD_SUITES = [
    "test_idempotency_concurrency.py",
    "test_paypal_escrow.py",
    "test_phase2_hardening.py",
]


def _parse_example():
    values = {}
    with open(EXAMPLE_PATH) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip()
    return values


def _base_env():
    return {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "LC_ALL")
            if k in os.environ}


def _run(args, env, cwd):
    proc = subprocess.run(args, env=env, cwd=cwd, capture_output=True, text=True)
    assert proc.returncode == 0, (
        f"command failed: {args}\nstdout:\n{proc.stdout}\nstderr:\n{proc.stderr}")
    return proc


def test_imports_with_example_env_vars():
    """Example values verbatim in os.environ: imports succeed, defaults hold."""
    env = _base_env()
    env.update(_parse_example())
    proc = _run([sys.executable, "-c", IMPORT_CHECK, BACKEND_DIR],
                env=env, cwd=BACKEND_DIR)
    assert "IMPORT_OK" in proc.stdout, proc.stdout


def test_cold_clone_env_file_and_suites():
    """README flow in a fresh directory: cp .env.example .env, then the
    three suites that died on the float('') crash must pass."""
    tmp_root = tempfile.mkdtemp(prefix="shapley-envtest-", dir=os.path.expanduser("~"))
    try:
        shutil.copytree(
            BACKEND_DIR, os.path.join(tmp_root, "backend"),
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        shutil.copyfile(EXAMPLE_PATH, os.path.join(tmp_root, ".env"))
        shutil.copyfile(EXAMPLE_PATH, os.path.join(tmp_root, ".env.example"))

        env = _base_env()  # clean: every value must come from the .env copy
        tmp_backend = os.path.join(tmp_root, "backend")
        proc = _run([sys.executable, "-c", IMPORT_CHECK, tmp_backend],
                    env=env, cwd=tmp_backend)
        assert "IMPORT_OK" in proc.stdout, proc.stdout

        for script in COLD_SUITES:
            _run([sys.executable, os.path.join("validation", script)],
                 env=env, cwd=tmp_backend)
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


if __name__ == "__main__":
    print("[*] Running .env.example Startup Regression Tests...")
    _tests = [
        ("test_imports_with_example_env_vars", test_imports_with_example_env_vars),
        ("test_cold_clone_env_file_and_suites", test_cold_clone_env_file_and_suites),
    ]
    for _label, _fn in _tests:
        _fn()
        print(f"  [+] PASS: {_label}")
    print("ALL .ENV.EXAMPLE STARTUP REGRESSION TESTS PASSED.")
