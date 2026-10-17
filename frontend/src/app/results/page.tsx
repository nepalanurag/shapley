"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  ColDef,
  themeQuartz,
} from "ag-grid-community";
import { AgCharts } from "ag-charts-react";
import {
  fetchDemo,
  pollAnalysis,
  executePayout,
  payoutStatus as fetchPayoutStatus,
  AnalysisResult,
  Contributor,
} from "@/lib/api";

ModuleRegistry.registerModules([AllCommunityModule]);

const darkTheme = themeQuartz.withParams({
  backgroundColor: "#18181b",
  foregroundColor: "#f4f4f5",
  headerBackgroundColor: "#27272a",
  oddRowBackgroundColor: "#1c1c1f",
  borderColor: "#3f3f46",
});

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <ResultsContent />
    </Suspense>
  );
}

function ResultsContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [payoutResult, setPayoutResult] = useState<any>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [payoutStatus, setPayoutStatus] = useState<string | null>(null);
  const [emailOverrides, setEmailOverrides] = useState<Record<string, string>>({});
  const [editingEmails, setEditingEmails] = useState(false);
  const [showMath, setShowMath] = useState(false);

  useEffect(() => {
    const load = async () => {
      const isDemo = params.get("demo") === "true";
      const jobId = params.get("job");
      try {
        if (isDemo) {
          const d = await fetchDemo();
          setData(d);
          setStatus("complete");
        } else if (jobId) {
          // Poll until complete
          let pollDelay = 2500;
          const poll = async () => {
            const j = await pollAnalysis(jobId);
            if (j.status === "complete") {
              setData(j);
              setStatus("complete");
            } else if (j.status === "failed") {
              setError(j.error || "Analysis failed");
              setStatus("failed");
            } else {
              setStatus(j.status);
              pollDelay = Math.min(pollDelay + 500, 6000);
              setTimeout(poll, pollDelay);
            }
          };
          poll();
        } else {
          setError("No job or demo specified");
          setStatus("failed");
        }
      } catch (e: any) {
        setError(e.message);
        setStatus("failed");
      }
    };
    load();
  }, [params]);

  const contributorCols: ColDef<Contributor>[] = useMemo(
    () => [
      { field: "name", headerName: "Contributor", flex: 1, sortable: true },
      { field: "commits", headerName: "Commits", width: 100, sortable: true },
      {
        field: "additions",
        headerName: "Lines +",
        width: 100,
        sortable: true,
        valueFormatter: (p) => (p.value ?? 0).toLocaleString(),
      },
      {
        field: "deletions",
        headerName: "Lines -",
        width: 100,
        sortable: true,
        valueFormatter: (p) => (p.value ?? 0).toLocaleString(),
      },
      {
        field: "shapley_value",
        headerName: "Shapley Value",
        width: 140,
        sortable: true,
        valueFormatter: (p) => Number(p.value).toFixed(1),
      },
      {
        field: "share_pct",
        headerName: "Share %",
        width: 170,
        sortable: true,
        valueFormatter: (p) => {
          const row = p.data as Contributor;
          const val = Number(p.value).toFixed(1);
          if (
            row?.share_ci_low != null &&
            row?.share_ci_high != null &&
            row.share_ci_low !== row.share_ci_high
          ) {
            return `${val}% [${row.share_ci_low.toFixed(1)}, ${row.share_ci_high.toFixed(1)}]`;
          }
          return `${val}%`;
        },
        cellStyle: { fontWeight: "bold", color: "#60a5fa" },
      },
      {
        field: "payout_usd",
        headerName: "Payout (USD)",
        width: 200,
        sortable: true,
        valueFormatter: (p) => {
          const row = p.data as Contributor;
          const val = Number(p.value).toFixed(2);
          if (
            row?.payout_ci_low != null &&
            row?.payout_ci_high != null &&
            row.payout_ci_low !== row.payout_ci_high
          ) {
            return `$${val} [$${row.payout_ci_low.toFixed(2)}, $${row.payout_ci_high.toFixed(2)}]`;
          }
          return `$${val}`;
        },
        cellStyle: { fontWeight: "bold", color: "#34d399" },
      },
    ],
    []
  );

  const chartOptions = useMemo(() => {
    if (!data) return null;
    const totalLines = data.contributors.reduce(
      (acc, cur) => acc + (cur.additions || 0) + (cur.deletions || 0),
      0
    );

    return {
      data: data.contributors.map((c) => {
        const lines = (c.additions || 0) + (c.deletions || 0);
        const linesPct = totalLines > 0 ? (lines / totalLines) * 100 : 0;
        return {
          contributor: c.name,
          aiShare: Number(c.share_pct.toFixed(1)),
          linesShare: Number(linesPct.toFixed(1)),
        };
      }),
      series: [
        {
          type: "bar",
          xKey: "contributor",
          yKey: "aiShare",
          yName: "AI Shapley Fair %",
          fill: "#3b82f6",
        } as any,
        {
          type: "bar",
          xKey: "contributor",
          yKey: "linesShare",
          yName: "Lines Changed % (Naive)",
          fill: "#52525b",
        } as any,
      ],
      axes: [
        { type: "category", position: "bottom", title: { text: "Contributor" } },
        { type: "number", position: "left", title: { text: "Share %" } },
      ] as any,
      legend: {
        position: "top",
        item: {
          label: {
            color: "#e4e4e7",
          },
        },
      },
      background: { fill: "#18181b" },
    };
  }, [data]);

  const handlePayout = async () => {
    if (!data) return;
    setShowConfirm(true);
  };

  const getEffectiveEmail = (c: Contributor) =>
    emailOverrides[c.email] ?? c.email;

  const confirmPayout = async () => {
    if (!data) return;
    setShowConfirm(false);
    setPaying(true);
    setError("");
    try {
      const shares = data.contributors.map((c) => ({
        email: getEffectiveEmail(c),
        amount: c.payout_usd,
        note: `Shapley fair share: ${c.share_pct.toFixed(1)}%`,
      }));
      const result = await executePayout(shares, data.total_amount);
      setPayoutResult(result);
      setPayoutStatus(result.status);
      // Poll for completion
      pollPayoutStatus(result.batch_id);
    } catch (e: any) {
      setError(e.message);
    }
    setPaying(false);
  };

  const pollPayoutStatus = async (batchId: string) => {
    // Poll with progressive backoff: 3s -> 4s -> 5s -> max 8s
    let delay = 3000;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, delay));
      try {
        const s = await fetchPayoutStatus(batchId);
        setPayoutStatus(s.status);
        if (["SUCCESS", "DENIED", "CANCELED"].includes(s.status)) break;
      } catch {
        break; // Stop polling on error
      }
      delay = Math.min(delay + 1000, 8000);
    }
  };

  if (status === "loading" || status === "ingesting" || status === "scoring" || status === "computing_shapley" || status === "queued") {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-zinc-400">
            {status === "loading" ? "Loading..." :
             status === "queued" ? "Queued..." :
             status === "ingesting" ? "Fetching commits from GitHub..." :
             status === "scoring" ? "AI is evaluating contributions..." :
             "Computing Shapley values..."}
          </p>
        </div>
      </main>
    );
  }

  if (status === "failed" || !data) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-red-400 mb-4">{error || "Something went wrong"}</p>
          <button onClick={() => router.push("/")}
            className="bg-zinc-800 hover:bg-zinc-700 px-6 py-2 rounded-lg">
            Back
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Fair Share Results</h1>
            <p className="text-zinc-400 mt-1">
              {data.repo} · ${data.total_amount.toFixed(2)} total ·{" "}
              {data.num_coalitions} coalitions evaluated
              {data.demo_mode && (
                <span className="ml-2 bg-yellow-900 text-yellow-200 text-xs px-2 py-1 rounded">
                  DEMO
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => router.push(`/audit?demo=${params.get("demo")}&job=${params.get("job") || ""}`)}
              className="bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-lg text-sm border border-zinc-700">
              View Audit Trail
            </button>
            <button onClick={() => router.push("/")}
              className="bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-lg text-sm border border-zinc-700">
              New Analysis
            </button>
          </div>
        </div>

        {/* Executive Summary Card */}
        {data.summary && (
          <div className="bg-gradient-to-r from-blue-950/40 via-zinc-900 to-zinc-900 border border-blue-900/40 rounded-xl p-5 mb-8 flex items-start gap-4 animate-rise">
            <div className="w-9 h-9 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
                  AI Contribution Synthesis
                </h3>
                <button
                  onClick={() => setShowMath(!showMath)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 underline flex items-center gap-1"
                >
                  {showMath ? "Hide Game Theory Details" : "How Shapley Math Works"}
                </button>
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">
                {data.summary}
              </p>
            </div>
          </div>
        )}

        {/* Game Theory Explainer Dropdown */}
        {showMath && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8 text-sm text-zinc-300 animate-rise">
            <h4 className="font-semibold text-zinc-100 mb-2">The Shapley Value Formula</h4>
            <p className="text-zinc-400 mb-3">
              Shapley values calculate each contributor&apos;s expected marginal contribution across all possible team coalitions <code className="text-blue-300">S ⊆ N \ &#123;i&#125;</code>:
            </p>
            <div className="bg-zinc-950 p-3 rounded-lg font-mono text-xs text-blue-400 overflow-x-auto mb-4 border border-zinc-800">
              φᵢ = ∑ [ |S|! · (n - |S| - 1)! / n! ] × ( v(S ∪ &#123;i&#125;) - v(S) )
            </div>
            <div className="grid sm:grid-cols-3 gap-4 text-xs">
              <div className="bg-zinc-800/50 p-3 rounded-lg">
                <span className="font-semibold text-zinc-100 block mb-1">1. Efficiency</span>
                100% of the revenue is distributed. The sum of all shares equals the exact payout.
              </div>
              <div className="bg-zinc-800/50 p-3 rounded-lg">
                <span className="font-semibold text-zinc-100 block mb-1">2. Symmetry</span>
                Contributors with identical marginal value across coalitions receive identical payouts.
              </div>
              <div className="bg-zinc-800/50 p-3 rounded-lg">
                <span className="font-semibold text-zinc-100 block mb-1">3. Dummy Player</span>
                A contributor whose code adds zero marginal value receives a zero payout.
              </div>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold">Attribution Comparison</h2>
                <p className="text-xs text-zinc-400">AI Semantic Impact vs. Raw Lines of Code</p>
              </div>
            </div>
            {chartOptions && (
              <AgCharts options={chartOptions as any} style={{ height: 300 }} />
            )}
          </div>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
            <h2 className="font-semibold mb-4">Summary</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Contributors</span>
                <span className="font-medium">{data.contributors.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Coalitions scored</span>
                <span className="font-medium">{data.num_coalitions}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">AI API calls</span>
                <span className="font-medium">{data.api_calls}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Total payout</span>
                <span className="font-medium text-green-400">
                  ${data.total_amount.toFixed(2)}
                </span>
              </div>
            </div>
            {!payoutResult ? (
              <button
                onClick={handlePayout}
                disabled={paying}
                className="w-full mt-6 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-lg px-6 py-3 btn-interactive"
              >
                {paying ? "Executing..." : "Execute Payout via PayPal"}
              </button>
            ) : (
              <div className="mt-6 bg-green-950 border border-green-800 rounded-lg p-4 animate-pop">
                <div className="flex items-center gap-3">
                  {payoutStatus === "SUCCESS" ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
                      <circle cx="12" cy="12" r="10" fill="#34d399" opacity="0.2" />
                      <path d="M8 12.5l2.5 2.5L16 9.5" stroke="#34d399" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round" className="check-draw" />
                    </svg>
                  ) : (
                    <div className="w-6 h-6 rounded-full border-2 border-green-500 border-t-transparent animate-spin flex-shrink-0" />
                  )}
                  <div>
                    <p className="text-green-200 font-medium">
                      {payoutStatus === "SUCCESS" ? "Payout complete!" :
                       payoutStatus === "DENIED" ? "Payout denied" :
                       payoutStatus === "CANCELED" ? "Payout canceled" :
                       "Payout processing..."}
                    </p>
                    <p className="text-sm text-green-300/70 mt-1 font-mono">
                      {payoutResult.batch_id}
                    </p>
                    {payoutStatus && payoutStatus !== "SUCCESS" && (
                      <p className="text-xs text-green-300/50 mt-1">
                        Status: {payoutStatus} — updating live
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Payout confirmation modal */}
        {showConfirm && data && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/70 modal-backdrop"
              onClick={() => setShowConfirm(false)}
            />
            <div className="relative bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-md w-full modal-content">
              <h3 className="text-lg font-bold mb-2">Confirm Payout</h3>
              <p className="text-sm text-zinc-400 mb-4">
                This will send{" "}
                <span className="text-green-400 font-semibold">
                  ${data.total_amount.toFixed(2)}
                </span>{" "}
                via PayPal Payouts to {data.contributors.length} contributors.
                This cannot be undone.
              </p>
              <div className="bg-zinc-800 rounded-lg p-3 mb-4 max-h-48 overflow-y-auto">
                {data.contributors.map((c) => (
                  <div key={c.email} className="flex justify-between text-sm py-1">
                    <span className="text-zinc-300">{c.name}</span>
                    <span className="text-zinc-400">
                      ${c.payout_usd.toFixed(2)} ({c.share_pct.toFixed(1)}%)
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg px-4 py-2.5 btn-interactive"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmPayout}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg px-4 py-2.5 btn-interactive"
                >
                  Send ${data.total_amount.toFixed(2)}
                </button>
              </div>
              <p className="text-xs text-zinc-500 mt-3 text-center">
                AI recommended these shares. You are confirming the execution.
              </p>
            </div>
          </div>
        )}

        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 animate-rise stagger-2">
          <div className="flex items-center justify-between mb-4 px-2">
            <h2 className="font-semibold">Contributor Breakdown</h2>
            <button
              onClick={() => setEditingEmails(!editingEmails)}
              className="text-sm text-blue-400 hover:text-blue-300 btn-interactive"
            >
              {editingEmails ? "Done" : "Edit PayPal emails"}
            </button>
          </div>

          {editingEmails && data && (
            <div className="px-2 pb-4 space-y-2 animate-fade">
              <p className="text-xs text-zinc-500">
                GitHub emails may not match PayPal accounts. Override them here.
              </p>
              {data.contributors.map((c) => (
                <div key={c.email} className="flex items-center gap-3 text-sm">
                  <span className="w-32 truncate text-zinc-300">{c.name}</span>
                  <input
                    type="email"
                    value={getEffectiveEmail(c)}
                    onChange={(e) =>
                      setEmailOverrides((prev) => ({
                        ...prev,
                        [c.email]: e.target.value,
                      }))
                    }
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-blue-500"
                    placeholder="paypal@email.com"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="ag-theme-quartz" style={{ height: 300 }}>
            <AgGridReact
              theme={darkTheme}
              rowData={data.contributors}
              columnDefs={contributorCols}
              defaultColDef={{ resizable: true }}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
