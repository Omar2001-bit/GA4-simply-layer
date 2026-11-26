"use client";

import { Icon } from "./Icon";
import { Delta } from "./DeltaBadge";
import { useEffect, useRef, useState } from "react";
import { resolveCompare, resolveRange } from "@/lib/dates";
import { deltaPct, fmtValue, humanizeEvent } from "@/lib/format";
import { INK_MUTED } from "@/lib/theme";
import type { CompareSel, DateRangeSel, FilterClause, UserSegmentResponse } from "@/lib/types";

interface Props {
  property: string;
  name?: string;
  conditions: FilterClause[];
  rangeA: DateRangeSel;
  rangeB?: CompareSel;
  /** event names used by the report (event:* and conversion-rate metrics) */
  events: string[];
}

interface Result {
  key: string;
  data?: UserSegmentResponse;
  error?: string;
}

interface Tile {
  label: string;
  current: number;
  previous: number | null;
  type: string;
  estimated?: boolean;
  floor?: boolean;
  apiName?: string;
  hint?: string;
}

/** A REAL GA4 user segment (users with a session matching the conditions,
 *  and everything they did in the range), computed server-side through
 *  GA4's own segment engine — see runUserSegment. Sits alongside the
 *  report, which itself stays on the exact session filter. */
export default function UserSegmentPanel({ property, name, conditions, rangeA, rangeB, events }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resolvedA = resolveRange(rangeA);
  const resolvedB = rangeB && rangeB.preset !== "none" ? resolveCompare(rangeB, resolvedA) : null;
  const divisor =
    rangeB?.preset === "multiPeriodAvg" ? Math.max(2, Math.round(rangeB.multiplier ?? 2)) : undefined;
  const requestKey = JSON.stringify({ property, conditions, resolvedA, resolvedB, divisor, events });

  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetch("/api/user-segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property,
        conditions,
        rangeA: resolvedA,
        rangeB: resolvedB,
        rangeBAverageDivisor: divisor,
        events,
      }),
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "User segment request failed");
        setResult({ key: requestKey, data: j as UserSegmentResponse });
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setResult({ key: requestKey, error: (e as Error).message });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  const tiles: Tile[] = [];
  if (data) {
    const c = data.current;
    const p = data.previous;
    const div = (a: number, b: number) => (b > 0 ? a / b : 0);
    const revEstimated = c.revenueMethod !== "exact" || (!!p && p.revenueMethod !== "exact");
    const revHint =
      c.revenueMethod === "exact"
        ? "Exact: GA4's segment engine counted the segment's purchases of every order value (binary decomposition over transaction ids). Matches Explorations within ~0.7%."
        : `GA4's hourly segment quota was spent, so this is an estimate. Exact part (sessions matching the conditions): ${fmtValue(c.revenueExact, "TYPE_CURRENCY", data.currencyCode)}; the rest is valued at returning visitors' average order value.`;
    tiles.push(
      { label: "Users", current: c.users, previous: p?.users ?? null, type: "TYPE_INTEGER", apiName: "totalUsers" },
      {
        label: "Purchasers",
        current: c.purchasers,
        previous: p?.purchasers ?? null,
        type: "TYPE_INTEGER",
        apiName: "totalPurchasers",
      },
      {
        label: "Purchases",
        current: c.purchases,
        previous: p?.purchases ?? null,
        type: "TYPE_INTEGER",
        apiName: "transactions",
      },
      {
        label: "Total revenue",
        current: c.revenue,
        previous: p?.revenue ?? null,
        type: "TYPE_CURRENCY",
        estimated: revEstimated,
        apiName: "totalRevenue",
        hint: revHint,
      },
      {
        label: "Average purchase revenue",
        current: c.avgPurchaseRevenue,
        previous: p?.avgPurchaseRevenue ?? null,
        type: "TYPE_CURRENCY",
        estimated: revEstimated,
        apiName: "averagePurchaseRevenue",
      },
      {
        label: "ARPU",
        current: div(c.revenue, c.users),
        previous: p ? div(p.revenue, p.users) : null,
        type: "TYPE_CURRENCY",
        estimated: revEstimated,
        apiName: "averageRevenuePerUser",
        hint: "Total revenue ÷ users of the segment.",
      },
      {
        label: "User conversion rate",
        current: div(c.purchasers, c.users),
        previous: p ? div(p.purchasers, p.users) : null,
        type: "TYPE_RATE_PERCENT",
        apiName: "userConversionRate",
        hint: "Purchasers ÷ users of the segment.",
      }
    );
    if (c.sessions != null) {
      tiles.push(
        {
          label: "Sessions",
          current: c.sessions,
          previous: p?.sessions ?? null,
          type: "TYPE_INTEGER",
          estimated: true,
          apiName: "sessions",
          hint: "All sessions of the segment's users. Tracks GA4 Explorations within ~+0.2–0.8% (GA4 sometimes fires session_start twice per session).",
        },
        {
          label: "Purchases per session",
          current: div(c.purchases, c.sessions),
          previous: p?.sessions ? div(p.purchases, p.sessions) : null,
          type: "TYPE_RATE_PERCENT",
          estimated: true,
          apiName: "sessionConversionRate",
          hint: "Purchases ÷ sessions of the segment's users.",
        }
      );
    }
    for (const e of events.filter((e) => e !== "purchase")) {
      tiles.push({
        label: humanizeEvent(e),
        current: c.events[e] ?? 0,
        previous: p ? p.events[e] ?? 0 : null,
        type: "TYPE_INTEGER",
        floor: c.eventsCapped.includes(e) || !!p?.eventsCapped.includes(e),
        apiName: `event:${e}`,
        hint: c.eventsCapped.includes(e)
          ? "Some users did this more than 10 times in their other sessions (GA4's funnel limit), so this is a minimum."
          : undefined,
      });
    }
  }

  return (
    <section className="animate-rise-in rounded-2xl border border-[#6ae499]/30 bg-[#0e1c26] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-white">
          <Icon name="users" size={14} className="text-[#6ae499]" />
          User segment{name ? `: ${name}` : ""}
        </h2>
        <span className="text-[11px] uppercase tracking-wider" style={{ color: INK_MUTED }}>
          GA4 segment engine
          {resolvedB && data && (
            <>
              {" · vs "}
              {data.previousPeriods > 1 ? `avg of ${data.previousPeriods} periods` : "previous period"}
            </>
          )}
        </span>
      </div>
      <p className="mb-3 text-xs leading-snug" style={{ color: INK_MUTED }}>
        Users with a session matching the conditions, and everything they did in the range — what a GA4 Exploration
        user segment shows. The cards below this panel stay on the exact session filter.
      </p>

      {error ? (
        <p className="py-4 text-center text-sm text-[#e66767]">{error}</p>
      ) : !data ? (
        <p className="py-6 text-center text-xs" style={{ color: INK_MUTED }}>
          Running GA4 segment queries…
        </p>
      ) : (
        <div className="relative">
          {loading && (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[#0e1c26]/70 text-xs"
              style={{ color: INK_MUTED }}
            >
              Refreshing…
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-xl border border-white/10 bg-[#081219] p-3" title={t.hint}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs" style={{ color: INK_MUTED }}>
                  <span className="truncate">{t.label}</span>
                  {t.estimated && (
                    <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                      estimate
                    </span>
                  )}
                </div>
                <div className="text-lg font-semibold tabular-nums text-white">
                  {t.estimated ? "≈ " : t.floor ? "≥ " : ""}
                  {fmtValue(t.current, t.type, data.currencyCode)}
                </div>
                {t.previous !== null && (
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs tabular-nums">
                    <span style={{ color: INK_MUTED }}>vs {fmtValue(t.previous, t.type, data.currencyCode)}</span>
                    <Delta value={deltaPct(t.current, t.previous)} apiName={t.apiName} prevValue={t.previous} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
