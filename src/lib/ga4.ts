import { JWT } from "google-auth-library";
import { detectGranularity, enumerateBuckets, granularityDims, multiPeriodChunks } from "./dates";
import {
  convRateDenom,
  convRateEventName,
  eventMetricName,
  isConvRateMetric,
  isEventMetric,
  isNonAdditiveGa4Metric,
  isPeriodSplitSensitive,
  type SegmentScope,
  type UserSegmentBreakdownResponse,
  type UserSegmentBreakdownRow,
  type UserSegmentDay,
  type UserSegmentPlan,
  type UserSegmentResponse,
  USER_SEGMENT_PAGE_FIELDS,
  type UserSegmentTotals,
  makeEventMetric,
  TYPE_RATE_PERCENT,
} from "./types";
import type {
  FunnelConfig,
  FunnelResponse,
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

// GA4 allows 10 concurrent requests per property; funnel (segment) calls are
// also the expensive ones (~60 tokens each, 14k tokens/project/hour), so they
// go through a small semaphore, retry on 429, and are cached in memory.
const FUNNEL_CONCURRENCY = 4;
const FUNNEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const funnelCache = new Map<string, { at: number; data: unknown }>();
let funnelActive = 0;
const funnelQueue: (() => void)[] = [];

async function withFunnelSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (funnelActive >= FUNNEL_CONCURRENCY) await new Promise<void>((r) => funnelQueue.push(r));
  funnelActive++;
  try {
    return await fn();
  } finally {
    funnelActive--;
    funnelQueue.shift()?.();
  }
}

/** request counters (diagnostics / load-cost measurement) */
export const gaRequestStats = { core: 0, funnel: 0, cacheHits: 0 };

async function gaRequestOnce<T>(url: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  if (url.includes(":runFunnelReport")) gaRequestStats.funnel++;
  else gaRequestStats.core++;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await client().request<T>({ url, method, data: body });
      return res.data;
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: { message?: string } } } };
      const status = err.response?.status;
      const msg = err.response?.data?.error?.message ?? "";
      // concurrency 429s clear in seconds; an exhausted hourly token pool does not
      if (status === 429 && !/Exhausted/i.test(msg) && attempt < 5) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

async function gaRequest<T>(url: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
  if (!url.includes(":runFunnelReport")) return gaRequestOnce<T>(url, method, body);
  const key = url + "\u0001" + JSON.stringify(body);
  const hit = funnelCache.get(key);
  // ranges touching today/yesterday still change: keep those only 15 minutes
  const recent = [0, 1].some((d) => key.includes(new Date(Date.now() - d * 864e5).toISOString().slice(0, 10)));
  const ttl = recent ? 15 * 60 * 1000 : FUNNEL_CACHE_TTL_MS;
  if (hit && Date.now() - hit.at < ttl) {
    gaRequestStats.cacheHits++;
    return hit.data as T;
  }
  const data = await withFunnelSlot(() => gaRequestOnce<T>(url, method, body));
  funnelCache.set(key, { at: Date.now(), data });
  if (funnelCache.size > 5000) funnelCache.delete(funnelCache.keys().next().value!);
  return data;
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

// GA4's own hard cap — not a limit this app imposes. runCoreReport chunks
// arbitrarily many metrics into batches of this size and merges the results,
// so callers (and the UI) never have to think about it.
const GA4_METRIC_CAP = 10;

function chunkMetrics(metrics: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < metrics.length; i += GA4_METRIC_CAP) out.push(metrics.slice(i, i + GA4_METRIC_CAP));
  return out.length ? out : [[]];
}

/** Restricts a later metric-chunk's query to exactly the dimension-value
 *  combinations the FIRST chunk's own sort+limit already chose — otherwise
 *  each chunk would independently rank rows by its own first metric and
 *  every chunk beyond the first could return a different top-N row set,
 *  silently misaligning columns that are supposed to describe the same row.
 *  Not needed (and not called) for a pure time-series or totals-only
 *  breakdown, where the row set is already canonical and identical across
 *  every chunk by construction. */
function buildRowRestrictFilter(dims: string[], dimValues: string[]): object | undefined {
  if (!dimValues.length) return undefined;
  if (dims.length === 1) {
    return { filter: { fieldName: dims[0], inListFilter: { values: dimValues, caseSensitive: true } } };
  }
  const expressions = dimValues.map((combo) => {
    const parts = combo.split(" · ");
    return {
      andGroup: {
        expressions: dims.map((d, i) => ({
          filter: { fieldName: d, stringFilter: { matchType: "EXACT", value: parts[i] ?? "", caseSensitive: true } },
        })),
      },
    };
  });
  return expressions.length === 1 ? expressions[0] : { orGroup: { expressions } };
}

/** Column-concatenates N metric-chunk responses (same dims/ranges/filters,
 *  different metrics) into one. Rows are matched by dim+bDim key, not
 *  position — chunk 2+ may legitimately come back in a different row order
 *  than chunk 1 once a restrict filter is involved. */
function mergeCoreReportChunks(first: ReportResponse, rest: ReportResponse[]): ReportResponse {
  const all = [first, ...rest];
  const hasCompare = !!first.totalsB;
  const restMaps = rest.map((c) => new Map(c.rows.map((r) => [`${r.dim} ${r.bDim ?? ""}`, r])));
  const rows = first.rows.map((r) => {
    const key = `${r.dim} ${r.bDim ?? ""}`;
    const a = [...r.a, ...rest.flatMap((c, i) => restMaps[i].get(key)?.a ?? c.metrics.map(() => 0))];
    const b = hasCompare
      ? [
          ...(r.b ?? r.a.map(() => 0)),
          ...rest.flatMap((c, i) => restMaps[i].get(key)?.b ?? restMaps[i].get(key)?.a ?? c.metrics.map(() => 0)),
        ]
      : undefined;
    return { dim: r.dim, bDim: r.bDim, a, b };
  });
  return {
    metrics: all.flatMap((c) => c.metrics),
    metricHeaders: all.flatMap((c) => c.metricHeaders),
    dimension: first.dimension,
    dimensions: first.dimensions,
    rows,
    totalsA: all.flatMap((c) => c.totalsA),
    totalsB: hasCompare ? all.flatMap((c) => c.totalsB ?? c.metrics.map(() => 0)) : undefined,
    rangeA: first.rangeA,
    rangeB: first.rangeB,
    rowCount: first.rowCount,
    currencyCode: first.currencyCode,
  };
}

/** Core report fetch — assumes `req.metrics` are all real GA4 metric apiNames
 *  (event:* virtual metrics are resolved separately, see runEventPivot). Any
 *  number of metrics is supported: batches of GA4_METRIC_CAP run as separate
 *  requests and merge back into one response. */
async function runCoreReport(req: ReportRequest, rowRestrict?: object): Promise<ReportResponse> {
  // GA4 caps dimensions at 9 per request; metrics are chunked below instead of capped.
  const dims = (req.dimensions ?? (req.dimension ? [req.dimension] : [])).slice(0, 9);
  const chunks = chunkMetrics(req.metrics);
  const first = await runCoreReportChunk(req, chunks[0], dims, rowRestrict);
  if (chunks.length === 1) return first;

  const granularity = detectGranularity(dims);
  // categorical (non-time-series) breakdown: chunk 1's sort+limit picked a
  // specific top-N row set — pin every later chunk to that exact set.
  const needsRestrict = dims.length > 0 && !granularity;
  const restrictFilter = needsRestrict ? buildRowRestrictFilter(dims, first.rows.map((r) => r.dim)) : undefined;
  const rest = await Promise.all(
    chunks.slice(1).map((m) => runCoreReportChunk(req, m, dims, combineFilters(rowRestrict, restrictFilter)))
  );
  return mergeCoreReportChunks(first, rest);
}

