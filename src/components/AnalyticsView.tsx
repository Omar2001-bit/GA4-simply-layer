"use client";

import { metricLabel } from "./ChartView";
import { Delta } from "./DeltaBadge";
import { bucketOverlapsRange, detectGranularity } from "@/lib/dates";
import { deltaPct, fmtValue } from "@/lib/format";
import { analyzeReport, type EngineInsight } from "@/lib/insightEngine";
import { DELTA_DOWN, DELTA_UP, INK_MUTED } from "@/lib/theme";
import { metricIsInverted, type ColorPeriod, type MetaItem, type ReportResponse } from "@/lib/types";

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

/** The full rule engine (see lib/insightEngine.ts), plus the highlight-period
 *  comparison which needs this file's periodTotal helper. */
export function buildInsights(
  data: ReportResponse,
  metricsMeta: MetaItem[] | undefined,
  colorPeriods: ColorPeriod[] | undefined
): EngineInsight[] {
  const out = analyzeReport(data, metricsMeta);
  const granularity = detectGranularity(data.dimensions?.length ? data.dimensions : data.dimension ? [data.dimension] : []);

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
      out.push({
        id: `highlight:${m}`,
        severity: "info",
        category: "trend",
        score: 25,
        title: `"${best.period.label || "Unnamed period"}" was your strongest highlighted period for ${metricLabel(m, metricsMeta)}`,
        text: `It beat "${worst.period.label || "an unnamed period"}" by ${upPct.toFixed(1)}% (${fmtValue(best.total, type, data.currencyCode)} vs ${fmtValue(worst.total, type, data.currencyCode)}).`,
      });
    });
  }

  return out;
}

const SEVERITY_DOT: Record<EngineInsight["severity"], string> = {
  critical: DELTA_DOWN,
  good: DELTA_UP,
  warning: "#e6a23c", // existing brand amber (METRIC_COLORS)
  info: "#6ae499",
};

/** One insight's content — no section wrapper, so it can render inside
 *  whichever entry section it's currently placed in (see EntryCard). Dot
 *  color encodes severity; headline first so a client can scan, numbers
 *  underneath, and the → line is the action when the rule carries one. */
export function InsightBubble({ insight }: { insight: EngineInsight }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#081219] px-3 py-2 text-xs">
      <div className="flex items-start gap-2">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SEVERITY_DOT[insight.severity] }} />
        <span className="font-semibold leading-snug text-white">{insight.title}</span>
      </div>
      <p className="mt-0.5 pl-3.5 leading-snug text-[#c2d1d5]">{insight.text}</p>
      {insight.recommendation && (
        <div className="mt-1 flex items-start gap-2 pl-3.5">
          <span className="shrink-0 text-[#6ae499]">→</span>
          <span className="leading-snug" style={{ color: INK_MUTED }}>
            {insight.recommendation}
          </span>
        </div>
      )}
    </div>
  );
}

interface CompareRowProps {
  apiName: string;
  data: ReportResponse;
  metricsMeta?: MetaItem[];
}

/** One row's content — split out so the drag-sortable wrapper in ReportCanvas
 *  can render it without duplicating the value/delta lookup logic. */
export function CompareMetricRow({ apiName, data, metricsMeta }: CompareRowProps) {
  const i = data.metrics.indexOf(apiName);
  if (i === -1) return null;
  const a = data.totalsA[i] ?? 0;
  const b = data.totalsB?.[i];
  const d = deltaPct(a, b);
  const type = data.metricHeaders[i]?.type;
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-[#081219] px-3 py-2 text-xs">
      <span className="truncate text-[#c2d1d5]">{metricLabel(apiName, metricsMeta)}</span>
      <span className="flex shrink-0 items-center gap-2 tabular-nums">
        <span className="font-semibold text-white">{fmtValue(a, type, data.currencyCode)}</span>
        {d !== null && <Delta value={d} invert={metricIsInverted(apiName)} apiName={apiName} prevValue={b} />}
      </span>
    </div>
  );
}
