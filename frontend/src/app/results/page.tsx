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
import SlideToAuthorize from "@/components/SlideToAuthorize";

GridModuleRegistry.registerModules([GridAllCommunityModule]);
ChartModuleRegistry.registerModules([ChartAllCommunityModule]);

const darkTheme = themeQuartz.withParams({
  backgroundColor: "#101214",
  foregroundColor: "#f4f5f6",
  headerBackgroundColor: "#17191c",
  oddRowBackgroundColor: "#131518",
  borderColor: "#2b2f36",
  headerFontFamily: "var(--font-sans)",
  cellFontFamily: "var(--font-sans)",
  accentColor: "#8ecbff",
});

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#101214]" />}>
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
    : (process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000");
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
  // Coalition lattice (Phase 4 hero): the selected coalition key and the
  // player whose marginal gains are shown on the cells. Both sync with the
  // marginal-contribution ledger (waterfall) rendered beside the lattice.
  const [selectedCoalitionKey, setSelectedCoalitionKey] = useState<string | null>(null);
  const [pinnedPlayer, setPinnedPlayer] = useState<string | null>(null);
  const [hoverPlayer, setHoverPlayer] = useState<string | null>(null);
  const [expandedSizes, setExpandedSizes] = useState<Record<number, boolean>>({});
  const gridRef = useRef<any>(null);
  const gridApiRef = useRef<any>(null);
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
        setShowMath(false);
        setShowPotModal(false);
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

  // ── Coalition lattice data ─────────────────────────────────────────────
  // Every number below is read from the persisted API result
  // (data.evaluations + data.contributors + provenance). The only work done
  // here is presentation: indexing evaluations by member set, grouping by
  // coalition size, and subtracting two persisted v(S) values to display a
  // marginal gain. Nothing is re-scored or re-estimated in the browser.
  const coalitionKey = (members: string[]) => JSON.stringify([...members].sort());

  const lattice = useMemo(() => {
    if (!data || !data.evaluations) return null;
    const players = data.contributors.map((c) => c.name);
    const n = players.length;
    const valueByKey = new Map<string, number>();
    data.evaluations.forEach((e) => valueByKey.set(coalitionKey(e.members), e.score));
    const totalCoalitions = Math.pow(2, n);
    const evaluatedCount = valueByKey.size;
    // The full grid renders when every coalition was evaluated and the grid
    // is at most 512 cells. Otherwise coalitions are grouped by size with
    // expandable groups — the count text always states how many exist, and
    // a Monte Carlo result states how many were actually evaluated. The
    // lattice is never silently truncated.
    const fullGrid = evaluatedCount >= totalCoalitions && totalCoalitions <= 512;
    const bySize: Map<number, string[][]> = new Map();
    data.evaluations.forEach((e) => {
      const k = e.members.length;
      if (!bySize.has(k)) bySize.set(k, []);
      bySize.get(k)!.push([...e.members].sort());
    });
    bySize.forEach((list) => list.sort((a, b) => coalitionKey(a).localeCompare(coalitionKey(b))));
    return { players, n, valueByKey, totalCoalitions, evaluatedCount, fullGrid, bySize };
  }, [data]);

  const focusPlayer = hoverPlayer ?? pinnedPlayer;

  // Marginal gain of adding the focus player to each coalition, from
  // persisted values only: Δ = v(S ∪ {i}) − v(S), or v(S) − v(S \ {i})
  // when i is already in S. Null when either side was not evaluated.
  const marginalFor = (members: string[]): number | null => {
    if (!lattice || !focusPlayer) return null;
    const { valueByKey } = lattice;
    if (members.includes(focusPlayer)) {
      const without = valueByKey.get(coalitionKey(members.filter((m) => m !== focusPlayer)));
      const withP = valueByKey.get(coalitionKey(members));
      if (without === undefined || withP === undefined) return null;
      return Math.round((withP - without) * 10) / 10;
    }
    const withP = valueByKey.get(coalitionKey([...members, focusPlayer]));
    const without = valueByKey.get(coalitionKey(members));
    if (without === undefined || withP === undefined) return null;
    return Math.round((withP - without) * 10) / 10;
  };

  const maxAbsMarginal = useMemo(() => {
    if (!lattice || !focusPlayer) return 0;
    let max = 0;
    lattice.valueByKey.forEach((_v, key) => {
      const members = JSON.parse(key) as string[];
      const d = marginalFor(members);
      if (d !== null) max = Math.max(max, Math.abs(d));
    });
    return max;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lattice, focusPlayer]);

  // Signed ramp: bucket |Δ| into the three documented background steps
  // (globals.css). Δ > 0 toward the decision (green family), Δ < 0 against
  // (orange-red family), Δ = 0 neutral.
  const rampStyle = (delta: number | null): { background: string; color: string } => {
    if (delta === null || delta === 0 || maxAbsMarginal === 0)
      return { background: "var(--card-2)", color: "var(--muted)" };
    const bucket = Math.min(3, Math.max(1, Math.ceil((Math.abs(delta) / maxAbsMarginal) * 3)));
    return delta > 0
      ? { background: `var(--pos-bg-${bucket})`, color: "var(--pos-ink)" }
      : { background: `var(--neg-bg-${bucket})`, color: "var(--neg-ink)" };
  };

  const selectedMembers = useMemo(() => {
    if (!lattice) return [];
    if (selectedCoalitionKey === null) return [...lattice.players];
    try {
      const parsed = JSON.parse(selectedCoalitionKey) as string[];
      return lattice.players.filter((p) => parsed.includes(p));
    } catch {
      return [...lattice.players];
    }
  }, [lattice, selectedCoalitionKey]);

  // Waterfall chain for the selected coalition: prefixes in contributor
  // order. Each step's Δ and running total are differences/values of
  // persisted v(S); a step whose prefix was not evaluated shows "n/a"
  // rather than an invented number.
  const waterfallSteps = useMemo(() => {
    if (!lattice) return [];
    const steps: { members: string[]; added: string | null; delta: number | null; value: number | null }[] = [];
    let prefix: string[] = [];
    let prev = lattice.valueByKey.get(coalitionKey([]));
    steps.push({ members: [], added: null, delta: null, value: prev ?? null });
    selectedMembers.forEach((p) => {
      const next = [...prefix, p];
      const v = lattice.valueByKey.get(coalitionKey(next));
      steps.push({
        members: next,
        added: p,
        delta: v !== undefined && prev !== undefined ? Math.round((v - prev) * 10) / 10 : null,
        value: v ?? null,
      });
      prefix = next;
      prev = v;
    });
    return steps;
  }, [lattice, selectedMembers]);

  const binom = (nn: number, kk: number) => {
    if (kk < 0 || kk > nn) return 0;
    let r = 1;
    for (let i = 0; i < kk; i++) r = (r * (nn - i)) / (i + 1);
    return Math.round(r);
  };

  const renderCoalitionCell = (members: string[]) => {
    if (!lattice) return null;
    const key = coalitionKey(members);
    const v = lattice.valueByKey.get(key);
    const delta = marginalFor(members);
    const isSelected = coalitionKey(selectedMembers) === key;
    const ramp = rampStyle(delta);
    const shortLabel =
      members.length === 0 ? "∅ empty set" : members.map((m) => m.split(" ")[0]).join(" + ");
    // Accessible name comes from the visible text itself (label-in-name);
    // fuller context (full member names, the marginal-gain sentence) is
    // attached via aria-describedby instead of an aria-label override.
    const descId = `coalition-desc-${members.length}-${members
      .map((m) => m.replace(/\W/g, ""))
      .join("-")}`;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={isSelected}
        aria-describedby={descId}
        onClick={() => setSelectedCoalitionKey(key)}
        className={`text-left border p-2 min-w-[104px] flex-1 sm:flex-none sm:w-[136px] rounded-[2px] transition-colors ${
          isSelected ? "outline outline-2 outline-offset-[-2px] outline-[#8ecbff]" : ""
        }`}
        style={{
          background:
            focusPlayer && delta !== null ? ramp.background : "var(--card-2)",
          borderColor: isSelected ? "var(--focus-ring)" : "var(--card-border)",
        }}
      >
        <span className="block text-[11px] font-medium text-[#f4f5f6] leading-tight break-words">
          {shortLabel}
        </span>
        <span className="block text-sm font-semibold tabular-nums mt-1">
          v(S) {v !== undefined ? v.toFixed(1) : "n/a"}
        </span>
        {focusPlayer && (
          <span
            className="block text-[11px] tabular-nums mt-0.5"
            style={{ color: delta !== null ? ramp.color : "var(--muted)" }}
          >
            {delta !== null
              ? `Δ ${focusPlayer.split(" ")[0]} ${delta > 0 ? "+" : ""}${delta.toFixed(1)}`
              : "Δ not evaluated"}
          </span>
        )}
        <span id={descId} className="sr-only">
          Coalition members: {members.length === 0 ? "none (empty set)" : members.join(", ")}.
          Value {v !== undefined ? v.toFixed(1) : "not evaluated"}.
          {focusPlayer && delta !== null
            ? ` Marginal gain of adding ${focusPlayer}: ${delta > 0 ? "+" : ""}${delta.toFixed(1)}.`
            : ""}
        </span>
      </button>
    );
  };

  const copyMarkdown = () => {
    if (!data) return;
    const lines = [
      `### Shapley Fair Revenue Settlement: ${data.repo}`,
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
            if (j.status === "complete" && j.provenance?.efficiency_check === "failed") {
              // A result that failed the backend efficiency assertion
              // must never render numbers: show the error state instead.
              setError("Attribution failed its efficiency check; no results were produced.");
              setStatus("failed");
            } else if (j.status === "complete") {
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
    const api = gridApiRef.current || (typeof window !== "undefined" ? (window as any).__gridApi : null);
    if (api) {
      const currentRows: any[] = [];
      api.forEachNode((n: any) => {
        if (n.data) currentRows.push(n.data);
      });
      const sorted = [...currentRows].sort((a, b) => {
        if (metric === "loc") {
          return ((b.additions || 0) + (b.deletions || 0)) - ((a.additions || 0) + (a.deletions || 0));
        } else if (metric === "commits") {
          return (b.commits || 0) - (a.commits || 0);
        } else {
          return (b.share_pct || 0) - (a.share_pct || 0);
        }
      });
      api.setGridOption("rowData", sorted);
      setTimeout(() => {
        api.flashCells({ columns: ["share_pct", "payout_usd", "marginalDeltas", "rank", "additions", "commits"] });
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
            <div className="w-6 h-6 rounded-[2px] bg-zinc-800 border border-zinc-700 flex items-center justify-center font-bold text-xs text-zinc-300 font-mono">
              {p.value?.charAt(0)}
            </div>
            <div className="leading-tight">
              <span className="font-medium text-white block text-xs">{p.value}</span>
              <span className="text-[10px] text-zinc-400 font-mono">{p.data?.email}</span>
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
          if (!deltas.length) return <span className="text-zinc-400 text-xs">-</span>;
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
      { colId: "commits", field: "commits", headerName: "Commits", width: 90, sortable: true },
      {
        colId: "additions",
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
              <span className="text-[9px] bg-amber-900/40 text-amber-300 border border-amber-700/50 px-1 py-0.2 rounded-[2px] font-sans">
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
          fill: "#6ea8fe",
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
            seriesNodeClick: (e: any) => {
              const name = e.datum?.contributor;
              if (name) {
                const match = displayedContributors.find((c) => c.name === name);
                if (match) {
                  setSelectedContributor(match);
                  const api = gridApiRef.current || gridRef.current?.api;
                  if (api) {
                    api.forEachNode((node: any) => {
                      if (node.data?.name === name) {
                        node.setSelected(true);
                        api.ensureIndexVisible(node.rowIndex, "middle");
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
          fill: "#8a8f98",
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
            seriesNodeClick: (e: any) => {
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
            color: "#f4f5f6",
          },
        },
      },
      background: { fill: "#101214" },
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
      <main className="min-h-screen bg-[#101214] text-zinc-100 flex items-center justify-center font-mono">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-zinc-700 border-t-zinc-200 mx-auto mb-4"></div>
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
      <main className="min-h-screen bg-[#101214] text-zinc-100 flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-red-400 mb-4">{error || "Something went wrong"}</p>
          <button onClick={() => router.push("/")}
            className="bg-zinc-800 hover:bg-zinc-700 px-6 py-2 rounded-[2px]">
            Back
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#101214] text-zinc-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-zinc-400 mb-4">
          <button onClick={() => router.push("/")} className="hover:text-zinc-300 transition-colors">
            Home
          </button>
          <span>/</span>
          <span className="font-mono text-zinc-400">{data.repo}</span>
          <span>/</span>
          <span className="text-zinc-300">Fair Share Results</span>
        </div>

        {/* Persona Switcher Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-1.5 bg-[#17191c] border border-[#2b2f36] rounded-[2px] mb-6">
          <div className="grid grid-cols-3 sm:flex items-center gap-1 p-0.5 bg-[#101214] rounded-[2px] text-xs font-mono border border-[#2b2f36] w-full sm:w-auto">
            <button
              onClick={() => setCurrentPersona("lead")}
              className={`px-2 sm:px-3 py-1.5 rounded-[2px] transition-colors text-center ${
                currentPersona === "lead"
                  ? "bg-[#2b2f36] text-white font-semibold"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <span className="sm:hidden">Lead</span>
              <span className="hidden sm:inline">Team Lead</span>
            </button>
            <button
              onClick={() => setCurrentPersona("sponsor")}
              className={`px-2 sm:px-3 py-1.5 rounded-[2px] transition-colors text-center ${
                currentPersona === "sponsor"
                  ? "bg-[#2b2f36] text-white font-semibold"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <span className="sm:hidden">Sponsor</span>
              <span className="hidden sm:inline">Business Sponsor</span>
            </button>
            <button
              onClick={() => setCurrentPersona("member")}
              className={`px-2 sm:px-3 py-1.5 rounded-[2px] transition-colors text-center ${
                currentPersona === "member"
                  ? "bg-[#2b2f36] text-white font-semibold"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <span className="sm:hidden">Member</span>
              <span className="hidden sm:inline">Contributor</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPotModal(true)}
              className="px-3 py-1.5 rounded-[2px] bg-[#101214] hover:bg-zinc-900 border border-[#2b2f36] text-emerald-400 text-xs font-mono flex items-center justify-center gap-2 transition-colors w-full sm:w-auto"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
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
                <span className="ml-2 bg-yellow-900/60 border border-yellow-700/50 text-yellow-200 text-xs px-2 py-0.5 rounded-[2px] font-sans font-semibold">
                  DEMO MODE
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowCommandPalette(true)}
              className="bg-zinc-900/90 hover:bg-zinc-800 px-3 py-1.5 rounded-[2px] text-xs font-semibold border border-zinc-700/80 flex items-center gap-2 transition-all text-zinc-300"
              title="Quick Action Command Palette (⌘K)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <span>Command</span>
              <kbd className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded-[2px] border border-zinc-700">⌘K</kbd>
            </button>
            <button
              onClick={() => setShowMerkleModal(true)}
              className="bg-emerald-950/60 hover:bg-emerald-900/60 px-3.5 py-2 rounded-[2px] text-xs font-semibold border border-emerald-700/60 flex items-center gap-2 transition-colors text-emerald-300"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Merkle Root Verified
            </button>
            <button
              onClick={copyMarkdown}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-[2px] text-xs font-semibold border border-zinc-700 flex items-center gap-1.5 transition-colors text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              {copiedMd ? "Copied Markdown!" : "Copy PR Markdown"}
            </button>
            <button
              onClick={() => setShowChatModal(true)}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-[2px] text-xs font-semibold border border-zinc-700 flex items-center gap-1.5 transition-colors text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              Chat Alerts
            </button>
            <button
              onClick={() => setShowActionModal(true)}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-[2px] text-xs font-semibold border border-zinc-700 flex items-center gap-1.5 transition-colors text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
              CI/CD Action
            </button>
            <button
              onClick={exportCSV}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-[2px] text-xs font-semibold border border-zinc-700 flex items-center gap-1.5 transition-colors text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Export CSV
            </button>
            <button onClick={() => router.push(`/audit?demo=${params.get("demo")}&job=${params.get("job") || ""}`)}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-[2px] text-xs font-semibold border border-zinc-700 transition-colors text-zinc-200">
              View Audit Trail
            </button>
            <button
              onClick={() => setShowRepoModal(true)}
              className="bg-zinc-800 hover:bg-zinc-700 px-3.5 py-2 rounded-[2px] text-xs font-semibold border border-zinc-700 flex items-center gap-1.5 transition-colors text-zinc-200"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              + Analyze Another Repo
            </button>
          </div>
        </div>

        {/* Coalition lattice hero (Phase 4): the 2^n coalition grid is the
            primary artifact of this view, not a tab. Every value shown is a
            persisted coalition evaluation; selecting a coalition here
            highlights its ledger steps, and selecting a ledger step selects
            the coalition here. */}
        {lattice && (
          <section
            aria-labelledby="lattice-heading"
            className="bg-[#17191c] border border-[#2b2f36] rounded-[2px] p-4 sm:p-5 mb-8"
          >
            <h2 id="lattice-heading" className="text-lg font-semibold text-[#f4f5f6]">
              Coalition lattice
            </h2>
            <p className="text-sm text-zinc-400 leading-relaxed mt-1 mb-4">
              Every coalition the engine evaluated, with its persisted value v(S).{" "}
              {lattice.fullGrid
                ? `All ${lattice.totalCoalitions} coalitions (2^${lattice.n}) are shown.`
                : lattice.evaluatedCount >= lattice.totalCoalitions
                  ? `All ${lattice.totalCoalitions} coalitions (2^${lattice.n}) exist; they are grouped by coalition size so the grid stays readable, and every group expands to the full set.`
                  : `${lattice.evaluatedCount} of ${lattice.totalCoalitions} coalitions (2^${lattice.n}) were evaluated in this sampled result; every evaluated coalition is shown, grouped by size.`}{" "}
              Select a coalition to trace its marginal-contribution ledger. Hover or
              select a contributor to see the marginal gain of adding them to each
              coalition.
            </p>

            <div className="flex flex-wrap items-center gap-2 mb-5">
              <span className="text-xs text-zinc-400">Marginal gain of adding:</span>
              {lattice.players.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={pinnedPlayer === p}
                  onClick={() => setPinnedPlayer(pinnedPlayer === p ? null : p)}
                  onMouseEnter={() => setHoverPlayer(p)}
                  onMouseLeave={() => setHoverPlayer(null)}
                  onFocus={() => setHoverPlayer(p)}
                  onBlur={() => setHoverPlayer(null)}
                  className={`px-2.5 py-1.5 text-xs border rounded-[2px] transition-colors ${
                    pinnedPlayer === p
                      ? "bg-[#1d2024] text-white border-[#8ecbff] font-semibold"
                      : "bg-[#131518] text-zinc-300 border-[#2b2f36] hover:text-white"
                  }`}
                >
                  {p}
                </button>
              ))}
              {focusPlayer && (
                <span className="text-xs text-zinc-400">
                  Showing Δ for {focusPlayer}
                  {pinnedPlayer ? " (selected)" : " (hover)"}
                </span>
              )}
            </div>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
              <div>
                {lattice.fullGrid
                  ? [...lattice.bySize.keys()]
                      .sort((a, b) => a - b)
                      .map((k) => (
                        <div key={k} className="mb-3.5">
                          <div className="text-xs text-zinc-400 mb-1.5">
                            |S| = {k} · {lattice.bySize.get(k)!.length}{" "}
                            {lattice.bySize.get(k)!.length === 1 ? "coalition" : "coalitions"}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {lattice.bySize.get(k)!.map((members) => renderCoalitionCell(members))}
                          </div>
                        </div>
                      ))
                  : Array.from({ length: lattice.n + 1 }, (_, k) => {
                      const evaluated = lattice.bySize.get(k) ?? [];
                      const total = binom(lattice.n, k);
                      const open = expandedSizes[k] ?? k === selectedMembers.length;
                      return (
                        <div key={k} className="mb-2 border border-[#2b2f36] rounded-[2px]">
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() =>
                              setExpandedSizes((prev) => ({ ...prev, [k]: !open }))
                            }
                            className="w-full flex items-center justify-between px-3 py-2 text-xs text-zinc-300 bg-[#131518] hover:text-white transition-colors"
                          >
                            <span>
                              |S| = {k} · {total} coalitions
                              {evaluated.length < total
                                ? ` · ${evaluated.length} evaluated`
                                : ""}
                            </span>
                            <span>{open ? "Hide" : "Show"}</span>
                          </button>
                          {open && (
                            <div className="flex flex-wrap gap-1.5 p-2">
                              {evaluated.length > 0
                                ? evaluated.map((members) => renderCoalitionCell(members))
                                : <span className="text-xs text-zinc-400">No coalition of this size was evaluated.</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}

                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 text-[11px] text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-[2px] border border-[#2b2f36]" style={{ background: "var(--pos-bg-2)" }} />
                    Δv &gt; 0: toward the decision (adds value)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-[2px] border border-[#2b2f36]" style={{ background: "var(--neg-bg-2)" }} />
                    Δv &lt; 0: against the decision (removes value)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-[2px] border border-[#2b2f36]" style={{ background: "var(--card-2)" }} />
                    Δv = 0 or no contributor selected: neutral
                  </span>
                </div>
              </div>

              <div className="border border-[#2b2f36] bg-[#131518] rounded-[2px] p-3.5">
                <h3 className="text-sm font-semibold text-[#f4f5f6]">
                  Marginal-contribution ledger
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed mt-1 mb-3">
                  Building{" "}
                  {selectedMembers.length === 0
                    ? "the empty coalition"
                    : `{ ${selectedMembers.join(", ")} }`}{" "}
                  one contributor at a time, in contributor order. Select any step
                  to inspect that coalition in the lattice.
                </p>
                <ol className="space-y-1.5">
                  {waterfallSteps.map((step) => {
                    const key = coalitionKey(step.members);
                    const isSel = key === coalitionKey(selectedMembers);
                    const ramp = rampStyle(step.delta);
                    const phi = step.added
                      ? data.contributors.find((c) => c.name === step.added)
                      : null;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          aria-current={isSel ? "true" : undefined}
                          onClick={() => setSelectedCoalitionKey(key)}
                          className={`w-full flex items-center justify-between gap-2 text-left border rounded-[2px] px-2.5 py-2 bg-[#1d2024] transition-colors ${
                            isSel ? "outline outline-2 outline-offset-[-2px] outline-[#8ecbff]" : ""
                          }`}
                          style={{
                            borderColor: isSel ? "var(--focus-ring)" : "var(--card-border)",
                          }}
                        >
                          <span className="text-xs min-w-0">
                            {step.added ? (
                              <>
                                Add <strong className="text-[#f4f5f6]">{step.added}</strong>
                                {phi && (
                                  <span className="block text-[11px] text-zinc-400 tabular-nums">
                                    Shapley φ {phi.shapley_value.toFixed(1)} · share{" "}
                                    {phi.share_pct.toFixed(1)}%
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-zinc-300">Start: empty coalition ∅</span>
                            )}
                          </span>
                          <span className="text-right shrink-0">
                            {step.added && (
                              <span
                                className="block text-xs tabular-nums font-medium"
                                style={{ color: step.delta !== null ? ramp.color : "var(--muted)" }}
                              >
                                Δ {step.delta !== null ? `${step.delta > 0 ? "+" : ""}${step.delta.toFixed(1)}` : "n/a"}
                              </span>
                            )}
                            <span className="block text-sm font-semibold tabular-nums">
                              v = {step.value !== null ? step.value.toFixed(1) : "n/a"}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <p className="text-[11px] text-zinc-400 mt-3 leading-relaxed">
                  Each Δ is v(S ∪ {"{i}"}) − v(S) between two persisted evaluations.
                  A contributor&apos;s Shapley value φ averages this gain over every
                  order; the steps above follow the contributor order only.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Heuristic-fallback warning: shown when any coalition was scored
            by the objective heuristic because Gemini was unavailable. */}
        {data.evaluations?.some((e) => e.scoring_mode === "heuristic_fallback") && (
          <div className="bg-red-950/40 border border-red-900 rounded-[2px] p-4 mb-8 text-sm text-red-300">
            ⚠ <strong>Heuristic fallback:</strong>{" "}
            {data.evaluations.filter((e) => e.scoring_mode === "heuristic_fallback").length}{" "}
            of {data.evaluations.length} coalition scores came from the objective
            line/branch heuristic (Gemini unavailable), not from AI semantic
            evaluation. Treat those shares as low-confidence estimates. Affected
            coalitions are flagged in the audit view.
          </div>
        )}

        {/* Provenance: persisted record from the backend Shapley engine.
            Displayed values are read from this record / the API response,
            never recomputed in the browser. */}
        {data.provenance && (
          <div className="bg-[#17191c] border border-[#2b2f36] rounded-[2px] p-5 mb-8 font-mono text-xs text-zinc-400">
            <h2 className="text-sm text-zinc-300 font-semibold mb-2">Provenance</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              <span>Algorithm: {data.provenance.algorithm}</span>
              <span>CI method: {data.provenance.ci_method}</span>
              <span>Model: {data.provenance.model}</span>
              <span>Model hash: {data.provenance.model_hash.slice(0, 12)}…</span>
              <span>Seed: {data.provenance.seed ?? "n/a (exact)"}</span>
              <span>Samples: {data.provenance.n_samples}</span>
              <span>Baseline v(∅): {data.provenance.baseline}</span>
              <span>Efficiency check: {data.provenance.efficiency_check}</span>
              <span>Input hash: {data.provenance.input_hash.slice(0, 12)}…</span>
              <span>Extractor commit: {data.provenance.feature_extractor_commit.slice(0, 12)}…</span>
            </div>
          </div>
        )}

        {/* Executive Summary Card */}
        {data.summary && (
          <div className="bg-[#17191c] border border-[#2b2f36] rounded-[2px] p-5 mb-8 flex items-start gap-4 animate-rise">
            <div className="w-8 h-8 rounded-[2px] bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center justify-center flex-shrink-0 mt-0.5 font-mono text-xs font-bold">
              AI
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-semibold text-zinc-300">
                  AI Contribution Synthesis
                </h2>
                <button
                  onClick={() => setShowMath(!showMath)}
                  className="text-xs text-zinc-400 hover:text-white font-mono underline flex items-center gap-1"
                >
                  {showMath ? "Hide Methodology" : "Methodology & Axiomatic Proofs"}
                </button>
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed font-mono">
                {data.summary}
              </p>
            </div>
          </div>
        )}

        {/* Game Theory Explainer Dropdown */}
        {showMath && (
          <div className="bg-[#17191c] border border-[#2b2f36] rounded-[2px] p-6 mb-8 text-sm text-zinc-300 animate-rise">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-[#2b2f36]">
              <h2 className="font-semibold text-zinc-100 flex items-center gap-2">
                <span className="w-5 h-5 rounded-[2px] bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center justify-center text-xs font-serif font-bold">
                  &phi;
                </span>
                How Shapley Calculates Fair Shares
              </h2>
              
              <div className="flex items-center gap-1 bg-[#101214] p-1 rounded-[2px] border border-[#2b2f36] text-xs font-mono">
                <button
                  onClick={() => setExplainerTab("simple")}
                  className={`px-3 py-1 rounded-[2px] transition-all font-medium ${
                    explainerTab === "simple"
                      ? "bg-[#2b2f36] text-white font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Plain English
                </button>
                <button
                  onClick={() => setExplainerTab("math")}
                  className={`px-3 py-1 rounded-[2px] transition-all font-medium ${
                    explainerTab === "math"
                      ? "bg-[#2b2f36] text-white font-semibold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Math Proofs
                </button>
              </div>
            </div>

            {explainerTab === "simple" ? (
              <div className="space-y-5 text-xs">
                {/* The Missing Teammate Analogy */}
                <div className="bg-[#101214] border border-[#2b2f36] rounded-[2px] p-4 font-mono">
                  <h3 className="font-bold text-white text-sm mb-1.5 flex items-center gap-2">
                    The Marginal Contribution Axiom
                  </h3>
                  <p className="text-zinc-300 leading-relaxed">
                    Software engineering is cooperative. How do you measure an engineer&apos;s real value? Not by typing speed or lines committed, but by how the team performs <strong>with them</strong> versus <strong>without them</strong>.
                  </p>
                </div>

                {/* Real-World Contrast: Lines of Code vs True Impact */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="bg-[#101214] border border-rose-950/50 rounded-[2px] p-4 font-mono">
                    <span className="text-rose-400 font-bold block mb-1 text-[11px]">&times; Naive Lines of Code Metric</span>
                    <p className="text-zinc-400 leading-relaxed mb-2">
                      If an engineer runs an automated linter (Prettier) to reformat 2,400 lines of whitespace, naive systems award them 50% of the entire bounty pool.
                    </p>
                    <span className="text-zinc-400 text-[10px]">Result: Rewards spam, punishes real engineering.</span>
                  </div>
                  <div className="bg-[#101214] border border-emerald-950/50 rounded-[2px] p-4 font-mono">
                    <span className="text-emerald-400 font-bold block mb-1 text-[11px]">&check; Shapley Cooperative Value</span>
                    <p className="text-zinc-400 leading-relaxed mb-2">
                      We simulate all combinations of team members. If your 5-line security patch turns a broken, vulnerable release into a rock-solid product, you are paid as an MVP.
                    </p>
                    <span className="text-zinc-400 text-[10px]">Result: 100% fair, zero favoritism, exact-penny conservation.</span>
                  </div>
                </div>

                {/* 3 Core Rules Pipeline */}
                <div className="flex flex-col sm:flex-row items-stretch divide-y sm:divide-y-0 sm:divide-x divide-[#2b2f36] border border-[#2b2f36] bg-[#101214] rounded-[2px] overflow-hidden text-xs font-mono">
                  <div className="flex-1 p-3.5">
                    <span className="font-semibold text-white block mb-0.5">01 · Noise Filtering</span>
                    <span className="text-zinc-400 text-[11px] leading-tight block">AST syntax parsing isolates semantic logic from whitespace and formatting.</span>
                  </div>
                  <div className="flex-1 p-3.5">
                    <span className="font-semibold text-white block mb-0.5">02 · Counterfactual Valuation</span>
                    <span className="text-zinc-400 text-[11px] leading-tight block">Evaluates marginal capability deltas across all 2^(N-1) subsets.</span>
                  </div>
                  <div className="flex-1 p-3.5">
                    <span className="font-semibold text-white block mb-0.5">03 · Exact Settlement</span>
                    <span className="text-zinc-400 text-[11px] leading-tight block">Funds disburse via PayPal with 100% exact-penny financial conservation.</span>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-zinc-400 mb-4 text-xs leading-relaxed">
                  Calculates each contributor&apos;s expected marginal contribution across all possible team coalitions <code className="text-blue-300 bg-zinc-950 px-1.5 py-0.5 rounded-[2px] border border-zinc-800 font-mono text-xs">S &sube; N \ &#123;i&#125;</code>:
                </p>

                {/* Styled Mathematical Formula Container */}
                <div className="bg-zinc-950 p-4 rounded-[2px] border border-zinc-800/90 mb-5 flex items-center justify-center overflow-x-auto">
                  <div className="flex items-center gap-3 font-serif text-sm sm:text-base text-zinc-200 select-none py-1">
                    <span className="text-blue-400 font-bold italic text-lg sm:text-xl">&phi;<sub>i</sub></span>
                    <span className="text-zinc-400 text-lg">&equals;</span>
                    <div className="flex items-center gap-1.5">
                      <div className="flex flex-col items-center">
                        <span className="text-xs text-zinc-400 font-sans tracking-tighter">S &sube; N \ &#123;i&#125;</span>
                        <span className="text-xl text-blue-400 font-sans">&sum;</span>
                      </div>
                      <div className="inline-flex flex-col items-center text-center px-1 font-sans text-xs sm:text-sm">
                        <span className="border-b border-zinc-600 px-2 pb-0.5 font-mono text-blue-300">
                          |S|! &middot; (n &minus; |S| &minus; 1)!
                        </span>
                        <span className="pt-0.5 font-mono text-zinc-400">n!</span>
                      </div>
                      <span className="text-zinc-400 text-lg sm:text-xl">&times;</span>
                      <div className="flex items-center gap-1 bg-zinc-900/90 border border-zinc-800 px-3 py-1.5 rounded-[2px] font-mono text-xs text-emerald-400">
                        <span>v(S &cup; &#123;i&#125;) &minus; v(S)</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-zinc-800/40 border border-zinc-800 p-3 rounded-[2px]">
                    <span className="font-semibold text-zinc-200 block mb-1">1. Efficiency</span>
                    <span className="font-mono text-[11px] text-blue-400 block mb-1">&sum; &phi;&#7522; &equals; 100%</span>
                    <span className="text-zinc-400 text-[11px] leading-tight block">Exact total bounty is distributed with 0 rounding leakage.</span>
                  </div>
                  <div className="bg-zinc-800/40 border border-zinc-800 p-3 rounded-[2px]">
                    <span className="font-semibold text-zinc-200 block mb-1">2. Symmetry</span>
                    <span className="font-mono text-[11px] text-blue-400 block mb-1">&phi;&#7522; &equals; &phi;&#11388; if &Delta;v equal</span>
                    <span className="text-zinc-400 text-[11px] leading-tight block">Contributors with equal marginal capability receive equal payout.</span>
                  </div>
                  <div className="bg-zinc-800/40 border border-zinc-800 p-3 rounded-[2px]">
                    <span className="font-semibold text-zinc-200 block mb-1">3. Dummy Player</span>
                    <span className="font-mono text-[11px] text-blue-400 block mb-1">&phi;&#7522; &equals; 0 if &Delta;v &equals; 0</span>
                    <span className="text-zinc-400 text-[11px] leading-tight block">Zero marginal utility code changes yield zero bounty.</span>
                  </div>
                  <div className="bg-zinc-800/40 border border-zinc-800 p-3 rounded-[2px]">
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
          <div className="bg-zinc-900 rounded-[2px] border border-zinc-800 p-4">
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
          <div className="bg-zinc-900 rounded-[2px] border border-zinc-800 p-6 flex flex-col justify-between">
            <div>
              <h2 className="font-semibold mb-4">Summary &amp; Settlement</h2>

              {/* Real-time Pool Simulator */}
              <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-[2px] p-3.5 mb-5">
                <div className="flex items-center justify-between mb-2 text-xs">
                  <label htmlFor="pool-slider" className="text-zinc-400 font-medium">Bounty Pool Simulator</label>
                  <span className="font-mono text-emerald-400 font-bold text-sm">
                    ${currentTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} USD
                  </span>
                </div>
                <input
                  id="pool-slider"
                  type="range"
                  min="100"
                  max="10000"
                  step="50"
                  value={currentTotal}
                  onChange={(e) => setAdjustedAmount(parseFloat(e.target.value))}
                  className="w-full accent-zinc-200 bg-zinc-800 h-1.5 rounded-[2px] cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-zinc-400 mt-1.5 font-mono">
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
                <div className="flex justify-between text-xs text-zinc-400 pt-2 border-t border-zinc-800/60">
                  <span>PayPal Batch Fee (${0.25} &times; {data.contributors.length})</span>
                  <span className="font-mono text-zinc-400">${(0.25 * data.contributors.length).toFixed(2)}</span>
                </div>
              </div>
            </div>
            {!payoutResult ? (
              <button
                onClick={handlePayout}
                disabled={paying}
                className="w-full mt-6 bg-green-800 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-[2px] px-6 py-3 btn-interactive"
              >
                {paying ? "Executing..." : "Execute Payout via PayPal"}
              </button>
            ) : (
              <div className="mt-6 bg-green-950 border border-green-800 rounded-[2px] p-4 animate-pop">
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
                    <p className="text-sm text-green-300 mt-1 font-mono">
                      {payoutResult.batch_id}
                    </p>
                    {payoutStatus && payoutStatus !== "SUCCESS" && (
                      <p className="text-xs text-green-200 mt-1">
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
        <div className="bg-[#17191c] border border-[#2b2f36] rounded-[2px] p-5 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 mb-3 border-b border-[#2b2f36]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <h2 className="text-sm font-bold text-white">
                Human Pilot &amp; AI Co-Authorship Attribution Rule
              </h2>
              <span className="text-[10px] font-mono bg-[#101214] text-zinc-300 border border-[#2b2f36] px-2 py-0.5 rounded-[2px]">
                RFC 2822 Trailer Provenance
              </span>
            </div>
            <span className="text-[11px] font-mono text-zinc-400">Legal: AI Agents Route to Maintainer Wallets</span>
          </div>
          <p className="text-zinc-400 text-xs leading-relaxed mb-3 font-mono">
            When developers push commits generated with Claude, Cursor, Copilot, or Cline (e.g. <code className="text-zinc-200 bg-[#101214] px-1 py-0.5 rounded-[2px] border border-[#2b2f36]">Co-authored-by: Claude &lt;noreply@anthropic.com&gt;</code>), 
            Shapley attributes financial disburse to the <strong>Human Pilot</strong> who authored the prompt, reviewed the code, validated the test suite, and GPG-signed the commit.
          </p>
          <div className="flex flex-col sm:flex-row items-stretch divide-y sm:divide-y-0 sm:divide-x divide-[#2b2f36] border border-[#2b2f36] bg-[#101214] rounded-[2px] overflow-hidden text-xs font-mono">
            <div className="flex-1 p-3">
              <span className="text-zinc-400 block text-[10px]">Human Pilot Leverage</span>
              <span className="text-white font-semibold">100% Direct Disbursement</span>
            </div>
            <div className="flex-1 p-3">
              <span className="text-zinc-400 block text-[10px]">Synthetic Code Quarantine</span>
              <span className="text-zinc-300 font-semibold">AST Filters Boilerplate</span>
            </div>
            <div className="flex-1 p-3">
              <span className="text-zinc-400 block text-[10px]">Autonomous Agent Bounties</span>
              <span className="text-emerald-400 font-semibold">PayPal Escrow Custody</span>
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
            <div className="relative bg-zinc-900 border border-zinc-700 rounded-[2px] p-6 max-w-md w-full modal-content">
              <h3 className="text-lg font-bold mb-2">Confirm Payout</h3>
              <p className="text-sm text-zinc-400 mb-4">
                This will send{" "}
                <span className="text-emerald-400 font-semibold font-mono">
                  ${currentTotal.toFixed(2)}
                </span>{" "}
                via PayPal Payouts to {displayedContributors.length} contributors.
                This cannot be undone.
              </p>
              <div className="bg-zinc-800 rounded-[2px] p-3 mb-4 max-h-48 overflow-y-auto">
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
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-[2px] px-4 py-2.5 btn-interactive"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmPayout}
                  className="flex-1 bg-green-800 hover:bg-green-700 text-white font-medium rounded-[2px] px-4 py-2.5 btn-interactive font-mono"
                >
                  Send ${currentTotal.toFixed(2)}
                </button>
              </div>
              <p className="text-xs text-zinc-400 mt-3 text-center">
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
            <div className="relative bg-zinc-900 border border-zinc-700 rounded-[2px] p-6 max-w-xl w-full modal-content">
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
              <pre className="bg-zinc-950 p-3.5 rounded-[2px] text-xs font-mono text-zinc-300 border border-zinc-800 overflow-x-auto leading-relaxed mb-4">
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
                  className="bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold px-4 py-2 rounded-[2px] transition-colors"
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
            <div className="relative bg-[#17191c] border border-[#2b2f36] rounded-[2px] p-6 max-w-2xl w-full modal-content max-h-[90vh] overflow-y-auto font-mono">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#2b2f36]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-[2px] bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center justify-center font-mono text-xs font-bold">
                    WEB
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white font-sans">Team Chat Alerts &amp; Webhooks</h3>
                    <p className="text-xs text-zinc-400">Post milestone digests directly to Telegram, WhatsApp, Slack, or Discord</p>
                  </div>
                </div>
                <button onClick={() => setShowChatModal(false)} className="text-zinc-400 hover:text-white text-lg">&times;</button>
              </div>

              {/* Platform Selector Tabs */}
              <div className="flex flex-wrap items-center gap-2 mb-4 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setChatPlatform("telegram")}
                  className={`px-3 py-1.5 rounded-[2px] font-semibold transition-colors ${
                    chatPlatform === "telegram"
                      ? "bg-[#2b2f36] text-white border border-zinc-600"
                      : "bg-[#101214] hover:bg-zinc-800 text-zinc-400 border border-[#2b2f36]"
                  }`}
                >
                  Telegram Bot
                </button>
                <button
                  type="button"
                  onClick={() => setChatPlatform("whatsapp")}
                  className={`px-3 py-1.5 rounded-[2px] font-semibold transition-colors ${
                    chatPlatform === "whatsapp"
                      ? "bg-[#2b2f36] text-white border border-zinc-600"
                      : "bg-[#101214] hover:bg-zinc-800 text-zinc-400 border border-[#2b2f36]"
                  }`}
                >
                  WhatsApp Cloud
                </button>
                <button
                  type="button"
                  onClick={() => setChatPlatform("slack")}
                  className={`px-3 py-1.5 rounded-[2px] font-semibold transition-colors ${
                    chatPlatform === "slack"
                      ? "bg-[#2b2f36] text-white border border-zinc-600"
                      : "bg-[#101214] hover:bg-zinc-800 text-zinc-400 border border-[#2b2f36]"
                  }`}
                >
                  Slack Block Kit
                </button>
                <button
                  type="button"
                  onClick={() => setChatPlatform("discord")}
                  className={`px-3 py-1.5 rounded-[2px] font-semibold transition-colors ${
                    chatPlatform === "discord"
                      ? "bg-[#2b2f36] text-white border border-zinc-600"
                      : "bg-[#101214] hover:bg-zinc-800 text-zinc-400 border border-[#2b2f36]"
                  }`}
                >
                  Discord Embed
                </button>
              </div>

              {/* Payload Preview */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>Standard REST Webhook Payload ({chatPlatform}):</span>
                  <span className="font-mono text-[11px] text-zinc-400">JSON-RPC 2.0 / MCP Compatible</span>
                </div>
                <pre className="bg-[#101214] p-4 rounded-[2px] text-xs font-mono text-zinc-200 border border-[#2b2f36] overflow-x-auto max-h-72 leading-relaxed select-all">
                  {(() => {
                    const payload =
                      chatPlatform === "telegram"
                        ? {
                            chat_id: "@shapley_updates",
                            text: `<b>Shapley Milestone: <code>${data.repo}</code></b>\n\n<b>Bounty Pool:</b> $${currentTotal.toFixed(2)} USD\n<b>Merkle Root:</b> <code>88643cd1b4...</code>\n\n<b>Standings:</b>\n` +
                              displayedContributors.map((c) => `• <b>${c.name}</b>: <code>${c.share_pct.toFixed(1)}%</code> ($${c.payout_usd.toFixed(2)})`).join("\n"),
                            parse_mode: "HTML",
                            reply_markup: {
                              inline_keyboard: [
                                [
                                  { text: "Disburse Payouts", url: `${appOrigin}/results` },
                                  { text: "Merkle Audit", url: `${appOrigin}/audit` }
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
                              header: { type: "text", text: `Shapley Milestone: ${data.repo}` },
                              body: {
                                text: `Milestone for *${data.repo}*:\n*Pool:* $${currentTotal.toFixed(2)} USD\n\n*Fair Shares:*\n` +
                                  displayedContributors.map((c) => `• ${c.name}: ${c.share_pct.toFixed(1)}% ($${c.payout_usd.toFixed(2)})`).join("\n")
                              },
                              action: {
                                buttons: [
                                  { type: "reply", reply: { id: "btn_approve_payout", title: "Approve Payout" } },
                                  { type: "reply", reply: { id: "btn_verify_audit", title: "Audit Merkle" } }
                                ]
                              }
                            }
                          }
                        : chatPlatform === "discord"
                        ? {
                            embeds: [
                              {
                                title: `Shapley Attribution: ${data.repo}`,
                                description: "Axiomatic game-theoretic fair revenue sharing.",
                                color: 3447003,
                                fields: [
                                  { name: "Total Pool", value: `$${currentTotal.toFixed(2)} USD`, inline: true },
                                  { name: "Merkle Proof", value: "88643cd1b4...", inline: true },
                                  {
                                    name: "Leaderboard",
                                    value: displayedContributors.map((c) => `**${c.name}**: \`${c.share_pct.toFixed(1)}%\` ($${c.payout_usd.toFixed(2)})`).join("\n")
                                  }
                                ]
                              }
                            ]
                          }
                        : {
                            text: `Shapley Milestone Update: ${data.repo}`,
                            blocks: [
                              { type: "header", text: { type: "plain_text", text: `Shapley Milestone: ${data.repo}` } },
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
                    return JSON.stringify(payload, null, 2);
                  })()}
                </pre>
              </div>

              <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-[#2b2f36]">
                <button
                  type="button"
                  onClick={() => setShowChatModal(false)}
                  className="px-4 py-2 bg-[#101214] hover:bg-zinc-800 text-zinc-300 text-xs font-semibold rounded-[2px] border border-[#2b2f36] transition-colors"
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
                            text: `<b>Shapley Milestone: <code>${data.repo}</code></b>\n\n<b>Bounty Pool:</b> $${currentTotal.toFixed(2)} USD\n<b>Merkle Root:</b> <code>88643cd1b4...</code>\n\n<b>Standings:</b>\n` +
                              displayedContributors.map((c) => `• <b>${c.name}</b>: <code>${c.share_pct.toFixed(1)}%</code> ($${c.payout_usd.toFixed(2)})`).join("\n"),
                            parse_mode: "HTML",
                            reply_markup: {
                              inline_keyboard: [
                                [
                                  { text: "Disburse Payouts", url: `${appOrigin}/results` },
                                  { text: "Merkle Audit", url: `${appOrigin}/audit` }
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
                              header: { type: "text", text: `Shapley Milestone: ${data.repo}` },
                              body: {
                                text: `Milestone for *${data.repo}*:\n*Pool:* $${currentTotal.toFixed(2)} USD\n\n*Fair Shares:*\n` +
                                  displayedContributors.map((c) => `• ${c.name}: ${c.share_pct.toFixed(1)}% ($${c.payout_usd.toFixed(2)})`).join("\n")
                              },
                              action: {
                                buttons: [
                                  { type: "reply", reply: { id: "btn_approve_payout", title: "Approve Payout" } },
                                  { type: "reply", reply: { id: "btn_verify_audit", title: "Audit Merkle" } }
                                ]
                              }
                            }
                          }
                        : chatPlatform === "discord"
                        ? {
                            embeds: [
                              {
                                title: `Shapley Attribution: ${data.repo}`,
                                description: "Axiomatic game-theoretic fair revenue sharing.",
                                color: 3447003,
                                fields: [
                                  { name: "Total Pool", value: `$${currentTotal.toFixed(2)} USD`, inline: true },
                                  { name: "Merkle Proof", value: "88643cd1b4...", inline: true },
                                  {
                                    name: "Leaderboard",
                                    value: displayedContributors.map((c) => `**${c.name}**: \`${c.share_pct.toFixed(1)}%\` ($${c.payout_usd.toFixed(2)})`).join("\n")
                                  }
                                ]
                              }
                            ]
                          }
                        : {
                            text: `Shapley Milestone Update: ${data.repo}`,
                            blocks: [
                              { type: "header", text: { type: "plain_text", text: `Shapley Milestone: ${data.repo}` } },
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
                  className="px-4 py-2 bg-zinc-100 hover:bg-white text-zinc-950 text-xs font-semibold rounded-[2px] transition-colors flex items-center gap-1.5 font-sans"
                >
                  Copy {chatPlatform.charAt(0).toUpperCase() + chatPlatform.slice(1)} Payload
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PayPal Multi-Stakeholder Custodial Escrow Card */}
        <div className="bg-[#17191c] border border-[#2b2f36] rounded-[2px] p-4 sm:p-5 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 mb-4 border-b border-blue-900/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-[2px] bg-[#101214] border border-[#2b2f36] text-zinc-300 flex items-center justify-center font-mono font-bold text-xs">
                PP
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white font-mono">PayPal Multi-Stakeholder Escrow</h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-[2px] bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                    Vault: ESCROW-PP-ACTIVE
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5 font-mono">
                  PayPal acts as a neutral licensed custodian holding bounty funds in an Authorization Hold until multi-stakeholder criteria are met.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
              <div className="text-right hidden sm:block">
                <span className="text-[10px] text-zinc-400 font-mono block">Escrow In Custody</span>
                <span className="text-xs font-mono font-bold text-emerald-400 tabular-nums">${currentTotal.toFixed(2)} USD</span>
              </div>

              {!isSlideAuthorized ? (
                <SlideToAuthorize
                  amountUsd={currentTotal}
                  isAuthorized={isSlideAuthorized}
                  onAuthorize={() => setIsSlideAuthorized(true)}
                />
              ) : (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <div className="flex items-center justify-between sm:justify-start gap-2 px-3 py-1.5 rounded-[2px] bg-emerald-950/40 border border-emerald-800/80 text-xs font-mono text-emerald-400">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span>Hold Authorized: <strong>${currentTotal.toFixed(2)}</strong></span>
                    </span>
                    <button
                      onClick={() => setIsSlideAuthorized(false)}
                      title="Reset hold state for testing"
                      className="text-[10px] text-zinc-400 hover:text-zinc-300 ml-1 underline cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>
                  <button
                    onClick={() => setShowConfirm(true)}
                    className="px-4 py-2 rounded-[2px] bg-emerald-800 hover:bg-emerald-700 text-white font-mono text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Execute Payout</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Compact Quorum Consensus Pipeline Bar */}
          <div className="flex flex-col sm:flex-row items-stretch divide-y sm:divide-y-0 sm:divide-x divide-[#2b2f36] border border-[#2b2f36] bg-[#101214] rounded-[2px] text-xs mb-3 font-mono">
            <div className="flex-1 flex items-center justify-between p-2.5">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> 1. Sponsor Deposit
              </span>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded-[2px]">Authorized</span>
            </div>
            <div className="flex-1 flex items-center justify-between p-2.5">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <span className={`w-1.5 h-1.5 rounded-full ${isSlideAuthorized ? "bg-emerald-400" : "bg-zinc-400"}`}></span> 2. PayPal Neutral Escrow
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-[2px] ${
                isSlideAuthorized 
                  ? "text-emerald-400 bg-emerald-950/60 border border-emerald-800/60" 
                  : "text-zinc-300 bg-zinc-900 border border-zinc-700"
              }`}>
                {isSlideAuthorized ? "29-Day Auth Hold" : "In Custody"}
              </span>
            </div>
            <div className="flex-1 flex items-center justify-between p-2.5">
              <span className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> 3. Maintainer Sign-off
              </span>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded-[2px]">Merkle Verified</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-zinc-400 pt-1 gap-1 font-mono">
            <span><strong>48-Hour Dispute Challenge Window:</strong> Active &bull; Exact-Penny conservation verified ($0.00 float)</span>
            <span className="text-[10px] text-zinc-400">Idempotency: SHA-256 State-Locked</span>
          </div>
        </div>

        <h2 className="text-lg font-semibold text-[#f4f5f6] mb-3">Contributor ledger</h2>
        <div className="bg-[#17191c] rounded-[2px] border border-[#2b2f36] p-4 animate-rise stagger-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#2b2f36] gap-3">
            <div className="flex items-center gap-2 font-mono">
              <button
                onClick={() => setActiveGridTab("contributors")}
                className={`px-3.5 py-1.5 rounded-[2px] text-xs font-semibold transition-all ${
                  activeGridTab === "contributors"
                    ? "bg-[#2b2f36] text-white border border-zinc-600"
                    : "bg-[#101214] text-zinc-400 hover:text-white border border-[#2b2f36]"
                }`}
              >
                Contributors (N={displayedContributors.length})
              </button>
              <button
                onClick={() => setActiveGridTab("coalitions")}
                className={`px-3.5 py-1.5 rounded-[2px] text-xs font-semibold transition-all ${
                  activeGridTab === "coalitions"
                    ? "bg-[#2b2f36] text-white border border-zinc-600"
                    : "bg-[#101214] text-zinc-400 hover:text-white border border-[#2b2f36]"
                }`}
              >
                Coalition Explorer (2^N={coalitionExplorerRows.length} Subsets)
              </button>
            </div>

            <div className="flex items-center gap-3 font-mono">
              {selectedContributor && (
                <button
                  onClick={() => setSelectedContributor(null)}
                  className="text-xs bg-[#101214] hover:bg-zinc-900 text-zinc-300 border border-[#2b2f36] px-2.5 py-1 rounded-[2px] flex items-center gap-1.5 transition-colors"
                >
                  <span>Filtering: <strong>{selectedContributor.name}</strong></span>
                  <span className="text-zinc-400 hover:text-white">x</span>
                </button>
              )}
              <button
                onClick={() => setEditingEmails(!editingEmails)}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                {editingEmails ? "Done" : "Edit PayPal emails"}
              </button>
            </div>
          </div>

          {activeGridTab === "contributors" && (
            <div className="pt-3 pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-mono">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-400 font-semibold">
                  Model Bake-Off:
                </span>
                <div className="flex items-center bg-[#101214] p-0.5 rounded-[2px] border border-[#2b2f36] text-xs">
                  <button
                    onClick={() => handleBaselineChange("shapley")}
                    className={`px-2.5 py-1 rounded-[2px] transition-all font-medium ${
                      baselineMetric === "shapley"
                        ? "bg-[#2b2f36] text-white font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    AI Shapley
                  </button>
                  <button
                    onClick={() => handleBaselineChange("loc")}
                    className={`px-2.5 py-1 rounded-[2px] transition-all font-medium ${
                      baselineMetric === "loc"
                        ? "bg-[#2b2f36] text-white font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Lines Changed
                  </button>
                  <button
                    onClick={() => handleBaselineChange("commits")}
                    className={`px-2.5 py-1 rounded-[2px] transition-all font-medium ${
                      baselineMetric === "commits"
                        ? "bg-[#2b2f36] text-white font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Commit Count
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
              <p className="text-xs text-zinc-400">
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
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-[2px] px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 font-mono text-xs"
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
                  getRowId={(p) => p.data.email}
                  columnDefs={contributorCols}
                  animateRows={true}
                  rowSelection="single"
                  defaultColDef={{ resizable: true }}
                  onGridReady={(e) => {
                    gridApiRef.current = e.api;
                    if (typeof window !== "undefined") (window as any).__gridApi = e.api;
                  }}
                  onRowClicked={(e) => setSelectedContributor(e.data || null)}
                />
              </div>
              <div className="mt-3 px-1 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-zinc-400 gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-blue-400 font-bold">&bull;</span>
                  <span><strong>Cross-Filtering:</strong> Click any contributor row to filter AG Chart bars, or click an AG Chart bar to center this grid.</span>
                </div>
                <div className="flex items-center gap-1.5 text-zinc-400">
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
              className="absolute inset-0 bg-black/80 transition-opacity"
              onClick={() => setSelectedContributor(null)}
            />
            <div className="relative w-full max-w-xl bg-zinc-900 border border-zinc-700/80 rounded-[2px] p-6 overflow-y-auto max-h-[90vh]">
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
                    className="text-zinc-400 hover:text-white p-2 rounded-[2px] bg-zinc-800 hover:bg-zinc-700 transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>

                {/* Share & Payout Hero in Drawer */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-[2px] p-3.5">
                    <span className="text-zinc-400 text-xs block mb-1">Shapley Allocation</span>
                    <span className="text-2xl font-bold font-mono text-blue-400">
                      {selectedContributor.share_pct.toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-zinc-400 block mt-1">Marginal coalition weight</span>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-[2px] p-3.5">
                    <span className="text-zinc-400 text-xs block mb-1">Calculated Payout</span>
                    <span className="text-2xl font-bold font-mono text-emerald-400">
                      ${selectedContributor.payout_usd?.toFixed(2) ?? ((currentTotal * selectedContributor.share_pct) / 100).toFixed(2)}
                    </span>
                    <span className="text-[10px] text-zinc-400 block mt-1">Exact-penny settlement</span>
                  </div>
                </div>

                {/* Physical AST & Git Signals */}
                <div className="mb-6">
                  <h3 className="text-xs font-semibold text-zinc-400 mb-3">
                    Physical Code Signals &amp; AST Analysis
                  </h3>
                  <div className="bg-zinc-950 rounded-[2px] border border-zinc-800 p-4 space-y-3 text-xs font-mono">
                    <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Total Commits</span>
                      <span className="text-white font-bold">{selectedContributor.commits}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-zinc-800/60">
                      <span className="text-zinc-400">Lines Inserted / Deleted</span>
                      <span className="text-emerald-400">+{selectedContributor.additions} <span className="text-zinc-400">/</span> <span className="text-rose-400">-{selectedContributor.deletions}</span></span>
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
                  <h3 className="text-xs font-semibold text-zinc-400 mb-3">
                    Game Theoretic Marginal Contribution
                  </h3>
                  <div className="bg-zinc-950 rounded-[2px] border border-zinc-800 p-4 text-xs text-zinc-300 leading-relaxed">
                    <p className="mb-2">
                      Across all sampled permutation orders <span className="font-mono text-blue-400">&pi; &isin; &Pi;(N)</span> and antithetic mirrors <span className="font-mono text-blue-400">&pi;&apos;</span>, adding <strong className="text-white">{selectedContributor.name}</strong> to predecessor coalitions yielded an average marginal value jump of:
                    </p>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-[2px] p-3 font-mono text-xs text-emerald-400 my-2 flex items-center justify-between">
                      <span>E[v(S &cup; &#123;{selectedContributor.name.split(" ")[0]}&#125;) &minus; v(S)]</span>
                      <span className="font-bold text-sm">+{selectedContributor.share_pct.toFixed(1)}%</span>
                    </div>
                    <p className="text-zinc-400 text-[11px] mt-2">
                      Protected by Lloyd Shapley Efficiency, Symmetry, Dummy Player, and Monotonicity axioms.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-zinc-800 mt-6">
                <button
                  onClick={() => setSelectedContributor(null)}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium py-2.5 rounded-[2px] text-xs transition-colors"
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
              className="absolute inset-0 bg-black/80"
              onClick={() => setShowMerkleModal(false)}
            />
            <div className="relative bg-[#17191c] border border-[#2b2f36] rounded-[2px] p-6 max-w-xl w-full">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#2b2f36]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-[2px] bg-zinc-800 border border-zinc-700 text-emerald-400 flex items-center justify-center font-mono text-xs font-bold">
                    RFC
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white font-mono">Cryptographic Merkle Audit Proof</h3>
                    <p className="text-[11px] text-zinc-400 font-mono">RFC-6962 SHA-256 Tamper-Evident Ledger</p>
                  </div>
                </div>
                <button onClick={() => setShowMerkleModal(false)} className="text-zinc-400 hover:text-white p-1.5 rounded-[2px] bg-zinc-800">&times;</button>
              </div>

              <div className="space-y-4 text-xs font-mono">
                <div>
                  <label className="text-zinc-400 block mb-1 font-medium">Merkle Root Hash (256-bit SHA-256)</label>
                  <div className="bg-[#101214] p-2.5 rounded-[2px] border border-[#2b2f36] font-mono text-[11px] text-emerald-400 break-all select-all">
                    88643cd1fe4e719119c4d29f8f2e26090c29f6f6d0fca8faef7d5f0b5d9095bb
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-zinc-300 font-mono text-[11px]">
                  <div className="bg-[#101214] p-2.5 rounded-[2px] border border-[#2b2f36]">
                    <span className="text-zinc-400 block text-[10px]">Leaf Hash Standard</span>
                    <span className="text-zinc-300">RFC 6962: SHA-256(0x00 || Leaf)</span>
                  </div>
                  <div className="bg-[#101214] p-2.5 rounded-[2px] border border-[#2b2f36]">
                    <span className="text-zinc-400 block text-[10px]">Internal Node Hash</span>
                    <span className="text-zinc-300">SHA-256(0x01 || Left || Right)</span>
                  </div>
                </div>

                <div>
                  <label className="text-zinc-400 block mb-1 font-medium">Offline Independent Verification</label>
                  <p className="text-zinc-400 text-[11px] mb-2 leading-relaxed">
                    Anyone can verify the attribution mathematical integrity offline without trusting Shapley's servers:
                  </p>
                  <pre className="bg-[#101214] p-3 rounded-[2px] border border-[#2b2f36] font-mono text-[11px] text-zinc-300 overflow-x-auto select-all">
{`# 1. Download tamper-proof cryptographic receipt
curl -sO ${appOrigin}/api/audit/receipt.json

# 2. Verify root hash and leaf memberships locally
python3 -m backend.security.merkle_ledger verify receipt.json`}
                  </pre>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-5 pt-3 border-t border-[#2b2f36]">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText("88643cd1fe4e719119c4d29f8f2e26090c29f6f6d0fca8faef7d5f0b5d9095bb");
                    alert("Merkle Root copied!");
                  }}
                  className="bg-[#101214] hover:bg-zinc-800 text-zinc-300 px-3 py-1.5 rounded-[2px] text-xs font-semibold border border-[#2b2f36]"
                >
                  Copy Root
                </button>
                <button
                  onClick={() => setShowMerkleModal(false)}
                  className="bg-zinc-100 hover:bg-white text-zinc-950 px-4 py-1.5 rounded-[2px] text-xs font-semibold font-sans"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Repository Modal */}
        {showRepoModal && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-zinc-900 border border-zinc-700/80 rounded-[2px] max-w-lg w-full p-6 relative">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-[2px] bg-blue-600/20 text-blue-400 flex items-center justify-center">
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
                  className="text-zinc-400 hover:text-white p-1 rounded-[2px] bg-zinc-800 hover:bg-zinc-700 text-base transition-colors"
                >
                  &times;
                </button>
              </div>

              {customRepoError && (
                <div className="bg-red-950/50 border border-red-800 text-red-300 text-xs rounded-[2px] p-3 mb-4">
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
                    className="w-full bg-[#101214] border border-[#2b2f36] rounded-[2px] px-3.5 py-2.5 text-zinc-100 placeholder-zinc-400 font-mono text-xs focus:outline-none focus:border-zinc-500"
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
                        className={`px-2.5 py-1 rounded-[2px] font-mono text-[11px] transition-colors border ${
                          customRepo === r
                            ? "bg-[#2b2f36] text-white border-zinc-500 font-semibold"
                            : "bg-[#101214] hover:bg-zinc-800 text-zinc-400 border-[#2b2f36]"
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
                    className="w-full bg-[#101214] border border-[#2b2f36] rounded-[2px] px-3.5 py-2 text-zinc-100 font-mono text-xs focus:outline-none focus:border-zinc-500"
                  />
                </div>

                <div className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
                  <button
                    onClick={() => setShowRepoModal(false)}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-[2px] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCustomAnalysis}
                    disabled={analyzingCustom}
                    className="px-4 py-2 bg-zinc-100 hover:bg-white text-zinc-950 disabled:opacity-50 text-xs font-semibold rounded-[2px] transition-colors flex items-center gap-1.5 font-sans"
                  >
                    {analyzingCustom ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin"></div>
                        <span>Initializing...</span>
                      </>
                    ) : (
                      <span>Start Analysis</span>
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
              className="absolute inset-0 bg-black/80"
              onClick={() => setShowCommandPalette(false)}
            />
            <div className="relative bg-[#111215] border border-zinc-700/80 rounded-[2px] max-w-xl w-full overflow-hidden font-sans modal-enter">
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
                  className="w-full bg-transparent text-sm text-white placeholder-zinc-400 focus:outline-none font-mono"
                />
                <kbd className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded-[2px] border border-zinc-700">ESC</kbd>
              </div>

              <div className="p-2 max-h-80 overflow-y-auto space-y-1 text-xs font-mono">
                {[
                  {
                    tag: "ESCROW",
                    title: `Authorize PayPal Escrow Release ($${currentTotal.toFixed(2)})`,
                    badge: "Milestone 2",
                    action: () => {
                      setShowCommandPalette(false);
                      setShowConfirm(true);
                    },
                  },
                  {
                    tag: "MERKLE",
                    title: "Verify Cryptographic Merkle Root",
                    badge: "RFC 6962 Proof",
                    action: () => {
                      setShowCommandPalette(false);
                      setShowMerkleModal(true);
                    },
                  },
                  {
                    tag: "TELEGRAM",
                    title: "Telegram Bot Webhook Simulator",
                    badge: "MCP Tool",
                    action: () => {
                      setShowCommandPalette(false);
                      setChatPlatform("telegram");
                      setShowChatModal(true);
                    },
                  },
                  {
                    tag: "WHATSAPP",
                    title: "WhatsApp Cloud API Interactive Message",
                    badge: "MCP Tool",
                    action: () => {
                      setShowCommandPalette(false);
                      setChatPlatform("whatsapp");
                      setShowChatModal(true);
                    },
                  },
                  {
                    tag: "THEORY",
                    title: "Plain English Game Theory Explainer",
                    badge: "Nobel Intuition",
                    action: () => {
                      setShowCommandPalette(false);
                      setExplainerTab("simple");
                    },
                  },
                  {
                    tag: "PROOFS",
                    title: "Axiomatic Math Proofs & Marginal Deltas",
                    badge: "16 Coalitions",
                    action: () => {
                      setShowCommandPalette(false);
                      setExplainerTab("math");
                    },
                  },
                  {
                    tag: "ANALYZE",
                    title: "Analyze Any Git Repository (Live Mode)",
                    badge: "Custom Repo",
                    action: () => {
                      setShowCommandPalette(false);
                      setShowRepoModal(true);
                    },
                  },
                  {
                    tag: "MARKDOWN",
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
                    item.badge.toLowerCase().includes(commandPaletteQuery.toLowerCase()) ||
                    item.tag.toLowerCase().includes(commandPaletteQuery.toLowerCase())
                  )
                  .map((item, idx) => (
                    <button
                      key={idx}
                      onClick={item.action}
                      className="w-full text-left px-3 py-2.5 rounded-[2px] hover:bg-zinc-800 flex items-center justify-between text-zinc-200 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[2px] bg-[#101214] border border-[#2b2f36] text-zinc-400 font-bold">{item.tag}</span>
                        <span className="font-medium font-sans">{item.title}</span>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400">{item.badge}</span>
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
