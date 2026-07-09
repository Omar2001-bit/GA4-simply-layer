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

export interface ReportConfig {
  id: string;
  name: string;
  description?: string;
  property: string; // e.g. "properties/413595793"
  dimension: string; // GA4 dimension apiName, "" = totals only
  metrics: string[]; // GA4 metric apiNames (1-5)
  chartType: ChartType;
  rangeA: DateRangeSel; // current / "after"
  rangeB: CompareSel; // comparison / "before"
  limit: number;
  createdAt: string;
  updatedAt: string;
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
  dimension: string;
  metrics: string[];
  rangeA: ResolvedRange;
  rangeB?: ResolvedRange | null;
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
  dimension: string;
  rows: ReportRow[];
  totalsA: number[];
  totalsB?: number[];
  rangeA: ResolvedRange;
  rangeB?: ResolvedRange | null;
  rowCount: number;
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
