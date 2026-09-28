/**
 * MP (model portfolio) — shared, client-safe model: holdings versions with
 * inclusion dates, ticker metadata, benchmark definition, text import/export,
 * localStorage persistence. Analytics live in `mpAnalytics.ts` (server).
 */

export type MpCountry = "US" | "CN" | "CASH";

export type MpHolding = {
  id: string;
  country: MpCountry;
  /** Free-form PM sector label (IT H/W, 금융 …) */
  sector: string;
  /** User ticker: NVDA / 588200 / USD / CNY */
  ticker: string;
  weight_pct: number;
};

/** One target composition effective from `date` (편입·리밸런싱 일자). */
export type MpVersion = {
  id: string;
  date: string;
  note?: string;
  holdings: MpHolding[];
};

export type MpPortfolio = {
  id: string;
  name: string;
  /** Benchmark: S&P500 bm_us_pct% + CSI300 (100 - bm_us_pct)% in USD, daily rebalanced */
  bm_us_pct: number;
  versions: MpVersion[];
  updated_at: string;
};

/** Yahoo/Morningstar sector keys (same taxonomy as SPY/ASHR sectorWeightings). */
export type MpSectorKey =
  | "technology"
  | "communication_services"
  | "consumer_cyclical"
  | "consumer_defensive"
  | "financial_services"
  | "healthcare"
  | "industrials"
  | "basic_materials"
  | "energy"
  | "utilities"
  | "realestate";

export const MP_SECTORS: Array<{ key: MpSectorKey; label: string }> = [
  { key: "technology", label: "IT" },
  { key: "communication_services", label: "커뮤니케이션" },
  { key: "consumer_cyclical", label: "경기소비재" },
  { key: "consumer_defensive", label: "필수소비재" },
  { key: "financial_services", label: "금융" },
  { key: "healthcare", label: "헬스케어" },
  { key: "industrials", label: "산업재" },
  { key: "basic_materials", label: "소재" },
  { key: "energy", label: "에너지" },
  { key: "utilities", label: "유틸리티" },
  { key: "realestate", label: "부동산" },
];

export function mpSectorLabel(key: string): string {
  if (key === "cash") return "현금";
  return MP_SECTORS.find((s) => s.key === key)?.label || key;
}

/**
 * Fallback benchmark sector weights (%) when Yahoo topHoldings is unavailable.
 * S&P500 ← SPY, CSI300 ← ASHR, snapshot 2026-09.
 */
export const MP_BM_SECTOR_FALLBACK: Record<"US" | "CN", Record<MpSectorKey, number>> = {
  US: {
    technology: 38.7,
    communication_services: 9.5,
    consumer_cyclical: 9.3,
    consumer_defensive: 4.5,
    financial_services: 12.1,
    healthcare: 9.3,
    industrials: 7.8,
    basic_materials: 1.7,
    energy: 3.5,
    utilities: 2.0,
    realestate: 1.8,
  },
  CN: {
    technology: 29.3,
    communication_services: 1.2,
    consumer_cyclical: 6.1,
    consumer_defensive: 6.5,
    financial_services: 20.6,
    healthcare: 4.5,
    industrials: 15.3,
    basic_materials: 10.2,
    energy: 2.9,
    utilities: 2.9,
    realestate: 0.4,
  },
};

export type MpTickerMeta = {
  name: string;
  name_ko: string;
  name_zh?: string;
  sector: MpSectorKey;
  kind?: "etf";
};

