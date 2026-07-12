"use client";

import { ChartLineUpIcon, CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) router.push("/");
    else setError("Wrong password");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#020601] px-4">
      <form
        onSubmit={submit}
        className="animate-rise-in w-full max-w-sm space-y-5 rounded-2xl border border-white/10 bg-[#0e1c26] p-8"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#6ae499]/15 text-[#6ae499]">
            <ChartLineUpIcon size={20} weight="bold" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-white">GA4 Simply Layer</h1>
            <p className="text-sm text-[#7f959d]">Enter the dashboard password</p>
          </div>
        </div>
        <div>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password…"
            className="focus-ring w-full rounded-lg border border-white/10 bg-[#081219] px-3 py-2 text-sm text-white transition-colors duration-150 hover:border-white/20 focus:border-[#6ae499]"
          />
          {error && (
            <p className="animate-fade-in mt-2 flex items-center gap-1.5 text-sm text-[#e66767]">
              <WarningCircleIcon size={14} />
              {error}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={busy || !password}
          className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#6ae499] px-4 py-2 text-sm font-semibold text-[#0e1c26] transition-all duration-150 hover:bg-[#57cf86] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
        >
          {busy && <CircleNotchIcon size={14} className="animate-spin" />}
          {busy ? "Checking…" : "Open dashboard"}
        </button>
      </form>
    </main>
  );
}
