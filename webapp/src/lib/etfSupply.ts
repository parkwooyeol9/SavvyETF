/**
 * ETF supply/demand snapshot from Koscom ETF CHECK rank boards.
 * Server-only: uses Node HTTPS (HTTP/1.1). Do not import from client components.
 *
 * KR inflow: https://www.etfcheck.co.kr/mobile/rank/inflow
 * US inflow: https://www.etfcheck.co.kr (global ETF inflow rank)
 */

import https from "https";
import { URL } from "url";

export const ETF_SUPPLY_SOURCE_INFLOW =
  "https://www.etfcheck.co.kr/mobile/rank/inflow";
export const ETF_SUPPLY_SOURCE_US_INFLOW =
  "https://www.etfcheck.co.kr/user/etp/getGlobalEtfRankListInflow";

export type EtfSupplyInflowPeriod = "W" | "M" | "3M";
export type EtfSupplyPeriod = EtfSupplyInflowPeriod;

export const ETF_SUPPLY_INFLOW_PERIODS: EtfSupplyInflowPeriod[] = [
  "W",
  "M",
  "3M",
];

export const ETF_SUPPLY_PERIOD_LABEL: Record<EtfSupplyPeriod, string> = {
  W: "1주",
  M: "1개월",
  "3M": "3개월",
};

export type EtfSupplyRankRow = {
  rank: number;
  code: string;
  name: string;
  value: number | null;
  price: number | null;
  change_pct: number | null;
  yield_pct: number | null;
  prev_price: number | null;
};

export type EtfSupplyBoard = {
  period: EtfSupplyPeriod;
  period_label: string;
  as_of: string | null;
  rows: EtfSupplyRankRow[];
};

export type EtfSupplyPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  source: string;
  /** US-listed ETF net inflow (USD). */
  us_inflow: Record<EtfSupplyInflowPeriod, EtfSupplyBoard>;
  /** Korean-listed ETF net inflow (KRW). */
  inflow: Record<EtfSupplyInflowPeriod, EtfSupplyBoard>;
  notes: string[];
  error?: string;
};

const BASE_URL = "https://www.etfcheck.co.kr";
const FALLBACK_KEY = "vfSddfdv";
const TOP_N = 10;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const httpsAgent = new https.Agent({ keepAlive: true });
let cachedKey: string | null = null;

type RankBoard = {
  rows: Omit<EtfSupplyRankRow, "rank">[];
  date_ms: number | null;
};

