import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { runFunnelReport } from "@/lib/ga4";
import { isSegmentDimension, type FilterClause, type FunnelConfig, type ResolvedRange } from "@/lib/types";

interface FunnelApiRequest {
  property: string;
  funnel: FunnelConfig;
  range: ResolvedRange;
  segment?: FilterClause[];
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: FunnelApiRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    !body.property ||
    !/^properties\/\d+$/.test(body.property) ||
    !body.range?.startDate ||
    !body.range?.endDate ||
    !Array.isArray(body.funnel?.steps)
  ) {
    return NextResponse.json({ error: "Missing property, range, or funnel steps" }, { status: 400 });
  }
  const segment = Array.isArray(body.segment) ? body.segment.slice(0, 10) : [];
  if (segment.some((f) => typeof f?.field !== "string" || typeof f?.value !== "string" || !isSegmentDimension(f.field))) {
    return NextResponse.json({ error: "Invalid segment condition" }, { status: 400 });
  }
  try {
    const data = await runFunnelReport(body.property, body.funnel, body.range, segment);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
