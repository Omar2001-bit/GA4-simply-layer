"use client";

import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import ChartView, { metricLabel, type GraphViewMode } from "./ChartView";
import MetaPicker from "./MetaPicker";
import MetricJumpMenu from "./MetricJumpMenu";
import { detectGranularity, granularityDims, type TimeGranularity } from "@/lib/dates";
import { deltaPct, fmtDelta, fmtValue } from "@/lib/format";
import { DELTA_DOWN, DELTA_UP, INK_MUTED } from "@/lib/theme";
import { useReport } from "@/lib/useReport";
import {
  metricIsInverted,
  type ChartType,
  type ColorPeriod,
  type CompareSel,
  type DateRangeSel,
  type FilterClause,
  type MetaItem,
  type MetadataResponse,
  type ReportConfig,
} from "@/lib/types";

interface Props {
  metrics: string[];
  property: string;
  rangeA: DateRangeSel;
  rangeB: CompareSel;
  filters?: FilterClause[];
  limit: number;
  chartType: ChartType;
  viewMode?: GraphViewMode;
  defaultDims: string[]; // the report's own breakdown — each slide's starting point
  colorPeriods?: ColorPeriod[];
  metadata: MetadataResponse | null;
  metricsMeta?: MetaItem[];
  // controlled mode: the parent owns the active slide index (so e.g.
  // clicking a KPI card elsewhere on the page can jump the graph here)
  activeIndex?: number;
  onActiveIndexChange?: (i: number) => void;
}

const TIME_VIEWS: { value: TimeGranularity; label: string }[] = [
  { value: "date", label: "Day" },
  { value: "isoWeek", label: "Week" },
  { value: "month", label: "Month" },
];

interface SlideProps {
  metric: string;
  index: number;
  total: number;
  property: string;
  rangeA: DateRangeSel;
  rangeB: CompareSel;
  filters?: FilterClause[];
  limit: number;
  chartType: ChartType;
  viewMode?: GraphViewMode;
  dims: string[];
  onDimsChange: (dims: string[]) => void;
  colorPeriods?: ColorPeriod[];
  metadata: MetadataResponse | null;
  metricsMeta?: MetaItem[];
}

