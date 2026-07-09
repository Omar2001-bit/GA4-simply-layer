import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { runReport } from "@/lib/ga4";

/** Distinct values of a dimension over the last 28 days — powers filter-value autocomplete. */
export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const property = searchParams.get("property");
  const dimension = searchParams.get("dimension");
  if (!property || !/^properties\/\d+$/.test(property) || !dimension || !/^[A-Za-z0-9_:]+$/.test(dimension)) {
    return NextResponse.json({ error: "Invalid property or dimension" }, { status: 400 });
  }
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 27);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  try {
    const data = await runReport({
      property,
      dimension,
      metrics: ["eventCount"],
      rangeA: { startDate: fmt(start), endDate: fmt(end) },
      limit: 100,
    });
    return NextResponse.json({ values: data.rows.map((r) => r.dim).filter(Boolean) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
