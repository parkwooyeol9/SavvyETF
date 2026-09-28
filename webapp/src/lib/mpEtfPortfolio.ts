/**
 * MP-ETF배분 — client-safe model for the asset-allocation ETF portfolio:
 * dated target versions, 60/30/10 benchmark definition, ETF metadata
 * (asset class, country look-through, news theme), text import/export and
 * localStorage persistence. Analytics live in `mpEtfAnalytics.ts` (server).
 */

import { newMpId, todayIso } from "@/lib/mpPortfolio";

export type EtfAsset = "EQ" | "FI" | "ALT" | "CASH";
export type EtfAltSub = "cmdty" | "reit" | "digital";

export type EtfHolding = {
  id: string;
  asset: EtfAsset;
  /** PM grouping label (선진 미국, 미국 국채, 원자재 …) */
  group: string;
  /** SPY / 159915.SZ / 2823.HK / USD */
  ticker: string;
  weight_pct: number;
};

export type EtfVersion = {
  id: string;
  date: string;
  note?: string;
  holdings: EtfHolding[];
};

/** BM = ACWI eq% + Global Agg fi% + alt% × (commodity / REIT / bitcoin mix), daily rebalanced. */
export type EtfBm = {
  eq: number;
  fi: number;
  alt: number;
  alt_cmdty: number;
  alt_reit: number;
  alt_btc: number;
};

export type EtfPortfolio = {
  id: string;
  name: string;
  bm: EtfBm;
  versions: EtfVersion[];
  updated_at: string;
};

export const ETF_DEFAULT_BM: EtfBm = { eq: 60, fi: 30, alt: 10, alt_cmdty: 40, alt_reit: 40, alt_btc: 20 };

export const ETF_ASSETS: Array<{ key: EtfAsset; label: string }> = [
  { key: "EQ", label: "주식" },
  { key: "FI", label: "채권" },
  { key: "ALT", label: "대체" },
  { key: "CASH", label: "현금" },
];

export const ETF_ALT_SUBS: Array<{ key: EtfAltSub; label: string }> = [
  { key: "cmdty", label: "원자재" },
  { key: "reit", label: "리츠" },
  { key: "digital", label: "디지털자산" },
];

export function assetLabel(a: EtfAsset): string {
  return ETF_ASSETS.find((x) => x.key === a)?.label || a;
}

export type EtfTheme =
  | "us_eq"
  | "semis"
  | "oil"
  | "cyber"
  | "europe"
  | "japan"
  | "china"
  | "korea"
  | "taiwan"
  | "em"
  | "latam"
  | "ust"
  | "credit"
  | "global_bond"
  | "em_bond"
  | "gold"
  | "metals"
  | "agri"
  | "reit"
  | "btc";

export const ETF_THEMES: Record<EtfTheme, { label: string; en: string; ko: string }> = {
  us_eq: { label: "미국 증시", en: '"S&P 500" stocks', ko: "미국 증시 S&P500" },
  semis: { label: "반도체", en: "semiconductor stocks memory chips", ko: "반도체 주가 메모리" },
  oil: { label: "원유·정유", en: "oil prices refining margins", ko: "국제유가 정제마진" },
  cyber: { label: "사이버보안", en: "cybersecurity stocks", ko: "사이버보안 주식" },
  europe: { label: "유럽 증시", en: '"Euro Stoxx 50" OR "European stocks"', ko: "유럽 증시" },
  japan: { label: "일본 증시", en: 'Nikkei OR "Japanese stocks"', ko: "일본 증시 닛케이" },
  china: { label: "중국 증시", en: '"China stocks" OR "CSI 300" OR ChiNext', ko: "중국 증시 상해종합" },
  korea: { label: "한국 증시", en: "KOSPI stocks", ko: "코스피 증시" },
  taiwan: { label: "대만 증시", en: "Taiwan stocks TAIEX", ko: "대만 증시" },
  em: { label: "신흥국 증시", en: '"emerging markets" stocks', ko: "신흥국 증시" },
  latam: { label: "중남미", en: "Latin America stocks Brazil Mexico", ko: "중남미 증시 브라질" },
  ust: { label: "미 국채·금리", en: "Treasury yields Fed", ko: "미국 국채 금리 연준" },
  credit: { label: "크레딧", en: "corporate bond spreads high yield", ko: "회사채 스프레드 하이일드" },
  global_bond: { label: "글로벌 채권", en: "global bond yields Bund JGB", ko: "글로벌 채권 금리" },
  em_bond: { label: "신흥국 채권", en: "emerging market local currency bonds", ko: "신흥국 채권 통화" },
  gold: { label: "금", en: "gold price", ko: "금값 금 가격" },
  metals: { label: "산업금속", en: "copper aluminum prices", ko: "구리 가격 산업금속" },
  agri: { label: "농산물", en: "grain prices wheat corn soybeans", ko: "곡물 가격 농산물" },
  reit: { label: "리츠", en: "REITs real estate stocks", ko: "리츠 부동산" },
  btc: { label: "비트코인", en: "bitcoin price", ko: "비트코인 가격" },
};

