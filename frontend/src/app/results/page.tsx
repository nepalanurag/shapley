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
  const [adjustedAmount, setAdjustedAmount] = useState<number | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);

  const currentTotal = adjustedAmount ?? data?.total_amount ?? 1000;

  const displayedContributors = useMemo(() => {
    if (!data) return [];
    return data.contributors.map((c) => ({
      ...c,
      payout_usd: Math.round(currentTotal * c.share_pct) / 100,
      payout_ci_low: c.share_ci_low != null ? Math.round(currentTotal * c.share_ci_low) / 100 : undefined,
      payout_ci_high: c.share_ci_high != null ? Math.round(currentTotal * c.share_ci_high) / 100 : undefined,
    }));
  }, [data, currentTotal]);

  const copyMarkdown = () => {
    if (!data) return;
    const lines = [
      `### ⚖️ Fair Revenue Split for ${data.repo}`,
      `**Total Pool:** $${currentTotal.toFixed(2)} USD · Calculated via Shapley Cooperative Game Theory`,
      "",
      "| Contributor | GitHub Commits | Lines Changed | Shapley Marginal Share % | Payout (USD) |",
      "| :--- | :--- | :--- | :--- | :--- |",
      ...displayedContributors.map((c) => {
        return `| **${c.name}** | ${c.commits} | +${c.additions} / -${c.deletions} | ${c.share_pct.toFixed(1)}% | **$${c.payout_usd.toFixed(2)}** |`;
      }),
      "",
      `*Disbursed deterministically via PayPal Payouts API • Protected by SHA-256 Idempotency*`
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 2500);
  };

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
      const shares = displayedContributors.map((c) => ({
        email: getEffectiveEmail(c),
        amount: c.payout_usd,
        note: `Shapley fair share: ${c.share_pct.toFixed(1)}%`,
      }));
      const result = await executePayout(shares, currentTotal);
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

  const exportCSV = () => {
    if (!data) return;
    const headers = ["Contributor", "Email", "Commits", "Lines Added", "Lines Deleted", "Shapley Value", "Share Pct", "Payout USD"];
    const rows = data.contributors.map((c) => [
      `"${c.name}"`,
      `"${emailOverrides[c.name] || c.email || ""}"`,
      c.commits,
      c.additions,
      c.deletions,
      c.shapley_value,
      `${c.share_pct}%`,
      `$${c.payout_usd.toFixed(2)}`
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `shapley_payout_${data.repo.replace("/", "_")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-zinc-500 mb-4">
          <button onClick={() => router.push("/")} className="hover:text-zinc-300 transition-colors">
            Home
          </button>
          <span>/</span>
          <span className="font-mono text-zinc-400">{data.repo}</span>
          <span>/</span>
          <span className="text-zinc-300">Fair Share Results</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-8 border-b border-zinc-800/80 gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Fair Share Results</h1>
            <p className="text-zinc-400 mt-1 text-sm font-mono">
              {data.repo} · ${data.total_amount.toFixed(2)} USD pool ·{" "}
              {data.num_coalitions} coalitions evaluated
              {data.demo_mode && (
                <span className="ml-2 bg-yellow-900/60 border border-yellow-700/50 text-yellow-200 text-xs px-2 py-0.5 rounded font-sans font-semibold">
                  DEMO MODE
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={copyMarkdown}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-lg text-xs font-semibold border border-zinc-700 flex items-center gap-1.5 transition-colors text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              {copiedMd ? "Copied Markdown!" : "Copy PR Markdown"}
            </button>
            <button
              onClick={() => setShowActionModal(true)}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-lg text-xs font-semibold border border-zinc-700 flex items-center gap-1.5 transition-colors text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
              CI/CD Action
            </button>
            <button
              onClick={exportCSV}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-lg text-xs font-semibold border border-zinc-700 flex items-center gap-1.5 transition-colors text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Export CSV
            </button>
            <button onClick={() => router.push(`/audit?demo=${params.get("demo")}&job=${params.get("job") || ""}`)}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-lg text-xs font-semibold border border-zinc-700 transition-colors text-zinc-200">
              View Audit Trail
            </button>
            <button onClick={() => router.push("/")}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-lg text-xs font-semibold border border-zinc-700 transition-colors text-zinc-200">
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
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8 text-sm text-zinc-300 animate-rise shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-zinc-100 flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-serif font-bold">
                  &phi;
                </span>
                The Shapley Value Formula & Game Theory Proofs
              </h4>
              <span className="text-[11px] font-mono text-zinc-500 bg-zinc-950 px-2.5 py-0.5 rounded border border-zinc-800">
                Lloyd Shapley (1953) &middot; Nobel Memorial Prize
              </span>
            </div>
            <p className="text-zinc-400 mb-4 text-xs leading-relaxed">
              Calculates each contributor&apos;s expected marginal contribution across all possible team coalitions <code className="text-blue-300 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800 font-mono text-xs">S &sube; N \ &#123;i&#125;</code>:
            </p>

            {/* Styled Mathematical Formula Container */}
            <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800/90 mb-5 flex items-center justify-center overflow-x-auto">
              <div className="flex items-center gap-3 font-serif text-sm sm:text-base text-zinc-200 select-none py-1">
                <span className="text-blue-400 font-bold italic text-lg sm:text-xl">&phi;<sub>i</sub></span>
                <span className="text-zinc-400 text-lg">&equals;</span>
                <div className="flex items-center gap-1.5">
                  <div className="flex flex-col items-center">
                    <span className="text-xs text-zinc-500 font-sans tracking-tighter">S &sube; N \ &#123;i&#125;</span>
                    <span className="text-xl text-blue-400 font-sans">&sum;</span>
                  </div>
                  <div className="inline-flex flex-col items-center text-center px-1 font-sans text-xs sm:text-sm">
                    <span className="border-b border-zinc-600 px-2 pb-0.5 font-mono text-blue-300">
                      |S|! &middot; (n &minus; |S| &minus; 1)!
                    </span>
                    <span className="pt-0.5 font-mono text-zinc-400">n!</span>
                  </div>
                  <span className="text-zinc-400 text-lg sm:text-xl">&times;</span>
                  <div className="flex items-center gap-1 bg-zinc-900/90 border border-zinc-800 px-3 py-1.5 rounded-lg font-mono text-xs text-emerald-400">
                    <span>v(S &cup; &#123;i&#125;) &minus; v(S)</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid sm:grid-cols-4 gap-3 text-xs">
              <div className="bg-zinc-800/40 border border-zinc-800 p-3 rounded-lg">
                <span className="font-semibold text-zinc-200 block mb-1">1. Efficiency</span>
                <span className="font-mono text-[11px] text-blue-400 block mb-1">&sum; &phi;&#7522; &equals; 100%</span>
                <span className="text-zinc-400 text-[11px] leading-tight block">Exact total bounty is distributed with 0 rounding leakage.</span>
              </div>
              <div className="bg-zinc-800/40 border border-zinc-800 p-3 rounded-lg">
                <span className="font-semibold text-zinc-200 block mb-1">2. Symmetry</span>
                <span className="font-mono text-[11px] text-blue-400 block mb-1">&phi;&#7522; &equals; &phi;&#11388; if &Delta;v equal</span>
                <span className="text-zinc-400 text-[11px] leading-tight block">Contributors with equal marginal capability receive equal payout.</span>
              </div>
              <div className="bg-zinc-800/40 border border-zinc-800 p-3 rounded-lg">
                <span className="font-semibold text-zinc-200 block mb-1">3. Dummy Player</span>
                <span className="font-mono text-[11px] text-blue-400 block mb-1">&phi;&#7522; &equals; 0 if &Delta;v &equals; 0</span>
                <span className="text-zinc-400 text-[11px] leading-tight block">Zero marginal utility code changes yield zero bounty.</span>
              </div>
              <div className="bg-zinc-800/40 border border-zinc-800 p-3 rounded-lg">
                <span className="font-semibold text-zinc-200 block mb-1">4. Monotonicity</span>
                <span className="font-mono text-[11px] text-emerald-400 block mb-1">v(S &cup; &#123;i&#125;) &ge; v(S)</span>
                <span className="text-zinc-400 text-[11px] leading-tight block">Enforced strictly to prevent LLM temperature regressions.</span>
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
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 flex flex-col justify-between">
            <div>
              <h2 className="font-semibold mb-4">Summary &amp; Settlement</h2>

              {/* Real-time Pool Simulator */}
              <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-xl p-3.5 mb-5">
                <div className="flex items-center justify-between mb-2 text-xs">
                  <span className="text-zinc-400 font-medium">Bounty Pool Simulator</span>
                  <span className="font-mono text-emerald-400 font-bold text-sm">
                    ${currentTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD
                  </span>
                </div>
                <input
                  type="range"
                  min="100"
                  max="10000"
                  step="50"
                  value={currentTotal}
                  onChange={(e) => setAdjustedAmount(parseFloat(e.target.value))}
                  className="w-full accent-blue-500 bg-zinc-800 h-1.5 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-zinc-500 mt-1.5 font-mono">
                  <span>$100 min</span>
                  <span>$5,000</span>
                  <span>$10,000 max</span>
                </div>
              </div>

              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Contributors</span>
                  <span className="font-medium">{data.contributors.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Coalitions scored</span>
                  <span className="font-medium font-mono">{data.num_coalitions}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">AI API calls</span>
                  <span className="font-medium font-mono">{data.api_calls}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Total payout</span>
                  <span className="font-medium text-emerald-400 font-mono font-bold">
                    ${currentTotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-zinc-500 pt-2 border-t border-zinc-800/60">
                  <span>PayPal Batch Fee (${0.25} &times; {data.contributors.length})</span>
                  <span className="font-mono text-zinc-400">${(0.25 * data.contributors.length).toFixed(2)}</span>
                </div>
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
                <span className="text-emerald-400 font-semibold font-mono">
                  ${currentTotal.toFixed(2)}
                </span>{" "}
                via PayPal Payouts to {displayedContributors.length} contributors.
                This cannot be undone.
              </p>
              <div className="bg-zinc-800 rounded-lg p-3 mb-4 max-h-48 overflow-y-auto">
                {displayedContributors.map((c) => (
                  <div key={c.email} className="flex justify-between text-sm py-1 font-mono">
                    <span className="text-zinc-300 font-sans">{c.name}</span>
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
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg px-4 py-2.5 btn-interactive font-mono"
                >
                  Send ${currentTotal.toFixed(2)}
                </button>
              </div>
              <p className="text-xs text-zinc-500 mt-3 text-center">
                AI recommended these shares. You are confirming the execution.
              </p>
            </div>
          </div>
        )}

        {/* GitHub Action CI/CD Workflow Modal */}
        {showActionModal && data && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/70 modal-backdrop"
              onClick={() => setShowActionModal(false)}
            />
            <div className="relative bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-xl w-full modal-content">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-zinc-800">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  Automate via GitHub Actions
                </h3>
                <button onClick={() => setShowActionModal(false)} className="text-zinc-400 hover:text-white">&times;</button>
              </div>
              <p className="text-xs text-zinc-400 mb-3">
                Drop this workflow into <code className="text-blue-300 font-mono">.github/workflows/shapley.yml</code> to automatically calculate and disburse developer bounties upon each release tag:
              </p>
              <pre className="bg-zinc-950 p-3.5 rounded-lg text-xs font-mono text-zinc-300 border border-zinc-800 overflow-x-auto leading-relaxed mb-4">
{`name: Shapley Release Bounty
on:
  release:
    types: [published]

jobs:
  distribute:
    runs-on: ubuntu-latest
    steps:
      - name: Calculate Shapley Shares & Payout
        run: |
          curl -X POST https://shapley.onrender.com/api/agent/evaluate \\
            -H "Content-Type: application/json" \\
            -d '{"repo_url": "${data.repo}", "total_amount": ${currentTotal}}'`}
              </pre>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`name: Shapley Release Bounty\non:\n  release:\n    types: [published]\n\njobs:\n  distribute:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Calculate Shapley Shares & Payout\n        run: |\n          curl -X POST https://shapley.onrender.com/api/agent/evaluate \\\n            -H "Content-Type: application/json" \\\n            -d '{"repo_url": "${data.repo}", "total_amount": ${currentTotal}}'`);
                    alert("GitHub Action YAML copied to clipboard!");
                  }}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  Copy Workflow YAML
                </button>
              </div>
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
              {displayedContributors.map((c) => (
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
              rowData={displayedContributors}
              columnDefs={contributorCols}
              defaultColDef={{ resizable: true }}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
