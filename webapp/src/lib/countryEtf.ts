/**
 * US-listed country / broad-market equity ETFs — top holdings, GICS sectors,
 * geographic weights (broad), and DoD weight deltas via R2 snapshots.
 */

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";
const R2_PREFIX = "country_etf";
const TOP_N = 10;

export type CountryEtfKind = "country" | "broad";

export type CountryEtfMeta = {
  ticker: string;
  name: string;
  name_ko: string;
  region: string;
  kind: CountryEtfKind;
  /** iShares overview URL for geographic / sector HTML scrape */
  ishares_url?: string;
};

/** Curated US-listed country & broad equity ETFs. */
export const COUNTRY_ETF_UNIVERSE: CountryEtfMeta[] = [
  // —— Broad ——
  {
    ticker: "IEMG",
    name: "iShares Core MSCI Emerging Markets ETF",
    name_ko: "신흥국 코어",
    region: "신흥국",
    kind: "broad",
    ishares_url:
      "https://www.ishares.com/us/products/244050/ishares-core-msci-emerging-markets-etf",
  },
  {
    ticker: "EEM",
    name: "iShares MSCI Emerging Markets ETF",
    name_ko: "신흥국",
    region: "신흥국",
    kind: "broad",
    ishares_url:
      "https://www.ishares.com/us/products/239637/ishares-msci-emerging-markets-etf",
  },
  {
    ticker: "ACWI",
    name: "iShares MSCI ACWI ETF",
    name_ko: "전세계(ACWI)",
    region: "글로벌",
    kind: "broad",
    ishares_url: "https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf",
  },
  {
    ticker: "EFA",
    name: "iShares MSCI EAFE ETF",
    name_ko: "선진국(EAFE)",
    region: "선진국",
    kind: "broad",
    ishares_url: "https://www.ishares.com/us/products/239623/ishares-msci-eafe-etf",
  },
  {
    ticker: "IEFA",
    name: "iShares Core MSCI EAFE ETF",
    name_ko: "선진국 코어",
    region: "선진국",
    kind: "broad",
    ishares_url:
      "https://www.ishares.com/us/products/244049/ishares-core-msci-eafe-etf",
  },
  {
    ticker: "IXUS",
    name: "iShares Core MSCI Total International Stock ETF",
    name_ko: "미국 제외 전세계",
    region: "글로벌",
    kind: "broad",
    ishares_url:
      "https://www.ishares.com/us/products/244048/ishares-core-msci-total-international-stock-etf",
  },
  // —— Asia ——
  {
    ticker: "EWY",
    name: "iShares MSCI South Korea ETF",
    name_ko: "한국",
    region: "아시아",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239677/ishares-msci-south-korea-capped-etf",
  },
  {
    ticker: "EWT",
    name: "iShares MSCI Taiwan ETF",
    name_ko: "대만",
    region: "아시아",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239670/ishares-msci-taiwan-etf",
  },
  {
    ticker: "MCHI",
    name: "iShares MSCI China ETF",
    name_ko: "중국",
    region: "아시아",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239660/ishares-msci-china-etf",
  },
  {
    ticker: "FXI",
    name: "iShares China Large-Cap ETF",
    name_ko: "중국 대형",
    region: "아시아",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239536/ishares-china-largecap-etf",
  },
  {
    ticker: "INDA",
    name: "iShares MSCI India ETF",
    name_ko: "인도",
    region: "아시아",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239543/ishares-msci-india-etf",
  },
  {
    ticker: "EWJ",
    name: "iShares MSCI Japan ETF",
    name_ko: "일본",
    region: "아시아",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239665/ishares-msci-japan-etf",
  },
  {
    ticker: "EWH",
    name: "iShares MSCI Hong Kong ETF",
    name_ko: "홍콩",
    region: "아시아",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239657/ishares-msci-hong-kong-etf",
  },
  {
    ticker: "EWS",
    name: "iShares MSCI Singapore ETF",
    name_ko: "싱가포르",
    region: "아시아",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239668/ishares-msci-singapore-capped-etf",
  },
  {
    ticker: "THD",
    name: "iShares MSCI Thailand ETF",
    name_ko: "태국",
    region: "아시아",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239674/ishares-msci-thailand-capped-etf",
  },
  {
    ticker: "EWA",
    name: "iShares MSCI Australia ETF",
    name_ko: "호주",
    region: "아시아",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239605/ishares-msci-australia-etf",
  },
  // —— Americas / EMEA ——
  {
    ticker: "EWZ",
    name: "iShares MSCI Brazil ETF",
    name_ko: "브라질",
    region: "미주",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239628/ishares-msci-brazil-capped-etf",
  },
  {
    ticker: "EWW",
    name: "iShares MSCI Mexico ETF",
    name_ko: "멕시코",
    region: "미주",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239663/ishares-msci-mexico-capped-etf",
  },
  {
    ticker: "EWC",
    name: "iShares MSCI Canada ETF",
    name_ko: "캐나다",
    region: "미주",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239633/ishares-msci-canada-etf",
  },
  {
    ticker: "EWU",
    name: "iShares MSCI United Kingdom ETF",
    name_ko: "영국",
    region: "유럽",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239650/ishares-msci-united-kingdom-etf",
  },
  {
    ticker: "EWG",
    name: "iShares MSCI Germany ETF",
    name_ko: "독일",
    region: "유럽",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239651/ishares-msci-germany-etf",
  },
  {
    ticker: "EWQ",
    name: "iShares MSCI France ETF",
    name_ko: "프랑스",
    region: "유럽",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239648/ishares-msci-france-etf",
  },
  {
    ticker: "EWL",
    name: "iShares MSCI Switzerland ETF",
    name_ko: "스위스",
    region: "유럽",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239669/ishares-msci-switzerland-capped-etf",
  },
  {
    ticker: "EZA",
    name: "iShares MSCI South Africa ETF",
    name_ko: "남아공",
    region: "EMEA",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/239673/ishares-msci-south-africa-etf",
  },
  {
    ticker: "KSA",
    name: "iShares MSCI Saudi Arabia ETF",
    name_ko: "사우디",
    region: "EMEA",
    kind: "country",
    ishares_url:
      "https://www.ishares.com/us/products/271542/ishares-msci-saudi-arabia-capped-etf",
  },
];

