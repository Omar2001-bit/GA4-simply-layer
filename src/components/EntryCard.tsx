"use client";

import { CompareMetricRow, InsightBubble } from "./AnalyticsView";
import { KpiTileContent } from "./NumbersView";
import type { EntryRef, MetaItem, ReportResponse } from "@/lib/types";

interface Props {
  entry: EntryRef;
  data: ReportResponse;
  metricsMeta?: MetaItem[];
  insightsById: Map<string, string>; // insight id -> sentence text
  shape: "tile" | "row"; // which section's native shell this is rendering inside
}

/** Renders any entry (kpi card, compare row, or insight sentence) to fit
 *  whichever section it's currently in — a metric renders as a value+delta
 *  regardless of which container holds it, an insight always renders as a
 *  sentence. This is what makes "drag anything into any section" coherent:
 *  the section supplies the container shape, the entry supplies its own
 *  content. */
export default function EntryCard({ entry, data, metricsMeta, insightsById, shape }: Props) {
  if (entry.kind === "insight") {
    const text = insightsById.get(entry.id);
    if (!text) return null;
    return <InsightBubble text={text} />;
  }
  return shape === "tile" ? (
    <KpiTileContent apiName={entry.id} data={data} metricsMeta={metricsMeta} />
  ) : (
    <CompareMetricRow apiName={entry.id} data={data} metricsMeta={metricsMeta} />
  );
}
