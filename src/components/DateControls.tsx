"use client";

import { Icon } from "./Icon";
import { useRef } from "react";
import DatePicker, { type DatePickerHandle } from "./DatePicker";
import { COMPARE_PRESETS, RANGE_PRESETS, maxSelectableDate, multiPeriodChunks, resolveCompare, resolveRange } from "@/lib/dates";
import { fmtDateLabel } from "@/lib/format";
import { SERIES_A, SERIES_B } from "@/lib/theme";
import type { CompareSel, DateRangeSel } from "@/lib/types";

interface Props {
  rangeA: DateRangeSel;
  rangeB: CompareSel;
  onChange: (rangeA: DateRangeSel, rangeB: CompareSel) => void;
  compact?: boolean;
}

const selectCls =
  "focus-ring rounded-lg border border-white/10 bg-[#081219] px-2.5 py-1.5 text-sm text-white transition-colors duration-150 hover:border-white/25 focus:border-[#6ae499]";

export default function DateControls({ rangeA, rangeB, onChange, compact }: Props) {
  const resolvedA = resolveRange(rangeA);
  const resolvedB = resolveCompare(rangeB, resolvedA);
  const maxDate = maxSelectableDate(); // GA4 has no future data — cap every picker at yesterday
  const endARef = useRef<DatePickerHandle>(null);
  const endBRef = useRef<DatePickerHandle>(null);

  // Belt-and-suspenders for stale saved presets from before the picker
  // structurally blocked future dates (disabled cells can't be clicked at
  // all now, but an old bogus value could still be sitting in storage).
  const capMax = (v: string) => (v > maxDate ? maxDate : v);

  // "since" (Current rolls forward to yesterday every day) paired with a
  // fixed "custom" Previous only matches in length by coincidence today —
  // tomorrow they drift apart and the comparison silently stops being
  // apples-to-apples. "Fixed baseline" (fixedEnd) and "Previous period" both
  // recompute their own length to track Current's, so either fixes it.
  const driftingCompare = rangeA.preset === "since" && rangeB.preset === "custom";

  // The real N period-length chunks behind a multiPeriodAvg window, most
  // recent first — "Apr 29 → Jul 6" reads as one continuous comparison
  // range when it's actually 3 separate periods stacked and averaged.
  const compareChunks = rangeB.preset === "multiPeriodAvg" && resolvedB ? multiPeriodChunks(resolvedA, resolvedB) : [];

  return (
    <div>
      <div
        className={`flex flex-col gap-y-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 ${
          compact ? "text-xs" : "text-sm"
        }`}
      >
        {/* Previous period */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ border: `1.5px dashed ${SERIES_B}`, background: "transparent" }}
            />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]">Previous</span>
          </span>
          <select
            className={selectCls}
            value={rangeB.preset}
            onChange={(e) => {
              const preset = e.target.value as CompareSel["preset"];
              const next: CompareSel =
                preset === "custom" && resolvedB
                  ? { preset, start: resolvedB.startDate, end: resolvedB.endDate }
                  : preset === "fixedEnd"
                    ? { preset, end: resolvedB?.endDate ?? resolvedA.endDate }
                    : preset === "multiPeriodAvg"
                      ? { preset, multiplier: rangeB.multiplier ?? 2 }
                      : { preset };
              onChange(rangeA, next);
            }}
          >
            {COMPARE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {rangeB.preset === "custom" ? (
            <span className="flex items-center gap-1.5">
              <DatePicker
                value={capMax(rangeB.start ?? resolvedB?.startDate ?? maxDate)}
                max={capMax(rangeB.end ?? resolvedB?.endDate ?? maxDate)}
                onSelect={(date) => {
                  onChange(rangeA, { ...rangeB, start: date });
                  endBRef.current?.open();
                }}
              />
              <Icon name="arrow-right" size={12} className="shrink-0 text-[#7f959d]" />
              <DatePicker
                ref={endBRef}
                value={capMax(rangeB.end ?? resolvedB?.endDate ?? maxDate)}
                min={rangeB.start ?? resolvedB?.startDate}
                max={maxDate}
                onSelect={(date) => onChange(rangeA, { ...rangeB, end: date })}
              />
            </span>
          ) : rangeB.preset === "fixedEnd" ? (
            <span className="flex items-center gap-1.5">
              <span
                className="text-xs tabular-nums text-[#7f959d] sm:text-sm"
                title="Grows backward automatically to always match the current period's length"
              >
                {resolvedB?.startDate}
              </span>
              <Icon name="arrow-right" size={12} className="shrink-0 text-[#7f959d]" />
              <DatePicker
                value={capMax(rangeB.end ?? resolvedB?.endDate ?? maxDate)}
                max={maxDate}
                onSelect={(date) => onChange(rangeA, { ...rangeB, end: date })}
              />
            </span>
          ) : rangeB.preset === "multiPeriodAvg" ? (
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="flex items-center gap-1 text-xs text-[#7f959d]">
                <input
                  type="number"
                  min={2}
                  max={52}
                  value={rangeB.multiplier ?? 2}
                  onChange={(e) => {
                    const multiplier = Math.max(2, Math.min(52, Math.round(Number(e.target.value)) || 2));
                    onChange(rangeA, { ...rangeB, multiplier });
                  }}
                  className="focus-ring w-12 rounded-lg border border-white/10 bg-[#081219] px-1.5 py-1.5 text-center text-sm tabular-nums text-white transition-colors duration-150 hover:border-white/25 focus:border-[#6ae499]"
                />
                <span>periods averaged:</span>
              </span>
              {/* the real chunks being averaged, not one deceptively-long span —
                  "Apr 29 → Jul 6" alone reads as a single comparison block */}
              <span className="flex flex-wrap items-center gap-x-1 text-xs tabular-nums text-[#7f959d]" title="Most recent period first — each is Current's own length, averaged together day-by-day">
                {compareChunks.map((c, i) => (
                  <span key={c.startDate}>
                    {fmtDateLabel(c.startDate)}–{fmtDateLabel(c.endDate)}
                    {i < compareChunks.length - 1 ? "," : ""}
                  </span>
                ))}
              </span>
            </span>
          ) : (
            resolvedB && (
              <span className="flex items-center gap-1.5 text-xs tabular-nums text-[#7f959d] sm:text-sm">
                {resolvedB.startDate}
                <Icon name="arrow-right" size={11} className="shrink-0" />
                {resolvedB.endDate}
              </span>
            )
          )}
        </div>

        <span className="hidden h-4 w-px bg-white/10 sm:inline-block" />

        {/* Current period */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: SERIES_A }} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]">Current</span>
          </span>
          <select
            className={selectCls}
            value={rangeA.preset}
            onChange={(e) => {
              const preset = e.target.value as DateRangeSel["preset"];
              const next: DateRangeSel =
                preset === "custom"
                  ? { preset, start: resolvedA.startDate, end: resolvedA.endDate }
                  : preset === "since"
                    ? { preset, start: resolvedA.startDate }
                    : { preset };
              onChange(next, rangeB);
            }}
          >
            {RANGE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {rangeA.preset === "custom" ? (
            <span className="flex items-center gap-1.5">
              <DatePicker
                value={capMax(rangeA.start ?? resolvedA.startDate)}
                max={capMax(rangeA.end ?? resolvedA.endDate)}
                onSelect={(date) => {
                  onChange({ ...rangeA, start: date }, rangeB);
                  endARef.current?.open();
                }}
              />
              <Icon name="arrow-right" size={12} className="shrink-0 text-[#7f959d]" />
              <DatePicker
                ref={endARef}
                value={capMax(rangeA.end ?? resolvedA.endDate)}
                min={rangeA.start ?? resolvedA.startDate}
                max={maxDate}
                align="right"
                onSelect={(date) => onChange({ ...rangeA, end: date }, rangeB)}
              />
            </span>
          ) : rangeA.preset === "since" ? (
            <span className="flex items-center gap-1.5">
              <DatePicker
                value={capMax(rangeA.start ?? resolvedA.startDate)}
                max={maxDate}
                onSelect={(date) => onChange({ ...rangeA, start: date }, rangeB)}
              />
              <Icon name="arrow-right" size={12} className="shrink-0 text-[#7f959d]" />
              <span className="text-xs tabular-nums text-[#7f959d] sm:text-sm" title="Always rolls forward to yesterday">
                {resolvedA.endDate}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs tabular-nums text-[#7f959d] sm:text-sm">
              {resolvedA.startDate}
              <Icon name="arrow-right" size={11} className="shrink-0" />
              {resolvedA.endDate}
            </span>
          )}
        </div>
      </div>
      {driftingCompare && (
        <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: "#e6a23c" }}>
          <Icon name="warning" size={13} className="shrink-0" />
          Previous is a fixed range while Current keeps growing — they&rsquo;ll drift apart daily. Use &ldquo;Fixed
          baseline&rdquo; or &ldquo;Previous period&rdquo; instead.
        </p>
      )}
    </div>
  );
}
