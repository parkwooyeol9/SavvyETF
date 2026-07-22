import { NextResponse } from "next/server";

import type {
  CarbonBar,
  CarbonSeries,
  EsgCarbonPayload,
} from "@/lib/esgCarbon";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const ETS_ORIGIN = "https://ets.krx.co.kr";
const ETS_PAGE = "/contents/ETS/03/03010000/ETS03010000.jsp";
const ETS_OTP = `${ETS_ORIGIN}/contents/COM/GenerateOTP.jspx`;
const ETS_DATA = `${ETS_ORIGIN}/contents/ETS/99/ETS99000001.jspx`;
const FALLBACK_KAU = { isu_cd: "KRD050032501", isu_abbrv: "KAU25" };

const GLOBAL_ETFS = [
  {
    symbol: "KRBN",
    name: "KraneShares Global Carbon",
    note: "글로벌 탄소배출권 선물 바스켓",
  },
  {
    symbol: "KEUA",
    name: "KraneShares European Carbon Allowance",
    note: "EU ETS 배출권 선물",
  },
] as const;

function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const text = String(raw).replace(/,/g, "").replace(/%/g, "").trim();
  if (!text || text === "-" || text === "N/A") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function kstYmdParts(d = new Date()): { y: string; m: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  return {
    y: parts.find((p) => p.type === "year")?.value || "1970",
    m: parts.find((p) => p.type === "month")?.value || "01",
    day: parts.find((p) => p.type === "day")?.value || "01",
  };
}

function mergeCookies(existing: string, setCookie: string | null): string {
  if (!setCookie) return existing;
  const jar = new Map<string, string>();
  for (const part of existing.split(";").map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf("=");
    if (i > 0) jar.set(part.slice(0, i), part.slice(i + 1));
  }
  // fetch may join multiple Set-Cookie with ", " — split carefully on ", " before name=
  const chunks = setCookie.split(/,(?=\s*[^;=]+=)/);
  for (const chunk of chunks) {
    const pair = chunk.split(";")[0]?.trim();
    if (!pair) continue;
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function readSetCookie(res: Response): string | null {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    const arr = headers.getSetCookie();
    if (arr?.length) return arr.join(", ");
  }
  return res.headers.get("set-cookie");
}

async function etsFetch(
  url: string,
  cookie: string,
  init?: RequestInit
): Promise<{ text: string; cookie: string }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      Origin: ETS_ORIGIN,
      Referer: `${ETS_ORIGIN}${ETS_PAGE}`,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const nextCookie = mergeCookies(cookie, readSetCookie(res));
  if (!res.ok) {
    throw new Error(`KRX ETS HTTP ${res.status} for ${url}`);
  }
  return { text: await res.text(), cookie: nextCookie };
}

async function etsOtp(bld: string, cookie: string): Promise<{ otp: string; cookie: string }> {
  const body = new URLSearchParams({ name: "form", bld });
  const { text, cookie: next } = await etsFetch(ETS_OTP, cookie, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: body.toString(),
  });
  const otp = text.trim();
  if (!otp || otp.length < 8) throw new Error("KRX OTP empty");
  return { otp, cookie: next };
}

async function fetchDomesticCarbon(): Promise<CarbonSeries> {
  let cookie = "";
  const warm = await etsFetch(`${ETS_ORIGIN}${ETS_PAGE}`, cookie);
  cookie = warm.cookie;

  // Resolve front-month KAU (prefer KAU25-style active contract)
  let isu = FALLBACK_KAU;
  try {
    const { otp, cookie: c1 } = await etsOtp("COM/ets_itemSearch2", cookie);
    cookie = c1;
    const body = new URLSearchParams({
      mktsel: "ALL",
      pagePath: ETS_PAGE,
      code: otp,
    });
    const { text, cookie: c2 } = await etsFetch(ETS_DATA, cookie, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: body.toString(),
    });
    cookie = c2;
    const json = JSON.parse(text) as {
      result?: Array<{ isu_cd?: string; isu_abbrv?: string }>;
    };
    const kau = (json.result || []).find(
      (r) => r.isu_abbrv?.startsWith("KAU") && r.isu_cd
    );
    if (kau?.isu_cd && kau.isu_abbrv) {
      isu = { isu_cd: kau.isu_cd, isu_abbrv: kau.isu_abbrv };
    }
  } catch {
    // fallback isu
  }

  const { y, m, day } = kstYmdParts();
  const todate = `${y}${m}${day}`;
  const from = new Date(Date.UTC(Number(y), Number(m) - 1, Number(day)));
  from.setUTCDate(from.getUTCDate() - 360);
  const fromdate = yyyymmdd(from);

  const { otp, cookie: c3 } = await etsOtp(
    "ETS/03/03010000/ets03010000_05",
    cookie
  );
  cookie = c3;
  const histBody = new URLSearchParams({
    isu_cd: isu.isu_cd,
    fromdate,
    todate,
    pagePath: ETS_PAGE,
    code: otp,
  });
  const { text } = await etsFetch(ETS_DATA, cookie, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: histBody.toString(),
  });
  const json = JSON.parse(text) as {
    DS1?: Array<Record<string, string>>;
  };
  const rows = json.DS1 || [];

  const bars: CarbonBar[] = [];
  for (const row of rows) {
    const close = parseNumber(row.tdd_clsprc);
    const volume = parseNumber(row.acc_trdvol) ?? 0;
    const open = parseNumber(row.tdd_opnprc);
    const high = parseNumber(row.tdd_hgprc);
    const low = parseNumber(row.tdd_lwprc);
    const value = parseNumber(row.acc_trdval);
    const date = String(row.trd_dd || "").slice(0, 10);
    if (!date || close == null || close <= 0) continue;
    // KRX pads non-trading / not-yet-open days with flat close and zero OHLV
    const traded =
      volume > 0 ||
      (open != null && open > 0) ||
      (high != null && high > 0) ||
      (value != null && value > 0);
    if (!traded) continue;
    bars.push({
      date,
      close,
      volume,
      open,
      high,
      low,
      value,
    });
  }
  // API returns newest-first; chart wants oldest-first
  bars.sort((a, b) => a.date.localeCompare(b.date));

  const last = bars[bars.length - 1];
  const prev = bars.length >= 2 ? bars[bars.length - 2] : null;
  const change = last && prev ? last.close - prev.close : null;
  const changePct =
    last && prev && prev.close
      ? ((last.close - prev.close) / prev.close) * 100
      : null;

  return {
    symbol: isu.isu_abbrv,
    name: `한국 배출권 ${isu.isu_abbrv}`,
    market: "KR",
    currency: "KRW",
    unit: "원/톤",
    quote: {
      last: last?.close ?? null,
      change: change ?? null,
      change_pct: changePct ?? null,
      volume: last?.volume ?? null,
    },
    daily: bars,
    source: "KRX ETS (ets.krx.co.kr)",
  };
}

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        currency?: string;
        shortName?: string;
        longName?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
          volume?: Array<number | null>;
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
        }>;
      };
    }>;
    error?: { description?: string };
  };
};

