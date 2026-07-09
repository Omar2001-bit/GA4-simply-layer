import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { getMetadata } from "@/lib/ga4";

export async function GET(req: Request) {
  if (!(await isAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const property = searchParams.get("property");
  if (!property || !/^properties\/\d+$/.test(property)) {
    return NextResponse.json({ error: "Invalid property" }, { status: 400 });
  }
  try {
    const meta = await getMetadata(property);
    return NextResponse.json(meta);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
