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
}

export async function fetchDemo(): Promise<AnalysisResult> {
  const res = await fetch(`${API_BASE}/api/demo`);
  if (!res.ok) throw new Error("Demo fetch failed");
  return res.json();
}

export async function startAnalysis(
  repoUrl: string,
  totalAmount: number,
  demo: boolean
): Promise<{ job_id: string }> {
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_url: repoUrl,
      total_amount: totalAmount,
      demo,
    }),
  });
  if (!res.ok) throw new Error("Analysis start failed");
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
  const res = await fetch(`${API_BASE}/api/payout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
