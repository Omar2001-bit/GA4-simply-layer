import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { runUserSegment } from "@/lib/ga4";
import {
  isSegmentDimension,
  USER_SEGMENT_PAGE_FIELDS,
  type FilterClause,
  type ResolvedRange,
  type UserSegmentExtra,
} from "@/lib/types";

interface UserSegmentApiRequest {
  property: string;
  conditions: FilterClause[];
  rangeA: ResolvedRange;
  rangeB?: ResolvedRange | null;
  rangeBAverageDivisor?: number;
  events?: string[];
  eventUsers?: string[];
  extras?: string[];
  daily?: boolean;
}

const EXTRAS: UserSegmentExtra[] = ["newUsers", "itemsPurchased", "refunds", "keyEvents"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validRange = (r?: ResolvedRange | null) => !!r && DATE_RE.test(r.startDate) && DATE_RE.test(r.endDate);

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: UserSegmentApiRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.property || !/^properties\/\d+$/.test(body.property)) {
    return NextResponse.json({ error: "Invalid property" }, { status: 400 });
  }
  if (!validRange(body.rangeA) || (body.rangeB && !validRange(body.rangeB))) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  const conditions = (Array.isArray(body.conditions) ? body.conditions : [])
    .filter((c) => c?.field && c?.value)
    .slice(0, 10);
  if (conditions.length === 0) {
    return NextResponse.json({ error: "A user segment needs at least one condition" }, { status: 400 });
  }
  if (conditions.some((c) => typeof c.field !== "string" || typeof c.value !== "string" || !(isSegmentDimension(c.field) || USER_SEGMENT_PAGE_FIELDS.has(c.field)))) {
    return NextResponse.json({ error: "Invalid segment condition" }, { status: 400 });
  }
  const divisor = body.rangeBAverageDivisor;
  if (divisor !== undefined && (!Number.isFinite(divisor) || divisor < 2 || divisor > 52)) {
    return NextResponse.json({ error: "Invalid rangeBAverageDivisor" }, { status: 400 });
  }
  const names = (xs: unknown, max: number) =>
    (Array.isArray(xs) ? xs : []).filter((e): e is string => typeof e === "string" && /^[A-Za-z0-9_]{1,40}$/.test(e)).slice(0, max);
  const plan = {
    events: names(body.events, 12),
    eventUsers: names(body.eventUsers, 6),
    extras: names(body.extras, 4).filter((x): x is UserSegmentExtra => (EXTRAS as string[]).includes(x)),
    daily: body.daily !== false,
  };
  try {
    const data = await runUserSegment({
      property: body.property,
      conditions,
      rangeA: body.rangeA,
      rangeB: body.rangeB ?? null,
      rangeBAverageDivisor: divisor,
      plan,
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "GA4 request failed" }, { status: 500 });
  }
}
