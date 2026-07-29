/**
 * Server-only KRX short-sale JSON (data.krx.co.kr srtLoader, no login).
 * Confirmed: MDCSTAT30102 (trade), MDCSTAT30501 (net balance snapshot).
 */

import type {
  KrMarketShortSnapshot,
  KrShortBalancePoint,
  KrShortCreditBoard,
  KrShortTradePoint,
  KrStockShortBoard,
} from "@/lib/krShortCredit";
import { withServerCache } from "@/lib/apiCache";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const KRX = "https://data.krx.co.kr";
const JSON_URL = `${KRX}/comm/bldAttendant/getJsonData.cmd`;

const WATCH = [
  { code: "005930", name: "삼성전자", isin: "KR7005930003" },
  { code: "000660", name: "SK하이닉스", isin: "KR7000660001" },
] as const;

export type KrShortCreditBoardFull = KrShortCreditBoard & {
  market_balance_history: Record<"KOSPI" | "KOSDAQ", KrMarketShortSnapshot[]>;
};

function parseNum(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const text = String(raw).replace(/,/g, "").replace(/%/g, "").trim();
  if (!text || text === "-" || text === "N/A") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function ymdSlashToIso(d: string): string {
  return d.replace(/\//g, "-").slice(0, 10);
}

function mergeCookies(prev: string, setCookie: string | null): string {
  if (!setCookie) return prev;
  const jar = new Map<string, string>();
  for (const part of prev.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k) jar.set(k, rest.join("="));
  }
  for (const chunk of setCookie.split(/,(?=[^;]+?=)/)) {
    const [pair] = chunk.split(";");
    const [k, ...rest] = pair.trim().split("=");
    if (k) jar.set(k, rest.join("="));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function krxFetch(
  url: string,
  cookie: string,
  init?: RequestInit,
): Promise<{ text: string; cookie: string }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const next = mergeCookies(cookie, res.headers.get("set-cookie"));
  const text = await res.text();
  if (!res.ok) throw new Error(`KRX HTTP ${res.status}`);
  return { text, cookie: next };
}

async function warmSrt(cookie: string, screen: string): Promise<string> {
  const { cookie: next } = await krxFetch(
    `${KRX}/comm/srt/srtLoader/index.cmd?screenId=${screen}`,
    cookie,
    { headers: { Referer: "https://finance.naver.com/" } },
  );
  return next;
}

async function getJson(
  cookie: string,
  referer: string,
  params: Record<string, string>,
): Promise<{ json: Record<string, unknown>; cookie: string }> {
  const body = new URLSearchParams({ locale: "ko_KR", ...params });
  const { text, cookie: next } = await krxFetch(JSON_URL, cookie, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: referer,
    },
    body: body.toString(),
  });
  if (text.startsWith("LOGOUT") || text.trimStart().startsWith("<")) {
    throw new Error("KRX session/HTML response");
  }
  return { json: JSON.parse(text) as Record<string, unknown>, cookie: next };
}

function rowsOf(json: Record<string, unknown>): Array<Record<string, string>> {
  const block = json.OutBlock_1;
  return Array.isArray(block) ? (block as Array<Record<string, string>>) : [];
}

function kstYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .replace(/-/g, "");
}

function addDaysYmd(ymd: string, delta: number): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function candidateBalanceDates(n = 8): string[] {
  let cur = kstYmd();
  const out: string[] = [];
  for (let i = 0; i < 40 && out.length < n; i++) {
    cur = addDaysYmd(cur, -1);
    const dow = new Date(
      Date.UTC(Number(cur.slice(0, 4)), Number(cur.slice(4, 6)) - 1, Number(cur.slice(6, 8))),
    ).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(cur);
  }
  return out;
}