async function runCoreReportChunk(
  req: ReportRequest,
  metricsChunk: string[],
  dims: string[],
  extraFilter?: object
): Promise<ReportResponse> {
  const hasDim = dims.length > 0;
  // dims exactly matching one granularity's dim-set ("date", or
  // ["isoYear","isoWeek"], or ["yearMonth"]) is a pure time series — eligible
  // for index-aligned current/previous pairing even when the two ranges
  // don't share a single literal bucket value in common.
  const granularity = detectGranularity(dims);
  const isDateOnly = granularity !== null;
  const hasCompare = !!req.rangeB;
  const metrics = metricsChunk.map((m) => ({ name: m }));
  const dimensions = dims.map((d) => ({ name: d }));
  const dimensionFilter = combineFilters(buildDimensionFilter(req.filters), extraFilter);

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
    body.orderBys = [{ metric: { metricName: metricsChunk[0] }, desc: true }];
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
    rawTotals.forEach((t, ti) => {
      // A range with no data at all comes back as an EMPTY totals entry ({}):
      // no dimensionValues, no metricValues. It must stay zeros — and must not
      // be mistaken for date_range_0, or it wipes Current's real totals (seen
      // live: a property with no data in last year's comparison range).
      if (!t.metricValues?.length) return;
      const dims = t.dimensionValues ?? [];
      const mets = t.metricValues.map((v) => Number(v.value) || 0);
      const which = drIdx >= 0 ? dims[drIdx]?.value ?? `date_range_${ti}` : "date_range_0";
      if (which === "date_range_0") totalsA = mets;
      else totalsB = mets;
    });
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
    metrics: metricsChunk,
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
  rowRestrict?: object; // pins a categorical breakdown to a pre-chosen row set
}): Promise<PivotResult> {
  const { property, dims, eventNames, rangeA, rangeB, filters, limit, rowRestrict } = opts;
  const hasCompare = !!rangeB;
  const granularity = detectGranularity(dims);
  const isDateOnly = granularity !== null;
  const n = eventNames.length;
  const eventIndex = new Map(eventNames.map((name, i) => [name, i]));
  const blank = () => new Array(n).fill(0);

  const pivotDims = [...dims, "eventName"];
  const dimensionFilter = combineFilters(
    buildDimensionFilter(filters),
    buildEventNameInListFilter(eventNames),
    rowRestrict
  );

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
      // undefined (not zeros) when GA4 had none of these events that bucket —
      // see mergeReports' lazyB: "no data" must stay distinguishable
      const b = kB ? valsB.get(kB) : undefined;
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

  // Rows are keyed by BOTH sides' bucket. Keying by `dim` alone collapses
  // every previous-only bucket of a date compare (dim "" — the previous
  // window is longer than current, e.g. multiPeriodAvg's N x D days) into a
  // single row, which silently broke the N-period day-by-day average for any
  // report mixing real metrics with event:/conv: metrics. All three sources
  // (base, pivot, denom) enumerate the same canonical buckets, so the
  // composite key lines them up exactly; categorical rows have no bDim.
  const rowKey = (r: { dim: string; bDim?: string }) => `${r.dim}|${r.bDim ?? ""}`;
  // Time-series compare: a previous bucket GA4 returned NO data for keeps
  // b === undefined (same as runCoreReport's own date-compare rows) instead
  // of a zero-filled array, so multiPeriodAvg can tell "no data that day"
  // (skipped when averaging a ratio — there's no ratio to average) apart
  // from "data, and the value is 0". Zero-filling here made the same report
  // average differently depending on whether it also had event/conv metrics
  // (verified live, Misimu: avg purchase revenue for a day off by 10x).
  // Categorical rows keep zero-filled b as before.
  const lazyB = hasCompare && !!detectGranularity(dims);
  const rowMap = new Map<string, ReportRow>();
  const order: string[] = [];
  const ensureRow = (dim: string, bDim?: string): ReportRow => {
    const k = rowKey({ dim, bDim });
    let row = rowMap.get(k);
    if (!row) {
      row = { dim, bDim, a: blank(), b: hasCompare && !lazyB ? blank() : undefined };
      rowMap.set(k, row);
      order.push(k);
    }
    return row;
  };
  const ensureB = (row: ReportRow) => (row.b ??= blank());

  if (base) {
    for (const r of base.rows) {
      const row = ensureRow(r.dim, r.bDim);
      const b = r.b ? ensureB(row) : row.b;
      realIdxInRaw.forEach((rawI, i) => {
        row.a[rawI] = r.a[i] ?? 0;
        if (b && r.b) b[rawI] = r.b[i] ?? 0;
      });
    }
  }
  if (pivot) {
    for (const r of pivot.rows) {
      const row = ensureRow(r.dim, r.bDim);
      const b = r.b ? ensureB(row) : row.b;
      eventIdxInRaw.forEach((rawI, i) => {
        row.a[rawI] = r.a[i] ?? 0;
        if (b && r.b) b[rawI] = r.b[i] ?? 0;
      });
    }
  }
  // denom rows aren't written into any column directly — they're read back
  // out below by dim key — but still need to exist in the row set so a day
  // with traffic and zero of the event reads 0%, not "missing".
  if (denom) {
    for (const r of denom.rows) {
      const row = ensureRow(r.dim, r.bDim);
      if (r.b) ensureB(row);
    }
  }

  const rateOf = (count: number, denomVal: number | undefined) =>
    denomVal && denomVal > 0 ? count / denomVal : 0;

  if (convRateInfo.length) {
    const denomByDim = new Map(denom?.rows.map((r) => [rowKey(r), r]) ?? []);
    const pivotByDim = new Map(pivot?.rows.map((r) => [rowKey(r), r]) ?? []);
    for (const k of order) {
      const row = rowMap.get(k)!;
      const pRow = pivotByDim.get(k);
      const dRow = denomByDim.get(k);
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

/** Turns a multiPeriodAvg previous-period response into something actually
 *  comparable to Current, day by day. rangeB was resolved (see
 *  resolveCompare in dates.ts) as N contiguous copies of rangeA's own
 *  length, oldest chunk first, ending right where Current begins — so chunk
 *  N-1 is "the period immediately before Current" (ordinary previousPeriod),
 *  chunk N-2 is the one before that, and so on.
 *
 *  Naively pairing Current's day i with the i-th day of that whole N x D-day
 *  window pairs Current's day 1 against the OLDEST chunk's day 1 — e.g. N=4
 *  compares this week against a week from ~3 periods ago, reading as "why is
 *  this comparing to May". What's actually wanted: Current's day i vs the
 *  AVERAGE of day i across all N chunks (each chunk's own day i, same
 *  relative offset from its own period start) — that's the real N-period
 *  average, day-aligned, and it's what totalsB already equals in aggregate
 *  (sum of these N-period-averaged days over the whole window == the grand
 *  total / N, so this stays consistent with the totals-only consumers).
 *
 *  Conversion-rate columns (convu:* and convs:*) AND native GA4 ratio metrics
 *  (averagePurchaseRevenue, bounceRate, engagementRate, etc.) are never divided
 *  by N — see isNonAdditiveGa4Metric in types.ts. GA4 already returns those
 *  as a computed ratio for whatever range/day they're queried over, not a
 *  summable count; dividing one by N silently halves/quarters it. For these,
 *  totalsB is passed through as GA4 returned it, and each day-offset's value
 *  is a plain mean of however many chunks actually had a row that day (a
 *  chunk-day GA4 dropped — keepEmptyRows:false — has no valid ratio to
 *  average in, unlike an additive metric where "dropped" correctly means
 *  "zero that day"). Additive metrics keep dividing by the fixed N, with a
 *  dropped chunk-day contributing 0 (it must still count toward N — treating
 *  it as "skip and shrink the denominator" disagrees with totalsB, which is
 *  always /N, and inflates the daily average whenever any chunk had a quiet
 *  day).
 *  Categorical (non-date) breakdowns have no day-offset concept, so each
 *  row's raw sum is just divided by N as before (rate metrics excepted). */
function averagePreviousPeriod(resp: ReportResponse, divisor: number): ReportResponse {
  if (!(divisor > 1) || !resp.totalsB) return resp;
  const isNonAdditive = resp.metrics.map((m) => isConvRateMetric(m) || isNonAdditiveGa4Metric(m));
  const divideArr = (arr: number[]) => arr.map((v, i) => (isNonAdditive[i] ? v : v / divisor));
  const totalsB = divideArr(resp.totalsB);

  const granularity = detectGranularity(resp.dimensions);
  if (!granularity) {
    return { ...resp, totalsB, rows: resp.rows.map((r) => (r.b ? { ...r, b: divideArr(r.b) } : r)) };
  }

  const currRows = resp.rows.filter((r) => r.dim);
  const d = currRows.length;
  if (d === 0) return { ...resp, totalsB };
  // the whole N x D-day previous window, one entry per real day, chronological
  // (oldest first) — every row carries bDim/b in this mode, even the ones
  // with no matching current-side day (dim === "")
  const prevDaily = resp.rows.filter((r) => r.bDim !== undefined).map((r) => r.b);
  const n = Math.max(1, Math.round(prevDaily.length / d));
  const nMetrics = resp.metrics.length;

  const rows: ReportRow[] = currRows.map((r, i) => {
    const sum = new Array<number>(nMetrics).fill(0);
    let seenCount = 0;
    for (let k = 0; k < n; k++) {
      const day = prevDaily[k * d + i];
      if (!day) continue;
      seenCount++;
      day.forEach((v, mi) => (sum[mi] += v));
    }
    const b = sum.map((v, mi) => (isNonAdditive[mi] ? (seenCount > 0 ? v / seenCount : 0) : v / n));
    return { dim: r.dim, a: r.a, b };
  });

  return { ...resp, totalsB, rows };
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
  const resp = await runReportExact(req);
  return req.rangeBAverageDivisor
    ? applyPerPeriodMeans(req, averagePreviousPeriod(resp, req.rangeBAverageDivisor))
    : resp;
}

function reqDims(req: ReportRequest): string[] {
  return (req.dimensions ?? (req.dimension ? [req.dimension] : [])).slice(0, 9);
}

function isCategorical(dims: string[]): boolean {
  return dims.length > 0 && !detectGranularity(dims);
}

/** Rows + totals for one request, before any multiPeriodAvg treatment.
 *
 *  For a categorical breakdown (channels, pages, countries…) GA4's own row
 *  limit is the enemy of exactness, verified live:
 *   - with a compare, current and previous rows share ONE limit, so a row can
 *     come back with only one side (the other silently reads 0);
 *   - real metrics, the event pivot and the conv-rate denominator each rank
 *     and truncate their own row set, so a row can be missing its events;
 *   - event-count totals were the sum of only the shown rows, and so were
 *     GA4 totals of any metric chunk after the first 10.
 *  So: choose the row set ONCE (top N by the report's first metric over
 *  Current — what the table sorts by), pin every query to exactly that set,
 *  and take totals from a separate no-breakdown query, which is GA4's own
 *  true total for the whole filtered range, not a sum of visible rows. */
async function runReportExact(req: ReportRequest, rowRestrict?: object): Promise<ReportResponse> {
  const dims = reqDims(req);
  if (isCategorical(dims) && !rowRestrict) {
    const restrict = await pickTopRows(req, dims);
    const [rows, totals] = await Promise.all([
      runReportRows(req, restrict),
      runReportRows({ ...req, dimensions: [], dimension: undefined }),
    ]);
    return { ...rows, totalsA: totals.totalsA, totalsB: totals.totalsB };
  }
  return runReportRows(req, rowRestrict);
}

/** The categorical row set the table will show: top `limit` dimension values
 *  by the report's first metric over Current (event count for event:/conv:
 *  metrics). Returns a filter pinning queries to exactly those rows, or
 *  undefined when Current has no rows at all. */
async function pickTopRows(req: ReportRequest, dims: string[]): Promise<object | undefined> {
  const first = req.metrics[0];
  const event = isEventMetric(first) ? eventMetricName(first) : isConvRateMetric(first) ? convRateEventName(first) : null;
  const metric = event ? "eventCount" : first;
  const body: Record<string, unknown> = {
    dateRanges: [req.rangeA],
    metrics: [{ name: metric }],
    dimensions: dims.map((name) => ({ name })),
    limit: String(Math.min(req.limit ?? 25, 1000)),
    orderBys: [{ metric: { metricName: metric }, desc: true }],
    keepEmptyRows: false,
  };
  const filter = combineFilters(
    buildDimensionFilter(req.filters),
    event ? { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: event } } } : undefined
  );
  if (filter) body.dimensionFilter = filter;
  const keyOf = (r: { dimensionValues?: { value?: string }[] }) =>
    dims.map((_, i) => r.dimensionValues?.[i]?.value ?? "").join(" · ");
  const data = await gaRequest<RawReport>(`${DATA_API}/${req.property}:runReport`, "POST", body);
  const limit = Math.min(req.limit ?? 25, 1000);
  const keys = (data.rows ?? []).map(keyOf);

  // Fewer rows than the limit: a row can be zero on the first metric over
  // Current yet still have activity in another chosen metric, or only in
  // Previous (GA4's own compare table shows it either way). Fill the free
  // slots with any row that has data in the report's metrics in either range.
  if (keys.length < limit) {
    const seen = new Set(keys);
    const realMetrics = req.metrics.filter((m) => !isEventMetric(m) && !isConvRateMetric(m)).slice(0, GA4_METRIC_CAP);
    const eventNames = [
      ...new Set(
        req.metrics.flatMap((m) =>
          isEventMetric(m) ? [eventMetricName(m)] : isConvRateMetric(m) ? [convRateEventName(m)] : []
        )
      ),
    ];
    const ranges = req.rangeB ? [req.rangeA, req.rangeB] : [req.rangeA];
    const fillQueries: Record<string, unknown>[] = [];
    if (realMetrics.length)
      fillQueries.push({ metrics: realMetrics.map((name) => ({ name })), filter: buildDimensionFilter(req.filters) });
    if (eventNames.length)
      fillQueries.push({
        metrics: [{ name: "eventCount" }],
        filter: combineFilters(buildDimensionFilter(req.filters), buildEventNameInListFilter(eventNames)),
      });
    const fills = await Promise.all(
      fillQueries.map((q) => {
        const b: Record<string, unknown> = {
          dateRanges: ranges,
          metrics: q.metrics,
          dimensions: dims.map((name) => ({ name })),
          limit: String(limit * ranges.length),
          keepEmptyRows: false,
        };
        if (q.filter) b.dimensionFilter = q.filter;
        return gaRequest<RawReport>(`${DATA_API}/${req.property}:runReport`, "POST", b);
      })
    );
    for (const f of fills) {
      for (const r of f.rows ?? []) {
        if (keys.length >= limit) break;
        const hasData = (r.metricValues ?? []).some((v) => Number(v.value) !== 0);
        const k = keyOf(r);
        if (hasData && !seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }
  }
  return buildRowRestrictFilter(dims, keys);
}

async function runReportRows(req: ReportRequest, rowRestrict?: object): Promise<ReportResponse> {
  const rawMetrics = req.metrics;
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
    return runCoreReport({ ...req, metrics: realMetrics }, rowRestrict);
  }

  const dims = reqDims(req);
  const denomMetrics: ["totalUsers", "sessions"] = ["totalUsers", "sessions"];
  const [base, pivot, denom] = await Promise.all([
    realMetrics.length > 0 ? runCoreReport({ ...req, metrics: realMetrics }, rowRestrict) : Promise.resolve(null),
    eventNames.length > 0
      ? runEventPivot({
          property: req.property,
          dims,
          eventNames,
          rangeA: req.rangeA,
          rangeB: req.rangeB,
          filters: req.filters,
          limit: req.limit,
          rowRestrict,
        })
      : Promise.resolve(null),
    needsDenom ? runCoreReport({ ...req, metrics: denomMetrics }, rowRestrict) : Promise.resolve(null),
  ]);

  return mergeReports(req, rawMetrics, realMetrics, eventNames, convRateMetrics, base, pivot, denom, dims);
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** "Average of N previous periods", the way it's done by hand in GA4.
 *
 *  averagePreviousPeriod pools the whole N x D-day window into one query and
 *  divides by N. That's exact for additive counts and revenue, but NOT for
 *  de-duplicated/estimated counts (users, purchasers, sessions) or ratios
 *  (average purchase revenue, ARPU, rates): a user active in all N periods
 *  counts once in the pooled query but N times across N separate queries,
 *  and a pooled ratio is a weighted average rather than the mean of the N
 *  per-period ratios. Verified live (Tharaa, N=3): pooled users/3 = 42,503
 *  vs per-period mean 44,415.67; pooled avg purchase revenue 1,241.13 vs
 *  per-period mean 1,253.78.
 *
 *  So for those metrics only, query each of the N real periods on its own
 *  (same filters/dims) and replace Previous with the plain mean of the N
 *  results — matching "pull 3 periods in GA4, add them up, divide by 3".
 *  Time-series rows are left as averagePreviousPeriod built them: a single
 *  day has no cross-period de-duplication, and its day-aligned mean is
 *  already the per-period mean. Categorical rows get the same per-period
 *  mean as the totals (a breakdown value missing from a period counts as 0
 *  for counts, and is skipped for ratios — there's no ratio to average). */
async function applyPerPeriodMeans(req: ReportRequest, resp: ReportResponse): Promise<ReportResponse> {
  const n = req.rangeBAverageDivisor;
  if (!n || !req.rangeB || !resp.totalsB) return resp;
  const sensitive = resp.metrics.filter(isPeriodSplitSensitive);
  if (sensitive.length === 0) return resp;
  const chunks = multiPeriodChunks(req.rangeA, req.rangeB);
  if (chunks.length !== n) return resp; // B isn't N whole periods: keep pooled result

  const isRatio = (m: string) => isConvRateMetric(m) || isNonAdditiveGa4Metric(m);
  const dims = reqDims(req);
  const isTimeSeries = !!detectGranularity(dims);
  const categorical = isCategorical(dims);
  // categorical: pin each period's rows to exactly the rows the table shows
  // (re-ranking per period would drop rows outside that period's own top N)
  const rowRestrict = categorical ? buildRowRestrictFilter(dims, resp.rows.map((r) => r.dim)) : undefined;
  // sessions rides along (if not already chosen) purely as a "did this period
  // have any data at all" signal for the ratio rule below
  const periodMetrics = sensitive.includes("sessions") ? sensitive : [...sensitive, "sessions"];
  const sessionsIdx = periodMetrics.indexOf("sessions");
  const perPeriod = await mapLimit(chunks, 4, async (chunk) => {
    const periodReq: ReportRequest = {
      ...req,
      metrics: periodMetrics,
      rangeA: chunk,
      rangeB: undefined,
      rangeBAverageDivisor: undefined,
      dimensions: [],
      dimension: undefined,
    };
    // totals always from a no-breakdown query: GA4's true period total
    const totals = await runReportExact(periodReq);
    if (!categorical || !rowRestrict) return { totalsA: totals.totalsA, rows: [] as ReportRow[] };
    const withRows = await runReportExact(
      { ...periodReq, dimensions: dims, limit: Math.max(resp.rows.length, 1) },
      rowRestrict
    );
    return { totalsA: totals.totalsA, rows: withRows.rows };
  });

  const totalsB = [...resp.totalsB];
  // Ratios (average purchase revenue, rates…): a period with NO data at all
  // has no ratio — GA4 just shows 0 — so it's left out of the mean, the same
  // rule the day-by-day rows use. A period WITH data whose ratio is 0 counts.
  // Counts/users: a period with no data genuinely contributes 0 → always ÷ N.
  const hasData = perPeriod.map((p) => (p.totalsA[sessionsIdx] ?? 0) > 0);
  const nWithData = hasData.filter(Boolean).length;
  sensitive.forEach((m, j) => {
    const i = resp.metrics.indexOf(m);
    if (isRatio(m)) {
      const sum = perPeriod.reduce((s, p, k) => s + (hasData[k] ? p.totalsA[j] ?? 0 : 0), 0);
      totalsB[i] = nWithData ? sum / nWithData : 0;
    } else {
      totalsB[i] = perPeriod.reduce((s, p) => s + (p.totalsA[j] ?? 0), 0) / n;
    }
  });

  if (isTimeSeries) return { ...resp, totalsB };

  const byDim = perPeriod.map((p) => new Map(p.rows.map((r) => [r.dim, r.a])));
  const rows = resp.rows.map((r) => {
    if (!r.b) return r;
    const b = [...r.b];
    sensitive.forEach((m, j) => {
      const i = resp.metrics.indexOf(m);
      const vals = byDim.map((map) => map.get(r.dim)?.[j]);
      if (isRatio(m)) {
        const present = vals.filter((v): v is number => v !== undefined);
        b[i] = present.length ? present.reduce((s, v) => s + v, 0) / present.length : 0;
      } else {
        b[i] = vals.reduce<number>((s, v) => s + (v ?? 0), 0) / n;
      }
    });
    return { ...r, b };
  });
  return { ...resp, totalsB, rows };
}

// ---------- Data: GA4-native funnel reports (v1alpha runFunnelReport) ----------

const DATA_API_ALPHA = "https://analyticsdata.googleapis.com/v1alpha";

interface RawFunnelReport {
  funnelTable?: {
    dimensionHeaders?: { name: string }[];
    metricHeaders?: { name: string; type: string }[];
    rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
  };
}

/** Runs a funnel through GA4's own funnel engine — step sequencing, user
 *  deduplication, and open/closed semantics all happen server-side at
 *  Google, exactly matching what Explorations' funnel report shows. We only
 *  read back active users per step and derive the two completion rates. */
export async function runFunnelReport(
  property: string,
  funnel: FunnelConfig,
  range: ResolvedRange,
  segment: ReportRequest["filters"] = [],
  scope: SegmentScope = "session"
): Promise<FunnelResponse> {
  const steps = funnel.steps.filter((s) => s.eventName).slice(0, 10);
  if (steps.length < 2) return { steps: [] };

  const PAGE_MATCH: Record<string, string> = { exact: "EXACT", contains: "CONTAINS", begins: "BEGINS_WITH" };
  // a step is its event, optionally ANDed with "…and it happened on this
  // page". Funnel steps use their own field schema: unifiedPagePathScreen is
  // the page path without query string (plain pagePath is rejected here), so
  // exact "/" matches the homepage even when UTM parameters are present.
  const stepExpression = (s: (typeof steps)[number]) => {
    const eventExpr = { funnelEventFilter: { eventName: s.eventName } };
    if (!s.pagePath || !s.pageMatch || !PAGE_MATCH[s.pageMatch]) return eventExpr;
    return {
      andGroup: {
        expressions: [
          eventExpr,
          {
            funnelFieldFilter: {
              fieldName: "unifiedPagePathScreen",
              stringFilter: { matchType: PAGE_MATCH[s.pageMatch], value: s.pagePath, caseSensitive: false },
            },
          },
        ],
      },
    };
  };

  const body = {
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    funnel: {
      isOpenFunnel: funnel.open,
      steps: steps.map((s) => ({
        name: s.label || s.eventName,
        filterExpression: stepExpression(s),
      })),
    },
    // report segment: "session" scope narrows the funnel to matching sessions
    // the same way it narrows every other card; "user" scope applies a REAL
    // GA4 user segment (users with a matching session, all their activity)
    ...(scope === "user" && segment.length
      ? { segments: [{ name: "segment", ...gaUserSegment(segment) }] }
      : buildDimensionFilter(segment)
        ? { dimensionFilter: buildDimensionFilter(segment) }
        : {}),
  };

  const data = await gaRequest<RawFunnelReport>(
    `${DATA_API_ALPHA}/${property}:runFunnelReport`,
    "POST",
    body
  );

  // funnelTable rows: one per step (dimension "1. <name>"), metric activeUsers.
  // Rows can arrive with extra grouping rows when dimensions are requested —
  // we request none, so parse defensively by leading step number.
  const users = new Array<number>(steps.length).fill(0);
  for (const row of data.funnelTable?.rows ?? []) {
    const dim = row.dimensionValues?.[0]?.value ?? "";
    const idx = Number(dim.split(".")[0]) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= steps.length) continue;
    users[idx] = Math.max(users[idx], Number(row.metricValues?.[0]?.value ?? 0));
  }

  return {
    steps: steps.map((s, i) => ({
      label: s.label || s.eventName,
      users: users[i],
      rateFromFirst: i === 0 ? null : users[0] > 0 ? users[i] / users[0] : null,
      rateFromPrevious: i === 0 ? null : users[i - 1] > 0 ? users[i] / users[i - 1] : null,
    })),
  };
}

// ---------- Data: real GA4 user segments (v1alpha runFunnelReport) ----------
//
// GA4's Data API only evaluates segments inside funnel reports, and a funnel
// report's only metric is active users per step. Everything below is built
// from that one number, using GA4's own segment engine for membership — so
// the people counted are exactly the people an Exploration user segment
// (scope USER_CRITERIA_WITHIN_SAME_SESSION: "all conditions met in one
// session") contains.
//
//  - repeat funnel: a closed funnel of the same event REPEAT_STEPS (=10, GA4's
//    hard maximum) times gives users with >= 1, >= 2, ... occurrences; the
//    sum is the event count. Exact unless a user exceeds 10 (then flagged and
//    shown as a floor). TRENDED_FUNNEL returns the same per date; a funnel
//    breakdown returns it per dimension value.
//  - sums (revenue, items purchased, refunds): binary decomposition of each
//    transaction's per-event value: sum = sum_j 2^j * (segment events among
//    transactions whose value has bit j set). Every term is an exact GA4
//    count; verified -0.05% to -0.69% against Exploration revenue.
//  - users = totalUsers of matching sessions (core report: same people).
//  - any event = exact count inside matching sessions (core) + the repeat
//    funnel count in those users' other sessions (steps require "session does
//    NOT match").
//  - sessions = matching sessions + other session_starts (session-scoped
//    conditions) or all their session_starts calibrated by the property's
//    sessions / session_start ratio (page conditions).

const REPEAT_STEPS = 10;

function gaSegmentExpression(conditions: ReportRequest["filters"] = []) {
  const exprs = conditions
    .filter((c) => c.field && c.value)
    .map((c) => {
      const f = {
        segmentFilter: {
          fieldName: c.field,
          stringFilter: { matchType: MATCH_MAP[c.match] ?? "CONTAINS", value: c.value, caseSensitive: false },
        },
      };
      return c.not ? { notExpression: f } : f;
    });
  return exprs.length === 1 ? exprs[0] : { andGroup: { expressions: exprs } };
}

function gaUserSegment(conditions: ReportRequest["filters"] = []) {
  return {
    userSegment: {
      userInclusionCriteria: {
        andConditionGroups: [
          { conditionScoping: "USER_CRITERIA_WITHIN_SAME_SESSION", segmentFilterExpression: gaSegmentExpression(conditions) },
        ],
      },
    },
  };
}

/** The conditions as a funnel-step filter, negated: "this event happened in
 *  a session that does NOT match the conditions". */
function gaFunnelNotMatching(conditions: ReportRequest["filters"] = []) {
  const exprs = conditions
    .filter((c) => c.field && c.value)
    .map((c) => {
      const f = {
        funnelFieldFilter: {
          fieldName: c.field,
          stringFilter: { matchType: MATCH_MAP[c.match] ?? "CONTAINS", value: c.value, caseSensitive: false },
        },
      };
      return c.not ? { notExpression: f } : f;
    });
  return { notExpression: exprs.length === 1 ? exprs[0] : { andGroup: { expressions: exprs } } };
}

const evStep = (eventName: string) => ({ funnelEventFilter: { eventName } });
const andStep = (a: object, b?: object) => (b ? { andGroup: { expressions: [a, b] } } : a);
const KEY_EVENT_STEP = { funnelFieldFilter: { fieldName: "isConversionEvent", stringFilter: { matchType: "EXACT", value: "true" } } };

interface RawFunnelWithVis extends RawFunnelReport {
  funnelVisualization?: {
    dimensionHeaders?: { name: string }[];
    rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
  };
}

interface RepeatResult {
  /** users with >= 1 occurrence */
  users: number;
  /** occurrences (sum over the repeat steps) */
  count: number;
  capped: boolean;
  /** occurrences per date (yyyymmdd) — only with opts.daily */
  daily: Record<string, number>;
  /** per breakdown value — only with opts.breakdown */
  byValue: Record<string, { users: number; count: number }>;
}

/** Occurrences of the step (an event, optionally with extra step filters)
 *  by users inside `segment` ({} = everyone), via a repeat funnel. */
async function segmentRepeat(
  property: string,
  range: ResolvedRange,
  segment: object,
  stepExpr: object,
  opts: { daily?: boolean; breakdown?: string } = {}
): Promise<RepeatResult> {
  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    funnel: {
      isOpenFunnel: false,
      steps: Array.from({ length: REPEAT_STEPS }, (_, i) => ({ name: `e${i + 1}`, filterExpression: stepExpr })),
    },
    ...(Object.keys(segment).length ? { segments: [{ name: "segment", ...segment }] } : {}),
  };
  if (opts.daily) body.funnelVisualizationType = "TRENDED_FUNNEL";
  if (opts.breakdown) body.funnelBreakdown = { breakdownDimension: { name: opts.breakdown }, limit: 15 };
  const data = await gaRequest<RawFunnelWithVis>(`${DATA_API_ALPHA}/${property}:runFunnelReport`, "POST", body);
  const stepIdx = (v?: string) => Number((v ?? "").split(".")[0]) - 1;
  const headers = (data.funnelTable?.dimensionHeaders ?? []).map((h) => h.name);
  const bIdx = opts.breakdown ? headers.indexOf(opts.breakdown) : -1;
  const users = new Array<number>(REPEAT_STEPS).fill(0);
  const valueSums = new Array<number>(REPEAT_STEPS).fill(0);
  let sawTotal = false;
  const byValue: RepeatResult["byValue"] = {};
  for (const row of data.funnelTable?.rows ?? []) {
    const idx = stepIdx(row.dimensionValues?.[0]?.value);
    if (!Number.isInteger(idx) || idx < 0 || idx >= REPEAT_STEPS) continue;
    const n = Number(row.metricValues?.[0]?.value ?? 0);
    if (bIdx < 0) {
      users[idx] = Math.max(users[idx], n);
      continue;
    }
    const v = row.dimensionValues?.[bIdx]?.value ?? "";
    if (v === "RESERVED_TOTAL") {
      sawTotal = true;
      users[idx] = Math.max(users[idx], n);
    } else {
      const b = (byValue[v] ??= { users: 0, count: 0 });
      if (idx === 0) b.users = n;
      b.count += n;
      valueSums[idx] += n;
    }
  }
  if (bIdx >= 0 && !sawTotal) valueSums.forEach((s, i) => (users[i] = s));
  const daily: Record<string, number> = {};
  const vis = data.funnelVisualization;
  if (opts.daily && vis) {
    const dIdx = (vis.dimensionHeaders ?? []).findIndex((h) => h.name === "date");
    for (const row of vis.rows ?? []) {
      const d = row.dimensionValues?.[dIdx]?.value;
      if (!d || dIdx < 0) continue;
      daily[d] = (daily[d] ?? 0) + (Number(row.metricValues?.[0]?.value) || 0);
    }
  }
  return {
    users: users[0],
    count: users.reduce((s, v) => s + v, 0),
    capped: users[REPEAT_STEPS - 1] > 0,
    daily,
    byValue,
  };
}

async function coreTotals(property: string, range: ResolvedRange, metrics: string[], dimensionFilter?: object) {
  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    metrics: metrics.map((name) => ({ name })),
    metricAggregations: ["TOTAL"],
  };
  if (dimensionFilter) body.dimensionFilter = dimensionFilter;
  const data = await gaRequest<RawReport>(`${DATA_API}/${property}:runReport`, "POST", body);
  const vals = data.totals?.[0]?.metricValues ?? data.rows?.[0]?.metricValues ?? [];
  return { values: metrics.map((_, i) => Number(vals[i]?.value) || 0), currencyCode: data.metadata?.currencyCode };
}

/** What to sum per transaction: `valueMetric` / `countMetric` per
 *  transactionId gives the value of ONE `event`; `scale` turns it into an
 *  integer (100 = cents). */
interface SumSpec {
  event: string;
  valueMetric: string;
  countMetric: string;
  scale: number;
  filter?: object;
}
const REVENUE_SUM: SumSpec = { event: "purchase", valueMetric: "purchaseRevenue", countMetric: "ecommercePurchases", scale: 100 };
const ITEMS_SUM: SumSpec = { event: "purchase", valueMetric: "itemsPurchased", countMetric: "ecommercePurchases", scale: 1 };
const REFUND_SUM: SumSpec = {
  event: "refund",
  valueMetric: "refundAmount",
  countMetric: "eventCount",
  scale: 100,
  filter: { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "refund" } } },
};

