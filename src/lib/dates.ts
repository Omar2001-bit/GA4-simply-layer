import type { CompareSel, DateRangeSel, ResolvedRange } from "./types";

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** Resolve a range selection to concrete YYYY-MM-DD dates. GA4 data lags ~1 day, so "last N" ends yesterday. */
export function resolveRange(sel: DateRangeSel, today = new Date()): ResolvedRange {
  const yesterday = addDays(today, -1);
  switch (sel.preset) {
    case "last7":
      return { startDate: fmt(addDays(yesterday, -6)), endDate: fmt(yesterday) };
    case "last14":
      return { startDate: fmt(addDays(yesterday, -13)), endDate: fmt(yesterday) };
    case "last28":
      return { startDate: fmt(addDays(yesterday, -27)), endDate: fmt(yesterday) };
    case "last30":
      return { startDate: fmt(addDays(yesterday, -29)), endDate: fmt(yesterday) };
    case "last90":
      return { startDate: fmt(addDays(yesterday, -89)), endDate: fmt(yesterday) };
    case "thisMonth": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: fmt(start), endDate: fmt(yesterday < start ? start : yesterday) };
    }
    case "lastMonth": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: fmt(start), endDate: fmt(end) };
    }
    case "custom":
      return { startDate: sel.start || fmt(addDays(yesterday, -27)), endDate: sel.end || fmt(yesterday) };
  }
}

/** Resolve the comparison ("before") range relative to range A. */
export function resolveCompare(sel: CompareSel, rangeA: ResolvedRange): ResolvedRange | null {
  if (sel.preset === "none") return null;
  if (sel.preset === "custom") {
    return { startDate: sel.start || rangeA.startDate, endDate: sel.end || rangeA.endDate };
  }
  const start = new Date(rangeA.startDate + "T00:00:00");
  const end = new Date(rangeA.endDate + "T00:00:00");
  if (sel.preset === "samePeriodLastYear") {
    const s = new Date(start);
    s.setFullYear(s.getFullYear() - 1);
    const e = new Date(end);
    e.setFullYear(e.getFullYear() - 1);
    return { startDate: fmt(s), endDate: fmt(e) };
  }
  // previousPeriod: same length, immediately before A
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return { startDate: fmt(addDays(start, -days)), endDate: fmt(addDays(start, -1)) };
}

export const RANGE_PRESETS: { value: string; label: string }[] = [
  { value: "last7", label: "Last 7 days" },
  { value: "last14", label: "Last 14 days" },
  { value: "last28", label: "Last 28 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "last90", label: "Last 90 days" },
  { value: "thisMonth", label: "This month" },
  { value: "lastMonth", label: "Last month" },
  { value: "custom", label: "Custom" },
];

export const COMPARE_PRESETS: { value: string; label: string }[] = [
  { value: "previousPeriod", label: "Previous period" },
  { value: "samePeriodLastYear", label: "Same period last year" },
  { value: "custom", label: "Custom" },
  { value: "none", label: "No comparison" },
];
