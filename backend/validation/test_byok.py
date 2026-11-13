#!/usr/bin/env python3
"""Validation: bring-your-own-key (BYOK) scoring providers.

Tests:
  1. The OpenAI client builds the right request (URL, Bearer key,
     gpt-4o-mini, json_object) and its response parses through the
     single-prompt scorer as openai_semantic scores.
  2. The Anthropic client builds the right request (URL, x-api-key,
     claude-haiku-5-5) and its response parses as anthropic_semantic.
  3. A 429 from either provider raises ProviderRateLimited (after the
     retry) instead of a generic error, and the scorer falls back to
     the heuristic with rate_limited flagged.
  4. A malformed provider response falls back without raising.
  5. A user-supplied key is never persisted or logged: an in-process
     analysis run with a fake key leaves no trace of the key in the
     job record, the logs, or stderr, while scoring_info records
     user_key=True.
  6. A 429 on the server (no user) key sets server_key_exhausted on
     the finished job.
  7. The request model rejects unknown providers and over-long keys.
"""
import io
import json
import logging
import os
import re
import sys
import time
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import semantic_scorer as ss
import github_ingest
import main as main_mod

FAKE_KEY = "sk-test-BYOK-DO-NOT-LOG-999"

DIFFS = {
    0: ["+def alpha():\n+    return 1"],
    1: ["+def beta():\n+    x = 1\n+    if x:\n+        return 2"],
}
NAMES = {0: "Alice", 1: "Bob"}
COALITIONS = [[], [0], [1], [0, 1]]


def _scores_json_for(prompt):
    """Compact array scores for every coalition listed in the prompt."""
    idxs = re.findall(r"^(\d+)\. members (\[.*?\])", prompt, flags=re.M)
    assert idxs, "prompt lists no coalitions"
    scores = []
    for _j, arr in idxs:
        members = json.loads(arr)
        scores.append(list(members) + [12, 12, 12, 12])
    return json.dumps({"scores": scores})


class _FakeResponse:
    """Minimal urlopen response: context manager + read()."""

    def __init__(self, payload: bytes):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self._payload


def _fake_429(*args, **kwargs):
    raise urllib.error.HTTPError("http://example.invalid", 429,
                                 "Too Many Requests", {}, None)


def _no_sleep(*args, **kwargs):
    return None


def test_openai_client_builds_correct_request_and_parses():
    seen = {}
    orig_urlopen = ss.urllib.request.urlopen

    def fake_urlopen(req, timeout=30):
        seen["url"] = req.full_url
        seen["headers"] = dict(req.header_items())
        seen["body"] = json.loads(req.data.decode())
        content = _scores_json_for(seen["body"]["messages"][0]["content"])
        payload = json.dumps({"choices": [{"message": {"content": content}}]}).encode()
        return _FakeResponse(payload)

    ss.urllib.request.urlopen = fake_urlopen
    try:
        result = ss._call_openai(
            "0. members [0] (Alice)\n1. members [1] (Bob)", api_key=FAKE_KEY)
    finally:
        ss.urllib.request.urlopen = orig_urlopen
    assert seen["url"] == "https://api.openai.com/v1/chat/completions", seen
    assert seen["headers"].get("Authorization") == f"Bearer {FAKE_KEY}", seen
    assert seen["body"]["model"] == "gpt-4o-mini", seen
    assert seen["body"]["response_format"] == {"type": "json_object"}, seen
    assert seen["body"]["temperature"] == 0.1, seen
    text = result["candidates"][0]["content"]["parts"][0]["text"]
    assert json.loads(text)["scores"], "normalized text must parse as scores JSON"


def test_anthropic_client_builds_correct_request_and_parses():
    seen = {}
    orig_urlopen = ss.urllib.request.urlopen

    def fake_urlopen(req, timeout=30):
        seen["url"] = req.full_url
        seen["headers"] = {k.lower(): v for k, v in req.header_items()}
        seen["body"] = json.loads(req.data.decode())
        content = _scores_json_for(seen["body"]["messages"][0]["content"])
        payload = json.dumps({"content": [{"type": "text", "text": content}]}).encode()
        return _FakeResponse(payload)

    ss.urllib.request.urlopen = fake_urlopen
    try:
        result = ss._call_anthropic(
            "0. members [0] (Alice)\n1. members [1] (Bob)", api_key=FAKE_KEY)
    finally:
        ss.urllib.request.urlopen = orig_urlopen
    assert seen["url"] == "https://api.anthropic.com/v1/messages", seen
    assert seen["headers"].get("x-api-key") == FAKE_KEY, seen
    assert seen["headers"].get("anthropic-version") == "2023-06-01", seen
    assert seen["body"]["model"] == "claude-haiku-5-5", seen
    assert seen["body"]["max_tokens"] == 4096, seen
    text = result["candidates"][0]["content"]["parts"][0]["text"]
    assert json.loads(text)["scores"], "normalized text must parse as scores JSON"


