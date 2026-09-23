/**
 * Nextrade (NXT) ATS board — market share, focus names, investor mix, top value.
 * Sources: nextrade.co.kr JSON + Naver realtime (KRX vs NXT overlay).
 */

import { buildXlsx, headerRow, type CellInput, type SheetSpec } from "@/lib/xlsxWorkbook";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const NEXTRADE_DAILY = "https://nextrade.co.kr/dailyInfo/dailyInfoListAll.do";
const NEXTRADE_STOCK_ALL = "https://nextrade.co.kr/brdinfoTime/brdinfoTimeListAll.do";
const NEXTRADE_INVESTOR = "https://nextrade.co.kr/itpc/itpcList.do";
const NAVER_REALTIME = "https://polling.finance.naver.com/api/realtime";

const FOCUS = [
  { code: "005930", name: "삼성전자" },
  { code: "000660", name: "SK하이닉스" },
] as const;

export type NxtFocusRow = {
  code: string;
  name: string;
  krx_price: number | null;
  krx_change_pct: number | null;
  krx_value: number | null;
  krx_volume: number | null;
  nxt_available: boolean;
  nxt_price: number | null;
  nxt_change_pct: number | null;
  nxt_value: number | null;
  nxt_volume: number | null;
  nxt_share_vs_krx_pct: number | null;
};

export type NxtDailyShare = {
  date: string;
  volume: number | null;
  value: number | null;
  mkt_share_pct: number | null;
};

export type NxtInvestorDay = {
  date: string;
  /** Turnover share % (ask+bid value). */
  individual_share_pct: number | null;
  institution_share_pct: number | null;
  foreign_share_pct: number | null;
  individual_net_eok: number | null;
  institution_net_eok: number | null;
  foreign_net_eok: number | null;
  individual_turn_eok: number | null;
  institution_turn_eok: number | null;
  foreign_turn_eok: number | null;
};

export type NxtTopRow = {
  rank: number;
  code: string;
  name: string;
  market: string;
  price: number | null;
  change_pct: number | null;
  value: number | null;
  volume: number | null;
};

