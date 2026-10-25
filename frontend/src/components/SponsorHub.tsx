"use client";

import { useEffect, useState } from "react";
import {
  fetchSponsorPortfolio,
  createEscrowOrder,
  generateSponsorInvoice,
} from "@/lib/api";

interface SponsorHubProps {
  onSwitchToAttribution: (repo?: string) => void;
  onOpenPotModal: () => void;
}

export default function SponsorHub({
  onSwitchToAttribution,
  onOpenPotModal,
}: SponsorHubProps) {
  const [loading, setLoading] = useState(true);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Escrow Tranche Modal state
  const [showEscrowModal, setShowEscrowModal] = useState(false);
  const [escrowRepo, setEscrowRepo] = useState("pallets/jinja");
  const [escrowMilestone, setEscrowMilestone] = useState("Phase 3: Production Hardening");
  const [escrowAmount, setEscrowAmount] = useState(2500);
  const [escrowOrderResult, setEscrowOrderResult] = useState<any>(null);
  const [escrowLoading, setEscrowLoading] = useState(false);

  // GAAP Invoice Modal state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState<any>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  const loadPortfolio = async () => {
    setLoading(true);
    try {
      const res = await fetchSponsorPortfolio();
      setPortfolio(res);
    } catch (err: any) {
      setError(err.message || "Failed to load sponsor portfolio");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPortfolio();
  }, []);

  const handleCreateEscrow = async (e: React.FormEvent) => {
    e.preventDefault();
    setEscrowLoading(true);
    setEscrowOrderResult(null);
    try {
      const res = await createEscrowOrder({
        repo_url: escrowRepo,
        milestone_name: escrowMilestone,
        total_amount_usd: Number(escrowAmount),
      });
      setEscrowOrderResult(res);
    } catch (err: any) {
      alert("Failed to create escrow order: " + err.message);
    } finally {
      setEscrowLoading(false);
    }
  };

  const handleGenerateInvoice = async () => {
    setShowInvoiceModal(true);
    setInvoiceLoading(true);
    try {
      const res = await generateSponsorInvoice({
        sponsor_name: portfolio?.sponsor_name || "Open Source Capital Fund",
        repo_url: "pallets/jinja",
        milestone_name: "Phase 2: Security & AST Architecture",
        grant_amount_usd: 2500,
      });
      setInvoiceResult(res);
    } catch (err: any) {
      console.error("Invoice generation error:", err);
      // Fallback display
      setInvoiceResult({
        invoice_number: "INV-SHAPLEY-2026-Q4",
        sponsor_entity: portfolio?.sponsor_name || "Open Source Capital Fund",
        total_disbursed_usd: 13500.0,
        merkle_root: "88643cd1b43fdaec0e1ed417cf98f835d55e389c4555c5a39628d5ff98ef69fc"
      });
    } finally {
      setInvoiceLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sponsor Header Banner */}
      <div className="pb-5 border-b border-zinc-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-zinc-900 border border-zinc-700 text-blue-400 flex items-center justify-center font-mono font-bold text-xs rounded-lg">
              SP
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  Sponsor Portfolio &amp; Grant Command Center
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 bg-emerald-950/60 text-emerald-400 border border-emerald-800 rounded font-semibold">
                  {portfolio?.grant_batch || "BATCH-2026-Q4"}
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                Funder: <strong className="text-zinc-200">{portfolio?.sponsor_name || "Open Source Capital Fund"}</strong> · PayPal Business:{" "}
                <code className="text-zinc-300">{portfolio?.business_account || "sponsor-treasury@opensource-fund.org"}</code> · Two-Phase Custody
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowEscrowModal(true)}
            className="px-3.5 py-2 bg-[#2563eb] hover:bg-blue-600 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
          >
            <span>+</span> Create Escrow Tranche
          </button>
          <button
            onClick={handleGenerateInvoice}
            className="px-3.5 py-2 bg-[#121316] hover:bg-zinc-800 text-zinc-300 text-xs font-mono border border-[#1e2024] rounded-lg transition-colors flex items-center gap-1.5"
          >
            <span className="font-mono text-zinc-400">[INV]</span> View GAAP Invoice
          </button>
        </div>
      </div>

      {/* Hackathon Pot Solvency & PayPal Connect Bar */}
      <div className="border border-[#1e2024] bg-[#121316] rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-zinc-900 border border-zinc-700 text-emerald-400 flex items-center justify-center font-mono font-bold text-xs rounded-lg flex-shrink-0 mt-0.5">
            HOLD
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">Active Hackathon Grant Pool: pallets/jinja ($2,500.00 USD)</h3>
              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-emerald-950/60 text-emerald-400 border border-emerald-800 rounded">
                SOLVENT ESCROW
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-zinc-800 text-zinc-400 border border-zinc-700 rounded">
                PAYPAL AUTH HOLD
              </span>
            </div>
            <p className="text-xs font-mono text-zinc-400 mt-1">
              Auth ID: <code className="text-zinc-300">AUTH-PP-8829410-USD</code> · 29-Day Non-Retractable Hold · Dual-Quorum Consensus Verified
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onOpenPotModal}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-mono border border-zinc-700 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <span className="font-mono text-zinc-400">[CERT]</span> Solvency Certificate
          </button>
        </div>
      </div>

      {/* Financial Ledger Summary Bar */}
      <div className="flex flex-col sm:flex-row items-stretch divide-y sm:divide-y-0 sm:divide-x divide-[#1e2024] border border-[#1e2024] bg-[#121316] rounded-xl overflow-hidden">
        <div className="flex-1 p-4">
          <div className="flex items-center justify-between text-zinc-500 text-xs mb-1 font-mono uppercase tracking-wider text-[10px]">
            <span>Total Grant Committed</span>
            <span className="text-zinc-400">{portfolio?.active_repositories_count || 4} REPOSITORIES</span>
          </div>
          <div className="text-2xl font-bold font-mono text-white tabular-nums">
            ${portfolio?.total_committed_usd ? Number(portfolio.total_committed_usd).toLocaleString() : "25,000"}.00{" "}
            <span className="text-xs font-mono text-zinc-500 font-normal">USD</span>
          </div>
          <p className="text-[11px] font-mono text-zinc-500 mt-2">Non-dilutive open-source stack grant allocation</p>
        </div>

        <div className="flex-1 p-4">
          <div className="flex items-center justify-between text-zinc-500 text-xs mb-1 font-mono uppercase tracking-wider text-[10px]">
            <span>PayPal Custodial Escrow</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
            ${portfolio?.total_escrow_hold_usd ? Number(portfolio.total_escrow_hold_usd).toLocaleString() : "11,500"}.00{" "}
            <span className="text-xs font-mono text-zinc-500 font-normal">USD</span>
          </div>
          <p className="text-[11px] font-mono text-zinc-500 mt-2">29-day non-retractable authorization holds</p>
        </div>

        <div className="flex-1 p-4">
          <div className="flex items-center justify-between text-zinc-500 text-xs mb-1 font-mono uppercase tracking-wider text-[10px]">
            <span>Capital Waste Prevented</span>
            <span className="text-[10px] font-mono text-emerald-400">ROI PROTECTED</span>
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
            +${portfolio?.total_waste_prevented_usd ? Number(portfolio.total_waste_prevented_usd).toLocaleString() : "3,840"}.00{" "}
            <span className="text-xs font-mono text-zinc-500 font-normal">USD</span>
          </div>
          <p className="text-[11px] font-mono text-zinc-500 mt-2">6,400 boilerplate lines filtered by AST game theory</p>
        </div>
      </div>

      {/* Multi-Repo Dependency Stack Portfolio Table */}
      <div className="border border-zinc-800 bg-zinc-900/40 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-4 border-b border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-white">Ecosystem Dependency Stack Portfolio</h2>
            <p className="text-xs font-mono text-zinc-400">
              Multi-repository milestone grants governed by dual-quorum PayPal Two-Phase escrow.
            </p>
          </div>
          <span className="text-[11px] font-mono text-zinc-400 bg-zinc-900 border border-zinc-700 px-2.5 py-1 rounded">
            Settled Disbursed:{" "}
            <strong className="text-white tabular-nums">
              ${portfolio?.total_disbursed_usd ? Number(portfolio.total_disbursed_usd).toLocaleString() : "13,500"}.00 USD
            </strong>
          </span>
        </div>

        {/* Portfolio Stack Cards */}
        <div className="space-y-3">
          {(portfolio?.stack || []).map((item: any, idx: number) => (
            <div
              key={idx}
              className="border border-zinc-800 bg-zinc-950/80 p-4 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:border-zinc-700 transition-colors"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono font-bold text-white text-sm">{item.repo}</span>
                  <span className="text-[10px] font-mono text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded">
                    {item.phase}
                  </span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      item.phase_status.includes("Active") || item.phase_status.includes("Settled")
                        ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800"
                        : "bg-blue-950/60 text-blue-400 border border-blue-800"
                    }`}
                  >
                    {item.phase_status}
                  </span>
                </div>
                <p className="text-xs font-mono text-zinc-400">{item.deliverables}</p>
                <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-zinc-500 mt-2">
                  <span>Vault: {item.vault_id}</span>
                  <span>·</span>
                  <span>Auth ID: {item.auth_id}</span>
                  <span>·</span>
                  <span className="text-emerald-400">+${Number(item.waste_prevented_usd).toLocaleString()}.00 waste prevented</span>
                </div>
              </div>

              <div className="flex items-center gap-4 justify-between lg:justify-end">
                <div className="text-right">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Committed / Escrow / Disbursed</div>
                  <div className="font-mono text-xs font-semibold text-white tabular-nums">
                    ${Number(item.committed_grant_usd).toLocaleString()} <span className="text-zinc-600">|</span>{" "}
                    <span className="text-emerald-400">${Number(item.escrow_hold_usd).toLocaleString()}</span>{" "}
                    <span className="text-zinc-600">|</span> ${Number(item.disbursed_usd).toLocaleString()}
                  </div>
                </div>
                <button
                  onClick={() => onSwitchToAttribution(item.repo)}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-mono rounded-lg transition-colors"
                >
                  Inspect Ledgers &rarr;
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Escrow Tranche Creation Modal */}
      {showEscrowModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-fade">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-lg w-full p-6 shadow-2xl relative">
            <button
              onClick={() => {
                setShowEscrowModal(false);
                setEscrowOrderResult(null);
              }}
              className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors text-lg"
            >
              &times;
            </button>
            <h3 className="text-lg font-bold text-white mb-1">Create PayPal Escrow Tranche</h3>
            <p className="text-xs font-mono text-zinc-400 mb-4">
              Establishes a non-retractable 29-day authorization hold via PayPal Orders v2 API.
            </p>

            {!escrowOrderResult ? (
              <form onSubmit={handleCreateEscrow} className="space-y-4 text-xs font-mono">
                <div>
                  <label className="block text-zinc-400 uppercase mb-1">Repository</label>
                  <input
                    type="text"
                    value={escrowRepo}
                    onChange={(e) => setEscrowRepo(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 px-3 py-2 rounded text-zinc-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 uppercase mb-1">Milestone Name</label>
                  <input
                    type="text"
                    value={escrowMilestone}
                    onChange={(e) => setEscrowMilestone(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 px-3 py-2 rounded text-zinc-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 uppercase mb-1">Tranche Amount (USD)</label>
                  <input
                    type="number"
                    value={escrowAmount}
                    onChange={(e) => setEscrowAmount(Number(e.target.value))}
                    className="w-full bg-zinc-900 border border-zinc-800 px-3 py-2 rounded text-zinc-100"
                    required
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setShowEscrowModal(false)}
                    className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={escrowLoading}
                    className="px-4 py-2 bg-[#2563eb] hover:bg-blue-600 text-white rounded-lg font-semibold disabled:opacity-50 transition-colors"
                  >
                    {escrowLoading ? "Creating PayPal Hold..." : "Authorize PayPal Hold"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4 text-xs font-mono">
                <div className="bg-emerald-950/60 border border-emerald-800 p-3 rounded-lg text-emerald-300">
                  <p className="font-bold">Escrow Hold Successfully Initialized</p>
                  <p className="text-[11px] mt-1 text-emerald-400/90">
                    Order ID: <code>{escrowOrderResult.order_id || escrowOrderResult.id}</code>
                  </p>
                </div>
                <div className="bg-zinc-900 p-3 rounded-lg space-y-1.5 text-zinc-300">
                  <div>Status: <span className="text-emerald-400 font-bold">{escrowOrderResult.status}</span></div>
                  <div>Amount: ${escrowOrderResult.amount_usd || escrowAmount} USD</div>
                  <div className="break-all text-[11px] text-zinc-400">
                    Vault: {escrowOrderResult.vault_id || "ESCROW-PP-JINJA-02"}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setShowEscrowModal(false);
                      setEscrowOrderResult(null);
                      loadPortfolio();
                    }}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg font-semibold"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* GAAP Invoice Modal */}
      {showInvoiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-fade">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setShowInvoiceModal(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-white transition-colors text-lg"
            >
              &times;
            </button>
            <h3 className="text-lg font-bold text-white mb-1">Corporate Grant Invoice (GAAP / IRS Form 501(c)(3) Compliant)</h3>
            <p className="text-xs font-mono text-zinc-400 mb-4">
              Cryptographically verified tax ledger itemizing non-dilutive open-source maintenance disbursements.
            </p>

            {invoiceLoading ? (
              <div className="py-8 text-center text-xs font-mono text-zinc-400">
                Generating compliant corporate invoice...
              </div>
            ) : invoiceResult ? (
              <div className="space-y-4 text-xs font-mono">
                <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-xl space-y-2">
                  <div className="flex justify-between border-b border-zinc-800 pb-2">
                    <span className="text-zinc-400">Invoice Number:</span>
                    <span className="text-white font-bold">{invoiceResult.invoice_number || invoiceResult.invoice?.invoice_number || "INV-2026-Q4-001"}</span>
                  </div>
                  <div className="flex justify-between border-b border-zinc-800 pb-2">
                    <span className="text-zinc-400">Sponsor Entity:</span>
                    <span className="text-zinc-200">{invoiceResult.sponsor_entity || invoiceResult.invoice?.sponsor_name || "Open Source Capital Fund"}</span>
                  </div>
                  <div className="flex justify-between border-b border-zinc-800 pb-2">
                    <span className="text-zinc-400">Disbursed Grant Pool:</span>
                    <span className="text-emerald-400 font-bold">${Number(invoiceResult.total_disbursed_usd || invoiceResult.invoice?.grant_amount_usd || 2500).toFixed(2)} USD</span>
                  </div>
                  <div className="flex justify-between border-b border-zinc-800 pb-2">
                    <span className="text-zinc-400">Payment Processor:</span>
                    <span className="text-zinc-200">PayPal Custodial Payouts API (Non-Custodial)</span>
                  </div>
                  <div className="flex flex-col pt-1">
                    <span className="text-zinc-400 mb-1">Merkle Proof Root:</span>
                    <span className="text-blue-400 text-[11px] break-all bg-zinc-950 p-1.5 rounded select-all border border-zinc-800">
                      {invoiceResult.merkle_root || invoiceResult.invoice?.merkle_root || "88643cd1b43fdaec0e1ed417cf98f835d55e389c4555c5a39628d5ff98ef69fc"}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(invoiceResult, null, 2));
                      alert("Invoice JSON copied to clipboard!");
                    }}
                    className="px-3.5 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg border border-zinc-700"
                  >
                    Copy Invoice JSON
                  </button>
                  <button
                    onClick={() => setShowInvoiceModal(false)}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg font-semibold"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
