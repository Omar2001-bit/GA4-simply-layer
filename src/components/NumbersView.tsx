"use client";

import { deltaPct, fmtDateLabel, fmtDelta, fmtValue, humanize } from "@/lib/format";
import { DELTA_DOWN, DELTA_UP } from "@/lib/theme";
import type { MetaItem, ReportResponse } from "@/lib/types";

interface Props {
  data: ReportResponse;
  metricsMeta?: MetaItem[]; // for pretty names
  compact?: boolean;
}

function metricLabel(apiName: string, meta?: MetaItem[]): string {
  return meta?.find((m) => m.apiName === apiName)?.uiName ?? humanize(apiName);
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[#898781]">–</span>;
  const color = value < 0 ? DELTA_DOWN : DELTA_UP;
  return (
    <span style={{ color }} className="font-medium tabular-nums">
      {value > 0 ? "▲" : value < 0 ? "▼" : ""} {fmtDelta(value)}
    </span>
  );
}

export function KpiCards({ data, metricsMeta, compact }: Props) {
  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"}`}>
      {data.metrics.map((m, i) => {
        const a = data.totalsA[i] ?? 0;
        const b = data.totalsB?.[i];
        const type = data.metricHeaders[i]?.type;
        return (
          <div
            key={m}
            className="rounded-xl border border-white/10 bg-[#1a1a19] px-4 py-3"
          >
            <div className="truncate text-xs uppercase tracking-wider text-[#898781]">
              {metricLabel(m, metricsMeta)}
            </div>
            <div className={`mt-1 font-semibold text-white ${compact ? "text-xl" : "text-2xl"}`}>
              {fmtValue(a, type)}
            </div>
            {data.rangeB && (
              <div className="mt-1 flex items-baseline gap-2 text-xs">
                <Delta value={deltaPct(a, b)} />
                <span className="text-[#898781]">vs {fmtValue(b ?? 0, type)}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function NumbersView({ data, metricsMeta }: Props) {
  const hasCompare = !!data.rangeB;
  const hasDim = !!data.dimension && data.rows.length > 0 && data.rows[0].dim !== "total";
  return (
    <div className="space-y-4">
      <KpiCards data={data} metricsMeta={metricsMeta} />
      {hasDim && (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#1a1a19]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-[#898781]">
                <th className="px-4 py-3 font-medium">{humanize(data.dimension)}</th>
                {data.metrics.map((m, i) => (
                  <th key={m} className="px-4 py-3 text-right font-medium" colSpan={hasCompare ? 3 : 1}>
                    {metricLabel(m, metricsMeta)}
                  </th>
                ))}
              </tr>
              {hasCompare && (
                <tr className="border-b border-white/10 text-right text-[11px] text-[#898781]">
                  <th className="px-4 py-1.5 text-left font-normal"></th>
                  {data.metrics.map((m) => (
                    <FragmentHeads key={m} />
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {data.rows.map((r, ri) => (
                <tr key={`${r.dim}-${ri}`} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="max-w-[280px] truncate px-4 py-2.5 text-[#c3c2b7]">
                    {data.dimension === "date" ? fmtDateLabel(r.dim) : r.dim || "(not set)"}
                    {r.bDim && (
                      <span className="ml-2 text-xs text-[#898781]">vs {fmtDateLabel(r.bDim)}</span>
                    )}
                  </td>
                  {data.metrics.map((m, mi) => {
                    const type = data.metricHeaders[mi]?.type;
                    const a = r.a[mi] ?? 0;
                    const b = r.b?.[mi];
                    return hasCompare ? (
                      <FragmentCells key={m} a={a} b={b} type={type} />
                    ) : (
                      <td key={m} className="px-4 py-2.5 text-right tabular-nums text-white">
                        {fmtValue(a, type)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

function FragmentCells({ a, b, type }: { a: number; b?: number; type?: string }) {
  return (
    <>
      <td className="px-2 py-2.5 text-right tabular-nums text-white">{fmtValue(a, type)}</td>
      <td className="px-2 py-2.5 text-right tabular-nums text-[#898781]">
        {b === undefined ? "–" : fmtValue(b, type)}
      </td>
      <td className="px-2 py-2.5 text-right">
        <Delta value={deltaPct(a, b)} />
      </td>
    </>
  );
}
