"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { pollAnalysis } from "@/lib/api";

function AnalyzeContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState("queued");
  const [error, setError] = useState("");
  const [contributors, setContributors] = useState<any[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    const jobId = params.get("job");
    if (!jobId) {
      setError("No analysis job specified");
      return;
    }

    let cancelled = false;
    let pollInterval = 2000;
    const poll = async () => {
      try {
        const j = await pollAnalysis(jobId);
        if (cancelled) return;

        setStatus(j.status);
        if (j.contributors) setContributors(j.contributors);

        // Estimate progress from status
        if (j.status === "ingesting") setProgress({ current: 1, total: 4 });
        else if (j.status === "scoring") {
          const total = typeof j.num_coalitions === "number" ? j.num_coalitions : 16;
          const done = Array.isArray(j.evaluations) ? j.evaluations.length : 0;
          setProgress({ current: done, total });
        } else if (j.status === "computing_shapley") setProgress({ current: 3, total: 4 });
        else if (j.status === "complete") {
          router.push(`/results?job=${jobId}`);
          return;
        } else if (j.status === "failed") {
          setError(j.error || "Analysis failed");
          return;
        }

        pollInterval = Math.min(pollInterval + 500, 5000);
        if (!cancelled) setTimeout(poll, pollInterval);
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || "Connection failed");
          pollInterval = Math.min(pollInterval + 1000, 6000);
          setTimeout(poll, pollInterval);
        }
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [params, router]);

  const pct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : status === "queued" ? 5 : 25;

  const statusText: Record<string, string> = {
    queued: "Queued — starting analysis...",
    ingesting: "Fetching commits from GitHub...",
    scoring: "AI is evaluating code contributions...",
    computing_shapley: "Computing Shapley values...",
  };

  if (error) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center max-w-md animate-scale-in">
          <div className="text-red-400 text-lg mb-2">Analysis failed</div>
          <p className="text-zinc-400 text-sm mb-6">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="bg-zinc-800 hover:bg-zinc-700 px-6 py-2 rounded-lg btn-interactive"
          >
            Try Again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
      <div className="max-w-lg w-full px-6 animate-rise">
        <div className="text-center mb-8">
          <div className="relative w-16 h-16 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full border-2 border-blue-500/20" />
            <div className="absolute inset-0 rounded-full border-t-2 border-blue-500 animate-spin" />
            <div className="absolute inset-2 rounded-full bg-blue-500/10 loading-ring" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Analyzing Contributions</h1>
          <p className="text-zinc-400 text-sm animate-breathe">
            {statusText[status] || "Working..."}
          </p>
        </div>

        {/* Progress bar with smooth fill animation */}
        <div className="bg-zinc-800 rounded-full h-2 overflow-hidden mb-4">
          <div
            className="bg-blue-500 h-full rounded-full progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-center text-xs text-zinc-500 mb-8">
          {progress.total > 0
            ? `${progress.current} of ${progress.total} coalitions scored`
            : `${pct}%`}
        </p>

        {/* Contributors found so far */}
        {contributors.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 animate-fade">
            <p className="text-sm text-zinc-400 mb-3">
              Found {contributors.length} contributors
            </p>
            <div className="space-y-2">
              {contributors.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm animate-rise"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <span className="text-zinc-200">{c.name}</span>
                  <span className="text-zinc-500">{c.commits} commits</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-zinc-600 mt-8">
          This typically takes 2–5 minutes for small teams.
          <br />
          Each coalition is scored by AI for semantic impact.
        </p>
      </div>
    </main>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <AnalyzeContent />
    </Suspense>
  );
}
