import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { runUserSegmentBreakdown } from "@/lib/ga4";
import {
  isSegmentDimension,
  USER_SEGMENT_BREAKDOWNS,
  USER_SEGMENT_PAGE_FIELDS,
  type FilterClause,
  type ResolvedRange,
} from "@/lib/types";

interface BreakdownApiRequest {
  property: string;
  conditions: FilterClause[];
  range: ResolvedRange;
  dimension: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: BreakdownApiRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.property || !/^properties\/\d+$/.test(body.property)) {
    return NextResponse.json({ error: "Invalid property" }, { status: 400 });
  }
  if (!body.range || !DATE_RE.test(body.range.startDate) || !DATE_RE.test(body.range.endDate)) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  if (!USER_SEGMENT_BREAKDOWNS.some((b) => b.apiName === body.dimension)) {
    return NextResponse.json({ error: "Unsupported breakdown dimension" }, { status: 400 });
  }
  const conditions = (Array.isArray(body.conditions) ? body.conditions : []).filter((c) => c?.field && c?.value).slice(0, 10);
  if (
    conditions.length === 0 ||
    conditions.some(
      (c) =>
        typeof c.field !== "string" ||
        typeof c.value !== "string" ||
        !(isSegmentDimension(c.field) || USER_SEGMENT_PAGE_FIELDS.has(c.field))
    )
  ) {
    return NextResponse.json({ error: "Invalid segment condition" }, { status: 400 });
  }
  try {
    const data = await runUserSegmentBreakdown({
      property: body.property,
      conditions,
      range: body.range,
      dimension: body.dimension,
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "GA4 request failed" }, { status: 500 });
  }
}
