"use client";

import { Icon } from "./Icon";
import { Delta } from "./DeltaBadge";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { resolveCompare, resolveRange } from "@/lib/dates";
import { deltaPct, fmtCompact, fmtDateLabel, fmtValue, humanize, humanizeEvent } from "@/lib/format";
import { BASELINE, GRID, INK_MUTED, SERIES_A, SERIES_B, SURFACE } from "@/lib/theme";
import { planUserSegment, type SegmentTileKind } from "@/lib/userSegmentPlan";
import {
  USER_SEGMENT_BREAKDOWNS,
  type CompareSel,
  type DateRangeSel,
  type FilterClause,
  type UserSegmentBreakdownResponse,
  type UserSegmentResponse,
  type UserSegmentTotals,
} from "@/lib/types";

interface Props {
  property: string;
  name?: string;
  conditions: FilterClause[];
  rangeA: DateRangeSel;
  rangeB?: CompareSel;
  /** the report's metrics — the panel shows each one the segment can compute */
  metrics: string[];
}

interface Result<T> {
  key: string;
  data?: T;
  error?: string;
}

interface Tile {
  label: string;
  current: number | null;
  previous: number | null;
  type: string;
  estimated?: boolean;
  floor?: boolean;
  apiName?: string;
  hint?: string;
}

const div = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null ? null : b > 0 ? a / b : 0;

/** Value of one tile kind for one period (null = unavailable). */
function tileValue(kind: SegmentTileKind, t: UserSegmentTotals): number | null {
  if (typeof kind === "object") return t.events[kind.event] ?? 0;
  switch (kind) {
    case "users":
      return t.users;
    case "newUsers":
      return t.newUsers;
    case "purchasers":
      return t.purchasers;
    case "purchases":
      return t.purchases;
    case "revenue":
      return t.revenue;
    case "avgPurchaseRevenue":
      return t.avgPurchaseRevenue;
    case "arpu":
      return div(t.revenue, t.users);
    case "arppu":
      return div(t.revenue, t.purchasers);
    case "purchaserRate":
      return div(t.purchasers, t.users);
    case "sessions":
      return t.sessions;
    case "sessionsPerUser":
      return div(t.sessions, t.users);
    case "purchasesPerSession":
      return div(t.purchases, t.sessions);
    case "itemsPurchased":
      return t.itemsPurchased;
    case "refunds":
      return t.refunds;
    case "keyEvents":
      return t.keyEvents;
    case "userKeyEventRate":
      return div(t.keyEventUsers, t.users);
    case "viewsPerSession":
      return div(t.events["page_view"], t.sessions);
    case "cartToViewRate":
      return div(t.eventUsers["add_to_cart"], t.eventUsers["view_item"]);
    case "purchaseToViewRate":
      return div(t.eventUsers["purchase"], t.eventUsers["view_item"]);
  }
}

const TILE_META: Record<Exclude<SegmentTileKind, { event: string }>, { label: string; type: string; hint?: string }> = {
  users: { label: "Users", type: "TYPE_INTEGER" },
  newUsers: { label: "New users", type: "TYPE_INTEGER", hint: "Segment users with a first_visit in the range." },
  purchasers: { label: "Purchasers", type: "TYPE_INTEGER" },
  purchases: { label: "Purchases", type: "TYPE_INTEGER" },
  revenue: { label: "Total revenue", type: "TYPE_CURRENCY" },
  avgPurchaseRevenue: { label: "Average purchase revenue", type: "TYPE_CURRENCY" },
  arpu: { label: "ARPU", type: "TYPE_CURRENCY", hint: "Total revenue ÷ users of the segment." },
  arppu: { label: "ARPPU", type: "TYPE_CURRENCY", hint: "Total revenue ÷ purchasers of the segment." },
  purchaserRate: { label: "Purchaser rate", type: "TYPE_RATE_PERCENT", hint: "Purchasers ÷ users of the segment." },
  sessions: {
    label: "Sessions",
    type: "TYPE_INTEGER",
    hint: "All sessions of the segment's users. Tracks GA4 Explorations within ~+0.2–0.8% (GA4 sometimes fires session_start twice per session).",
  },
  sessionsPerUser: { label: "Sessions per user", type: "TYPE_FLOAT" },
  purchasesPerSession: { label: "Purchases per session", type: "TYPE_RATE_PERCENT", hint: "Purchases ÷ sessions." },
  itemsPurchased: {
    label: "Items purchased",
    type: "TYPE_INTEGER",
    hint: "Exact: quantities summed through GA4's segment engine per transaction.",
  },
  refunds: { label: "Refunds", type: "TYPE_CURRENCY", hint: "Exact: refund amounts summed per transaction." },
  keyEvents: { label: "Key events", type: "TYPE_INTEGER" },
  userKeyEventRate: { label: "User key event rate", type: "TYPE_RATE_PERCENT", hint: "Users with a key event ÷ users." },
  viewsPerSession: { label: "Views per session", type: "TYPE_FLOAT" },
  cartToViewRate: {
    label: "Cart-to-view rate",
    type: "TYPE_RATE_PERCENT",
    hint: "Users who added to cart ÷ users who viewed an item.",
  },
  purchaseToViewRate: {
    label: "Purchase-to-view rate",
    type: "TYPE_RATE_PERCENT",
    hint: "Purchasers ÷ users who viewed an item.",
  },
};