interface SumResult {
  total: number;
  daily: Record<string, number>;
  byValue: Record<string, number>;
  calls: number;
}

const TX_CHUNK = 1500;
/** EXACT segment sum by binary decomposition (see the section comment).
 *  Events without a transaction id can't be attributed to a value; they are
 *  valued at the average of the segment's events that have one. */
async function exactSegmentSum(
  property: string,
  range: ResolvedRange,
  segment: object,
  spec: SumSpec,
  opts: { daily?: boolean; breakdown?: string; only?: object } = {}
): Promise<SumResult> {
  const { only, ...repeatOpts } = opts;
  const tx = await gaRequest<RawReport>(`${DATA_API}/${property}:runReport`, "POST", {
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    dimensions: [{ name: "transactionId" }],
    metrics: [{ name: spec.valueMetric }, { name: spec.countMetric }],
    ...(spec.filter ? { dimensionFilter: spec.filter } : {}),
    limit: "250000",
  });
  const txs: { id: string; units: number }[] = [];
  let noId = 0;
  for (const r of tx.rows ?? []) {
    const id = r.dimensionValues?.[0]?.value ?? "";
    const value = Math.abs(Number(r.metricValues?.[0]?.value) || 0);
    const n = Number(r.metricValues?.[1]?.value) || 0;
    if (!id || id === "(not set)") {
      noId += n;
      continue;
    }
    if (n > 0) txs.push({ id, units: Math.round((value / n) * spec.scale) });
  }
  const pos = txs.filter((t) => t.units > 0);
  const maxU = pos.reduce((m, t) => Math.max(m, t.units), 0);
  const bits = maxU > 0 ? Math.ceil(Math.log2(maxU + 1)) : 0;
  const jobs: { bit: number; ids: string[] }[] = [];
  for (let b = 0; b < bits; b++) {
    const ids = pos.filter((t) => Math.floor(t.units / 2 ** b) % 2 === 1).map((t) => t.id);
    for (let i = 0; i < ids.length; i += TX_CHUNK) jobs.push({ bit: b, ids: ids.slice(i, i + TX_CHUNK) });
  }
  const step = andStep(evStep(spec.event), only);
  const [counts, withId, all] = await Promise.all([
    mapLimit(jobs, FUNNEL_CONCURRENCY, (j) =>
      segmentRepeat(
        property,
        range,
        segment,
        andStep(step, { funnelFieldFilter: { fieldName: "transactionId", inListFilter: { values: j.ids } } }),
        repeatOpts
      )
    ),
    noId > 0
      ? segmentRepeat(
          property,
          range,
          segment,
          andStep(step, {
            notExpression: {
              funnelFieldFilter: { fieldName: "transactionId", stringFilter: { matchType: "EXACT", value: "(not set)" } },
            },
          }),
          repeatOpts
        )
      : Promise.resolve(null),
    noId > 0 ? segmentRepeat(property, range, segment, step, repeatOpts) : Promise.resolve(null),
  ]);
  let total = 0;
  const daily: Record<string, number> = {};
  const byValue: Record<string, number> = {};
  counts.forEach((c, i) => {
    const w = 2 ** jobs[i].bit;
    total += w * c.count;
    for (const [d, n] of Object.entries(c.daily)) daily[d] = (daily[d] ?? 0) + w * n;
    for (const [v, x] of Object.entries(c.byValue)) byValue[v] = (byValue[v] ?? 0) + w * x.count;
  });
  // scale up for events without a transaction id (factor = all / with id)
  const factor = (a?: number, b?: number) => (a != null && b != null && b > 0 && a > b ? a / b : 1);
  if (withId && all) {
    total *= factor(all.count, withId.count);
    for (const d of Object.keys(daily)) daily[d] *= factor(all.daily[d], withId.daily[d]);
    for (const v of Object.keys(byValue)) byValue[v] *= factor(all.byValue[v]?.count, withId.byValue[v]?.count);
  }
  const s = spec.scale;
  return {
    total: total / s,
    daily: Object.fromEntries(Object.entries(daily).map(([d, n]) => [d, n / s])),
    byValue: Object.fromEntries(Object.entries(byValue).map(([v, n]) => [v, n / s])),
    calls: jobs.length + (noId > 0 ? 2 : 0) + 1,
  };
}

