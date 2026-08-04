/**
 * Minimal Koscom ETF CHECK client (Checkclient SHA-256 header).
 * Mirrors etfcheck_client.py for Vercel-side live PDF rank fetches.
 */

const BASE_URL = "https://www.etfcheck.co.kr";
const FALLBACK_KEY = "vfSddfdv";
let cachedKey: string | null = null;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function resolveCheckKey(forceRefresh = false): Promise<string> {
  const env = (process.env.ETFCHECK_CHECK_KEY || "").trim();
  if (env) return env;
  if (cachedKey && !forceRefresh) return cachedKey;
  try {
    const res = await fetch(`${BASE_URL}/js/build.js`, {
      headers: { "User-Agent": UA, Referer: `${BASE_URL}/` },
      cache: "no-store",
    });
    if (res.ok) {
      const text = await res.text();
      const match =
        text.match(/exports=\{key:"([^"]{3,64})"\}/) ||
        text.match(/\{key:"([^"]{3,64})"\}/);
      if (match?.[1]) {
        cachedKey = match[1];
        return cachedKey;
      }
    }
  } catch {
    /* keep fallback */
  }
  return cachedKey || FALLBACK_KEY;
}

async function checkclientToken(forceKeyRefresh = false): Promise<string> {
  const key = await resolveCheckKey(forceKeyRefresh);
  const bucket = String(Math.floor(Date.now() / 30_000));
  const parts: string[] = [];
  for (const digit of bucket) {
    const idx = digit.charCodeAt(0) - "0".charCodeAt(0);
    if (idx >= 0 && idx < key.length) parts.push(key[idx]!);
    else parts.push("undefined");
  }
  return sha256Hex(parts.join(""));
}

export type EtfCheckPdfRow = {
  code: string;
  name: string;
  weight_pct: number | null;
  price: number | null;
  change_pct: number | null;
  as_of: string | null;
};

function asOfFromRaw(raw: unknown): string | null {
  const s = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const compact = s.replace(/\D/g, "");
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  return null;
}

function num(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function fetchKrPdfWeights(
  code: string,
  limit = 30,
): Promise<EtfCheckPdfRow[]> {
  const ticker = code.trim().toUpperCase();
  if (!ticker) return [];

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const token = await checkclientToken(attempt >= 2);
      const url = new URL(`${BASE_URL}/user/etp/getEtfPdfRankListWeight`);
      url.searchParams.set("code", ticker);
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/plain, */*",
          Referer: `${BASE_URL}/`,
          Origin: BASE_URL,
          Checkclient: token,
          checkclient: token,
          etfcheckclient: token,
          Connection: "close",
        },
        cache: "no-store",
      });
      if (res.status === 403 && attempt < 3) continue;
      if (!res.ok) throw new Error(`ETF CHECK HTTP ${res.status}`);
      const payload = (await res.json()) as { results?: unknown[] };
      const rows = Array.isArray(payload.results) ? payload.results : [];
      const out: EtfCheckPdfRow[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const member = String(
          r.F16013_PDF || r.F16013_T || r.F16013 || "",
        ).trim();
        const name = String(r.NAME || r.F16004 || r.F16002 || "").trim();
        if (!member && !name) continue;
        out.push({
          code: member || name,
          name: name || member,
          weight_pct: num(r.WEIGHT),
          price: num(r.F15001),
          change_pct: num(r.F15004),
          as_of: asOfFromRaw(r.F12506),
        });
      }
      out.sort(
        (a, b) =>
          Number(a.weight_pct == null) - Number(b.weight_pct == null) ||
          (b.weight_pct || 0) - (a.weight_pct || 0),
      );
      return out.slice(0, Math.max(1, limit));
    } catch (exc) {
      lastErr = exc;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("ETF CHECK PDF fetch failed");
}
