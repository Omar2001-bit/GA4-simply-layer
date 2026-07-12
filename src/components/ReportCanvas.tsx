"use client";

import { ArrowLeftIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AnalyticsView from "./AnalyticsView";
import DateControls from "./DateControls";
import MetricCarousel from "./MetricCarousel";
import NumbersView from "./NumbersView";
import ReportEditor from "./ReportEditor";
import { useReport } from "@/lib/useReport";
import {
  CHART_TYPES,
  configDimensions,
  type ChartType,
  type MetadataResponse,
  type PropertySummary,
  type ReportConfig,
} from "@/lib/types";

interface Props {
  initial: ReportConfig;
  startEditing?: boolean; // client-share mode: never show edit affordances
  lockView?: boolean; // client-share mode: never show edit affordances
  isNew?: boolean; // builder flow: no delete button
  backHref?: string; // where the back button leads
}

export default function ReportCanvas({
  initial,
  startEditing = false,
  lockView = false,
  isNew = false,
  backHref = "/",
}: Props) {
  const router = useRouter();
  const [config, setConfig] = useState<ReportConfig>(initial);
  const [editing, setEditing] = useState(startEditing && !lockView);
  const [chartType, setChartType] = useState<ChartType>(initial.chartType);
  const [properties, setProperties] = useState<PropertySummary[]>([]);
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Numbers view still shows every selected metric side by side (unrelated to
  // how the graph section visualizes them), so it keeps the one full-config fetch.
  const { data, error, loading } = useReport(config);
  const hasMetrics = config.metrics.length > 0;

  useEffect(() => setChartType(config.chartType), [config.chartType]);

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

  return (
    <div className="animate-fade-in space-y-4">
      {/* header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {!lockView && (
            <Link
              href={backHref}
              aria-label="Back to dashboard"
              className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 text-[#c2d1d5] transition-all duration-150 hover:border-[#6ae499]/50 hover:text-[#6ae499] active:scale-95"
            >
              <ArrowLeftIcon size={16} />
            </Link>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-white">{config.name}</h1>
            {config.description && <p className="truncate text-sm text-[#7f959d]">{config.description}</p>}
          </div>
        </div>
        {!lockView && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={`focus-ring flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
              editing
                ? "bg-[#6ae499] text-[#0e1c26] hover:bg-[#57cf86]"
                : "border border-white/10 text-[#c2d1d5] hover:border-white/25"
            }`}
          >
            <PencilSimpleIcon size={14} weight={editing ? "fill" : "regular"} />
            {editing ? "Done, view mode" : "Edit report"}
          </button>
        )}
      </div>

      {/* date controls always live, even in view mode */}
      <div className="rounded-2xl border border-white/10 bg-[#0e1c26] px-4 py-3">
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
          {!hasMetrics ? (
            /* blank slate: the report is an empty canvas waiting for its first metric */
            <section className="animate-rise-in flex min-h-[320px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-[#0e1c26]/50 p-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#6ae499]/30 bg-[#6ae499]/10 text-[#6ae499]">
                <PlusIcon size={20} weight="bold" />
              </span>
              <p className="text-base font-medium text-white">Start with a metric</p>
              <p className="max-w-sm text-sm text-[#7f959d]">
                Pick one or more metrics{editing ? " in the panel" : " in the editor"}, then break them down by
                any dimension, event, or audience, and filter to exactly what you need.
              </p>
              {!editing && !lockView && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="focus-ring mt-1 rounded-xl bg-[#6ae499] px-4 py-2 text-sm font-semibold text-[#0e1c26] transition-all duration-150 hover:bg-[#57cf86] active:scale-[0.98]"
                >
                  Open editor
                </button>
              )}
            </section>
          ) : (
            <>
              {/* Section 1: Graph view — one carousel slide per metric, each with
                  its own independent breakdown dimension */}
              <section className="animate-rise-in rounded-2xl border border-white/10 bg-[#0e1c26] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]">
                    Graph view
                  </h2>
                  <div className="max-w-full overflow-x-auto">
                    <div className="flex w-max overflow-hidden rounded-lg border border-white/10">
                      {CHART_TYPES.filter((c) => c.value !== "table" && c.value !== "scorecard").map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setChartType(c.value)}
                          aria-pressed={chartType === c.value}
                          className={`focus-ring whitespace-nowrap px-2.5 py-1.5 text-xs transition-colors duration-150 ${
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
                <MetricCarousel
                  metrics={config.metrics}
                  property={config.property}
                  rangeA={config.rangeA}
                  rangeB={config.rangeB}
                  filters={config.filters}
                  limit={config.limit}
                  chartType={chartType}
                  defaultDims={configDimensions(config)}
                  colorPeriods={config.colorPeriods}
                  metadata={metadata}
                  metricsMeta={metadata?.metrics}
                />
              </section>

              {/* Section 2: Numbers view */}
              <section className="animate-rise-in rounded-2xl border border-white/10 bg-[#020601] p-4">
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]">
                  Numbers view
                </h2>
                {error ? (
                  <div className="flex h-24 items-center justify-center text-sm text-[#e66767]">{error}</div>
                ) : data ? (
                  <NumbersView data={data} metricsMeta={metadata?.metrics} />
                ) : (
                  <div className="h-24" />
                )}
                {loading && data && (
                  <p className="mt-2 text-center text-xs text-[#7f959d]">Refreshing…</p>
                )}
              </section>

              {/* Section 3: Analytics — derived insights, not a re-display of the raw totals above */}
              <section className="animate-rise-in rounded-2xl border border-white/10 bg-[#0e1c26] p-4">
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]">
                  Analytics
                </h2>
                {data ? (
                  <AnalyticsView data={data} metricsMeta={metadata?.metrics} colorPeriods={config.colorPeriods} />
                ) : (
                  <div className="h-24" />
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
