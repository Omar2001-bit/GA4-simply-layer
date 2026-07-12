"use client";

import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import ChartView, { metricLabel } from "./ChartView";
import MetaPicker from "./MetaPicker";
import { detectGranularity, granularityDims, type TimeGranularity } from "@/lib/dates";
import { deltaPct, fmtDelta, fmtValue } from "@/lib/format";
import { DELTA_DOWN, DELTA_UP, INK_MUTED } from "@/lib/theme";
import { useReport } from "@/lib/useReport";
import type {
  ChartType,
  ColorPeriod,
  CompareSel,
  DateRangeSel,
  FilterClause,
  MetaItem,
  MetadataResponse,
  ReportConfig,
} from "@/lib/types";

interface Props {
  metrics: string[];
  property: string;
  rangeA: DateRangeSel;
  rangeB: CompareSel;
  filters?: FilterClause[];
  limit: number;
  chartType: ChartType;
  defaultDims: string[]; // the report's own breakdown — each slide's starting point
  colorPeriods?: ColorPeriod[];
  metadata: MetadataResponse | null;
  metricsMeta?: MetaItem[];
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
  const type = data?.metricHeaders[0]?.type;
  // "Day/Week/Month" is really just three quick presets for `dims` — deriving
  // the active one from `dims` (instead of separate state) means picking a
  // category dimension in the MetaPicker below automatically clears whichever
  // time view was active, and vice versa, with no state to keep in sync.
  const activeGranularity = detectGranularity(dims);

  return (
    <div className="w-full shrink-0 snap-center px-1">
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
                      <span style={{ color: headlineDelta < 0 ? DELTA_DOWN : DELTA_UP }} className="font-semibold">
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

/** Each selected metric gets its own graph, current vs previous as two lines,
 *  swiped through horizontally — instead of every metric fighting for space
 *  (and axis scale) on one shared chart. Each slide's breakdown dimension
 *  (including its Day/Week/Month time view) is independent: picking "by
 *  channel" or "Weekly" on the Sessions slide doesn't touch the Purchase
 *  revenue slide sitting next to it. */
export default function MetricCarousel({
  metrics,
  property,
  rangeA,
  rangeB,
  filters,
  limit,
  chartType,
  defaultDims,
  colorPeriods,
  metadata,
  metricsMeta,
}: Props) {
  const [slideDims, setSlideDims] = useState<Record<string, string[]>>({});
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  // if metrics shrink (one got removed in the editor) keep the index in range
  useEffect(() => {
    if (active >= metrics.length) setActive(Math.max(0, metrics.length - 1));
  }, [metrics.length, active]);

  const scrollTo = (i: number) => {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(metrics.length - 1, i));
    track.scrollTo({ left: clamped * track.clientWidth, behavior: "smooth" });
    setActive(clamped);
  };

  const onScroll = () => {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const i = Math.round(track.scrollLeft / track.clientWidth);
    if (i !== active) setActive(i);
  };

  if (metrics.length === 0) return null;

  return (
    <div>
      {metrics.length > 1 && (
        <div className="mb-2 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => scrollTo(active - 1)}
            disabled={active === 0}
            aria-label="Previous metric"
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-[#7f959d] transition-all duration-150 hover:border-white/25 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100"
          >
            <CaretLeftIcon size={13} weight="bold" />
          </button>
          <div className="flex gap-1">
            {metrics.map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => scrollTo(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === active}
                className="focus-ring h-1.5 rounded-full transition-all duration-200"
                style={{ width: i === active ? 16 : 6, background: i === active ? "#6ae499" : "rgba(255,255,255,0.15)" }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => scrollTo(active + 1)}
            disabled={active === metrics.length - 1}
            aria-label="Next metric"
            className="focus-ring flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-[#7f959d] transition-all duration-150 hover:border-white/25 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:active:scale-100"
          >
            <CaretRightIcon size={13} weight="bold" />
          </button>
        </div>
      )}
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {metrics.map((m, i) => (
          <MetricSlide
            key={m}
            metric={m}
            index={i}
            total={metrics.length}
            property={property}
            rangeA={rangeA}
            rangeB={rangeB}
            filters={filters}
            limit={limit}
            chartType={chartType}
            dims={slideDims[m] ?? defaultDims}
            onDimsChange={(d) => setSlideDims((prev) => ({ ...prev, [m]: d }))}
            colorPeriods={colorPeriods}
            metadata={metadata}
            metricsMeta={metricsMeta}
          />
        ))}
      </div>
    </div>
  );
}
