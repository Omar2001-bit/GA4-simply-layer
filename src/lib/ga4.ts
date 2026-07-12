import { JWT } from "google-auth-library";
import { detectGranularity, enumerateBuckets, granularityDims } from "./dates";
import {
  convRateDenom,
  convRateEventName,
  eventMetricName,
  isConvRateMetric,
  isEventMetric,
  makeEventMetric,
  TYPE_RATE_PERCENT,
} from "./types";
import type {
  MetadataResponse,
  PropertySummary,
  ReportRequest,
  ReportResponse,
  ReportRow,
  ResolvedRange,
} from "./types";

const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";

interface SAKey {
  client_email: string;
  private_key: string;
}

function loadKey(): SAKey {
  const b64 = process.env.GA_SA_KEY_B64;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let json: string | undefined;
  if (b64) json = Buffer.from(b64, "base64").toString("utf8");
  else if (raw) json = raw;
  if (!json) throw new Error("Service account key missing: set GA_SA_KEY_B64 (base64 of the JSON key)");
  const parsed = JSON.parse(json);
  if (!parsed.client_email || !parsed.private_key) throw new Error("Service account key invalid");
  return parsed;
}

let cachedClient: JWT | null = null;

function client(): JWT {
  if (!cachedClient) {
    const key = loadKey();
    cachedClient = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
  }
  return cachedClient;
}

async function gaRequest<T>(url: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
  const res = await client().request<T>({
    url,
    method,
    data: body,
  });
  return res.data;
}

// ---------- Admin: list properties visible to the service account ----------

interface AccountSummariesResp {
  accountSummaries?: {
    account: string;
    displayName: string;
    propertySummaries?: { property: string; displayName: string }[];
  }[];
  nextPageToken?: string;
}