export type EtfMeta = {
  name: string;
  name_ko: string;
  asset: Exclude<EtfAsset, "CASH">;
  sub?: EtfAltSub;
  theme: EtfTheme;
  /** Equity look-through (iShares country names, %). Estimated from index / top holdings. */
  countries?: Record<string, number>;
  /** Live iShares geographic table overrides `countries`. */
  ishares_url?: string;
  /** Issuer effective duration (years, approx. 2026) */
  duration?: number;
  /** Pre-listing proxy basket for backtests (Yahoo symbol → weight %). */
  backfill?: Record<string, number>;
  backfill_label?: string;
};

/** Known ETFs — unknown tickers still work (asset from header, Yahoo name). */
export const ETF_META: Record<string, EtfMeta> = {
  SPY: { name: "SPDR S&P 500 ETF", name_ko: "S&P500", asset: "EQ", theme: "us_eq", countries: { "United States": 100 } },
  SOXX: {
    name: "iShares Semiconductor ETF",
    name_ko: "미국 반도체",
    asset: "EQ",
    theme: "semis",
    countries: { "United States": 90, Taiwan: 5, Netherlands: 4, "United Kingdom": 1 },
  },
  DRAM: {
    name: "Roundhill Memory ETF",
    name_ko: "메모리 반도체",
    asset: "EQ",
    theme: "semis",
    countries: { "United States": 50, "South Korea": 41, Japan: 6, Taiwan: 3 },
    backfill: { MU: 40, "000660.KS": 30, "005930.KS": 30 },
    backfill_label: "메모리 3종(MU·SK하이닉스·삼성전자)",
  },
  CRAK: {
    name: "VanEck Oil Refiners ETF",
    name_ko: "글로벌 정유",
    asset: "EQ",
    theme: "oil",
    countries: {
      "United States": 42,
      Japan: 11,
      "South Korea": 8,
      India: 6.5,
      Poland: 5,
      Finland: 5,
      Turkey: 4.5,
      Hungary: 4.5,
      Taiwan: 4,
      Other: 9.5,
    },
  },
  CIBR: {
    name: "First Trust NASDAQ Cybersecurity ETF",
    name_ko: "사이버보안",
    asset: "EQ",
    theme: "cyber",
    countries: { "United States": 88, Israel: 7, Japan: 2, Other: 3 },
  },
  FEZ: {
    name: "SPDR EURO STOXX 50 ETF",
    name_ko: "유로존 대형주",
    asset: "EQ",
    theme: "europe",
    countries: { France: 34, Germany: 30, Netherlands: 15, Spain: 11, Italy: 8, Belgium: 1.5, Finland: 0.5 },
  },
  EWJ: { name: "iShares MSCI Japan ETF", name_ko: "일본", asset: "EQ", theme: "japan", countries: { Japan: 100 } },
  "159915.SZ": { name: "E Fund ChiNext ETF", name_ko: "창업판(ChiNext)", asset: "EQ", theme: "china", countries: { China: 100 } },
  "2823.HK": { name: "iShares FTSE China A50 ETF", name_ko: "중국 A50", asset: "EQ", theme: "china", countries: { China: 100 } },
  "588000.SS": { name: "ChinaAMC STAR 50 ETF", name_ko: "과창판50", asset: "EQ", theme: "china", countries: { China: 100 } },
  EWY: { name: "iShares MSCI South Korea ETF", name_ko: "한국", asset: "EQ", theme: "korea", countries: { "South Korea": 100 } },
  EEM: {
    name: "iShares MSCI Emerging Markets ETF",
    name_ko: "신흥국",
    asset: "EQ",
    theme: "em",
    ishares_url: "https://www.ishares.com/us/products/239637/ishares-msci-emerging-markets-etf",
    countries: {
      Taiwan: 28.6,
      "South Korea": 21.9,
      China: 19.5,
      India: 10.7,
      Brazil: 4,
      "South Africa": 3,
      "Saudi Arabia": 2.3,
      Mexico: 1.6,
      "United Arab Emirates": 1.2,
      Poland: 1.2,
      Other: 6,
    },
  },
  EWT: { name: "iShares MSCI Taiwan ETF", name_ko: "대만", asset: "EQ", theme: "taiwan", countries: { Taiwan: 100 } },
  EMXC: {
    name: "iShares MSCI Emerging Markets ex China ETF",
    name_ko: "신흥국(중국 제외)",
    asset: "EQ",
    theme: "em",
    ishares_url: "https://www.ishares.com/us/products/288504/ishares-msci-emerging-markets-ex-china-etf",
    countries: {
      Taiwan: 35.4,
      "South Korea": 27.2,
      India: 13.3,
      Brazil: 4.9,
      "South Africa": 3.7,
      "Saudi Arabia": 2.8,
      Mexico: 2,
      "United Arab Emirates": 1.5,
      Poland: 1.4,
      Thailand: 1.2,
      Malaysia: 1.1,
      Other: 5.5,
    },
  },
  ILF: {
    name: "iShares Latin America 40 ETF",
    name_ko: "중남미",
    asset: "EQ",
    theme: "latam",
    ishares_url: "https://www.ishares.com/us/products/239761/ishares-latin-america-40-etf",
    countries: { Brazil: 55.3, Mexico: 25, Chile: 7.7, Peru: 7, Colombia: 2.9, Other: 2.1 },
  },

  SCHO: { name: "Schwab Short-Term US Treasury ETF", name_ko: "미국 단기국채", asset: "FI", theme: "ust", duration: 1.9 },
  VGIT: { name: "Vanguard Intermediate-Term Treasury ETF", name_ko: "미국 중기국채", asset: "FI", theme: "ust", duration: 5.1 },
  VGLT: { name: "Vanguard Long-Term Treasury ETF", name_ko: "미국 장기국채", asset: "FI", theme: "ust", duration: 14.3 },
  TIP: { name: "iShares TIPS Bond ETF", name_ko: "미국 물가연동국채", asset: "FI", theme: "ust", duration: 6.6 },
  MBB: { name: "iShares MBS ETF", name_ko: "미국 MBS", asset: "FI", theme: "credit", duration: 5.8 },
  VCSH: { name: "Vanguard Short-Term Corporate Bond ETF", name_ko: "단기 회사채", asset: "FI", theme: "credit", duration: 2.6 },
  VCIT: { name: "Vanguard Intermediate-Term Corporate Bond ETF", name_ko: "중기 회사채", asset: "FI", theme: "credit", duration: 6.1 },
  VCLT: { name: "Vanguard Long-Term Corporate Bond ETF", name_ko: "장기 회사채", asset: "FI", theme: "credit", duration: 12.6 },
  SJNK: { name: "SPDR Bloomberg Short Term High Yield Bond ETF", name_ko: "단기 하이일드", asset: "FI", theme: "credit", duration: 2.3 },
  HYG: { name: "iShares iBoxx $ High Yield Corporate Bond ETF", name_ko: "하이일드", asset: "FI", theme: "credit", duration: 3.1 },
  IAGG: { name: "iShares Core International Aggregate Bond ETF", name_ko: "비미국 종합채권(헤지)", asset: "FI", theme: "global_bond", duration: 7.1 },
  BNDX: { name: "Vanguard Total International Bond ETF", name_ko: "비미국 채권(헤지)", asset: "FI", theme: "global_bond", duration: 6.9 },
  EMLC: { name: "VanEck J.P. Morgan EM Local Currency Bond ETF", name_ko: "신흥국 현지통화채", asset: "FI", theme: "em_bond", duration: 5.0 },

  GLD: { name: "SPDR Gold Shares", name_ko: "금", asset: "ALT", sub: "cmdty", theme: "gold" },
  USO: { name: "United States Oil Fund", name_ko: "원유(WTI)", asset: "ALT", sub: "cmdty", theme: "oil" },
  DBB: { name: "Invesco DB Base Metals Fund", name_ko: "산업금속", asset: "ALT", sub: "cmdty", theme: "metals" },
  DBA: { name: "Invesco DB Agriculture Fund", name_ko: "농산물", asset: "ALT", sub: "cmdty", theme: "agri" },
  INDS: { name: "Pacer Industrial Real Estate ETF", name_ko: "물류·산업 리츠", asset: "ALT", sub: "reit", theme: "reit" },
  VNQ: { name: "Vanguard Real Estate ETF", name_ko: "미국 리츠", asset: "ALT", sub: "reit", theme: "reit" },
  DFAR: { name: "Dimensional US Real Estate ETF", name_ko: "미국 리츠(DFA)", asset: "ALT", sub: "reit", theme: "reit" },
  BITO: { name: "ProShares Bitcoin ETF", name_ko: "비트코인 선물", asset: "ALT", sub: "digital", theme: "btc" },
};