const REVENUE_KINDS = new Set<SegmentTileKind>(["revenue", "avgPurchaseRevenue", "arpu", "arppu"]);
const SESSION_KINDS = new Set<SegmentTileKind>(["sessions", "sessionsPerUser", "purchasesPerSession", "viewsPerSession"]);

/** A REAL GA4 user segment (users with a session matching the conditions,
 *  and everything they did in the range), computed server-side through
 *  GA4's own segment engine — see runUserSegment. Follows the report's
 *  metrics; the cards below stay on the exact session filter. */
export default function UserSegmentPanel({ property, name, conditions, rangeA, rangeB, metrics }: Props) {
  const [result, setResult] = useState<Result<UserSegmentResponse> | null>(null);
  const [bdDim, setBdDim] = useState(USER_SEGMENT_BREAKDOWNS[0].apiName);
  const [bd, setBd] = useState<Result<UserSegmentBreakdownResponse> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resolvedA = resolveRange(rangeA);
  const resolvedB = rangeB && rangeB.preset !== "none" ? resolveCompare(rangeB, resolvedA) : null;
  const divisor =
    rangeB?.preset === "multiPeriodAvg" ? Math.max(2, Math.round(rangeB.multiplier ?? 2)) : undefined;
  const { plan, metrics: planned, unsupported } = useMemo(() => {
    const base = ["totalUsers", "totalPurchasers", "transactions", "totalRevenue", "averagePurchaseRevenue", "averageRevenuePerUser", "purchaserRate", "sessions"];
    return planUserSegment([...new Set([...base, ...metrics])]);
  }, [metrics]);
  const requestKey = JSON.stringify({ property, conditions, resolvedA, resolvedB, divisor, plan });
  const segKey = JSON.stringify({ property, conditions, resolvedA });

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
        ...plan,
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

  const runBreakdown = () => {
    const key = segKey + bdDim;
    setBd({ key: key + ":loading" });
    fetch("/api/user-segment/breakdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property, conditions, range: resolvedA, dimension: bdDim }),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Breakdown failed");
        setBd({ key, data: j as UserSegmentBreakdownResponse });
      })
      .catch((e) => setBd({ key, error: (e as Error).message }));
  };

  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;

  const tiles: Tile[] = [];
  if (data) {
    const c = data.current;
    const p = data.previous;
    const revEstimated = c.revenueMethod !== "exact" || (!!p && p.revenueMethod !== "exact");
    const seen = new Set<string>();
    for (const pm of planned) {
      const kind = pm.tile;
      const id = typeof kind === "object" ? `event:${kind.event}` : kind;
      if (seen.has(id)) continue;
      seen.add(id);
      if (typeof kind === "object") {
        const e = kind.event;
        const capped = c.eventsCapped.includes(e) || !!p?.eventsCapped.includes(e);
        tiles.push({
          label: humanizeEvent(e),
          current: tileValue(kind, c),
          previous: p ? tileValue(kind, p) : null,
          type: "TYPE_INTEGER",
          floor: capped,
          apiName: pm.metric,
          hint: capped
            ? "Some users did this more than 10 times (GA4's per-user funnel limit), so this is a minimum."
            : undefined,
        });
        continue;
      }
      const meta = TILE_META[kind];
      const cur = tileValue(kind, c);
      const estimated = (REVENUE_KINDS.has(kind) && revEstimated) || SESSION_KINDS.has(kind);
      const capped =
        (kind === "keyEvents" && c.eventsCapped.includes("keyEvents")) ||
        (kind === "viewsPerSession" && c.eventsCapped.includes("page_view"));
      tiles.push({
        label: meta.label,
        current: cur,
        previous: p ? tileValue(kind, p) : null,
        type: meta.type,
        estimated,
        floor: capped,
        apiName: pm.metric,
        hint:
          kind === "revenue"
            ? c.revenueMethod === "exact"
              ? "Exact: GA4's segment engine counted the segment's purchases of every order value (binary decomposition over transaction ids). Matches Explorations within ~0.7%."
              : `GA4's hourly segment quota was spent, so this is an estimate. Exact part (sessions matching the conditions): ${fmtValue(c.revenueExact, "TYPE_CURRENCY", data.currencyCode)}.`
            : meta.hint,
      });
    }
  }

  const daily = data?.current.daily ?? [];
  const bdRows = bd?.data && bd.key === segKey + bdDim ? bd.data : null;
  const bdLoading = bd?.key === segKey + bdDim + ":loading";
  const bdError = bd?.key === segKey + bdDim ? bd.error ?? null : null;

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
        <div className="relative space-y-4">
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
                  {t.current == null ? (
                    <span className="text-sm font-normal" style={{ color: INK_MUTED }}>
                      unavailable
                    </span>
                  ) : (
                    <>
                      {t.estimated ? "≈ " : t.floor ? "≥ " : ""}
                      {fmtValue(t.current, t.type, data.currencyCode)}
                    </>
                  )}
                </div>
                {t.previous !== null && t.current !== null && (
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs tabular-nums">
                    <span style={{ color: INK_MUTED }}>vs {fmtValue(t.previous, t.type, data.currencyCode)}</span>
                    <Delta value={deltaPct(t.current, t.previous)} apiName={t.apiName} prevValue={t.previous} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {daily.length > 1 && (
            <div>
              <h3 className="mb-1 text-xs font-medium text-white">Daily purchases and revenue</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => fmtDateLabel(d.replaceAll("-", ""))}
                      stroke={BASELINE}
                      tick={{ fill: INK_MUTED, fontSize: 11 }}
                      minTickGap={24}
                    />
                    <YAxis yAxisId="p" stroke={BASELINE} tick={{ fill: INK_MUTED, fontSize: 11 }} width={36} />
                    <YAxis
                      yAxisId="r"
                      orientation="right"
                      stroke={BASELINE}
                      tick={{ fill: INK_MUTED, fontSize: 11 }}
                      tickFormatter={(v: number) => fmtCompact(v, "TYPE_CURRENCY", data.currencyCode)}
                      width={56}
                    />
                    <Tooltip
                      contentStyle={{ background: SURFACE, border: "1px solid rgba(255,255,255,0.1)", fontSize: 12 }}
                      labelFormatter={(d) => fmtDateLabel(String(d).replaceAll("-", ""))}
                      formatter={(v, n) =>
                        n === "revenue"
                          ? [fmtValue(Number(v), "TYPE_CURRENCY", data.currencyCode), "Revenue"]
                          : [fmtValue(Number(v), "TYPE_INTEGER"), "Purchases"]
                      }
                    />
                    <Bar yAxisId="p" dataKey="purchases" fill={SERIES_B} radius={[3, 3, 0, 0]} />
                    {daily.some((d) => d.revenue != null) && (
                      <Line yAxisId="r" dataKey="revenue" stroke={SERIES_A} strokeWidth={2} dot={false} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-medium text-white">Breakdown</h3>
              <select
                className="rounded-md border border-white/10 bg-[#081219] px-2 py-1 text-xs text-white"
                value={bdDim}
                onChange={(e) => setBdDim(e.target.value)}
                aria-label="Breakdown dimension"
              >
                {USER_SEGMENT_BREAKDOWNS.map((b) => (
                  <option key={b.apiName} value={b.apiName}>
                    {b.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={runBreakdown}
                disabled={bdLoading}
                className="focus-ring rounded-md bg-[#6ae499] px-2.5 py-1 text-xs font-medium text-[#020202] disabled:opacity-50"
              >
                {bdLoading ? "Running…" : "Run breakdown"}
              </button>
              <span className="text-[11px]" style={{ color: INK_MUTED }}>
                Current range, top 15 values. Uses about 40 GA4 segment queries.
              </span>
            </div>
            {bdError && <p className="text-xs text-[#e66767]">{bdError}</p>}
            {bdRows && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead style={{ color: INK_MUTED }}>
                    <tr className="border-b border-white/10 text-left">
                      <th className="py-1 pr-2 font-normal">{humanize(bdRows.dimension)}</th>
                      <th className="py-1 pr-2 text-right font-normal">Users</th>
                      <th className="py-1 pr-2 text-right font-normal">Purchasers</th>
                      <th className="py-1 pr-2 text-right font-normal">Purchases</th>
                      <th className="py-1 text-right font-normal">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="text-white">
                    {bdRows.rows.map((r) => (
                      <tr key={r.value} className="border-b border-white/5">
                        <td className="py-1 pr-2">{r.value}</td>
                        <td className="py-1 pr-2 text-right">{fmtValue(r.users, "TYPE_INTEGER")}</td>
                        <td className="py-1 pr-2 text-right">{fmtValue(r.purchasers, "TYPE_INTEGER")}</td>
                        <td className="py-1 pr-2 text-right">{fmtValue(r.purchases, "TYPE_INTEGER")}</td>
                        <td className="py-1 text-right">
                          {r.revenue == null ? "–" : fmtValue(r.revenue, "TYPE_CURRENCY", bdRows.currencyCode)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {unsupported.length > 0 && (
            <div className="rounded-lg border border-white/10 p-2 text-[11px] leading-snug" style={{ color: INK_MUTED }}>
              <span className="font-medium text-[#c2d1d5]">Not available in user segments: </span>
              {unsupported.map((u, i) => (
                <span key={u.metric}>
                  {i > 0 && "; "}
                  {humanize(u.metric)} ({u.reason})
                </span>
              ))}
              .
            </div>
          )}
        </div>
      )}
    </section>
  );
}
