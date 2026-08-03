/**
 * Rule-based trading signals for SPY/QQQ, sectors, themes, metals, crypto.
 * Buy / Hold / Sell from trend · momentum · RS vs SPY · vol · macro overlay.
 */

export type SignalAction = "buy" | "hold" | "sell";

export type SignalGroup = "core" | "sector" | "theme" | "metal" | "crypto";

export type SignalPoint = { date: string; value: number };

export type SignalAssetSpec = {
  id: string;
  symbol: string;
  label: string;
  group: SignalGroup;
};

export type AssetSignal = {
  id: string;
  symbol: string;
  label: string;
  group: SignalGroup;
  price: number | null;
  change_1d_pct: number | null;
  change_5d_pct: number | null;
  change_20d_pct: number | null;
  excess_20d_vs_spy: number | null;
  sma20: number | null;
  sma50: number | null;
  realized_vol_20d: number | null;
  score: number;
  signal: SignalAction;
  signal_ko: string;
  drivers: string[];
  error?: string;
};

export type RiskRegime = {
  score: number;
  regime: string;
  regime_ko: string;
  drivers: string[];
  vix: number | null;
  hy_oas: number | null;
  spy_20d_pct: number | null;
  breadth_above_sma20: number | null;
};

export type TradingSignalsPayload = {
  ok: boolean;
  generated_at: string;
  as_of: string | null;
  note: string;
  schedule_note: string;
  disclaimer: string;
  risk: RiskRegime;
  summary: string[];
  core: AssetSignal[];
  sectors: AssetSignal[];
  themes: AssetSignal[];
  error?: string;
};

export const SIGNAL_SCHEDULE_NOTE =
  "일봉 룰 시그널 · Yahoo 종가 기준 · 교육용 (투자 권유 아님)";

export const SIGNAL_DISCLAIMER =
  "본 시그널은 추세·모멘텀·상대강도·변동성·매크로 오버레이에 따른 기계적 규칙입니다. 투자 자문·매매 권유가 아니며, 손실 가능성을 배제하지 않습니다.";

export const CORE_SPECS: SignalAssetSpec[] = [
  { id: "spy", symbol: "SPY", label: "S&P 500", group: "core" },
  { id: "qqq", symbol: "QQQ", label: "Nasdaq 100", group: "core" },
  { id: "gld", symbol: "GLD", label: "Gold", group: "metal" },
  { id: "slv", symbol: "SLV", label: "Silver", group: "metal" },
  { id: "bito", symbol: "BITO", label: "Bitcoin (BITO)", group: "crypto" },
];

export const SECTOR_SPECS: SignalAssetSpec[] = [
  { id: "xlc", symbol: "XLC", label: "Communication", group: "sector" },
  { id: "xly", symbol: "XLY", label: "Consumer Disc.", group: "sector" },
  { id: "xlp", symbol: "XLP", label: "Consumer Staples", group: "sector" },
  { id: "xle", symbol: "XLE", label: "Energy", group: "sector" },
  { id: "xlf", symbol: "XLF", label: "Financials", group: "sector" },
  { id: "xlv", symbol: "XLV", label: "Health Care", group: "sector" },
  { id: "xli", symbol: "XLI", label: "Industrials", group: "sector" },
  { id: "xlk", symbol: "XLK", label: "Technology", group: "sector" },
  { id: "xlb", symbol: "XLB", label: "Materials", group: "sector" },
  { id: "xlre", symbol: "XLRE", label: "Real Estate", group: "sector" },
  { id: "xlu", symbol: "XLU", label: "Utilities", group: "sector" },
];

export const THEME_SPECS: SignalAssetSpec[] = [
  { id: "smh", symbol: "SMH", label: "Semiconductors", group: "theme" },
  { id: "soxx", symbol: "SOXX", label: "Semis (iShares)", group: "theme" },
  { id: "xbi", symbol: "XBI", label: "Biotech", group: "theme" },
  { id: "arkk", symbol: "ARKK", label: "ARK Innovation", group: "theme" },
  { id: "hack", symbol: "HACK", label: "Cybersecurity", group: "theme" },
  { id: "botz", symbol: "BOTZ", label: "Robotics / AI", group: "theme" },
  { id: "igv", symbol: "IGV", label: "Software", group: "theme" },
];

export const ALL_SIGNAL_SPECS: SignalAssetSpec[] = [
  ...CORE_SPECS,
  ...SECTOR_SPECS,
  ...THEME_SPECS,
];

