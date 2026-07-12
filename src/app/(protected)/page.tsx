"use client";

import { ChartBarIcon, PlusIcon, WarningCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ReportPreviewCard from "@/components/ReportPreviewCard";
import type { PresetsFile, ReportConfig } from "@/lib/types";

const UNGROUPED = "Ungrouped";

export default function MegaDashboard() {
  const [presets, setPresets] = useState<PresetsFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/presets")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load presets");
        setPresets(j);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, ReportConfig[]>();
    for (const r of presets?.reports ?? []) {
      const key = r.group?.trim() || UNGROUPED;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    // named groups first (in first-seen order), Ungrouped last
    return [...map.entries()].sort((a, b) => {
      if (a[0] === UNGROUPED) return 1;
      if (b[0] === UNGROUPED) return -1;
      return 0;
    });
  }, [presets]);

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Reports</h1>
        <p className="text-sm text-[#7f959d]">Pick a saved report to open, or create a new one.</p>
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-[#e66767]">
          <WarningCircleIcon size={15} />
          {error}
        </p>
      )}

      {presets && presets.reports.length === 0 && (
        <div className="animate-rise-in flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/15 p-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#6ae499]/30 bg-[#6ae499]/10 text-[#6ae499]">
            <ChartBarIcon size={20} />
          </span>
          <p className="text-[#c2d1d5]">No reports yet.</p>
          <Link
            href="/builder"
            className="focus-ring mt-1 flex items-center gap-1.5 rounded-lg bg-[#6ae499] px-4 py-2 text-sm font-semibold text-[#0e1c26] transition-all duration-150 hover:bg-[#57cf86] active:scale-[0.98]"
          >
            <PlusIcon size={14} weight="bold" />
            Create your first report
          </Link>
        </div>
      )}

      {groups.map(([group, reports]) => (
        <section key={group} className="space-y-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]">
            {group} <span className="tabular-nums">({reports.length})</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {reports.map((r) => (
              <ReportPreviewCard key={r.id} report={r} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