/** Condition fields that are per EVENT (a page) rather than constant over
 *  the session: a session can match on a later page view but not on its
 *  session_start, so sessions use the calibrated method. */
function isSessionScopedConditions(conditions: NonNullable<ReportRequest["filters"]>) {
  return conditions.filter((c) => c.field && c.value).every((c) => !USER_SEGMENT_PAGE_FIELDS.has(c.field));
}

async function userSegmentPeriod(
  property: string,
  conditions: NonNullable<ReportRequest["filters"]>,
  range: ResolvedRange,
  plan: UserSegmentPlan,
  daily: boolean
): Promise<UserSegmentTotals & { currencyCode?: string }> {
  const seg = gaUserSegment(conditions);
  const condFilter = buildDimensionFilter(conditions)!;
  const notMatching = gaFunnelNotMatching(conditions);
  const sessionScoped = isSessionScopedConditions(conditions);
  const extras = new Set(plan.extras);
  const soft = <T>(p: Promise<T>) => p.catch(() => null);
  const events = [...new Set(["purchase", ...plan.events])];
  const dateRanges = [{ startDate: range.startDate, endDate: range.endDate }];

  // 1) exact core figures for the MATCHING sessions (the session filter)
  const [matched, matchedEvents, matchedDaily] = await Promise.all([
    coreTotals(
      property,
      range,
      ["totalUsers", "purchaseRevenue", "transactions", "sessions", "keyEvents", "itemsPurchased", "refundAmount"],
      condFilter
    ),
    gaRequest<RawReport>(`${DATA_API}/${property}:runReport`, "POST", {
      dateRanges,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: combineFilters(condFilter, buildEventNameInListFilter(events)),
    }),
    daily
      ? gaRequest<RawReport>(`${DATA_API}/${property}:runReport`, "POST", {
          dateRanges,
          dimensions: [{ name: "date" }],
          metrics: [{ name: "transactions" }, { name: "purchaseRevenue" }],
          dimensionFilter: condFilter,
          limit: "1000",
        })
      : Promise.resolve(null),
  ]);
  const [users, revenueMatched, matchedPurchases, matchedSessions, matchedKeyEvents, matchedItems, matchedRefunds] =
    matched.values;

  // 2) the segment users' OTHER sessions through GA4's segment engine (steps
  //    require "session does NOT match"); if GA4 rejects a condition field
  //    inside funnel steps, fall back to counting all their sessions
  const other = async (base: object, o: { daily?: boolean } = {}) => {
    try {
      return { ...(await segmentRepeat(property, range, seg, andStep(base, notMatching), o)), split: true };
    } catch {
      return { ...(await segmentRepeat(property, range, seg, base, o)), split: false };
    }
  };
  // exact sum = core value of the matching sessions + binary sum over the others
  const hybridSum = async (spec: SumSpec, matchedValue: number, o: { daily?: boolean } = {}) => {
    try {
      const x = await exactSegmentSum(property, range, seg, spec, { ...o, only: notMatching });
      return { total: matchedValue + x.total, daily: x.daily, split: true };
    } catch {
      const x = await exactSegmentSum(property, range, seg, spec, o);
      return { total: x.total, daily: x.daily, split: false };
    }
  };

  const [buyers, aovRef, rev, sess, items, refunds, keyOther, keyUsers, others, evUsers] = await Promise.all([
    segmentRepeat(property, range, seg, evStep("purchase")),
    // AOV for the fallback estimate: returning visitors' real sessions
    // (landing page set) that did NOT match the conditions
    coreTotals(property, range, ["totalRevenue", "transactions"], {
      andGroup: {
        expressions: [
          { notExpression: condFilter },
          { notExpression: { filter: { fieldName: "landingPagePlusQueryString", stringFilter: { matchType: "EXACT", value: "(not set)" } } } },
          { filter: { fieldName: "newVsReturning", stringFilter: { matchType: "EXACT", value: "returning" } } },
        ],
      },
    }),
    soft(hybridSum(REVENUE_SUM, revenueMatched, { daily })),
    sessionScoped
      ? soft(other(evStep("session_start")))
      : soft(
          Promise.all([
            segmentRepeat(property, range, seg, evStep("session_start")),
            segmentRepeat(property, range, {}, evStep("session_start")),
            coreTotals(property, range, ["sessions"]),
          ]).then(([s, all, core]) => ({
            count: all.count > 0 ? Math.round(s.count * (core.values[0] / all.count)) : s.count,
            split: false,
          }))
        ),
    extras.has("itemsPurchased") ? soft(hybridSum(ITEMS_SUM, matchedItems)) : null,
    extras.has("refunds") ? soft(hybridSum(REFUND_SUM, matchedRefunds)) : null,
    extras.has("keyEvents") ? soft(other(KEY_EVENT_STEP)) : null,
    extras.has("keyEvents") ? soft(segmentRepeat(property, range, seg, KEY_EVENT_STEP)) : null,
    Promise.all(events.map((e) => other(evStep(e), { daily: daily && e === "purchase" }))),
    Promise.all(
      plan.eventUsers.filter((e) => e !== "purchase").map((e) => soft(segmentRepeat(property, range, seg, evStep(e))))
    ),
  ]);

  const [refRevenue, refPurchases] = aovRef.values;
  const inMatched: Record<string, number> = {};
  for (const r of matchedEvents.rows ?? []) {
    inMatched[r.dimensionValues?.[0]?.value ?? ""] = Number(r.metricValues?.[0]?.value) || 0;
  }
  const evMap: Record<string, number> = {};
  const capped: string[] = [];
  events.forEach((e, i) => {
    const x = others[i];
    evMap[e] = x.split ? (e === "purchase" ? matchedPurchases : inMatched[e] ?? 0) + x.count : x.count;
    if (x.capped) capped.push(e);
  });
  const eventUsers: Record<string, number> = { purchase: buyers.users };
  plan.eventUsers
    .filter((e) => e !== "purchase")
    .forEach((e, i) => {
      const r = evUsers[i];
      if (r) eventUsers[e] = r.users;
    });
  const purchases = evMap["purchase"] ?? buyers.count;
  let revenue: number;
  let revenueMethod: UserSegmentTotals["revenueMethod"];
  if (rev) {
    revenue = rev.total;
    revenueMethod = "exact";
  } else {
    const extra = Math.max(0, purchases - matchedPurchases);
    const aov =
      refPurchases > 0 ? refRevenue / refPurchases : matchedPurchases > 0 ? revenueMatched / matchedPurchases : 0;
    revenue = revenueMatched + extra * aov;
    revenueMethod = "estimate";
  }
  const sessions = sess == null ? null : sess.split ? matchedSessions + sess.count : sess.count;
  let keyEvents: number | null = null;
  if (keyOther) {
    keyEvents = keyOther.split ? matchedKeyEvents + keyOther.count : keyOther.count;
    if (keyOther.capped) capped.push("keyEvents");
  }
  let dailyRows: UserSegmentDay[] | undefined;
  if (daily) {
    // per date: matching sessions exact (core) + other sessions (segment engine)
    const coreDay: Record<string, { p: number; r: number }> = {};
    for (const row of matchedDaily?.rows ?? []) {
      coreDay[row.dimensionValues?.[0]?.value ?? ""] = {
        p: Number(row.metricValues?.[0]?.value) || 0,
        r: Number(row.metricValues?.[1]?.value) || 0,
      };
    }
    const op = others[0];
    dailyRows = enumerateDays(range).map((d) => {
      const c = coreDay[d] ?? { p: 0, r: 0 };
      return {
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        purchases: (op.split ? c.p : 0) + (op.daily[d] ?? 0),
        revenue: rev ? (rev.split ? c.r : 0) + (rev.daily[d] ?? 0) : null,
      };
    });
  }
  return {
    users,
    purchasers: buyers.users,
    purchases,
    revenue,
    revenueMethod,
    sessions,
    revenueExact: revenueMatched,
    avgPurchaseRevenue: purchases > 0 ? revenue / purchases : 0,
    // GA4 Explorations' "New users" can't be reproduced through the segment
    // API (every route measured ~15% low), so it is not offered
    newUsers: null,
    itemsPurchased: items ? Math.round(items.total) : null,
    refunds: refunds ? refunds.total : null,
    keyEvents,
    keyEventUsers: keyUsers ? keyUsers.users : null,
    events: evMap,
    eventUsers,
    eventsCapped: capped,
    hasData: matchedSessions > 0,
    daily: dailyRows,
    currencyCode: matched.currencyCode,
  };
}