/** Bloomberg Global Aggregate effective duration (approx.) */
export const ETF_BM_DURATION = 6.4;

export function etfMeta(ticker: string): EtfMeta | undefined {
  return ETF_META[normalizeEtfTicker(ticker)];
}

/** `159915` → 159915.SZ, `588000` → 588000.SS, `2823` → 2823.HK, `.sh` → `.SS`. */
export function normalizeEtfTicker(raw: string): string {
  let t = raw.trim().toUpperCase().replace(/\.SH$/, ".SS");
  if (/^\d{6}$/.test(t)) t = /^[569]/.test(t) ? `${t}.SS` : `${t}.SZ`;
  else if (/^\d{4}$/.test(t)) t = `${t}.HK`;
  return t;
}

export function etfYahooSymbol(h: Pick<EtfHolding, "asset" | "ticker">): string | null {
  if (h.asset === "CASH") return null;
  const t = normalizeEtfTicker(h.ticker);
  return t ? t : null;
}

export function etfHoldingKey(h: Pick<EtfHolding, "asset" | "ticker">): string {
  return h.asset === "CASH" ? "CASH:USD" : normalizeEtfTicker(h.ticker);
}

export function altSubOf(h: Pick<EtfHolding, "ticker" | "group">): EtfAltSub {
  const m = etfMeta(h.ticker);
  if (m?.sub) return m.sub;
  if (/리츠|reit|부동산/i.test(h.group)) return "reit";
  if (/디지털|비트|crypto|bitcoin|btc/i.test(h.group)) return "digital";
  return "cmdty";
}

