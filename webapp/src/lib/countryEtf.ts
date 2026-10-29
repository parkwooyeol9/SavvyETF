/**
 * iShares country / sector weight scraper and the stored ACWI country snapshot.
 * The 국가 ETF tab that collected US-listed country ETFs on every visit was folded into
 * the ETF·DB first screen (2026-10); only what the MP tab still reads stays here.
 */

import { r2Configured, r2GetObjectText } from "@/lib/r2";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";
const R2_PREFIX = "country_etf";

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
  Finland: "핀란드",
  Norway: "노르웨이",
  Austria: "오스트리아",
  Ireland: "아일랜드",
  Portugal: "포르투갈",
  "New Zealand": "뉴질랜드",
  Israel: "이스라엘",
  Turkey: "튀르키예",
  Hungary: "헝가리",
  Greece: "그리스",
  "Czech Republic": "체코",
  Chile: "칠레",
  Peru: "페루",
  Colombia: "콜롬비아",
  Philippines: "필리핀",
  Qatar: "카타르",
  Kuwait: "쿠웨이트",
  Egypt: "이집트",
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

export type WeightRow = {
  key: string;
  label: string;
  weight_pct: number;
  prev_weight_pct?: number | null;
  delta_pp?: number | null;
};

function countryLabel(name: string): string {
  return COUNTRY_LABEL_KO[name] || name;
}

function normalizeCountry(name: string): string {
  if (name === "Korea (South)") return "South Korea";
  return name;
}

export type IsharesBreakdown = {
  countries: WeightRow[];
  sectors: WeightRow[];
};

const WEIGHT_CELL_RE =
  /([A-Za-z][A-Za-z0-9 &\/\-\(\)\.]+)<\/td><td class="_ws-colFund[^"]*"[^>]*>([\d.]+)%/g;

export async function fetchIsharesBreakdown(url: string): Promise<IsharesBreakdown> {
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

export type StoredSnap = {
  ticker: string;
  as_of: string;
  holdings: Array<{ symbol: string; name: string; weight_pct: number }>;
  sectors: WeightRow[];
  countries: WeightRow[];
};

export function countryLabelKo(name: string): string {
  return countryLabel(normalizeCountry(name));
}

export async function loadPrevSnap(ticker: string): Promise<StoredSnap | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(`${R2_PREFIX}/${ticker}/latest.json`);
    if (!text) return null;
    return JSON.parse(text) as StoredSnap;
  } catch {
    return null;
  }
}
