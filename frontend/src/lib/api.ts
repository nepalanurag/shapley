// API client for Shapley backend
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface Contributor {
  name: string;
  email: string;
  commits: number;
  additions?: number;
  deletions?: number;
  shapley_value: number;
  share_pct: number;
  payout_usd: number;
}

export interface Evaluation {
  coalition: number[];
  members: string[];
  score: number;
  reasoning: string;
  confidence: number;
}

export interface AnalysisResult {
  repo: string;
  total_amount: number;
  contributors: Contributor[];
  evaluations: Evaluation[];
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
