/**
 * Lightweight geopolitics / macro-risk signals for the dashboard Geo tab.
 * Quotes: Yahoo. Maritime alerts: Eagle Intelligence.
 * Iran / Hormuz crisis bundle: straits.live public mirror (no API key).
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

export type GeoHormuzTransitLane = {
  id: string;
  name: string;
  date?: string;
  n_total: number | null;
  baseline: number | null;
  pre_crisis_baseline: number | null;
  delta_day: number | null;
};

export type GeoHormuzCrisis = {
  as_of?: string;
  status?: string;
  verdict_short?: string;
  verdict_long?: string;
  verdict_status?: string;
  brent?: number | null;
  wti?: number | null;
  ais_in_zone?: number | null;
  transit_count?: number | null;
  transit_baseline?: number | null;
  transit_throughput_pct?: number | null;
  transit_as_of?: string;
  tanker_count?: number | null;
  insurance_multiple?: number | null;
  vlcc_premium_low?: number | null;
  vlcc_premium_high?: number | null;
  crisis_pressure?: number | null;
  crisis_band?: string | null;
  escalation?: number | null;
  escalation_band?: string | null;
  iran_usd_mid?: number | null;
  iran_delta_1d_pct?: number | null;
  iran_delta_7d_pct?: number | null;
  world_oil_at_risk_pct?: number | null;
  world_lng_at_risk_pct?: number | null;
  daily_cost_usd?: number | null;
  alt_route_extra_days?: number | null;
  carriers: Array<{ name: string; notes?: string }>;
  lanes: GeoHormuzTransitLane[];
  events: Array<{ title: string; occurred_at?: string; severity?: string }>;
  markets: Array<{
    title: string;
    probability: number | null;
    venue?: string;
    url?: string;
  }>;
  source: { name: string; url: string; mirror?: string };
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
  hormuz?: GeoHormuzCrisis | null;
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
    thesis: "이란·호르무즈 공급 충격 / 인플레",
  },
  {
    id: "brent",
    symbol: "BZ=F",
    label: "Brent 원유",
    group: "energy",
    thesis: "중동 리스크 반영 글로벌 벤치마크",
  },
  {
    id: "natgas",
    symbol: "NG=F",
    label: "천연가스",
    group: "energy",
    thesis: "중동 LNG·유럽 공급 대체 압력",
  },
  {
    id: "ovx",
    symbol: "^OVX",
    label: "원유 변동성(OVX)",
    group: "energy",
    thesis: "호르무즈·이란 전쟁 쇼크 프리미엄",
  },
  {
    id: "gold",
    symbol: "GC=F",
    label: "금",
    group: "metals",
    thesis: "안전자산·전쟁 리스크오프",
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
    thesis: "케이프 우회·해운 운임 프록시",
  },
  {
    id: "ksa",
    symbol: "KSA",
    label: "사우디 ETF",
    group: "region",
    thesis: "이란 전쟁·원유 생산국 노출",
  },
  {
    id: "qat",
    symbol: "QAT",
    label: "카타르 ETF",
    group: "region",
    thesis: "걸프·LNG 노출",
  },
  {
    id: "tur",
    symbol: "TUR",
    label: "터키 ETF",
    group: "region",
    thesis: "중동 인접·에너지 통로 민감",
  },
  {
    id: "ewy",
    symbol: "EWY",
    label: "한국 ETF",
    group: "region",
    thesis: "중동 원유 의존·에너지 수입국",
  },
  {
    id: "fxi",
    symbol: "FXI",
    label: "중국 대형주 ETF",
    group: "region",
    thesis: "걸프 원유 수요국·성장 민감",
  },
  {
    id: "xle",
    symbol: "XLE",
    label: "에너지 섹터 ETF",
    group: "etf",
    thesis: "유가 급등 시 수혜 섹터",
  },
  {
    id: "ita",
    symbol: "ITA",
    label: "방산·항공 ETF",
    group: "etf",
    thesis: "이란 전쟁·국방비 테마",
  },
  {
    id: "eem",
    symbol: "EEM",
    label: "신흥국 ETF",
    group: "etf",
    thesis: "에너지 쇼크·리스크오프 EM",
  },
];

export const GEO_RELATED_ETFS = [
  { symbol: "XLE", name: "Energy Select", angle: "유가·에너지 기업" },
  { symbol: "ITA", name: "U.S. Aerospace & Defense", angle: "이란 전쟁·방산" },
  { symbol: "USO", name: "United States Oil", angle: "WTI 근월물 프록시" },
  { symbol: "GLD", name: "SPDR Gold", angle: "금 현물 프록시" },
  { symbol: "TLT", name: "20+ Year Treasury", angle: "안전자산 채권" },
  { symbol: "KSA", name: "iShares MSCI Saudi Arabia", angle: "걸프·원유" },
  { symbol: "EEM", name: "Emerging Markets", angle: "에너지 수입 EM" },
  { symbol: "BDRY", name: "Breakwave Dry Bulk", angle: "해상 운임·우회" },
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
  hormuz?: GeoHormuzCrisis | null,
): GeoPayload["composite"] {
  const byId = Object.fromEntries(signals.map((s) => [s.id, s]));
  const drivers: string[] = [];
  let score = 28; // baseline

  // Iran / Hormuz crisis bundle — primary live geo signal
  if (hormuz) {
    const closed =
      /closed|block/i.test(hormuz.verdict_status || "") ||
      /closed|봉쇄/i.test(hormuz.verdict_long || "") ||
      /restricted|disrupted/i.test(hormuz.status || "");
    if (/closed/i.test(hormuz.verdict_status || "")) {
      score += 28;
      drivers.push(
        `호르무즈 ${hormuz.verdict_short || "폐쇄"} — ${hormuz.verdict_long?.slice(0, 72) || "상업 통항 사실상 중단"}`,
      );
    } else if (closed) {
      score += 18;
      drivers.push(`호르무즈 상태: ${hormuz.status || hormuz.verdict_status}`);
    }

    if (hormuz.crisis_pressure != null) {
      if (hormuz.crisis_pressure >= 80) score += 14;
      else if (hormuz.crisis_pressure >= 60) score += 8;
      drivers.push(
        `Hormuz Index 위기압 ${hormuz.crisis_pressure}${hormuz.crisis_band ? ` (${hormuz.crisis_band})` : ""}`,
      );
    }

    if (
      hormuz.transit_throughput_pct != null &&
      hormuz.transit_throughput_pct < 40
    ) {
      score += 10;
      drivers.push(
        `통항 ${hormuz.transit_count ?? "—"}척 / 기준대비 ${hormuz.transit_throughput_pct}%`,
      );
    }

    if (hormuz.insurance_multiple != null && hormuz.insurance_multiple >= 4) {
      score += 8;
      drivers.push(`전쟁보험 배수 ×${hormuz.insurance_multiple}`);
    }
  }

  // Maritime chokepoints (Eagle)
  const severe = chokepoints.filter((c) =>
    /SEVERE|CRITICAL|HIGH/i.test(c.status),
  );
  const elevated = chokepoints.filter((c) => /ELEVATED|WATCH/i.test(c.status));
  for (const c of chokepoints) {
    score += CHOKE_STATUS_SCORE[c.status.toUpperCase()] ?? 0;
  }
  if (severe.length) {
    drivers.push(
      `해운 경보 ${severe.map((c) => c.name.replace(/ Strait| Canal/g, "")).join(", ")}: ${severe[0].status}`,
    );
  } else if (elevated.length) {
    drivers.push(
      `해운 경계: ${elevated.map((c) => c.name).slice(0, 2).join(", ")}`,
    );
  }

  const vix = byId.vix?.price;
  if (vix != null) {
    if (vix >= 25) {
      score += 14;
      drivers.push(`VIX ${vix.toFixed(1)} (높은 변동성)`);
    } else if (vix >= 18) {
      score += 8;
      drivers.push(`VIX ${vix.toFixed(1)} (경계)`);
    } else {
      drivers.push(`VIX ${vix.toFixed(1)} (안정권)`);
    }
  }

  const ovx = byId.ovx?.price;
  if (ovx != null) {
    if (ovx >= 45) {
      score += 12;
      drivers.push(`OVX ${ovx.toFixed(1)} (원유 변동성 급등)`);
    } else if (ovx >= 32) {
      score += 7;
      drivers.push(`OVX ${ovx.toFixed(1)} (원유 변동성 상승)`);
    }
  }

  const oil = byId.wti?.change_1d_pct;
  if (oil != null) {
    if (oil >= 2) {
      score += 10;
      drivers.push(`WTI 급등 ${oil.toFixed(1)}%`);
    } else if (oil <= -2) {
      score -= 6;
      drivers.push(`WTI 급락 ${oil.toFixed(1)}%`);
    }
  }

  const gold = byId.gold?.change_1d_pct;
  if (gold != null && gold >= 1) {
    score += 6;
    drivers.push(`금 강세 ${gold.toFixed(1)}%`);
  }

  const dxy = byId.dxy?.change_1d_pct ?? byId.usd?.change_1d_pct;
  if (dxy != null && dxy >= 0.35) {
    score += 5;
    drivers.push(`달러 강세 ${dxy.toFixed(1)}%`);
  }

  const tlt = byId.tlt?.change_1d_pct;
  const hyg = byId.hyg?.change_1d_pct;
  if (tlt != null && tlt >= 0.6 && hyg != null && hyg <= -0.4) {
    score += 6;
    drivers.push("채권 안전자산 선호 (TLT↑ / HYG↓)");
  }

  const ksa = byId.ksa?.change_1d_pct;
  if (ksa != null && ksa <= -1.5) {
    score += 6;
    drivers.push(`사우디 ETF 약세 ${ksa.toFixed(1)}%`);
  }

  const eem = byId.eem?.change_1d_pct;
  if (eem != null && eem <= -1.2) {
    score += 6;
    drivers.push(`EEM 약세 ${eem.toFixed(1)}%`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let label = "중립";
  if (score >= 70) label = "이란·호르무즈 리스크 높음";
  else if (score >= 55) label = "경계";
  else if (score <= 25) label = "안정·리스크온 편향";

  return { score, label, drivers: drivers.slice(0, 7) };
}
