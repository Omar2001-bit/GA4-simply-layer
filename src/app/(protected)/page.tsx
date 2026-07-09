"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DashboardCard from "@/components/DashboardCard";
import { RANGE_PRESETS } from "@/lib/dates";
import type { CompareSel, DateRangeSel, PresetsFile, RangePreset } from "@/lib/types";

export default function MegaDashboard() {
  const [presets, setPresets] = useState<PresetsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // global date override: "" = each report uses its own saved dates
  const [globalPreset, setGlobalPreset] = useState<string>("");

  useEffect(() => {
    fetch("/api/presets")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Failed to load presets");
        setPresets(j);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const globalRangeA: DateRangeSel | null = globalPreset
    ? { preset: globalPreset as RangePreset }
    : null;
  const globalRangeB: CompareSel | null = globalPreset ? { preset: "previousPeriod" } : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Mega dashboard</h1>
          <p className="text-sm text-[#7f959d]">
            All saved reports at a glance — click a report to zoom in.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-[#7f959d]">
          Dates:
          <select
            value={globalPreset}
            onChange={(e) => setGlobalPreset(e.target.value)}
            className="rounded-lg border border-white/10 bg-[#0e1c26] px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#6ae499]"
          >
            <option value="">Per-report saved dates</option>
            {RANGE_PRESETS.filter((p) => p.value !== "custom").map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} (vs previous)
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="text-sm text-[#e66767]">{error}</p>}

      {presets && presets.reports.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/15 p-12 text-center">
          <p className="text-[#c2d1d5]">No reports yet.</p>
          <Link
            href="/builder"
            className="mt-3 inline-block rounded-lg bg-[#6ae499] px-4 py-2 text-sm font-semibold text-[#0e1c26] hover:bg-[#57cf86]"
          >
            Create your first report
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {presets?.reports.map((r) => (
          <DashboardCard
            key={r.id}
            report={r}
            globalRangeA={globalRangeA}
            globalRangeB={globalRangeB}
          />
        ))}
      </div>
    </div>
  );
}
