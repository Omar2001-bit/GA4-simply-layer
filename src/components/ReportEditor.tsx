"use client";

import MetaPicker from "./MetaPicker";
import { CHART_TYPES, type MetadataResponse, type PropertySummary, type ReportConfig } from "@/lib/types";

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

const labelCls = "mb-1 block text-xs font-medium uppercase tracking-wider text-[#898781]";
const inputCls =
  "w-full rounded-lg border border-white/10 bg-[#111110] px-3 py-2 text-sm text-white outline-none focus:border-[#3987e5]";

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

  return (
    <aside className="w-full shrink-0 space-y-4 rounded-xl border border-white/10 bg-[#1a1a19] p-4 lg:w-80">
      <div>
        <label className={labelCls}>Report name</label>
        <input className={inputCls} value={config.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <input
          className={inputCls}
          value={config.description ?? ""}
          placeholder="Optional"
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>
      <div>
        <label className={labelCls}>GA4 property</label>
        <select
          className={inputCls}
          value={config.property}
          onChange={(e) => set({ property: e.target.value })}
        >
          {properties.map((p) => (
            <option key={p.property} value={p.property}>
              {p.displayName} — {p.property.replace("properties/", "")}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls}>Dimension (breakdown)</label>
        <MetaPicker
          items={metadata?.dimensions ?? []}
          selected={config.dimension ? [config.dimension] : []}
          onToggle={(d) => set({ dimension: config.dimension === d ? "" : d })}
          max={1}
          placeholder="Dimension"
          allowNone
        />
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
          placeholder="Metrics"
        />
      </div>
      <div>
        <label className={labelCls}>Default chart</label>
        <select
          className={inputCls}
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
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !config.name.trim() || config.metrics.length === 0}
          className="rounded-lg bg-[#3987e5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2a78d6] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save preset"}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-[#d03b3b]/40 px-3 py-2 text-sm text-[#e66767] hover:bg-[#d03b3b]/10"
          >
            Delete
          </button>
        )}
        {savedAt && Date.now() - savedAt < 4000 && (
          <span className="text-xs text-[#0ca30c]">Saved ✓</span>
        )}
      </div>
    </aside>
  );
}
