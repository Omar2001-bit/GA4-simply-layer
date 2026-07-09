"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompact, fmtDateLabel, fmtDelta, fmtValue, deltaPct, humanize } from "@/lib/format";
import {
  BASELINE,
  CATEGORICAL,
  DELTA_DOWN,
  DELTA_UP,
  GRID,
  INK,
  INK_MUTED,
  INK_SECONDARY,
  SERIES_A,
  SERIES_B,
  SURFACE,
} from "@/lib/theme";
import type { ChartType, ReportResponse } from "@/lib/types";

interface Props {
  data: ReportResponse;
  chartType: ChartType;
  metricIndex: number; // which metric drives line/area/bar/pie
  height?: number;
  compact?: boolean; // mini mode for dashboard cards
}

interface Datum {
  name: string;
  bName?: string;
  a: number;
  b?: number;
  [k: string]: unknown;
}

function buildData(data: ReportResponse, metricIndex: number): Datum[] {
  const isDate = data.dimension === "date";
  return data.rows.map((r) => ({
    name: isDate ? fmtDateLabel(r.dim) : r.dim || "(not set)",
    bName: r.bDim ? fmtDateLabel(r.bDim) : undefined,
    a: r.a[metricIndex] ?? 0,
    b: r.b ? r.b[metricIndex] ?? 0 : undefined,
  }));
}

const tooltipStyle = {
  backgroundColor: SURFACE,
  border: `1px solid ${GRID}`,
  borderRadius: 8,
  color: INK,
  fontSize: 12,
};

