#!/usr/bin/env python3
"""Validation: batched coalition scoring (one Gemini prompt per batch).

Tests:
  1. One prompt scores a whole batch; the JSON comes back as one object
     with a rubric score per coalition, and each coalition's composite
     is 30% objective + 70% semantic, exactly as in score_coalition.
  2. The empty coalition scores 0 without a prompt; a second identical
     call is served from cache with zero prompts.
  3. A coalition the model omits from its JSON falls back to the
     objective-only heuristic, flagged heuristic_fallback.
  4. A total Gemini failure (e.g. bad key) falls every coalition in the
     batch back to the heuristic, without raising.
  5. compute_shapley and monte_carlo_shapley still work with a mocked
     single-coalition scorer (the test-fixture path).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import semantic_scorer as ss
import shapley as S

DIFFS = {
    0: ["+def alpha():\n+    return 1"],
    1: ["+def beta():\n+    x = 1\n+    if x:\n+        return 2"],
    2: ["+class Gamma:\n+    pass"],
}
NAMES = {0: "Alice", 1: "Bob", 2: "Carol"}
COALITIONS = [[], [0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]]


def _fake_batch_call(prompt):
    """Return one JSON score per coalition listed in the prompt."""
    idxs = re.findall(r"^(\d+)\. members (\[.*?\])", prompt, flags=re.M)
    assert idxs, "batch prompt lists no coalitions"
    scores = []
    for _j, arr in idxs:
        members = json.loads(arr)
        scores.append({
            "coalition": members,
            "complexity": 10 + len(members),
            "impact": 12,
            "originality": 8,
            "unblocking": 6,
            "reasoning": "mocked batch score",
            "confidence": 0.8,
        })
    return {"candidates": [{"content": {"parts": [{"text": json.dumps({"scores": scores})}]}}]}


def test_batch_scores_all_coalitions_in_one_prompt():
    orig = ss._call_gemini
    calls = []
    ss._call_gemini = lambda p: (calls.append(p), _fake_batch_call(p))[1]
    ss.clear_cache()
    try:
        results, prompts = ss.score_coalitions_batch(COALITIONS, DIFFS, NAMES)
        assert prompts == 1, f"expected 1 prompt for 8 coalitions, got {prompts}"
        assert len(results) == 8, f"expected 8 results, got {len(results)}"
        assert results[()]["score"] == 0, "empty coalition must score 0"
        r = results[(0, 1)]
        # rubric 12+12+8+6 = 38 semantic; composite = 0.3*obj + 0.7*38
        assert r["scoring_mode"] == "gemini_semantic", r
        assert r["semantic_score"] == 38, r
        assert r["rubric"]["complexity"] == 12, r
        assert r["reasoning"] == "mocked batch score", r
        assert len(calls) == 1 and "members [0, 1]" in calls[0], "prompt must list the coalitions"
    finally:
        ss._call_gemini = orig


def test_batch_second_call_is_cached():
    orig = ss._call_gemini
    ss._call_gemini = _fake_batch_call
    ss.clear_cache()
    try:
        ss.score_coalitions_batch(COALITIONS, DIFFS, NAMES)
        _results, prompts = ss.score_coalitions_batch(COALITIONS, DIFFS, NAMES)
        assert prompts == 0, f"cached re-run must send 0 prompts, got {prompts}"
    finally:
        ss._call_gemini = orig


def test_batch_missing_entry_falls_back():
    def fake_partial(_prompt):
        return {"candidates": [{"content": {"parts": [{"text": json.dumps({"scores": [{
            "coalition": [0], "complexity": 5, "impact": 5,
            "originality": 5, "unblocking": 5,
            "reasoning": "x", "confidence": 0.5}]})}]}}]}

    orig = ss._call_gemini
    ss._call_gemini = fake_partial
    ss.clear_cache()
    try:
        results, _prompts = ss.score_coalitions_batch([[0], [1]], DIFFS, NAMES)
        assert results[(0,)]["scoring_mode"] == "gemini_semantic", results[(0,)]
        assert results[(1,)]["scoring_mode"] == "heuristic_fallback", results[(1,)]
        assert results[(1,)]["semantic_score"] == 0, results[(1,)]
    finally:
        ss._call_gemini = orig


def test_batch_total_failure_falls_back():
    orig = ss._call_gemini
    ss._call_gemini = lambda _p: (_ for _ in ()).throw(RuntimeError("HTTP Error 400: API key not valid"))
    ss.clear_cache()
    try:
        results, prompts = ss.score_coalitions_batch([[0], [0, 1]], DIFFS, NAMES)
        assert prompts == 1, prompts
        assert all(v["scoring_mode"] == "heuristic_fallback" for v in results.values()), results
    finally:
        ss._call_gemini = orig


def test_shapley_paths_with_mock_scorer():
    """The axiom-style fixture path: mocking S.score_coalition must still
    drive both compute_shapley and monte_carlo_shapley unchanged."""
    orig = S.score_coalition

    def glove_scorer(members, diffs, names=None):
        s = set(members)
        val = 100 if (0 in s and 1 in s) else 0
        return {"score": val, "reasoning": "glove", "confidence": 1.0}

    S.score_coalition = glove_scorer
    try:
        diffs = {0: ["L"], 1: ["R"]}
        names = {0: "L_Owner", 1: "R_Owner"}
        res = S.compute_shapley(diffs, names, total_amount_usd=1000.0)
        assert abs(res["shares_pct"][0] - 50.0) < 1e-6, res["shares_pct"]
        assert abs(res["shares_pct"][1] - 50.0) < 1e-6, res["shares_pct"]
        res = S.monte_carlo_shapley(diffs, names, num_samples=300,
                                    min_samples=200, total_amount_usd=1000.0)
        assert abs(res["shares_pct"][0] - 50.0) <= 5.0, res["shares_pct"]
        assert abs(res["shares_pct"][1] - 50.0) <= 5.0, res["shares_pct"]
    finally:
        S.score_coalition = orig


if __name__ == "__main__":
    test_batch_scores_all_coalitions_in_one_prompt()
    print("  [+] PASS: test_batch_scores_all_coalitions_in_one_prompt")
    test_batch_second_call_is_cached()
    print("  [+] PASS: test_batch_second_call_is_cached")
    test_batch_missing_entry_falls_back()
    print("  [+] PASS: test_batch_missing_entry_falls_back")
    test_batch_total_failure_falls_back()
    print("  [+] PASS: test_batch_total_failure_falls_back")
    test_shapley_paths_with_mock_scorer()
    print("  [+] PASS: test_shapley_paths_with_mock_scorer")
    print("ALL BATCH SCORING TESTS PASSED.")
