/**
 * Forced-sell / credit monitor sources:
 * - KOFIA FreeSIS (증시자금·신용공여) — has 반대매매; often blocked from Vercel US egress
 * - Naver 증시자금 — 예탁금·신용잔고; reliable from Vercel (억원 단위)
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const FREE_SIS = "https://freesis.kofia.or.kr";
const FUND_SERVICE = "STATSCU0100000060";
const CREDIT_SERVICE = "STATSCU0100000070";
/** FreeSIS 단위 콤보 코드 — '01'일 때 원 스케일이 네이버 증시자금(억원)과 일치 */
const UNIT_WON_SCALE = "01";
const FREE_SIS_TIMEOUT_MS = 12_000;

export type KofiaFundDay = {
  date: string; // YYYY-MM-DD
  deposit: number; // 원 — 투자자예탁금(파생예수금 제외)
  deriv_deposit: number;
  rp_balance: number;
  unsettled: number; // 위탁매매 미수금
  opp_sell: number; // 실제 반대매매금액(미수 기준)
  opp_ratio_pct: number; // 미수금 대비 반대매매비중(%)
};

export type KofiaCreditDay = {
  date: string;
  /** 신용거래융자 전체 (원) */
  loan_total: number;
  loan_kospi: number;
  loan_kosdaq: number;
  /** 신용거래대주 전체 (원) */
  short_total: number;
  collateral_loan: number;
};

export type ForcedSellStress = "calm" | "elevated" | "high" | "extreme";

export type ForcedSellBoard = {
  as_of: string | null;
  stress: ForcedSellStress;
  stress_label: string;
  latest_fund: KofiaFundDay | null;
  latest_credit: KofiaCreditDay | null;
  /** Day-over-day credit loan change (원); negative ≈ 신용 축소 */
  credit_delta: number | null;
  fund_series: KofiaFundDay[];
  credit_series: KofiaCreditDay[];
  /** Which backends contributed */
  sources: {
    freesis_fund: boolean;
    freesis_credit: boolean;
    naver_credit: boolean;
  };
  note: string;
};

