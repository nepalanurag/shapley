import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import "./motion.css";

// One type family for the whole app: Inter carries display and body;
// its tabular figures (enabled in globals.css) carry the numbers.
const sansFont = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
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
      className={`${sansFont.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#101214] text-[#f4f5f6]">
        {/* Top Ledger Header */}
        <header className="sticky top-0 z-40 w-full border-b border-[#2b2f36] bg-[#101214]">
          <div className="max-w-6xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 sm:gap-3 shrink-0">
              <div className="w-6 h-6 sm:w-7 sm:h-7 bg-[#17191c] border border-[#2b2f36] flex items-center justify-center font-bold text-white text-xs">
                φ
              </div>
              <span className="font-bold text-sm tracking-tight text-[#f4f5f6]">Shapley</span>
            </Link>

            <nav className="flex items-center gap-2 sm:gap-4 text-[11px] sm:text-xs shrink-0">
              <Link href="/" className="text-[#a9b0ba] hover:text-[#f4f5f6] transition-colors whitespace-nowrap">
                <span className="sm:hidden">New</span>
                <span className="hidden sm:inline">New Analysis</span>
              </Link>
              <Link href="/results?demo=true" className="text-[#a9b0ba] hover:text-[#f4f5f6] transition-colors whitespace-nowrap">
                <span className="sm:hidden">Demo</span>
                <span className="hidden sm:inline">Demo Results</span>
              </Link>
              <Link href="/audit?demo=true" className="text-[#a9b0ba] hover:text-[#f4f5f6] transition-colors whitespace-nowrap">
                <span className="sm:hidden">Audit</span>
                <span className="hidden sm:inline">Merkle Audit</span>
              </Link>
              <a
                href="https://github.com/nepalanurag/shapley"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#a9b0ba] hover:text-[#f4f5f6] transition-colors whitespace-nowrap"
              >
                Source
              </a>
            </nav>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1">{children}</div>

        {/* Solid Ledger Footer */}
        <footer className="w-full border-t border-[#2b2f36] bg-[#101214] py-6 text-xs text-[#a9b0ba]">
          <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[#f4f5f6] font-bold">Shapley Protocol</span>
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
                className="hover:text-[#f4f5f6] underline underline-offset-4"
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
