/**
 * Listing-venue ETF market structure for five regions:
 * United States, China (SSE+SZSE), Japan (TSE), Korea (KRX), Europe.
 *
 * Distinct from `countryEtf.ts`, which tracks US-listed country/broad ETF holdings.
 *
 * Korea is live (Naver listed ETFs + KRX cap + USD/KRW). Other regions start from
 * official year-end 2025 industry statistics, then nowcast equity AUM with local
 * equity indices and convert with live FX so figures stay comparable in USD.
 */

import {
  classifyIndexStyle,
  classifyNaverItem,
  isEquityEtf,
  type EtfDbRow,
} from "@/lib/etfDb";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

export type RegionId = "us" | "cn" | "jp" | "kr" | "eu";

export const REGION_IDS: RegionId[] = ["us", "cn", "jp", "kr", "eu"];

export type ExtraMetricUnit = "usd" | "pct" | "int" | "ratio";

export type ExtraMetric = {
  id: string;
  label: string;
  hint: string;
  unit: ExtraMetricUnit;
  values: Record<RegionId, number | null>;
};

export type RegionSpotlight = {
  title: string;
  body: string;
};

export type EtfMarketStructureRegion = {
  id: RegionId;
  name_ko: string;
  name_en: string;
  exchanges: string;
  color: string;
  etf_count: number | null;
  aum_usd: number | null;
  equity_etf_aum_usd: number | null;
  equity_mcap_usd: number | null;
  /** Total listed ETF AUM / equity market cap (%) */
  aum_to_mcap_pct: number | null;
  /** Equity ETF AUM / equity market cap (%) — primary penetration */
  equity_etf_to_mcap_pct: number | null;
  avg_aum_usd: number | null;
  equity_etf_share_pct: number | null;
  lev_inv_share_pct: number | null;
  active_etf_share_pct: number | null;
  issuer_count: number | null;
  top10_aum_share_pct: number | null;
  spotlight: RegionSpotlight[];
  as_of: string | null;
  live: boolean;
  source: string;
};

export type EtfMarketStructureFx = {
  usdkrw: number | null;
  usdjpy: number | null;
  usdcny: number | null;
  eurusd: number | null;
};

export type EtfMarketStructurePayload = {
  ok: boolean;
  generated_at: string;
  fx: EtfMarketStructureFx;
  regions: EtfMarketStructureRegion[];
  extras: ExtraMetric[];
  methodology: string[];
  error?: string;
};

type RegionMeta = {
  id: RegionId;
  name_ko: string;
  name_en: string;
  exchanges: string;
  color: string;
  yahoo: string;
};

const REGION_META: Record<RegionId, RegionMeta> = {
  us: {
    id: "us",
    name_ko: "미국",
    name_en: "United States",
    exchanges: "NYSE Arca · Nasdaq",
    color: "#60a5fa",
    yahoo: "^GSPC",
  },
  cn: {
    id: "cn",
    name_ko: "중국",
    name_en: "China",
    exchanges: "상해 · 심천 (A주)",
    color: "#f87171",
    yahoo: "000300.SS",
  },
  jp: {
    id: "jp",
    name_ko: "일본",
    name_en: "Japan",
    exchanges: "도쿄증권거래소",
    color: "#fbbf24",
    yahoo: "^N225",
  },
  kr: {
    id: "kr",
    name_ko: "한국",
    name_en: "Korea",
    exchanges: "KRX (코스피·코스닥)",
    color: "#34d399",
    yahoo: "^KS11",
  },
  eu: {
    id: "eu",
    name_ko: "유럽",
    name_en: "Europe",
    exchanges: "LSE · Xetra · Euronext 등 UCITS",
    color: "#a78bfa",
    yahoo: "^STOXX",
  },
};

/**
 * Official YE2025 listing-venue statistics.
 * AUM for CN/JP stored in local currency; US/EU in USD.
 */