function ymdToIso(ymd: string): string {
  const s = String(ymd).replace(/\D/g, "");
  if (s.length !== 8) return String(ymd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null) return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function stressFromRatio(ratio: number): { stress: ForcedSellStress; label: string } {
  if (ratio >= 10) return { stress: "extreme", label: "강제매도 압력 매우 큼" };
  if (ratio >= 5) return { stress: "high", label: "강제매도 압력 큼" };
  if (ratio >= 2) return { stress: "elevated", label: "다소 높음" };
  return { stress: "calm", label: "안정" };
}

function cookieFrom(res: Response, prev = ""): string {
  const map = Object.fromEntries(
    (prev ? prev.split("; ") : [])
      .filter(Boolean)
      .map((x) => {
        const i = x.indexOf("=");
        return [x.slice(0, i), x.slice(i + 1)] as const;
      }),
  );
  const raw: string[] = [];
  if (typeof res.headers.getSetCookie === "function") {
    raw.push(...res.headers.getSetCookie());
  }
  const single = res.headers.get("set-cookie");
  if (single) raw.push(single);
  for (const c of raw) {
    const nv = c.split(";")[0];
    const i = nv.indexOf("=");
    if (i > 0) map[nv.slice(0, i)] = nv.slice(i + 1);
  }
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** FreeSIS/Java sometimes emits NaN/Infinity which Strict JSON.parse rejects. */
function parseFreesisJson<T>(text: string): T {
  const cleaned = text
    .replace(/:\s*NaN\b/g, ":null")
    .replace(/:\s*-Infinity\b/g, ":null")
    .replace(/:\s*Infinity\b/g, ":null")
    .replace(/:\s*undefined\b/g, ":null");
  return JSON.parse(cleaned) as T;
}

async function freesisPost<T>(
  path: string,
  body: unknown,
  cookie: string,
): Promise<{ json: T; cookie: string }> {
  const res = await fetch(`${FREE_SIS}${path}`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${FREE_SIS}/stat/FreeSIS.do?parentDivId=MSIS10000000000000&serviceId=${FUND_SERVICE}`,
      Origin: FREE_SIS,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(FREE_SIS_TIMEOUT_MS),
  });
  const next = cookieFrom(res, cookie);
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  const looksJson =
    ct.includes("json") ||
    text.trimStart().startsWith("{") ||
    text.trimStart().startsWith("[");
  if (!looksJson) {
    throw new Error(`FreeSIS ${path} non-JSON (${res.status})`);
  }
  try {
    return { json: parseFreesisJson<T>(text), cookie: next };
  } catch (exc) {
    throw new Error(
      `FreeSIS ${path} JSON parse failed: ${exc instanceof Error ? exc.message : "unknown"}`,
    );
  }
}

function kstYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(ms))
    .replace(/-/g, "");
}

function lookbackRange(days: number): { start: string; end: string } {
  const endMs = Date.now();
  return {
    start: kstYmd(endMs - days * 86_400_000),
    end: kstYmd(endMs),
  };
}

type MetaList = {
  ds1?: Array<Record<string, unknown>>;
};

type MetaSrv = {
  dsGrid?: Array<{ ORDER_SEQ?: number; HEADER_ID?: string; HEADER_NM?: string }>;
  dsGridServlet?: Array<{ OBJ_NM?: string }>;
};

async function warmSession(): Promise<string> {
  const res = await fetch(
    `${FREE_SIS}/stat/FreeSIS.do?parentDivId=MSIS10000000000000&serviceId=${FUND_SERVICE}`,
    {
      headers: { "User-Agent": UA, Accept: "text/html" },
      cache: "no-store",
      signal: AbortSignal.timeout(FREE_SIS_TIMEOUT_MS),
    },
  );
  return cookieFrom(res);
}

function parseFundRows(rows: Array<Record<string, unknown>>): KofiaFundDay[] {
  const out: KofiaFundDay[] = [];
  for (const r of rows) {
    const date = ymdToIso(String(r.TMPV1 ?? ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const opp_ratio_pct = num(r.TMPV7);
    const deposit = num(r.TMPV2);
    const unsettled = num(r.TMPV5);
    const opp_sell = num(r.TMPV6);
    if (!deposit && !unsettled && !opp_sell && !opp_ratio_pct) continue;
    out.push({
      date,
      deposit,
      deriv_deposit: num(r.TMPV3),
      rp_balance: num(r.TMPV4),
      unsettled,
      opp_sell,
      opp_ratio_pct,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function mapCreditRows(
  rows: Array<Record<string, unknown>>,
  _headers: Array<{ ORDER_SEQ?: number; HEADER_NM?: string }>,
): KofiaCreditDay[] {
  // STATSCU0100000070: 1구분 2융자전체 3코스피 4코스닥 5대주전체 … 9예탁담보
  void _headers;
  const out: KofiaCreditDay[] = [];
  for (const r of rows) {
    const date = ymdToIso(String(r.TMPV1 ?? ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const loan_total = num(r.TMPV2);
    if (!loan_total) continue;
    out.push({
      date,
      loan_total,
      loan_kospi: num(r.TMPV3),
      loan_kosdaq: num(r.TMPV4),
      short_total: num(r.TMPV5),
      collateral_loan: num(r.TMPV9),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchFundSeries(
  cookie: string,
  start: string,
  end: string,
): Promise<{ rows: KofiaFundDay[]; cookie: string }> {
  const meta = await freesisPost<MetaSrv>(
    "/meta/getSrvData.do",
    {
      dmSearchData: {
        strSvrId: FUND_SERVICE,
        tmpV1: "RD",
        tmpV45: start,
        tmpV46: end,
        strGetCode: "Y",
      },
    },
    cookie,
  );
  const obj = meta.json.dsGridServlet?.[0]?.OBJ_NM || `${FUND_SERVICE}BO`;
  const list = await freesisPost<MetaList>(
    "/meta/getMetaDataList.do",
    {
      dmSearch: {
        strSvrId: FUND_SERVICE,
        tmpV1: "RD",
        tmpV40: UNIT_WON_SCALE,
        tmpV45: start,
        tmpV46: end,
        OBJ_NM: obj,
      },
    },
    meta.cookie,
  );
  return { rows: parseFundRows(list.json.ds1 || []), cookie: list.cookie };
}

async function fetchCreditSeries(
  cookie: string,
  start: string,
  end: string,
): Promise<{ rows: KofiaCreditDay[]; cookie: string }> {
  const meta = await freesisPost<MetaSrv>(
    "/meta/getSrvData.do",
    {
      dmSearchData: {
        strSvrId: CREDIT_SERVICE,
        tmpV1: "RD",
        tmpV45: start,
        tmpV46: end,
        strGetCode: "Y",
      },
    },
    cookie,
  );
  const obj = meta.json.dsGridServlet?.[0]?.OBJ_NM || `${CREDIT_SERVICE}BO`;
  const headers = meta.json.dsGrid || [];
  const list = await freesisPost<MetaList>(
    "/meta/getMetaDataList.do",
    {
      dmSearch: {
        strSvrId: CREDIT_SERVICE,
        tmpV1: "RD",
        tmpV40: UNIT_WON_SCALE,
        tmpV45: start,
        tmpV46: end,
        OBJ_NM: obj,
      },
    },
    meta.cookie,
  );
  return {
    rows: mapCreditRows(list.json.ds1 || [], headers),
    cookie: list.cookie,
  };
}

function decodeNaverHtml(buf: Buffer, contentType: string | null): string {
  const header = (contentType || "").toLowerCase();
  const charset = header.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1]?.toLowerCase();
  const encoding =
    charset === "utf-8" || charset === "utf8"
      ? "utf-8"
      : charset === "euc-kr" || charset === "euckr" || charset === "ks_c_5601-1987"
        ? "euc-kr"
        : "euc-kr";
  try {
    return new TextDecoder(encoding).decode(buf);
  } catch {
    return buf.toString("utf-8");
  }
}

/** Naver 증시자금 — units are 억원 on the page. Works from Vercel. */
async function fetchNaverCreditSeries(): Promise<{
  deposit_series: { date: string; deposit: number }[];
  credit_series: KofiaCreditDay[];
}> {
  const res = await fetch("https://finance.naver.com/sise/sise_deposit.naver", {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      Referer: "https://finance.naver.com/",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Naver deposit HTTP ${res.status}`);
  const html = decodeNaverHtml(
    Buffer.from(await res.arrayBuffer()),
    res.headers.get("content-type"),
  );
  const deposit_series: { date: string; deposit: number }[] = [];
  const credit_series: KofiaCreditDay[] = [];
  const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trs) {
    const cells = (tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) =>
      c.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    );
    if (!cells.length || !/^\d{2}\.\d{2}\.\d{2}$/.test(cells[0])) continue;
    const date = `20${cells[0].replace(/\./g, "-")}`;
    const depositEok = num(cells[1]);
    const creditEok = num(cells[3]);
    if (!depositEok && !creditEok) continue;
    // 억원 → 원
    const deposit = depositEok * 1e8;
    const loan_total = creditEok * 1e8;
    deposit_series.push({ date, deposit });
    credit_series.push({
      date,
      loan_total,
      loan_kospi: 0,
      loan_kosdaq: 0,
      short_total: 0,
      collateral_loan: 0,
    });
  }
  deposit_series.sort((a, b) => a.date.localeCompare(b.date));
  credit_series.sort((a, b) => a.date.localeCompare(b.date));
  return { deposit_series, credit_series };
}

