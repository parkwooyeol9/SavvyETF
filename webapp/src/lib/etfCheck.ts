/**
 * Minimal Koscom ETF CHECK client (Checkclient SHA-256 header).
 * Mirrors etfcheck_client.py for Vercel-side live PDF rank fetches.
 */

const BASE_URL = "https://www.etfcheck.co.kr";
const FALLBACK_KEY = "vfSddfdv";
let cachedKey: string | null = null;
const cookieJar = new Map<string, string>();
let lastWarmupAt = 0;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function cookieHeader(): string {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorbSetCookies(res: Response) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
  for (const line of raw) {
    const pair = line.split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) cookieJar.set(name, value);
  }
}

function commonHeaders(extra?: Record<string, string>): HeadersInit {
  const cookie = cookieHeader();
  return {
    "User-Agent": UA,
    Referer: `${BASE_URL}/`,
    ...(cookie ? { Cookie: cookie } : {}),
    ...(extra || {}),
  };
}

async function warmup(force = false): Promise<void> {
  if (!force && Date.now() - lastWarmupAt < 5 * 60_000 && cookieJar.size) return;
  try {
    const res = await fetch(`${BASE_URL}/`, {
      headers: commonHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      redirect: "follow",
    });
    absorbSetCookies(res);
    lastWarmupAt = Date.now();
  } catch {
    /* PDF fetch may still work without cookies */
  }
}

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
      headers: commonHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    absorbSetCookies(res);
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

type EtfCheckPayload = {
  success?: boolean;
  message?: string;
  results?: unknown;
};

async function etfCheckGetJson(
  path: string,
  params?: Record<string, string | number>,
): Promise<EtfCheckPayload> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await warmup(attempt > 0);
      const token = await checkclientToken(attempt >= 1);
      const url = new URL(`${BASE_URL}${path}`);
      for (const [key, value] of Object.entries(params || {})) {
        url.searchParams.set(key, String(value));
      }
      const res = await fetch(url, {
        headers: commonHeaders({
          Accept: "application/json, text/plain, */*",
          Origin: BASE_URL,
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          Checkclient: token,
          checkclient: token,
          etfcheckclient: token,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      absorbSetCookies(res);
      if (res.status === 403 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`ETF CHECK HTTP ${res.status}`);
      const payload = (await res.json()) as EtfCheckPayload;
      if (payload && payload.success === false) {
        throw new Error(
          `ETF CHECK ${path}: ${payload.message || "unknown error"}`,
        );
      }
      return payload;
    } catch (exc) {
      lastErr = exc;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`ETF CHECK ${path} failed`);
}

function resultRows(payload: EtfCheckPayload): Record<string, unknown>[] {
  return Array.isArray(payload.results)
    ? payload.results.filter(
        (row): row is Record<string, unknown> =>
          !!row && typeof row === "object",
      )
    : [];
}

export async function fetchKrPdfWeights(
  code: string,
  limit = 30,
): Promise<EtfCheckPdfRow[]> {
  const ticker = code.trim().toUpperCase();
  if (!ticker) return [];
  const payload = await etfCheckGetJson("/user/etp/getEtfPdfRankListWeight", {
    code: ticker,
  });
  const out: EtfCheckPdfRow[] = [];
  for (const r of resultRows(payload)) {
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
}

export type EtfCheckMastRow = {
  symbol: string;
  simple_code: string | null;
  mstar_id: string;
  name: string;
};

type MastCache = { at: number; bySymbol: Map<string, EtfCheckMastRow> };
let mastCache: MastCache | null = null;
const MAST_TTL_MS = 30 * 60_000;

export async function fetchGlobalEtfMastBySymbol(): Promise<
  Map<string, EtfCheckMastRow>
> {
  if (mastCache && Date.now() - mastCache.at < MAST_TTL_MS) {
    return mastCache.bySymbol;
  }
  const payload = await etfCheckGetJson("/user/common/getGlobalEtfMast");
  const bySymbol = new Map<string, EtfCheckMastRow>();
  for (const r of resultRows(payload)) {
    const symbol = String(r.SYMBOL || "").trim().toUpperCase();
    const mstarId = String(r.MSTARID || "").trim();
    if (!symbol || !mstarId) continue;
    const row: EtfCheckMastRow = {
      symbol,
      simple_code: String(r.SIMPLE_CODE || "").trim().toUpperCase() || null,
      mstar_id: mstarId,
      name: String(r.FUNDNAME || "").trim(),
    };
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, row);
    if (row.simple_code && !bySymbol.has(row.simple_code)) {
      bySymbol.set(row.simple_code, row);
    }
  }
  mastCache = { at: Date.now(), bySymbol };
  return bySymbol;
}

export async function fetchGlobalEtfItemInfo(
  mstarId: string,
): Promise<Record<string, unknown> | null> {
  const code = mstarId.trim();
  if (!code) return null;
  const payload = await etfCheckGetJson("/user/etp/getGlobalEtfItemInfo", {
    code,
  });
  return resultRows(payload)[0] || null;
}

export type EtfCheckUsHolding = {
  code: string;
  name: string;
  weight_pct: number | null;
};

export async function fetchGlobalEtfPdfDetail(
  mstarId: string,
  limit = 600,
): Promise<EtfCheckUsHolding[]> {
  const code = mstarId.trim();
  if (!code) return [];
  const payload = await etfCheckGetJson("/user/etp/getGlobalEtfPdfDetail", {
    code,
    limit: Math.max(20, Math.min(1000, Math.floor(limit))),
  });
  const out: EtfCheckUsHolding[] = [];
  for (const r of resultRows(payload)) {
    const ticker = String(r.HLDTICKER || r.TICKER || "").trim().toUpperCase();
    const name = String(
      r.HLDNAME || r.HLDSENM || r.F16004 || r.F16002 || "",
    ).trim();
    if (!ticker && !name) continue;
    const weight = num(r.HLDWGHT ?? r.WEIGHT);
    out.push({
      code: ticker || name,
      name: name || ticker,
      weight_pct: weight,
    });
  }
  out.sort(
    (a, b) =>
      Number(a.weight_pct == null) - Number(b.weight_pct == null) ||
      (b.weight_pct || 0) - (a.weight_pct || 0),
  );
  return out;
}
