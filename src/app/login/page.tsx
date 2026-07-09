"use client";

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
        className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-[#0e1c26] p-8"
      >
        <div>
          <h1 className="text-lg font-semibold text-white">GA4 Simply Layer</h1>
          <p className="text-sm text-[#7f959d]">Enter the dashboard password</p>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-white/10 bg-[#081219] px-3 py-2 text-sm text-white outline-none focus:border-[#6ae499]"
        />
        {error && <p className="text-sm text-[#e66767]">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full rounded-lg bg-[#6ae499] px-4 py-2 text-sm font-semibold text-[#0e1c26] hover:bg-[#57cf86] disabled:opacity-50"
        >
          {busy ? "Checking…" : "Open dashboard"}
        </button>
      </form>
    </main>
  );
}
