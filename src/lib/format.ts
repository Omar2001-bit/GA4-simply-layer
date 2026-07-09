/** Format a metric value according to its GA4 metric type. */
export function fmtValue(value: number, type?: string): string {
  if (!Number.isFinite(value)) return "–";
  switch (type) {
    case "TYPE_SECONDS": {
      const s = Math.round(value);
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
    }
    case "TYPE_CURRENCY":
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    case "TYPE_FLOAT": {
      // GA4 rates (bounceRate, engagementRate…) come back as 0–1 fractions
      if (value > 0 && value < 1) return `${(value * 100).toFixed(1)}%`;
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    default:
      return Math.round(value).toLocaleString();
  }
}

/** Compact display for tight spaces (cards, chart labels). */
export function fmtCompact(value: number, type?: string): string {
  if (!Number.isFinite(value)) return "–";
  if (type === "TYPE_SECONDS" || (type === "TYPE_FLOAT" && value > 0 && value < 1)) {
    return fmtValue(value, type);
  }
  if (Math.abs(value) >= 1000) {
    return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }
  return fmtValue(value, type);
}

/** Percent change of a vs b. Returns null when not computable. */
export function deltaPct(a: number, b?: number): number | null {
  if (b === undefined || !Number.isFinite(b)) return null;
  if (b === 0) return a === 0 ? 0 : null;
  return ((a - b) / Math.abs(b)) * 100;
}

export function fmtDelta(d: number | null): string {
  if (d === null) return "–";
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}%`;
}

/** "20260702" or "2026-07-02" -> "Jul 2" */
export function fmtDateLabel(raw: string): string {
  const s = raw.replaceAll("-", "");
  if (!/^\d{8}$/.test(s)) return raw;
  const d = new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Human label for a metric/dimension apiName when metadata isn't loaded. */
export function humanize(apiName: string): string {
  return apiName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
