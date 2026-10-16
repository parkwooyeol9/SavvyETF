import { NextResponse } from "next/server";

import { timingSafeEqual } from "crypto";

import { cdnCacheHeader } from "@/lib/apiCache";
import {
  buildCarbonSpreadComment,
  type CarbonBar,
  type CarbonSeries,
  type CarbonSpread,
  type EsgCarbonPayload,
} from "@/lib/esgCarbon";
import { r2Configured, r2GetObjectText, r2PutJsonDaily } from "@/lib/r2";
import { siteAdminAuthorized } from "@/lib/siteAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** KRX ETS rejects the SavvyETF bot UA with HTTP 403. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ETS_ORIGIN = "https://ets.krx.co.kr";
const ETS_PAGE = "/contents/ETS/03/03010000/ETS03010000.jsp";
const ETS_OTP = `${ETS_ORIGIN}/contents/COM/GenerateOTP.jspx`;
const ETS_DATA = `${ETS_ORIGIN}/contents/ETS/99/ETS99000001.jspx`;
/** Front-month fallback when item search fails (update yearly). */
const FALLBACK_KAU = { isu_cd: "KRD050042609", isu_abbrv: "KAU26" };
const R2_DOMESTIC_KEY = "esg_carbon/latest.json";

type DomesticCachePayload = {
  ok?: boolean;
  generated_at?: string;
  domestic?: CarbonSeries | null;
  note?: string;
};

const SENDECO2_CSV = "https://www.sendeco2.com/site_sendeco/service/download-csv.php";

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

  if (!bars.length) {
    throw new Error(`KRX ETS empty history for ${isu.isu_abbrv}`);
  }

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

function isCarbonSeries(value: unknown): value is CarbonSeries {
  if (!value || typeof value !== "object") return false;
  const s = value as CarbonSeries;
  return (
    typeof s.symbol === "string" &&
    typeof s.name === "string" &&
    Array.isArray(s.daily) &&
    s.daily.length > 0 &&
    s.quote != null &&
    typeof s.quote === "object"
  );
}

/** Bot/local scrape mirror — KRX blocks most cloud IPs (incl. Vercel). */
async function loadDomesticFromR2(): Promise<{
  series: CarbonSeries | null;
  generatedAt: string | null;
}> {
  if (!r2Configured()) return { series: null, generatedAt: null };
  try {
    const text = await r2GetObjectText(R2_DOMESTIC_KEY);
    if (!text) return { series: null, generatedAt: null };
    const parsed = JSON.parse(text) as DomesticCachePayload;
    if (!isCarbonSeries(parsed.domestic)) {
      return { series: null, generatedAt: parsed.generated_at || null };
    }
    return {
      series: {
        ...parsed.domestic,
        source: `${parsed.domestic.source || "KRX ETS"} · R2 cache`,
      },
      generatedAt: parsed.generated_at || null,
    };
  } catch (exc) {
    console.warn("esg-carbon R2 cache read failed:", exc);
    return { series: null, generatedAt: null };
  }
}

function parseSendeco2Date(raw: string): string | null {
  // DD-MM-YYYY
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function fetchSendeco2Year(year: number): Promise<CarbonBar[]> {
  const res = await fetch(`${SENDECO2_CSV}?year=${year}`, {
    headers: {
      "User-Agent": UA,
      Accept: "text/csv,*/*",
      Referer: "https://www.sendeco2.com/es/precios-co2/",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Sendeco2 HTTP ${res.status} for ${year}`);
  const text = await res.text();
  if (/<!DOCTYPE|<html/i.test(text.slice(0, 80))) {
    throw new Error(`Sendeco2 returned HTML for ${year}`);
  }
  const bars: CarbonBar[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^fecha;/i.test(trimmed)) continue;
    const [dateRaw, euaRaw] = trimmed.split(";");
    const date = parseSendeco2Date(dateRaw || "");
    const close = parseNumber((euaRaw || "").replace(",", "."));
    if (!date || close == null || close <= 0) continue;
    bars.push({ date, close, volume: 0 });
  }
  return bars;
}

/** EU ETS allowance (EUA) spot from Sendeco2 daily CSV — not a carbon ETF. */
async function fetchEuropeanEua(): Promise<CarbonSeries> {
  const y = Number(kstYmdParts().y);
  const years = [y, y - 1];
  const settled = await Promise.allSettled(years.map((yr) => fetchSendeco2Year(yr)));
  const byDate = new Map<string, CarbonBar>();
  const errs: string[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      for (const b of s.value) byDate.set(b.date, b);
    } else {
      errs.push(
        `${years[i]}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
      );
    }
  }
  const bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!bars.length) {
    throw new Error(
      errs.length ? `EUA empty (${errs.join("; ")})` : "EUA empty from Sendeco2",
    );
  }

  const last = bars[bars.length - 1];
  const prev = bars.length >= 2 ? bars[bars.length - 2] : null;
  const change = prev ? last.close - prev.close : null;
  const changePct =
    prev && prev.close ? ((last.close - prev.close) / prev.close) * 100 : null;

  return {
    symbol: "EUA",
    name: "EU ETS 배출권 (EUA)",
    market: "EU",
    currency: "EUR",
    unit: "€/톤",
    quote: {
      last: last.close,
      change,
      change_pct: changePct,
      volume: null,
    },
    daily: bars,
    source: "Sendeco2 (EUA spot)",
  };
}