async function fetchStockTrade(
  cookie: string,
  isin: string,
  strtDd: string,
  endDd: string,
): Promise<{ points: KrShortTradePoint[]; cookie: string }> {
  const referer = `${KRX}/comm/srt/srtLoader/index.cmd?screenId=MDCSTAT301`;
  cookie = await warmSrt(cookie, "MDCSTAT301");
  const { json, cookie: next } = await getJson(cookie, referer, {
    bld: "dbms/MDC_OUT/STAT/srt/MDCSTAT30102_OUT",
    searchType: "2",
    mktId: "STK",
    isuCd: isin,
    isuCd2: isin,
    strtDd,
    endDd,
    share: "1",
    money: "1",
    secugrpId: "STMFRTSCIFDRFS",
  });
  const points: KrShortTradePoint[] = [];
  for (const row of rowsOf(json)) {
    const date = ymdSlashToIso(String(row.TRD_DD || ""));
    const short_volume = parseNum(row.CVSRTSELL_TRDVOL);
    const total_volume = parseNum(row.ACC_TRDVOL);
    if (!date || short_volume == null || total_volume == null) continue;
    points.push({
      date,
      short_volume,
      total_volume,
      short_volume_wt_pct: parseNum(row.TRDVOL_WT),
      short_value: parseNum(row.CVSRTSELL_TRDVAL) ?? 0,
      total_value: parseNum(row.ACC_TRDVAL) ?? 0,
      short_value_wt_pct: parseNum(row.TRDVAL_WT),
    });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  return { points, cookie: next };
}

type BalanceSnap = {
  market: "KOSPI" | "KOSDAQ";
  market_snap: KrMarketShortSnapshot;
  by_code: Map<string, KrShortBalancePoint>;
};

async function fetchBalanceSnapshot(
  cookie: string,
  mktTpCd: "1" | "2",
  trdDd: string,
  opts?: { warmed?: boolean },
): Promise<{ snap: BalanceSnap | null; cookie: string }> {
  const market = mktTpCd === "1" ? "KOSPI" : "KOSDAQ";
  const referer = `${KRX}/comm/srt/srtLoader/index.cmd?screenId=MDCSTAT305`;
  if (!opts?.warmed) cookie = await warmSrt(cookie, "MDCSTAT305");
  const { json, cookie: next } = await getJson(cookie, referer, {
    bld: "dbms/MDC_OUT/STAT/srt/MDCSTAT30501_OUT",
    searchType: "1",
    mktTpCd,
    trdDd,
    strtDd: trdDd,
    endDd: trdDd,
    share: "1",
    money: "1",
  });
  const rows = rowsOf(json);
  if (!rows.length) return { snap: null, cookie: next };

  let bal_qty = 0;
  let list_shares = 0;
  let bal_amt = 0;
  const by_code = new Map<string, KrShortBalancePoint>();
  const as_of = `${trdDd.slice(0, 4)}-${trdDd.slice(4, 6)}-${trdDd.slice(6, 8)}`;

  for (const row of rows) {
    const code = String(row.ISU_CD || "").trim();
    const qty = parseNum(row.BAL_QTY) ?? 0;
    const shares = parseNum(row.LIST_SHRS) ?? 0;
    const amt = parseNum(row.BAL_AMT) ?? 0;
    bal_qty += qty;
    list_shares += shares;
    bal_amt += amt;
    if (code === "005930" || code === "000660") {
      by_code.set(code, {
        date: as_of,
        bal_qty: qty,
        bal_amt: amt,
        list_shares: shares,
        bal_rto_pct: parseNum(row.BAL_RTO),
      });
    }
  }

  return {
    snap: {
      market,
      market_snap: {
        market,
        as_of,
        stock_count: rows.length,
        bal_qty,
        list_shares,
        bal_amt,
        bal_rto_pct:
          list_shares > 0 ? Math.round((bal_qty / list_shares) * 10000) / 100 : null,
      },
      by_code,
    },
    cookie: next,
  };
}

export async function fetchKrShortCreditBoard(): Promise<KrShortCreditBoardFull> {
  return withServerCache(
    "krx-short-credit:v1",
    10 * 60_000,
    20 * 60_000,
    fetchKrShortCreditBoardUncached,
  );
}

async function fetchKrShortCreditBoardUncached(): Promise<KrShortCreditBoardFull> {
  let cookie = "";
  const endDd = kstYmd();
  const strtDd = addDaysYmd(endDd, -50);

  const stocks: KrStockShortBoard[] = [];
  for (const w of WATCH) {
    try {
      const { points, cookie: next } = await fetchStockTrade(
        cookie,
        w.isin,
        strtDd,
        endDd,
      );
      cookie = next;
      stocks.push({
        code: w.code,
        name: w.name,
        isin: w.isin,
        trade: points,
        balance: [],
        latest_trade: points[points.length - 1] || null,
        latest_balance: null,
      });
    } catch {
      stocks.push({
        code: w.code,
        name: w.name,
        isin: w.isin,
        trade: [],
        balance: [],
        latest_trade: null,
        latest_balance: null,
      });
    }
  }

  const balByCode = new Map<string, KrShortBalancePoint[]>();
  for (const w of WATCH) balByCode.set(w.code, []);
  const marketHist: Record<"KOSPI" | "KOSDAQ", KrMarketShortSnapshot[]> = {
    KOSPI: [],
    KOSDAQ: [],
  };

  const dates = candidateBalanceDates(8);
  let got = 0;
  cookie = await warmSrt(cookie, "MDCSTAT305");
  for (const trdDd of dates) {
    if (got >= 4) break;
    let dayOk = false;
    for (const mkt of ["1", "2"] as const) {
      try {
        const { snap, cookie: next } = await fetchBalanceSnapshot(cookie, mkt, trdDd, {
          warmed: true,
        });
        cookie = next;
        if (!snap) continue;
        dayOk = true;
        marketHist[snap.market].push(snap.market_snap);
        for (const [code, pt] of snap.by_code) {
          balByCode.get(code)?.push(pt);
        }
      } catch {
        // soft-fail
      }
    }
    if (dayOk) got += 1;
  }

  for (const key of ["KOSPI", "KOSDAQ"] as const) {
    const seen = new Set<string>();
    const uniq: KrMarketShortSnapshot[] = [];
    for (const row of marketHist[key].sort((a, b) => a.as_of.localeCompare(b.as_of))) {
      if (seen.has(row.as_of)) continue;
      seen.add(row.as_of);
      uniq.push(row);
    }
    marketHist[key] = uniq;
  }

  for (const stock of stocks) {
    const seen = new Set<string>();
    const uniq: KrShortBalancePoint[] = [];
    for (const p of (balByCode.get(stock.code) || []).sort((a, b) =>
      a.date.localeCompare(b.date),
    )) {
      if (seen.has(p.date)) continue;
      seen.add(p.date);
      uniq.push(p);
    }
    stock.balance = uniq;
    stock.latest_balance = uniq[uniq.length - 1] || null;
  }

  const market_balance = (["KOSPI", "KOSDAQ"] as const).map((m) => {
    const hist = marketHist[m];
    return (
      hist[hist.length - 1] || {
        market: m,
        as_of: "",
        stock_count: 0,
        bal_qty: 0,
        list_shares: 0,
        bal_amt: 0,
        bal_rto_pct: null,
      }
    );
  });

  return {
    source_note:
      "공매도 거래·순보유잔고: KRX(MDCSTAT301/305). 시장 신용: 네이버 증시자금. 대차잔고는 공개 API 미확인으로 제외.",
    unavailable: ["대차잔고(stock lending)"],
    market_balance,
    market_balance_history: marketHist,
    stocks,
  };
}
