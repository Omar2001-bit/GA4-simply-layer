"use client";

import { COMPARE_PRESETS, RANGE_PRESETS, maxSelectableDate, resolveCompare, resolveRange } from "@/lib/dates";
import { SERIES_A, SERIES_B } from "@/lib/theme";
import type { CompareSel, DateRangeSel } from "@/lib/types";

interface Props {
  rangeA: DateRangeSel;
  rangeB: CompareSel;
  onChange: (rangeA: DateRangeSel, rangeB: CompareSel) => void;
  compact?: boolean;
}

const selectCls =
  "rounded-lg border border-white/10 bg-[#081219] px-2.5 py-1.5 text-sm text-white outline-none transition-colors focus:border-[#6ae499]";
const dateCls =
  "rounded-lg border border-white/10 bg-[#081219] px-2 py-1.5 text-sm text-[#c2d1d5] outline-none transition-colors focus:border-[#6ae499] [color-scheme:dark]";

export default function DateControls({ rangeA, rangeB, onChange, compact }: Props) {
  const resolvedA = resolveRange(rangeA);
  const resolvedB = resolveCompare(rangeB, resolvedA);
  const maxDate = maxSelectableDate(); // GA4 has no future data — cap every picker at yesterday

  return (
    <div
      className={`flex flex-col gap-y-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 ${
        compact ? "text-xs" : "text-sm"
      }`}
    >
      {/* Current period */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES_A }} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]">Current</span>
      </span>
      <select
        className={selectCls}
        value={rangeA.preset}
        onChange={(e) => {
          const preset = e.target.value as DateRangeSel["preset"];
          onChange(
            preset === "custom" ? { preset, start: resolvedA.startDate, end: resolvedA.endDate } : { preset },
            rangeB
          );
        }}
      >
        {RANGE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      {rangeA.preset === "custom" ? (
        <span className="flex items-center gap-1">
          <input
            type="date"
            className={dateCls}
            value={rangeA.start ?? resolvedA.startDate}
            max={rangeA.end ?? resolvedA.endDate}
            onChange={(e) => onChange({ ...rangeA, start: e.target.value }, rangeB)}
          />
          <span className="text-[#7f959d]">→</span>
          <input
            type="date"
            className={dateCls}
            value={rangeA.end ?? resolvedA.endDate}
            min={rangeA.start ?? resolvedA.startDate}
            max={maxDate}
            onChange={(e) => onChange({ ...rangeA, end: e.target.value }, rangeB)}
          />
        </span>
      ) : (
        <span className="text-xs tabular-nums text-[#7f959d] sm:text-sm">
          {resolvedA.startDate} → {resolvedA.endDate}
        </span>
      )}
      </div>

      <span className="hidden h-4 w-px bg-white/10 sm:inline-block" />

      {/* Previous period */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ border: `1.5px dashed ${SERIES_B}`, background: "transparent" }}
        />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]">Previous</span>
      </span>
      <select
        className={selectCls}
        value={rangeB.preset}
        onChange={(e) => {
          const preset = e.target.value as CompareSel["preset"];
          onChange(
            rangeA,
            preset === "custom" && resolvedB
              ? { preset, start: resolvedB.startDate, end: resolvedB.endDate }
              : { preset }
          );
        }}
      >
        {COMPARE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      {rangeB.preset === "custom" ? (
        <span className="flex items-center gap-1">
          <input
            type="date"
            className={dateCls}
            value={rangeB.start ?? resolvedB?.startDate ?? ""}
            max={rangeB.end ?? resolvedB?.endDate ?? maxDate}
            onChange={(e) => onChange(rangeA, { ...rangeB, start: e.target.value })}
          />
          <span className="text-[#7f959d]">→</span>
          <input
            type="date"
            className={dateCls}
            value={rangeB.end ?? resolvedB?.endDate ?? ""}
            min={rangeB.start ?? resolvedB?.startDate ?? undefined}
            max={maxDate}
            onChange={(e) => onChange(rangeA, { ...rangeB, end: e.target.value })}
          />
        </span>
      ) : (
        resolvedB && (
          <span className="text-xs tabular-nums text-[#7f959d] sm:text-sm">
            {resolvedB.startDate} → {resolvedB.endDate}
          </span>
        )
      )}
      </div>
    </div>
  );
}
