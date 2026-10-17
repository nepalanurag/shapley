"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

function CallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const code = params.get("code");
    if (!code) {
      setError("No authorization code received from GitHub.");
      return;
    }

    const exchange = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/github/oauth-callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) {
          const err = await res.json();
          setError(err.detail || "GitHub authorization failed.");
          return;
        }
        const data = await res.json();
        sessionStorage.setItem("gh_session", data.session_id);
        sessionStorage.setItem("gh_user", data.username);
        router.push("/");
      } catch {
        setError("Could not complete GitHub authorization.");
      }
    };
    exchange();
  }, [params, router]);

  return (
    <main className="min-h-screen bg-[#0c0d0e] text-zinc-100 flex items-center justify-center font-mono">
      <div className="text-center animate-rise">
        {error ? (
          <>
            <p className="text-red-400 mb-4">{error}</p>
            <button
              onClick={() => router.push("/")}
              className="bg-zinc-800 hover:bg-zinc-700 px-6 py-2 rounded-lg btn-interactive"
            >
              Back
            </button>
          </>
        ) : (
          <>
            <div className="w-10 h-10 mx-auto mb-4 rounded-full border-2 border-zinc-700 border-t-zinc-200 animate-spin" />
            <p className="text-zinc-400">Connecting your GitHub account...</p>
          </>
        )}
      </div>
    </main>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <CallbackContent />
    </Suspense>
  );
}
