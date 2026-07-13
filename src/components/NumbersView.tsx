"use client";

import { CaretDownIcon, CaretUpIcon, TrayIcon } from "@phosphor-icons/react";
import { metricLabel } from "./ChartView";
import { detectGranularity } from "@/lib/dates";
import { deltaPct, fmtBucketLabel, fmtDelta, fmtValue, humanize } from "@/lib/format";
import { DELTA_DOWN, DELTA_UP } from "@/lib/theme";
import type { MetaItem, ReportResponse } from "@/lib/types";

interface Props {
  data: ReportResponse;
  metricsMeta?: MetaItem[]; // for pretty names
  compact?: boolean;
}

export function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[#7f959d]">–</span>;
  const color = value < 0 ? DELTA_DOWN : DELTA_UP;
  return (
    <span style={{ color }} className="inline-flex items-center gap-0.5 font-medium tabular-nums">
      {value !== 0 &&
        (value > 0 ? <CaretUpIcon size={10} weight="fill" /> : <CaretDownIcon size={10} weight="fill" />)}
      {fmtDelta(value)}
    </span>
  );
}

interface TileProps {
  apiName: string;
  data: ReportResponse;
  metricsMeta?: MetaItem[];
  compact?: boolean;
}

/** A single KPI tile's content — no grid, no drag wrapper. Used both by the
 *  Numbers-view grid and (via EntryCard) by any other section a card gets
 *  dragged into. */
export function KpiTileContent({ apiName, data, metricsMeta, compact }: TileProps) {
  const i = data.metrics.indexOf(apiName);
  if (i === -1) return null;
  const a = data.totalsA[i] ?? 0;
  const b = data.totalsB?.[i];
  const type = data.metricHeaders[i]?.type;
  return (
    <div className="min-w-0 rounded-xl border border-white/10 px-4 py-3 text-left" style={{ background: "#0e1c26" }}>
      <div className="text-[11px] uppercase leading-tight tracking-wider text-[#7f959d]">
        {metricLabel(apiName, metricsMeta)}
      </div>
      <div className={`mt-1 break-words font-semibold tabular-nums text-white ${compact ? "text-lg" : "text-xl"}`}>
        {fmtValue(a, type, data.currencyCode)}
      </div>
      {data.rangeB && (
        <div className="mt-1 flex items-baseline gap-2 text-xs">
          <Delta value={deltaPct(a, b)} />
          <span className="text-[#7f959d]">vs {fmtValue(b ?? 0, type, data.currencyCode)}</span>
        </div>
      )}
    </div>
  );
}

/** The dimension-breakdown table below the KPI grid — always driven by the
 *  report's full metric list, unrelated to the draggable card arrangement. */
export default function NumbersView({ data, metricsMeta }: Props) {
  const hasCompare = !!data.rangeB;
  const dimList = data.dimensions ?? (data.dimension ? [data.dimension] : []);
  const granularity = detectGranularity(dimList);
  const hasDim = dimList.length > 0 && data.rows.length > 0 && data.rows[0].dim !== "total";
  const colCount = 1 + data.metrics.length * (hasCompare ? 3 : 1);
  if (!hasDim) return null;
  return (
    <div className="animate-fade-in overflow-x-auto rounded-xl border border-white/10 bg-[#0e1c26]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-[#7f959d]">
            <th className="px-4 py-3 font-medium">{dimList.map(humanize).join(" · ")}</th>
            {data.metrics.map((m) => (
              <th key={m} className="px-4 py-3 text-right font-medium" colSpan={hasCompare ? 3 : 1}>
                {metricLabel(m, metricsMeta)}
              </th>
            ))}
          </tr>
          {hasCompare && (
            <tr className="border-b border-white/10 text-right text-[11px] text-[#7f959d]">
              <th className="px-4 py-1.5 text-left font-normal"></th>
              {data.metrics.map((m) => (
                <FragmentHeads key={m} />
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {data.rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-4 py-8 text-center text-xs text-[#7f959d]">
                <div className="flex flex-col items-center gap-1.5">
                  <TrayIcon size={18} />
                  No rows for this breakdown.
                </div>
              </td>
            </tr>
          ) : (
            data.rows.map((r, ri) => (
              <tr
                key={`${r.dim}-${ri}`}
                className="border-b border-white/5 transition-colors duration-100 last:border-0 hover:bg-white/[0.03]"
              >
                <td className="max-w-[280px] truncate px-4 py-2.5 text-[#c2d1d5]">
                  {granularity ? fmtBucketLabel(granularity, r.dim) : r.dim || "(not set)"}
                  {r.bDim && (
                    <span className="ml-2 text-xs text-[#7f959d]">
                      vs {granularity ? fmtBucketLabel(granularity, r.bDim) : r.bDim}
                    </span>
                  )}
                </td>
                {data.metrics.map((m, mi) => {
                  const type = data.metricHeaders[mi]?.type;
                  const a = r.a[mi] ?? 0;
                  const b = r.b?.[mi];
                  return hasCompare ? (
                    <FragmentCells key={m} a={a} b={b} type={type} currencyCode={data.currencyCode} />
                  ) : (
                    <td key={m} className="px-4 py-2.5 text-right tabular-nums text-white">
                      {fmtValue(a, type, data.currencyCode)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function FragmentHeads() {
  return (
    <>
      <th className="px-2 py-1.5 font-normal">Current</th>
      <th className="px-2 py-1.5 font-normal">Previous</th>
      <th className="px-2 py-1.5 font-normal">Δ</th>
    </>
  );
}

function FragmentCells({ a, b, type, currencyCode }: { a: number; b?: number; type?: string; currencyCode?: string }) {
  return (
    <>
      <td className="px-2 py-2.5 text-right tabular-nums text-white">{fmtValue(a, type, currencyCode)}</td>
      <td className="px-2 py-2.5 text-right tabular-nums text-[#7f959d]">
        {b === undefined ? "–" : fmtValue(b, type, currencyCode)}
      </td>
      <td className="px-2 py-2.5 text-right">
        <Delta value={deltaPct(a, b)} />
      </td>
    </>
  );
}
