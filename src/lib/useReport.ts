"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveCompare, resolveRange } from "./dates";
import {
  configDimensions,
  reportFilters,
  type CompareSel,
  type DateRangeSel,
  type FilterClause,
  type ReportConfig,
  type ReportResponse,
} from "./types";

/** Resolves a range pair into the POST body /api/report expects, including
 *  the multiPeriodAvg divisor — shared by useReport and useMetricOverrides
 *  so a per-metric override fetches exactly the way the main report would. */
function buildReportBody(opts: {
  property: string;
  dimensions: string[];
  metrics: string[];
  rangeA: DateRangeSel;
  rangeB: CompareSel;
  filters?: FilterClause[];
  limit: number;
}) {
  const a = resolveRange(opts.rangeA);
  const b = resolveCompare(opts.rangeB, a);
  const rangeBAverageDivisor =
    opts.rangeB.preset === "multiPeriodAvg" ? Math.max(2, Math.round(opts.rangeB.multiplier ?? 2)) : undefined;
  return {
    property: opts.property,
    dimensions: opts.dimensions,
    metrics: opts.metrics,
    rangeA: a,
    rangeB: b,
    filters: opts.filters?.filter((f) => f.field && f.value),
    limit: opts.limit,
    rangeBAverageDivisor,
  };
}

async function fetchReport(body: unknown, signal?: AbortSignal): Promise<ReportResponse> {
  const res = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as ReportResponse;
}

/** Fetch report data whenever the query-relevant parts of the config change. */
export function useReport(config: ReportConfig | null) {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const queryKey = useMemo(() => {
    if (!config) return "";
    const { property, metrics, rangeA, rangeB, limit } = config;
    const filters = reportFilters(config);
    return JSON.stringify({ property, dims: configDimensions(config), metrics, rangeA, rangeB, filters, limit });
  }, [config]);

  useEffect(() => {
    if (!config || !config.metrics.length) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    fetchReport(
      buildReportBody({
        property: config.property,
        dimensions: configDimensions(config),
        metrics: config.metrics,
        rangeA: config.rangeA,
        rangeB: config.rangeB,
        filters: reportFilters(config),
        limit: config.limit,
      }),
      ctrl.signal
    )
      .then(setData)
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  return { data, error, loading };
}

/** One single-metric ReportResponse per entry in config.metricDateOverrides,
 *  keyed by apiName — lets a KPI tile/compare row for an overridden metric
 *  read its own date range instead of the report's global one, same as its
 *  graph already does. Same breakdown dims, filters, and limit as the main
 *  report so a metric's numbers stay consistent whichever card shows it. */
export function useMetricOverrides(config: ReportConfig | null): Record<string, ReportResponse> {
  const [data, setData] = useState<Record<string, ReportResponse>>({});
  const overrides = config?.metricDateOverrides;

  const queryKey = useMemo(() => {
    if (!config || !overrides || Object.keys(overrides).length === 0) return "";
    const { property, limit } = config;
    const filters = reportFilters(config);
    return JSON.stringify({ property, dims: configDimensions(config), filters, limit, overrides });
  }, [config, overrides]);

  useEffect(() => {
    if (!queryKey || !config || !overrides) {
      setData({});
      return;
    }
    let cancelled = false;
    const dims = configDimensions(config);
    Promise.all(
      Object.entries(overrides).map(([metric, o]) =>
        fetchReport(
          buildReportBody({
            property: config.property,
            dimensions: dims,
            metrics: [metric],
            rangeA: o.rangeA,
            rangeB: o.rangeB,
            filters: reportFilters(config),
            limit: config.limit,
          })
        )
          .then((r): [string, ReportResponse | null] => [metric, r])
          .catch((): [string, ReportResponse | null] => [metric, null])
      )
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, ReportResponse> = {};
      for (const [metric, r] of entries) if (r) next[metric] = r;
      setData(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  return data;
}

export function newReportId(): string {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** A blank slate: no metrics, no dimension — the builder invites the user to fill it. */
export function defaultReport(property: string): ReportConfig {
  const now = new Date().toISOString();
  return {
    id: newReportId(),
    name: "Untitled report",
    description: "",
    property,
    dimension: "",
    dimensions: [],
    metrics: [],
    chartType: "line",
    rangeA: { preset: "last28" },
    rangeB: { preset: "previousPeriod" },
    filters: [],
    limit: 25,
    createdAt: now,
    updatedAt: now,
  };
}
