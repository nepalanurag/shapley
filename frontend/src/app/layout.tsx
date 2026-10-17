import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import "./motion.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shapley — Fair Revenue Splits",
  description: "AI evaluates contributions, game theory calculates fair shares, PayPal executes payouts.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        {/* Sticky Top Navbar */}
        <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20 text-sm group-hover:scale-105 transition-transform">
                φ
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-white">Shapley</span>
                <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                  Protocol v1.0
                </span>
              </div>
            </Link>

            <nav className="flex items-center gap-4 text-xs font-medium">
              <Link href="/" className="text-zinc-300 hover:text-white transition-colors">
                Analyze
              </Link>
              <Link href="/results?demo=true" className="text-zinc-300 hover:text-white transition-colors">
                Live Demo
              </Link>
              <Link href="/audit?demo=true" className="text-zinc-300 hover:text-white transition-colors">
                Audit Trail
              </Link>
              <a
                href="https://github.com/nepalanurag/shapley"
                target="_blank"
                rel="noreferrer"
                className="hidden sm:flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                GitHub
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
              <div className="hidden md:flex items-center gap-2 text-[11px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-full">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                PayPal Sandbox Ready
              </div>
            </nav>
          </div>
        </header>

        <div className="flex-1">
          {children}
        </div>

        {/* Global Footer */}
        <footer className="border-t border-zinc-800/80 bg-zinc-950 py-8 text-xs text-zinc-500">
          <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-zinc-400">Shapley</span>
              <span>•</span>
              <span>Fair Open-Source & Multi-Agent Revenue Splits</span>
            </div>
            <div className="flex items-center gap-4 text-zinc-400">
              <span>Autonomous Revenue Infrastructure</span>
              <span>•</span>
              <a href="https://github.com/nepalanurag/shapley" target="_blank" rel="noreferrer" className="hover:text-zinc-200 underline">
                GitHub Repo
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