function assetFromHeader(text: string): EtfAsset | null {
  const t = text.toLowerCase();
  if (/주식|equity|stock/.test(t)) return "EQ";
  if (/채권|bond|fixed/.test(t)) return "FI";
  if (/대체|alternative|alt\b/.test(t)) return "ALT";
  if (/현금|cash/.test(t)) return "CASH";
  return null;
}

const TICKER_RE = /^(?=.*[A-Z])[A-Z0-9][A-Z0-9.\-]*$|^\d{4,6}(\.[A-Z]{2})?$/i;
const NUM_RE = /^-?\d+(?:\.\d+)?%?$/;

/**
 * Accepts the PM's paste as-is (`주식 합계 60 / 선진 / 미국 spy 26.5 soxx 3 / 기타선진 fez 9 …`)
 * as well as the export format (`(주식)` header, `그룹 TICKER w TICKER w` lines).
 * `/` and newlines both split lines; `(BM -1.2)` style notes are ignored.
 */
export function parseEtfText(text: string): { holdings: EtfHolding[]; errors: string[] } {
  const holdings: EtfHolding[] = [];
  const errors: string[] = [];
  let asset: EtfAsset = "EQ";
  let region = "";
  let label = "";
  const lines = text
    .split(/\r?\n|\s\/\s|^\/|\/$/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const rawLine of lines) {
    let line = rawLine.replace(/\((?:bm|BM)[^)]*\)/g, " ").trim();
    const header = line.match(/^[(\[]([^)\]]+)[)\]]\s*(.*)$/);
    if (header) {
      const a = assetFromHeader(header[1]!);
      if (a) {
        asset = a;
        region = "";
        label = "";
      }
      line = header[2]!.trim();
      if (!line) continue;
    }
    const total = line.match(/^(\S+)\s*(합계|total)(?=\s|$)/i);
    if (total) {
      const a = assetFromHeader(total[1]!);
      if (a) {
        asset = a;
        region = "";
        label = "";
        continue;
      }
    }
    const tokens = line.replace(/[,，;]/g, " ").split(/\s+/).filter(Boolean);
    const words: string[] = [];
    const pairs: Array<[string, number]> = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!;
      const next = tokens[i + 1];
      if (TICKER_RE.test(tok) && next != null && NUM_RE.test(next) && !/[가-힣]/.test(tok)) {
        pairs.push([normalizeEtfTicker(tok), Number(next.replace("%", ""))]);
        i++;
      } else if (!pairs.length) {
        words.push(tok);
      } else {
        errors.push(`해석 실패: "${tok}"`);
      }
    }
    const lead = words.join(" ").trim();
    if (!pairs.length) {
      const a = assetFromHeader(lead);
      if (a && lead.length <= 6) {
        asset = a;
        region = "";
        label = "";
      } else if (/^(선진|신흥|developed|emerging)$/i.test(lead)) {
        region = lead;
        label = "";
      } else if (lead) {
        label = lead;
      }
      continue;
    }
    if (lead) label = lead;
    const group =
      asset === "EQ" && region && label && !label.includes(region) ? `${region} ${label}` : label || region;
    for (const [ticker, weight] of pairs) {
      if (!Number.isFinite(weight)) {
        errors.push(`해석 실패: "${ticker}"`);
        continue;
      }
      const meta = ETF_META[ticker];
      const isCash = /^(USD|CASH|달러|현금)$/i.test(ticker);
      holdings.push({
        id: newMpId(),
        asset: isCash ? "CASH" : asset === "CASH" ? meta?.asset || "EQ" : asset,
        group: isCash ? "현금" : group || meta?.name_ko || "",
        ticker: isCash ? "USD" : ticker,
        weight_pct: weight,
      });
    }
  }
  return { holdings, errors };
}

