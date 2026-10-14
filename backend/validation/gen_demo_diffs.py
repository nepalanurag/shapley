#!/usr/bin/env python3
"""Generate synthetic-but-realistic diffs matching the demo scenario.

Creates diffs.json for test-retest: 16 coalitions, each with diffs
representing that coalition's combined contributions.
"""
import json

# Per-contributor diffs (matching demo descriptions)
MAYA_DIFFS = ["""diff --git a/auth/refactor.py b/auth/refactor.py
+class AuthManager:
+    def __init__(self, provider_registry):
+        self._providers = provider_registry
+        self._token_cache = {}
+        self._refresh_locks = defaultdict(threading.Lock)
+
+    async def authenticate(self, credentials):
+        # Pluggable provider chain with fallback
+        for provider in self._providers:
+            try:
+                token = await provider.verify(credentials)
+                if token:
+                    return self._wrap_token(token, provider)
+            except ProviderError as e:
+                logger.warning(f"Provider {provider.name} failed: {e}")
+                continue
+        raise AuthenticationFailed("All providers exhausted")
+
+    def _wrap_token(self, token, provider):
+        # Enrich with provider metadata for downstream audit
+        return AuthToken(
+            raw=token,
+            provider=provider.name,
+            issued_at=time.time(),
+            scopes=provider.scopes_for(token),
+        )
"""]

DAVID_DIFFS = ["""diff --git a/utils/helpers.py b/utils/helpers.py
+def chunk_list(items, size):
+    return [items[i:i+size] for i in range(0, len(items), size)]
+
+def safe_get(d, *keys, default=None):
+    for k in keys:
+        if isinstance(d, dict):
+            d = d.get(k, default)
+        else:
+            return default
+    return d
+
+def format_bytes(n):
+    for unit in ["B", "KB", "MB", "GB"]:
+        if n < 1024:
+            return f"{n:.1f}{unit}"
+        n /= 1024
+    return f"{n:.1f}TB"
"""]

SARA_DIFFS = ["""diff --git a/api/integration.py b/api/integration.py
+class ExternalAPIClient:
+    def __init__(self, base_url, api_key, timeout=30):
+        self.base_url = base_url.rstrip("/")
+        self.session = requests.Session()
+        self.session.headers.update({"Authorization": f"Bearer {api_key}"})
+        self.timeout = timeout
+
+    def _request(self, method, path, **kwargs):
+        url = f"{self.base_url}/{path.lstrip('/')}"
+        for attempt in range(3):
+            try:
+                resp = self.session.request(method, url,
+                                            timeout=self.timeout, **kwargs)
+                resp.raise_for_status()
+                return resp.json()
+            except requests.Timeout:
+                if attempt == 2:
+                    raise APIError(f"Timeout after 3 attempts: {path}")
+                time.sleep(2 ** attempt)
+            except requests.HTTPError as e:
+                if e.response.status_code == 429:
+                    retry_after = int(e.response.headers.get("Retry-After", 60))
+                    time.sleep(retry_after)
+                    continue
+                raise APIError(f"HTTP {e.response.status_code}: {path}")
"""]

TOM_DIFFS = ["""diff --git a/README.md b/README.md
+# Project Setup
+
+## Installation
+Run `pip install -r requirements.txt` to install dependencies.
+
+## Configuration
+Copy `.env.example` to `.env` and fill in your API keys.
+
+## Running Tests
+Run `pytest tests/` to execute the test suite.
"""]

CONTRIBUTOR_DIFFS = {0: MAYA_DIFFS, 1: DAVID_DIFFS, 2: SARA_DIFFS, 3: TOM_DIFFS}

# Build all 16 coalitions
coalitions = {}
for mask in range(16):
    members = tuple(i for i in range(4) if mask & (1 << i))
    cid = ",".join(str(i) for i in members)
    diffs = []
    for i in members:
        diffs.extend(CONTRIBUTOR_DIFFS[i])
    coalitions[cid] = diffs

with open("demo_diffs.json", "w") as f:
    json.dump(coalitions, f, indent=2)

print(f"Generated {len(coalitions)} coalition diff sets -> demo_diffs.json")
for cid, diffs in sorted(coalitions.items(), key=lambda x: (len(x[0]), x[0])):
    total_lines = sum(len(d.split("\n")) for d in diffs)
    print(f"  [{cid or '(empty)'}]: {len(diffs)} diffs, {total_lines} lines")