const GICS_LABEL_KO: Record<string, string> = {
  technology: "정보기술",
  financial_services: "금융",
  financials: "금융",
  consumer_cyclical: "경기소비재",
  consumer_defensive: "필수소비재",
  communication_services: "커뮤니케이션",
  healthcare: "헬스케어",
  industrials: "산업재",
  energy: "에너지",
  basic_materials: "소재",
  utilities: "유틸리티",
  realestate: "부동산",
  real_estate: "부동산",
};

const COUNTRY_LABEL_KO: Record<string, string> = {
  "United States": "미국",
  Japan: "일본",
  China: "중국",
  Taiwan: "대만",
  India: "인도",
  "South Korea": "한국",
  "Korea (South)": "한국",
  "United Kingdom": "영국",
  Canada: "캐나다",
  France: "프랑스",
  Germany: "독일",
  Switzerland: "스위스",
  Australia: "호주",
  Netherlands: "네덜란드",
  Brazil: "브라질",
  "South Africa": "남아공",
  "Saudi Arabia": "사우디",
  Mexico: "멕시코",
  "Hong Kong": "홍콩",
  Singapore: "싱가포르",
  Thailand: "태국",
  Malaysia: "말레이시아",
  Indonesia: "인도네시아",
  Poland: "폴란드",
  Italy: "이탈리아",
  Spain: "스페인",
  Sweden: "스웨덴",
  Denmark: "덴마크",
  Belgium: "벨기에",
  "United Arab Emirates": "UAE",
  Other: "기타",
};

const COUNTRY_NAME_SET = new Set([
  ...Object.keys(COUNTRY_LABEL_KO),
  "Korea (South)",
  "South Korea",
  "Czech Republic",
  "Turkey",
  "Greece",
  "Austria",
  "Finland",
  "Norway",
  "Ireland",
  "Israel",
  "Qatar",
  "Kuwait",
  "Chile",
  "Colombia",
  "Peru",
  "Philippines",
  "Vietnam",
  "New Zealand",
  "Portugal",
]);

