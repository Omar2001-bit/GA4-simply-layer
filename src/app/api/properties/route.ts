import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { listProperties } from "@/lib/ga4";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const properties = await listProperties();
    return NextResponse.json({
      properties,
      defaultProperty: process.env.DEFAULT_GA4_PROPERTY || properties[0]?.property || "",
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
