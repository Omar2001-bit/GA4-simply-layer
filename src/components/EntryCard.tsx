"use client";

import { Icon } from "./Icon";
import { CompareMetricRow, InsightBubble } from "./AnalyticsView";
import { KpiTileContent } from "./NumbersView";
import type { EngineInsight } from "@/lib/insightEngine";
import type { EntryRef, MetaItem, ReportResponse } from "@/lib/types";

interface Props {
  entry: EntryRef;
  data: ReportResponse;
  // one single-metric ReportResponse per metric with its own date override
  // (see MetricCarousel's per-graph date picker + useMetricOverrides) — used
  // INSTEAD of `data` for that metric, so a KPI tile/compare row for it
  // reflects the same custom dates its graph does, not the report's global range
  overrideData?: Record<string, ReportResponse>;
  metricsMeta?: MetaItem[];
  insightsById: Map<string, EngineInsight>; // insight id -> full engine insight
  shape: "tile" | "row"; // which section's native shell this is rendering inside
}

/** Renders any entry (kpi card, compare row, or insight) to fit whichever
 *  section it's currently in — a metric renders as a value+delta regardless
 *  of which container holds it, an insight always renders as its sentence.
 *  This is what makes "drag anything into any section" coherent: the
 *  section supplies the container shape, the entry supplies its own
 *  content. */
export default function EntryCard({ entry, data, overrideData, metricsMeta, insightsById, shape }: Props) {
  if (entry.kind === "insight") {
    const insight = insightsById.get(entry.id);
    if (!insight) return null;
    return <InsightBubble insight={insight} />;
  }
  const override = overrideData?.[entry.id];
  const effectiveData = override ?? data;
  return (
    <div className="relative">
      {shape === "tile" ? (
        <KpiTileContent apiName={entry.id} data={effectiveData} metricsMeta={metricsMeta} />
      ) : (
        <CompareMetricRow apiName={entry.id} data={effectiveData} metricsMeta={metricsMeta} />
      )}
      {override && (
        <span
          className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#6ae499]/15 text-[#6ae499]"
          title={`Custom dates for this metric: ${effectiveData.rangeA.startDate} → ${effectiveData.rangeA.endDate}, not the report's own range`}
        >
          <Icon name="calendar" size={10} />
        </span>
      )}
    </div>
  );
}
