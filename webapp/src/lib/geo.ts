/**
 * Lightweight geopolitics / macro-risk signals for the dashboard Geo tab.
 * Quotes: Yahoo (no persistent storage). Chokepoints: Eagle Intelligence.
 * Headlines: public RSS.
 */

export type GeoPoint = {
  date: string;
  close: number;
};

export type GeoSignal = {
  id: string;
  symbol: string;
  label: string;
  group: "energy" | "metals" | "risk" | "region" | "etf";
  thesis: string;
  price: number | null;
  change_1d_pct: number | null;
  change_5d_pct: number | null;
  change_range_pct: number | null;
  currency?: string;
  series?: GeoPoint[];
  error?: string;
};

export type GeoHeadline = {
  title: string;
  link?: string;
  source: string;
  published?: string;
};

export type GeoChokepoint = {
  id: string;
  name: string;
  status: string;
  signals_24h: number;
  high_alerts_24h: number;
  signals_7d: number;
  latest_headline?: string | null;
  page_url?: string;
  last_updated?: string;
};

export type GeoRange = "1mo" | "3mo" | "6mo" | "1y";

export type GeoPayload = {
  ok: boolean;
  generated_at: string;
  note: string;
  range: GeoRange;
  composite: {
    score: number; // 0–100 rough risk-off pressure
    label: string;
    drivers: string[];
  };
  chokepoints: GeoChokepoint[];
  chokepoint_source?: {
    name: string;
    url: string;
  };
  signals: GeoSignal[];
  headlines: GeoHeadline[];
  related_etfs: Array<{ symbol: string; name: string; angle: string }>;
  error?: string;
};

export const GEO_RANGES: Array<{ id: GeoRange; label: string }> = [
  { id: "1mo", label: "1개월" },
  { id: "3mo", label: "3개월" },
  { id: "6mo", label: "6개월" },
  { id: "1y", label: "1년" },
];

export function parseGeoRange(value: string | null | undefined): GeoRange {
  if (value === "1mo" || value === "6mo" || value === "1y") return value;
  return "3mo";
}

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
    id: "ovx",
    symbol: "^OVX",
    label: "원유 변동성(OVX)",
    group: "energy",
    thesis: "유가 쇼크 프리미엄·지정학 긴장",
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
    id: "dxy",
    symbol: "DX-Y.NYB",
    label: "달러 인덱스",
    group: "risk",
    thesis: "안전자산 달러 / EM·원자재 압력",
  },
  {
    id: "tlt",
    symbol: "TLT",
    label: "장기국채 ETF",
    group: "risk",
    thesis: "리스크오프 시 채권 수요",
  },
  {
    id: "hyg",
    symbol: "HYG",
    label: "하이일드 채권",
    group: "risk",
    thesis: "신용 스트레스 (약세=위험회피)",
  },
  {
    id: "dry",
    symbol: "BDRY",
    label: "건화물 운임 ETF",
    group: "risk",
    thesis: "해운·무역·중국 수요 프록시",
  },
  {
    id: "ksa",
    symbol: "KSA",
    label: "사우디 ETF",
    group: "region",
    thesis: "중동·원유 생산국 노출",
  },
  {
    id: "qat",
    symbol: "QAT",
    label: "카타르 ETF",
    group: "region",
    thesis: "중동·LNG 노출",
  },
  {
    id: "tur",
    symbol: "TUR",
    label: "터키 ETF",
    group: "region",
    thesis: "신흥·지정학 민감 시장",
  },
  {
    id: "ewy",
    symbol: "EWY",
    label: "한국 ETF",
    group: "region",
    thesis: "동아시아·반도체·안보 민감",
  },
  {
    id: "fxi",
    symbol: "FXI",
    label: "중국 대형주 ETF",
    group: "region",
    thesis: "미·중·성장·지정학",
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
  { symbol: "USO", name: "United States Oil", angle: "WTI 근월물 프록시" },
  { symbol: "GLD", name: "SPDR Gold", angle: "금 현물 프록시" },
  { symbol: "TLT", name: "20+ Year Treasury", angle: "안전자산 채권" },
  { symbol: "KSA", name: "iShares MSCI Saudi Arabia", angle: "중동·원유" },
  { symbol: "EEM", name: "Emerging Markets", angle: "지정학·달러 민감 EM" },
  { symbol: "BDRY", name: "Breakwave Dry Bulk", angle: "해상 운임" },
];

