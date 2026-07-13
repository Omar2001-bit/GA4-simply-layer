import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

interface SAKey {
  project_id: string;
  client_email: string;
  private_key: string;
}

function loadKey(): SAKey {
  const b64 = process.env.FIREBASE_SA_KEY_B64;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  let json: string | undefined;
  if (b64) json = Buffer.from(b64, "base64").toString("utf8");
  else if (raw) json = raw;
  if (!json) throw new Error("Service account key missing: set FIREBASE_SA_KEY_B64 (base64 of the JSON key)");
  const parsed = JSON.parse(json);
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error("Service account key invalid — missing project_id, client_email, or private_key");
  }
  return parsed;
}

let cachedDb: Firestore | null = null;

export function db(): Firestore {
  if (!cachedDb) {
    const key = loadKey();
    const app =
      getApps()[0] ??
      initializeApp({
        credential: cert({
          projectId: key.project_id,
          clientEmail: key.client_email,
          privateKey: key.private_key,
        }),
      });
    cachedDb = getFirestore(app);
  }
  return cachedDb;
}