def test_openai_429_raises_rate_limited():
    orig_urlopen = ss.urllib.request.urlopen
    orig_sleep = time.sleep
    ss.urllib.request.urlopen = _fake_429
    time.sleep = _no_sleep
    try:
        try:
            ss._call_openai("score this", api_key=FAKE_KEY)
            raise AssertionError("expected ProviderRateLimited")
        except ss.ProviderRateLimited as e:
            assert e.provider == "openai", e.provider
            assert e.user_key is True, e.user_key
            assert FAKE_KEY not in str(e), "key must not appear in the error"
    finally:
        ss.urllib.request.urlopen = orig_urlopen
        time.sleep = orig_sleep


def test_anthropic_429_raises_rate_limited():
    orig_urlopen = ss.urllib.request.urlopen
    orig_sleep = time.sleep
    ss.urllib.request.urlopen = _fake_429
    time.sleep = _no_sleep
    try:
        try:
            ss._call_anthropic("score this", api_key=FAKE_KEY)
            raise AssertionError("expected ProviderRateLimited")
        except ss.ProviderRateLimited as e:
            assert e.provider == "anthropic", e.provider
            assert e.user_key is True, e.user_key
    finally:
        ss.urllib.request.urlopen = orig_urlopen
        time.sleep = orig_sleep


def test_score_coalitions_openai_end_to_end_mocked():
    def fake_openai(prompt, api_key=None):
        assert api_key == FAKE_KEY, "user key must reach the provider call"
        return {"candidates": [{"content": {"parts": [
            {"text": _scores_json_for(prompt)}]}}]}

    orig = ss._call_openai
    ss._call_openai = fake_openai
    ss.clear_cache()
    try:
        info = {}
        results, prompts = ss.score_coalitions(
            COALITIONS, DIFFS, NAMES, provider="openai", api_key=FAKE_KEY, info=info)
    finally:
        ss._call_openai = orig
    assert prompts == 1, prompts
    assert results[(0, 1)]["scoring_mode"] == "openai_semantic", results[(0, 1)]
    assert results[(0, 1)]["semantic_score"] == 48, results[(0, 1)]
    assert info["provider"] == "openai" and info["model"] == "gpt-4o-mini", info
    assert info["user_key"] is True and info["rate_limited"] is False, info


def test_score_coalitions_anthropic_end_to_end_mocked():
    def fake_anthropic(prompt, api_key=None):
        assert api_key == FAKE_KEY, "user key must reach the provider call"
        return {"candidates": [{"content": {"parts": [
            {"text": _scores_json_for(prompt)}]}}]}

    orig = ss._call_anthropic
    ss._call_anthropic = fake_anthropic
    ss.clear_cache()
    try:
        info = {}
        results, prompts = ss.score_coalitions(
            COALITIONS, DIFFS, NAMES, provider="anthropic", api_key=FAKE_KEY, info=info)
    finally:
        ss._call_anthropic = orig
    assert prompts == 1, prompts
    assert results[(0, 1)]["scoring_mode"] == "anthropic_semantic", results[(0, 1)]
    assert info["provider"] == "anthropic" and info["model"] == "claude-haiku-5-5", info


def test_malformed_response_falls_back():
    orig = ss._call_provider
    ss._call_provider = lambda *a, **k: {"candidates": [{"content": {"parts": [
        {"text": "this is not json at all"}]}}]}
    ss.clear_cache()
    try:
        info = {}
        results, _prompts = ss.score_coalitions(
            [[0], [1]], DIFFS, NAMES, provider="openai", api_key=FAKE_KEY, info=info)
    finally:
        ss._call_provider = orig
    assert all(v["scoring_mode"] == "heuristic_fallback" for v in results.values()), results
    assert info["rate_limited"] is False, info


def test_provider_429_falls_back_with_flag():
    orig = ss._call_provider
    ss._call_provider = lambda *a, **k: (_ for _ in ()).throw(
        ss.ProviderRateLimited("gemini", False, "HTTP Error 429: Too Many Requests"))
    ss.clear_cache()
    try:
        info = {}
        results, _prompts = ss.score_coalitions(
            [[0], [1]], DIFFS, NAMES, provider="gemini", info=info)
    finally:
        ss._call_provider = orig
    assert all(v["scoring_mode"] == "heuristic_fallback" for v in results.values()), results
    assert info["rate_limited"] is True, info
    assert info["user_key"] is False, info


def _fake_commits(repo, max_commits=50, token=None):
    return {
        "alice@example.com": {
            "name": "Alice", "email": "alice@example.com",
            "commits": [{"message": "add alpha", "additions": 5, "deletions": 0,
                         "files": [{"patch": "+def alpha():\n+    return 1"}]}],
        },
        "bob@example.com": {
            "name": "Bob", "email": "bob@example.com",
            "commits": [{"message": "add beta", "additions": 6, "deletions": 0,
                         "files": [{"patch": "+def beta():\n+    x = 1\n+    if x:\n+        return 2"}]}],
        },
    }


class _CaptureHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(self.format(record))


