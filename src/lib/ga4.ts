import { JWT } from "google-auth-library";
import type {
  MetadataResponse,
  PropertySummary,
  ReportRequest,
  ReportResponse,
  ReportRow,
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
}

const MATCH_MAP: Record<string, string> = {
  contains: "CONTAINS",
  exact: "EXACT",
  begins: "BEGINS_WITH",
  ends: "ENDS_WITH",
  regex: "FULL_REGEXP",
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

export async function runReport(req: ReportRequest): Promise<ReportResponse> {
  const hasDim = !!req.dimension;
  const hasCompare = !!req.rangeB;
  const metrics = req.metrics.slice(0, 10).map((m) => ({ name: m }));
  const dimensions = hasDim ? [{ name: req.dimension }] : [];
  const dimensionFilter = buildDimensionFilter(req.filters);

  const body: Record<string, unknown> = {
    dateRanges: hasCompare ? [req.rangeA, req.rangeB] : [req.rangeA],
    metrics,
    dimensions,
    // date series must never truncate mid-range; categorical rows honor the user limit
    limit:
      req.dimension === "date"
        ? "5000"
        : String(Math.min(req.limit ?? 25, 1000) * (hasCompare ? 2 : 1)),
    metricAggregations: ["TOTAL"],
    keepEmptyRows: false,
  };
  if (dimensionFilter) body.dimensionFilter = dimensionFilter;
  if (hasDim && req.dimension !== "date") {
    body.orderBys = [{ metric: { metricName: req.metrics[0] }, desc: true }];
  } else if (req.dimension === "date") {
    body.orderBys = [{ dimension: { dimensionName: "date" } }];
  }

  const data = await gaRequest<RawReport>(`${DATA_API}/${req.property}:runReport`, "POST", body);

  const metricHeaders = (data.metricHeaders ?? []).map((h) => ({ name: h.name, type: h.type }));
  const dimHeaders = (data.dimensionHeaders ?? []).map((h) => h.name);
  // when 2 dateRanges are sent, GA4 appends a "dateRange" dimension
  const drIdx = dimHeaders.indexOf("dateRange");
  const dimIdx = hasDim ? dimHeaders.indexOf(req.dimension) : -1;

  const rowMap = new Map<string, ReportRow>();
  const order: string[] = [];
  const isDateCompare = req.dimension === "date" && hasCompare;
  const seriesA: { dim: string; mets: number[] }[] = [];
  const seriesB: { dim: string; mets: number[] }[] = [];
  for (const r of data.rows ?? []) {
    const dims = r.dimensionValues ?? [];
    const mets = (r.metricValues ?? []).map((v) => Number(v.value) || 0);
    const dimVal = dimIdx >= 0 ? dims[dimIdx]?.value ?? "" : "total";
    const which = drIdx >= 0 ? dims[drIdx]?.value ?? "date_range_0" : "date_range_0";
    if (isDateCompare) {
      // dates differ between ranges — collect separately, align by day index below
      if (which === "date_range_0") seriesA.push({ dim: dimVal, mets });
      else seriesB.push({ dim: dimVal, mets });
      continue;
    }
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
    // GA4 emits zero-filled rows for every date across BOTH ranges in each bucket — keep only in-range dates
    const inRange = (d: string, r: { startDate: string; endDate: string }) => {
      const s = r.startDate.replaceAll("-", "");
      const e = r.endDate.replaceAll("-", "");
      return d >= s && d <= e;
    };
    const fA = seriesA.filter((x) => inRange(x.dim, req.rangeA));
    const fB = req.rangeB ? seriesB.filter((x) => inRange(x.dim, req.rangeB!)) : seriesB;
    seriesA.length = 0;
    seriesA.push(...fA);
    seriesB.length = 0;
    seriesB.push(...fB);
    seriesA.sort((x, y) => x.dim.localeCompare(y.dim));
    seriesB.sort((x, y) => x.dim.localeCompare(y.dim));
    const n = Math.max(seriesA.length, seriesB.length);
    for (let i = 0; i < n; i++) {
      const a = seriesA[i];
      const b = seriesB[i];
      const key = a?.dim ?? `b-${b?.dim ?? i}`;
      rowMap.set(key, {
        dim: a?.dim ?? "",
        bDim: b?.dim,
        a: a?.mets ?? new Array(metrics.length).fill(0),
        b: b?.mets,
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
    // already aligned + ordered by day index
  } else if (req.dimension === "date") {
    rows = rows.sort((x, y) => x.dim.localeCompare(y.dim));
  } else {
    rows = rows.sort((x, y) => (y.a[0] ?? 0) - (x.a[0] ?? 0)).slice(0, limit);
  }

  return {
    metrics: req.metrics,
    metricHeaders,
    dimension: req.dimension,
    rows,
    totalsA,
    totalsB,
    rangeA: req.rangeA,
    rangeB: req.rangeB ?? null,
    rowCount: data.rowCount ?? rows.length,
  };
}
