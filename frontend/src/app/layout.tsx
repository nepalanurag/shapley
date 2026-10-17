import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import "./motion.css";

const monoFont = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shapley — Game-Theoretic Revenue Ledger",
  description: "Cooperative game theory calculates exact-penny marginal contributions; PayPal Orders v2 executes escrow.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${monoFont.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#0c0d0e] text-[#ededed]">
        {/* Top Ledger Header */}
        <header className="sticky top-0 z-40 w-full border-b border-[#1e2024] bg-[#0c0d0e]">
          <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-7 h-7 bg-[#16181d] border border-[#262930] flex items-center justify-center font-mono font-bold text-white text-xs">
                φ
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-[#ededed]">Shapley</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 bg-[#121316] text-[#8a8f98] border border-[#1e2024]">
                  Ledger v1.0
                </span>
              </div>
            </Link>

            <nav className="flex items-center gap-4 text-xs font-mono">
              <Link href="/" className="text-[#8a8f98] hover:text-[#ededed] transition-colors">
                Analyze
              </Link>
              <Link href="/results?demo=true" className="text-[#8a8f98] hover:text-[#ededed] transition-colors">
                Ledger Demo
              </Link>
              <Link href="/audit?demo=true" className="text-[#8a8f98] hover:text-[#ededed] transition-colors">
                Merkle Audit
              </Link>
              <a
                href="https://github.com/nepalanurag/shapley"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#8a8f98] hover:text-[#ededed] transition-colors"
              >
                Source
              </a>
            </nav>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1">{children}</div>

        {/* Solid Ledger Footer */}
        <footer className="w-full border-t border-[#1e2024] bg-[#0c0d0e] py-6 text-xs text-[#8a8f98] font-mono">
          <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[#ededed] font-bold">Shapley Protocol</span>
              <span>·</span>
              <span>PayPal Orders v2 Escrow &amp; Payouts v1</span>
              <span>·</span>
              <span>RFC 6962 Merkle Tree</span>
            </div>
            <div className="flex items-center gap-4">
              <span>Hare-Niemeyer $0.00 Dust Conservation</span>
              <a
                href="https://github.com/nepalanurag/shapley"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#ededed] underline underline-offset-4"
              >
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