const GICS_NAME_SET = new Set([
  "Information Technology",
  "Financials",
  "Consumer Discretionary",
  "Consumer Staples",
  "Communication",
  "Communication Services",
  "Health Care",
  "Healthcare",
  "Industrials",
  "Energy",
  "Materials",
  "Utilities",
  "Real Estate",
]);

export type HoldingRow = {
  symbol: string;
  name: string;
  weight_pct: number;
  prev_weight_pct: number | null;
  delta_pp: number | null;
};

export type WeightRow = {
  key: string;
  label: string;
  weight_pct: number;
  prev_weight_pct?: number | null;
  delta_pp?: number | null;
};

export type CountryEtfFund = {
  ticker: string;
  name: string;
  name_ko: string;
  region: string;
  kind: CountryEtfKind;
  as_of: string | null;
  holdings: HoldingRow[];
  sectors: WeightRow[];
  countries: WeightRow[];
  source: string;
  error?: string;
};

export type CountryEtfPayload = {
  ok: boolean;
  generated_at: string;
  source: string;
  universe_count: number;
  funds: CountryEtfFund[];
  error?: string;
};

type YahooCookieJar = { cookie: string; crumb: string; expires: number };

let yahooJar: YahooCookieJar | null = null;

function metaByTicker(ticker: string): CountryEtfMeta | undefined {
  return COUNTRY_ETF_UNIVERSE.find((u) => u.ticker === ticker.toUpperCase());
}

function gicsLabel(key: string): string {
  const k = key.toLowerCase().replace(/\s+/g, "_");
  return GICS_LABEL_KO[k] || GICS_LABEL_KO[key.toLowerCase()] || key;
}

function countryLabel(name: string): string {
  return COUNTRY_LABEL_KO[name] || name;
}

function normalizeCountry(name: string): string {
  if (name === "Korea (South)") return "South Korea";
  return name;
}

async function getYahooCrumb(): Promise<YahooCookieJar> {
  const now = Date.now();
  if (yahooJar && yahooJar.expires > now) return yahooJar;

  const warm = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    redirect: "manual",
  });
  const headersAny = warm.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const rawCookies =
    typeof headersAny.getSetCookie === "function"
      ? headersAny.getSetCookie()
      : [];
  let cookie = rawCookies
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) {
    const sc = warm.headers.get("set-cookie") || "";
    cookie = sc
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(";")[0].trim())
      .filter((c) => c.includes("="))
      .join("; ");
  }

  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie, Accept: "text/plain" },
  });
  if (!crumbRes.ok) {
    throw new Error(`Yahoo crumb HTTP ${crumbRes.status}`);
  }
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 40 || crumb.includes("<")) {
    throw new Error("Yahoo crumb invalid");
  }
  yahooJar = { cookie, crumb, expires: now + 25 * 60_000 };
  return yahooJar;
}

type YahooTopHoldings = {
  holdings: Array<{ symbol: string; name: string; weight_pct: number }>;
  sectors: WeightRow[];
};

async function fetchYahooTopHoldings(ticker: string): Promise<YahooTopHoldings> {
  const jar = await getYahooCrumb();
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
    ticker,
  )}?modules=topHoldings&crumb=${encodeURIComponent(jar.crumb)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Cookie: jar.cookie,
      Accept: "application/json",
    },
    next: { revalidate: 0 },
  });
  if (res.status === 401) {
    yahooJar = null;
    throw new Error(`Yahoo Unauthorized for ${ticker}`);
  }
  if (!res.ok) throw new Error(`Yahoo ${ticker}: HTTP ${res.status}`);
  const payload = (await res.json()) as {
    quoteSummary?: {
      result?: Array<{
        topHoldings?: {
          holdings?: Array<{
            symbol?: string;
            holdingName?: string;
            holdingPercent?: { raw?: number };
          }>;
          sectorWeightings?: Array<Record<string, { raw?: number; fmt?: string }>>;
        };
      }>;
    };
  };
  const th = payload.quoteSummary?.result?.[0]?.topHoldings;
  if (!th) throw new Error(`Yahoo ${ticker}: no topHoldings`);

  const holdings = (th.holdings || [])
    .map((h) => ({
      symbol: (h.symbol || "").trim(),
      name: (h.holdingName || h.symbol || "").trim(),
      weight_pct: (h.holdingPercent?.raw || 0) * 100,
    }))
    .filter((h) => h.weight_pct > 0)
    .slice(0, TOP_N);

  const sectors: WeightRow[] = [];
  for (const row of th.sectorWeightings || []) {
    const key = Object.keys(row)[0];
    if (!key) continue;
    const raw = row[key]?.raw;
    if (raw == null || !(raw > 0)) continue;
    sectors.push({
      key,
      label: gicsLabel(key),
      weight_pct: raw * 100,
    });
  }
  sectors.sort((a, b) => b.weight_pct - a.weight_pct);
  return { holdings, sectors };
}

