/**
 * KOFIA FreeSIS (금융투자협회 종합통계) — market fund & forced-sell series.
 * 증시자금추이(STATSCU0100000060): 예탁금·미수금·반대매매.
 * 신용공여 잔고(STATSCU0100000070): 신용거래융자·대주.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const FREE_SIS = "https://freesis.kofia.or.kr";
const FUND_SERVICE = "STATSCU0100000060";
const CREDIT_SERVICE = "STATSCU0100000070";
/** FreeSIS 단위 콤보 코드 — '01'일 때 원 스케일이 네이버 증시자금(억원)과 일치 */
const UNIT_WON_SCALE = "01";

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
    // Need at least ratio or an amount field to keep the row.
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
  // STATSCU0100000070 fixed layout (group headers excluded from TMPV*):
  // 1 구분 · 2 융자전체 · 3 융자코스피 · 4 융자코스닥 ·
  // 5 대주전체 · 6 대주코스피 · 7 대주코스닥 · 8 청약 · 9 예탁담보
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
  // Meta warm (browser does this before grid submit)
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

export async function fetchForcedSellBoard(
  lookbackDays = 60,
): Promise<ForcedSellBoard> {
  const emptyNote =
    "금융투자협회 FreeSIS 증시자금·신용공여. 미수 기준 반대매매(신용담보 반대매매 전체와 범위가 다를 수 있음). 통상 1~2영업일 지연.";

  const empty = (extra?: string): ForcedSellBoard => ({
    as_of: null,
    stress: "calm",
    stress_label: "데이터 없음",
    latest_fund: null,
    latest_credit: null,
    credit_delta: null,
    fund_series: [],
    credit_series: [],
    note: extra ? `${emptyNote} ${extra}` : emptyNote,
  });

  const attempt = async (): Promise<ForcedSellBoard> => {
    const { start, end } = lookbackRange(lookbackDays);
    if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end)) {
      throw new Error("invalid lookback dates");
    }
    let cookie = await warmSession();
    const fund = await fetchFundSeries(cookie, start, end);
    cookie = fund.cookie;
    let creditRows: KofiaCreditDay[] = [];
    try {
      const credit = await fetchCreditSeries(cookie, start, end);
      creditRows = credit.rows;
    } catch {
      creditRows = [];
    }

    const fund_series = fund.rows;
    const credit_series = creditRows;
    if (!fund_series.length && !credit_series.length) {
      throw new Error("empty FreeSIS series");
    }
    const latest_fund = fund_series[fund_series.length - 1] || null;
    const latest_credit = credit_series[credit_series.length - 1] || null;
    const prevCredit = credit_series[credit_series.length - 2];
    const credit_delta =
      latest_credit && prevCredit
        ? latest_credit.loan_total - prevCredit.loan_total
        : null;
    const { stress, label } = stressFromRatio(latest_fund?.opp_ratio_pct ?? 0);

    return {
      as_of: latest_fund?.date || latest_credit?.date || null,
      stress,
      stress_label: label,
      latest_fund,
      latest_credit,
      credit_delta,
      fund_series,
      credit_series,
      note: emptyNote,
    };
  };

  try {
    return await attempt();
  } catch {
    try {
      // One retry — FreeSIS sessions / NaN payloads are intermittently flaky.
      return await attempt();
    } catch {
      return empty("지금은 협회 통계를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.");
    }
  }
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