export function formatEtfText(holdings: EtfHolding[]): string {
  const out: string[] = [];
  for (const a of ETF_ASSETS) {
    const rows = holdings.filter((h) => h.asset === a.key);
    if (!rows.length) continue;
    out.push(`(${a.label})`);
    if (a.key === "CASH") {
      out.push(`현금 USD ${rows.reduce((s, r) => s + (Number(r.weight_pct) || 0), 0)}`);
      out.push("");
      continue;
    }
    const byGroup = new Map<string, EtfHolding[]>();
    for (const r of rows) byGroup.set(r.group || "기타", [...(byGroup.get(r.group || "기타") || []), r]);
    for (const [g, list] of byGroup) out.push(`${g} ${list.map((r) => `${r.ticker} ${r.weight_pct}`).join(" ")}`);
    out.push("");
  }
  return out.join("\n").trim();
}

export const ETF_DEFAULT_TEXT = `(주식)
선진 미국 SPY 26.5 SOXX 3 DRAM 3 CRAK 2 CIBR 2
기타선진 FEZ 9 EWJ 4.5
신흥 중국 159915.SZ 1 2823.HK 2 588000.SS 1
기타신흥 EWY 0.7 EEM 2.3 EWT 1 EMXC 1 ILF 1
(채권)
미국 국채 SCHO 0.9 VGIT 10.4 VGLT 1.7 TIP 1.4
미국 크레딧 MBB 2.9 VCSH 0.2 VCIT 1.4 VCLT 0.7 SJNK 0.1 HYG 0.4
비미국 IAGG 1.2 BNDX 5.8 EMLC 1.7
(대체)
원자재 GLD 1.5 USO 2 DBB 0.8 DBA 0.9
리츠 INDS 1 VNQ 1 DFAR 2
디지털자산 BITO 2`;

