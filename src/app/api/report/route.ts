import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { runReport } from "@/lib/ga4";
import type { ReportRequest } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: ReportRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.property || !/^properties\/\d+$/.test(body.property)) {
    return NextResponse.json({ error: "Invalid property" }, { status: 400 });
  }
  if (!Array.isArray(body.metrics) || body.metrics.length === 0) {
    return NextResponse.json({ error: "At least one metric required" }, { status: 400 });
  }
  if (!body.rangeA || !DATE_RE.test(body.rangeA.startDate) || !DATE_RE.test(body.rangeA.endDate)) {
    return NextResponse.json({ error: "Invalid rangeA" }, { status: 400 });
  }
  if (body.rangeB && (!DATE_RE.test(body.rangeB.startDate) || !DATE_RE.test(body.rangeB.endDate))) {
    return NextResponse.json({ error: "Invalid rangeB" }, { status: 400 });
  }
  try {
    const data = await runReport(body);
    return NextResponse.json(data);
  } catch (e) {
    const msg = (e as Error).message || "GA4 request failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
