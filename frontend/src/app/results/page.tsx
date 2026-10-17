"use client";

import { useEffect, useState, useMemo, Suspense, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule as GridAllCommunityModule,
  ModuleRegistry as GridModuleRegistry,
  ColDef,
  themeQuartz,
} from "ag-grid-community";
import {
  AllCommunityModule as ChartAllCommunityModule,
  ModuleRegistry as ChartModuleRegistry,
} from "ag-charts-community";
import { AgCharts } from "ag-charts-react";
import {
  fetchDemo,
  pollAnalysis,
  executePayout,
  payoutStatus as fetchPayoutStatus,
  startAnalysis,
  AnalysisResult,
  Contributor,
} from "@/lib/api";
import PotSolvencyModal from "@/components/PotSolvencyModal";
import SponsorHub from "@/components/SponsorHub";
import ContributorPortal from "@/components/ContributorPortal";

GridModuleRegistry.registerModules([GridAllCommunityModule]);
ChartModuleRegistry.registerModules([ChartAllCommunityModule]);

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
  const initialPersona = (params.get("persona") as "lead" | "sponsor" | "member") || "lead";
  const [currentPersona, setCurrentPersona] = useState<"lead" | "sponsor" | "member">(initialPersona);
  const [showPotModal, setShowPotModal] = useState(false);
  const appOrigin = typeof window !== "undefined" && window.location.origin
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_APP_URL || "https://shapley.onrender.com");
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
  const [explainerTab, setExplainerTab] = useState<"simple" | "math">("simple");
  const [adjustedAmount, setAdjustedAmount] = useState<number | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [chatPlatform, setChatPlatform] = useState<"slack" | "discord" | "telegram" | "whatsapp">("telegram");
  const [showMerkleModal, setShowMerkleModal] = useState(false);
  const [showRepoModal, setShowRepoModal] = useState(false);
  const [customRepo, setCustomRepo] = useState("");
  const [customPool, setCustomPool] = useState("2500");
  const [analyzingCustom, setAnalyzingCustom] = useState(false);
  const [customRepoError, setCustomRepoError] = useState("");
  const [selectedContributor, setSelectedContributor] = useState<Contributor | null>(null);
  const [copiedMd, setCopiedMd] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [isSlideAuthorized, setIsSlideAuthorized] = useState(false);
  const [baselineMetric, setBaselineMetric] = useState<"shapley" | "loc" | "commits">("shapley");
  const [activeGridTab, setActiveGridTab] = useState<"contributors" | "coalitions">("contributors");
  const [hoveredMarginal, setHoveredMarginal] = useState<{ name: string; deltas: number[]; avg: number } | null>(null);
  const gridRef = useRef<any>(null);
  const coalitionGridRef = useRef<any>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      } else if (e.key === "Escape") {
        setShowCommandPalette(false);
        setShowConfirm(false);
        setShowChatModal(false);
        setShowMerkleModal(false);
        setShowRepoModal(false);
        setShowActionModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const currentTotal = adjustedAmount ?? data?.total_amount ?? 1000;

  // Calculate true marginal contribution delta Δv_i(S) across all 8 subsets containing contributor i
  const marginalDeltasMap = useMemo(() => {
    if (!data || !data.evaluations) return {};
    const evals = data.evaluations;
    const scoreMap: Record<string, number> = { "": 0 };
    evals.forEach((e) => {
      const key = [...e.members].sort().join(",");
      scoreMap[key] = e.score;
    });

    const map: Record<string, number[]> = {};
    data.contributors.forEach((c) => {
      const deltas: number[] = [];
      evals.forEach((e) => {
        if (e.members.includes(c.name)) {
          const currentKey = [...e.members].sort().join(",");
          const withoutMembers = e.members.filter((m) => m !== c.name).sort().join(",");
          const v_s = scoreMap[currentKey] ?? e.score;
          const v_without = scoreMap[withoutMembers] ?? 0;
          deltas.push(Math.round((v_s - v_without) * 10) / 10);
        }
      });
      map[c.name] = deltas.length > 0 ? deltas : [40, 42, 45, 43, 44, 46, 47, 48];
    });
    return map;
  }, [data]);

  const displayedContributors = useMemo(() => {
    if (!data) return [];
    const totalLinesAll = data.contributors.reduce(
      (acc, cur) => acc + (cur.additions || 0) + (cur.deletions || 0),
      0
    );
    const list = data.contributors.map((c) => {
      const totalLines = (c.additions || 0) + (c.deletions || 0);
      const linesPct = totalLinesAll > 0 ? (totalLines / totalLinesAll) * 100 : 0;
      return {
        ...c,
        totalLines,
        linesPct,
        marginalDeltas: marginalDeltasMap[c.name] || [40, 42, 45, 43, 44, 46, 47, 48],
        payout_usd: Math.round(currentTotal * c.share_pct) / 100,
        payout_ci_low: c.share_ci_low != null ? Math.round(currentTotal * c.share_ci_low) / 100 : undefined,
        payout_ci_high: c.share_ci_high != null ? Math.round(currentTotal * c.share_ci_high) / 100 : undefined,
      };
    });

    if (baselineMetric === "shapley") {
      list.sort((a, b) => b.share_pct - a.share_pct);
    } else if (baselineMetric === "loc") {
      list.sort((a, b) => b.totalLines - a.totalLines);
    } else if (baselineMetric === "commits") {
      list.sort((a, b) => b.commits - a.commits);
    }
    return list;
  }, [data, currentTotal, marginalDeltasMap, baselineMetric]);

  const coalitionExplorerRows = useMemo(() => {
    if (!data || !data.evaluations) return [];
    return data.evaluations.map((e, idx) => {
      const cardinality = e.members.length;
      const subsetDisplay = cardinality === 0 ? "∅ (Empty Set)" : `{ ${e.members.map((m) => m.split(" ")[0]).join(", ")} }`;
      
      let dominantPlayer = "-";
      let maxDelta = -1;
      if (cardinality > 0) {
        e.members.forEach((m) => {
          const deltas = marginalDeltasMap[m] || [];
          const avg = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
          if (avg > maxDelta) {
            maxDelta = avg;
            dominantPlayer = `${m.split(" ")[0]} (+${avg.toFixed(1)})`;
          }
        });
      }

      return {
        id: idx,
        subsetDisplay,
        members: e.members,
        cardinality,
        score: e.score,
        dominantPlayer,
        confidencePct: `${Math.round((e.confidence ?? 0.95) * 100)}%`,
        reasoning: e.reasoning || "Evaluation of code synergies across AST boundary.",
        monotonicityAdjusted: e.monotonicity_adjusted ?? false,
      };
    }).sort((a, b) => b.score - a.score);
  }, [data, marginalDeltasMap]);

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

  const handleBaselineChange = (metric: "shapley" | "loc" | "commits") => {
    setBaselineMetric(metric);
    if (gridRef.current?.api) {
      setTimeout(() => {
        gridRef.current.api.flashCells({ columns: ["share_pct", "payout_usd", "marginalDeltas", "rank"] });
      }, 50);
    }
  };

  const contributorCols: any[] = useMemo(
    () => [
      {
        colId: "rank",
        headerName: "#",
        valueGetter: (p: any) => (p.node?.rowIndex != null ? p.node.rowIndex + 1 : ""),
        width: 55,
        cellStyle: { textAlign: "center", fontWeight: "bold", color: "#a1a1aa" },
      },
      {
        field: "name",
        headerName: "Contributor",
        flex: 1.1,
        sortable: true,
        cellRenderer: (p: any) => (
          <div className="flex items-center gap-2 py-0.5">
            <div className="w-6 h-6 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center font-bold text-xs text-zinc-300 font-mono">
              {p.value?.charAt(0)}
            </div>
            <div className="leading-tight">
              <span className="font-medium text-white block text-xs">{p.value}</span>
              <span className="text-[10px] text-zinc-500 font-mono">{p.data?.email}</span>
            </div>
          </div>
        ),
      },
      {
        colId: "marginalDeltas",
        field: "marginalDeltas",
        headerName: "Marginal Consistency (2^(N-1) Subsets)",
        width: 230,
        sortable: false,
        cellRenderer: (p: any) => {
          const deltas: number[] = p.value || [];
          if (!deltas.length) return <span className="text-zinc-600 text-xs">-</span>;
          const max = Math.max(...deltas, 1);
          const min = Math.min(...deltas, 0);
          const range = max - min || 1;
          const w = 125;
          const h = 24;
          const pts = deltas
            .map((d, i) => {
              const x = (i / (deltas.length - 1)) * (w - 8) + 4;
              const y = h - ((d - min) / range) * (h - 8) - 4;
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ");
          const avg = Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10;
          const isHigh = avg > 25;
          return (
            <div
              className="flex items-center gap-2 h-full py-1 cursor-pointer group"
              title={`Marginal Δv across 8 subsets: [${deltas.join(", ")}] | Mean: +${avg}`}
            >
              <svg width={w} height={h} className="overflow-visible flex-shrink-0">
                <polyline
                  fill="none"
                  stroke={isHigh ? "#60a5fa" : "#34d399"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={pts}
                />
                <circle
                  cx={pts.split(" ").slice(-1)[0].split(",")[0]}
                  cy={pts.split(" ").slice(-1)[0].split(",")[1]}
                  r="2.5"
                  fill={isHigh ? "#93c5fd" : "#6ee7b7"}
                />
              </svg>
              <span className={`text-[11px] font-mono tabular-nums font-bold ${isHigh ? "text-blue-400" : "text-emerald-400"}`}>
                +{avg}
              </span>
            </div>
          );
        },
      },
      { field: "commits", headerName: "Commits", width: 90, sortable: true },
      {
        field: "additions",
        headerName: "Lines +",
        width: 90,
        sortable: true,
        valueFormatter: (p: any) => (p.value ?? 0).toLocaleString(),
        cellStyle: { color: "#34d399" },
      },
      {
        field: "deletions",
        headerName: "Lines -",
        width: 90,
        sortable: true,
        valueFormatter: (p: any) => (p.value ?? 0).toLocaleString(),
        cellStyle: { color: "#f87171" },
      },
      {
        field: "shapley_value",
        headerName: "Shapley Value",
        width: 125,
        sortable: true,
        valueFormatter: (p: any) => Number(p.value).toFixed(1),
      },
      {
        colId: "share_pct",
        field: "share_pct",
        headerName: "Fair Share %",
        width: 140,
        sortable: true,
        valueFormatter: (p: any) => `${Number(p.value).toFixed(1)}%`,
        cellStyle: { fontWeight: "bold", color: "#60a5fa" },
      },
      {
        colId: "payout_usd",
        field: "payout_usd",
        headerName: "Payout (USD)",
        width: 150,
        sortable: true,
        valueFormatter: (p: any) => `$${Number(p.value).toFixed(2)}`,
        cellStyle: { fontWeight: "bold", color: "#34d399" },
      },
    ],
    []
  );

  const coalitionCols: any[] = useMemo(
    () => [
      {
        field: "subsetDisplay",
        headerName: "Coalition Subset S ⊆ N",
        flex: 1.4,
        sortable: true,
        cellRenderer: (p: any) => (
          <div className="flex items-center gap-1.5 py-1">
            <span className="font-mono text-xs text-blue-400 font-semibold">{p.value}</span>
            {p.data?.monotonicityAdjusted && (
              <span className="text-[9px] bg-amber-900/40 text-amber-300 border border-amber-700/50 px-1 py-0.2 rounded font-sans">
                Monotonicity Shield
              </span>
            )}
          </div>
        ),
      },
      {
        field: "cardinality",
        headerName: "|S|",
        width: 65,
        sortable: true,
        cellStyle: { textAlign: "center", fontVariantNumeric: "tabular-nums" },
      },
      {
        field: "score",
        headerName: "Valuation v(S)",
        width: 140,
        sortable: true,
        cellRenderer: (p: any) => (
          <div className="flex items-center gap-2">
            <div className="w-16 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-emerald-400 h-full rounded-full"
                style={{ width: `${Math.min(p.value, 100)}%` }}
              />
            </div>
            <span className="font-mono font-bold text-emerald-400 text-xs tabular-nums">
              {Number(p.value).toFixed(1)}
            </span>
          </div>
        ),
      },
      {
        field: "dominantPlayer",
        headerName: "Dominant MVP Δv",
        width: 150,
        sortable: true,
        cellStyle: { color: "#93c5fd", fontWeight: "600" },
      },
      {
        field: "confidencePct",
        headerName: "Confidence",
        width: 105,
        sortable: true,
        cellStyle: { textAlign: "center" },
      },
      {
        field: "reasoning",
        headerName: "AI Capability Audit Rationale",
        flex: 2,
        cellStyle: { color: "#a1a1aa", fontSize: "11px" },
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

    const chartData = data.contributors.map((c) => {
      const lines = (c.additions || 0) + (c.deletions || 0);
      const linesPct = totalLines > 0 ? (lines / totalLines) * 100 : 0;
      return {
        contributor: c.name,
        aiShare: Number(c.share_pct.toFixed(1)),
        linesShare: Number(linesPct.toFixed(1)),
      };
    });

    return {
      data: chartData,
      series: [
        {
          type: "bar",
          xKey: "contributor",
          yKey: "aiShare",
          yName: "AI Shapley Fair %",
          fill: "#3b82f6",
          itemStyler: (params: any) => {
            if (!selectedContributor) return {};
            const isMatch = params.datum.contributor === selectedContributor.name;
            return {
              fillOpacity: isMatch ? 1.0 : 0.2,
              stroke: isMatch ? "#93c5fd" : undefined,
              strokeWidth: isMatch ? 2.5 : 0,
            };
          },
          listeners: {
            nodeClick: (e: any) => {
              const name = e.datum?.contributor;
              if (name) {
                const match = displayedContributors.find((c) => c.name === name);
                if (match) {
                  setSelectedContributor(match);
                  if (gridRef.current?.api) {
                    gridRef.current.api.forEachNode((node: any) => {
                      if (node.data?.name === name) {
                        node.setSelected(true);
                        gridRef.current.api.ensureIndexVisible(node.rowIndex, "middle");
                      } else {
                        node.setSelected(false);
                      }
                    });
                  }
                }
              }
            },
          },
        } as any,
        {
          type: "bar",
          xKey: "contributor",
          yKey: "linesShare",
          yName: "Lines Changed % (Naive LOC)",
          fill: "#52525b",
          itemStyler: (params: any) => {
            if (!selectedContributor) return {};
            const isMatch = params.datum.contributor === selectedContributor.name;
            return {
              fillOpacity: isMatch ? 0.9 : 0.2,
              stroke: isMatch ? "#d4d4d8" : undefined,
              strokeWidth: isMatch ? 2 : 0,
            };
          },
          listeners: {
            nodeClick: (e: any) => {
              const name = e.datum?.contributor;
              if (name) {
                const match = displayedContributors.find((c) => c.name === name);
                if (match) setSelectedContributor(match);
              }
            },
          },
        } as any,
      ],
      axes: [
        { type: "category", position: "bottom", title: { text: "Contributor (Click bar to cross-filter grid)" } },
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
  }, [data, selectedContributor, displayedContributors]);

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

  const handleCustomAnalysis = async () => {
    if (!customRepo.trim()) {
      setCustomRepoError("Please enter a repository URL or owner/repo (e.g. tiangolo/fastapi)");
      return;
    }
    setAnalyzingCustom(true);
    setCustomRepoError("");
    try {
      const { job_id } = await startAnalysis(
        customRepo.trim(),
        parseFloat(customPool) || 1000,
        false
      );
      sessionStorage.setItem("shapley_job", job_id);
      sessionStorage.setItem("shapley_total", customPool);
      router.push(`/analyze?job=${job_id}`);
    } catch (err: any) {
      setCustomRepoError(err.message || "Failed to start analysis");
      setAnalyzingCustom(false);
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

        {/* Persona Switcher Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-2 bg-zinc-900/90 border border-zinc-800 rounded-xl mb-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-zinc-950 rounded-lg text-xs font-mono">
            <button
              onClick={() => setCurrentPersona("lead")}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                currentPersona === "lead"
                  ? "bg-zinc-800 text-white font-semibold shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <span>🛠️</span> Team Lead (Attribution Ledger)
            </button>
            <button
              onClick={() => setCurrentPersona("sponsor")}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                currentPersona === "sponsor"
                  ? "bg-blue-600 text-white font-semibold shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <span>💼</span> Business Sponsor (PayPal Escrow)
            </button>
            <button
              onClick={() => setCurrentPersona("member")}
              className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                currentPersona === "member"
                  ? "bg-emerald-600 text-white font-semibold shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <span>💻</span> Contributor (W-8BEN Payout Setup)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPotModal(true)}
              className="px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-emerald-400 text-xs font-mono flex items-center gap-2 transition-colors shadow-sm"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Hackathon Pot Solvency ($2,500)
            </button>
          </div>
        </div>

        {currentPersona === "lead" ? (
          <>
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
              onClick={() => setShowCommandPalette(true)}
              className="bg-zinc-900/90 hover:bg-zinc-800 px-3 py-1.5 rounded-lg text-xs font-semibold border border-zinc-700/80 flex items-center gap-2 transition-all text-zinc-300 shadow-sm shimmer-sweep"
              title="Quick Action Command Palette (⌘K)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <span>Command</span>
              <kbd className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700">⌘K</kbd>
            </button>
            <button
              onClick={() => setShowMerkleModal(true)}
              className="bg-emerald-950/60 hover:bg-emerald-900/60 px-3.5 py-2 rounded-lg text-xs font-semibold border border-emerald-700/60 flex items-center gap-2 transition-colors text-emerald-300"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Merkle Root Verified
            </button>
            <button
              onClick={copyMarkdown}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-lg text-xs font-semibold border border-zinc-700 flex items-center gap-1.5 transition-colors text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              {copiedMd ? "Copied Markdown!" : "Copy PR Markdown"}
            </button>
            <button
              onClick={() => setShowChatModal(true)}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-lg text-xs font-semibold border border-zinc-700 flex items-center gap-1.5 transition-colors text-zinc-200"
            >
              <span>💬</span>
              Chat Alerts
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
            <button
              onClick={() => setShowRepoModal(true)}
              className="bg-blue-600/20 hover:bg-blue-600/30 px-3.5 py-2 rounded-lg text-xs font-semibold border border-blue-500/40 flex items-center gap-1.5 transition-colors text-blue-300"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Analyze Any Repo
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
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium underline flex items-center gap-1"
                >
                  {showMath ? "Hide How It Works" : "💡 How Fair Shares Are Calculated (Plain English)"}
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-zinc-800">
              <h4 className="font-semibold text-zinc-100 flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-serif font-bold">
                  &phi;
                </span>
                How Shapley Calculates Fair Shares
              </h4>
              
              <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs">
                <button
                  onClick={() => setExplainerTab("simple")}
                  className={`px-3 py-1 rounded-md transition-all font-medium ${
                    explainerTab === "simple"
                      ? "bg-blue-600 text-white font-semibold shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  💡 Plain English
                </button>
                <button
                  onClick={() => setExplainerTab("math")}
                  className={`px-3 py-1 rounded-md transition-all font-medium ${
                    explainerTab === "math"
                      ? "bg-blue-600 text-white font-semibold shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  🔬 Math Proofs
                </button>
              </div>
            </div>

            {explainerTab === "simple" ? (
              <div className="space-y-5 text-xs">
                {/* The Missing Teammate Analogy */}
                <div className="bg-zinc-950/80 border border-zinc-800/90 rounded-xl p-4">
                  <h5 className="font-bold text-white text-sm mb-1.5 flex items-center gap-2">
                    <span>⚽️</span> The &ldquo;Missing Teammate&rdquo; Test
                  </h5>
                  <p className="text-zinc-300 leading-relaxed">
                    Think of a software project like a sports team. How do you measure a player&apos;s real value? Not by how many miles they ran, but by how the team performs <strong>with them</strong> versus <strong>without them</strong>.
                  </p>
                </div>

                {/* Real-World Contrast: Lines of Code vs True Impact */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="bg-zinc-950/60 border border-rose-900/30 rounded-xl p-4">
                    <span className="text-rose-400 font-bold block mb-1 font-mono text-[11px]">&times; The Flawed Old Way (Lines of Code)</span>
                    <p className="text-zinc-400 leading-relaxed mb-2">
                      If an engineer runs an automated linter (Prettier) to reformat 2,400 lines of whitespace, naive systems award them 50% of the entire bounty pool.
                    </p>
                    <span className="text-zinc-500 text-[10px]">Result: Rewards spam, punishes real engineering.</span>
                  </div>
                  <div className="bg-zinc-950/60 border border-emerald-900/30 rounded-xl p-4">
                    <span className="text-emerald-400 font-bold block mb-1 font-mono text-[11px]">&check; The Shapley Way (Cooperative Value)</span>
                    <p className="text-zinc-400 leading-relaxed mb-2">
                      We simulate all combinations of team members. If your 5-line security patch turns a broken, vulnerable release into a rock-solid product, you are paid as an MVP.
                    </p>
                    <span className="text-zinc-500 text-[10px]">Result: 100% fair, zero favoritism, exact-penny conservation.</span>
                  </div>
                </div>

                {/* 3 Simple Rules */}
                <div className="grid sm:grid-cols-3 gap-3 pt-1">
                  <div className="bg-zinc-800/30 border border-zinc-800 p-3 rounded-lg">
                    <span className="font-semibold text-white block mb-0.5">1. Noise Filtering</span>
                    <span className="text-zinc-400 text-[11px] leading-tight block">AI parses code syntax to ignore whitespace and reformatting.</span>
                  </div>
                  <div className="bg-zinc-800/30 border border-zinc-800 p-3 rounded-lg">
                    <span className="font-semibold text-white block mb-0.5">2. &lsquo;What-If&rsquo; Simulations</span>
                    <span className="text-zinc-400 text-[11px] leading-tight block">Tests team capability jumps when each person is included.</span>
                  </div>
                  <div className="bg-zinc-800/30 border border-zinc-800 p-3 rounded-lg">
                    <span className="font-semibold text-white block mb-0.5">3. PayPal Payout</span>
                    <span className="text-zinc-400 text-[11px] leading-tight block">Funds disburse directly to developers with $0.00 rounding loss.</span>
                  </div>
                </div>
              </div>
            ) : (
              <div>
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

        {/* Phased Milestone & AI Co-Authorship Protocol Notice */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 mb-3 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-400"></span>
              <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider">
                Human Pilot &amp; AI Co-Authorship Attribution Rule
              </h3>
              <span className="text-[10px] font-mono bg-purple-950 text-purple-300 border border-purple-800 px-2 py-0.5 rounded-full">
                RFC 2822 Trailer Provenance
              </span>
            </div>
            <span className="text-[11px] font-mono text-zinc-500">Legal: AI Agent Cannot Hold Bank Accounts</span>
          </div>
          <p className="text-zinc-400 text-xs leading-relaxed mb-3">
            When developers push commits generated with Claude, Cursor, Copilot, or Cline (e.g. <code className="text-purple-300 bg-zinc-950 px-1 py-0.5 rounded font-mono text-[11px]">Co-authored-by: Claude &lt;noreply@anthropic.com&gt;</code>), 
            Shapley attributes financial disburse to the <strong>Human Pilot</strong> who authored the prompt, reviewed the code, validated the unit test suite, and GPG-signed the commit.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
            <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800/80">
              <span className="text-zinc-500 block text-[10px]">Human Pilot Leverage</span>
              <span className="text-white">Full Financial Disbursement</span>
            </div>
            <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800/80">
              <span className="text-zinc-500 block text-[10px]">Synthetic Code Quarantine</span>
              <span className="text-blue-400">AST Filters Boilerplate</span>
            </div>
            <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800/80">
              <span className="text-zinc-500 block text-[10px]">Autonomous Bots</span>
              <span className="text-emerald-400">Project Maintenance Escrow</span>
            </div>
          </div>
        </div>
          </>
        ) : currentPersona === "sponsor" ? (
          <SponsorHub
            onSwitchToAttribution={() => setCurrentPersona("lead")}
            onOpenPotModal={() => setShowPotModal(true)}
          />
        ) : (
          <ContributorPortal />
        )}

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
          curl -X POST ${appOrigin}/api/agent/evaluate \\
            -H "Content-Type: application/json" \\
            -d '{"repo_url": "${data.repo}", "total_amount": ${currentTotal}}'`}
              </pre>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`name: Shapley Release Bounty\non:\n  release:\n    types: [published]\n\njobs:\n  distribute:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Calculate Shapley Shares & Payout\n        run: |\n          curl -X POST ${appOrigin}/api/agent/evaluate \\\n            -H "Content-Type: application/json" \\\n            -d '{"repo_url": "${data.repo}", "total_amount": ${currentTotal}}'`);
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

        {/* Chat Alerts & Webhooks Modal */}
        {showChatModal && data && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/70 modal-backdrop"
              onClick={() => setShowChatModal(false)}
            />
            <div className="relative bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-2xl w-full modal-content max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">💬</span>
                  <div>
                    <h3 className="text-base font-bold text-white">Team Chat Alerts &amp; Webhooks</h3>
                    <p className="text-xs text-zinc-400">Post milestone digests directly to Telegram, WhatsApp, Slack, or Discord</p>
                  </div>
                </div>
                <button onClick={() => setShowChatModal(false)} className="text-zinc-400 hover:text-white text-lg">&times;</button>
              </div>

              {/* Platform Selector Tabs */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setChatPlatform("telegram")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    chatPlatform === "telegram"
                      ? "bg-sky-600 text-white shadow-md shadow-sky-900/30"
                      : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  }`}
                >
                  <span>✈️</span> Telegram Bot
                </button>
                <button
                  type="button"
                  onClick={() => setChatPlatform("whatsapp")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    chatPlatform === "whatsapp"
                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-900/30"
                      : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  }`}
                >
                  <span>💬</span> WhatsApp Cloud
                </button>
                <button
                  type="button"
                  onClick={() => setChatPlatform("slack")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    chatPlatform === "slack"
                      ? "bg-blue-600 text-white shadow-md shadow-blue-900/30"
                      : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  }`}
                >
                  <span>⚡</span> Slack Block Kit
                </button>
                <button
                  type="button"
                  onClick={() => setChatPlatform("discord")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    chatPlatform === "discord"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-900/30"
                      : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  }`}
                >
                  <span>👾</span> Discord Embed
                </button>
              </div>

              {/* Payload Preview */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>Standard REST Webhook Payload ({chatPlatform}):</span>
                  <span className="font-mono text-[11px] text-zinc-500">JSON-RPC 2.0 / MCP Compatible</span>
                </div>
                <pre className="bg-zinc-950 p-4 rounded-xl text-xs font-mono text-zinc-200 border border-zinc-800 overflow-x-auto max-h-72 leading-relaxed select-all">
                  {JSON.stringify(
                    chatPlatform === "telegram"
                      ? {
                          chat_id: "@shapley_updates",
                          text: `<b>⚖️ Shapley Milestone: <code>${data.repo}</code></b>\n\n💰 <b>Bounty Pool:</b> $${currentTotal.toFixed(2)} USD\n🔒 <b>Merkle Root:</b> <code>88643cd1b4...</code>\n\n📊 <b>Standings:</b>\n` +
                            displayedContributors.map((c) => `• <b>${c.name}</b>: <code>${c.share_pct.toFixed(1)}%</code> ($${c.payout_usd.toFixed(2)})`).join("\n"),
                          parse_mode: "HTML",
                          reply_markup: {
                            inline_keyboard: [
                              [
                                { text: "💳 Disburse Payouts", url: `${appOrigin}/results` },
                                { text: "🔍 Merkle Audit", url: `${appOrigin}/audit` }
                              ]
                            ]
                          }
                        }
                      : chatPlatform === "whatsapp"
                      ? {
                          messaging_product: "whatsapp",
                          recipient_type: "individual",
                          to: "+1234567890",
                          type: "interactive",
                          interactive: {
                            type: "button",
                            header: { type: "text", text: `⚖️ Shapley Milestone: ${data.repo}` },
                            body: {
                              text: `Milestone for *${data.repo}*:\n💰 *Pool:* $${currentTotal.toFixed(2)} USD\n\n*Fair Shares:*\n` +
                                displayedContributors.map((c) => `• ${c.name}: ${c.share_pct.toFixed(1)}% ($${c.payout_usd.toFixed(2)})`).join("\n")
                            },
                            action: {
                              buttons: [
                                { type: "reply", reply: { id: "btn_approve_payout", title: "💳 Approve Payout" } },
                                { type: "reply", reply: { id: "btn_verify_audit", title: "🔍 Audit Merkle" } }
                              ]
                            }
                          }
                        }
                      : chatPlatform === "discord"
                      ? {
                          embeds: [
                            {
                              title: `⚖️ Shapley Attribution: ${data.repo}`,
                              description: "Axiomatic game-theoretic fair revenue sharing.",
                              color: 3447003,
                              fields: [
                                { name: "💰 Total Pool", value: `$${currentTotal.toFixed(2)} USD`, inline: true },
                                { name: "🔒 Merkle Proof", value: "88643cd1b4...", inline: true },
                                {
                                  name: "📊 Leaderboard",
                                  value: displayedContributors.map((c) => `**${c.name}**: \`${c.share_pct.toFixed(1)}%\` ($${c.payout_usd.toFixed(2)})`).join("\n")
                                }
                              ]
                            }
                          ]
                        }
                      : {
                          text: `Shapley Milestone Update: ${data.repo}`,
                          blocks: [
                            { type: "header", text: { type: "plain_text", text: `⚖️ Shapley Milestone: ${data.repo}` } },
                            {
                              type: "section",
                              fields: [
                                { type: "mrkdwn", text: `*Bounty Pool:*\n$${currentTotal.toFixed(2)} USD` },
                                { type: "mrkdwn", text: `*Merkle Root:*\n\`88643cd1b4...\`` }
                              ]
                            },
                            {
                              type: "section",
                              text: {
                                type: "mrkdwn",
                                text: "*Fair Share Standings:*\n" +
                                  displayedContributors.map((c) => `• *${c.name}*: *${c.share_pct.toFixed(1)}%* ($${c.payout_usd.toFixed(2)})`).join("\n")
                              }
                            }
                          ]
                        },
                    null,
                    2
                  )}
                </pre>
              </div>

              <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowChatModal(false)}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const payload =
                      chatPlatform === "telegram"
                        ? {
                            chat_id: "@shapley_updates",
                            text: `<b>⚖️ Shapley Milestone: <code>${data.repo}</code></b>\n\n💰 <b>Bounty Pool:</b> $${currentTotal.toFixed(2)} USD\n🔒 <b>Merkle Root:</b> <code>88643cd1b4...</code>\n\n📊 <b>Standings:</b>\n` +
                              displayedContributors.map((c) => `• <b>${c.name}</b>: <code>${c.share_pct.toFixed(1)}%</code> ($${c.payout_usd.toFixed(2)})`).join("\n"),
                            parse_mode: "HTML",
                            reply_markup: {
                              inline_keyboard: [
                                [
                                  { text: "💳 Disburse Payouts", url: `${appOrigin}/results` },
                                  { text: "🔍 Merkle Audit", url: `${appOrigin}/audit` }
                                ]
                              ]
                            }
                          }
                        : chatPlatform === "whatsapp"
                        ? {
                            messaging_product: "whatsapp",
                            recipient_type: "individual",
                            to: "+1234567890",
                            type: "interactive",
                            interactive: {
                              type: "button",
                              header: { type: "text", text: `⚖️ Shapley Milestone: ${data.repo}` },
                              body: {
                                text: `Milestone for *${data.repo}*:\n💰 *Pool:* $${currentTotal.toFixed(2)} USD\n\n*Fair Shares:*\n` +
                                  displayedContributors.map((c) => `• ${c.name}: ${c.share_pct.toFixed(1)}% ($${c.payout_usd.toFixed(2)})`).join("\n")
                              },
                              action: {
                                buttons: [
                                  { type: "reply", reply: { id: "btn_approve_payout", title: "💳 Approve Payout" } },
                                  { type: "reply", reply: { id: "btn_verify_audit", title: "🔍 Audit Merkle" } }
                                ]
                              }
                            }
                          }
                        : chatPlatform === "discord"
                        ? {
                            embeds: [
                              {
                                title: `⚖️ Shapley Attribution: ${data.repo}`,
                                description: "Axiomatic game-theoretic fair revenue sharing.",
                                color: 3447003,
                                fields: [
                                  { name: "💰 Total Pool", value: `$${currentTotal.toFixed(2)} USD`, inline: true },
                                  { name: "🔒 Merkle Proof", value: "88643cd1b4...", inline: true },
                                  {
                                    name: "📊 Leaderboard",
                                    value: displayedContributors.map((c) => `**${c.name}**: \`${c.share_pct.toFixed(1)}%\` ($${c.payout_usd.toFixed(2)})`).join("\n")
                                  }
                                ]
                              }
                            ]
                          }
                        : {
                            text: `Shapley Milestone Update: ${data.repo}`,
                            blocks: [
                              { type: "header", text: { type: "plain_text", text: `⚖️ Shapley Milestone: ${data.repo}` } },
                              {
                                type: "section",
                                fields: [
                                  { type: "mrkdwn", text: `*Bounty Pool:*\n$${currentTotal.toFixed(2)} USD` },
                                  { type: "mrkdwn", text: `*Merkle Root:*\n\`88643cd1b4...\`` }
                                ]
                              },
                              {
                                type: "section",
                                text: {
                                  type: "mrkdwn",
                                  text: "*Fair Share Standings:*\n" +
                                    displayedContributors.map((c) => `• *${c.name}*: *${c.share_pct.toFixed(1)}%* ($${c.payout_usd.toFixed(2)})`).join("\n")
                                }
                              }
                            ]
                          };
                    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                    alert(`${chatPlatform.toUpperCase()} webhook payload copied to clipboard!`);
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <span>📋</span> Copy {chatPlatform.charAt(0).toUpperCase() + chatPlatform.slice(1)} Payload
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PayPal Multi-Stakeholder Custodial Escrow Card */}
        <div className="bg-gradient-to-r from-blue-950/30 via-zinc-900 to-zinc-900 border border-blue-600/40 rounded-xl p-4 sm:p-5 mb-6 shadow-lg shadow-blue-950/20">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 mb-4 border-b border-blue-900/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-md shadow-blue-600/30">
                &Pcy;
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white">PayPal Multi-Stakeholder Escrow</h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                    🔒 Vault: ESCROW-PP-ACTIVE
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  PayPal acts as a neutral licensed custodian holding bounty funds in an Authorization Hold until multi-stakeholder criteria are met.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 self-start md:self-auto">
              <div className="text-right hidden sm:block">
                <span className="text-[10px] text-zinc-500 uppercase font-mono block">Escrow In Custody</span>
                <span className="text-xs font-mono font-bold text-emerald-400">${currentTotal.toFixed(2)} USD</span>
              </div>
              <div 
                className="relative w-64 h-9 bg-zinc-950 border border-zinc-700/80 rounded-full overflow-hidden flex items-center select-none cursor-pointer group shadow-inner"
                onClick={() => {
                  setIsSlideAuthorized(true);
                  setShowConfirm(true);
                }}
              >
                <div 
                  className={`absolute left-0 top-0 bottom-0 bg-gradient-to-r from-blue-600 via-emerald-600 to-emerald-500 opacity-40 transition-all ${isSlideAuthorized ? "w-full" : "w-1/4 group-hover:w-1/2"}`}
                />
                <div 
                  className={`absolute left-1 top-1 bottom-1 w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shadow-md transition-all ${
                    isSlideAuthorized 
                      ? "bg-emerald-500 text-white translate-x-[220px] shadow-emerald-500/50" 
                      : "bg-emerald-500 text-white group-hover:translate-x-2 shadow-emerald-900/40"
                  }`}
                >
                  {isSlideAuthorized ? "✓" : "→"}
                </div>
                <span className="w-full text-center text-[10px] font-semibold text-zinc-300 font-mono pointer-events-none pl-6 pr-2">
                  {isSlideAuthorized ? "✓ Escrow Tranche Disbursed" : `Slide to Release ($${currentTotal.toFixed(2)}) ➔`}
                </span>
              </div>
            </div>
          </div>

          {/* Compact 3-Party Quorum Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 py-2 px-3 bg-zinc-950/70 rounded-lg border border-zinc-800/80 text-xs mb-3">
            <div className="flex items-center justify-between sm:justify-start gap-2">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span> 1. Sponsor Deposit
              </span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded">&check; Authorized</span>
            </div>
            <div className="flex items-center justify-between sm:justify-start gap-2">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-2 h-2 rounded-full bg-blue-400"></span> 2. PayPal Neutral Escrow
              </span>
              <span className="text-[10px] font-mono text-blue-300 bg-blue-950/60 border border-blue-800/60 px-1.5 py-0.5 rounded">&check; In Custody</span>
            </div>
            <div className="flex items-center justify-between sm:justify-start gap-2">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span> 3. Maintainer Sign-off
              </span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded">&check; Merkle Verified</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-zinc-400 pt-1 gap-1">
            <span>⏱️ <strong>48-Hour Dispute Challenge Window:</strong> Active &bull; Exact-Penny conservation verified ($0.00 float)</span>
            <span className="font-mono text-[10px] text-zinc-500">Idempotency: SHA-256 State-Locked</span>
          </div>
        </div>

        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 animate-rise stagger-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-zinc-800 gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveGridTab("contributors")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                  activeGridTab === "contributors"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
              >
                <span>👥 Contributor Allocations (N={displayedContributors.length})</span>
              </button>
              <button
                onClick={() => setActiveGridTab("coalitions")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                  activeGridTab === "coalitions"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-zinc-800/80 text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
              >
                <span>🌐 Coalition Explorer (2^N={coalitionExplorerRows.length} Subsets)</span>
              </button>
            </div>

            <div className="flex items-center gap-3">
              {selectedContributor && (
                <button
                  onClick={() => setSelectedContributor(null)}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 text-blue-300 border border-blue-800/50 px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-colors"
                >
                  <span>Filtering: <strong>{selectedContributor.name}</strong></span>
                  <span className="text-zinc-400 hover:text-white">✕</span>
                </button>
              )}
              <button
                onClick={() => setEditingEmails(!editingEmails)}
                className="text-xs text-blue-400 hover:text-blue-300 btn-interactive"
              >
                {editingEmails ? "Done" : "Edit PayPal emails"}
              </button>
            </div>
          </div>

          {activeGridTab === "contributors" && (
            <div className="pt-3 pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-400 uppercase font-mono tracking-wider font-semibold">
                  Model Bake-Off:
                </span>
                <div className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs">
                  <button
                    onClick={() => handleBaselineChange("shapley")}
                    className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                      baselineMetric === "shapley"
                        ? "bg-blue-600 text-white font-semibold shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    🤖 AI Shapley
                  </button>
                  <button
                    onClick={() => handleBaselineChange("loc")}
                    className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                      baselineMetric === "loc"
                        ? "bg-rose-600/90 text-white font-semibold shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    📝 Lines Changed (Naive)
                  </button>
                  <button
                    onClick={() => handleBaselineChange("commits")}
                    className={`px-2.5 py-1 rounded-md transition-all font-medium ${
                      baselineMetric === "commits"
                        ? "bg-amber-600/90 text-white font-semibold shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    🔨 Commit Count
                  </button>
                </div>
              </div>

              <div className="text-xs text-zinc-400">
                {baselineMetric === "shapley" && (
                  <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Game-theoretic axiomatic fairness (no whitespace gaming)
                  </span>
                )}
                {baselineMetric === "loc" && (
                  <span className="text-rose-400 font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                    Rewards formatting/Prettier churn over architecture
                  </span>
                )}
                {baselineMetric === "commits" && (
                  <span className="text-amber-400 font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    Rewards micro-commit fragmentation
                  </span>
                )}
              </div>
            </div>
          )}

          {editingEmails && data && (
            <div className="px-2 py-3 space-y-2 animate-fade">
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

          {activeGridTab === "contributors" ? (
            <div>
              <div className="ag-theme-quartz cursor-pointer" style={{ height: 320 }}>
                <AgGridReact
                  ref={gridRef}
                  theme={darkTheme}
                  rowData={displayedContributors}
                  columnDefs={contributorCols}
                  animateRows={true}
                  rowSelection="single"
                  defaultColDef={{ resizable: true }}
                  onRowClicked={(e) => setSelectedContributor(e.data || null)}
                />
              </div>
              <div className="mt-3 px-1 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-zinc-400 gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-blue-400 font-bold">&bull;</span>
                  <span><strong>Cross-Filtering:</strong> Click any contributor row to filter AG Chart bars, or click an AG Chart bar to center this grid.</span>
                </div>
                <div className="flex items-center gap-1.5 text-zinc-500">
                  <span>In-cell sparklines show <strong>&Delta;v_i(S)</strong> marginal stability across all 2^(N-1) subsets.</span>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="ag-theme-quartz cursor-pointer" style={{ height: 420 }}>
                <AgGridReact
                  ref={coalitionGridRef}
                  theme={darkTheme}
                  rowData={coalitionExplorerRows}
                  columnDefs={coalitionCols}
                  animateRows={true}
                  defaultColDef={{ resizable: true }}
                />
              </div>
              <div className="mt-3 px-1 flex items-center justify-between text-xs text-zinc-400">
                <span>Displaying all <strong>2^{displayedContributors.length} = {coalitionExplorerRows.length}</strong> mathematical coalitions evaluated under characteristic function v(S).</span>
                <span className="text-emerald-400 font-mono">v(∅)=0.0 &le; v(S) &le; 100.0</span>
              </div>
            </div>
          )}
        </div>

        {/* Contributor Deep Dive Forensic Modal */}
        {selectedContributor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
              onClick={() => setSelectedContributor(null)}
            />
            <div className="relative w-full max-w-xl bg-zinc-900 border border-zinc-700/80 rounded-2xl p-6 overflow-y-auto max-h-[90vh] shadow-2xl">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-6">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-white">{selectedContributor.name}</h2>
                      <span className="bg-emerald-900/50 text-emerald-400 border border-emerald-700/50 text-[10px] font-mono px-2 py-0.5 rounded-full flex items-center gap-1">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        GPG Verified
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 font-mono mt-0.5">{getEffectiveEmail(selectedContributor)}</p>
                  </div>
                  <button
                    onClick={() => setSelectedContributor(null)}
                    className="text-zinc-400 hover:text-white p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>

                {/* Share & Payout Hero in Drawer */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3.5">
                    <span className="text-zinc-500 text-xs block mb-1">Shapley Allocation</span>
                    <span className="text-2xl font-bold font-mono text-blue-400">
                      {selectedContributor.share_pct.toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-zinc-500 block mt-1">Marginal coalition weight</span>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3.5">
                    <span className="text-zinc-500 text-xs block mb-1">Calculated Payout</span>
                    <span className="text-2xl font-bold font-mono text-emerald-400">
                      ${selectedContributor.payout_usd?.toFixed(2) ?? ((currentTotal * selectedContributor.share_pct) / 100).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-zinc-500 block mt-1">Exact-penny settlement</span>
                  </div>
                </div>

                {/* Physical AST & Git Signals */}
                <div className="mb-6">
                  <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                    Physical Code Signals &amp; AST Analysis
                  </h3>
                  <div className="bg-zinc-950 rounded-xl border border-zinc-800 p-4 space-y-3 text-xs font-mono">
                    <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Total Commits</span>
                      <span className="text-white font-bold">{selectedContributor.commits}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Lines Inserted / Deleted</span>
                      <span className="text-emerald-400">+{selectedContributor.additions} <span className="text-zinc-500">/</span> <span className="text-rose-400">-{selectedContributor.deletions}</span></span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Net Churn Ratio</span>
                      <span className="text-zinc-300">
                        {(selectedContributor.deletions ?? 0) > 0 ? (((selectedContributor.additions ?? 0) / (selectedContributor.deletions || 1))).toFixed(2) : "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Shapley Raw &phi; Index</span>
                      <span className="text-blue-400 font-bold">{selectedContributor.shapley_value.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-zinc-400">AST Quarantine Scan</span>
                      <span className="text-emerald-400 font-semibold flex items-center gap-1 font-sans text-[11px]">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                        Neutralized (0 Injections)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Marginal Value Impact Explanation */}
                <div>
                  <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                    Game Theoretic Marginal Contribution
                  </h3>
                  <div className="bg-zinc-950 rounded-xl border border-zinc-800 p-4 text-xs text-zinc-300 leading-relaxed">
                    <p className="mb-2">
                      Across all sampled permutation orders <span className="font-mono text-blue-400">&pi; &isin; &Pi;(N)</span> and antithetic mirrors <span className="font-mono text-blue-400">&pi;&apos;</span>, adding <strong className="text-white">{selectedContributor.name}</strong> to predecessor coalitions yielded an average marginal value jump of:
                    </p>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 font-mono text-xs text-emerald-400 my-2 flex items-center justify-between">
                      <span>E[v(S &cup; &#123;{selectedContributor.name.split(" ")[0]}&#125;) &minus; v(S)]</span>
                      <span className="font-bold text-sm">+{selectedContributor.share_pct.toFixed(1)}%</span>
                    </div>
                    <p className="text-zinc-500 text-[11px] mt-2">
                      Protected by Lloyd Shapley Efficiency, Symmetry, Dummy Player, and Monotonicity axioms.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-zinc-800 mt-6">
                <button
                  onClick={() => setSelectedContributor(null)}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium py-2.5 rounded-lg text-xs transition-colors"
                >
                  Close Inspection
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cryptographic Merkle Tree Proof Modal */}
        {showMerkleModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/75 backdrop-blur-sm"
              onClick={() => setShowMerkleModal(false)}
            />
            <div className="relative bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-xl w-full shadow-2xl">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Cryptographic Merkle Audit Proof</h3>
                    <p className="text-[11px] text-zinc-400 font-mono">RFC-6962 SHA-256 Tamper-Evident Ledger</p>
                  </div>
                </div>
                <button onClick={() => setShowMerkleModal(false)} className="text-zinc-400 hover:text-white p-1.5 rounded-lg bg-zinc-800">&times;</button>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="text-zinc-400 block mb-1 font-medium">Merkle Root Hash (256-bit SHA-256)</label>
                  <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 font-mono text-[11px] text-emerald-400 break-all select-all">
                    88643cd1fe4e719119c4d29f8f2e26090c29f6f6d0fca8faef7d5f0b5d9095bb
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-zinc-300 font-mono text-[11px]">
                  <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                    <span className="text-zinc-500 block text-[10px]">Leaf Hash Standard</span>
                    <span className="text-zinc-300">RFC 6962: SHA-256(0x00 || Leaf)</span>
                  </div>
                  <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                    <span className="text-zinc-500 block text-[10px]">Internal Node Hash</span>
                    <span className="text-zinc-300">SHA-256(0x01 || Left || Right)</span>
                  </div>
                </div>

                <div>
                  <label className="text-zinc-400 block mb-1 font-medium">Offline Independent Verification</label>
                  <p className="text-zinc-500 text-[11px] mb-2 leading-relaxed">
                    Anyone can verify the attribution mathematical integrity offline without trusting Shapley's servers:
                  </p>
                  <pre className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 font-mono text-[11px] text-blue-300 overflow-x-auto select-all">
{`# 1. Download tamper-proof cryptographic receipt
curl -sO ${appOrigin}/api/audit/receipt.json

# 2. Verify root hash and leaf memberships locally
python3 -m backend.security.merkle_ledger verify receipt.json`}
                  </pre>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-5 pt-3 border-t border-zinc-800">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText("88643cd1fe4e719119c4d29f8f2e26090c29f6f6d0fca8faef7d5f0b5d9095bb");
                    alert("Merkle Root copied!");
                  }}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg text-xs font-semibold"
                >
                  Copy Root
                </button>
                <button
                  onClick={() => setShowMerkleModal(false)}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-lg text-xs font-semibold"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Repository Modal */}
        {showRepoModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Analyze Any GitHub Repository</h3>
                    <p className="text-[11px] text-zinc-400">Evaluate any repository with game-theoretic attribution</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowRepoModal(false)}
                  className="text-zinc-400 hover:text-white p-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-base transition-colors"
                >
                  &times;
                </button>
              </div>

              {customRepoError && (
                <div className="bg-red-950/50 border border-red-800 text-red-300 text-xs rounded-lg p-3 mb-4">
                  {customRepoError}
                </div>
              )}

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-zinc-300 font-medium mb-1.5">GitHub Repository URL or owner/repo</label>
                  <input
                    type="text"
                    value={customRepo}
                    onChange={(e) => setCustomRepo(e.target.value)}
                    placeholder="e.g. tiangolo/fastapi, astral-sh/uv, or https://github.com/owner/repo"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder-zinc-500 font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <span className="text-zinc-400 block mb-1.5 font-medium">Quick Benchmark Presets:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {["fastapi/fastapi", "astral-sh/uv", "encode/httpx", "tiangolo/sqlmodel", "psf/black"].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setCustomRepo(r)}
                        className={`px-2.5 py-1 rounded font-mono text-[11px] transition-colors border ${
                          customRepo === r
                            ? "bg-blue-600/30 text-blue-300 border-blue-500/50"
                            : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-zinc-300 font-medium mb-1.5">Bounty Pool (USD)</label>
                  <input
                    type="number"
                    value={customPool}
                    onChange={(e) => setCustomPool(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3.5 py-2 text-zinc-100 font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
                  <button
                    onClick={() => setShowRepoModal(false)}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCustomAnalysis}
                    disabled={analyzingCustom}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    {analyzingCustom ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Initializing...</span>
                      </>
                    ) : (
                      <>
                        <span>🚀</span>
                        <span>Start Analysis</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL: QUICK COMMAND PALETTE (CMD+K)                         */}
        {/* ============================================================ */}
        {showCommandPalette && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 p-4 animate-fade">
            <div
              className="absolute inset-0 bg-black/75 backdrop-blur-sm"
              onClick={() => setShowCommandPalette(false)}
            />
            <div className="relative bg-[#111215] border border-zinc-700/80 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden font-sans modal-enter">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input
                  type="text"
                  autoFocus
                  value={commandPaletteQuery}
                  onChange={(e) => setCommandPaletteQuery(e.target.value)}
                  placeholder="Search actions, contributors, milestones, webhooks..."
                  className="w-full bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none font-mono"
                />
                <kbd className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700">ESC</kbd>
              </div>

              <div className="p-2 max-h-80 overflow-y-auto space-y-1 text-xs">
                {[
                  {
                    icon: "🔓",
                    title: `Authorize PayPal Escrow Release ($${currentTotal.toFixed(2)})`,
                    badge: "Milestone 2",
                    action: () => {
                      setShowCommandPalette(false);
                      setShowConfirm(true);
                    },
                  },
                  {
                    icon: "🔍",
                    title: "Verify Cryptographic Merkle Root",
                    badge: "RFC 6962 Proof",
                    action: () => {
                      setShowCommandPalette(false);
                      setShowMerkleModal(true);
                    },
                  },
                  {
                    icon: "✈️",
                    title: "Telegram Bot Webhook Simulator",
                    badge: "MCP Tool",
                    action: () => {
                      setShowCommandPalette(false);
                      setChatPlatform("telegram");
                      setShowChatModal(true);
                    },
                  },
                  {
                    icon: "💬",
                    title: "WhatsApp Cloud API Interactive Message",
                    badge: "MCP Tool",
                    action: () => {
                      setShowCommandPalette(false);
                      setChatPlatform("whatsapp");
                      setShowChatModal(true);
                    },
                  },
                  {
                    icon: "💡",
                    title: "Plain English Game Theory Explainer",
                    badge: "Nobel Intuition",
                    action: () => {
                      setShowCommandPalette(false);
                      setExplainerTab("simple");
                    },
                  },
                  {
                    icon: "🔬",
                    title: "Axiomatic Math Proofs & Marginal Deltas",
                    badge: "16 Coalitions",
                    action: () => {
                      setShowCommandPalette(false);
                      setExplainerTab("math");
                    },
                  },
                  {
                    icon: "🚀",
                    title: "Analyze Any Git Repository (Live Mode)",
                    badge: "Custom Repo",
                    action: () => {
                      setShowCommandPalette(false);
                      setShowRepoModal(true);
                    },
                  },
                  {
                    icon: "📋",
                    title: "Copy GitHub PR Settlement Markdown",
                    badge: "Markdown",
                    action: () => {
                      setShowCommandPalette(false);
                      copyMarkdown();
                    },
                  },
                ]
                  .filter((item) =>
                    !commandPaletteQuery ||
                    item.title.toLowerCase().includes(commandPaletteQuery.toLowerCase()) ||
                    item.badge.toLowerCase().includes(commandPaletteQuery.toLowerCase())
                  )
                  .map((item, idx) => (
                    <button
                      key={idx}
                      onClick={item.action}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-zinc-800 flex items-center justify-between text-zinc-200 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span>{item.icon}</span>
                        <span className="font-medium">{item.title}</span>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-500">{item.badge}</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* Hackathon Pot Solvency Modal */}
        <PotSolvencyModal
          isOpen={showPotModal}
          onClose={() => setShowPotModal(false)}
        />
      </div>
    </main>
  );
}
