#!/usr/bin/env python3
"""Shapley Master Invariant & Verification Suite.

Runs the full spectrum of mathematical, financial, cryptographic, and protocol tests:
  1. Game-Theoretic Axiom Tests (Efficiency, Symmetry, Dummy Player, Monotonicity)
  2. Financial Math Property Tests (10,000 fuzz runs of Hare-Niemeyer exact-penny conservation)
  3. Monte Carlo Permutation Tests (Seeded antithetic sampling convergence on known games)
  4. Cryptographic Merkle Audit Tests (Tamper-evidence, leaf verification)
  5. Prompt Injection Defense Tests (Adversarial diff sanitization)
  6. Model Context Protocol (MCP) Compliance Tests
  7. Frozen Demo Scenario Determinism Checks
"""
import os
import subprocess
import sys

SCRIPTS = [
    ("Axiomatic Game Theory", "test_axioms.py"),
    ("Exact-Penny Financial Math (10,000 Fuzz)", "test_financial_math.py"),
    ("Monte Carlo Antithetic Convergence", "test_monte_carlo.py"),
    ("Cryptographic Merkle Audit Trail", "test_merkle_audit.py"),
    ("Adversarial Prompt Injection Defense", "test_prompt_injection.py"),
    ("Model Context Protocol (MCP) Compliance", "test_mcp_protocol.py"),
    ("Concurrency & Replay Defense", "test_idempotency_concurrency.py"),
    ("AI Co-Authorship & Human Pilot Disambiguation", "test_ai_attribution.py"),
    ("MCP Chat & Webhook Protocol Integration", "test_mcp_chat.py"),
    ("PayPal Orders v2 Escrow Invariants", "test_paypal_escrow.py"),
    ("Contributor Claims, RBAC & Hackathon Pot Solvency", "test_claims_and_onboarding.py"),
    ("Phase 1 Hardening (Seeded MC, Efficiency, Money)", "test_phase1_hardening.py"),
    ("Phase 2 Hardening (Failure Modes)", "test_phase2_hardening.py"),
    ("Phase 3 Axiom Property Tests (Hypothesis)", "test_axioms_property.py"),
    ("Phase 3 Independent Oracle (shap / brute-force)", "test_shapley_oracle.py"),
    ("Phase 3 Golden Fixtures (byte-compared)", "test_golden_fixtures.py"),
    (".env.example Startup Regression", "test_env_example_startup.py"),
]


def main():
    val_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(val_dir)

    print("\n" + "=" * 80)
    print("SHAPLEY PROTOCOL: MASTER VERIFICATION & INVARIANT AUDIT SUITE")
    print("=" * 80 + "\n")

    total_passed = 0
    total_failed = 0

    for name, script_name in SCRIPTS:
        script_path = os.path.join(val_dir, script_name)
        print(f"[*] Running {name} ({script_name})...")
        proc = subprocess.run([sys.executable, script_path], cwd=root_dir, capture_output=True, text=True)
        if proc.returncode == 0:
            print(f"  [+] PASS: {name}")
            for line in proc.stdout.strip().splitlines():
                if "PASS" in line or "ALL" in line:
                    print(f"      {line}")
            total_passed += 1
        else:
            print(f"  [!] FAIL: {name}")
            print(proc.stderr)
            total_failed += 1
        print("-" * 80)

    # Demo data determinism
    print("[*] Running Frozen Demo Scenario Determinism...")
    demo_script = os.path.join(root_dir, "demo_data.py")
    proc = subprocess.run([sys.executable, demo_script], cwd=root_dir, capture_output=True, text=True)
    if proc.returncode == 0:
        print("  [+] PASS: Frozen Demo Scenario (Deterministic across 3 runs)")
        total_passed += 1
    else:
        print("  [!] FAIL: Demo scenario non-deterministic")
        total_failed += 1

    print("\n" + "=" * 80)
    print(f"AUDIT SUMMARY: {total_passed} test suites passed, {total_failed} failed.")
    print("=" * 80 + "\n")
    sys.exit(1 if total_failed > 0 else 0)


if __name__ == "__main__":
    main()
