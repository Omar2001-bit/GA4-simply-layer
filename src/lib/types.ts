export type ChartType =
  | "line"
  | "area"
  | "bar"
  | "hbar"
  | "pie"
  | "donut"
  | "table"
  | "scorecard";

export const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "bar", label: "Bar" },
  { value: "hbar", label: "Horizontal Bar" },
  { value: "pie", label: "Pie" },
  { value: "donut", label: "Donut" },
  { value: "table", label: "Table" },
  { value: "scorecard", label: "Scorecard" },
];

export type RangePreset =
  | "last7"
  | "last14"
  | "last28"
  | "last30"
  | "last90"
  | "thisMonth"
  | "lastMonth"
  | "custom";

export type ComparePreset = "previousPeriod" | "samePeriodLastYear" | "custom" | "none";

export interface DateRangeSel {
  preset: RangePreset;
  start?: string; // YYYY-MM-DD when preset === custom
  end?: string;
}

export interface CompareSel {
  preset: ComparePreset;
  start?: string;
  end?: string;
}

export type FilterMatch = "contains" | "exact" | "begins" | "ends" | "regex";

export const FILTER_MATCHES: { value: FilterMatch; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "exact", label: "is exactly" },
  { value: "begins", label: "begins with" },
  { value: "ends", label: "ends with" },
  { value: "regex", label: "matches regex" },
];

export interface FilterClause {
  field: string; // GA4 dimension apiName (eventName, audienceName, country, …)
  match: FilterMatch;
  value: string;
  not?: boolean;
}

// GA4 Data API hard limits per runReport request
export const MAX_METRICS = 10;
export const MAX_DIMENSIONS = 9;

// GA4 has no per-event "count" metric — event counts are eventCount (metric)
// filtered by eventName (dimension). A "virtual" metric like "event:purchase"
// carries that intent through config.metrics/ReportRequest/ReportResponse
// unchanged in shape; the server (ga4.ts) is the only place that resolves it
// into the actual eventName-filtered eventCount query.
export const EVENT_METRIC_PREFIX = "event:";

export function isEventMetric(apiName: string): boolean {
  return apiName.startsWith(EVENT_METRIC_PREFIX);
}

export function eventMetricName(apiName: string): string {
  return apiName.slice(EVENT_METRIC_PREFIX.length);
}

export function makeEventMetric(eventName: string): string {
  return `${EVENT_METRIC_PREFIX}${eventName}`;
}

// Conversion rate for any event: eventCount for that event ÷ totalUsers (or ÷
// sessions), computed row-by-row and — separately, NOT by averaging rows —
// as totals-over-totals. Same virtual-metric trick as event:*: the server is
// the only place that resolves "convu:purchase" into real GA4 queries.
export const CONV_USER_PREFIX = "convu:";
export const CONV_SESSION_PREFIX = "convs:";
export type ConvDenom = "totalUsers" | "sessions";

export function isConvRateMetric(apiName: string): boolean {
  return apiName.startsWith(CONV_USER_PREFIX) || apiName.startsWith(CONV_SESSION_PREFIX);
}

export function convRateDenom(apiName: string): ConvDenom {
  return apiName.startsWith(CONV_USER_PREFIX) ? "totalUsers" : "sessions";
}

export function convRateEventName(apiName: string): string {
  return apiName.slice(apiName.indexOf(":") + 1);
}

export function makeConvRateMetric(eventName: string, denom: ConvDenom): string {
  return `${denom === "totalUsers" ? CONV_USER_PREFIX : CONV_SESSION_PREFIX}${eventName}`;
}

/** Metric type for conversion-rate columns — always renders as a percent,
 *  even above 100% (repeat purchases per user are a real thing), unlike
 *  TYPE_FLOAT's "only if between 0 and 1" heuristic for native GA4 rates. */
export const TYPE_RATE_PERCENT = "TYPE_RATE_PERCENT";

/** Named date-range highlight ("Campaign Launch", "Holiday Season") a user
 *  can define on a report — shaded on the chart, broken out as its own
 *  stat block in Analytics. First-matching period wins if ranges overlap. */
export interface ColorPeriod {
  id: string;
  label: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  color: string; // hex
}

// Brand-consistent preset palette for color periods — reuses the app's own
// categorical set rather than an arbitrary picker, so period highlights
// never clash with the rest of the UI.
export const COLOR_PERIOD_PALETTE = [
  "#3987e5",
  "#e6a23c",
  "#e66767",
  "#9085e9",
  "#19c2c2",
  "#d55181",
  "#d95926",
  "#c9d94a",
  "#5ea8ff",
  "#199e70",
];

export interface ReportConfig {
  id: string;
  name: string;
  description?: string;
  group?: string; // user-named group, shown as a section on the mega dashboard
  property: string; // e.g. "properties/413595793"
  dimension: string; // legacy single dimension — kept for old saved presets
  dimensions?: string[]; // GA4 dimension apiNames (0-9); [] = totals only
  metrics: string[]; // GA4 metric apiNames (1-10)
  chartType: ChartType;
  rangeA: DateRangeSel; // current / "after"
  rangeB: CompareSel; // comparison / "before"
  filters?: FilterClause[]; // ANDed dimension filters
  colorPeriods?: ColorPeriod[]; // named date-range highlights, see §8.2
  limit: number;
  createdAt: string;
  updatedAt: string;
}

/** Normalized dimension list — reads new `dimensions` or falls back to legacy `dimension`. */
export function configDimensions(c: Pick<ReportConfig, "dimension" | "dimensions">): string[] {
  if (c.dimensions) return c.dimensions.slice(0, MAX_DIMENSIONS);
  return c.dimension ? [c.dimension] : [];
}

export interface PresetsFile {
  reports: ReportConfig[];
  order?: string[];
}

// ---- report API payloads ----

export interface ResolvedRange {
  startDate: string;
  endDate: string;
}

export interface ReportRequest {
  property: string;
  dimension?: string; // legacy
  dimensions?: string[];
  metrics: string[];
  rangeA: ResolvedRange;
  rangeB?: ResolvedRange | null;
  filters?: FilterClause[];
  limit?: number;
}

export interface ReportRow {
  dim: string;
  bDim?: string; // for date-dimension comparisons: the matching date in range B
  a: number[]; // metric values for range A, aligned with metrics[]
  b?: number[]; // metric values for range B
}

export interface ReportResponse {
  metrics: string[];
  metricHeaders: { name: string; type: string }[];
  dimension: string; // first dimension ("" = totals only) — kept for existing consumers
  dimensions: string[]; // all requested dimensions in order
  rows: ReportRow[];
  totalsA: number[];
  totalsB?: number[];
  rangeA: ResolvedRange;
  rangeB?: ResolvedRange | null;
  rowCount: number;
  currencyCode?: string; // property's real currency (e.g. "EGP"), for TYPE_CURRENCY formatting
}

export interface PropertySummary {
  property: string;
  displayName: string;
  account: string;
  accountName: string;
}

export interface MetaItem {
  apiName: string;
  uiName: string;
  category: string;
  description?: string;
}

export interface MetadataResponse {
  dimensions: MetaItem[];
  metrics: MetaItem[];
}
