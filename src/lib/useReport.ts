"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveCompare, resolveRange } from "./dates";
import { configDimensions, type ReportConfig, type ReportResponse } from "./types";

/** Fetch report data whenever the query-relevant parts of the config change. */
export function useReport(config: ReportConfig | null) {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const queryKey = useMemo(() => {
    if (!config) return "";
    const { property, metrics, rangeA, rangeB, filters, limit } = config;
    return JSON.stringify({ property, dims: configDimensions(config), metrics, rangeA, rangeB, filters, limit });
  }, [config]);

  useEffect(() => {
    if (!config || !config.metrics.length) return;
    const a = resolveRange(config.rangeA);
    const b = resolveCompare(config.rangeB, a);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property: config.property,
        dimensions: configDimensions(config),
        metrics: config.metrics,
        rangeA: a,
        rangeB: b,
        filters: config.filters?.filter((f) => f.field && f.value),
        limit: config.limit,
      }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
        setData(json);
      })
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