function ChartTooltip({
  active,
  payload,
  label,
  metricType,
  hasCompare,
}: {
  active?: boolean;
  payload?: { payload: Datum }[];
  label?: string;
  metricType?: string;
  hasCompare: boolean;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const delta = deltaPct(d.a, d.b);
  return (
    <div style={tooltipStyle} className="px-3 py-2 shadow-lg">
      <div style={{ color: INK_SECONDARY }} className="mb-1 font-medium">
        {label}
      </div>
      <div className="flex items-center gap-2">
        <span style={{ background: SERIES_A }} className="inline-block h-2 w-2 rounded-full" />
        <span>{fmtValue(d.a, metricType)}</span>
      </div>
      {hasCompare && d.b !== undefined && (
        <>
          <div className="flex items-center gap-2">
            <span style={{ background: SERIES_B }} className="inline-block h-2 w-2 rounded-full" />
            <span style={{ color: INK_SECONDARY }}>
              {fmtValue(d.b, metricType)}
              {d.bName ? ` · ${d.bName}` : ""}
            </span>
          </div>
          <div style={{ color: delta !== null && delta < 0 ? DELTA_DOWN : DELTA_UP }} className="mt-1 font-semibold">
            {fmtDelta(delta)}
          </div>
        </>
      )}
    </div>
  );
}

export default function ChartView({ data, chartType, metricIndex, height = 320, compact = false }: Props) {
  const rows = buildData(data, metricIndex);
  const metricType = data.metricHeaders[metricIndex]?.type;
  const metricName = data.metrics[metricIndex] ?? "";
  const hasCompare = !!data.rangeB;
  const axisTick = { fill: INK_MUTED, fontSize: compact ? 10 : 11 };
  const yFmt = (v: number) => fmtCompact(v, metricType);
  const rangeLegend =
    hasCompare && !compact ? (
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs" style={{ color: INK_SECONDARY }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES_A }} />
          {data.rangeA.startDate} → {data.rangeA.endDate}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES_B }} />
          {data.rangeB!.startDate} → {data.rangeB!.endDate}
        </span>
      </div>
    ) : null;

  if (chartType === "scorecard" || rows.length === 0) {
    // scorecard handled by NumbersView; here show totals as hero fallback
    const a = data.totalsA[metricIndex] ?? 0;
    const b = data.totalsB?.[metricIndex];
    const delta = deltaPct(a, b);
    return (
      <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-1">
        <div style={{ color: INK_MUTED }} className="text-xs uppercase tracking-wider">
          {humanize(metricName)}
        </div>
        <div style={{ color: INK }} className="text-5xl font-semibold">
          {fmtValue(a, metricType)}
        </div>
        {delta !== null && (
          <div style={{ color: delta < 0 ? DELTA_DOWN : DELTA_UP }} className="text-sm font-medium">
            {fmtDelta(delta)} vs comparison
          </div>
        )}
      </div>
    );
  }

  if (chartType === "pie" || chartType === "donut") {
    // cap at 8 fixed-order slices; fold the tail into "Other"
    const top = rows.slice(0, 8);
    const rest = rows.slice(8);
    const slices = [...top];
    if (rest.length) {
      slices.push({ name: "Other", a: rest.reduce((s, r) => s + r.a, 0), b: undefined });
    }
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="a"
            nameKey="name"
            innerRadius={chartType === "donut" ? "55%" : 0}
            outerRadius="85%"
            paddingAngle={2}
            stroke={SURFACE}
            strokeWidth={2}
          >
            {slices.map((s, i) => (
              <Cell key={s.name} fill={i < 8 ? CATEGORICAL[i % 8] : INK_MUTED} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v) => fmtValue(Number(v), metricType)}
          />
          {!compact && <Legend wrapperStyle={{ color: INK_SECONDARY, fontSize: 12 }} />}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "hbar") {
    const h = compact ? height : Math.max(height, rows.length * 34 + 60);
    return (
      <div>
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={axisTick} tickFormatter={yFmt} stroke={BASELINE} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ ...axisTick, fill: INK_SECONDARY }}
            width={compact ? 80 : 140}
            stroke={BASELINE}
          />
          <Tooltip
            content={<ChartTooltip metricType={metricType} hasCompare={hasCompare} />}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar dataKey="a" fill={SERIES_A} radius={[0, 4, 4, 0]} maxBarSize={18} />
          {hasCompare && <Bar dataKey="b" fill={SERIES_B} radius={[0, 4, 4, 0]} maxBarSize={18} />}
        </BarChart>
      </ResponsiveContainer>
      {rangeLegend}
      </div>
    );
  }

  if (chartType === "bar") {
    return (
      <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ right: 12 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" tick={axisTick} stroke={BASELINE} interval="preserveStartEnd" />
          <YAxis tick={axisTick} tickFormatter={yFmt} stroke={BASELINE} width={48} />
          <Tooltip
            content={<ChartTooltip metricType={metricType} hasCompare={hasCompare} />}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar dataKey="a" fill={SERIES_A} radius={[4, 4, 0, 0]} maxBarSize={22} />
          {hasCompare && <Bar dataKey="b" fill={SERIES_B} radius={[4, 4, 0, 0]} maxBarSize={22} />}
        </BarChart>
      </ResponsiveContainer>
      {rangeLegend}
      </div>
    );
  }

  if (chartType === "area") {
    return (
      <div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={rows} margin={{ right: 12 }}>
          <defs>
            <linearGradient id="fillA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES_A} stopOpacity={0.35} />
              <stop offset="100%" stopColor={SERIES_A} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" tick={axisTick} stroke={BASELINE} interval="preserveStartEnd" />
          <YAxis tick={axisTick} tickFormatter={yFmt} stroke={BASELINE} width={48} />
          <Tooltip content={<ChartTooltip metricType={metricType} hasCompare={hasCompare} />} />
          <Area type="monotone" dataKey="a" stroke={SERIES_A} strokeWidth={2} fill="url(#fillA)" dot={false} />
          {hasCompare && (
            <Area
              type="monotone"
              dataKey="b"
              stroke={SERIES_B}
              strokeWidth={2}
              strokeDasharray="5 4"
              fill="none"
              dot={false}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
      {rangeLegend}
      </div>
    );
  }

  // default: line
  return (
    <div>
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ right: 12 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={axisTick} stroke={BASELINE} interval="preserveStartEnd" />
        <YAxis tick={axisTick} tickFormatter={yFmt} stroke={BASELINE} width={48} />
        <Tooltip content={<ChartTooltip metricType={metricType} hasCompare={hasCompare} />} />
        <Line type="monotone" dataKey="a" stroke={SERIES_A} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        {hasCompare && (
          <Line
            type="monotone"
            dataKey="b"
            stroke={SERIES_B}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 4 }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
    {rangeLegend}
    </div>
  );
}
