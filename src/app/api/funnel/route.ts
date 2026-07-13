import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { runFunnelReport } from "@/lib/ga4";
import type { FunnelConfig, ResolvedRange } from "@/lib/types";

interface FunnelApiRequest {
  property: string;
  funnel: FunnelConfig;
  range: ResolvedRange;
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
  try {
    const data = await runFunnelReport(body.property, body.funnel, body.range);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