async function fetchYahooEtf(
  symbol: string,
  name: string
): Promise<CarbonSeries> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=1y&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
  const json = (await res.json()) as YahooChart;
  const result = json.chart?.result?.[0];
  if (!result?.timestamp?.length) {
    throw new Error(json.chart?.error?.description || `Yahoo empty for ${symbol}`);
  }
  const q = result.indicators?.quote?.[0];
  const bars: CarbonBar[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const close = q?.close?.[i];
    if (close == null || !Number.isFinite(close)) continue;
    const ts = result.timestamp[i] * 1000;
    const d = new Date(ts);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    bars.push({
      date,
      close,
      volume: q?.volume?.[i] ?? 0,
      open: q?.open?.[i] ?? null,
      high: q?.high?.[i] ?? null,
      low: q?.low?.[i] ?? null,
    });
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));

  const last = bars[bars.length - 1];
  const meta = result.meta || {};
  const lastPx = meta.regularMarketPrice ?? last?.close ?? null;
  const prevClose =
    meta.previousClose ?? meta.chartPreviousClose ?? bars[bars.length - 2]?.close ?? null;
  const change =
    lastPx != null && prevClose != null ? lastPx - prevClose : null;
  const changePct =
    change != null && prevClose ? (change / prevClose) * 100 : null;

  return {
    symbol,
    name: meta.shortName || meta.longName || name,
    market: "US",
    currency: meta.currency || "USD",
    unit: "USD",
    quote: {
      last: lastPx,
      change,
      change_pct: changePct,
      volume: last?.volume ?? null,
    },
    daily: bars,
    source: "Yahoo Finance (탄소배출권 ETF 프록시)",
  };
}

export async function GET() {
  const generated_at = new Date().toISOString();
  try {
    const [domesticSettled, ...globalSettled] = await Promise.allSettled([
      fetchDomesticCarbon(),
      ...GLOBAL_ETFS.map((e) => fetchYahooEtf(e.symbol, e.name)),
    ]);

    const domestic =
      domesticSettled.status === "fulfilled" ? domesticSettled.value : null;
    const global: CarbonSeries[] = [];
    const errors: string[] = [];

    if (domesticSettled.status === "rejected") {
      errors.push(
        `국내: ${
          domesticSettled.reason instanceof Error
            ? domesticSettled.reason.message
            : String(domesticSettled.reason)
        }`
      );
    }
    for (let i = 0; i < globalSettled.length; i++) {
      const s = globalSettled[i];
      if (s.status === "fulfilled") global.push(s.value);
      else {
        errors.push(
          `${GLOBAL_ETFS[i].symbol}: ${
            s.reason instanceof Error ? s.reason.message : String(s.reason)
          }`
        );
      }
    }

    if (!domestic && !global.length) {
      return NextResponse.json(
        {
          ok: false,
          generated_at,
          error: errors.join(" · ") || "탄소배출권 데이터 로드 실패",
        } satisfies EsgCarbonPayload,
        { status: 502 }
      );
    }

    const payload: EsgCarbonPayload = {
      ok: true,
      generated_at,
      domestic,
      global,
      note:
        "국내는 KRX 배출권(KAU) 일별 종가·거래량, 해외는 탄소배출권 ETF(KRBN·KEUA)로 대체합니다." +
        (errors.length ? ` 일부 실패: ${errors.join(" · ")}` : ""),
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        generated_at,
        error: exc instanceof Error ? exc.message : "탄소배출권 로드 실패",
      } satisfies EsgCarbonPayload,
      { status: 500 }
    );
  }
}