function clip(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function lastValue(series: SignalPoint[]): number | null {
  if (!series.length) return null;
  return series[series.length - 1]!.value;
}

export function pctChange(series: SignalPoint[], days: number): number | null {
  if (series.length <= days) return null;
  const start = series[series.length - days - 1]?.value;
  const end = series[series.length - 1]?.value;
  if (start == null || end == null || start === 0) return null;
  return ((end / start - 1) * 100);
}

export function sma(series: SignalPoint[], window: number): number | null {
  if (series.length < window) return null;
  const slice = series.slice(-window);
  const sum = slice.reduce((s, p) => s + p.value, 0);
  return sum / window;
}

export function realizedVol(series: SignalPoint[], window = 20): number | null {
  if (series.length < window + 1) return null;
  const slice = series.slice(-(window + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const a = slice[i - 1]!.value;
    const b = slice[i]!.value;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const varSum = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length;
  return Math.sqrt(varSum) * Math.sqrt(252) * 100;
}

function actionFromScore(score: number): {
  signal: SignalAction;
  signal_ko: string;
} {
  if (score >= 65) return { signal: "buy", signal_ko: "매수 편향" };
  if (score <= 34) return { signal: "sell", signal_ko: "매도 편향" };
  return { signal: "hold", signal_ko: "관망" };
}

function regimeFromScore(score: number): { regime: string; regime_ko: string } {
  if (score >= 75) return { regime: "High Stress", regime_ko: "고스트레스" };
  if (score >= 55) return { regime: "Elevated", regime_ko: "경계" };
  if (score >= 35) return { regime: "Caution", regime_ko: "주의" };
  return { regime: "Calm", regime_ko: "안정" };
}

type MacroOverlay = {
  vix: number | null;
  hyOas: number | null;
};

/**
 * Score 0–100 bullish bias.
 * Weights: trend 30 · momentum 25 · RS 20 · vol 15 · macro 10
 */
export function scoreAsset(input: {
  series: SignalPoint[];
  spy20d: number | null;
  group: SignalGroup;
  macro: MacroOverlay;
}): { score: number; drivers: string[]; metrics: {
  price: number | null;
  change_1d_pct: number | null;
  change_5d_pct: number | null;
  change_20d_pct: number | null;
  excess_20d_vs_spy: number | null;
  sma20: number | null;
  sma50: number | null;
  realized_vol_20d: number | null;
} } {
  const { series, spy20d, group, macro } = input;
  const drivers: string[] = [];
  const price = lastValue(series);
  const change_1d_pct = pctChange(series, 1);
  const change_5d_pct = pctChange(series, 5);
  const change_20d_pct = pctChange(series, 20);
  const sma20 = sma(series, 20);
  const sma50 = sma(series, 50);
  const vol = realizedVol(series, 20);
  const excess_20d_vs_spy =
    change_20d_pct != null && spy20d != null
      ? change_20d_pct - spy20d
      : null;

  // Trend: price vs SMA20/50
  let trend = 50;
  if (price != null && sma20 != null) {
    const vs20 = ((price / sma20 - 1) * 100);
    if (vs20 >= 2) {
      trend = 78;
      drivers.push(`SMA20 상단 (+${vs20.toFixed(1)}%)`);
    } else if (vs20 >= 0) {
      trend = 62;
    } else if (vs20 >= -2) {
      trend = 42;
    } else {
      trend = 22;
      drivers.push(`SMA20 하단 (${vs20.toFixed(1)}%)`);
    }
  }
  if (price != null && sma50 != null) {
    if (price >= sma50 && trend < 70) trend = Math.min(100, trend + 8);
    if (price < sma50 && trend > 40) trend = Math.max(0, trend - 8);
  }

  // Momentum: 5d + 20d
  let momentum = 50;
  if (change_5d_pct != null && change_20d_pct != null) {
    const blend = change_5d_pct * 0.4 + change_20d_pct * 0.6;
    if (blend >= 6) {
      momentum = 88;
      drivers.push(`모멘텀 강함 (20D ${change_20d_pct.toFixed(1)}%)`);
    } else if (blend >= 2) {
      momentum = 70;
    } else if (blend >= -1) {
      momentum = 52;
    } else if (blend >= -4) {
      momentum = 32;
    } else {
      momentum = 15;
      drivers.push(`모멘텀 약함 (20D ${change_20d_pct.toFixed(1)}%)`);
    }
  } else if (change_20d_pct != null) {
    momentum = clip(50 + change_20d_pct * 4);
  }

  // Relative strength vs SPY (skip for SPY itself; metals/crypto still use excess as context)
  let rs = 50;
  if (group !== "core" || excess_20d_vs_spy != null) {
    if (excess_20d_vs_spy != null) {
      if (excess_20d_vs_spy >= 4) {
        rs = 85;
        drivers.push(`SPY 대비 우위 (+${excess_20d_vs_spy.toFixed(1)}pp)`);
      } else if (excess_20d_vs_spy >= 1) {
        rs = 68;
      } else if (excess_20d_vs_spy >= -1) {
        rs = 50;
      } else if (excess_20d_vs_spy >= -4) {
        rs = 32;
      } else {
        rs = 15;
        drivers.push(`SPY 대비 열위 (${excess_20d_vs_spy.toFixed(1)}pp)`);
      }
    }
  }
  // For SPY itself, RS component mirrors own 20d momentum lightly
  if (group === "core" && excess_20d_vs_spy == null && change_20d_pct != null) {
    rs = clip(50 + change_20d_pct * 3);
  }

  // Vol penalty
  let volScore = 55;
  if (vol != null) {
    if (vol >= 40) {
      volScore = 15;
      drivers.push(`실현 vol 높음 (${vol.toFixed(0)}%)`);
    } else if (vol >= 28) {
      volScore = 30;
    } else if (vol >= 18) {
      volScore = 48;
    } else {
      volScore = 72;
    }
  }

  // Macro overlay — risk-on assets hurt by stress; gold helped slightly
  let macroScore = 50;
  const { vix, hyOas } = macro;
  let stressBump = 0;
  if (vix != null) {
    if (vix >= 28) stressBump += 25;
    else if (vix >= 22) stressBump += 12;
    else if (vix < 15) stressBump -= 8;
  }
  if (hyOas != null) {
    if (hyOas >= 5) stressBump += 15;
    else if (hyOas >= 4) stressBump += 8;
  }
  if (group === "metal") {
    macroScore = clip(50 + stressBump * 0.6);
    if (stressBump >= 15) drivers.push("매크로 스트레스 → 금·은 편향");
  } else if (group === "crypto") {
    macroScore = clip(50 - stressBump);
    if (stressBump >= 15) drivers.push("매크로 스트레스 → 크립토 페널티");
  } else {
    macroScore = clip(50 - stressBump);
    if (stressBump >= 20) drivers.push("VIX/신용 스트레스 오버레이");
  }

  const usesRs = group === "sector" || group === "theme" || group === "core";
  const score = Math.round(
    usesRs
      ? trend * 0.3 +
          momentum * 0.25 +
          rs * 0.2 +
          volScore * 0.15 +
          macroScore * 0.1
      : trend * 0.35 +
          momentum * 0.3 +
          volScore * 0.2 +
          macroScore * 0.15,
  );

  return {
    score: clip(score),
    drivers: drivers.slice(0, 3),
    metrics: {
      price,
      change_1d_pct,
      change_5d_pct,
      change_20d_pct,
      excess_20d_vs_spy,
      sma20,
      sma50,
      realized_vol_20d: vol,
    },
  };
}

export function buildAssetSignal(
  spec: SignalAssetSpec,
  series: SignalPoint[],
  spy20d: number | null,
  macro: MacroOverlay,
): AssetSignal {
  if (!series.length) {
    return {
      id: spec.id,
      symbol: spec.symbol,
      label: spec.label,
      group: spec.group,
      price: null,
      change_1d_pct: null,
      change_5d_pct: null,
      change_20d_pct: null,
      excess_20d_vs_spy: null,
      sma20: null,
      sma50: null,
      realized_vol_20d: null,
      score: 50,
      signal: "hold",
      signal_ko: "관망",
      drivers: ["데이터 없음"],
      error: "no series",
    };
  }
  const scored = scoreAsset({
    series,
    spy20d: spec.symbol === "SPY" ? null : spy20d,
    group: spec.group,
    macro,
  });
  const { signal, signal_ko } = actionFromScore(scored.score);
  return {
    id: spec.id,
    symbol: spec.symbol,
    label: spec.label,
    group: spec.group,
    ...scored.metrics,
    score: scored.score,
    signal,
    signal_ko,
    drivers: scored.drivers.length
      ? scored.drivers
      : ["뚜렷한 단일 드라이버 없음"],
  };
}

export function buildRiskRegime(input: {
  vix: number | null;
  hyOas: number | null;
  spy20d: number | null;
  sectorSignals: AssetSignal[];
}): RiskRegime {
  const drivers: string[] = [];
  let score = 35;
  const { vix, hyOas, spy20d, sectorSignals } = input;

  if (vix != null) {
    if (vix >= 35) {
      score = Math.max(score, 92);
      drivers.push(`VIX ${vix.toFixed(1)} (위기)`);
    } else if (vix >= 28) {
      score = Math.max(score, 75);
      drivers.push(`VIX ${vix.toFixed(1)}`);
    } else if (vix >= 22) {
      score = Math.max(score, 55);
      drivers.push(`VIX ${vix.toFixed(1)} (경계)`);
    } else if (vix < 15) {
      score = Math.min(score, 22);
    }
  }
  if (hyOas != null) {
    if (hyOas >= 5) {
      score = Math.max(score, 78);
      drivers.push(`HY OAS ${hyOas.toFixed(2)}%`);
    } else if (hyOas >= 4) {
      score = Math.max(score, 58);
    }
  }
  if (spy20d != null) {
    if (spy20d <= -8) {
      score = Math.max(score, 85);
      drivers.push(`SPY 20D ${spy20d.toFixed(1)}%`);
    } else if (spy20d <= -4) {
      score = Math.max(score, 62);
    } else if (spy20d >= 6) {
      score = Math.min(score, 28);
    }
  }

  const withSma = sectorSignals.filter((s) => s.price != null && s.sma20 != null);
  const above = withSma.filter(
    (s) => s.price != null && s.sma20 != null && s.price >= s.sma20,
  ).length;
  const breadth =
    withSma.length > 0 ? Math.round((above / withSma.length) * 100) : null;
  if (breadth != null) {
    if (breadth <= 30) {
      score = Math.max(score, 70);
      drivers.push(`섹터 SMA20 상회 ${breadth}% (좁은 참여)`);
    } else if (breadth >= 70) {
      score = Math.min(score, 35);
      drivers.push(`섹터 SMA20 상회 ${breadth}%`);
    }
  }

  const { regime, regime_ko } = regimeFromScore(score);
  return {
    score: clip(score),
    regime,
    regime_ko,
    drivers: drivers.length ? drivers.slice(0, 4) : ["뚜렷한 스트레스 시그널 없음"],
    vix,
    hy_oas: hyOas,
    spy_20d_pct: spy20d,
    breadth_above_sma20: breadth,
  };
}

export function buildSummary(input: {
  risk: RiskRegime;
  core: AssetSignal[];
  sectors: AssetSignal[];
  themes: AssetSignal[];
}): string[] {
  const lines: string[] = [];
  lines.push(
    `Risk regime ${input.risk.regime_ko} (${input.risk.score})`,
  );
  const leaders = [...input.sectors]
    .filter((s) => s.excess_20d_vs_spy != null)
    .sort(
      (a, b) => (b.excess_20d_vs_spy ?? -999) - (a.excess_20d_vs_spy ?? -999),
    )
    .slice(0, 2);
  const laggards = [...input.sectors]
    .filter((s) => s.excess_20d_vs_spy != null)
    .sort(
      (a, b) => (a.excess_20d_vs_spy ?? 999) - (b.excess_20d_vs_spy ?? 999),
    )
    .slice(0, 2);
  if (leaders.length) {
    lines.push(
      `섹터 리더 ${leaders.map((s) => s.symbol).join("/")} · 래가드 ${laggards.map((s) => s.symbol).join("/")}`,
    );
  }
  const themeLead = [...input.themes]
    .filter((s) => s.excess_20d_vs_spy != null)
    .sort(
      (a, b) => (b.excess_20d_vs_spy ?? -999) - (a.excess_20d_vs_spy ?? -999),
    )[0];
  if (themeLead) {
    lines.push(
      `테마 모멘텀 ${themeLead.symbol} (${themeLead.signal_ko}, excess ${(themeLead.excess_20d_vs_spy ?? 0).toFixed(1)}pp)`,
    );
  }
  for (const a of input.core) {
    lines.push(
      `${a.symbol} ${a.signal_ko} (${a.score})${a.drivers[0] ? ` · ${a.drivers[0]}` : ""}`,
    );
  }
  return lines.slice(0, 8);
}