/** yyyymmdd for every day of the range */
function enumerateDays(range: ResolvedRange): string[] {
  const out: string[] = [];
  const end = new Date(range.endDate + "T00:00:00Z");
  for (let d = new Date(range.startDate + "T00:00:00Z"); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10).replaceAll("-", ""));
  }
  return out;
}

/** A real GA4 user segment for Current and Previous (Previous may be the
 *  mean of N periods, multiPeriodAvg — same rules as the main report: counts
 *  and sums divide by N, the average order value skips periods with no data
 *  at all). The daily series is computed for Current only. */
export async function runUserSegment(opts: {
  property: string;
  conditions: NonNullable<ReportRequest["filters"]>;
  rangeA: ResolvedRange;
  rangeB?: ResolvedRange | null;
  rangeBAverageDivisor?: number;
  plan: UserSegmentPlan;
}): Promise<UserSegmentResponse> {
  const plan: UserSegmentPlan = {
    events: [...new Set(["purchase", ...opts.plan.events])].slice(0, 12),
    eventUsers: [...new Set(opts.plan.eventUsers)].slice(0, 6),
    extras: [...new Set(opts.plan.extras)],
    daily: !!opts.plan.daily,
  };
  const n = opts.rangeBAverageDivisor;
  const prevRanges = !opts.rangeB ? [] : n && n > 1 ? multiPeriodChunks(opts.rangeA, opts.rangeB) : [opts.rangeB];
  const all = await mapLimit([opts.rangeA, ...prevRanges], 2, (r) =>
    userSegmentPeriod(opts.property, opts.conditions, r, plan, r === opts.rangeA && !!plan.daily)
  );
  const [current, ...prevs] = all;
  let previous: UserSegmentTotals | null = null;
  if (prevs.length === 1) previous = prevs[0];
  else if (prevs.length > 1) {
    const k = prevs.length;
    const mean = (f: (p: UserSegmentTotals) => number) => prevs.reduce((s, p) => s + f(p), 0) / k;
    const meanOrNull = (f: (p: UserSegmentTotals) => number | null) =>
      prevs.every((p) => f(p) != null) ? mean((p) => f(p) ?? 0) : null;
    const withData = prevs.filter((p) => p.hasData && p.purchases > 0);
    const keys = (f: (p: UserSegmentTotals) => Record<string, number>) => [...new Set(prevs.flatMap((p) => Object.keys(f(p))))];
    previous = {
      users: mean((p) => p.users),
      purchasers: mean((p) => p.purchasers),
      purchases: mean((p) => p.purchases),
      revenue: mean((p) => p.revenue),
      revenueMethod: prevs.every((p) => p.revenueMethod === "exact") ? "exact" : "estimate",
      sessions: meanOrNull((p) => p.sessions),
      revenueExact: mean((p) => p.revenueExact),
      avgPurchaseRevenue: withData.length
        ? withData.reduce((s, p) => s + p.avgPurchaseRevenue, 0) / withData.length
        : 0,
      newUsers: meanOrNull((p) => p.newUsers),
      itemsPurchased: meanOrNull((p) => p.itemsPurchased),
      refunds: meanOrNull((p) => p.refunds),
      keyEvents: meanOrNull((p) => p.keyEvents),
      keyEventUsers: meanOrNull((p) => p.keyEventUsers),
      events: Object.fromEntries(keys((p) => p.events).map((e) => [e, mean((p) => p.events[e] ?? 0)])),
      eventUsers: Object.fromEntries(keys((p) => p.eventUsers).map((e) => [e, mean((p) => p.eventUsers[e] ?? 0)])),
      eventsCapped: [...new Set(prevs.flatMap((p) => p.eventsCapped))],
      hasData: prevs.some((p) => p.hasData),
    };
  }
  const { currencyCode, ...cur } = current;
  return { current: cur, previous, previousPeriods: Math.max(prevs.length, 1), currencyCode };
}

