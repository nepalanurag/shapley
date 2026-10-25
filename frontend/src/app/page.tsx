"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { startAnalysis } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

interface Repo {
  full_name: string;
  name: string;
  description: string;
  private: boolean;
  language: string;
}

export default function Home() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("");
  const [total, setTotal] = useState("1000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // GitHub OAuth state
  const [ghSession, setGhSession] = useState<string | null>(null);
  const [ghUser, setGhUser] = useState("");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);

  useEffect(() => {
    const sid = sessionStorage.getItem("gh_session");
    const user = sessionStorage.getItem("gh_user");
    if (sid && user) {
      setGhSession(sid);
      setGhUser(user);
    }
  }, []);

  const connectGitHub = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/github/oauth-url`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.detail || "GitHub OAuth not configured yet.");
        return;
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      setError("Could not reach the backend. Is it running?");
    }
  };

  const loadRepos = async () => {
    if (!ghSession) return;
    setLoadingRepos(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/github/repos?session_id=${ghSession}`
      );
      if (res.status === 401) {
        // Session expired
        sessionStorage.removeItem("gh_session");
        sessionStorage.removeItem("gh_user");
        setGhSession(null);
        setGhUser("");
        setError("GitHub session expired. Please reconnect.");
        return;
      }
      const data = await res.json();
      setRepos(data.repos || []);
      setShowPicker(true);
    } catch {
      setError("Could not load your repositories.");
    }
    setLoadingRepos(false);
  };

  const selectRepo = (fullName: string) => {
    setRepoUrl(fullName);
    setShowPicker(false);
  };

  const disconnect = async () => {
    if (ghSession) {
      await fetch(`${API_BASE}/api/github/disconnect?session_id=${ghSession}`,
        { method: "POST" }).catch(() => {});
    }
    sessionStorage.removeItem("gh_session");
    sessionStorage.removeItem("gh_user");
    setGhSession(null);
    setGhUser("");
    setRepos([]);
  };

  const handleAnalyze = async (demo: boolean) => {
    setError("");
    setLoading(true);
    try {
      if (demo) {
        sessionStorage.setItem("shapley_demo", "true");
        sessionStorage.setItem("shapley_total", total);
        router.push("/results?demo=true");
      } else {
        if (!repoUrl.trim()) {
          setError("Pick a repository or enter a GitHub repo URL.");
          setLoading(false);
          return;
        }
        const { job_id } = await startAnalysis(
          repoUrl.trim(), parseFloat(total) || 1000, false);
        sessionStorage.setItem("shapley_job", job_id);
        sessionStorage.setItem("shapley_total", total);
        router.push(`/analyze?job=${job_id}`);
      }
    } catch (e: any) {
      setError(e.message || "Failed to start analysis");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0c0d0e] text-[#ededed]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="text-center mb-12 animate-rise">
          <h1 className="text-5xl font-bold tracking-tight mb-4">
            Shapley
          </h1>
          <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
            Algorithmic revenue settlement for open source. Semantic evaluation scores
            code impact, Lloyd Shapley cooperative game theory calculates marginal shares,
            and PayPal executes exact-penny batch payouts.
          </p>
        </div>

        <div className="bg-zinc-900 rounded-xl p-5 sm:p-8 border border-zinc-800 animate-rise stagger-1">
          <h2 className="text-lg font-semibold mb-6">Analyze a repository</h2>

          {/* GitHub connect / repo picker */}
          {!ghSession ? (
            <button
              onClick={connectGitHub}
              className="w-full mb-4 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-4 py-3 flex items-center justify-center gap-3 btn-interactive"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              <span className="font-medium">Connect GitHub — pick from your repos</span>
            </button>
          ) : (
            <div className="mb-4">
              <div className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3">
                <span className="text-sm text-zinc-300">
                  Connected as <span className="font-semibold text-zinc-100">@{ghUser}</span>
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={loadRepos}
                    disabled={loadingRepos}
                    className="text-sm text-blue-400 hover:text-blue-300 btn-interactive"
                  >
                    {loadingRepos ? "Loading..." : "Browse repos"}
                  </button>
                  <button
                    onClick={disconnect}
                    className="text-sm text-zinc-500 hover:text-zinc-400 btn-interactive"
                  >
                    Disconnect
                  </button>
                </div>
              </div>

              {/* Repo picker dropdown */}
              {showPicker && (
                <div className="mt-2 bg-zinc-800 border border-zinc-700 rounded-lg max-h-64 overflow-y-auto animate-fade">
                  {repos.length === 0 ? (
                    <p className="text-sm text-zinc-500 p-4">No repositories found.</p>
                  ) : (
                    repos.map((r) => (
                      <button
                        key={r.full_name}
                        onClick={() => selectRepo(r.full_name)}
                        className="w-full text-left px-4 py-3 hover:bg-zinc-700 border-b border-zinc-700/50 last:border-0 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{r.full_name}</span>
                          {r.private && (
                            <span className="text-xs bg-yellow-900/50 text-yellow-300 px-1.5 py-0.5 rounded">
                              private
                            </span>
                          )}
                        </div>
                        {r.description && (
                          <p className="text-xs text-zinc-500 mt-1 truncate">{r.description}</p>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-xs text-zinc-600">or paste a URL</span>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>

          <label className="block text-sm font-medium text-zinc-300 mb-2">
            GitHub repository
          </label>
          <div className="relative mb-2">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </div>
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="octocat/Hello-World or https://github.com/owner/repo"
              className="w-full bg-[#121316] border border-[#1e2024] rounded-lg pl-10 pr-4 py-3 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 font-mono text-sm transition-colors"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-5 text-xs">
            <span className="text-zinc-500 whitespace-nowrap font-medium font-mono text-[11px] uppercase tracking-wider">Presets:</span>
            <button
              type="button"
              onClick={() => { setRepoUrl("pallets/jinja"); setTotal("1000"); }}
              className="px-2.5 py-1 bg-[#121316] hover:bg-zinc-800 text-zinc-300 rounded border border-[#1e2024] whitespace-nowrap transition-colors font-mono"
            >
              pallets/jinja ($1k)
            </button>
            <button
              type="button"
              onClick={() => { setRepoUrl("psf/black"); setTotal("2500"); }}
              className="px-2.5 py-1 bg-[#121316] hover:bg-zinc-800 text-zinc-300 rounded border border-[#1e2024] whitespace-nowrap transition-colors font-mono"
            >
              psf/black ($2.5k)
            </button>
            <button
              type="button"
              onClick={() => { setRepoUrl("aio-libs/aiohttp"); setTotal("5000"); }}
              className="px-2.5 py-1 bg-[#121316] hover:bg-zinc-800 text-zinc-300 rounded border border-[#1e2024] whitespace-nowrap transition-colors font-mono"
            >
              aio-libs/aiohttp ($5k)
            </button>
          </div>

          <label className="block text-sm font-medium text-zinc-300 mb-2">
            Total payout amount (USD)
          </label>
          <div className="relative mb-6">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-emerald-400 font-bold font-mono text-sm">
              $
            </div>
            <input
              type="number"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              min="1"
              step="0.01"
              className="w-full bg-[#121316] border border-[#1e2024] rounded-lg pl-8 pr-4 py-3 text-zinc-100 font-mono focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          {error && (
            <div className="bg-red-950 border border-red-800 text-red-200 rounded-lg px-4 py-3 mb-4 text-sm animate-shake">
              {error}
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={() => handleAnalyze(false)}
              disabled={loading}
              className="flex-1 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold rounded-lg px-6 py-3 btn-interactive disabled:opacity-50 transition-colors"
            >
              {loading ? "Starting..." : "Analyze Contributions"}
            </button>
            <button
              onClick={() => handleAnalyze(true)}
              disabled={loading}
              className="flex-1 bg-[#121316] hover:bg-zinc-800 disabled:opacity-50 text-zinc-200 font-medium rounded-lg px-6 py-3 border border-[#1e2024] btn-interactive transition-colors"
            >
              Try Demo
            </button>
          </div>
        </div>

        {/* Why Shapley? Plain English Explainer */}
        <div className="mt-14 pt-10 border-t border-[#1e2024]">
          <div className="text-center mb-8">
            <span className="text-xs uppercase font-semibold tracking-wider text-zinc-400 font-mono">
              The Common Sense Principle
            </span>
            <h2 className="text-2xl font-bold text-white tracking-tight mt-1">Why Lines of Code Fail</h2>
            <p className="text-xs text-zinc-400 mt-1 max-w-xl mx-auto font-mono">
              Replacing typing-speed contests with game-theoretic marginal capability
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-5 mb-10">
            <div className="bg-[#121316] border border-rose-950/50 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center text-xs font-bold">&times;</span>
                <h3 className="text-xs font-bold text-rose-400 uppercase tracking-wider font-mono">Naive LOC Metric</h3>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed mb-3">
                Someone runs an automated linter (Prettier) to reformat 2,400 lines of whitespace. Naive platforms award them 50% of the entire bounty. Meanwhile, the security researcher who patched a critical exploit in 5 lines gets 1%.
              </p>
              <div className="text-[11px] text-zinc-500 font-mono">
                Formula: Payout = Lines Changed &rarr; Rewards spam, punishes problem-solvers.
              </div>
            </div>

            <div className="bg-[#121316] border border-emerald-950/50 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-5 h-5 rounded-full bg-emerald-950/80 text-emerald-400 flex items-center justify-center text-xs font-bold">&check;</span>
                <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider font-mono">Shapley Marginal Attribution</h3>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed mb-3">
                Simulating every combination of team members collaborating: <em>&ldquo;How much does the project suffer if you&apos;re not on the team?&rdquo;</em> If a 5-line security patch turns a vulnerable repo into an enterprise release, the allocation is proportional to marginal value.
              </p>
              <div className="text-[11px] text-emerald-400 font-mono">
                Formula: Payout = Marginal Contribution &phi;&#7522;(v) &rarr; Provable axiomatic efficiency &amp; zero float dust.
              </div>
            </div>
          </div>
        </div>

        {/* End-to-End Workflow Pipeline */}
        <div className="mt-8 pt-8 border-t border-[#1e2024]">
          <div className="text-center mb-8">
            <h2 className="text-xl font-bold text-white tracking-tight">End-to-End Workflow Architecture</h2>
            <p className="text-xs text-zinc-400 mt-1 max-w-xl mx-auto font-mono">
              Connecting git commit history to mathematical attribution and instant PayPal settlements
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#121316] border border-[#1e2024] rounded-xl p-5 relative">
              <div className="w-7 h-7 rounded-lg bg-zinc-800 text-zinc-300 font-mono text-xs font-bold flex items-center justify-center mb-3 border border-zinc-700">
                01
              </div>
              <h3 className="font-semibold text-sm text-zinc-200 mb-1.5">Git Ingestion</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Parallelized commit fetching. Filters out noise (lockfiles, minified bundles, auto-lints) to isolate genuine semantic changes.
              </p>
            </div>

            <div className="bg-[#121316] border border-[#1e2024] rounded-xl p-5 relative">
              <div className="w-7 h-7 rounded-lg bg-zinc-800 text-zinc-300 font-mono text-xs font-bold flex items-center justify-center mb-3 border border-zinc-700">
                02
              </div>
              <h3 className="font-semibold text-sm text-zinc-200 mb-1.5">Coalition Scoring</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Forms all 2<sup>N</sup> contributor subsets. Google Gemini scores each coalition capability v(S) &isin; [0, 100] across 4 rubric dimensions.
              </p>
            </div>

            <div className="bg-[#121316] border border-[#1e2024] rounded-xl p-5 relative">
              <div className="w-7 h-7 rounded-lg bg-zinc-800 text-zinc-300 font-mono text-xs font-bold flex items-center justify-center mb-3 border border-zinc-700">
                03
              </div>
              <h3 className="font-semibold text-sm text-zinc-200 mb-1.5">Game Theory Proofs</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Computes exact marginal contributions &phi;&#7522;. Enforces Monotonicity: v(S &cup; &#123;i&#125;) &ge; v(S) to eliminate temperature noise.
              </p>
            </div>

            <div className="bg-[#121316] border border-[#1e2024] rounded-xl p-5 relative">
              <div className="w-7 h-7 rounded-lg bg-zinc-800 text-zinc-300 font-mono text-xs font-bold flex items-center justify-center mb-3 border border-zinc-700">
                04
              </div>
              <h3 className="font-semibold text-sm text-zinc-200 mb-1.5">PayPal Settlement</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Deterministic batch payout via PayPal REST API. Human maintains confirmation authority with SHA-256 idempotency protection.
              </p>
            </div>
          </div>

          {/* Agentic Commerce Workflow Banner */}
          <div className="mt-6 bg-[#121316] border border-[#1e2024] rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 font-mono">
                  Autonomous Multi-Agent Layer &middot; MCP Protocol
                </span>
              </div>
              <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed font-mono">
                Autonomous AI developer agents discover Shapley via Model Context Protocol (MCP) endpoints (<code className="text-zinc-200 font-mono">/api/agent/tools</code>), negotiate fair pull request splits programmatically, and disburse payouts directly into agent wallets.
              </p>
            </div>
            <a
              href="https://github.com/nepalanurag/shapley/blob/main/backend/agent_tool.py"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold font-mono px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-lg whitespace-nowrap transition-colors"
            >
              View MCP Schema &rarr;
            </a>
          </div>
        </div>

        <div className="mt-16 text-center border-t border-[#1e2024] pt-8 animate-rise stagger-5">
          <p className="text-xs uppercase tracking-widest text-zinc-500 mb-4 font-semibold font-mono">
            Infrastructure &amp; Protocol Stack
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-mono text-zinc-400">
            <span className="flex items-center gap-2 bg-[#121316] border border-[#1e2024] px-3 py-1.5 rounded-md">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              PayPal Orders v2 &amp; Payouts
            </span>
            <span className="flex items-center gap-2 bg-[#121316] border border-[#1e2024] px-3 py-1.5 rounded-md">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400"></span>
              Google Gemini 2.5 Flash
            </span>
            <span className="flex items-center gap-2 bg-[#121316] border border-[#1e2024] px-3 py-1.5 rounded-md">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400"></span>
              AG Grid Community
            </span>
            <span className="flex items-center gap-2 bg-[#121316] border border-[#1e2024] px-3 py-1.5 rounded-md">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400"></span>
              Render Cloud
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