export async function listProperties(): Promise<PropertySummary[]> {
  const out: PropertySummary[] = [];
  let pageToken = "";
  do {
    const url = `${ADMIN_API}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const data = await gaRequest<AccountSummariesResp>(url);
    for (const acc of data.accountSummaries ?? []) {
      for (const p of acc.propertySummaries ?? []) {
        out.push({
          property: p.property,
          displayName: p.displayName,
          account: acc.account,
          accountName: acc.displayName,
        });
      }
    }
    pageToken = data.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

// ---------- Data: metadata (available dimensions/metrics) ----------

interface RawMeta {
  dimensions?: { apiName: string; uiName: string; category: string; description?: string; customDefinition?: boolean }[];
  metrics?: { apiName: string; uiName: string; category: string; description?: string; customDefinition?: boolean }[];
}

export async function getMetadata(property: string): Promise<MetadataResponse> {
  const data = await gaRequest<RawMeta>(`${DATA_API}/${property}/metadata`);
  const map = (items: RawMeta["dimensions"]) =>
    (items ?? []).map((i) => ({
      apiName: i.apiName,
      uiName: i.uiName,
      category: i.category || (i.customDefinition ? "Custom" : "Other"),
      description: i.description,
    }));
  return { dimensions: map(data.dimensions), metrics: map(data.metrics) };
}

// ---------- Data: runReport with optional comparison range ----------

interface RawReport {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string; type: string }[];
  rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
  totals?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
  rowCount?: number;
  metadata?: { currencyCode?: string };
}

const MATCH_MAP: Record<string, string> = {
  contains: "CONTAINS",
  exact: "EXACT",
  begins: "BEGINS_WITH",
  ends: "ENDS_WITH",
  // PARTIAL_REGEXP behaves like grep — matches anywhere in the value.
  // (FULL_REGEXP requires the regex to consume the entire string, which
  // silently matches nothing for the patterns people actually type.)
  regex: "PARTIAL_REGEXP",
};

function buildDimensionFilter(filters: ReportRequest["filters"]) {
  const clauses = (filters ?? []).filter((f) => f.field && f.value);
  if (!clauses.length) return undefined;
  const expressions = clauses.map((f) => {
    const filter = {
      filter: {
        fieldName: f.field,
        stringFilter: { matchType: MATCH_MAP[f.match] ?? "CONTAINS", value: f.value, caseSensitive: false },
      },
    };
    return f.not ? { notExpression: filter } : filter;
  });
  return expressions.length === 1 ? expressions[0] : { andGroup: { expressions } };
}

function buildEventNameInListFilter(names: string[]) {
  return { filter: { fieldName: "eventName", inListFilter: { values: names } } };
}

function combineFilters(...exprs: (object | undefined)[]) {
  const list = exprs.filter((e): e is object => !!e);
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  return { andGroup: { expressions: list } };
}

/** Reads a row's bucket key in the SAME format enumerateBuckets/bucketKey
 *  produce ("202628", not "2026 · 28") — used wherever a row needs to be
 *  matched against the canonical bucket sequence for its granularity, not
 *  the generic " · "-joined key used for arbitrary category dimensions. */
function readGranularityKey(
  g: "date" | "isoWeek" | "month",
  dvals: { value: string }[],
  gIdxs: number[]
): string {
  if (g === "isoWeek") {
    const isoYear = dvals[gIdxs[0]]?.value ?? "";
    const isoWeek = (dvals[gIdxs[1]]?.value ?? "").padStart(2, "0");
    return `${isoYear}${isoWeek}`;
  }
  return dvals[gIdxs[0]]?.value ?? ""; // date and month: GA4's own value already matches
}

/** Core report fetch — assumes `req.metrics` are all real GA4 metric apiNames
 *  (event:* virtual metrics are resolved separately, see runEventPivot). */
async function runCoreReport(req: ReportRequest): Promise<ReportResponse> {
  // GA4 caps: 9 dimensions, 10 metrics per request
  const dims = (req.dimensions ?? (req.dimension ? [req.dimension] : [])).slice(0, 9);
  const hasDim = dims.length > 0;
  // dims exactly matching one granularity's dim-set ("date", or
  // ["isoYear","isoWeek"], or ["yearMonth"]) is a pure time series — eligible
  // for index-aligned current/previous pairing even when the two ranges
  // don't share a single literal bucket value in common.
  const granularity = detectGranularity(dims);
  const isDateOnly = granularity !== null;
  const hasCompare = !!req.rangeB;
  const metrics = req.metrics.slice(0, 10).map((m) => ({ name: m }));
  const dimensions = dims.map((d) => ({ name: d }));
  const dimensionFilter = buildDimensionFilter(req.filters);

  const body: Record<string, unknown> = {
    dateRanges: hasCompare ? [req.rangeA, req.rangeB] : [req.rangeA],
    metrics,
    dimensions,
    // time series must never truncate mid-range; categorical rows honor the user limit
    limit: isDateOnly ? "10000" : String(Math.min(req.limit ?? 25, 1000) * (hasCompare ? 2 : 1)),
    metricAggregations: ["TOTAL"],
    keepEmptyRows: false,
  };
  if (dimensionFilter) body.dimensionFilter = dimensionFilter;
  if (granularity) {
    body.orderBys = granularityDims(granularity).map((d) => ({ dimension: { dimensionName: d } }));
  } else if (hasDim) {
    body.orderBys = [{ metric: { metricName: req.metrics[0] }, desc: true }];
  }

  const data = await gaRequest<RawReport>(`${DATA_API}/${req.property}:runReport`, "POST", body);

  const metricHeaders = (data.metricHeaders ?? []).map((h) => ({ name: h.name, type: h.type }));
  const dimHeaders = (data.dimensionHeaders ?? []).map((h) => h.name);
  // when 2 dateRanges are sent, GA4 appends a "dateRange" dimension
  const drIdx = dimHeaders.indexOf("dateRange");
  const dimIdxs = dims.map((d) => dimHeaders.indexOf(d)).filter((i) => i >= 0);

  const rowMap = new Map<string, ReportRow>();
  const order: string[] = [];
  // day-aligned overlay only works for a pure date breakdown
  const isDateCompare = isDateOnly && hasCompare;
  const gIdxs = granularity ? granularityDims(granularity).map((d) => dimHeaders.indexOf(d)) : [];
  const seriesA: { dim: string; mets: number[] }[] = [];
  const seriesB: { dim: string; mets: number[] }[] = [];
  for (const r of data.rows ?? []) {
    const dvals = r.dimensionValues ?? [];
    const mets = (r.metricValues ?? []).map((v) => Number(v.value) || 0);
    const which = drIdx >= 0 ? dvals[drIdx]?.value ?? "date_range_0" : "date_range_0";
    if (isDateCompare) {
      // dates/weeks/months differ between ranges — collect separately, align
      // by bucket index below. Keyed in the canonical bucket format (matches
      // enumerateBuckets), not the generic " · "-joined key a couple lines
      // down — those two formats silently never match each other.
      const key = readGranularityKey(granularity!, dvals, gIdxs);
      if (which === "date_range_0") seriesA.push({ dim: key, mets });
      else seriesB.push({ dim: key, mets });
      continue;
    }
    const dimVal = dimIdxs.length
      ? dimIdxs.map((idx) => dvals[idx]?.value ?? "").join(" · ")
      : "total";
    let row = rowMap.get(dimVal);
    if (!row) {
      row = { dim: dimVal, a: new Array(metrics.length).fill(0) };
      rowMap.set(dimVal, row);
      order.push(dimVal);
    }
    if (which === "date_range_0") row.a = mets;
    else row.b = mets;
  }
  if (isDateCompare) {
    // Canonical bucket-by-bucket enumeration — NOT "sort what GA4 returned
    // and zip by position." A bucket with genuinely zero of every requested
    // metric (a future week, a slow month) is dropped entirely by GA4
    // (keepEmptyRows:false), which desyncs a positional zip the moment one
    // side is short a bucket the other side has. Enumerating both sides'
    // full canonical sequence and looking values up keeps "bucket i of
    // current" paired with "bucket i of previous" regardless of which
    // buckets GA4 actually bothered to return a row for.
    const bucketsA = enumerateBuckets(granularity!, req.rangeA.startDate, req.rangeA.endDate);
    const bucketsB = req.rangeB ? enumerateBuckets(granularity!, req.rangeB.startDate, req.rangeB.endDate) : [];
    const valsA = new Map(seriesA.map((s) => [s.dim, s.mets]));
    const valsB = new Map(seriesB.map((s) => [s.dim, s.mets]));
    const n = Math.max(bucketsA.length, bucketsB.length);
    for (let i = 0; i < n; i++) {
      const kA = bucketsA[i];
      const kB = bucketsB[i];
      const key = kA ?? `b-${kB ?? i}`;
      rowMap.set(key, {
        dim: kA ?? "",
        bDim: kB,
        a: (kA ? valsA.get(kA) : undefined) ?? new Array(metrics.length).fill(0),
        b: kB ? valsB.get(kB) : undefined,
      });
      order.push(key);
    }
  }

  // totals per range
  let totalsA: number[] = new Array(metrics.length).fill(0);
  let totalsB: number[] | undefined = hasCompare ? new Array(metrics.length).fill(0) : undefined;
  const rawTotals = data.totals ?? [];
  if (rawTotals.length) {
    for (const t of rawTotals) {
      const dims = t.dimensionValues ?? [];
      const mets = (t.metricValues ?? []).map((v) => Number(v.value) || 0);
      const which = drIdx >= 0 ? dims[drIdx]?.value ?? "date_range_0" : "date_range_0";
      if (which === "date_range_0") totalsA = mets;
      else totalsB = mets;
    }
  } else {
    // fall back to summing rows
    for (const row of rowMap.values()) {
      row.a.forEach((v, i) => (totalsA[i] += v));
      if (row.b && totalsB) row.b.forEach((v, i) => (totalsB![i] += v));
    }
  }

  let rows = order.map((k) => rowMap.get(k)!);
  const limit = Math.min(req.limit ?? 25, 1000);
  if (isDateCompare) {
    // already aligned + ordered by bucket index
  } else if (isDateOnly) {
    rows = rows.sort((x, y) => x.dim.localeCompare(y.dim)); // never truncate a pure time series
  } else {
    rows = rows.sort((x, y) => (y.a[0] ?? 0) - (x.a[0] ?? 0)).slice(0, limit);
  }

  return {
    metrics: req.metrics,
    metricHeaders,
    dimension: dims[0] ?? "",
    dimensions: dims,
    rows,
    totalsA,
    totalsB,
    rangeA: req.rangeA,
    rangeB: req.rangeB ?? null,
    rowCount: data.rowCount ?? rows.length,
    currencyCode: data.metadata?.currencyCode,
  };
}

// ---------- Data: per-event counts (eventCount × eventName, resolved from "event:*" virtual metrics) ----------

interface PivotRow {
  dim: string;
  bDim?: string;
  a: number[]; // aligned to `eventNames` order, not the full metric list
  b?: number[];
}

interface PivotResult {
  rows: PivotRow[];
  totalsA: number[];
  totalsB?: number[];
}

/** Resolves N "event:*" virtual metrics into real GA4 data: one eventCount ×
 *  eventName query (filtered to just the requested events), reshaped into N
 *  columns aligned with `eventNames` order. Keyed identically to how
 *  runCoreReport keys its own rows, so the two merge cleanly by `dim`. */
async function runEventPivot(opts: {
  property: string;
  dims: string[]; // the report's real breakdown dims (excluding eventName)
  eventNames: string[];
  rangeA: ResolvedRange;
  rangeB?: ResolvedRange | null;
  filters?: ReportRequest["filters"];
  limit?: number;
}): Promise<PivotResult> {
  const { property, dims, eventNames, rangeA, rangeB, filters, limit } = opts;
  const hasCompare = !!rangeB;
  const granularity = detectGranularity(dims);
  const isDateOnly = granularity !== null;
  const n = eventNames.length;
  const eventIndex = new Map(eventNames.map((name, i) => [name, i]));
  const blank = () => new Array(n).fill(0);

  const pivotDims = [...dims, "eventName"];
  const dimensionFilter = combineFilters(buildDimensionFilter(filters), buildEventNameInListFilter(eventNames));

  const body: Record<string, unknown> = {
    dateRanges: hasCompare ? [rangeA, rangeB] : [rangeA],
    metrics: [{ name: "eventCount" }],
    dimensions: pivotDims.map((d) => ({ name: d })),
    limit: isDateOnly ? "10000" : String(Math.min(limit ?? 25, 1000) * (hasCompare ? 2 : 1) * Math.max(n, 1)),
    keepEmptyRows: false,
  };
  if (dimensionFilter) body.dimensionFilter = dimensionFilter;
  if (granularity) body.orderBys = granularityDims(granularity).map((d) => ({ dimension: { dimensionName: d } }));

  const data = await gaRequest<RawReport>(`${DATA_API}/${property}:runReport`, "POST", body);
  const dimHeaders = (data.dimensionHeaders ?? []).map((h) => h.name);
  const drIdx = dimHeaders.indexOf("dateRange");
  const evIdx = dimHeaders.indexOf("eventName");
  const restIdxs = dims.map((d) => dimHeaders.indexOf(d)).filter((i) => i >= 0);

  if (granularity && hasCompare) {
    // Canonical bucket-by-bucket enumeration instead of trusting GA4 to
    // return a dense row per bucket — once eventName joins the breakdown,
    // buckets with zero of a given event are genuinely absent
    // (keepEmptyRows:false), not just zero-filled. "Bucket i of current"
    // still pairs with "bucket i of previous" the same way runCoreReport's
    // own date-compare alignment does, generalized to week/month buckets.
    const gIdxs = granularityDims(granularity).map((d) => dimHeaders.indexOf(d));
    const bucketsA = enumerateBuckets(granularity, rangeA.startDate, rangeA.endDate);
    const bucketsB = rangeB ? enumerateBuckets(granularity, rangeB.startDate, rangeB.endDate) : [];
    const valsA = new Map<string, number[]>();
    const valsB = new Map<string, number[]>();
    for (const r of data.rows ?? []) {
      const dvals = r.dimensionValues ?? [];
      const key = readGranularityKey(granularity, dvals, gIdxs);
      const ev = dvals[evIdx]?.value ?? "";
      const idx = eventIndex.get(ev);
      if (idx === undefined) continue;
      const count = Number(r.metricValues?.[0]?.value) || 0;
      const which = drIdx >= 0 ? dvals[drIdx]?.value ?? "date_range_0" : "date_range_0";
      const target = which === "date_range_0" ? valsA : valsB;
      const arr = target.get(key) ?? blank();
      arr[idx] = count;
      target.set(key, arr);
    }
    const len = Math.max(bucketsA.length, bucketsB.length);
    const rows: PivotRow[] = [];
    const totalsA = blank();
    const totalsB = hasCompare ? blank() : undefined;
    for (let i = 0; i < len; i++) {
      const kA = bucketsA[i];
      const kB = bucketsB[i];
      const a = kA ? (valsA.get(kA) ?? blank()) : blank();
      const b = kB ? valsB.get(kB) ?? blank() : undefined;
      a.forEach((v, k) => (totalsA[k] += v));
      b?.forEach((v, k) => (totalsB![k] += v));
      rows.push({ dim: kA ?? "", bDim: kB, a, b });
    }
    return { rows, totalsA, totalsB };
  }

  // Generic path: key by the report's real dims only (dropping eventName
  // from the key) — same convention runCoreReport's non-date-compare branch
  // uses, so current/previous pair up whenever the rest-of-dims literally
  // match, and pivot rows merge with base rows by identical `dim` string.
  const rowMap = new Map<string, PivotRow>();
  const order: string[] = [];
  for (const r of data.rows ?? []) {
    const dvals = r.dimensionValues ?? [];
    const key = restIdxs.length ? restIdxs.map((idx) => dvals[idx]?.value ?? "").join(" · ") : "total";
    const ev = dvals[evIdx]?.value ?? "";
    const idx = eventIndex.get(ev);
    if (idx === undefined) continue;
    const count = Number(r.metricValues?.[0]?.value) || 0;
    const which = drIdx >= 0 ? dvals[drIdx]?.value ?? "date_range_0" : "date_range_0";
    let row = rowMap.get(key);
    if (!row) {
      row = { dim: key, a: blank(), b: hasCompare ? blank() : undefined };
      rowMap.set(key, row);
      order.push(key);
    }
    if (which === "date_range_0") row.a[idx] = count;
    else if (row.b) row.b[idx] = count;
  }

  let rows = order.map((k) => rowMap.get(k)!);
  const lim = Math.min(limit ?? 25, 1000);
  if (isDateOnly) {
    rows = rows.sort((x, y) => x.dim.localeCompare(y.dim)); // never truncate a pure time series
  } else {
    rows = rows.sort((x, y) => (y.a[0] ?? 0) - (x.a[0] ?? 0)).slice(0, lim);
  }

  const totalsA = blank();
  const totalsB = hasCompare ? blank() : undefined;
  for (const row of rows) {
    row.a.forEach((v, k) => (totalsA[k] += v));
    row.b?.forEach((v, k) => (totalsB![k] += v));
  }
  return { rows, totalsA, totalsB };
}

/** Splices real-metric columns (from runCoreReport), event-metric columns
 *  (from runEventPivot), and conversion-rate columns (event count ÷ users or
 *  ÷ sessions, from the same pivot plus a small totalUsers/sessions query)
 *  back into `rawMetrics`' original order. Rows union across all three
 *  sources by `dim` key — a date can legitimately appear in only one (e.g.
 *  zero of every chosen real metric but the selected event still fired, or
 *  there was traffic that day but zero of the event, which still needs a row
 *  so the conversion rate reads 0% instead of silently vanishing). */
function mergeReports(
  req: ReportRequest,
  rawMetrics: string[],
  realMetrics: string[],
  eventNames: string[],
  convRateMetrics: string[],
  base: ReportResponse | null,
  pivot: PivotResult | null,
  denom: ReportResponse | null, // metrics always [totalUsers, sessions] when present
  dims: string[]
): ReportResponse {
  const hasCompare = !!req.rangeB;
  const nTotal = rawMetrics.length;
  const blank = () => new Array(nTotal).fill(0);
  const realIdxInRaw = realMetrics.map((m) => rawMetrics.indexOf(m));
  const eventIdxInRaw = eventNames.map((name) => rawMetrics.indexOf(makeEventMetric(name)));
  // for each conv-rate metric: which pivot column (event) and which denom column (0=totalUsers, 1=sessions) feeds it
  const convRateInfo = convRateMetrics.map((m) => ({
    rawI: rawMetrics.indexOf(m),
    eventIdx: eventNames.indexOf(convRateEventName(m)),
    denomIdx: convRateDenom(m) === "totalUsers" ? 0 : 1,
  }));

  const metricHeaders = rawMetrics.map((m) => {
    if (isConvRateMetric(m)) return { name: m, type: TYPE_RATE_PERCENT };
    if (isEventMetric(m)) return { name: m, type: "TYPE_INTEGER" };
    const i = realMetrics.indexOf(m);
    return base?.metricHeaders[i] ?? { name: m, type: "TYPE_INTEGER" };
  });

  const rowMap = new Map<string, ReportRow>();
  const order: string[] = [];
  const ensureRow = (dim: string, bDim?: string): ReportRow => {
    let row = rowMap.get(dim);
    if (!row) {
      row = { dim, bDim, a: blank(), b: hasCompare ? blank() : undefined };
      rowMap.set(dim, row);
      order.push(dim);
    } else if (!row.bDim && bDim) {
      row.bDim = bDim;
    }
    return row;
  };

  if (base) {
    for (const r of base.rows) {
      const row = ensureRow(r.dim, r.bDim);
      realIdxInRaw.forEach((rawI, i) => {
        row.a[rawI] = r.a[i] ?? 0;
        if (row.b && r.b) row.b[rawI] = r.b[i] ?? 0;
      });
    }
  }
  if (pivot) {
    for (const r of pivot.rows) {
      const row = ensureRow(r.dim, r.bDim);
      eventIdxInRaw.forEach((rawI, i) => {
        row.a[rawI] = r.a[i] ?? 0;
        if (row.b && r.b) row.b[rawI] = r.b[i] ?? 0;
      });
    }
  }
  // denom rows aren't written into any column directly — they're read back
  // out below by dim key — but still need to exist in the row set so a day
  // with traffic and zero of the event reads 0%, not "missing".
  if (denom) {
    for (const r of denom.rows) ensureRow(r.dim, r.bDim);
  }

  const rateOf = (count: number, denomVal: number | undefined) =>
    denomVal && denomVal > 0 ? count / denomVal : 0;

  if (convRateInfo.length) {
    const denomByDim = new Map(denom?.rows.map((r) => [r.dim, r]) ?? []);
    const pivotByDim = new Map(pivot?.rows.map((r) => [r.dim, r]) ?? []);
    for (const dim of order) {
      const row = rowMap.get(dim)!;
      const pRow = pivotByDim.get(dim);
      const dRow = denomByDim.get(dim);
      for (const { rawI, eventIdx, denomIdx } of convRateInfo) {
        row.a[rawI] = rateOf(pRow?.a[eventIdx] ?? 0, dRow?.a[denomIdx]);
        if (row.b) row.b[rawI] = rateOf(pRow?.b?.[eventIdx] ?? 0, dRow?.b?.[denomIdx]);
      }
    }
  }

  const totalsA = blank();
  const totalsB = hasCompare ? blank() : undefined;
  if (base) {
    realIdxInRaw.forEach((rawI, i) => {
      totalsA[rawI] = base.totalsA[i] ?? 0;
      if (totalsB && base.totalsB) totalsB[rawI] = base.totalsB[i] ?? 0;
    });
  }
  if (pivot) {
    eventIdxInRaw.forEach((rawI, i) => {
      totalsA[rawI] = pivot.totalsA[i] ?? 0;
      if (totalsB && pivot.totalsB) totalsB[rawI] = pivot.totalsB[i] ?? 0;
    });
  }
  // conversion-rate totals are totals-over-totals, never an average of the
  // per-row rates above (a week where one huge day skews the daily rate
  // would otherwise misrepresent the week's real aggregate rate).
  for (const { rawI, eventIdx, denomIdx } of convRateInfo) {
    totalsA[rawI] = pivot && denom ? rateOf(pivot.totalsA[eventIdx] ?? 0, denom.totalsA[denomIdx]) : 0;
    if (totalsB && pivot?.totalsB && denom?.totalsB) {
      totalsB[rawI] = rateOf(pivot.totalsB[eventIdx] ?? 0, denom.totalsB[denomIdx]);
    }
  }

  return {
    metrics: rawMetrics,
    metricHeaders,
    dimension: dims[0] ?? "",
    dimensions: dims,
    rows: order.map((k) => rowMap.get(k)!),
    totalsA,
    totalsB,
    rangeA: req.rangeA,
    rangeB: req.rangeB ?? null,
    rowCount: order.length,
    currencyCode: base?.currencyCode ?? denom?.currencyCode,
  };
}

/** Public entry point. Splits three kinds of metric out of `req.metrics`:
 *  real GA4 apiNames, `event:*` virtual metrics (per-event counts — GA4 has
 *  no such metric natively, it's eventCount filtered by eventName), and
 *  `convu:*`/`convs:*` virtual metrics (that event's count ÷ totalUsers or
 *  ÷ sessions). Each kind runs as its own query — real metrics and the
 *  event-count pivot share one pivot call across both event: and conv:
 *  metrics referencing the same event — then everything merges back into
 *  the caller's original metric order. */
export async function runReport(req: ReportRequest): Promise<ReportResponse> {
  const rawMetrics = req.metrics.slice(0, 10);
  const realMetrics = rawMetrics.filter((m) => !isEventMetric(m) && !isConvRateMetric(m));
  const convRateMetrics = rawMetrics.filter(isConvRateMetric);
  const eventNames = [
    ...new Set([
      ...rawMetrics.filter(isEventMetric).map(eventMetricName),
      ...convRateMetrics.map(convRateEventName),
    ]),
  ];
  const needsDenom = convRateMetrics.length > 0;

  if (eventNames.length === 0 && !needsDenom) {
    return runCoreReport({ ...req, metrics: realMetrics });
  }

  const dims = (req.dimensions ?? (req.dimension ? [req.dimension] : [])).slice(0, 9);
  const denomMetrics: ["totalUsers", "sessions"] = ["totalUsers", "sessions"];
  const [base, pivot, denom] = await Promise.all([
    realMetrics.length > 0 ? runCoreReport({ ...req, metrics: realMetrics }) : Promise.resolve(null),
    eventNames.length > 0
      ? runEventPivot({
          property: req.property,
          dims,
          eventNames,
          rangeA: req.rangeA,
          rangeB: req.rangeB,
          filters: req.filters,
          limit: req.limit,
        })
      : Promise.resolve(null),
    needsDenom ? runCoreReport({ ...req, metrics: denomMetrics }) : Promise.resolve(null),
  ]);

  return mergeReports(req, rawMetrics, realMetrics, eventNames, convRateMetrics, base, pivot, denom, dims);
}