function num(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function httpsGet(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers,
        agent: httpsAgent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("ETF CHECK timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function resolveCheckKey(forceRefresh = false): Promise<string> {
  const env = (process.env.ETFCHECK_CHECK_KEY || "").trim();
  if (env) return env;
  if (cachedKey && !forceRefresh) return cachedKey;
  try {
    const res = await httpsGet(
      `${BASE_URL}/js/build.js`,
      { "User-Agent": UA, Referer: `${BASE_URL}/` },
      8_000,
    );
    if (res.status >= 200 && res.status < 300) {
      const match =
        res.body.match(/exports=\{key:"([^"]{3,64})"\}/) ||
        res.body.match(/\{key:"([^"]{3,64})"\}/);
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

async function getJson(
  path: string,
  params: Record<string, string | number>,
): Promise<{ success?: boolean; message?: string; results?: unknown; date?: unknown }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const token = await checkclientToken(attempt >= 1);
      const url = new URL(`${BASE_URL}${path}`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
      const res = await httpsGet(
        url.toString(),
        {
          "User-Agent": UA,
          Accept: "application/json, text/plain, */*",
          Origin: BASE_URL,
          Referer: `${BASE_URL}/`,
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          Checkclient: token,
          checkclient: token,
          etfcheckclient: token,
        },
        12_000,
      );
      if (res.status === 403 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`ETF CHECK HTTP ${res.status}`);
      }
      const payload = JSON.parse(res.body) as {
        success?: boolean;
        message?: string;
        results?: unknown;
        date?: unknown;
      };
      if (payload && payload.success === false) {
        throw new Error(`ETF CHECK ${path}: ${payload.message || "unknown error"}`);
      }
      return payload;
    } catch (exc) {
      lastErr = exc;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`ETF CHECK ${path} failed`);
}

function stampBoard(
  rows: RankBoard["rows"],
  date: unknown,
  limit: number,
): RankBoard {
  const dateNum = Number(date);
  return {
    rows: rows.slice(0, Math.max(1, limit)),
    date_ms: Number.isFinite(dateNum) && dateNum > 0 ? dateNum : null,
  };
}

function parseBoard(
  payload: { results?: unknown; date?: unknown },
  limit: number,
): RankBoard {
  const rows: RankBoard["rows"] = [];
  const raw = Array.isArray(payload.results) ? payload.results : [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const code = String(r.F16013 || "").trim();
    const name = String(r.F16002 || r.F16004 || "").trim();
    if (!code && !name) continue;
    rows.push({
      code: code || name,
      name: name || code,
      value: num(r.RANK_VALUE ?? r.INFLOW),
      price: num(r.F15001 ?? r.JONGGA),
      change_pct: num(r.F15004),
      yield_pct: num(r.YIELD),
      prev_price: num(r.BEF_JONGGA),
    });
  }
  return stampBoard(rows, payload.date, limit);
}

function parseGlobalBoard(
  payload: { results?: unknown; date?: unknown },
  limit: number,
): RankBoard {
  const rows: RankBoard["rows"] = [];
  const raw = Array.isArray(payload.results) ? payload.results : [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const code = String(r.SYMBOL || "").trim();
    const name = String(r.FUNDNAME || "").trim();
    if (!code && !name) continue;
    rows.push({
      code: code || name,
      name: name || code,
      value: num(r.RANK_VALUE),
      price: null,
      change_pct: null,
      yield_pct: num(r.YIELD),
      prev_price: null,
    });
  }
  return stampBoard(rows, payload.date, limit);
}

const RANK_BASE = {
  type: "ETF",
  annuityCode: "A",
  ctgLargeCode: "A",
  orderBy: "DESC",
  leverage: "",
  inverse: "",
  invCode: "",
  coveredCall: "",
};

async function fetchInflow(order: EtfSupplyInflowPeriod): Promise<RankBoard> {
  const payload = await getJson("/user/etp/getEtpRankListInflow2", {
    ...RANK_BASE,
    order,
    limit: TOP_N,
  });
  return parseBoard(payload, TOP_N);
}

async function fetchUsInflow(order: EtfSupplyInflowPeriod): Promise<RankBoard> {
  const payload = await getJson("/user/etp/getGlobalEtfRankListInflow", {
    ...RANK_BASE,
    order,
    limit: TOP_N,
  });
  return parseGlobalBoard(payload, TOP_N);
}

function emptyInflowMap(): Record<EtfSupplyInflowPeriod, EtfSupplyBoard> {
  return {
    W: emptyBoard("W"),
    M: emptyBoard("M"),
    "3M": emptyBoard("3M"),
  };
}

function kstNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}

function fmtKst(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm} KST`;
}

function asOfFromMs(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  try {
    return new Date(ms).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return null;
  }
}

function boardFrom(period: EtfSupplyPeriod, fetched: RankBoard): EtfSupplyBoard {
  return {
    period,
    period_label: ETF_SUPPLY_PERIOD_LABEL[period],
    as_of: asOfFromMs(fetched.date_ms),
    rows: fetched.rows.slice(0, TOP_N).map((row, i) => ({ ...row, rank: i + 1 })),
  };
}

function emptyBoard(period: EtfSupplyPeriod): EtfSupplyBoard {
  return {
    period,
    period_label: ETF_SUPPLY_PERIOD_LABEL[period],
    as_of: null,
    rows: [],
  };
}

async function loadInflowBoards(
  fetchBoard: (period: EtfSupplyInflowPeriod) => Promise<RankBoard>,
): Promise<Record<EtfSupplyInflowPeriod, EtfSupplyBoard>> {
  const entries = await Promise.all(
    ETF_SUPPLY_INFLOW_PERIODS.map(async (period) => {
      try {
        return [period, await fetchBoard(period)] as const;
      } catch {
        return [period, { rows: [], date_ms: null } as RankBoard] as const;
      }
    }),
  );
  const boards = emptyInflowMap();
  for (const [period, board] of entries) {
    boards[period] = boardFrom(period, board);
  }
  return boards;
}

export async function collectEtfSupply(): Promise<EtfSupplyPayload> {
  const generated = new Date();
  const notes: string[] = [
    "국내 ETF 자금유입은 ETF CHECK 순유입(원), 미국 상장 ETF 자금유입은 글로벌 랭킹(달러).",
    "기간은 1주·1개월·3개월이며 각 기간 순유입 상위 10종입니다.",
  ];

  try {
    const [inflow, usInflow] = await Promise.all([
      loadInflowBoards(fetchInflow),
      loadInflowBoards(fetchUsInflow),
    ]);

    const ok = ETF_SUPPLY_INFLOW_PERIODS.some(
      (period) => inflow[period].rows.length > 0 || usInflow[period].rows.length > 0,
    );

    return {
      ok,
      generated_at: generated.toISOString(),
      generated_at_display: fmtKst(kstNow()),
      source: "etfcheck",
      us_inflow: usInflow,
      inflow,
      notes,
      error: ok ? undefined : "ETF CHECK 수급 랭킹을 가져오지 못했습니다.",
    };
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return {
      ok: false,
      generated_at: generated.toISOString(),
      generated_at_display: fmtKst(kstNow()),
      source: "etfcheck",
      us_inflow: emptyInflowMap(),
      inflow: emptyInflowMap(),
      notes,
      error: message,
    };
  }
}