def _run_job_with_mocked_provider(provider, api_key, provider_impl):
    """Run _run_analysis in-process with mocked ingestion + provider.

    Returns (job_dict, captured_log_text, captured_stderr)."""
    orig_commits = github_ingest.get_commits
    orig_call_provider = ss._call_provider
    github_ingest.get_commits = _fake_commits
    ss._call_provider = provider_impl
    handler = _CaptureHandler()
    main_mod.log.addHandler(handler)
    main_mod.log.setLevel(logging.INFO)
    stderr_buf = io.StringIO()
    old_stderr = sys.stderr
    sys.stderr = stderr_buf
    job_id = "test_byok_job"
    try:
        with main_mod._jobs_lock:
            main_mod._jobs[job_id] = {"status": "queued", "created_at": time.time()}
        main_mod._run_analysis(job_id, "alice/repo", 100.0, 30,
                               provider=provider, api_key=api_key)
    finally:
        sys.stderr = old_stderr
        main_mod.log.removeHandler(handler)
        github_ingest.get_commits = orig_commits
        ss._call_provider = orig_call_provider
    with main_mod._jobs_lock:
        job = dict(main_mod._jobs.pop(job_id, {}))
    return job, "\n".join(handler.records), stderr_buf.getvalue()


def _walk_strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk_strings(k)
            yield from _walk_strings(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _walk_strings(v)


def test_user_key_never_persisted_or_logged():
    def fake_provider(prompt, provider="gemini", api_key=None):
        assert api_key == FAKE_KEY, "user key must reach the provider call"
        return {"candidates": [{"content": {"parts": [
            {"text": _scores_json_for(prompt)}]}}]}

    job, logs, stderr = _run_job_with_mocked_provider("openai", FAKE_KEY, fake_provider)
    assert job.get("status") == "complete", job.get("error", job.get("status"))
    assert "api_key" not in set(_walk_strings(job.keys())), "job must not name an api_key field"
    blob = json.dumps(job, default=str)
    assert FAKE_KEY not in blob, "user key leaked into the stored job record"
    assert FAKE_KEY not in logs, "user key leaked into logs"
    assert FAKE_KEY not in stderr, "user key leaked into stderr"
    assert job["scoring_info"]["user_key"] is True, job["scoring_info"]
    assert job["scoring_info"]["provider"] == "openai", job["scoring_info"]
    assert job["server_key_exhausted"] is False, job
    assert job["user_key_rate_limited"] is False, job
    assert job["evaluations"][1]["scoring_mode"] == "openai_semantic", job["evaluations"]


def test_server_key_429_sets_exhausted_flag():
    def fake_429_provider(prompt, provider="gemini", api_key=None):
        assert api_key is None, "server-key job must not pass a user key"
        raise ss.ProviderRateLimited("gemini", False, "HTTP Error 429: Too Many Requests")

    job, logs, stderr = _run_job_with_mocked_provider("gemini", None, fake_429_provider)
    assert job.get("status") == "complete", job.get("error", job.get("status"))
    assert job["server_key_exhausted"] is True, job
    assert job["user_key_rate_limited"] is False, job
    # Every non-empty coalition fell back (the empty coalition always
    # scores 0 and carries no fallback flag, as in production).
    assert all(e["scoring_mode"] == "heuristic_fallback"
               for e in job["evaluations"] if e["coalition"]), job["evaluations"]


def test_request_model_validation():
    from pydantic import ValidationError
    from main import AnalyzeRequest
    try:
        AnalyzeRequest(repo_url="a/b", provider="cohere")
        raise AssertionError("unknown provider must be rejected")
    except ValidationError:
        pass
    try:
        AnalyzeRequest(repo_url="a/b", api_key="x" * 501)
        raise AssertionError("over-long key must be rejected")
    except ValidationError:
        pass
    ok = AnalyzeRequest(repo_url="a/b", provider="anthropic", api_key=FAKE_KEY)
    assert ok.provider == "anthropic" and ok.api_key == FAKE_KEY


if __name__ == "__main__":
    test_openai_client_builds_correct_request_and_parses()
    print("  [+] PASS: test_openai_client_builds_correct_request_and_parses")
    test_anthropic_client_builds_correct_request_and_parses()
    print("  [+] PASS: test_anthropic_client_builds_correct_request_and_parses")
    test_openai_429_raises_rate_limited()
    print("  [+] PASS: test_openai_429_raises_rate_limited")
    test_anthropic_429_raises_rate_limited()
    print("  [+] PASS: test_anthropic_429_raises_rate_limited")
    test_score_coalitions_openai_end_to_end_mocked()
    print("  [+] PASS: test_score_coalitions_openai_end_to_end_mocked")
    test_score_coalitions_anthropic_end_to_end_mocked()
    print("  [+] PASS: test_score_coalitions_anthropic_end_to_end_mocked")
    test_malformed_response_falls_back()
    print("  [+] PASS: test_malformed_response_falls_back")
    test_provider_429_falls_back_with_flag()
    print("  [+] PASS: test_provider_429_falls_back_with_flag")
    test_user_key_never_persisted_or_logged()
    print("  [+] PASS: test_user_key_never_persisted_or_logged")
    test_server_key_429_sets_exhausted_flag()
    print("  [+] PASS: test_server_key_429_sets_exhausted_flag")
    test_request_model_validation()
    print("  [+] PASS: test_request_model_validation")
    print("ALL BYOK TESTS PASSED.")