const YE2025 = {
  as_of: "2025-12-31",
  us: {
    etf_count: 4813,
    aum_usd: 13.373e12,
    equity_share: 0.763,
    active_share: 0.11,
    issuer_count: 460,
    top10_share: 0.3084,
    lev_inv_share: 0.015,
    new_listings_2025: 1167,
    source: "ICI 2026 Fact Book · Lipper YE2025 · ETFGI",
  },
  cn: {
    etf_count: 1381,
    aum_cny: 6.02e12,
    equity_share: 0.636,
    bond_share: 0.138,
    cross_border_share: 0.156,
    issuer_count: null as number | null,
    top10_share: null as number | null,
    lev_inv_share: 0.02,
    active_share: null as number | null,
    source: "상해·심천거래소 ETF 산업보고 (2026)",
  },
  jp: {
    etf_count: 391,
    aum_jpy: 109.8969e12,
    equity_share: 0.9,
    issuer_count: 16,
    top10_share: null as number | null,
    lev_inv_share: 0.03,
    active_share: null as number | null,
    boj_book_jpy: 37.186e12,
    source: "투신협회 2025.12 · 일본은행 계정 · JPX",
  },
  eu: {
    etf_count: 3543,
    listings: 14721,
    aum_usd: 3.22e12,
    equity_share: 0.764,
    active_share: 0.0321,
    issuer_count: 142,
    top10_share: null as number | null,
    lev_inv_share: 0.01,
    source: "ETFGI YE2025 · Lipper Europe YE2025",
  },
} as const;

/** Wikipedia 2026 domestic listed-equity market cap fallbacks (USD). */
const WIKI_MCAP_USD: Record<RegionId, number> = {
  us: 79.47e12,
  cn: 17.75e12,
  jp: 8.7e12,
  kr: 4.99e12,
  eu: 22.0e12,
};

const WIKI_EUROPE_NAMES = new Set([
  "united kingdom",
  "france",
  "germany",
  "netherlands",
  "switzerland",
  "sweden",
  "spain",
  "italy",
  "belgium",
  "denmark",
  "norway",
  "finland",
  "ireland",
  "republic of ireland",
  "poland",
  "austria",
  "greece",
  "portugal",
  "romania",
  "hungary",
  "luxembourg",
  "czech republic",
  "czechia",
  "cyprus",
  "croatia",
  "iceland",
  "lithuania",
  "estonia",
  "malta",
  "slovenia",
  "slovakia",
  "latvia",
  "bulgaria",
]);

const FX_FALLBACK = {
  usdkrw: 1380,
  usdjpy: 148,
  usdcny: 7.15,
  eurusd: 1.17,
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v == null) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function ratio(a: number | null, b: number | null): number | null {
  if (a == null || b == null || !(b > 0) || !Number.isFinite(a)) return null;
  return (100 * a) / b;
}

async function fetchText(url: string, extra?: HeadersInit): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*", ...(extra || {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(18_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function fetchJson<T>(url: string, extra?: HeadersInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      ...(extra || {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(18_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return (await res.json()) as T;
}

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      meta?: { regularMarketPrice?: number; chartPreviousClose?: number };
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

