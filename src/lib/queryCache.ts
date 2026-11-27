// Persistent per-question cache for GA4 data queries (Firestore).
// Each runReport / runFunnelReport request is cached by its exact body, so any
// report or segment that asks the same question reuses the answer, across
// serverless instances, instead of spending GA4 quota again.
import { createHash } from "node:crypto";
import { db } from "./firestore";

const COLLECTION = "gaQueryCache";
const SETTLED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // range fully in the past: GA4 data is settled
const RECENT_TTL_MS = 30 * 60 * 1000; // range touches the last 3 days: data still processing
const RECENT_DAYS = 3;
const MAX_DOC_BYTES = 900_000; // Firestore document limit is 1 MiB

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** TTL from the request's date ranges; relative dates ("today", "7daysAgo") count as recent. */
export function queryTtlMs(body: unknown): number {
  const ends: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "endDate" && typeof x === "string") ends.push(x);
        else walk(x);
      }
    }
  };
  walk(body);
  const cutoff = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString().slice(0, 10);
  if (ends.length === 0 || ends.some((d) => !ISO.test(d) || d >= cutoff)) return RECENT_TTL_MS;
  return SETTLED_TTL_MS;
}

export function queryKey(url: string, body: unknown): string {
  return createHash("sha256").update(url + "\u0001" + JSON.stringify(body)).digest("hex");
}

export async function readQueryCache<T>(key: string): Promise<T | undefined> {
  try {
    const snap = await db().collection(COLLECTION).doc(key).get();
    if (!snap.exists) return undefined;
    const doc = snap.data() as { expiresAt: number; json: string };
    return doc.expiresAt > Date.now() ? (JSON.parse(doc.json) as T) : undefined;
  } catch {
    return undefined; // cache unavailable: caller does a live request
  }
}

export async function writeQueryCache(key: string, data: unknown, ttlMs: number): Promise<void> {
  try {
    const json = JSON.stringify(data);
    if (json.length > MAX_DOC_BYTES) return;
    const now = Date.now();
    await db().collection(COLLECTION).doc(key).set({ createdAt: now, expiresAt: now + ttlMs, expireAt: new Date(now + ttlMs), json });
  } catch {
    // ignore write failures
  }
}
