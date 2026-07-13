import { db } from "./firestore";
import type { PresetsFile, ReportConfig } from "./types";

const COLLECTION = "reports";

export async function readPresets(): Promise<PresetsFile> {
  const snap = await db().collection(COLLECTION).orderBy("createdAt", "asc").get();
  return { reports: snap.docs.map((d) => d.data() as ReportConfig) };
}

export async function upsertReport(report: ReportConfig): Promise<PresetsFile> {
  await db().collection(COLLECTION).doc(report.id).set(report);
  return readPresets();
}

export async function deleteReport(id: string): Promise<PresetsFile> {
  await db().collection(COLLECTION).doc(id).delete();
  return readPresets();
}