async function fetchEurKrwYahoo(): Promise<number> {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/EURKRW=X?interval=1d&range=5d&includePrePost=false";
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Yahoo EURKRW HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        meta?: { regularMarketPrice?: number };
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const result = json.chart?.result?.[0];
  const metaPx = result?.meta?.regularMarketPrice;
  if (metaPx != null && Number.isFinite(metaPx) && metaPx > 0) return metaPx;
  const closes = result?.indicators?.quote?.[0]?.close || [];
  for (let i = closes.length - 1; i >= 0; i--) {
    const c = closes[i];
    if (c != null && Number.isFinite(c) && c > 0) return c;
  }
  throw new Error("Yahoo EURKRW empty");
}

async function fetchEurKrwFallback(): Promise<number> {
  // Frankfurter (ECB reference) — follow redirects
  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?from=EUR&to=KRW",
      { headers: { Accept: "application/json" }, cache: "no-store", redirect: "follow" },
    );
    if (res.ok) {
      const json = (await res.json()) as { rates?: { KRW?: number } };
      const n = json.rates?.KRW;
      if (n != null && Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    /* try next */
  }
  // jsDelivr currency-api mirror
  const res = await fetch(
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json",
    { headers: { Accept: "application/json" }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`FX fallback HTTP ${res.status}`);
  const json = (await res.json()) as { eur?: { krw?: number } };
  const n = json.eur?.krw;
  if (n != null && Number.isFinite(n) && n > 0) return n;
  throw new Error("EURKRW fallback empty");
}

async function fetchEurKrw(): Promise<number> {
  try {
    return await fetchEurKrwYahoo();
  } catch {
    return fetchEurKrwFallback();
  }
}

function buildSpread(
  domestic: CarbonSeries | null,
  european: CarbonSeries | null,
  fxEurKrw: number | null,
): CarbonSpread {
  const kauKrw = domestic?.quote.last ?? null;
  const euaEur = european?.quote.last ?? null;
  const euaKrw =
    euaEur != null && fxEurKrw != null && fxEurKrw > 0 ? euaEur * fxEurKrw : null;
  const spreadKrw =
    kauKrw != null && euaKrw != null ? kauKrw - euaKrw : null;
  const spreadPct =
    kauKrw != null && euaKrw != null && euaKrw > 0
      ? ((kauKrw / euaKrw) - 1) * 100
      : null;
  const ratio =
    kauKrw != null && euaKrw != null && euaKrw > 0 ? kauKrw / euaKrw : null;

  let label: CarbonSpread["label"] = "n/a";
  if (spreadPct != null) {
    if (Math.abs(spreadPct) < 3) label = "flat";
    else if (spreadPct > 0) label = "premium";
    else label = "discount";
  }

  return {
    kau_krw: kauKrw,
    eua_eur: euaEur,
    eua_krw: euaKrw,
    fx_eurkrw: fxEurKrw,
    spread_krw: spreadKrw,
    spread_pct: spreadPct,
    kau_vs_eua_ratio: ratio,
    label,
    comment: buildCarbonSpreadComment({
      kauKrw,
      euaEur,
      euaKrw,
      spreadPct,
      label,
    }),
  };
}

function ingestAuthorized(request: Request): boolean {
  if (siteAdminAuthorized(request)) return true;
  const secret = process.env.WEB_INGEST_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

/** Bot/local scrape → R2 mirror (Vercel cannot reach ets.krx.co.kr). */
export async function POST(request: Request) {
  if (!ingestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!r2Configured()) {
    return NextResponse.json(
      { error: "R2 is not configured" },
      { status: 503 },
    );
  }
  try {
    const body = (await request.json()) as DomesticCachePayload & {
      domestic?: CarbonSeries | null;
    };
    const domestic = body.domestic;
    if (!isCarbonSeries(domestic)) {
      return NextResponse.json(
        { error: "body.domestic CarbonSeries required" },
        { status: 400 },
      );
    }
    const generated_at = body.generated_at || new Date().toISOString();
    const asOf =
      /^\d{4}-\d{2}-\d{2}$/.test(String((body as { as_of_kst?: string }).as_of_kst || ""))
        ? String((body as { as_of_kst?: string }).as_of_kst)
        : generated_at.slice(0, 10);
    const payload = {
      ok: true,
      generated_at,
      as_of_kst: asOf,
      domestic,
      note: body.note || "Ingested domestic KAU cache",
    };
    await r2PutJsonDaily(
      R2_DOMESTIC_KEY,
      JSON.stringify(payload),
      asOf,
    );
    return NextResponse.json({
      ok: true,
      key: R2_DOMESTIC_KEY,
      symbol: domestic.symbol,
      bars: domestic.daily.length,
      quote: domestic.quote,
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "ingest failed",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  const generated_at = new Date().toISOString();
  try {
    const [domesticSettled, r2Settled, euaSettled, fxSettled] =
      await Promise.allSettled([
        fetchDomesticCarbon(),
        loadDomesticFromR2(),
        fetchEuropeanEua(),
        fetchEurKrw(),
      ]);

    let domestic =
      domesticSettled.status === "fulfilled" ? domesticSettled.value : null;
    const r2Cache =
      r2Settled.status === "fulfilled"
        ? r2Settled.value
        : { series: null, generatedAt: null };
    const european =
      euaSettled.status === "fulfilled" ? euaSettled.value : null;
    const fxEurKrw =
      fxSettled.status === "fulfilled" ? fxSettled.value : null;
    const errors: string[] = [];

    if (domesticSettled.status === "rejected") {
      errors.push(
        `국내 live: ${
          domesticSettled.reason instanceof Error
            ? domesticSettled.reason.message
            : String(domesticSettled.reason)
        }`,
      );
    }
    if (!domestic && r2Cache.series) {
      domestic = r2Cache.series;
    } else if (!domestic) {
      errors.push(
        "국내: KRX 실시간·R2 캐시 모두 없음 (봇에서 `python 06_ESG/esg_carbon.py --upload` 실행 필요)",
      );
    }
    if (euaSettled.status === "rejected") {
      errors.push(
        `EUA: ${
          euaSettled.reason instanceof Error
            ? euaSettled.reason.message
            : String(euaSettled.reason)
        }`,
      );
    }
    if (fxSettled.status === "rejected") {
      errors.push(
        `EURKRW: ${
          fxSettled.reason instanceof Error
            ? fxSettled.reason.message
            : String(fxSettled.reason)
        }`,
      );
    }

    if (!domestic && !european) {
      return NextResponse.json(
        {
          ok: false,
          generated_at,
          error: errors.join(" · ") || "탄소배출권 데이터 로드 실패",
        } satisfies EsgCarbonPayload,
        { status: 502 },
      );
    }

    const usedR2 = Boolean(
      domestic &&
        domesticSettled.status !== "fulfilled" &&
        r2Cache.series,
    );
    const spread = buildSpread(domestic, european, fxEurKrw);
    const payload: EsgCarbonPayload = {
      ok: true,
      generated_at,
      domestic,
      european,
      global: european ? [european] : [],
      spread,
      note:
        "국내는 KRX KAU, 유럽은 EU ETS EUA(Sendeco2 spot). 스프레드는 EUR/KRW 환산 후 비교합니다." +
        (usedR2
          ? ` 국내는 R2 캐시${r2Cache.generatedAt ? ` (${r2Cache.generatedAt})` : ""}.`
          : "") +
        (errors.length ? ` 일부 실패: ${errors.join(" · ")}` : ""),
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        generated_at,
        error: exc instanceof Error ? exc.message : "탄소배출권 로드 실패",
      } satisfies EsgCarbonPayload,
      { status: 500 },
    );
  }
}
