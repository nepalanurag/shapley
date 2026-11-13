"use client";

import { PROVIDERS, type AiProvider, type ByokState } from "@/lib/byok";

/** Bring-your-own-key fields, shared by the home page and the
    "Analyze Another Repo" modal on the results page.
    The key lives only in this browser (localStorage) and is sent only
    with the analyze request; it is never stored on the server. */
export default function ByokFields({ byok }: { byok: ByokState }) {
  const selected = PROVIDERS.find((p) => p.id === byok.provider) ?? PROVIDERS[0];
  return (
    <div className="bg-[#121316] border border-[#1e2024] rounded-lg p-4 mb-6">
      <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={byok.enabled}
          onChange={(e) => byok.setEnabled(e.target.checked)}
          className="accent-zinc-100 w-4 h-4"
        />
        <span className="font-medium">Use my own AI key</span>
        <span className="text-xs text-zinc-500">
          (the built-in key is free-tier and rate limited)
        </span>
      </label>

      {byok.enabled && (
        <div className="mt-3 space-y-3 animate-fade">
          <div className="flex gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => byok.setProvider(p.id as AiProvider)}
                className={`px-3 py-1.5 rounded border text-xs font-mono transition-colors ${
                  byok.provider === p.id
                    ? "bg-[#2b2f36] text-white border-zinc-500 font-semibold"
                    : "bg-[#101214] hover:bg-zinc-800 text-zinc-400 border-[#2b2f36]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="password"
            value={byok.apiKey}
            onChange={(e) => byok.setApiKey(e.target.value)}
            placeholder={selected.placeholder}
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-[#101214] border border-[#2b2f36] rounded px-3.5 py-2.5 text-zinc-100 placeholder-zinc-500 font-mono text-xs focus:outline-none focus:border-zinc-500"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Your key stays in this browser and is sent only with your
              analysis request. It is never stored on Shapley&apos;s servers.{" "}
              <a
                href={selected.getKeyUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:text-blue-300 underline"
              >
                Get a {selected.label} key &rarr;
              </a>
            </p>
            {byok.apiKey && (
              <button
                type="button"
                onClick={byok.clear}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 underline whitespace-nowrap"
              >
                Forget saved key
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
