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
  backgroundColor: "#18181b",
  foregroundColor: "#f4f4f5",
  headerBackgroundColor: "#27272a",
  oddRowBackgroundColor: "#1c1c1f",
  borderColor: "#3f3f46",
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
          p.value.length === 0 ? "(empty)" : p.value.join(" + "),
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
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-zinc-400">Loading audit trail...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Audit Trail</h1>
            <p className="text-zinc-400 mt-1">
              Every AI evaluation the Shapley engine used. Full transparency.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={downloadJSON}
              className="bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-lg text-sm border border-zinc-700 btn-interactive"
            >
              Export JSON
            </button>
            <button
              onClick={downloadCSV}
              className="bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-lg text-sm border border-zinc-700 btn-interactive"
            >
              Export CSV
            </button>
            <button
              onClick={() => router.back()}
              className="bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-lg text-sm border border-zinc-700 btn-interactive"
            >
              Back
            </button>
          </div>
        </div>

        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
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
          {evaluations.length} coalition evaluations. Each score was generated
          by Gemini with temperature 0.1 for consistency. Empty coalition
          always scores 0.
        </p>
      </div>
    </main>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <AuditContent />
    </Suspense>
  );
}
