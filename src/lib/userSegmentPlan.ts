// Which of a report's metrics a REAL GA4 user segment can show, and how.
// Shared by the panel (what to request + render) and the server route.

import {
  convRateEventName,
  eventMetricName,
  isConvRateMetric,
  isEventMetric,
  type UserSegmentExtra,
  type UserSegmentPlan,
} from "./types";

/** How the panel shows a supported metric. */
export type SegmentTileKind =
  | "users"
  | "newUsers"
  | "purchasers"
  | "purchases"
  | "revenue"
  | "avgPurchaseRevenue"
  | "arpu"
  | "arppu"
  | "purchaserRate"
  | "sessions"
  | "sessionsPerUser"
  | "purchasesPerSession"
  | "itemsPurchased"
  | "refunds"
  | "keyEvents"
  | "userKeyEventRate"
  | "viewsPerSession"
  | "cartToViewRate"
  | "purchaseToViewRate"
  | { event: string };

export interface PlannedMetric {
  /** report metric api name */
  metric: string;
  tile: SegmentTileKind;
}

export interface UnsupportedMetric {
  metric: string;
  reason: string;
}

/** GA4 metric -> event it counts */
const EVENT_COUNT_METRICS: Record<string, string> = {
  screenPageViews: "page_view",
  addToCarts: "add_to_cart",
  checkouts: "begin_checkout",
};

const DIRECT: Record<string, SegmentTileKind> = {
  totalUsers: "users",
  activeUsers: "users",
  totalPurchasers: "purchasers",
  transactions: "purchases",
  ecommercePurchases: "purchases",
  totalRevenue: "revenue",
  purchaseRevenue: "revenue",
  averagePurchaseRevenue: "avgPurchaseRevenue",
  averageRevenuePerUser: "arpu",
  averagePurchaseRevenuePerUser: "arpu",
  averagePurchaseRevenuePerPayingUser: "arppu",
  purchaserRate: "purchaserRate",
  sessions: "sessions",
  sessionsPerUser: "sessionsPerUser",
  itemsPurchased: "itemsPurchased",
  refundAmount: "refunds",
  keyEvents: "keyEvents",
  userKeyEventRate: "userKeyEventRate",
  screenPageViewsPerSession: "viewsPerSession",
  cartToViewRate: "cartToViewRate",
  purchaseToViewRate: "purchaseToViewRate",
};

const ENGAGEMENT = new Set([
  "engagedSessions",
  "engagementRate",
  "bounceRate",
  "averageSessionDuration",
  "userEngagementDuration",
  "screenPageViewsPerUser",
  "eventsPerSession",
  "sessionKeyEventRate",
  "dauPerMau",
  "dauPerWau",
  "wauPerMau",
  "active1DayUsers",
  "active7DayUsers",
  "active28DayUsers",
]);

function unsupportedReason(m: string): string {
  if (ENGAGEMENT.has(m) || /engag|bounce|duration|active\d+Day|dauPer|wauPer/i.test(m))
    return "engagement and session-quality fields are rejected by GA4 inside segments";
  if (/^advertiser|^returnOnAdSpend|AdCost|adClicks|adImpressions|^publisherAd|^totalAdRevenue|^organicGoogleSearch/i.test(m))
    return "ad cost and ad data aren't recorded per user, so GA4 can't segment them";
  if (/^item/i.test(m)) return "item-level counts aren't countable through GA4's segment engine (it counts events and users)";
  if (m === "newUsers")
    return "GA4 Explorations count new users differently from what its segment API exposes (measured ~15% low), so it isn’t shown";
  if (m === "eventCount") return "all events together exceed GA4's per-user counting limit";
  if (m === "firstTimePurchasers" || m === "firstTimePurchaserRate" || m === "firstTimePurchasersPerNewUser")
    return "GA4 doesn't expose 'first purchase' inside segments";
  return "not computable through GA4's segment engine";
}

/** Map a report's metrics onto the user segment. */
export function planUserSegment(metrics: string[]): {
  plan: UserSegmentPlan;
  metrics: PlannedMetric[];
  unsupported: UnsupportedMetric[];
} {
  const events = new Set<string>();
  const eventUsers = new Set<string>();
  const extras = new Set<UserSegmentExtra>();
  const planned: PlannedMetric[] = [];
  const unsupported: UnsupportedMetric[] = [];
  for (const m of metrics) {
    if (isEventMetric(m)) {
      const e = eventMetricName(m);
      events.add(e);
      planned.push({ metric: m, tile: { event: e } });
      continue;
    }
    if (isConvRateMetric(m)) {
      const e = convRateEventName(m);
      events.add(e);
      planned.push({ metric: m, tile: { event: e } });
      continue;
    }
    if (EVENT_COUNT_METRICS[m]) {
      const e = EVENT_COUNT_METRICS[m];
      events.add(e);
      planned.push({ metric: m, tile: { event: e } });
      continue;
    }
    const tile = DIRECT[m];
    if (!tile) {
      unsupported.push({ metric: m, reason: unsupportedReason(m) });
      continue;
    }
    if (tile === "newUsers") extras.add("newUsers");
    if (tile === "itemsPurchased") extras.add("itemsPurchased");
    if (tile === "refunds") extras.add("refunds");
    if (tile === "keyEvents" || tile === "userKeyEventRate") extras.add("keyEvents");
    if (tile === "viewsPerSession") events.add("page_view");
    if (tile === "cartToViewRate") ["add_to_cart", "view_item"].forEach((e) => eventUsers.add(e));
    if (tile === "purchaseToViewRate") eventUsers.add("view_item");
    planned.push({ metric: m, tile });
  }
  return {
    plan: { events: [...events], eventUsers: [...eventUsers], extras: [...extras], daily: true },
    metrics: planned,
    unsupported,
  };
}