/** Known names — unknown tickers fall back to Yahoo name / sector lookups. */
export const MP_TICKER_META: Record<string, MpTickerMeta> = {
  NVDA: { name: "NVIDIA", name_ko: "엔비디아", sector: "technology" },
  TSM: { name: "TSMC", name_ko: "TSMC", sector: "technology" },
  LRCX: { name: "Lam Research", name_ko: "램리서치", sector: "technology" },
  DELL: { name: "Dell Technologies", name_ko: "델 테크놀로지스", sector: "technology" },
  SNDK: { name: "Sandisk", name_ko: "샌디스크", sector: "technology" },
  INTC: { name: "Intel", name_ko: "인텔", sector: "technology" },
  DRAM: { name: "Roundhill Memory ETF", name_ko: "라운드힐 메모리 ETF", sector: "technology", kind: "etf" },
  MRVL: { name: "Marvell Technology", name_ko: "마벨 테크놀로지", sector: "technology" },
  LITE: { name: "Lumentum", name_ko: "루멘텀", sector: "technology" },
  AAPL: { name: "Apple", name_ko: "애플", sector: "technology" },
  MSFT: { name: "Microsoft", name_ko: "마이크로소프트", sector: "technology" },
  PLTR: { name: "Palantir", name_ko: "팔란티어", sector: "technology" },
  HOOD: { name: "Robinhood", name_ko: "로빈후드", sector: "financial_services" },
  CRWD: { name: "CrowdStrike", name_ko: "크라우드스트라이크", sector: "technology" },
  ARMK: { name: "Aramark", name_ko: "아라마크", sector: "industrials" },
  CENX: { name: "Century Aluminum", name_ko: "센추리 알루미늄", sector: "basic_materials" },
  SPCX: { name: "SpaceX", name_ko: "스페이스X", sector: "industrials" },
  MUFG: { name: "Mitsubishi UFJ Financial", name_ko: "미쓰비시UFJ", sector: "financial_services" },
  LLY: { name: "Eli Lilly", name_ko: "일라이 릴리", sector: "healthcare" },
  RVMD: { name: "Revolution Medicines", name_ko: "레볼루션 메디슨", sector: "healthcare" },
  BE: { name: "Bloom Energy", name_ko: "블룸에너지", sector: "industrials" },
  GEV: { name: "GE Vernova", name_ko: "GE 버노바", sector: "industrials" },
  AVGO: { name: "Broadcom", name_ko: "브로드컴", sector: "technology" },
  AMD: { name: "AMD", name_ko: "AMD", sector: "technology" },
  MU: { name: "Micron", name_ko: "마이크론", sector: "technology" },
  GOOGL: { name: "Alphabet", name_ko: "알파벳", sector: "communication_services" },
  META: { name: "Meta Platforms", name_ko: "메타", sector: "communication_services" },
  AMZN: { name: "Amazon", name_ko: "아마존", sector: "consumer_cyclical" },
  TSLA: { name: "Tesla", name_ko: "테슬라", sector: "consumer_cyclical" },
  "588200": {
    name: "Harvest SSE STAR Chip ETF",
    name_ko: "과창판 반도체 ETF",
    name_zh: "科创芯片ETF",
    sector: "technology",
    kind: "etf",
  },
  "601899": { name: "Zijin Mining", name_ko: "쯔진광업", name_zh: "紫金矿业", sector: "basic_materials" },
  "601318": { name: "Ping An Insurance", name_ko: "중국평안보험", name_zh: "中国平安", sector: "financial_services" },
  "600519": { name: "Kweichow Moutai", name_ko: "구이저우 마오타이", name_zh: "贵州茅台", sector: "consumer_defensive" },
  "300750": { name: "CATL", name_ko: "CATL", name_zh: "宁德时代", sector: "industrials" },
};

const TICKER_ALIASES: Record<string, string> = {
  TSMC: "TSM",
  GOOG: "GOOGL",
  BRKB: "BRK-B",
  "BRK.B": "BRK-B",
};

const CASH_ALIASES: Record<string, "USD" | "CNY"> = {
  USD: "USD",
  달러: "USD",
  CASH: "USD",
  현금: "USD",
  CNY: "CNY",
  RMB: "CNY",
  CNH: "CNY",
  위안: "CNY",
  위안화: "CNY",
};

export function normalizeTicker(raw: string, country: MpCountry): string {
  const t = raw.trim().toUpperCase();
  if (country === "CASH") return CASH_ALIASES[raw.trim()] || CASH_ALIASES[t] || t;
  if (country === "CN") return t.replace(/\.(SS|SZ|SH)$/i, "");
  return TICKER_ALIASES[t] || t;
}

/** Yahoo chart symbol for a holding (Shanghai 5/6/9xxxxx → .SS, else .SZ). */
export function yahooSymbolFor(h: Pick<MpHolding, "country" | "ticker">): string | null {
  const t = normalizeTicker(h.ticker, h.country);
  if (!t) return null;
  if (h.country === "CASH") return null;
  if (h.country === "CN") {
    if (!/^\d{6}$/.test(t)) return t;
    return /^[569]/.test(t) ? `${t}.SS` : `${t}.SZ`;
  }
  return t.replace(/\./g, "-");
}

export function holdingKey(h: Pick<MpHolding, "country" | "ticker">): string {
  const t = normalizeTicker(h.ticker, h.country);
  return h.country === "CASH" ? `CASH:${t}` : t;
}

export function tickerMeta(ticker: string): MpTickerMeta | undefined {
  return MP_TICKER_META[ticker.trim().toUpperCase()];
}

export function countryLabel(c: MpCountry): string {
  return c === "US" ? "미국" : c === "CN" ? "중국" : "현금";
}

