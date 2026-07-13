"use client";

import { FunnelIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { resolveCompare, resolveRange } from "@/lib/dates";
import { fmtValue } from "@/lib/format";
import { DELTA_DOWN, INK_MUTED, SERIES_A, SERIES_B } from "@/lib/theme";
import type { CompareSel, DateRangeSel, FunnelConfig, FunnelResponse, ResolvedRange } from "@/lib/types";

interface Props {
  property: string;
  funnel: FunnelConfig;
  rangeA: DateRangeSel;
  rangeB?: CompareSel; // when set (and not "none"), a second funnel renders for that period
}

interface Result {
  key: string;
  current?: FunnelResponse;
  previous?: FunnelResponse | null;
  error?: string;
}

/** One period's complete funnel: step bars sized against that period's own
 *  first step, continue rates and drop-offs between steps. Current period
 *  renders in the brand series color, previous in the comparison color. */
function FunnelSteps({ data, color }: { data: FunnelResponse; color: string }) {
  const steps = data.steps;
  if (steps.length === 0) {
    return (
      <p className="py-4 text-center text-xs" style={{ color: INK_MUTED }}>
        No data for this period.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {steps.map((s, i) => {
        const share = steps[0].users > 0 ? s.users / steps[0].users : 0;
        const dropped = i > 0 ? steps[i - 1].users - s.users : 0;
        return (
          <div key={i}>
            {i > 0 && (
              <div className="flex items-center justify-between px-1 py-0.5 text-[11px] tabular-nums">
                <span style={{ color: INK_MUTED }}>
                  ↳ {s.rateFromPrevious !== null ? `${(s.rateFromPrevious * 100).toFixed(1)}% continue` : "–"}
                </span>
                {dropped > 0 && (
                  <span style={{ color: DELTA_DOWN }}>−{fmtValue(dropped, "TYPE_INTEGER")} dropped</span>
                )}
              </div>
            )}
            <div className="relative h-9 overflow-hidden rounded-md bg-white/5">
              <div
                className="h-full rounded-md transition-all duration-300"
                style={{ width: `${Math.max(share * 100, 2)}%`, background: color, opacity: 0.9 }}
              />
              <div className="absolute inset-0 flex items-center justify-between px-3 text-xs">
                <span className="font-medium text-white mix-blend-difference">{s.label}</span>
                <span className="tabular-nums font-semibold text-white mix-blend-difference">
                  {fmtValue(s.users, "TYPE_INTEGER")}
                  {s.rateFromFirst !== null && (
                    <span className="ml-1.5 font-normal">({(s.rateFromFirst * 100).toFixed(1)}%)</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PeriodHeader({ label, range, data }: { label: string; range: ResolvedRange; data: FunnelResponse }) {
  const overall = data.steps.length >= 2 ? data.steps[data.steps.length - 1].rateFromFirst : null;
  return (
    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-1 text-[11px] uppercase tracking-wider" style={{ color: INK_MUTED }}>
      <span className="font-semibold text-[#c2d1d5]">{label}</span>
      <span>
        {range.startDate} → {range.endDate}
        {overall !== null && (
          <>
            {" · "}
            <span className="font-semibold text-[#6ae499]">{(overall * 100).toFixed(1)}%</span>
          </>
        )}
      </span>
    </div>
  );
}

/** One GA4-native funnel: numbers come from runFunnelReport (GA4's own
 *  funnel engine — sequencing, dedup, open/closed semantics all computed at
 *  Google), so they match what Explorations shows for the same steps. When
 *  a comparison period is set, the SAME funnel runs for both periods and
 *  they render as two complete side-by-side funnels — previous on the left,
 *  current on the right — each with its own bars and rates. */
export default function FunnelView({ property, funnel, rangeA, rangeB }: Props) {
  // one state cell keyed by the request it answers — "loading" is simply
  // "the settled result isn't for the current request", so the effect never
  // needs a synchronous setState to flip a loading flag
  const [result, setResult] = useState<Result | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resolvedA = resolveRange(rangeA);
  const resolvedB = rangeB && rangeB.preset !== "none" ? resolveCompare(rangeB, resolvedA) : null;
  const requestKey = JSON.stringify({ property, steps: funnel.steps, open: funnel.open, resolvedA, resolvedB });
  const enabled = funnel.steps.filter((s) => s.eventName).length >= 2;

  useEffect(() => {
    // <2 usable steps: nothing to fetch — the render below shows its own
    // "add steps" branch, so any stale `result` never appears anyway
    if (!enabled) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const fetchOne = async (range: { startDate: string; endDate: string }) => {
      const r = await fetch("/api/funnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property, funnel, range }),
        signal: ctrl.signal,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Funnel request failed");
      return j as FunnelResponse;
    };
    Promise.all([fetchOne(resolvedA), resolvedB ? fetchOne(resolvedB) : Promise.resolve(null)])
      .then(([current, previous]) => setResult({ key: requestKey, current, previous }))
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setResult({ key: requestKey, error: (e as Error).message });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const loading = enabled && result?.key !== requestKey;
  const data = result?.current ?? null;
  const prevData = result?.previous ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  return (
    <div className="rounded-xl border border-white/10 bg-[#081219] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <FunnelIcon size={14} className="text-[#6ae499]" />
          {funnel.name || "Untitled funnel"}
        </h3>
        <span className="text-[11px] uppercase tracking-wider" style={{ color: INK_MUTED }}>
          {funnel.open ? "Open funnel" : "Closed funnel"}
        </span>
      </div>

      {error ? (
        <p className="py-4 text-center text-sm text-[#e66767]">{error}</p>
      ) : funnel.steps.filter((s) => s.eventName).length < 2 ? (
        <p className="py-4 text-xs" style={{ color: INK_MUTED }}>
          Add at least two steps in the editor to run this funnel.
        </p>
      ) : !data ? (
        <p className="py-4 text-center text-xs" style={{ color: INK_MUTED }}>
          Loading funnel…
        </p>
      ) : (
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[#081219]/70 text-xs" style={{ color: INK_MUTED }}>
              Refreshing…
            </div>
          )}
          {prevData && resolvedB ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <PeriodHeader label="Previous" range={resolvedB} data={prevData} />
                <FunnelSteps data={prevData} color={SERIES_B} />
              </div>
              <div>
                <PeriodHeader label="Current" range={resolvedA} data={data} />
                <FunnelSteps data={data} color={SERIES_A} />
              </div>
            </div>
          ) : (
            <FunnelSteps data={data} color={SERIES_A} />
          )}
        </div>
      )}
    </div>
  );
}