function MetricSlide({
  metric,
  index,
  total,
  property,
  rangeA,
  rangeB,
  filters,
  limit,
  chartType,
  viewMode,
  dims,
  onDimsChange,
  colorPeriods,
  metadata,
  metricsMeta,
}: SlideProps) {
  const config: ReportConfig = useMemo(
    () => ({
      id: "",
      name: "",
      property,
      dimension: dims[0] ?? "",
      dimensions: dims,
      metrics: [metric],
      chartType,
      rangeA,
      rangeB,
      filters,
      limit,
      createdAt: "",
      updatedAt: "",
    }),
    [property, dims, metric, chartType, rangeA, rangeB, filters, limit]
  );
  const { data, error, loading } = useReport(config);
  const headlineDelta = data?.totalsB ? deltaPct(data.totalsA[0] ?? 0, data.totalsB[0]) : null;
  const headlineGood = headlineDelta !== null && (metricIsInverted(metric) ? headlineDelta < 0 : headlineDelta > 0);
  const type = data?.metricHeaders[0]?.type;
  // "Day/Week/Month" is really just three quick presets for `dims` — deriving
  // the active one from `dims` (instead of separate state) means picking a
  // category dimension in the MetaPicker below automatically clears whichever
  // time view was active, and vice versa, with no state to keep in sync.
  const activeGranularity = detectGranularity(dims);

  return (
    <div className="animate-fade-in w-full">
      <div className="rounded-xl border border-white/10 bg-[#081219] p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#7f959d]">
                {index + 1} / {total}
              </span>
              <h3 className="truncate text-sm font-semibold text-white">{metricLabel(metric, metricsMeta)}</h3>
            </div>
            {data && (
              <div className="mt-0.5 flex flex-wrap items-baseline gap-2 text-xs tabular-nums">
                <span className="font-semibold text-white">
                  {fmtValue(data.totalsA[0] ?? 0, type, data.currencyCode)}
                </span>
                {data.totalsB && (
                  <>
                    <span style={{ color: INK_MUTED }}>
                      vs {fmtValue(data.totalsB[0] ?? 0, type, data.currencyCode)}
                    </span>
                    {headlineDelta !== null && (
                      <span style={{ color: headlineGood || headlineDelta === 0 ? DELTA_UP : DELTA_DOWN }} className="font-semibold">
                        {fmtDelta(headlineDelta)}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <div className="flex overflow-hidden rounded-lg border border-white/10">
              {TIME_VIEWS.map((tv) => (
                <button
                  key={tv.value}
                  type="button"
                  onClick={() => onDimsChange(granularityDims(tv.value))}
                  aria-pressed={activeGranularity === tv.value}
                  className={`focus-ring whitespace-nowrap px-2.5 py-1.5 text-[11px] transition-colors duration-150 ${
                    activeGranularity === tv.value
                      ? "bg-[#6ae499] text-[#0e1c26]"
                      : "text-[#7f959d] hover:bg-white/5 hover:text-[#c2d1d5]"
                  }`}
                >
                  {tv.label}
                </button>
              ))}
            </div>
            <div className="w-full min-w-[9rem] flex-1 sm:w-40 sm:flex-none">
              <MetaPicker
                items={metadata?.dimensions ?? []}
                selected={activeGranularity ? [] : dims}
                onToggle={(d) => onDimsChange(dims.includes(d) ? [] : [d])}
                max={1}
                placeholder="Or break down by…"
                allowNone
              />
            </div>
          </div>
        </div>
        <div className="relative">
          {loading && (
            <div className="animate-fade-in absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[#081219]/70 text-xs" style={{ color: INK_MUTED }}>
              Loading…
            </div>
          )}
          {error ? (
            <div className="flex h-56 items-center justify-center text-sm text-[#e66767]">{error}</div>
          ) : data ? (
            <ChartView
              data={data}
              chartType={chartType}
              viewMode={viewMode}
              metricIndex={0}
              metricsMeta={metricsMeta}
              colorPeriods={colorPeriods}
              height={260}
            />
          ) : (
            <div className="h-56" />
          )}
        </div>
      </div>
    </div>
  );
}

/** Each selected metric gets its own graph, one at a time — instead of every
 *  metric fighting for space (and axis scale) on one shared chart, or (the
 *  old approach) every metric's chart mounted and fetching at once, which
 *  meant a 42-metric report fired 42 concurrent GA4 requests before you'd
 *  looked at a single one. Only the active metric's slide is mounted; moving
 *  to another metric (via Prev/Next or the jump menu) fetches on demand.
 *  Each slide's breakdown dimension (including its Day/Week/Month time view)
 *  is independent and persists per metric while you browse around. */
export default function MetricCarousel({
  metrics,
  property,
  rangeA,
  rangeB,
  filters,
  limit,
  chartType,
  viewMode,
  defaultDims,
  colorPeriods,
  metadata,
  metricsMeta,
  activeIndex,
  onActiveIndexChange,
}: Props) {
  const [slideDims, setSlideDims] = useState<Record<string, string[]>>({});
  const [internalActive, setInternalActive] = useState(0);

  if (metrics.length === 0) return null;

  // clamp at render time (not via effect+setState) so a shrinking metrics
  // list — one got removed in the editor — never points past the end
  const active = Math.min(activeIndex ?? internalActive, metrics.length - 1);
  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(metrics.length - 1, i));
    if (onActiveIndexChange) onActiveIndexChange(clamped);
    else setInternalActive(clamped);
  };
  const metric = metrics[active];

  return (
    <div>
      {metrics.length > 1 && (
        <div className="mb-2 flex items-center justify-end gap-1.5">
          <MetricJumpMenu metrics={metrics} active={active} onSelect={goTo} metricsMeta={metricsMeta} />
          <button
            type="button"
            onClick={() => goTo(active - 1)}
            disabled={active === 0}
            aria-label="Previous metric"
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-[#7f959d] transition-all duration-150 hover:border-white/25 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100"
          >
            <CaretLeftIcon size={13} weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => goTo(active + 1)}
            disabled={active === metrics.length - 1}
            aria-label="Next metric"
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-[#7f959d] transition-all duration-150 hover:border-white/25 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100"
          >
            <CaretRightIcon size={13} weight="bold" />
          </button>
        </div>
      )}
      <MetricSlide
        key={metric}
        metric={metric}
        index={active}
        total={metrics.length}
        property={property}
        rangeA={rangeA}
        rangeB={rangeB}
        filters={filters}
        limit={limit}
        chartType={chartType}
        viewMode={viewMode}
        dims={slideDims[metric] ?? defaultDims}
        onDimsChange={(d) => setSlideDims((prev) => ({ ...prev, [metric]: d }))}
        colorPeriods={colorPeriods}
        metadata={metadata}
        metricsMeta={metricsMeta}
      />
    </div>
  );
}
