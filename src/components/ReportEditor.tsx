"use client";

import { ArrowRightIcon, CheckIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import DatePicker from "./DatePicker";
import MetaPicker from "./MetaPicker";
import { maxSelectableDate } from "@/lib/dates";
import { humanizeEvent } from "@/lib/format";
import {
  CHART_TYPES,
  COLOR_PERIOD_PALETTE,
  FILTER_MATCHES,
  MAX_DIMENSIONS,
  configDimensions,
  isConvRateMetric,
  isEventMetric,
  makeConvRateMetric,
  makeEventMetric,
  type ColorPeriod,
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
  "focus-ring w-full rounded-xl border border-white/10 bg-[#081219] px-3 py-2 text-sm text-white transition-colors duration-150 hover:border-white/20 focus:border-[#6ae499]";
const selectCls = inputCls;
const smallFieldCls =
  "focus-ring rounded-lg border border-white/10 bg-[#0e1c26] px-2 py-1.5 text-xs text-white transition-colors duration-150 hover:border-white/20 focus:border-[#6ae499]";

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
  const dims = configDimensions(config);
  const setDims = (next: string[]) =>
    set({ dimensions: next.slice(0, MAX_DIMENSIONS), dimension: next[0] ?? "" });
  const toggleDim = (d: string) =>
    setDims(dims.includes(d) ? dims.filter((x) => x !== d) : [...dims, d]);

  const setFilter = (i: number, patch: Partial<FilterClause>) => {
    const next = filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    set({ filters: next });
  };

  const colorPeriods = config.colorPeriods ?? [];
  const setColorPeriod = (i: number, patch: Partial<ColorPeriod>) =>
    set({ colorPeriods: colorPeriods.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  const addColorPeriod = () => {
    const today = maxSelectableDate();
    set({
      colorPeriods: [
        ...colorPeriods,
        {
          id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          label: "",
          startDate: today,
          endDate: today,
          color: COLOR_PERIOD_PALETTE[colorPeriods.length % COLOR_PERIOD_PALETTE.length],
        },
      ],
    });
  };

  // other reports' group names, offered as datalist suggestions so the same
  // group can be reused by name instead of retyped exactly each time.
  const [existingGroups, setExistingGroups] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/presets")
      .then((r) => r.json())
      .then((j: { reports?: ReportConfig[] }) => {
        const names = Array.from(new Set((j.reports ?? []).map((r) => r.group).filter((g): g is string => !!g)));
        setExistingGroups(names);
      })
      .catch(() => {});
  }, []);

  // real dimension values (event names, channels, countries…) for filter-value suggestions
  const [valueSuggestions, setValueSuggestions] = useState<Record<string, string[]>>({});
  const filterFields = filters.map((f) => f.field).filter(Boolean).join(",");
  useEffect(() => {
    const fields = filterFields ? filterFields.split(",") : [];
    for (const field of fields) {
      if (valueSuggestions[field]) continue;
      fetch(`/api/values?property=${config.property}&dimension=${encodeURIComponent(field)}`)
        .then((r) => r.json())
        .then((j) => {
          if (Array.isArray(j.values)) {
            setValueSuggestions((prev) => ({ ...prev, [field]: j.values }));
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterFields, config.property]);

  // real event names actually firing in this property — GA4 has no
  // per-event "count" metric, so these are offered as virtual metrics
  // ("event:purchase") the server resolves into eventCount × eventName.
  const [eventNames, setEventNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!config.property) return;
    fetch(`/api/values?property=${config.property}&dimension=eventName`)
      .then((r) => r.json())
      .then((j) => setEventNames(Array.isArray(j.values) ? j.values : []))
      .catch(() => setEventNames([]));
  }, [config.property]);
  const toggleMetric = (m: string) =>
    set({
      metrics: config.metrics.includes(m)
        ? config.metrics.filter((x) => x !== m)
        : [...config.metrics, m],
    });

  // A render-time `Date.now() - savedAt < 4000` check only hides the badge if
  // something else happens to re-render the component after 4s pass — with
  // no other state churn it would just sit there forever. A real timer.
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (!savedAt) return;
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), 4000);
    return () => clearTimeout(t);
  }, [savedAt]);

  return (
    <aside className="animate-rise-in w-full shrink-0 space-y-5 rounded-2xl border border-white/10 bg-[#0e1c26] p-5 lg:w-[21rem]">
      <div>
        <label className={labelCls}>Report name</label>
        <input className={inputCls} value={config.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <input
          className={inputCls}
          value={config.description ?? ""}
          placeholder="What this report answers…"
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>
      <div>
        <label className={labelCls}>Group</label>
        <input
          className={inputCls}
          value={config.group ?? ""}
          placeholder="e.g. Client A, Weekly reports…"
          list="existing-groups"
          onChange={(e) => set({ group: e.target.value })}
        />
        <datalist id="existing-groups">
          {existingGroups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <p className="mt-1.5 text-[11px] leading-snug text-[#7f959d]">
          Reports sharing a group name are sectioned together on the mega dashboard. Leave blank
          to leave it ungrouped.
        </p>
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
        <label className={labelCls}>Metrics</label>
        <MetaPicker
          items={metadata?.metrics ?? []}
          selected={config.metrics.filter((m) => !isEventMetric(m) && !isConvRateMetric(m))}
          onToggle={toggleMetric}
          max={Infinity}
          placeholder="Pick metrics"
        />
      </div>

      <div>
        <label className={labelCls}>Event counts</label>
        <MetaPicker
          items={(eventNames ?? []).map((n) => ({
            apiName: makeEventMetric(n),
            uiName: humanizeEvent(n),
            category: "Event",
          }))}
          selected={config.metrics.filter(isEventMetric)}
          onToggle={toggleMetric}
          max={Infinity}
          placeholder={eventNames === null ? "Loading events…" : eventNames.length === 0 ? "No events found" : "Pick events to count"}
        />
        <p className="mt-1.5 text-[11px] leading-snug text-[#7f959d]">
          GA4 has no built-in metric per event, this counts occurrences of the event itself
          (eventCount filtered to that event name), same as &ldquo;Events&rdquo; breakdown below but as its own line.
        </p>
      </div>

      <div>
        <label className={labelCls}>Conversion rates</label>
        <MetaPicker
          items={(eventNames ?? []).flatMap((n) => [
            { apiName: makeConvRateMetric(n, "totalUsers"), uiName: `${humanizeEvent(n)} → per user`, category: "Conversion" },
            { apiName: makeConvRateMetric(n, "sessions"), uiName: `${humanizeEvent(n)} → per session`, category: "Conversion" },
          ])}
          selected={config.metrics.filter(isConvRateMetric)}
          onToggle={toggleMetric}
          max={Infinity}
          placeholder={eventNames === null ? "Loading events…" : "Pick a conversion rate"}
        />
        <p className="mt-1.5 text-[11px] leading-snug text-[#7f959d]">
          That event&rsquo;s count as a share of total users, or of sessions, over this same range and
          breakdown, computed as one total over another total (never an average of daily rates).
        </p>
      </div>

      <div>
        <label className={labelCls}>Break down by (up to {MAX_DIMENSIONS})</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_DIMS.map((q) => (
            <button
              key={q.dim}
              type="button"
              onClick={() => toggleDim(q.dim)}
              className={`focus-ring rounded-full border px-2.5 py-1 text-xs transition-all duration-150 active:scale-95 ${
                dims.includes(q.dim)
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
          selected={dims}
          onToggle={toggleDim}
          max={MAX_DIMENSIONS}
          placeholder="Any dimensions"
          allowNone
        />
        {dims.length > 1 && dims.includes("date") && config.rangeB.preset !== "none" && (
          <p className="mt-1.5 text-[11px] leading-snug text-[#7f959d]">
            Day-aligned comparison overlays need Date as the only breakdown, with extra dimensions,
            previous-period values pair only where the other values match.
          </p>
        )}
      </div>

      <div>
        <label className={labelCls}>Filters</label>
        <div className="space-y-2">
          {filters.map((f, i) => (
            <div key={i} className="animate-rise-in space-y-1.5 rounded-xl border border-white/10 bg-[#081219] p-2.5">
              <MetaPicker
                items={metadata?.dimensions ?? []}
                selected={f.field ? [f.field] : []}
                onToggle={(d) => setFilter(i, { field: f.field === d ? "" : d })}
                max={1}
                placeholder="Filter dimension"
              />
              <div className="flex gap-1.5">
                <select
                  className={`w-32 shrink-0 ${smallFieldCls}`}
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
                  className={`min-w-0 flex-1 ${smallFieldCls}`}
                  placeholder="Value (e.g. purchase)…"
                  value={f.value}
                  list={f.field ? `values-${f.field}` : undefined}
                  onChange={(e) => setFilter(i, { value: e.target.value })}
                />
                {f.field && valueSuggestions[f.field] && (
                  <datalist id={`values-${f.field}`}>
                    {valueSuggestions[f.field].map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                )}
              </div>
              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[#7f959d] transition-colors duration-150 hover:text-[#c2d1d5]">
                  <input
                    type="checkbox"
                    checked={!!f.not}
                    onChange={(e) => setFilter(i, { not: e.target.checked })}
                    className="focus-ring h-3.5 w-3.5 cursor-pointer accent-[#6ae499]"
                  />
                  Exclude matches
                </label>
                <button
                  type="button"
                  onClick={() => set({ filters: filters.filter((_, idx) => idx !== i) })}
                  aria-label="Remove filter"
                  className="focus-ring flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[#7f959d] transition-colors duration-150 hover:text-[#e66767]"
                >
                  <TrashIcon size={13} />
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
            className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 px-3 py-2 text-xs text-[#7f959d] transition-colors duration-150 hover:border-[#6ae499]/50 hover:text-[#6ae499]"
          >
            <PlusIcon size={13} weight="bold" />
            Add filter
          </button>
        </div>
      </div>

      <div>
        <label className={labelCls}>Highlight periods</label>
        <div className="space-y-2">
          {colorPeriods.map((p, i) => (
            <div key={p.id} className="animate-rise-in space-y-1.5 rounded-xl border border-white/10 bg-[#081219] p-2.5">
              <div className="flex items-center gap-1.5">
                <input
                  className={`min-w-0 flex-1 ${smallFieldCls}`}
                  placeholder="Label (e.g. Campaign Launch)…"
                  value={p.label}
                  onChange={(e) => setColorPeriod(i, { label: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => set({ colorPeriods: colorPeriods.filter((_, idx) => idx !== i) })}
                  aria-label="Remove highlight period"
                  className="focus-ring flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-[#7f959d] transition-colors duration-150 hover:text-[#e66767]"
                >
                  <TrashIcon size={13} />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <DatePicker
                  value={p.startDate}
                  max={p.endDate}
                  onSelect={(d) => setColorPeriod(i, { startDate: d })}
                />
                <ArrowRightIcon size={12} className="shrink-0 text-[#7f959d]" />
                <DatePicker
                  value={p.endDate}
                  min={p.startDate}
                  max={maxSelectableDate()}
                  onSelect={(d) => setColorPeriod(i, { endDate: d })}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {COLOR_PERIOD_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColorPeriod(i, { color: c })}
                    aria-label={`Use color ${c}`}
                    aria-pressed={p.color === c}
                    className="focus-ring h-5 w-5 shrink-0 rounded-full transition-transform duration-150 active:scale-90"
                    style={{
                      background: c,
                      boxShadow: p.color === c ? "0 0 0 2px #0e1c26, 0 0 0 3.5px #ffffff" : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addColorPeriod}
            className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 px-3 py-2 text-xs text-[#7f959d] transition-colors duration-150 hover:border-[#6ae499]/50 hover:text-[#6ae499]"
          >
            <PlusIcon size={13} weight="bold" />
            Add highlight period
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-[#7f959d]">
          Shaded on every graph, and broken out as its own stat block in Analytics. Overlapping
          periods: the first one defined wins.
        </p>
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
            className={`${inputCls} tabular-nums`}
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
          className="focus-ring rounded-xl bg-[#6ae499] px-4 py-2 text-sm font-semibold text-[#0e1c26] transition-all duration-150 hover:bg-[#57cf86] active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
        >
          {saving ? "Saving…" : "Save preset"}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="focus-ring rounded-xl border border-[#d03b3b]/40 px-3 py-2 text-sm text-[#e66767] transition-all duration-150 hover:bg-[#d03b3b]/10 active:scale-[0.98]"
          >
            Delete
          </button>
        )}
        {showSaved && (
          <span className="animate-pop-in flex items-center gap-1 text-xs font-medium text-[#6ae499]">
            <CheckIcon size={13} weight="bold" />
            Saved
          </span>
        )}
      </div>
    </aside>
  );
}
