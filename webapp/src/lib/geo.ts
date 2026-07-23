/**
 * Lightweight geopolitics / macro-risk signals for the dashboard Geo tab.
 * Quotes come from Yahoo (no persistent storage); headlines from public RSS.
 */

export type GeoSignal = {
  id: string;
  symbol: string;
  label: string;
  group: "energy" | "metals" | "risk" | "etf";
  thesis: string;
  price: number | null;
  change_1d_pct: number | null;
  change_5d_pct: number | null;
  currency?: string;
  error?: string;
};

export type GeoHeadline = {
  title: string;
  link?: string;
  source: string;
  published?: string;
};

export type GeoPayload = {
  ok: boolean;
  generated_at: string;
  note: string;
  composite: {
    score: number; // 0–100 rough risk-off pressure
    label: string;
    drivers: string[];
  };
  signals: GeoSignal[];
  headlines: GeoHeadline[];
  related_etfs: Array<{ symbol: string; name: string; angle: string }>;
  error?: string;
};

export const GEO_SIGNAL_SPECS: Array<{
  id: string;
  symbol: string;
  label: string;
  group: GeoSignal["group"];
  thesis: string;
}> = [
  {
    id: "wti",
    symbol: "CL=F",
    label: "WTI 원유",
    group: "energy",
    thesis: "중동·공급 충격 / 인플레 압력",
  },
  {
    id: "brent",
    symbol: "BZ=F",
    label: "Brent 원유",
    group: "energy",
    thesis: "글로벌 유가 벤치마크",
  },
  {
    id: "natgas",
    symbol: "NG=F",
    label: "천연가스",
    group: "energy",
    thesis: "유럽·LNG / 계절·지정학",
  },
  {
    id: "gold",
    symbol: "GC=F",
    label: "금",
    group: "metals",
    thesis: "안전자산·달러·실질금리",
  },
  {
    id: "copper",
    symbol: "COPX",
    label: "구리 채굴 ETF",
    group: "metals",
    thesis: "중국·산업금속 수요",
  },
  {
    id: "vix",
    symbol: "^VIX",
    label: "VIX",
    group: "risk",
    thesis: "주식 변동성·리스크오프",
  },
  {
    id: "usd",
    symbol: "UUP",
    label: "달러 바스켓 ETF",
    group: "risk",
    thesis: "안전자산 달러 / EM 압력",
  },
  {
    id: "dry",
    symbol: "BDRY",
    label: "건화물 운임 ETF",
    group: "risk",
    thesis: "해운·무역·중국 수요 프록시",
  },
  {
    id: "xle",
    symbol: "XLE",
    label: "에너지 섹터 ETF",
    group: "etf",
    thesis: "유가 상승 시 수혜 섹터",
  },
  {
    id: "ita",
    symbol: "ITA",
    label: "방산·항공 ETF",
    group: "etf",
    thesis: "지정학 긴장·국방비",
  },
  {
    id: "eem",
    symbol: "EEM",
    label: "신흥국 ETF",
    group: "etf",
    thesis: "리스크온/오프 · EM 자금흐름",
  },
];

export const GEO_RELATED_ETFS = [
  { symbol: "XLE", name: "Energy Select", angle: "유가·에너지 기업" },
  { symbol: "ITA", name: "U.S. Aerospace & Defense", angle: "방산·항공" },
  { symbol: "GLD", name: "SPDR Gold", angle: "금 현물 프록시" },
  { symbol: "EEM", name: "Emerging Markets", angle: "지정학·달러 민감 EM" },
  { symbol: "USO", name: "United States Oil", angle: "WTI 근월물 프록시" },
  { symbol: "BDRY", name: "Breakwave Dry Bulk", angle: "해상 운임" },
];

export function computeComposite(signals: GeoSignal[]): GeoPayload["composite"] {
  const byId = Object.fromEntries(signals.map((s) => [s.id, s]));
  const drivers: string[] = [];
  let score = 35; // baseline

  const vix = byId.vix?.price;
  if (vix != null) {
    if (vix >= 25) {
      score += 25;
      drivers.push(`VIX ${vix.toFixed(1)} (높은 변동성)`);
    } else if (vix >= 18) {
      score += 12;
      drivers.push(`VIX ${vix.toFixed(1)} (경계)`);
    } else {
      drivers.push(`VIX ${vix.toFixed(1)} (안정권)`);
    }
  }

  const oil = byId.wti?.change_1d_pct;
  if (oil != null) {
    if (oil >= 2) {
      score += 15;
      drivers.push(`WTI 급등 ${oil.toFixed(1)}%`);
    } else if (oil <= -2) {
      score -= 8;
      drivers.push(`WTI 급락 ${oil.toFixed(1)}%`);
    }
  }

  const gold = byId.gold?.change_1d_pct;
  if (gold != null && gold >= 1) {
    score += 10;
    drivers.push(`금 강세 ${gold.toFixed(1)}% (안전자산 수요)`);
  }

  const usd = byId.usd?.change_1d_pct;
  if (usd != null && usd >= 0.4) {
    score += 8;
    drivers.push(`달러 강세 ${usd.toFixed(1)}%`);
  }

  const eem = byId.eem?.change_1d_pct;
  if (eem != null && eem <= -1.2) {
    score += 10;
    drivers.push(`EEM 약세 ${eem.toFixed(1)}%`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let label = "중립";
  if (score >= 70) label = "리스크 경계 높음";
  else if (score >= 55) label = "경계";
  else if (score <= 25) label = "안정·리스크온 편향";

  return { score, label, drivers: drivers.slice(0, 5) };
}