type IsharesBreakdown = {
  countries: WeightRow[];
  sectors: WeightRow[];
};

const WEIGHT_CELL_RE =
  /([A-Za-z][A-Za-z0-9 &\/\-\(\)\.]+)<\/td><td class="_ws-colFund[^"]*"[^>]*>([\d.]+)%/g;

async function fetchIsharesBreakdown(url: string): Promise<IsharesBreakdown> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`iShares HTTP ${res.status}`);
  const html = await res.text();
  const countries: WeightRow[] = [];
  const sectors: WeightRow[] = [];
  const seenC = new Set<string>();
  const seenS = new Set<string>();

  for (const m of html.matchAll(WEIGHT_CELL_RE)) {
    const rawName = (m[1] || "").trim();
    const weight = Number(m[2]);
    if (!(weight > 0) || weight > 95) continue;
    if (rawName.includes("Fixed Income") || rawName.includes("Equity (EQ)")) continue;
    if (rawName.includes("or Derivatives") || rawName.includes("Cash and")) continue;

    if (GICS_NAME_SET.has(rawName) || /^(Information Technology|Financials|Materials)$/.test(rawName)) {
      const key = rawName.toLowerCase().replace(/\s+/g, "_");
      if (seenS.has(key)) continue;
      seenS.add(key);
      sectors.push({
        key,
        label:
          {
            information_technology: "정보기술",
            financials: "금융",
            consumer_discretionary: "경기소비재",
            consumer_staples: "필수소비재",
            communication: "커뮤니케이션",
            communication_services: "커뮤니케이션",
            health_care: "헬스케어",
            healthcare: "헬스케어",
            industrials: "산업재",
            energy: "에너지",
            materials: "소재",
            utilities: "유틸리티",
            real_estate: "부동산",
          }[key] || rawName,
        weight_pct: weight,
      });
      continue;
    }

    const country = normalizeCountry(rawName);
    if (!COUNTRY_NAME_SET.has(rawName) && !COUNTRY_NAME_SET.has(country)) continue;
    if (seenC.has(country)) continue;
    seenC.add(country);
    countries.push({
      key: country,
      label: countryLabel(country),
      weight_pct: weight,
    });
  }

  countries.sort((a, b) => b.weight_pct - a.weight_pct);
  sectors.sort((a, b) => b.weight_pct - a.weight_pct);
  return { countries, sectors };
}

function compareHoldings(
  current: Array<{ symbol: string; name: string; weight_pct: number }>,
  previous: Array<{ symbol: string; weight_pct: number }> | null,
): HoldingRow[] {
  const prevMap = new Map((previous || []).map((p) => [p.symbol, p.weight_pct]));
  return current.map((h) => {
    const prev = prevMap.has(h.symbol) ? prevMap.get(h.symbol)! : null;
    return {
      symbol: h.symbol,
      name: h.name,
      weight_pct: h.weight_pct,
      prev_weight_pct: prev,
      delta_pp: prev != null ? h.weight_pct - prev : null,
    };
  });
}

type StoredSnap = {
  ticker: string;
  as_of: string;
  holdings: Array<{ symbol: string; name: string; weight_pct: number }>;
  sectors: WeightRow[];
  countries: WeightRow[];
};

async function loadPrevSnap(ticker: string): Promise<StoredSnap | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(`${R2_PREFIX}/${ticker}/latest.json`);
    if (!text) return null;
    return JSON.parse(text) as StoredSnap;
  } catch {
    return null;
  }
}

