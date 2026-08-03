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
  methodology: string[];
  risk: RiskRegime;
  summary: string[];
  core: AssetSignal[];
  sectors: AssetSignal[];
  themes: AssetSignal[];
  crypto: CryptoPanel | null;
  error?: string;
};

export type CryptoIndicator = {
  id: string;
  label: string;
  value: number | null;
  display: string;
  unit?: string;
  note?: string;
  tone?: "up" | "down" | "flat";
};

export type CryptoPanel = {
  symbol: string;
  label: string;
  source_note: string;
  signal: AssetSignal | null;
  indicators: CryptoIndicator[];
  interpretations: string[];
  bias_note: string | null;
  as_of: string | null;
};

export const SIGNAL_SCHEDULE_NOTE =
  "일봉 룰 시그널 · Yahoo(주식/ETF) + OKX/CoinGecko(크립토) · 교육용 (투자 권유 아님)";

export const SIGNAL_DISCLAIMER =
  "본 시그널은 추세·모멘텀·상대강도·변동성·매크로 오버레이에 따른 기계적 규칙입니다. 투자 자문·매매 권유가 아니며, 손실 가능성을 배제하지 않습니다.";

export const SIGNAL_METHODOLOGY: string[] = [
  "점수 0–100 → Buy(≥65) / Hold(35–64) / Sell(≤34)",
  "추세 30%: 종가 vs SMA20·SMA50",
  "모멘텀 25%: 5D·20D 수익률",
  "상대강도 20%: vs SPY 20D excess (섹터·테마·QQQ)",
  "변동성 15%: 20D 실현 vol 페널티",
  "매크로 10%: VIX·HY OAS (금속은 스트레스 시 가점, 위험자산은 감점)",
];

export const CORE_SPECS: SignalAssetSpec[] = [
  { id: "spy", symbol: "SPY", label: "S&P 500", group: "core" },
  { id: "qqq", symbol: "QQQ", label: "Nasdaq 100", group: "core" },
  { id: "gld", symbol: "GLD", label: "Gold", group: "metal" },
  { id: "slv", symbol: "SLV", label: "Silver", group: "metal" },
];

export const CRYPTO_PERP_SPEC: SignalAssetSpec = {
  id: "btcusdt_p",
  symbol: "BTCUSDT.P",
  label: "BTCUSDT Perpetual",
  group: "crypto",
};

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
  crypto?: AssetSignal | null;
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
  if (input.crypto) {
    lines.push(
      `${input.crypto.symbol} ${input.crypto.signal_ko} (${input.crypto.score})${input.crypto.drivers[0] ? ` · ${input.crypto.drivers[0]}` : ""}`,
    );
  }
  return lines.slice(0, 9);
}

export function fmtCryptoNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function indValue(
  indicators: CryptoIndicator[],
  id: string,
): number | null {
  const hit = indicators.find((i) => i.id === id);
  return hit?.value ?? null;
}

/**
 * Rule-based plain-language read of current crypto dashboard values.
 * Heuristic thresholds for daily monitoring — not predictive.
 */