export type NextradeBoardPayload = {
  ok: boolean;
  generated_at: string;
  session_day: string;
  month_label: string;
  sessions_note: string;
  focus: NxtFocusRow[];
  daily_share: NxtDailyShare[];
  today_share_pct: number | null;
  month_avg_share_pct: number | null;
  today_value: number | null;
  today_volume: number | null;
  investors: NxtInvestorDay[];
  top_value: NxtTopRow[];
  headline_ko: string;
  notes: string[];
  error?: string;
  source: string;
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function ymdDash(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function kstNow(): Date {
  const raw = new Date();
  const utc = raw.getTime() + raw.getTimezoneOffset() * 60_000;
  return new Date(utc + 9 * 3600_000);
}

function sessionDay(now = kstNow()): Date {
  const d = new Date(now);
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).replace(/,/g, "").replace(/%/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function eok(won: number | null): number | null {
  if (won == null) return null;
  return Number((won / 1e8).toFixed(1));
}

async function nxtPost(
  url: string,
  referer: string,
  body: Record<string, string | number>,
): Promise<unknown> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) form.set(k, String(v));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Referer: referer,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: form.toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Nextrade HTTP ${res.status}`);
  return res.json();
}

async function fetchMarketDaily(begin: Date, end: Date): Promise<NxtDailyShare[]> {
  const json = (await nxtPost(
    NEXTRADE_DAILY,
    "https://nextrade.co.kr/menu/transactionStatusDaily/menuList.do",
    {
      pageUnit: 200,
      scBeginDe: ymd(begin),
      scEndDe: ymd(end),
    },
  )) as { rows?: Array<Record<string, unknown>> };
  const rows = [...(json.rows || [])].sort((a, b) =>
    String(a.aggDd || "").localeCompare(String(b.aggDd || "")),
  );
  return rows.map((r) => {
    const raw = String(r.aggDd || "");
    const date =
      raw.length === 8
        ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
        : raw;
    return {
      date,
      volume: num(r.totalAccTdQty),
      value: num(r.mainAccTrval ?? r.totalAccTrval ?? r.accTrval),
      mkt_share_pct: num(r.mktShr),
    };
  });
}

async function fetchInvestors(begin: Date, end: Date): Promise<NxtInvestorDay[]> {
  const json = (await nxtPost(
    NEXTRADE_INVESTOR,
    "https://nextrade.co.kr/menu/transactionStatusInvestor/menuList.do",
    {
      pageIndex: 1,
      pageUnit: 90,
      scBeginDe: ymd(begin),
      scEndDe: ymd(end),
      scSecuGroup: "STOCK",
      sortKey: "AGG_DD",
      sortType: "asc",
    },
  )) as { investorInfoList?: Array<Record<string, unknown>> };
  const rows = json.investorInfoList || [];
  return rows
    .map((r) => {
      const date = String(r.trdDe || "");
      const indAsk = num(r.indValAsk) || 0;
      const indBid = num(r.indValBid) || 0;
      const instAsk = num(r.instValAsk) || 0;
      const instBid = num(r.instValBid) || 0;
      const frgnAsk = num(r.frgnValAsk) || 0;
      const frgnBid = num(r.frgnValBid) || 0;
      const indTurn = indAsk + indBid;
      const instTurn = instAsk + instBid;
      const frgnTurn = frgnAsk + frgnBid;
      const total = indTurn + instTurn + frgnTurn;
      const pct = (x: number) =>
        total > 0 ? Number(((100 * x) / total).toFixed(2)) : null;
      return {
        date,
        individual_share_pct: pct(indTurn),
        institution_share_pct: pct(instTurn),
        foreign_share_pct: pct(frgnTurn),
        individual_net_eok: eok(indBid - indAsk),
        institution_net_eok: eok(instBid - instAsk),
        foreign_net_eok: eok(frgnBid - frgnAsk),
        individual_turn_eok: eok(indTurn),
        institution_turn_eok: eok(instTurn),
        foreign_turn_eok: eok(frgnTurn),
      } satisfies NxtInvestorDay;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchTopValue(day: Date, n = 12): Promise<NxtTopRow[]> {
  const json = (await nxtPost(
    NEXTRADE_STOCK_ALL,
    "https://nextrade.co.kr/menu/transactionStatusMain/menuList.do",
    {
      pageUnit: 2000,
      scAggDd: ymd(day),
      scMktId: "",
      searchKeyword: "",
    },
  )) as { rows?: Array<Record<string, unknown>> };
  const rows = [...(json.rows || [])]
    .map((r) => ({
      code: String(r.isuSrdCd || "").replace(/\D/g, "").slice(-6),
      name: String(r.isuAbwdNm || r.isuKorAbbrv || r.isuKorNm || "").trim(),
      market: String(r.mktNm || r.mktId || "").trim(),
      price: num(r.curPrc ?? r.clpr ?? r.trdPrc),
      change_pct: num(r.upDownRate ?? r.fltRt),
      value: num(r.accTrval),
      volume: num(r.accTdQty),
    }))
    .filter((r) => r.code && (r.value || 0) > 0)
    .sort((a, b) => (b.value || 0) - (a.value || 0))
    .slice(0, n);
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

async function fetchNaverDomestic(
  codes: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!codes.length) return out;
  try {
    const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${codes.join(",")}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://finance.naver.com/" },
      cache: "no-store",
    });
    if (!res.ok) return out;
    const payload = (await res.json()) as {
      datas?: Array<Record<string, unknown>>;
    };
    for (const row of payload.datas || []) {
      const code = String(row.itemCode || "");
      if (code) out.set(code, row);
    }
  } catch {
    /* ignore */
  }
  return out;
}

async function fetchNaverServiceItem(
  code: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(
      `${NAVER_REALTIME}?query=${encodeURIComponent(`SERVICE_ITEM:${code}`)}`,
      {
        headers: {
          "User-Agent": UA,
          Referer: "https://m.stock.naver.com/",
          Accept: "application/json,text/plain,*/*",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: { areas?: Array<{ datas?: Array<Record<string, unknown>> }> };
    };
    for (const area of json.result?.areas || []) {
      for (const d of area.datas || []) {
        if (String(d.cd || "").trim() === code) return d;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function fetchFocusLive(): Promise<NxtFocusRow[]> {
  const codes = FOCUS.map((f) => f.code);
  const [domestic, ...serviceRows] = await Promise.all([
    fetchNaverDomestic(codes),
    ...FOCUS.map((f) => fetchNaverServiceItem(f.code)),
  ]);

  return FOCUS.map((f, i) => {
    const krx = domestic.get(f.code) || null;
    const svc = serviceRows[i];
    const nxt = (svc?.nxtOverMarketPriceInfo || null) as Record<
      string,
      unknown
    > | null;
    const krxVol = num(
      krx?.accumulatedTradingVolumeRaw ??
        svc?.accumulatedTradingVolumeRaw ??
        svc?.ahv,
    );
    const krxVal = num(
      krx?.accumulatedTradingValueRaw ??
        svc?.accumulatedTradingValueRaw ??
        svc?.atv,
    );
    const nxtVol = nxt ? num(nxt.accumulatedTradingVolumeRaw) : null;
    const nxtVal = nxt ? num(nxt.accumulatedTradingValueRaw) : null;
    const combined =
      krxVol != null && nxtVol != null && krxVol + nxtVol > 0
        ? Number(((100 * nxtVol) / (krxVol + nxtVol)).toFixed(1))
        : null;
    return {
      code: f.code,
      name: f.name,
      krx_price: num(krx?.closePriceRaw ?? svc?.nv),
      krx_change_pct: num(krx?.fluctuationsRatioRaw ?? svc?.cr),
      krx_value: krxVal,
      krx_volume: krxVol,
      nxt_available: Boolean(nxt && Object.keys(nxt).length),
      nxt_price: nxt
        ? num(String(nxt.overPrice || "").replace(/,/g, ""))
        : null,
      nxt_change_pct: nxt ? num(nxt.fluctuationsRatio) : null,
      nxt_value: nxtVal,
      nxt_volume: nxtVol,
      nxt_share_vs_krx_pct: combined,
    };
  });
}

function fmtEok(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}조`;
  return `${n.toLocaleString("ko-KR")}억`;
}

function fmtPct(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(d)}%`;
}

function parseDashDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export async function computeNextradeBoard(): Promise<NextradeBoardPayload> {
  const day = sessionDay();
  const beginMonth = monthStart(day);
  const invBegin = addDays(day, -45);

  const [daily, investors, focus] = await Promise.all([
    fetchMarketDaily(beginMonth, day),
    fetchInvestors(invBegin, day),
    fetchFocusLive(),
  ]);

  const todayKey = ymdDash(day);
  // Prefer last session with real turnover (today can be 0 early / holiday).
  const todayRow =
    daily.find((d) => d.date === todayKey && (d.value || 0) > 0) ||
    [...daily].reverse().find((d) => (d.value || 0) > 0) ||
    daily.find((d) => d.date === todayKey) ||
    daily[daily.length - 1] ||
    null;
  const effectiveDay = todayRow?.date || todayKey;

  // TOP: prefer live session day; if empty fall back to last settled day.
  let top = await fetchTopValue(day, 15);
  if (!top.length && effectiveDay !== todayKey) {
    top = await fetchTopValue(parseDashDay(effectiveDay), 15);
  }

  const shares = daily
    .map((d) => d.mkt_share_pct)
    .filter((x): x is number => x != null);
  const monthAvg = shares.length
    ? Number((shares.reduce((a, b) => a + b, 0) / shares.length).toFixed(2))
    : null;

  const lastInv =
    [...investors].reverse().find((r) => (r.individual_turn_eok || 0) > 0) ||
    investors[investors.length - 1];
  const headlineParts = [
    `${effectiveDay} NXT 장외(ATS)`,
    todayRow?.mkt_share_pct != null
      ? `거래량 점유 ${fmtPct(todayRow.mkt_share_pct)}`
      : null,
    todayRow?.value != null ? `대금 ${fmtEok(eok(todayRow.value))}` : null,
    lastInv
      ? `투자자 대금비중 개인 ${fmtPct(lastInv.individual_share_pct)} · 기관 ${fmtPct(lastInv.institution_share_pct)} · 외국인 ${fmtPct(lastInv.foreign_share_pct)}`
      : null,
  ].filter(Boolean);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    session_day: effectiveDay,
    month_label: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}`,
    sessions_note:
      "프리 08:00–08:50 · 메인 09:00:30–15:20 · 애프터 15:40–20:00 (KST)",
    focus,
    daily_share: daily,
    today_share_pct: todayRow?.mkt_share_pct ?? null,
    month_avg_share_pct: monthAvg,
    today_value: todayRow?.value ?? null,
    today_volume: todayRow?.volume ?? null,
    investors,
    top_value: top,
    headline_ko: headlineParts.join(" · "),
    notes: [
      "NXT는 KRX 정규장과 병행하는 대체거래소(ATS) 장외 체결입니다.",
      "투자자 비중 = (매도대금+매수대금) 합 대비 개인·기관·외국인 비중. 순매수 = 매수−매도 (억원).",
      "포커스 량비중 = NXT 거래량 / (KRX+NXT) × 100.",
      "출처: nextrade.co.kr · Naver 실시간(포커스 KRX vs NXT).",
    ],
    source: "nextrade.co.kr + Naver",
  };
}

