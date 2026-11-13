// API client for Shapley backend (uses 127.0.0.1 to avoid macOS IPv6 localhost hang)
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export interface Contributor {
  name: string;
  email: string;
  commits: number;
  additions?: number;
  deletions?: number;
  shapley_value: number;
  share_pct: number;
  share_ci_low?: number;
  share_ci_high?: number;
  payout_usd: number;
  payout_ci_low?: number;
  payout_ci_high?: number;
}

export interface Evaluation {
  coalition: number[];
  members: string[];
  score: number;
  reasoning: string;
  confidence: number;
  rubric?: {
    complexity: number;
    impact: number;
    originality: number;
    unblocking: number;
  };
  monotonicity_adjusted?: boolean;
  // "<provider>_semantic" = scored by that provider's AI;
  // "heuristic_fallback" = the provider was unavailable and the score
  // is the objective line/branch heuristic only.
  scoring_mode?: string;
}

export interface Provenance {
  input_hash: string;
  feature_extractor_commit: string;
  model: string;
  model_hash: string;
  baseline: number;
  seed: number | null;
  n_samples: number;
  algorithm: string;
  ci_method: string;
  share_cis: Record<string, { low: number; high: number }>;
  efficiency_check: string;
  efficiency_tol: number;
}

export interface ScoringInfo {
  provider: string;
  model: string;
  user_key: boolean;
  rate_limited: boolean;
  error?: string | null;
}

export interface AnalysisResult {
  repo: string;
  total_amount: number;
  contributors: Contributor[];
  evaluations: Evaluation[];
  summary?: string;
  api_calls: number;
  num_coalitions: number;
  demo_mode?: boolean;
  // BYOK scoring record: which key scored this job and whether it was
  // rate limited. Carries no key material.
  scoring_info?: ScoringInfo;
  // True when the built-in server key hit its limit (no user key was
  // supplied): the UI must say so and offer the BYOK field.
  server_key_exhausted?: boolean;
  // True when the user's own key was rate limited.
  user_key_rate_limited?: boolean;
  // Persisted provenance record produced by the backend Shapley engine.
  // All displayed attribution numbers come from the API response (this
  // record's lineage), never from an on-the-fly recomputation in the UI.
  provenance?: Provenance;
}

export async function fetchDemo(): Promise<AnalysisResult> {
  const res = await fetch(`${API_BASE}/api/demo`);
  if (!res.ok) throw new Error("Demo fetch failed");
  return res.json();
}

export async function startAnalysis(
  repoUrl: string,
  totalAmount: number,
  demo: boolean,
  byok?: { provider?: string; apiKey?: string }
): Promise<{ job_id: string }> {
  // Send the GitHub login session when the user is connected, so the
  // backend fetches commits with their own token (their own rate limit)
  // instead of the shared anonymous quota.
  const sessionId =
    typeof window !== "undefined"
      ? sessionStorage.getItem("gh_session")
      : null;
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_url: repoUrl,
      total_amount: totalAmount,
      demo,
      ...(sessionId ? { session_id: sessionId } : {}),
      // BYOK: the user's own key goes only with this request. The
      // backend uses it for this job only and never stores it.
      ...(byok?.apiKey
        ? { provider: byok.provider || "gemini", api_key: byok.apiKey }
        : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Analysis start failed");
  }
  return res.json();
}

export async function pollAnalysis(jobId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/analyze/${jobId}`);
  if (!res.ok) throw new Error("Poll failed");
  return res.json();
}

export async function executePayout(
  shares: { email: string; amount: number; note?: string }[],
  totalAmount: number
): Promise<{ batch_id: string; status: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Backend payout confirmation gate (see PAYOUT_CONFIRM_TOKEN in .env.example):
  // when a confirm token is configured for the frontend build, send it.
  const confirmToken = process.env.NEXT_PUBLIC_PAYOUT_CONFIRM_TOKEN;
  if (confirmToken) headers["X-Shapley-Confirm"] = confirmToken;
  const res = await fetch(`${API_BASE}/api/payout`, {
    method: "POST",
    headers,
    body: JSON.stringify({ shares, total_amount: totalAmount }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Payout failed");
  }
  return res.json();
}

export async function payoutStatus(batchId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/payout/${batchId}`);
  if (!res.ok) throw new Error("Status check failed");
  return res.json();
}

export async function fetchSponsorPortfolio(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/sponsor/portfolio`);
  if (!res.ok) throw new Error("Failed to fetch sponsor portfolio");
  return res.json();
}

export async function generateSponsorInvoice(payload: {
  sponsor_name: string;
  repo_url: string;
  milestone_name: string;
  grant_amount_usd: number;
}): Promise<any> {
  const res = await fetch(`${API_BASE}/api/sponsor/invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to generate sponsor invoice");
  return res.json();
}

export async function createEscrowOrder(payload: {
  repo_url: string;
  milestone_name: string;
  total_amount_usd: number;
}): Promise<any> {
  const res = await fetch(`${API_BASE}/api/escrow/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to create escrow order");
  return res.json();
}

export async function fetchContributorProfiles(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/contributor/profiles`);
  if (!res.ok) throw new Error("Failed to fetch contributor profiles");
  return res.json();
}

export async function submitContributorClaim(payload: {
  contributor_id: string;
  oauth_github_username: string;
  oauth_email: string;
  paypal_recipient_email: string;
  tax_form_type?: string;
  tax_certified: boolean;
}): Promise<any> {
  const res = await fetch(`${API_BASE}/api/contributor/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Contributor claim failed");
  }
  return res.json();
}

export async function validatePotSolvency(hackathonId = "hack-sf-2026", expectedPool = 2500, orderId?: string): Promise<any> {
  let url = `${API_BASE}/api/pot/validate?hackathon_id=${encodeURIComponent(hackathonId)}&expected_pool_usd=${expectedPool}`;
  if (orderId) {
    url += `&order_id=${encodeURIComponent(orderId)}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to validate pot solvency");
  return res.json();
}
