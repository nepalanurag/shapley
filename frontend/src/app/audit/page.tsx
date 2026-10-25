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
import { fetchDemo, pollAnalysis, Evaluation } from "@/lib/api";

ModuleRegistry.registerModules([AllCommunityModule]);

const darkTheme = themeQuartz.withParams({
  backgroundColor: "#0c0d0e",
  foregroundColor: "#ededed",
  headerBackgroundColor: "#121316",
  oddRowBackgroundColor: "#0f1012",
  borderColor: "#1e2024",
  headerFontFamily: "var(--font-mono)",
  cellFontFamily: "var(--font-mono)",
  accentColor: "#2563eb",
});

function AuditContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        if (params.get("demo") === "true") {
          const d = await fetchDemo();
          setEvaluations(d.evaluations);
        } else if (params.get("job")) {
          const j = await pollAnalysis(params.get("job")!);
          setEvaluations(j.evaluations || []);
        }
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    };
    load();
  }, [params]);

  const cols: ColDef<Evaluation>[] = useMemo(
    () => [
      {
        field: "members",
        headerName: "Coalition",
        flex: 1,
        valueFormatter: (p) =>
          (p.value && p.value.length > 0) ? p.value.join(" + ") : "(empty)",
        sortable: true,
        filter: true,
      },
      {
        field: "score",
        headerName: "AI Score",
        width: 110,
        sortable: true,
        cellStyle: (p) => ({
          fontWeight: "bold",
          color: p.value >= 70 ? "#34d399" : p.value >= 40 ? "#fbbf24" : "#f87171",
        }),
      },
      {
        field: "confidence",
        headerName: "Confidence",
        width: 120,
        sortable: true,
        valueFormatter: (p) => `${(Number(p.value) * 100).toFixed(0)}%`,
      },
      {
        field: "scoring_mode",
        headerName: "Scoring Mode",
        width: 170,
        sortable: true,
        valueFormatter: (p) =>
          p.value === "heuristic_fallback" ? "⚠ Heuristic fallback" : "AI semantic",
        cellStyle: (p) => ({
          color: p.value === "heuristic_fallback" ? "#f87171" : "#a1a1aa",
          fontWeight: p.value === "heuristic_fallback" ? "bold" : "normal",
        }),
      },
      {
        field: "rubric",
        headerName: "Rubric (C/I/O/U)",
        width: 180,
        valueFormatter: (p) => {
          const r = p.value;
          if (!r) return "—";
          return `${r.complexity}/${r.impact}/${r.originality}/${r.unblocking}`;
        },
        tooltipValueGetter: (p) =>
          "Complexity / Impact / Originality / Unblocking (each 0-25)",
      },
      {
        field: "reasoning",
        headerName: "AI Reasoning",
        flex: 2,
        wrapText: true,
        autoHeight: true,
      },
    ],
    []
  );

  const downloadJSON = () => {
    const blob = new Blob([JSON.stringify(evaluations, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shapley-audit.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCSV = () => {
    const headers = "Coalition,AI Score,Confidence,Reasoning\n";
    const rows = evaluations.map((e) => {
      const coalition = e.members.length === 0 ? "(empty)" : `"${e.members.join(" + ")}"`;
      const reasoning = `"${e.reasoning.replace(/"/g, '""')}"`;
      return `${coalition},${e.score},${e.confidence},${reasoning}`;
    }).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shapley-audit.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0c0d0e] text-[#ededed] flex items-center justify-center">
        <p className="text-zinc-400 font-mono text-sm">Loading audit trail...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0c0d0e] text-[#ededed]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Audit Trail</h1>
            <p className="text-zinc-400 mt-1 text-sm font-mono">
              Cryptographic evaluation log across all coalitions.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={downloadJSON}
              className="bg-[#121316] hover:bg-zinc-800 text-zinc-200 px-4 py-2 rounded-lg text-xs font-mono border border-[#1e2024] btn-interactive transition-colors"
            >
              Export JSON
            </button>
            <button
              onClick={downloadCSV}
              className="bg-[#121316] hover:bg-zinc-800 text-zinc-200 px-4 py-2 rounded-lg text-xs font-mono border border-[#1e2024] btn-interactive transition-colors"
            >
              Export CSV
            </button>
            <button
              onClick={() => router.back()}
              className="bg-[#121316] hover:bg-zinc-800 text-zinc-200 px-4 py-2 rounded-lg text-xs font-mono border border-[#1e2024] btn-interactive transition-colors"
            >
              Back
            </button>
          </div>
        </div>

        <div className="bg-[#121316] rounded-xl border border-[#1e2024] p-4">
          <div className="ag-theme-quartz" style={{ height: 600 }}>
            <AgGridReact
              theme={darkTheme}
              rowData={evaluations}
              columnDefs={cols}
              defaultColDef={{ resizable: true, sortable: true }}
              pagination={true}
              paginationPageSize={20}
            />
          </div>
        </div>

        <p className="text-xs text-zinc-500 mt-4">
          {evaluations.length} coalition evaluations.{" "}
          {evaluations.some((e) => e.scoring_mode === "heuristic_fallback") ? (
            <span className="text-red-400">
              ⚠ {evaluations.filter((e) => e.scoring_mode === "heuristic_fallback").length}{" "}
              of these scores used the heuristic fallback (Gemini unavailable):
              they are objective line/branch metrics, NOT AI semantic
              evaluations, and are flagged in the Scoring Mode column.
            </span>
          ) : (
            <>Each score was generated by Gemini with temperature 0.1 for consistency.</>
          )}{" "}
          Empty coalition always scores 0.
        </p>
      </div>
    </main>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0c0d0e]" />}>
      <AuditContent />
    </Suspense>
  );
}