export function emptyNextradeBoard(error?: string): NextradeBoardPayload {
  return {
    ok: false,
    generated_at: new Date().toISOString(),
    session_day: "",
    month_label: "",
    sessions_note: "",
    focus: [],
    daily_share: [],
    today_share_pct: null,
    month_avg_share_pct: null,
    today_value: null,
    today_volume: null,
    investors: [],
    top_value: [],
    headline_ko: "",
    notes: [],
    error,
    source: "nextrade.co.kr",
  };
}

export function buildNextradeExcel(payload: NextradeBoardPayload): Buffer {
  const cover: CellInput[][] = [
    [{ v: "SavvyETF · 넥스트레이드(장외) 모니터", t: "header" }],
    [{ v: `세션일 ${payload.session_day} · 생성 ${payload.generated_at}`, t: "text" }],
    [],
    [{ v: payload.headline_ko, t: "text" }],
    [],
    headerRow(["지표", "값"]),
    ["당일 점유율", fmtPct(payload.today_share_pct)],
    ["당월 평균점유", fmtPct(payload.month_avg_share_pct)],
    ["당일 대금(원)", payload.today_value ?? "—"],
    ["당일 거래량(주)", payload.today_volume ?? "—"],
    [],
    ...payload.notes.map((n) => [{ v: n, t: "text" } as CellInput]),
  ];

  const shareSheet: CellInput[][] = [
    headerRow(["일자", "거래량", "대금(원)", "점유율%"]),
    ...payload.daily_share.map((d) => [
      d.date,
      d.volume,
      d.value,
      d.mkt_share_pct,
    ]),
  ];

  const invSheet: CellInput[][] = [
    headerRow([
      "일자",
      "개인비중%",
      "기관비중%",
      "외국인비중%",
      "개인순매수억",
      "기관순매수억",
      "외국인순매수억",
      "개인대금억",
      "기관대금억",
      "외국인대금억",
    ]),
    ...payload.investors.map((d) => [
      d.date,
      d.individual_share_pct,
      d.institution_share_pct,
      d.foreign_share_pct,
      d.individual_net_eok,
      d.institution_net_eok,
      d.foreign_net_eok,
      d.individual_turn_eok,
      d.institution_turn_eok,
      d.foreign_turn_eok,
    ]),
  ];

  const topSheet: CellInput[][] = [
    headerRow(["순위", "코드", "종목", "시장", "가격", "등락%", "대금", "거래량"]),
    ...payload.top_value.map((r) => [
      r.rank,
      r.code,
      r.name,
      r.market,
      r.price,
      r.change_pct,
      r.value,
      r.volume,
    ]),
  ];

  const focusSheet: CellInput[][] = [
    headerRow([
      "코드",
      "종목",
      "KRX가",
      "KRX%",
      "KRX대금",
      "NXT가",
      "NXT%",
      "NXT대금",
      "NXT/(KRX+NXT)%",
    ]),
    ...payload.focus.map((f) => [
      f.code,
      f.name,
      f.krx_price,
      f.krx_change_pct,
      f.krx_value,
      f.nxt_price,
      f.nxt_change_pct,
      f.nxt_value,
      f.nxt_share_vs_krx_pct,
    ]),
  ];

  const sheets: SheetSpec[] = [
    { name: "요약", rows: cover, widths: [18, 48, 16, 16, 16, 16, 42] },
    { name: "일별점유율", rows: shareSheet, widths: [14, 16, 18, 12] },
    {
      name: "투자자비중",
      rows: invSheet,
      widths: [12, 11, 11, 11, 12, 12, 12, 12, 12, 12],
    },
    { name: "TOP대금", rows: topSheet, widths: [8, 10, 16, 10, 12, 10, 16, 14] },
    { name: "포커스", rows: focusSheet, widths: [10, 12, 12, 10, 14, 12, 10, 14, 12] },
  ];

  return buildXlsx(sheets, {
    title: `Nextrade ${payload.session_day}`,
    creator: "SavvyETF",
  });
}

export function nextradeExcelFilename(sessionDay: string): string {
  const stamp = sessionDay.replace(/-/g, "") || "latest";
  return `savvyetf-nextrade-${stamp}.xlsx`;
}
