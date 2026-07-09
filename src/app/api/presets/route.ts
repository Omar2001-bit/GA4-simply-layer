import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { deleteReport, readPresets, upsertReport } from "@/lib/storage";
import type { ReportConfig } from "@/lib/types";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await readPresets();
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let report: ReportConfig;
  try {
    report = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!report.id || !report.name || !report.property || !report.metrics?.length) {
    return NextResponse.json({ error: "Missing id, name, property or metrics" }, { status: 400 });
  }
  report.updatedAt = new Date().toISOString();
  if (!report.createdAt) report.createdAt = report.updatedAt;
  const data = await upsertReport(report);
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const data = await deleteReport(id);
  return NextResponse.json(data);
}
