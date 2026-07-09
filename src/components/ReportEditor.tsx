"use client";

import MetaPicker from "./MetaPicker";
import {
  CHART_TYPES,
  FILTER_MATCHES,
  type FilterClause,
  type MetadataResponse,
  type PropertySummary,
  type ReportConfig,
} from "@/lib/types";

interface Props {
  config: ReportConfig;
  onChange: (c: ReportConfig) => void;
  properties: PropertySummary[];
  metadata: MetadataResponse | null;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  savedAt: number | null;
}

const labelCls = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]";
const inputCls =
  "w-full rounded-xl border border-white/10 bg-[#081219] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-[#6ae499]";
const selectCls = inputCls;

/** Common starting points — one click sets the breakdown. */
const QUICK_DIMS: { label: string; dim: string }[] = [
  { label: "Over time", dim: "date" },
  { label: "Events", dim: "eventName" },
  { label: "Audiences", dim: "audienceName" },
  { label: "Channels", dim: "sessionDefaultChannelGroup" },
  { label: "Pages", dim: "pagePath" },
  { label: "Countries", dim: "country" },
];

export default function ReportEditor({
  config,
  onChange,
  properties,
  metadata,
  onSave,
  onDelete,
  saving,
  savedAt,
}: Props) {
  const set = (patch: Partial<ReportConfig>) => onChange({ ...config, ...patch });
  const filters = config.filters ?? [];

  const setFilter = (i: number, patch: Partial<FilterClause>) => {
    const next = filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    set({ filters: next });
  };

  return (
    <aside className="w-full shrink-0 space-y-5 rounded-2xl border border-white/10 bg-[#0e1c26] p-5 lg:w-[21rem]">
      <div>
        <label className={labelCls}>Report name</label>
        <input className={inputCls} value={config.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <input
          className={inputCls}
          value={config.description ?? ""}
          placeholder="What this report answers"
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>
      <div>
        <label className={labelCls}>GA4 property</label>
        <select className={selectCls} value={config.property} onChange={(e) => set({ property: e.target.value })}>
          {properties.map((p) => (
            <option key={p.property} value={p.property}>
              {p.displayName} — {p.property.replace("properties/", "")}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls}>Metrics (up to 5)</label>
        <MetaPicker
          items={metadata?.metrics ?? []}
          selected={config.metrics}
          onToggle={(m) =>
            set({
              metrics: config.metrics.includes(m)
                ? config.metrics.filter((x) => x !== m)
                : [...config.metrics, m].slice(0, 5),
            })
          }
          max={5}
          placeholder="Pick metrics"
        />
      </div>

      <div>
        <label className={labelCls}>Break down by</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_DIMS.map((q) => (
            <button
              key={q.dim}
              type="button"
              onClick={() => set({ dimension: config.dimension === q.dim ? "" : q.dim })}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                config.dimension === q.dim
                  ? "border-[#6ae499] bg-[#6ae499]/10 text-[#6ae499]"
                  : "border-white/10 text-[#7f959d] hover:border-white/25 hover:text-[#c2d1d5]"
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>
        <MetaPicker
          items={metadata?.dimensions ?? []}
          selected={config.dimension ? [config.dimension] : []}
          onToggle={(d) => set({ dimension: config.dimension === d ? "" : d })}
          max={1}
          placeholder="Any dimension"
          allowNone
        />
      </div>

      <div>
        <label className={labelCls}>Filters</label>
        <div className="space-y-2">
          {filters.map((f, i) => (
            <div key={i} className="space-y-1.5 rounded-xl border border-white/10 bg-[#081219] p-2.5">
              <MetaPicker
                items={metadata?.dimensions ?? []}
                selected={f.field ? [f.field] : []}
                onToggle={(d) => setFilter(i, { field: f.field === d ? "" : d })}
                max={1}
                placeholder="Filter dimension"
              />
              <div className="flex gap-1.5">
                <select
                  className="w-32 shrink-0 rounded-lg border border-white/10 bg-[#0e1c26] px-2 py-1.5 text-xs text-white outline-none focus:border-[#6ae499]"
                  value={f.match}
                  onChange={(e) => setFilter(i, { match: e.target.value as FilterClause["match"] })}
                >
                  {FILTER_MATCHES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0e1c26] px-2 py-1.5 text-xs text-white outline-none focus:border-[#6ae499]"
                  placeholder="Value (e.g. purchase)"
                  value={f.value}
                  onChange={(e) => setFilter(i, { value: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[#7f959d]">
                  <input
                    type="checkbox"
                    checked={!!f.not}
                    onChange={(e) => setFilter(i, { not: e.target.checked })}
                    className="accent-[#6ae499]"
                  />
                  Exclude matches
                </label>
                <button
                  type="button"
                  onClick={() => set({ filters: filters.filter((_, idx) => idx !== i) })}
                  className="text-xs text-[#7f959d] transition-colors hover:text-[#e66767]"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set({ filters: [...filters, { field: "", match: "contains", value: "" }] })
            }
            className="w-full rounded-xl border border-dashed border-white/15 px-3 py-2 text-xs text-[#7f959d] transition-colors hover:border-[#6ae499]/50 hover:text-[#6ae499]"
          >
            + Add filter
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Default chart</label>
          <select
            className={selectCls}
            value={config.chartType}
            onChange={(e) => set({ chartType: e.target.value as ReportConfig["chartType"] })}
          >
            {CHART_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Row limit</label>
          <input
            type="number"
            min={1}
            max={1000}
            className={inputCls}
            value={config.limit}
            onChange={(e) => set({ limit: Math.max(1, Math.min(1000, Number(e.target.value) || 25)) })}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !config.name.trim() || config.metrics.length === 0}
          className="rounded-xl bg-[#6ae499] px-4 py-2 text-sm font-semibold text-[#0e1c26] transition-colors hover:bg-[#57cf86] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save preset"}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-xl border border-[#d03b3b]/40 px-3 py-2 text-sm text-[#e66767] transition-colors hover:bg-[#d03b3b]/10"
          >
            Delete
          </button>
        )}
        {savedAt && Date.now() - savedAt < 4000 && <span className="text-xs text-[#6ae499]">Saved ✓</span>}
      </div>
    </aside>
  );
}
