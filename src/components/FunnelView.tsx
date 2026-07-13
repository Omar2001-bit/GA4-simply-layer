"use client";

import { FunnelIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { resolveRange } from "@/lib/dates";
import { fmtValue } from "@/lib/format";
import { DELTA_DOWN, INK_MUTED, SERIES_A } from "@/lib/theme";
import type { DateRangeSel, FunnelConfig, FunnelResponse } from "@/lib/types";

interface Props {
  property: string;
  funnel: FunnelConfig;
  rangeA: DateRangeSel;
}

/** One GA4-native funnel: numbers come from runFunnelReport (GA4's own
 *  funnel engine — sequencing, dedup, open/closed semantics all computed at
 *  Google), so they match what Explorations shows for the same steps. Each
 *  step is a bar sized by its share of step-1 users, with the continue rate
 *  between steps and the drop-off called out. */
export default function FunnelView({ property, funnel, rangeA }: Props) {
  // one state cell keyed by the request it answers — "loading" is simply
  // "the settled result isn't for the current request", so the effect never
  // needs a synchronous setState to flip a loading flag
  const [result, setResult] = useState<{ key: string; data?: FunnelResponse; error?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resolved = resolveRange(rangeA);
  const requestKey = JSON.stringify({ property, steps: funnel.steps, open: funnel.open, resolved });
  const enabled = funnel.steps.filter((s) => s.eventName).length >= 2;

  useEffect(() => {
    // <2 usable steps: nothing to fetch — the render below shows its own
    // "add steps" branch, so any stale `result` never appears anyway
    if (!enabled) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetch("/api/funnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property, funnel, range: resolved }),
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Funnel request failed");
        setResult({ key: requestKey, data: j });
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setResult({ key: requestKey, error: (e as Error).message });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const loading = enabled && result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  const steps = data?.steps ?? [];
  const overall = steps.length >= 2 ? steps[steps.length - 1].rateFromFirst : null;

  return (
    <div className="rounded-xl border border-white/10 bg-[#081219] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <FunnelIcon size={14} className="text-[#6ae499]" />
          {funnel.name || "Untitled funnel"}
        </h3>
        <span className="text-[11px] uppercase tracking-wider" style={{ color: INK_MUTED }}>
          {funnel.open ? "Open funnel" : "Closed funnel"}
          {overall !== null && (
            <>
              {" · "}
              <span className="font-semibold text-[#6ae499]">{(overall * 100).toFixed(1)}%</span> complete
            </>
          )}
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
        <div className="relative space-y-1">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[#081219]/70 text-xs" style={{ color: INK_MUTED }}>
              Refreshing…
            </div>
          )}
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
                    style={{ width: `${Math.max(share * 100, 2)}%`, background: SERIES_A, opacity: 0.9 }}
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
      )}
    </div>
  );
}
