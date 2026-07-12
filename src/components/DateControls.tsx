"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import { useRef } from "react";
import DatePicker, { type DatePickerHandle } from "./DatePicker";
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

  return (
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
          <span className="flex items-center gap-1.5">
            <DatePicker
              value={capMax(rangeB.start ?? resolvedB?.startDate ?? maxDate)}
              max={capMax(rangeB.end ?? resolvedB?.endDate ?? maxDate)}
              onSelect={(date) => {
                onChange(rangeA, { ...rangeB, start: date });
                endBRef.current?.open();
              }}
            />
            <ArrowRightIcon size={12} className="shrink-0 text-[#7f959d]" />
            <DatePicker
              ref={endBRef}
              value={capMax(rangeB.end ?? resolvedB?.endDate ?? maxDate)}
              min={rangeB.start ?? resolvedB?.startDate}
              max={maxDate}
              onSelect={(date) => onChange(rangeA, { ...rangeB, end: date })}
            />
          </span>
        ) : (
          resolvedB && (
            <span className="flex items-center gap-1.5 text-xs tabular-nums text-[#7f959d] sm:text-sm">
              {resolvedB.startDate}
              <ArrowRightIcon size={11} className="shrink-0" />
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
          <span className="flex items-center gap-1.5">
            <DatePicker
              value={capMax(rangeA.start ?? resolvedA.startDate)}
              max={capMax(rangeA.end ?? resolvedA.endDate)}
              onSelect={(date) => {
                onChange({ ...rangeA, start: date }, rangeB);
                endARef.current?.open();
              }}
            />
            <ArrowRightIcon size={12} className="shrink-0 text-[#7f959d]" />
            <DatePicker
              ref={endARef}
              value={capMax(rangeA.end ?? resolvedA.endDate)}
              min={rangeA.start ?? resolvedA.startDate}
              max={maxDate}
              align="right"
              onSelect={(date) => onChange({ ...rangeA, end: date }, rangeB)}
            />
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs tabular-nums text-[#7f959d] sm:text-sm">
            {resolvedA.startDate}
            <ArrowRightIcon size={11} className="shrink-0" />
            {resolvedA.endDate}
          </span>
        )}
      </div>
    </div>
  );
}
