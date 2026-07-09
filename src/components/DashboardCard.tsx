"use client";

import Link from "next/link";
import { useMemo } from "react";
import ChartView from "./ChartView";
import { KpiCards } from "./NumbersView";
import { useReport } from "@/lib/useReport";
import type { CompareSel, DateRangeSel, ReportConfig } from "@/lib/types";

interface Props {
  report: ReportConfig;
  globalRangeA?: DateRangeSel | null; // mega-dashboard date override
  globalRangeB?: CompareSel | null;
}

export default function DashboardCard({ report, globalRangeA, globalRangeB }: Props) {
  const effective = useMemo<ReportConfig>(
    () => ({
      ...report,
      rangeA: globalRangeA ?? report.rangeA,
      rangeB: globalRangeB ?? report.rangeB,
    }),
    [report, globalRangeA, globalRangeB]
  );
  const { data, error, loading } = useReport(effective);

  return (
    <div className="group flex flex-col rounded-xl border border-white/10 bg-[#0e1c26] p-4 transition-colors hover:border-[#6ae499]/50">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/report/${report.id}`}
            className="block truncate font-semibold text-white hover:text-[#6ae499]"
          >
            {report.name}
          </Link>
          {report.description && (
            <p className="truncate text-xs text-[#7f959d]">{report.description}</p>
          )}
        </div>
        <Link
          href={`/report/${report.id}`}
          className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-[#7f959d] transition-opacity hover:border-white/25 hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
        >
          Zoom in ↗
        </Link>
      </div>
      <div className="min-h-[180px]">
        {error ? (
          <div className="flex h-44 items-center justify-center text-xs text-[#e66767]">{error}</div>
        ) : loading && !data ? (
          <div className="flex h-44 items-center justify-center text-xs text-[#7f959d]">Loading…</div>
        ) : data ? (
          <ChartView data={data} chartType={report.chartType} metricIndex={0} height={180} compact />
        ) : null}
      </div>
      {data && (
        <div className="mt-3">
          <KpiCards data={data} compact />
        </div>
      )}
    </div>
  );
}
