"use client";

import { LightbulbIcon, TrophyIcon } from "@phosphor-icons/react";
import { metricLabel } from "./ChartView";
import { bucketOverlapsRange, detectGranularity } from "@/lib/dates";
import { deltaPct, fmtDelta, fmtValue } from "@/lib/format";
import { DELTA_DOWN, DELTA_UP, INK_MUTED } from "@/lib/theme";
import type { ColorPeriod, MetaItem, ReportResponse } from "@/lib/types";

interface Props {
  data: ReportResponse;
  metricsMeta?: MetaItem[];
  colorPeriods?: ColorPeriod[];
}

/** Sums a metric's current-period rows that fall inside a highlight period —
 *  used for the "which period performed best" comparison below. */
function periodTotal(
  data: ReportResponse,
  period: ColorPeriod,
  granularity: NonNullable<ReturnType<typeof detectGranularity>>,
  metricIdx: number
): number {
  let sum = 0;
  for (const r of data.rows) {
    if (r.dim && bucketOverlapsRange(granularity, r.dim, period.startDate, period.endDate)) {
      sum += r.a[metricIdx] ?? 0;
    }
  }
  return sum;
}

function buildInsights(data: ReportResponse, metricsMeta: MetaItem[] | undefined, colorPeriods: ColorPeriod[] | undefined) {
  const out: string[] = [];
  const hasCompare = !!data.rangeB;
  const granularity = detectGranularity(data.dimensions?.length ? data.dimensions : data.dimension ? [data.dimension] : []);

  // period-over-period, per metric — only sentences that clear a 5% bar (matches
  // the PRD's own "meaningfully higher/lower" threshold for auto-generated insights)
  if (hasCompare) {
    data.metrics.forEach((m, i) => {
      const a = data.totalsA[i] ?? 0;
      const b = data.totalsB?.[i];
      const d = deltaPct(a, b);
      if (d !== null && Math.abs(d) > 5) {
        const type = data.metricHeaders[i]?.type;
        out.push(
          `${metricLabel(m, metricsMeta)} is ${d > 0 ? "up" : "down"} ${Math.abs(d).toFixed(1)}% vs the previous period (${fmtValue(a, type, data.currencyCode)} vs ${fmtValue(b ?? 0, type, data.currencyCode)}).`
        );
      }
    });

    // cross-metric: which one moved the most, when there's more than one to compare
    if (data.metrics.length >= 2) {
      const deltas = data.metrics
        .map((m, i) => ({ m, i, d: deltaPct(data.totalsA[i] ?? 0, data.totalsB?.[i]) }))
        .filter((x): x is { m: string; i: number; d: number } => x.d !== null);
      if (deltas.length >= 2) {
        const fastest = deltas.reduce((a, b) => (Math.abs(b.d) > Math.abs(a.d) ? b : a));
        out.push(
          `${metricLabel(fastest.m, metricsMeta)} moved the most of your selected metrics, ${fmtDelta(fastest.d)} vs the previous period.`
        );
      }
    }
  }

  // best vs worst highlight period, per metric
  if (colorPeriods && colorPeriods.length >= 2 && granularity) {
    data.metrics.forEach((m, i) => {
      const totals = colorPeriods.map((p) => ({ period: p, total: periodTotal(data, p, granularity, i) }));
      const withData = totals.filter((t) => t.total > 0);
      if (withData.length < 2) return;
      const best = withData.reduce((a, b) => (b.total > a.total ? b : a));
      const worst = withData.reduce((a, b) => (b.total < a.total ? b : a));
      if (best.period.id === worst.period.id) return;
      const upPct = ((best.total - worst.total) / worst.total) * 100;
      const type = data.metricHeaders[i]?.type;
      out.push(
        `For ${metricLabel(m, metricsMeta)}, "${best.period.label || "an unnamed period"}" outperforms "${worst.period.label || "an unnamed period"}" by ${upPct.toFixed(1)}% (${fmtValue(best.total, type, data.currencyCode)} vs ${fmtValue(worst.total, type, data.currencyCode)}).`
      );
    });
  }

  return out;
}

export default function AnalyticsView({ data, metricsMeta, colorPeriods }: Props) {
  const insights = buildInsights(data, metricsMeta, colorPeriods);
  const granularity = detectGranularity(data.dimensions?.length ? data.dimensions : data.dimension ? [data.dimension] : []);
  const periodRows =
    colorPeriods && colorPeriods.length > 0 && granularity
      ? colorPeriods.map((p) => ({
          period: p,
          totals: data.metrics.map((_, i) => periodTotal(data, p, granularity, i)),
        }))
      : [];

  return (
    <div className="animate-fade-in space-y-4">
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]">
          <LightbulbIcon size={13} />
          Insights
        </h3>
        {insights.length === 0 ? (
          <p className="text-xs" style={{ color: INK_MUTED }}>
            Nothing stands out yet, add a comparison period or a highlight period to surface insights here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {insights.map((s, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-white/10 bg-[#081219] px-3 py-2 text-xs text-[#c2d1d5]">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#6ae499" }} />
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>

      {periodRows.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]">
            <TrophyIcon size={13} />
            Highlight periods
          </h3>
          <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#081219]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-[#7f959d]">
                  <th className="px-4 py-2.5 font-medium">Period</th>
                  {data.metrics.map((m) => (
                    <th key={m} className="px-4 py-2.5 text-right font-medium">
                      {metricLabel(m, metricsMeta)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periodRows.map(({ period, totals }) => {
                  const best = Math.max(...totals);
                  return (
                    <tr key={period.id} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2.5 text-[#c2d1d5]">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: period.color }} />
                        {period.label || "Unnamed period"}
                        <span className="ml-1.5 text-xs" style={{ color: INK_MUTED }}>
                          {period.startDate} → {period.endDate}
                        </span>
                      </td>
                      {totals.map((t, i) => {
                        const type = data.metricHeaders[i]?.type;
                        const isBest = t === best && totals.length > 1 && best > 0;
                        return (
                          <td
                            key={i}
                            className="px-4 py-2.5 text-right tabular-nums"
                            style={{ color: isBest ? "#6ae499" : "#ffffff" }}
                          >
                            {fmtValue(t, type, data.currencyCode)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.metrics.length >= 2 && (
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7f959d]">Compare metrics</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {data.metrics.map((m, i) => {
              const a = data.totalsA[i] ?? 0;
              const b = data.totalsB?.[i];
              const d = deltaPct(a, b);
              const type = data.metricHeaders[i]?.type;
              return (
                <div key={m} className="flex items-center justify-between rounded-lg border border-white/10 bg-[#081219] px-3 py-2 text-xs">
                  <span className="truncate text-[#c2d1d5]">{metricLabel(m, metricsMeta)}</span>
                  <span className="flex shrink-0 items-center gap-2 tabular-nums">
                    <span className="font-semibold text-white">{fmtValue(a, type, data.currencyCode)}</span>
                    {d !== null && (
                      <span style={{ color: d < 0 ? DELTA_DOWN : DELTA_UP }} className="font-medium">
                        {fmtDelta(d)}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
