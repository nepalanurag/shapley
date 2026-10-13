"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startAnalysis, fetchDemo } from "@/lib/api";

export default function Home() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("");
  const [total, setTotal] = useState("1000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAnalyze = async (demo: boolean) => {
    setError("");
    setLoading(true);
    try {
      if (demo) {
        // Store demo flag and go to results
        sessionStorage.setItem("shapley_demo", "true");
        sessionStorage.setItem("shapley_total", total);
        router.push("/results?demo=true");
      } else {
        if (!repoUrl.trim()) {
          setError("Enter a GitHub repo URL (e.g. octocat/Hello-World)");
          setLoading(false);
          return;
        }
        const { job_id } = await startAnalysis(repoUrl.trim(), parseFloat(total) || 1000, false);
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
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="text-center mb-12 animate-rise">
          <h1 className="text-5xl font-bold tracking-tight mb-4">
            Shapley
          </h1>
          <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
            Fair revenue splits for collaborative work. AI evaluates each
            contributor&apos;s real impact, game theory calculates fair shares,
            PayPal executes the payout.
          </p>
        </div>

        <div className="bg-zinc-900 rounded-xl p-8 border border-zinc-800 animate-rise stagger-1">
          <h2 className="text-lg font-semibold mb-6">Analyze a repository</h2>

          <label className="block text-sm text-zinc-400 mb-2">
            GitHub repository
          </label>
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="octocat/Hello-World or https://github.com/owner/repo"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 mb-4 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
          />

          <label className="block text-sm text-zinc-400 mb-2">
            Total payout amount (USD)
          </label>
          <input
            type="number"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            min="1"
            step="0.01"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 mb-6 text-zinc-100 focus:outline-none focus:border-blue-500 transition-colors"
          />

          {error && (
            <div className="bg-red-950 border border-red-800 text-red-200 rounded-lg px-4 py-3 mb-4 text-sm animate-shake">
              {error}
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={() => handleAnalyze(false)}
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg px-6 py-3 btn-interactive"
            >
              {loading ? "Starting..." : "Analyze Contributions"}
            </button>
            <button
              onClick={() => handleAnalyze(true)}
              disabled={loading}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 font-medium rounded-lg px-6 py-3 border border-zinc-700 btn-interactive"
            >
              Try Demo
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mt-12">
          <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 animate-rise stagger-2">
            <h3 className="font-semibold mb-2">AI Evaluation</h3>
            <p className="text-sm text-zinc-400">
              Gemini reads every commit diff and scores semantic impact —
              not line counts, actual contribution value.
            </p>
          </div>
          <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 animate-rise stagger-3">
            <h3 className="font-semibold mb-2">Shapley Fairness</h3>
            <p className="text-sm text-zinc-400">
              Cooperative game theory computes each person&apos;s marginal
              contribution across every possible team combination.
            </p>
          </div>
          <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 animate-rise stagger-4">
            <h3 className="font-semibold mb-2">PayPal Payout</h3>
            <p className="text-sm text-zinc-400">
              One click executes the fair split via PayPal Payouts.
              Full audit trail of every AI decision.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
