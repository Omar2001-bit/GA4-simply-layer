"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ChartView from "./ChartView";
import DateControls from "./DateControls";
import NumbersView from "./NumbersView";
import ReportEditor from "./ReportEditor";
import { humanize } from "@/lib/format";
import { useReport } from "@/lib/useReport";
import {
  CHART_TYPES,
  type ChartType,
  type MetadataResponse,
  type PropertySummary,
  type ReportConfig,
} from "@/lib/types";

interface Props {
  initial: ReportConfig;
  startEditing?: boolean;
  lockView?: boolean; // client-share mode: never show edit affordances
  isNew?: boolean; // builder flow: no delete button
}

export default function ReportCanvas({ initial, startEditing = false, lockView = false, isNew = false }: Props) {
  const router = useRouter();
  const [config, setConfig] = useState<ReportConfig>(initial);
  const [editing, setEditing] = useState(startEditing && !lockView);
  const [chartType, setChartType] = useState<ChartType>(initial.chartType);
  const [metricIndex, setMetricIndex] = useState(0);
  const [properties, setProperties] = useState<PropertySummary[]>([]);
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const { data, error, loading } = useReport(config);

  useEffect(() => setChartType(config.chartType), [config.chartType]);
  useEffect(() => {
    if (metricIndex >= config.metrics.length) setMetricIndex(0);
  }, [config.metrics, metricIndex]);

  // load properties + metadata lazily (editor needs them; view mode benefits from pretty names)
  useEffect(() => {
    fetch("/api/properties")
      .then((r) => r.json())
      .then((j) => setProperties(j.properties ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!config.property) return;
    fetch(`/api/metadata?property=${config.property}`)
      .then((r) => r.json())
      .then((j) => setMetadata(j.dimensions ? j : null))
      .catch(() => {});
  }, [config.property]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, chartType }),
      });
      if (res.ok) setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm(`Delete report "${config.name}"?`)) return;
    await fetch(`/api/presets?id=${config.id}`, { method: "DELETE" });
    router.push("/");
  };

  const metricName = (i: number) =>
    metadata?.metrics.find((m) => m.apiName === config.metrics[i])?.uiName ?? humanize(config.metrics[i] ?? "");

  return (
    <div className="space-y-4">
      {/* header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">{config.name}</h1>
          {config.description && <p className="text-sm text-[#7f959d]">{config.description}</p>}
        </div>
        {!lockView && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              editing
                ? "bg-[#6ae499] text-[#0e1c26] hover:bg-[#57cf86]"
                : "border border-white/10 text-[#c2d1d5] hover:border-white/25"
            }`}
          >
            {editing ? "Done — view mode" : "Edit report"}
          </button>
        )}
      </div>

      {/* date controls always live, even in view mode */}
      <div className="rounded-xl border border-white/10 bg-[#0e1c26] px-4 py-3">
        <DateControls
          rangeA={config.rangeA}
          rangeB={config.rangeB}
          onChange={(rangeA, rangeB) => setConfig((c) => ({ ...c, rangeA, rangeB }))}
        />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {editing && (
          <ReportEditor
            config={config}
            onChange={setConfig}
            properties={properties}
            metadata={metadata}
            onSave={save}
            onDelete={isNew ? undefined : del}
            saving={saving}
            savedAt={savedAt}
          />
        )}

        <div className="min-w-0 flex-1 space-y-4">
          {/* Section 1: Graph view */}
          <section className="rounded-xl border border-white/10 bg-[#0e1c26] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#7f959d]">Graph view</h2>
              <div className="flex flex-wrap items-center gap-2">
                {config.metrics.length > 1 && (
                  <select
                    value={metricIndex}
                    onChange={(e) => setMetricIndex(Number(e.target.value))}
                    className="rounded-lg border border-white/10 bg-[#081219] px-2 py-1 text-xs text-white outline-none"
                  >
                    {config.metrics.map((m, i) => (
                      <option key={m} value={i}>
                        {metricName(i)}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex overflow-hidden rounded-lg border border-white/10">
                  {CHART_TYPES.filter((c) => c.value !== "table" && c.value !== "scorecard").map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setChartType(c.value)}
                      className={`px-2.5 py-1 text-xs transition-colors ${
                        chartType === c.value
                          ? "bg-[#6ae499] text-[#0e1c26]"
                          : "text-[#7f959d] hover:bg-white/5 hover:text-[#c2d1d5]"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="relative">
              {loading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[#0e1c26]/60">
                  <span className="text-sm text-[#7f959d]">Loading…</span>
                </div>
              )}
              {error ? (
                <div className="flex h-64 items-center justify-center text-sm text-[#e66767]">{error}</div>
              ) : data ? (
                <ChartView data={data} chartType={chartType} metricIndex={metricIndex} height={340} />
              ) : (
                <div className="h-64" />
              )}
            </div>
          </section>

          {/* Section 2: Numbers view */}
          <section className="rounded-xl border border-white/10 bg-[#020601] p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#7f959d]">Numbers view</h2>
            {data ? (
              <NumbersView data={data} metricsMeta={metadata?.metrics} />
            ) : (
              <div className="h-24" />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