async function yahooDailyCloses(
  symbol: string,
): Promise<Array<{ ymd: string; close: number }>> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=1y&interval=1d&includePrePost=false`;
  const json = await fetchJson<YahooChart>(url);
  const result = json.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const out: Array<{ ymd: string; close: number }> = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !(c > 0)) continue;
    const d = new Date((ts[i] || 0) * 1000);
    const ymd = d.toISOString().slice(0, 10);
    out.push({ ymd, close: c });
  }
  const last = result?.meta?.regularMarketPrice;
  if (last && last > 0) {
    const today = new Date().toISOString().slice(0, 10);
    if (!out.length || out[out.length - 1].ymd !== today) {
      out.push({ ymd: today, close: last });
    } else {
      out[out.length - 1].close = last;
    }
  }
  return out;
}

function closeOnOrBefore(
  series: Array<{ ymd: string; close: number }>,
  ymd: string,
): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].ymd <= ymd) return series[i].close;
  }
  return series[0]?.close ?? null;
}

type IndexScale = { ye: number | null; last: number | null; scale: number };

async function fetchIndexScales(): Promise<Record<RegionId, IndexScale>> {
  const empty = (): IndexScale => ({ ye: null, last: null, scale: 1 });
  const out = {
    us: empty(),
    cn: empty(),
    jp: empty(),
    kr: empty(),
    eu: empty(),
  };
  await Promise.all(
    REGION_IDS.map(async (id) => {
      try {
        const series = await yahooDailyCloses(REGION_META[id].yahoo);
        if (!series.length) return;
        const ye = closeOnOrBefore(series, YE2025.as_of);
        const last = series[series.length - 1]?.close ?? null;
        out[id] = {
          ye,
          last,
          scale: ye && last && ye > 0 ? last / ye : 1,
        };
      } catch {
        /* keep scale=1 */
      }
    }),
  );
  return out;
}

async function fetchFx(): Promise<EtfMarketStructureFx> {
  const fx: EtfMarketStructureFx = {
    usdkrw: null,
    usdjpy: null,
    usdcny: null,
    eurusd: null,
  };
  const specs: Array<[keyof EtfMarketStructureFx, string, boolean]> = [
    ["usdkrw", "KRW=X", false],
    ["usdjpy", "JPY=X", false],
    ["usdcny", "CNY=X", false],
    ["eurusd", "EURUSD=X", true],
  ];
  await Promise.all(
    specs.map(async ([key, symbol]) => {
      try {
        const series = await yahooDailyCloses(symbol);
        const last = series[series.length - 1]?.close;
        if (last && last > 0) fx[key] = last;
      } catch {
        /* fallback later */
      }
    }),
  );
  return {
    usdkrw: fx.usdkrw ?? FX_FALLBACK.usdkrw,
    usdjpy: fx.usdjpy ?? FX_FALLBACK.usdjpy,
    usdcny: fx.usdcny ?? FX_FALLBACK.usdcny,
    eurusd: fx.eurusd ?? FX_FALLBACK.eurusd,
  };
}

type WikiMcaps = Partial<Record<RegionId, number>>;

async function fetchWorldBankMcaps(): Promise<
  Partial<Record<RegionId, { usd: number; year: string }>>
> {
  const url =
    "https://api.worldbank.org/v2/country/USA;CHN;JPN;KOR/indicator/CM.MKT.LCAP.CD" +
    "?format=json&mrv=2&per_page=20";
  const json = await fetchJson<
    [
      unknown,
      Array<{
        countryiso3code?: string;
        date?: string;
        value?: number | null;
      }>,
    ]
  >(url);
  const rows = Array.isArray(json?.[1]) ? json[1] : [];
  const map: Record<string, RegionId> = {
    USA: "us",
    CHN: "cn",
    JPN: "jp",
    KOR: "kr",
  };
  const best: Partial<Record<RegionId, { usd: number; year: string }>> = {};
  for (const row of rows) {
    const id = map[row.countryiso3code || ""];
    if (!id || row.value == null || !(row.value > 0)) continue;
    const prev = best[id];
    if (!prev || String(row.date) > prev.year) {
      best[id] = { usd: row.value, year: String(row.date || "") };
    }
  }
  return best;
}

async function fetchWikipediaMcaps(): Promise<WikiMcaps> {
  const url =
    "https://en.wikipedia.org/w/api.php?action=parse&page=" +
    encodeURIComponent("List_of_countries_by_stock_market_capitalization") +
    "&prop=text&format=json&formatversion=2";
  const json = await fetchJson<{ parse?: { text?: string } }>(url);
  const html = json.parse?.text || "";
  if (!html) return {};

  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const byName = new Map<string, number>();
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (cells.length < 2) continue;
    const name = cells[0].replace(/\[.*?\]/g, "").trim().toLowerCase();
    const capMn = num(cells[1].replace(/[^\d.,-]/g, ""));
    if (!name || capMn == null || capMn < 100) continue;
    byName.set(name, capMn * 1e6);
  }

  const pick = (names: string[]): number | null => {
    for (const n of names) {
      const v = byName.get(n);
      if (v && v > 0) return v;
    }
    return null;
  };

  let europe = 0;
  for (const [name, cap] of byName) {
    if (WIKI_EUROPE_NAMES.has(name)) europe += cap;
  }

  return {
    us: pick(["united states", "usa", "united states of america"]) ?? undefined,
    cn: pick(["china"]) ?? undefined,
    jp: pick(["japan"]) ?? undefined,
    kr: pick(["south korea", "korea"]) ?? undefined,
    eu: europe > 1e12 ? europe : undefined,
  };
}

async function fetchKoreaEtfs(): Promise<EtfDbRow[]> {
  const res = await fetch("https://finance.naver.com/api/sise/etfItemList.nhn", {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,text/plain,*/*",
      Referer: "https://finance.naver.com/sise/etf.naver",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(18_000),
  });
  if (!res.ok) throw new Error(`Naver ETF list HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("euc-kr").decode(buf);
  } catch {
    text = buf.toString("utf8");
  }
  const data = JSON.parse(text) as {
    result?: { etfItemList?: unknown[] };
  };
  const items = data?.result?.etfItemList;
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Naver ETF list empty");
  }
  return items.map((item) =>
    classifyNaverItem(item as Parameters<typeof classifyNaverItem>[0]),
  );
}

