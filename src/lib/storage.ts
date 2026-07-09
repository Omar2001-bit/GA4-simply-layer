import { promises as fs } from "fs";
import path from "path";
import type { PresetsFile, ReportConfig } from "./types";

const BLOB_PATH = "ga4-simply-layer/presets.json";
const EMPTY: PresetsFile = { reports: [] };

function useBlob(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

const localFile = () => path.join(process.cwd(), "data", "presets.json");

async function readLocal(): Promise<PresetsFile> {
  try {
    const raw = await fs.readFile(localFile(), "utf8");
    return JSON.parse(raw);
  } catch {
    return { ...EMPTY };
  }
}

async function writeLocal(data: PresetsFile): Promise<void> {
  await fs.mkdir(path.dirname(localFile()), { recursive: true });
  await fs.writeFile(localFile(), JSON.stringify(data, null, 2), "utf8");
}

async function readBlob(): Promise<PresetsFile> {
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
  if (!blobs.length) return { ...EMPTY };
  const res = await fetch(blobs[0].url, { cache: "no-store" });
  if (!res.ok) return { ...EMPTY };
  return (await res.json()) as PresetsFile;
}

async function writeBlob(data: PresetsFile): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(BLOB_PATH, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
}

export async function readPresets(): Promise<PresetsFile> {
  return useBlob() ? readBlob() : readLocal();
}

export async function writePresets(data: PresetsFile): Promise<void> {
  return useBlob() ? writeBlob(data) : writeLocal(data);
}

export async function upsertReport(report: ReportConfig): Promise<PresetsFile> {
  const data = await readPresets();
  const idx = data.reports.findIndex((r) => r.id === report.id);
  if (idx >= 0) data.reports[idx] = report;
  else data.reports.push(report);
  await writePresets(data);
  return data;
}

export async function deleteReport(id: string): Promise<PresetsFile> {
  const data = await readPresets();
  data.reports = data.reports.filter((r) => r.id !== id);
  await writePresets(data);
  return data;
}