export function interpretCryptoPanel(input: {
  signal: AssetSignal | null;
  indicators: CryptoIndicator[];
}): { interpretations: string[]; bias_note: string | null } {
  const { signal, indicators } = input;
  const lines: string[] = [];

  const usdtDom = indValue(indicators, "usdt_dom");
  const btcDom = indValue(indicators, "btc_dom");
  const ls = indValue(indicators, "ls_ratio");
  const fundingPct = indValue(indicators, "funding"); // already *100 in API
  const oi = indValue(indicators, "oi");
  const bnOi = indValue(indicators, "bn_oi");
  const liquidity = indValue(indicators, "liquidity");
  const book = indValue(indicators, "book");
  const taker = indValue(indicators, "taker");
  const volBtc = indValue(indicators, "vol24");

  // Positioning / crowding
  if (ls != null) {
    const longPct = (ls / (1 + ls)) * 100;
    if (ls >= 2.2) {
      lines.push(
        `개인·계정 L/S ${ls.toFixed(2)} (롱 약 ${longPct.toFixed(0)}%) — 롱 포지션이 과밀합니다. 되돌림·청산 캐스케이드에 취약합니다.`,
      );
    } else if (ls >= 1.7) {
      lines.push(
        `L/S ${ls.toFixed(2)} (롱 약 ${longPct.toFixed(0)}%) — 롱 편향이 뚜렷합니다. 추세 추종은 가능하나 과열 구간으로 봅니다.`,
      );
    } else if (ls <= 0.85) {
      lines.push(
        `L/S ${ls.toFixed(2)} (롱 약 ${longPct.toFixed(0)}%) — 숏이 우세합니다. 숏 스퀴즈 여지를 같이 봅니다.`,
      );
    } else {
      lines.push(
        `L/S ${ls.toFixed(2)} (롱 약 ${longPct.toFixed(0)}%) — 계정 포지션은 비교적 균형에 가깝습니다.`,
      );
    }
  }

  if (fundingPct != null) {
    if (fundingPct >= 0.05) {
      lines.push(
        `펀딩 ${fundingPct.toFixed(4)}% — 롱이 숏에게 높은 비용을 지불 중(롱 과열). 추세가 꺾이면 청산 압력이 커질 수 있습니다.`,
      );
    } else if (fundingPct >= 0.01) {
      lines.push(
        `펀딩 ${fundingPct.toFixed(4)}% — 소폭 롱 프리미엄. 과열은 아니나 롱 쪽이 비용을 부담하는 상태입니다.`,
      );
    } else if (fundingPct <= -0.01) {
      lines.push(
        `펀딩 ${fundingPct.toFixed(4)}% — 음수(숏이 비용 부담). 약세 포지션이 우세하거나 현물 대비 할인 구간일 수 있습니다.`,
      );
    } else {
      lines.push(
        `펀딩 ${fundingPct.toFixed(4)}% — 중립 부근. 포지션 비용 측면의 왜곡은 크지 않습니다.`,
      );
    }
  }

  // OI / liquidity
  if (oi != null || bnOi != null) {
    const oiRef = bnOi ?? oi;
    const label = bnOi != null ? "Binance BTCUSDT OI" : "OKX 퍼프 OI";
    if (oiRef != null) {
      if (oiRef >= 8e9) {
        lines.push(
          `${label} ${fmtUsd(oiRef)} — 미결제약정이 높은 편입니다. 레버리지가 두꺼워 변동성 확대 시 청산 규모가 커질 수 있습니다.`,
        );
      } else if (oiRef >= 4e9) {
        lines.push(
          `${label} ${fmtUsd(oiRef)} — OI는 중간~높은 수준. 추세와 방향이 맞으면 모멘텀, 어긋나면 청산 파동을 같이 봅니다.`,
        );
      } else {
        lines.push(
          `${label} ${fmtUsd(oiRef)} — OI는 상대적으로 낮은 편. 레버리지 과열 신호는 약합니다.`,
        );
      }
    }
  }

  if (usdtDom != null) {
    if (usdtDom >= 8.5) {
      lines.push(
        `USDT.D ${usdtDom.toFixed(2)}% — 테더 비중이 높습니다. 대기 자금·위험회피 성격이 강하고, 리스크온 전환 전 “현금 파킹” 구간일 수 있습니다.`,
      );
    } else if (usdtDom <= 5.5) {
      lines.push(
        `USDT.D ${usdtDom.toFixed(2)}% — 테더 비중이 낮습니다. 자금이 리스크 자산으로 이미 이동한 상태일 수 있습니다.`,
      );
    } else {
      lines.push(
        `USDT.D ${usdtDom.toFixed(2)}% — 스테이블 비중은 중간 수준입니다.`,
      );
    }
  }

  if (btcDom != null) {
    if (btcDom >= 55) {
      lines.push(
        `BTC.D ${btcDom.toFixed(1)}% — 비트코인 도미넌스가 높습니다. 알트 대비 BTC 편중·안전자산 성격이 강한 구간입니다.`,
      );
    } else if (btcDom <= 45) {
      lines.push(
        `BTC.D ${btcDom.toFixed(1)}% — 도미넌스가 낮습니다. 알트 시즌/리스크온 확산 가능성을 시사할 수 있습니다.`,
      );
    }
  }

  if (liquidity != null) {
    if (liquidity >= 3.5) {
      lines.push(
        `Crypto Liquidity(Vol/Mcap) ${liquidity.toFixed(2)}% — 거래 활발. 유동성은 충분하나 변동성·회전율도 높은 편입니다.`,
      );
    } else if (liquidity <= 1.5) {
      lines.push(
        `Crypto Liquidity ${liquidity.toFixed(2)}% — 회전율이 낮습니다. 스프레드·미끄러짐에 유의할 얇은 유동성 구간일 수 있습니다.`,
      );
    }
  }

  if (book != null) {
    if (book >= 15) {
      lines.push(
        `호가 불균형 +${book.toFixed(1)}% — 단기 매수벽(bid)이 두껍습니다. 지지 시도 가능성은 있으나 스푸핑일 수도 있습니다.`,
      );
    } else if (book <= -15) {
      lines.push(
        `호가 불균형 ${book.toFixed(1)}% — 매도벽(ask)이 두껍습니다. 상방 저항·단기 약세 압력으로 읽을 수 있습니다.`,
      );
    }
  }

  if (taker != null) {
    if (taker >= 12) {
      lines.push(
        `Taker 매수 우세 +${taker.toFixed(1)}% — 공격적 매수가 우세합니다(시장가 매수 압력).`,
      );
    } else if (taker <= -12) {
      lines.push(
        `Taker 매도 우세 ${taker.toFixed(1)}% — 공격적 매도가 우세합니다(시장가 매도 압력).`,
      );
    }
  }

  if (volBtc != null && volBtc >= 80_000) {
    lines.push(
      `퍼프 24h 거래량 ${volBtc.toFixed(0)} BTC — 회전이 큽니다. 뉴스·청산 이벤트와 겹치면 스파이크가 나오기 쉽습니다.`,
    );
  }

  // Combine with price signal
  let bias_note: string | null = null;
  if (signal) {
    const crowdedLong =
      (ls != null && ls >= 1.8) || (fundingPct != null && fundingPct >= 0.02);
    const crowdedShort =
      (ls != null && ls <= 0.9) || (fundingPct != null && fundingPct <= -0.01);

    if (signal.signal === "buy" && crowdedLong) {
      bias_note =
        `가격 룰은 ${signal.signal_ko}(${signal.score})이지만, 롱 과밀·펀딩 부담이 있어 “추격 매수”보다 눌림/분할이 더 안전한 해석입니다.`;
    } else if (signal.signal === "sell" && crowdedShort) {
      bias_note =
        `가격 룰은 ${signal.signal_ko}(${signal.score})이지만, 숏 우세·음수 펀딩이라 숏 스퀴즈 반등 여지를 같이 봅니다.`;
    } else if (signal.signal === "buy") {
      bias_note = `가격 룰 ${signal.signal_ko}(${signal.score}) · 포지션 과열 신호가 크지 않으면 추세 추종 편향으로 읽습니다.`;
    } else if (signal.signal === "sell") {
      bias_note = `가격 룰 ${signal.signal_ko}(${signal.score}) · 모멘텀 약화/추세 이탈 쪽으로 해석합니다.`;
    } else {
      bias_note = `가격 룰 ${signal.signal_ko}(${signal.score}) · 방향성보다 레벨·과열 지표(L/S·펀딩·OI)를 우선 확인하는 구간입니다.`;
    }
  }

  if (!lines.length) {
    lines.push("해석에 필요한 일부 지표가 비어 있습니다. 잠시 후 새로고침해 주세요.");
  }

  return { interpretations: lines.slice(0, 8), bias_note };
}

function fmtUsd(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}