/** The segment split by one dimension (top 15 values, GA4's funnel
 *  breakdown limit): users (session_start step), purchasers, purchases and
 *  exact revenue per value. Current range only. */
export async function runUserSegmentBreakdown(opts: {
  property: string;
  conditions: NonNullable<ReportRequest["filters"]>;
  range: ResolvedRange;
  dimension: string;
}): Promise<UserSegmentBreakdownResponse> {
  const { property, range, dimension } = opts;
  const seg = gaUserSegment(opts.conditions);
  const condFilter = buildDimensionFilter(opts.conditions)!;
  const notMatching = gaFunnelNotMatching(opts.conditions);
  const o = { breakdown: dimension };
  // same method as the totals: matching sessions exact (core, by value) +
  // the users' other sessions through GA4's segment engine (funnel breakdown)
  const [core, buyersR, otherPurch, otherRev] = await Promise.all([
    gaRequest<RawReport>(`${DATA_API}/${property}:runReport`, "POST", {
      dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      dimensions: [{ name: dimension }],
      metrics: [{ name: "totalUsers" }, { name: "transactions" }, { name: "purchaseRevenue" }],
      dimensionFilter: condFilter,
      limit: "250",
    }),
    segmentRepeat(property, range, seg, evStep("purchase"), o),
    segmentRepeat(property, range, seg, andStep(evStep("purchase"), notMatching), o).catch(() => null),
    exactSegmentSum(property, range, seg, REVENUE_SUM, { ...o, only: notMatching }).catch(() => null),
  ]);
  const coreBy: Record<string, { users: number; purchases: number; revenue: number }> = {};
  for (const r of core.rows ?? []) {
    coreBy[r.dimensionValues?.[0]?.value ?? ""] = {
      users: Number(r.metricValues?.[0]?.value) || 0,
      purchases: Number(r.metricValues?.[1]?.value) || 0,
      revenue: Number(r.metricValues?.[2]?.value) || 0,
    };
  }
  const values = [...new Set([...Object.keys(coreBy), ...Object.keys(buyersR.byValue)])];
  const rows: UserSegmentBreakdownRow[] = values
    .map((value) => {
      const c = coreBy[value] ?? { users: 0, purchases: 0, revenue: 0 };
      return {
        value,
        users: c.users,
        purchasers: buyersR.byValue[value]?.users ?? 0,
        purchases: otherPurch
          ? c.purchases + (otherPurch.byValue[value]?.count ?? 0)
          : buyersR.byValue[value]?.count ?? 0,
        revenue: otherRev ? c.revenue + (otherRev.byValue[value] ?? 0) : null,
      };
    })
    .sort((a, b) => b.users - a.users || b.purchases - a.purchases)
    .slice(0, 15);
  return {
    dimension,
    rows,
    revenueMethod: otherRev ? "exact" : "unavailable",
    currencyCode: core.metadata?.currencyCode,
  };
}