export const ETF_DEFAULT_INCEPTION = "2026-07-01";

export function defaultEtfPortfolio(): EtfPortfolio {
  const { holdings } = parseEtfText(ETF_DEFAULT_TEXT);
  return {
    id: newMpId("etf"),
    name: "MP-ETF배분",
    bm: { ...ETF_DEFAULT_BM },
    versions: [{ id: newMpId("v"), date: ETF_DEFAULT_INCEPTION, note: "최초 편입", holdings }],
    updated_at: new Date().toISOString(),
  };
}

export function sortedEtfVersions(p: EtfPortfolio): EtfVersion[] {
  return [...p.versions].sort((a, b) => a.date.localeCompare(b.date));
}

export function latestEtfVersion(p: EtfPortfolio): EtfVersion | null {
  return sortedEtfVersions(p).at(-1) || null;
}

export function etfWeightSum(holdings: EtfHolding[]): number {
  return holdings.reduce((a, h) => a + (Number(h.weight_pct) || 0), 0);
}

export function diffEtfVersions(
  prev: EtfVersion | null,
  next: EtfVersion,
): { added: string[]; removed: string[]; changed: Array<{ key: string; from: number; to: number }> } {
  const sum = (v: EtfVersion | null) => {
    const m = new Map<string, number>();
    for (const h of v?.holdings || []) m.set(etfHoldingKey(h), (m.get(etfHoldingKey(h)) || 0) + (Number(h.weight_pct) || 0));
    return m;
  };
  const a = sum(prev);
  const b = sum(next);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: Array<{ key: string; from: number; to: number }> = [];
  for (const [k, w] of b) {
    if (!a.has(k)) {
      if (w > 0) added.push(k);
    } else if (Math.abs((a.get(k) || 0) - w) > 1e-9) changed.push({ key: k, from: a.get(k) || 0, to: w });
  }
  for (const [k, w] of a) if (!b.has(k) && w > 0) removed.push(k);
  return { added, removed, changed };
}

export function normalizeBm(bm: Partial<EtfBm> | undefined): EtfBm {
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.min(100, Math.max(0, Number(v))) : d);
  return {
    eq: n(bm?.eq, ETF_DEFAULT_BM.eq),
    fi: n(bm?.fi, ETF_DEFAULT_BM.fi),
    alt: n(bm?.alt, ETF_DEFAULT_BM.alt),
    alt_cmdty: n(bm?.alt_cmdty, ETF_DEFAULT_BM.alt_cmdty),
    alt_reit: n(bm?.alt_reit, ETF_DEFAULT_BM.alt_reit),
    alt_btc: n(bm?.alt_btc, ETF_DEFAULT_BM.alt_btc),
  };
}

export function bmLabel(bm: EtfBm): string {
  return (
    `주식 ${bm.eq} (MSCI ACWI) · 채권 ${bm.fi} (Bloomberg Global Agg) · 대체 ${bm.alt} ` +
    `(원자재 ${bm.alt_cmdty} / 리츠 ${bm.alt_reit} / 비트코인 ${bm.alt_btc})`
  );
}

const STORAGE_KEY = "savvyetf:mpetf:v1";

export function loadEtfPortfolio(): EtfPortfolio {
  if (typeof window === "undefined") return defaultEtfPortfolio();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as EtfPortfolio;
      if (p && Array.isArray(p.versions) && p.versions.length) return { ...p, bm: normalizeBm(p.bm) };
    }
  } catch {
    /* ignore */
  }
  return defaultEtfPortfolio();
}

export function saveEtfPortfolio(p: EtfPortfolio): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

export { newMpId, todayIso };
