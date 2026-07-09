import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const AUTH_COOKIE = "ga4layer_auth";

export function expectedToken(): string {
  const pw = process.env.DASHBOARD_PASSWORD || "";
  return createHash("sha256").update(`ga4-simply-layer::${pw}`).digest("hex");
}

export function checkPassword(password: string): boolean {
  const pw = process.env.DASHBOARD_PASSWORD || "";
  if (!pw) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(pw);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True when no password configured (local dev without gate) or cookie valid. */
export async function isAuthed(): Promise<boolean> {
  if (!process.env.DASHBOARD_PASSWORD) return true;
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  return token === expectedToken();
}