async function saveSnap(snap: StoredSnap): Promise<void> {
  if (!r2Configured()) return;
  try {
    await r2PutObject(
      `${R2_PREFIX}/${snap.ticker}/latest.json`,
      JSON.stringify(snap),
      "application/json",
    );
    await r2PutObject(
      `${R2_PREFIX}/${snap.ticker}/snapshots/${snap.as_of}.json`,
      JSON.stringify(snap),
      "application/json",
    );
  } catch {
    /* ignore persistence errors */
  }
}

export async function collectCountryEtfFund(meta: CountryEtfMeta): Promise<CountryEtfFund> {
  const as_of = new Date().toISOString().slice(0, 10);
  try {
    const yahoo = await fetchYahooTopHoldings(meta.ticker);
    let countries: WeightRow[] = [];
    let sectors = yahoo.sectors;
    let source = "Yahoo topHoldings + GICS";

    if (meta.ishares_url && meta.kind === "broad") {
      try {
        const br = await fetchIsharesBreakdown(meta.ishares_url);
        if (br.countries.length) {
          countries = br.countries.slice(0, 20);
          source += " · iShares 국가비중";
        }
        if (br.sectors.length >= 5 && (!sectors.length || sectors.length < 5)) {
          sectors = br.sectors;
        }
      } catch {
        /* country optional */
      }
    } else if (meta.kind === "country" && meta.ishares_url) {
      // Single-country funds: optional sector backup from iShares if Yahoo thin
      if (sectors.length < 3) {
        try {
          const br = await fetchIsharesBreakdown(meta.ishares_url);
          if (br.sectors.length) sectors = br.sectors;
        } catch {
          /* ignore */
        }
      }
    }

    const prev = await loadPrevSnap(meta.ticker);
    const usePrev =
      prev && prev.as_of && prev.as_of < as_of
        ? prev.holdings
        : null;
    const holdingsFinal = compareHoldings(yahoo.holdings, usePrev);

    const nextSnap: StoredSnap = {
      ticker: meta.ticker,
      as_of,
      holdings: yahoo.holdings,
      sectors,
      countries,
    };
    // Persist for next-day Δ (keep same-day prior snapshot for comparison)
    if (!prev || prev.as_of < as_of) {
      await saveSnap(nextSnap);
    } else if (!prev.holdings?.length) {
      await saveSnap(nextSnap);
    }

    return {
      ticker: meta.ticker,
      name: meta.name,
      name_ko: meta.name_ko,
      region: meta.region,
      kind: meta.kind,
      as_of,
      holdings: holdingsFinal,
      sectors,
      countries,
      source,
    };
  } catch (exc) {
    return {
      ticker: meta.ticker,
      name: meta.name,
      name_ko: meta.name_ko,
      region: meta.region,
      kind: meta.kind,
      as_of: null,
      holdings: [],
      sectors: [],
      countries: [],
      source: "",
      error: exc instanceof Error ? exc.message : String(exc),
    };
  }
}

export async function collectCountryEtfPayload(
  tickers?: string[],
): Promise<CountryEtfPayload> {
  const list = tickers?.length
    ? tickers
        .map((t) => metaByTicker(t))
        .filter((m): m is CountryEtfMeta => Boolean(m))
    : COUNTRY_ETF_UNIVERSE;

  // Shared crumb warm-up then bounded concurrency
  try {
    await getYahooCrumb();
  } catch {
    /* per-fund errors still recorded */
  }

  const funds: CountryEtfFund[] = [];
  const concurrency = 4;
  for (let i = 0; i < list.length; i += concurrency) {
    const chunk = list.slice(i, i + concurrency);
    const part = await Promise.all(chunk.map((m) => collectCountryEtfFund(m)));
    funds.push(...part);
  }

  const okCount = funds.filter((f) => f.holdings.length > 0).length;
  return {
    ok: okCount > 0,
    generated_at: new Date().toISOString(),
    source: "Yahoo Finance · iShares geographic (broad)",
    universe_count: list.length,
    funds,
    error: okCount ? undefined : "국가 ETF 편입 데이터를 가져오지 못했습니다.",
  };
}

export function regionsFromUniverse(): string[] {
  const set = new Set(COUNTRY_ETF_UNIVERSE.map((u) => u.region));
  return ["전체", ...[...set]];
}