export function newMpId(prefix = "h"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** PM's MP in the house text format (see `parseMpText`). */
export const MP_DEFAULT_TEXT = `(미국)
IT H/W nvda 3, tsmc 3, lrcx 6, dell 3, sndk 6, intc 3, dram 3, mrvl 3, lite 3, aapl 5
IT S/W msft 2, pltr 2, hood 2, crwd 2
소비재 armk 2
산업재 cenx 2, spcx 3
금융 mufg 4
바이오 lly 3, rvmd 2
에너지 be 2, gev 2

(중국)
IT H/W 588200 10
소재 601899 7
금융 601318 7

(현금) 위안화 0, 달러 10`;

export const MP_DEFAULT_INCEPTION = "2026-07-01";

function countryFromHeader(text: string): MpCountry | null {
  const t = text.replace(/[()\[\]]/g, "").trim().toLowerCase();
  if (/미국|us|usa|america/.test(t)) return "US";
  if (/중국|china|cn|a주/.test(t)) return "CN";
  if (/현금|cash/.test(t)) return "CASH";
  return null;
}

/**
 * Parse the house format:
 * `(미국)` / `(중국)` / `(현금)` headers, then `섹터 ticker w, ticker w` lines.
 * A header may carry pairs on the same line: `(현금) 위안화 0, 달러 10`.
 */
export function parseMpText(text: string): { holdings: MpHolding[]; errors: string[] } {
  const holdings: MpHolding[] = [];
  const errors: string[] = [];
  let country: MpCountry = "US";
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;
    const header = line.match(/^[(\[]([^)\]]+)[)\]]\s*(.*)$/);
    if (header) {
      const c = countryFromHeader(header[1]!);
      if (c) country = c;
      line = header[2]!.trim();
      if (!line) continue;
    }
    const segments = line.split(/[,，;]/).map((s) => s.trim()).filter(Boolean);
    let sector = "";
    segments.forEach((seg, idx) => {
      const m = seg.match(/^(?:(.*?)\s+)?(\S+)\s+(-?\d+(?:\.\d+)?)\s*%?$/);
      if (!m) {
        errors.push(`해석 실패: "${seg}"`);
        return;
      }
      if (idx === 0 && m[1]) sector = m[1].trim();
      const ticker = normalizeTicker(m[2]!, country);
      const weight = Number(m[3]);
      if (!ticker || !Number.isFinite(weight)) {
        errors.push(`해석 실패: "${seg}"`);
        return;
      }
      const meta = tickerMeta(ticker);
      holdings.push({
        id: newMpId(),
        country,
        sector: country === "CASH" ? "현금" : sector || (meta ? mpSectorLabel(meta.sector) : ""),
        ticker,
        weight_pct: weight,
      });
    });
  }
  return { holdings, errors };
}

/** Inverse of `parseMpText` — grouped by country then sector label. */
export function formatMpText(holdings: MpHolding[]): string {
  const out: string[] = [];
  for (const c of ["US", "CN", "CASH"] as MpCountry[]) {
    const rows = holdings.filter((h) => h.country === c);
    if (!rows.length) continue;
    if (c === "CASH") {
      out.push(
        `(현금) ${rows.map((r) => `${r.ticker === "CNY" ? "위안화" : r.ticker === "USD" ? "달러" : r.ticker} ${r.weight_pct}`).join(", ")}`,
      );
      continue;
    }
    out.push(`(${countryLabel(c)})`);
    const bySector = new Map<string, MpHolding[]>();
    for (const r of rows) {
      const k = r.sector || "기타";
      bySector.set(k, [...(bySector.get(k) || []), r]);
    }
    for (const [sec, list] of bySector) {
      out.push(`${sec} ${list.map((r) => `${r.ticker.toLowerCase()} ${r.weight_pct}`).join(", ")}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

export function defaultMpPortfolio(): MpPortfolio {
  const { holdings } = parseMpText(MP_DEFAULT_TEXT);
  return {
    id: newMpId("mp"),
    name: "MP",
    bm_us_pct: 70,
    versions: [
      {
        id: newMpId("v"),
        date: MP_DEFAULT_INCEPTION,
        note: "최초 편입",
        holdings,
      },
    ],
    updated_at: new Date().toISOString(),
  };
}

export function sortedVersions(p: MpPortfolio): MpVersion[] {
  return [...p.versions].sort((a, b) => a.date.localeCompare(b.date));
}

export function latestVersion(p: MpPortfolio): MpVersion | null {
  const v = sortedVersions(p);
  return v.length ? v[v.length - 1]! : null;
}

export function weightSum(holdings: MpHolding[]): number {
  return holdings.reduce((a, h) => a + (Number(h.weight_pct) || 0), 0);
}

export type MpVersionDiff = {
  added: string[];
  removed: string[];
  changed: Array<{ key: string; from: number; to: number }>;
};

export function diffVersions(prev: MpVersion | null, next: MpVersion): MpVersionDiff {
  const a = new Map((prev?.holdings || []).map((h) => [holdingKey(h), Number(h.weight_pct) || 0]));
  const b = new Map(next.holdings.map((h) => [holdingKey(h), Number(h.weight_pct) || 0]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: MpVersionDiff["changed"] = [];
  for (const [k, w] of b) {
    if (!a.has(k)) {
      if (w > 0) added.push(k);
    } else if (Math.abs((a.get(k) || 0) - w) > 1e-9) {
      changed.push({ key: k, from: a.get(k) || 0, to: w });
    }
  }
  for (const [k, w] of a) if (!b.has(k) && w > 0) removed.push(k);
  return { added, removed, changed };
}

const STORAGE_KEY = "savvyetf:mp:v1";

export function normalizeMpPortfolio(raw: unknown): MpPortfolio | null {
  const p = raw as MpPortfolio | null;
  if (!p || typeof p !== "object" || !Array.isArray(p.versions) || !p.versions.length) return null;
  return { ...p, bm_us_pct: Number.isFinite(p.bm_us_pct) ? p.bm_us_pct : 70 };
}

/** Admin's local draft (pre-server edits). */
export function loadLocalMpPortfolio(): MpPortfolio | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeMpPortfolio(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveLocalMpPortfolio(p: MpPortfolio): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}
