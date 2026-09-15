import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

export const ETF_NEW_R2_KEY = "etf_web/etf-new.json";
export const ETF_KOR15_R2_KEY = "etf_web/etf-kor15.json";

type SnapshotEnvelope<T> = {
  stored_at: string;
  data: T;
};

function ageMs(iso: string | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return Date.now() - ts;
}

export async function readEtfWebSnapshot<T extends { ok?: boolean }>(
  key: string,
  maxAgeMs: number,
): Promise<{ data: T; ageMs: number; stale: boolean } | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(key);
    if (!text) return null;
    const parsed = JSON.parse(text) as SnapshotEnvelope<T> | T;
    const data = "data" in parsed && parsed.data ? parsed.data : (parsed as T);
    if (!data || typeof data !== "object") return null;
    const generatedAt = (data as { generated_at?: unknown }).generated_at;
    const storedAt =
      "stored_at" in parsed && typeof parsed.stored_at === "string"
        ? parsed.stored_at
        : typeof generatedAt === "string"
          ? generatedAt
          : "";
    const age = ageMs(storedAt);
    if (!Number.isFinite(age)) return null;
    return { data, ageMs: age, stale: age > maxAgeMs };
  } catch {
    return null;
  }
}

export async function writeEtfWebSnapshot<T extends { ok?: boolean }>(
  key: string,
  data: T,
): Promise<void> {
  if (!r2Configured() || !data?.ok) return;
  try {
    const envelope: SnapshotEnvelope<T> = {
      stored_at: new Date().toISOString(),
      data,
    };
    await r2PutObject(
      key,
      JSON.stringify(envelope),
      "application/json; charset=utf-8",
      "public, max-age=120",
    );
  } catch {
    /* ignore persist errors */
  }
}