async function tryFreesis(
  start: string,
  end: string,
): Promise<{ fund: KofiaFundDay[]; credit: KofiaCreditDay[]; error?: string }> {
  try {
    let cookie = await warmSession();
    const fund = await fetchFundSeries(cookie, start, end);
    cookie = fund.cookie;
    let credit: KofiaCreditDay[] = [];
    try {
      const c = await fetchCreditSeries(cookie, start, end);
      credit = c.rows;
    } catch {
      credit = [];
    }
    return { fund: fund.rows, credit };
  } catch (exc) {
    return {
      fund: [],
      credit: [],
      error: exc instanceof Error ? exc.message : "FreeSIS failed",
    };
  }
}

export async function fetchForcedSellBoard(
  lookbackDays = 60,
): Promise<ForcedSellBoard> {
  const baseNote =
    "미수 기준 반대매매는 금투협 FreeSIS, 신용·예탁금은 FreeSIS 또는 네이버 증시자금. 통상 1~2영업일 지연.";

  const { start, end } = lookbackRange(lookbackDays);

  const [freesis, naver] = await Promise.all([
    tryFreesis(start, end),
    fetchNaverCreditSeries().catch(() => ({
      deposit_series: [] as { date: string; deposit: number }[],
      credit_series: [] as KofiaCreditDay[],
    })),
  ]);

  const fund_series = freesis.fund;
  const credit_series =
    freesis.credit.length > 0 ? freesis.credit : naver.credit_series;

  // If FreeSIS fund missing, still expose deposit via synthetic fund rows for the table.
  let fundForUi = fund_series;
  if (!fundForUi.length && naver.deposit_series.length) {
    fundForUi = naver.deposit_series.map((d) => ({
      date: d.date,
      deposit: d.deposit,
      deriv_deposit: 0,
      rp_balance: 0,
      unsettled: 0,
      opp_sell: 0,
      opp_ratio_pct: 0,
    }));
  }

  const sources = {
    freesis_fund: freesis.fund.length > 0,
    freesis_credit: freesis.credit.length > 0,
    naver_credit: freesis.credit.length === 0 && naver.credit_series.length > 0,
  };

  if (!fundForUi.length && !credit_series.length) {
    return {
      as_of: null,
      stress: "calm",
      stress_label: "데이터 없음",
      latest_fund: null,
      latest_credit: null,
      credit_delta: null,
      fund_series: [],
      credit_series: [],
      sources,
      note: `${baseNote} 지금은 통계를 불러오지 못했습니다.${freesis.error ? ` (${freesis.error})` : ""}`,
    };
  }

  const latest_fund = sources.freesis_fund
    ? fund_series[fund_series.length - 1] || null
    : fundForUi[fundForUi.length - 1] || null;
  // For KPIs: only treat opp metrics as real when FreeSIS fund succeeded
  const latest_fund_kpi = sources.freesis_fund
    ? fund_series[fund_series.length - 1] || null
    : null;
  const latest_credit = credit_series[credit_series.length - 1] || null;
  const prevCredit = credit_series[credit_series.length - 2];
  const credit_delta =
    latest_credit && prevCredit
      ? latest_credit.loan_total - prevCredit.loan_total
      : null;

  const { stress, label } = sources.freesis_fund
    ? stressFromRatio(latest_fund_kpi?.opp_ratio_pct ?? 0)
    : { stress: "calm" as const, label: "신용만 표시" };

  const parts: string[] = [baseNote];
  if (sources.freesis_fund) parts.push("반대매매: FreeSIS");
  else parts.push("반대매매: FreeSIS 접속 불가(서버 지역 제한 가능)");
  if (sources.freesis_credit) parts.push("신용: FreeSIS");
  else if (sources.naver_credit) parts.push("신용·예탁금: 네이버 증시자금");

  return {
    as_of: latest_fund_kpi?.date || latest_credit?.date || latest_fund?.date || null,
    stress,
    stress_label: label,
    latest_fund: latest_fund_kpi,
    latest_credit,
    credit_delta,
    fund_series: sources.freesis_fund ? fund_series : [],
    credit_series,
    sources,
    note: parts.join(" · "),
  };
}

export function fmtWonEok(n?: number | null, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const eok = n / 1e8;
  return `${eok.toLocaleString("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })}억`;
}

export function fmtWonJo(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const jo = n / 1e12;
  return `${jo.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}조`;
}