function parseEokToKrw(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "").trim();
  const eok = cleaned.match(/([\d.]+)\s*억/);
  if (eok) {
    const n = Number(eok[1]);
    return Number.isFinite(n) ? n * 1e8 : null;
  }
  const jo = cleaned.match(/([\d.]+)\s*조/);
  if (jo) {
    const n = Number(jo[1]);
    return Number.isFinite(n) ? n * 1e12 : null;
  }
  const n = Number(cleaned.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 1e12 ? n : null;
}

async function fetchKoreaIndexMcapKrw(code: "KOSPI" | "KOSDAQ"): Promise<number | null> {
  try {
    const json = await fetchJson<Record<string, unknown>>(
      `https://m.stock.naver.com/api/index/${code}/basic`,
      { Referer: "https://m.stock.naver.com/" },
    );
    const candidates = [
      json.marketValue,
      json.marketCap,
      json.totalMarketValue,
      json.marketValueKrw,
      json.listedMarketCap,
    ];
    for (const c of candidates) {
      if (typeof c === "number" && c > 1e12) return c;
      if (typeof c === "string") {
        const parsed = parseEokToKrw(c) ?? num(c.replace(/,/g, ""));
        if (parsed && parsed > 1e12) return parsed;
        if (parsed && parsed > 1e5 && parsed < 1e8) return parsed * 1e8;
      }
    }
    const infos = json.totalInfos as Array<{ code?: string; value?: unknown }> | undefined;
    for (const info of infos || []) {
      if (!/market|시가총액|mcap/i.test(String(info.code || ""))) continue;
      const parsed =
        typeof info.value === "number"
          ? info.value
          : parseEokToKrw(String(info.value ?? ""));
      if (parsed && parsed > 1e12) return parsed;
      if (parsed && parsed > 1e5 && parsed < 1e8) return parsed * 1e8;
    }
  } catch {
    /* HTML fallback */
  }

  try {
    const html = await fetchText(
      `https://finance.naver.com/sise/sise_index.naver?code=${code}`,
      { Referer: "https://finance.naver.com/sise/" },
    );
    const m =
      html.match(/시가총액[\s\S]{0,180}?([\d,.]+)\s*조/) ||
      html.match(/시가총액[\s\S]{0,180}?([\d,.]+)\s*억/);
    if (m) {
      const n = Number(m[1].replace(/,/g, ""));
      if (!Number.isFinite(n)) return null;
      return /조/.test(m[0]) ? n * 1e12 : n * 1e8;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function fetchKoreaEquityMcapKrw(): Promise<number | null> {
  const [kospi, kosdaq] = await Promise.all([
    fetchKoreaIndexMcapKrw("KOSPI"),
    fetchKoreaIndexMcapKrw("KOSDAQ"),
  ]);
  if (kospi && kosdaq) return kospi + kosdaq;
  return kospi || kosdaq || null;
}

async function fetchJpxListedCount(): Promise<number | null> {
  try {
    const html = await fetchText(
      "https://www.jpx.co.jp/english/equities/products/etfs/data/02.html",
    );
    const m = html.match(
      /Current Number of Listed ETFs[\s\S]{0,1200}?<td[^>]*>\s*(\d{2,4})\s*<\/td>\s*<\/tr>/i,
    );
    if (m) return num(m[1]);
    const totals = [...html.matchAll(/<td[^>]*>\s*(\d{3,4})\s*<\/td>\s*<\/tr>/gi)];
    const last = totals[totals.length - 1];
    return last ? num(last[1]) : null;
  } catch {
    return null;
  }
}

function nowcastNative(aum: number, equityShare: number, scale: number): {
  total: number;
  equity: number;
} {
  const eq = aum * equityShare * (scale > 0 ? scale : 1);
  const other = aum * (1 - equityShare);
  return { total: eq + other, equity: eq };
}

function krIssuer(name: string): string {
  const token = (name || "").trim().split(/\s+/)[0] || "기타";
  return token.replace(/[^A-Za-z가-힣0-9+]/g, "") || "기타";
}

function buildKoreaRegion(
  rows: EtfDbRow[],
  mcapKrw: number | null,
  usdkrw: number,
  wikiKr: number | undefined,
): EtfMarketStructureRegion {
  const { yahoo: _y, ...meta } = REGION_META.kr;
  const aumKrw = rows.reduce((s, r) => s + (r.aum_eok || 0) * 1e8, 0);
  const aumUsd = usdkrw > 0 ? aumKrw / usdkrw : null;
  const equityRows = rows.filter(isEquityEtf);
  const equityKrw = equityRows.reduce((s, r) => s + (r.aum_eok || 0) * 1e8, 0);
  const equityUsd = usdkrw > 0 ? equityKrw / usdkrw : null;
  const overseasKrw = rows
    .filter((r) => r.tab_code === 4 || (r.country && r.country !== "한국" && r.type === "해외 주식"))
    .reduce((s, r) => s + (r.aum_eok || 0) * 1e8, 0);
  const levInvKrw = rows
    .filter((r) => {
      const st = r.index_style || classifyIndexStyle(r.name, r.benchmark);
      return st === "레버리지" || st === "인버스";
    })
    .reduce((s, r) => s + (r.aum_eok || 0) * 1e8, 0);
  const sorted = [...rows].sort((a, b) => (b.aum_eok || 0) - (a.aum_eok || 0));
  const top10 = sorted.slice(0, 10).reduce((s, r) => s + (r.aum_eok || 0) * 1e8, 0);
  const issuers = new Map<string, number>();
  for (const r of rows) {
    const k = krIssuer(r.name);
    issuers.set(k, (issuers.get(k) || 0) + (r.aum_eok || 0));
  }
  const issuerRank = [...issuers.entries()].sort((a, b) => b[1] - a[1]);
  const totalEok = rows.reduce((s, r) => s + (r.aum_eok || 0), 0);
  const top2Eok = (issuerRank[0]?.[1] || 0) + (issuerRank[1]?.[1] || 0);
  const top2Share = totalEok > 0 ? (100 * top2Eok) / totalEok : null;
  const top2Names = issuerRank
    .slice(0, 2)
    .map((x) => x[0])
    .join("·");

  const mcapUsd =
    mcapKrw && usdkrw > 0 ? mcapKrw / usdkrw : wikiKr && wikiKr > 0 ? wikiKr : null;

  const overseasShare = aumKrw > 0 ? (100 * overseasKrw) / aumKrw : null;

  return {
    ...meta,
    etf_count: rows.length,
    aum_usd: aumUsd,
    equity_etf_aum_usd: equityUsd,
    equity_mcap_usd: mcapUsd,
    aum_to_mcap_pct: ratio(aumUsd, mcapUsd),
    equity_etf_to_mcap_pct: ratio(equityUsd, mcapUsd),
    avg_aum_usd: aumUsd && rows.length ? aumUsd / rows.length : null,
    equity_etf_share_pct: aumKrw > 0 ? (100 * equityKrw) / aumKrw : null,
    lev_inv_share_pct: aumKrw > 0 ? (100 * levInvKrw) / aumKrw : null,
    active_etf_share_pct: null,
    issuer_count: issuers.size,
    top10_aum_share_pct: aumKrw > 0 ? (100 * top10) / aumKrw : null,
    spotlight: [
      {
        title: "해외주식 ETF 편중",
        body:
          overseasShare != null
            ? `상장 ETF AUM의 ${overseasShare.toFixed(1)}%가 해외주식형. 국내 시총 대비 침투율과 별개로, 개인 자금이 미국·글로벌로 빠져나가는 구조.`
            : "해외주식형 ETF 비중이 국내 상장 시장의 핵심 구조 변수.",
      },
      {
        title: "운용사 집중",
        body:
          top2Share != null
            ? `상위 브랜드 ${top2Names} 합산 AUM 비중이 높음. 상품 수는 늘어도 자산은 소수 운용사에 몰리는지 같이 봐야 함.`
            : "KODEX·TIGER 등 대형 브랜드 점유를 모니터링.",
      },
    ],
    as_of: new Date().toISOString().slice(0, 10),
    live: true,
    source: mcapKrw
      ? "Naver ETF 전종목 · KRX 시총 · Yahoo USD/KRW"
      : "Naver ETF 전종목 · World Bank 시총(지수 나우캐스트) · Yahoo USD/KRW",
  };
}

export async function collectEtfMarketStructure(): Promise<EtfMarketStructurePayload> {
  const generated_at = new Date().toISOString();
  const notes: string[] = [
    "한국은 거래소 상장 ETF 전종목을 실시간 집계. 미국·중국·일본·유럽은 2025년 말 공식 통계를 현지 주가지수로 주식형 AUM만 나우캐스트하고 환율은 실시간 적용.",
    "유가증권 시총은 World Bank CM.MKT.LCAP.CD 최신연을 현지 주가지수로 나우캐스트. 유럽은 국가 합산 공백이 있어 2026 시총 스냅샷을 사용.",
    "침투율의 본지표는 주식 ETF AUM ÷ 유가증권 시가총액. 전체 ETF AUM(채권·상품 포함) 대비 시총 비율은 규모 감 비교용.",
    "유럽은 상품 수(primary)와 교차상장 수를 구분. 상장 건수로 세면 실제 펀드 수보다 크게 잡힘.",
  ];

  try {
    const [fx, scales, wiki, worldBank, krRows, krMcap, jpxCount] = await Promise.all([
      fetchFx(),
      fetchIndexScales(),
      fetchWikipediaMcaps().catch(() => ({} as WikiMcaps)),
      fetchWorldBankMcaps().catch(
        () => ({}) as Partial<Record<RegionId, { usd: number; year: string }>>,
      ),
      fetchKoreaEtfs().catch(() => [] as EtfDbRow[]),
      fetchKoreaEquityMcapKrw().catch(() => null),
      fetchJpxListedCount(),
    ]);

    const mcapOf = (id: RegionId): number | null => {
      const wb = worldBank[id];
      if (wb && wb.usd > 0) return wb.usd * (scales[id].scale || 1);
      if (wiki[id] && wiki[id]! > 0) return wiki[id]!;
      return WIKI_MCAP_USD[id];
    };

    const usNow = nowcastNative(
      YE2025.us.aum_usd,
      YE2025.us.equity_share,
      scales.us.scale,
    );
    const cnNow = nowcastNative(
      YE2025.cn.aum_cny,
      YE2025.cn.equity_share,
      scales.cn.scale,
    );
    const jpNow = nowcastNative(
      YE2025.jp.aum_jpy,
      YE2025.jp.equity_share,
      scales.jp.scale,
    );
    const euNow = nowcastNative(
      YE2025.eu.aum_usd,
      YE2025.eu.equity_share,
      scales.eu.scale,
    );

    const usdcny = fx.usdcny || FX_FALLBACK.usdcny;
    const usdjpy = fx.usdjpy || FX_FALLBACK.usdjpy;
    const usdkrw = fx.usdkrw || FX_FALLBACK.usdkrw;

    const pub = (id: RegionId) => {
      const { yahoo: _y, ...rest } = REGION_META[id];
      return rest;
    };

    const us: EtfMarketStructureRegion = {
      ...pub("us"),
      etf_count: YE2025.us.etf_count,
      aum_usd: usNow.total,
      equity_etf_aum_usd: usNow.equity,
      equity_mcap_usd: mcapOf("us"),
      aum_to_mcap_pct: ratio(usNow.total, mcapOf("us")),
      equity_etf_to_mcap_pct: ratio(usNow.equity, mcapOf("us")),
      avg_aum_usd: usNow.total / YE2025.us.etf_count,
      equity_etf_share_pct: 100 * (usNow.equity / usNow.total),
      lev_inv_share_pct: 100 * YE2025.us.lev_inv_share,
      active_etf_share_pct: 100 * YE2025.us.active_share,
      issuer_count: YE2025.us.issuer_count,
      top10_aum_share_pct: 100 * YE2025.us.top10_share,
      spotlight: [
        {
          title: "액티브 ETF 전환",
          body: `액티브가 AUM의 약 ${(100 * YE2025.us.active_share).toFixed(0)}%. 2025년 신규 상장 ${YE2025.us.new_listings_2025.toLocaleString("en-US")}종 대부분이 액티브 — 상품 수 급증 vs 자산은 여전히 대형 패시브에 집중.`,
        },
        {
          title: "상위 10종 집중",
          body: `CR10 ${(100 * YE2025.us.top10_share).toFixed(1)}%. 종목 수 4,800+여도 시총·유동성은 SPY·VOO·IVV·QQQ 등 소수에 몰림.`,
        },
      ],
      as_of: YE2025.as_of,
      live: false,
      source: YE2025.us.source,
    };

    const cnAumUsd = cnNow.total / usdcny;
    const cnEqUsd = cnNow.equity / usdcny;
    const cn: EtfMarketStructureRegion = {
      ...pub("cn"),
      etf_count: YE2025.cn.etf_count,
      aum_usd: cnAumUsd,
      equity_etf_aum_usd: cnEqUsd,
      equity_mcap_usd: mcapOf("cn"),
      aum_to_mcap_pct: ratio(cnAumUsd, mcapOf("cn")),
      equity_etf_to_mcap_pct: ratio(cnEqUsd, mcapOf("cn")),
      avg_aum_usd: cnAumUsd / YE2025.cn.etf_count,
      equity_etf_share_pct: 100 * (cnNow.equity / cnNow.total),
      lev_inv_share_pct: 100 * YE2025.cn.lev_inv_share,
      active_etf_share_pct: YE2025.cn.active_share != null
        ? 100 * YE2025.cn.active_share
        : null,
      issuer_count: YE2025.cn.issuer_count,
      top10_aum_share_pct: YE2025.cn.top10_share != null
        ? 100 * YE2025.cn.top10_share
        : null,
      spotlight: [
        {
          title: "아시아 1위 도약",
          body: `2025년 말 본토 ETF 6.02조 위안·1,381종. 주식형은 ${(100 * YE2025.cn.equity_share).toFixed(1)}%, 채권 ETF ${(100 * YE2025.cn.bond_share).toFixed(1)}%로 금리형 성장이 동시에 열림.`,
        },
        {
          title: "시총 대비 침투는 아직 낮음",
          body: "A주 시총 대비 주식 ETF 비중은 미국·유럽보다 낮아, 정책(중장기 자금 입시)과 함께 구조적 확장 여지가 큰 시장.",
        },
      ],
      as_of: YE2025.as_of,
      live: false,
      source: YE2025.cn.source,
    };

    const jpAumUsd = jpNow.total / usdjpy;
    const jpEqUsd = jpNow.equity / usdjpy;
    const bojShare = (100 * YE2025.jp.boj_book_jpy) / jpNow.total;
    const jp: EtfMarketStructureRegion = {
      ...pub("jp"),
      etf_count: jpxCount || YE2025.jp.etf_count,
      aum_usd: jpAumUsd,
      equity_etf_aum_usd: jpEqUsd,
      equity_mcap_usd: mcapOf("jp"),
      aum_to_mcap_pct: ratio(jpAumUsd, mcapOf("jp")),
      equity_etf_to_mcap_pct: ratio(jpEqUsd, mcapOf("jp")),
      avg_aum_usd: jpAumUsd / (jpxCount || YE2025.jp.etf_count),
      equity_etf_share_pct: 100 * (jpNow.equity / jpNow.total),
      lev_inv_share_pct: 100 * YE2025.jp.lev_inv_share,
      active_etf_share_pct: null,
      issuer_count: YE2025.jp.issuer_count,
      top10_aum_share_pct: null,
      spotlight: [
        {
          title: "일본은행 보유",
          body: `BOJ 장부가 약 ${(YE2025.jp.boj_book_jpy / 1e12).toFixed(1)}조 엔으로 상장 ETF AUM의 약 ${bojShare.toFixed(0)}%(장부가 기준). 시가는 장부가보다 커, 매각 일정은 수급·괴리의 핵심 모니터 항목.`,
        },
        {
          title: "소수 상품·높은 평균 AUM",
          body: "종목 수는 한국보다 적고 1종당 AUM은 큼. TOPIX·닛케이 광역 상품에 자산이 몰린 과점 구조.",
        },
      ],
      as_of: jpxCount ? new Date().toISOString().slice(0, 10) : YE2025.as_of,
      live: Boolean(jpxCount),
      source: YE2025.jp.source + (jpxCount ? " · JPX 상장 수" : ""),
    };

    const kr =
      krRows.length > 0
        ? buildKoreaRegion(krRows, krMcap, usdkrw, mcapOf("kr") ?? undefined)
        : {
            ...pub("kr"),
            etf_count: null,
            aum_usd: null,
            equity_etf_aum_usd: null,
            equity_mcap_usd: mcapOf("kr"),
            aum_to_mcap_pct: null,
            equity_etf_to_mcap_pct: null,
            avg_aum_usd: null,
            equity_etf_share_pct: null,
            lev_inv_share_pct: null,
            active_etf_share_pct: null,
            issuer_count: null,
            top10_aum_share_pct: null,
            spotlight: [
              {
                title: "실시간 집계 대기",
                body: "네이버 상장 ETF 리스트를 가져오지 못했습니다. 새로고침 후 다시 시도하세요.",
              },
            ],
            as_of: null,
            live: false,
            source: "Naver ETF list unavailable",
          };

    const listingMultiple = YE2025.eu.listings / YE2025.eu.etf_count;
    const eu: EtfMarketStructureRegion = {
      ...pub("eu"),
      etf_count: YE2025.eu.etf_count,
      aum_usd: euNow.total,
      equity_etf_aum_usd: euNow.equity,
      equity_mcap_usd: mcapOf("eu"),
      aum_to_mcap_pct: ratio(euNow.total, mcapOf("eu")),
      equity_etf_to_mcap_pct: ratio(euNow.equity, mcapOf("eu")),
      avg_aum_usd: euNow.total / YE2025.eu.etf_count,
      equity_etf_share_pct: 100 * (euNow.equity / euNow.total),
      lev_inv_share_pct: 100 * YE2025.eu.lev_inv_share,
      active_etf_share_pct: 100 * YE2025.eu.active_share,
      issuer_count: YE2025.eu.issuer_count,
      top10_aum_share_pct: null,
      spotlight: [
        {
          title: "교차상장 배수",
          body: `상품 ${YE2025.eu.etf_count.toLocaleString("en-US")}종 vs 상장 ${YE2025.eu.listings.toLocaleString("en-US")}건 (약 ${listingMultiple.toFixed(1)}배). 동일 UCITS가 LSE·Xetra·Euronext에 중복 상장되는 구조라 상장 건수와 펀드 수를 혼동하면 안 됨.`,
        },
        {
          title: "액티브는 아직 주변",
          body: `액티브 AUM 비중 약 ${(100 * YE2025.eu.active_share).toFixed(1)}%로 미국(11%) 대비 낮음. 패시브 광역·국채 UCITS가 핵심.`,
        },
      ],
      as_of: YE2025.as_of,
      live: false,
      source: YE2025.eu.source,
    };

    const regions: EtfMarketStructureRegion[] = [us, cn, jp, kr, eu];

    const val = (
      pick: (r: EtfMarketStructureRegion) => number | null,
    ): Record<RegionId, number | null> => {
      const o = {} as Record<RegionId, number | null>;
      for (const r of regions) o[r.id] = pick(r);
      return o;
    };

    const extras: ExtraMetric[] = [
      {
        id: "avg_aum",
        label: "ETF당 평균 AUM",
        hint: "상품 수 대비 자산. 낮을수록 소형·테마 난립, 높을수록 광역 과점.",
        unit: "usd",
        values: val((r) => r.avg_aum_usd),
      },
      {
        id: "equity_share",
        label: "주식형 AUM 비중",
        hint: "상장 ETF 전체 중 주식형 비중 (나머지 채권·상품·기타).",
        unit: "pct",
        values: val((r) => r.equity_etf_share_pct),
      },
      {
        id: "lev_inv",
        label: "레버리지·인버스 AUM 비중",
        hint: "파생형 상품이 시장 규모에서 차지하는 몫. 한국 개인 매매 구조의 핵심 모니터.",
        unit: "pct",
        values: val((r) => r.lev_inv_share_pct),
      },
      {
        id: "active",
        label: "액티브 ETF AUM 비중",
        hint: "패시브에서 액티브로의 구조 전환 속도. 미국이 앞서고 유럽은 초기.",
        unit: "pct",
        values: val((r) => r.active_etf_share_pct),
      },
      {
        id: "issuers",
        label: "운용사 수",
        hint: "발행시장 참가자 수. 미국은 많고 일본은 소수.",
        unit: "int",
        values: val((r) => r.issuer_count),
      },
      {
        id: "top10",
        label: "상위 10종 AUM 집중도",
        hint: "대형 ETF로 자산이 몰리는 정도 (CR10).",
        unit: "pct",
        values: val((r) => r.top10_aum_share_pct),
      },
      {
        id: "listing_mult",
        label: "교차상장 배수",
        hint: "상장 건수 ÷ 상품 수. 유럽 UCITS 특유의 중복 상장.",
        unit: "ratio",
        values: {
          us: 1,
          cn: 1,
          jp: 1,
          kr: 1,
          eu: listingMultiple,
        },
      },
    ];

    return {
      ok: regions.some((r) => r.aum_usd != null),
      generated_at,
      fx,
      regions,
      extras,
      methodology: notes,
    };
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return {
      ok: false,
      generated_at,
      fx: FX_FALLBACK,
      regions: [],
      extras: [],
      methodology: notes,
      error: message,
    };
  }
}