const CHOKE_STATUS_SCORE: Record<string, number> = {
  SEVERE: 22,
  CRITICAL: 22,
  HIGH: 16,
  ELEVATED: 10,
  WATCH: 5,
  MONITORING: 2,
  NORMAL: 0,
  LOW: 0,
};

export function computeComposite(
  signals: GeoSignal[],
  chokepoints: GeoChokepoint[] = [],
): GeoPayload["composite"] {
  const byId = Object.fromEntries(signals.map((s) => [s.id, s]));
  const drivers: string[] = [];
  let score = 30; // baseline

  // Maritime chokepoints first — most direct geo signal
  const severe = chokepoints.filter((c) =>
    /SEVERE|CRITICAL|HIGH/i.test(c.status),
  );
  const elevated = chokepoints.filter((c) => /ELEVATED|WATCH/i.test(c.status));
  for (const c of chokepoints) {
    score += CHOKE_STATUS_SCORE[c.status.toUpperCase()] ?? 0;
  }
  if (severe.length) {
    drivers.push(
      `해운 병목 ${severe.map((c) => c.name.replace(/ Strait| Canal/g, "")).join(", ")}: ${severe[0].status}`,
    );
  } else if (elevated.length) {
    drivers.push(`해운 병목 경계: ${elevated.map((c) => c.name).slice(0, 2).join(", ")}`);
  }

  const vix = byId.vix?.price;
  if (vix != null) {
    if (vix >= 25) {
      score += 18;
      drivers.push(`VIX ${vix.toFixed(1)} (높은 변동성)`);
    } else if (vix >= 18) {
      score += 10;
      drivers.push(`VIX ${vix.toFixed(1)} (경계)`);
    } else {
      drivers.push(`VIX ${vix.toFixed(1)} (안정권)`);
    }
  }

  const ovx = byId.ovx?.price;
  if (ovx != null) {
    if (ovx >= 45) {
      score += 14;
      drivers.push(`OVX ${ovx.toFixed(1)} (원유 변동성 급등)`);
    } else if (ovx >= 32) {
      score += 8;
      drivers.push(`OVX ${ovx.toFixed(1)} (원유 변동성 상승)`);
    }
  }

  const oil = byId.wti?.change_1d_pct;
  if (oil != null) {
    if (oil >= 2) {
      score += 12;
      drivers.push(`WTI 급등 ${oil.toFixed(1)}%`);
    } else if (oil <= -2) {
      score -= 6;
      drivers.push(`WTI 급락 ${oil.toFixed(1)}%`);
    }
  }

  const gold = byId.gold?.change_1d_pct;
  if (gold != null && gold >= 1) {
    score += 8;
    drivers.push(`금 강세 ${gold.toFixed(1)}%`);
  }

  const dxy = byId.dxy?.change_1d_pct ?? byId.usd?.change_1d_pct;
  if (dxy != null && dxy >= 0.35) {
    score += 6;
    drivers.push(`달러 강세 ${dxy.toFixed(1)}%`);
  }

  const tlt = byId.tlt?.change_1d_pct;
  const hyg = byId.hyg?.change_1d_pct;
  if (tlt != null && tlt >= 0.6 && hyg != null && hyg <= -0.4) {
    score += 8;
    drivers.push("채권 안전자산 선호 (TLT↑ / HYG↓)");
  }

  const eem = byId.eem?.change_1d_pct;
  if (eem != null && eem <= -1.2) {
    score += 8;
    drivers.push(`EEM 약세 ${eem.toFixed(1)}%`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let label = "중립";
  if (score >= 70) label = "리스크 경계 높음";
  else if (score >= 55) label = "경계";
  else if (score <= 25) label = "안정·리스크온 편향";

  return { score, label, drivers: drivers.slice(0, 6) };
}
