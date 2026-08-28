/**
 * Dealer gamma exposure (GEX) from listed index/ETF option chains.
 *
 * GEX_i = sign × Γ × OI × multiplier × S² × 0.01
 *   sign: +1 call / −1 put (dealers modeled long calls, short puts)
 *   output: dollars of dealer delta hedge per 1% spot move
 *
 * Current-spot GEX uses the exchange's published gamma. The zero-gamma
 * (flip) level recomputes Black-Scholes gamma across a spot grid.
 */

export type GammaMarketId = "spx" | "spy" | "ndx" | "qqq";

export type GammaFamily = "spx" | "ndx";

export type GammaRegime = "long" | "short" | "mixed";

export type GammaStrikeBar = {
  strike: number;
  gex: number;
  call_gex: number;
  put_gex: number;
  call_oi: number;
  put_oi: number;
  near_spot?: boolean;
  call_wall?: boolean;
  put_wall?: boolean;
};

export type GammaDteBucket = {
  id: "0_1" | "2_7" | "8_30" | "31p";
  label: string;
  gex: number;
  call_gex: number;
  put_gex: number;
  contracts: number;
};

export type GammaCurvePoint = {
  spot: number;
  gex: number;
};

export type GammaTopStrike = {
  strike: number;
  gex: number;
  call_gex: number;
  put_gex: number;
  call_oi: number;
  put_oi: number;
};

export type GammaMarketMeta = {
  id: GammaMarketId;
  family: GammaFamily;
  label: string;
  label_ko: string;
  product: string;
  symbol: string;
  venue: string;
  cboe_path: string;
  multiplier: number;
  div_yield: number;
  strike_step: number;
};

export type GammaSnapshot = {
  id: GammaMarketId;
  label: string;
  label_ko: string;
  product: string;
  symbol: string;
  venue: string;
  spot: number;
  change_pct: number | null;
  iv30: number | null;
  net_gex: number;
  call_gex: number;
  put_gex: number;
  near_gex: number;
  zero_dte_gex: number;
  call_oi: number;
  put_oi: number;
  put_call_oi: number | null;
  contracts_used: number;
  contracts_raw: number;
  call_wall: number | null;
  put_wall: number | null;
  flip: number | null;
  regime: GammaRegime;
  regime_ko: string;
  regime_en: string;
  drivers: string[];
  strikes: GammaStrikeBar[];
  dte_buckets: GammaDteBucket[];
  curve: GammaCurvePoint[];
  top_strikes: GammaTopStrike[];
  as_of: string | null;
};

export type GammaPayload = {
  ok: boolean;
  generated_at: string;
  note: string;
  market: GammaSnapshot | null;
  catalog: GammaMarketMeta[];
  error?: string;
};

export const GAMMA_CATALOG: GammaMarketMeta[] = [
  {
    id: "spx",
    family: "spx",
    label: "S&P 500",
    label_ko: "S&P 500",
    product: "SPX / SPXW 지수옵션",
    symbol: "^SPX",
    venue: "CBOE",
    cboe_path: "_SPX",
    multiplier: 100,
    div_yield: 0.013,
    strike_step: 25,
  },
  {
    id: "spy",
    family: "spx",
    label: "SPY",
    label_ko: "S&P ETF",
    product: "SPY ETF 옵션 · 0DTE 유동성",
    symbol: "SPY",
    venue: "CBOE",
    cboe_path: "SPY",
    multiplier: 100,
    div_yield: 0.013,
    strike_step: 1,
  },
  {
    id: "ndx",
    family: "ndx",
    label: "Nasdaq 100",
    label_ko: "Nasdaq 100",
    product: "NDX / NDXP 지수옵션",
    symbol: "^NDX",
    venue: "CBOE",
    cboe_path: "_NDX",
    multiplier: 100,
    div_yield: 0.007,
    strike_step: 50,
  },
  {
    id: "qqq",
    family: "ndx",
    label: "QQQ",
    label_ko: "나스닥 ETF",
    product: "QQQ ETF 옵션 · 0DTE 유동성",
    symbol: "QQQ",
    venue: "CBOE",
    cboe_path: "QQQ",
    multiplier: 100,
    div_yield: 0.006,
    strike_step: 1,
  },
];

export const GAMMA_FAMILIES: Array<{
  id: GammaFamily;
  label: string;
  ids: GammaMarketId[];
}> = [
  { id: "spx", label: "S&P 500", ids: ["spx", "spy"] },
  { id: "ndx", label: "Nasdaq 100", ids: ["ndx", "qqq"] },
];

export const GAMMA_RATE = 0.043;
const OCC_RE = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
const INV_SQRT_2PI = 0.3989422804014327;
const BAND = 0.1;
const CURVE_BAND = 0.08;
const CURVE_STEPS = 31;
const MAX_STRIKE_BARS = 72;
const MAX_SCAN_CONTRACTS = 9000;

export type CboeOptionRow = {
  option?: string;
  gamma?: number | null;
  open_interest?: number | null;
  volume?: number | null;
  iv?: number | null;
  delta?: number | null;
};

export type CboeChain = {
  timestamp?: string | number;
  data?: {
    options?: CboeOptionRow[];
    symbol?: string;
    current_price?: number;
    price_change_percent?: number;
    iv30?: number;
    last_trade_time?: string | null;
  };
};

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) * INV_SQRT_2PI;
}

export function blackScholesGamma(
  spot: number,
  strike: number,
  years: number,
  iv: number,
  rate: number,
  divYield: number,
): number {
  if (!(spot > 0) || !(strike > 0) || !(iv > 0) || !(years > 0)) return 0;
  const sigmaT = iv * Math.sqrt(years);
  if (!(sigmaT > 0)) return 0;
  const d1 =
    (Math.log(spot / strike) + (rate - divYield + 0.5 * iv * iv) * years) /
    sigmaT;
  return (Math.exp(-divYield * years) * normPdf(d1)) / (spot * sigmaT);
}

export function parseGammaMarket(value: string | null | undefined): GammaMarketId {
  if (value === "spx" || value === "spy" || value === "ndx" || value === "qqq") {
    return value;
  }
  return "spx";
}

export function catalogById(id: GammaMarketId): GammaMarketMeta {
  return GAMMA_CATALOG.find((m) => m.id === id) || GAMMA_CATALOG[0]!;
}

type OccParsed = {
  root: string;
  expiry: string;
  call: boolean;
  strike: number;
};

export function parseOccSymbol(symbol: string): OccParsed | null {
  const m = OCC_RE.exec(symbol.trim().toUpperCase());
  if (!m) return null;
  const yy = Number(m[2]);
  const mm = Number(m[3]);
  const dd = Number(m[4]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return {
    root: m[1]!,
    expiry: `20${String(yy).padStart(2, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
    call: m[5] === "C",
    strike: Number(m[6]) / 1000,
  };
}

function nyParts(now: Date): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function calendarDays(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.round((tb - ta) / 86_400_000);
}

export function dteDays(expiry: string, now: Date): number {
  return calendarDays(nyParts(now).date, expiry);
}

export function yearsToExpiry(expiry: string, now: Date): number {
  const ny = nyParts(now);
  const days = calendarDays(ny.date, expiry);
  if (days < 0) return 0;
  const minutesToClose = 16 * 60 - (ny.hour * 60 + ny.minute);
  if (days === 0) {
    return Math.max(minutesToClose, 45) / (365.25 * 24 * 60);
  }
  const frac = Math.max(minutesToClose, 0) / (24 * 60);
  return (days + frac) / 365.25;
}

export function dollarGex(
  gamma: number,
  openInterest: number,
  spot: number,
  sign: number,
  multiplier: number,
): number {
  return sign * gamma * openInterest * multiplier * spot * spot * 0.01;
}

function roundTo(value: number, step: number): number {
  if (!(step > 0)) return value;
  return Math.round(value / step) * step;
}

function bucketStrikes(
  exact: Map<number, StrikeAgg>,
  preferred: number,
  spot: number,
): Map<number, StrikeAgg> {
  let step = preferred;
  const fold = (s: number) => {
    const out = new Map<number, StrikeAgg>();
    for (const [strike, agg] of exact) {
      const key = roundTo(strike, s);
      let row = out.get(key);
      if (!row) {
        row = emptyAgg();
        out.set(key, row);
      }
      row.gex += agg.gex;
      row.call_gex += agg.call_gex;
      row.put_gex += agg.put_gex;
      row.call_oi += agg.call_oi;
      row.put_oi += agg.put_oi;
    }
    return out;
  };
  let out = fold(step);
  while (out.size > MAX_STRIKE_BARS && step < spot / 4) {
    step *= 2;
    out = fold(step);
  }
  return out;
}

type StrikeAgg = {
  gex: number;
  call_gex: number;
  put_gex: number;
  call_oi: number;
  put_oi: number;
};

function emptyAgg(): StrikeAgg {
  return { gex: 0, call_gex: 0, put_gex: 0, call_oi: 0, put_oi: 0 };
}

function addAgg(
  map: Map<number, StrikeAgg>,
  strike: number,
  gex: number,
  call: boolean,
  oi: number,
) {
  let row = map.get(strike);
  if (!row) {
    row = emptyAgg();
    map.set(strike, row);
  }
  row.gex += gex;
  if (call) {
    row.call_gex += gex;
    row.call_oi += oi;
  } else {
    row.put_gex += gex;
    row.put_oi += oi;
  }
}

function interpolateZero(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number | null {
  if (y0 === 0) return x0;
  if (y1 === 0) return x1;
  if ((y0 < 0 && y1 < 0) || (y0 > 0 && y1 > 0)) return null;
  const t = -y0 / (y1 - y0);
  if (!Number.isFinite(t)) return null;
  return x0 + t * (x1 - x0);
}

function regimeOf(netGex: number, spot: number, flip: number | null): {
  regime: GammaRegime;
  regime_ko: string;
  regime_en: string;
} {
  const belowFlip = flip != null && spot < flip;
  if (netGex <= -2e8 || (belowFlip && netGex < 0)) {
    return {
      regime: "short",
      regime_ko: "숏 감마",
      regime_en: "Short gamma",
    };
  }
  if (netGex >= 2e8 && !belowFlip) {
    return {
      regime: "long",
      regime_ko: "롱 감마",
      regime_en: "Long gamma",
    };
  }
  return {
    regime: "mixed",
    regime_ko: "혼합",
    regime_en: "Mixed",
  };
}

function fmtBn(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

function buildDrivers(input: {
  net: number;
  near: number;
  zeroDte: number;
  putCall: number | null;
  spot: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
}): string[] {
  const out: string[] = [];
  if (input.net >= 0) {
    out.push(
      `순 GEX ${fmtBn(input.net)} · 딜러가 롱 감마로 추정되어 되돌림 매매(하락 매수·상승 매도)가 우세합니다.`,
    );
  } else {
    out.push(
      `순 GEX ${fmtBn(input.net)} · 딜러가 숏 감마라 가격이 밀리면 헤지 매도가 매도를 부를 수 있습니다.`,
    );
  }
  if (input.flip != null) {
    const gap = ((input.spot - input.flip) / input.flip) * 100;
    out.push(
      gap >= 0
        ? `현재가 ${input.spot.toFixed(0)}가 제로감마(${input.flip.toFixed(0)}) 위 ${gap.toFixed(2)}%입니다.`
        : `현재가 ${input.spot.toFixed(0)}가 제로감마(${input.flip.toFixed(0)}) 아래 ${Math.abs(gap).toFixed(2)}%입니다.`,
    );
  }
  if (input.zeroDte !== 0) {
    out.push(`0–1일물 GEX ${fmtBn(input.zeroDte)} · 당일 헤지 플로우의 핵심 구간입니다.`);
  }
  if (input.putCall != null) {
    out.push(
      `풋/콜 미결제약정 비율 ${input.putCall.toFixed(2)}${
        input.putCall >= 1.3 ? " · 풋 OI가 상대적으로 두텁습니다." : "."
      }`,
    );
  }
  if (input.putWall != null && input.callWall != null) {
    out.push(
      `풋월 ${input.putWall.toLocaleString("en-US")} · 콜월 ${input.callWall.toLocaleString("en-US")}.`,
    );
  }
  return out.slice(0, 5);
}

type ScanRow = {
  strike: number;
  years: number;
  iv: number;
  oi: number;
  sign: number;
};

function scanFlip(
  rows: ScanRow[],
  spot: number,
  multiplier: number,
  rate: number,
  divYield: number,
): { flip: number | null; curve: GammaCurvePoint[] } {
  if (!rows.length || !(spot > 0)) return { flip: null, curve: [] };
  const lo = spot * (1 - CURVE_BAND);
  const hi = spot * (1 + CURVE_BAND);
  const curve: GammaCurvePoint[] = [];
  for (let i = 0; i < CURVE_STEPS; i++) {
    const s = lo + ((hi - lo) * i) / (CURVE_STEPS - 1);
    const scale = multiplier * s * s * 0.01;
    let gex = 0;
    for (const row of rows) {
      const g = blackScholesGamma(s, row.strike, row.years, row.iv, rate, divYield);
      gex += row.sign * g * row.oi * scale;
    }
    curve.push({ spot: s, gex });
  }
  let flip: number | null = null;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]!;
    const b = curve[i + 1]!;
    const z = interpolateZero(a.spot, a.gex, b.spot, b.gex);
    if (z != null) {
      flip = z;
      break;
    }
  }
  return { flip, curve };
}

export function computeGammaSnapshot(
  meta: GammaMarketMeta,
  chain: CboeChain,
  now = new Date(),
): GammaSnapshot {
  const data = chain.data || {};
  const spot = Number(data.current_price);
  if (!(spot > 0)) {
    throw new Error(`${meta.id}: spot missing`);
  }
  const options = data.options || [];
  const lo = spot * (1 - BAND);
  const hi = spot * (1 + BAND);
  const byStrikeExact = new Map<number, StrikeAgg>();
  const dteMap: Record<GammaDteBucket["id"], GammaDteBucket> = {
    "0_1": {
      id: "0_1",
      label: "0–1일",
      gex: 0,
      call_gex: 0,
      put_gex: 0,
      contracts: 0,
    },
    "2_7": {
      id: "2_7",
      label: "2–7일",
      gex: 0,
      call_gex: 0,
      put_gex: 0,
      contracts: 0,
    },
    "8_30": {
      id: "8_30",
      label: "8–30일",
      gex: 0,
      call_gex: 0,
      put_gex: 0,
      contracts: 0,
    },
    "31p": {
      id: "31p",
      label: "31일+",
      gex: 0,
      call_gex: 0,
      put_gex: 0,
      contracts: 0,
    },
  };

  let net = 0;
  let callGex = 0;
  let putGex = 0;
  let nearGex = 0;
  let zeroDteGex = 0;
  let callOi = 0;
  let putOi = 0;
  let used = 0;
  const scan: ScanRow[] = [];

  for (const row of options) {
    const oi = Number(row.open_interest) || 0;
    if (!(oi > 0) || !row.option) continue;
    const parsed = parseOccSymbol(row.option);
    if (!parsed) continue;
    const dte = dteDays(parsed.expiry, now);
    if (dte < 0) continue;
    const gamma = Number(row.gamma) || 0;
    const sign = parsed.call ? 1 : -1;
    const gex = dollarGex(gamma, oi, spot, sign, meta.multiplier);
    used += 1;
    net += gex;
    if (parsed.call) {
      callGex += gex;
      callOi += oi;
    } else {
      putGex += gex;
      putOi += oi;
    }
    if (dte <= 1) zeroDteGex += gex;
    if (dte <= 7) nearGex += gex;
    const bucketId: GammaDteBucket["id"] =
      dte <= 1 ? "0_1" : dte <= 7 ? "2_7" : dte <= 30 ? "8_30" : "31p";
    const bucket = dteMap[bucketId];
    bucket.gex += gex;
    bucket.contracts += 1;
    if (parsed.call) bucket.call_gex += gex;
    else bucket.put_gex += gex;

    if (parsed.strike >= lo && parsed.strike <= hi) {
      addAgg(byStrikeExact, parsed.strike, gex, parsed.call, oi);
    }

    const iv = Number(row.iv) || 0;
    if (
      iv >= 0.03 &&
      iv <= 1.25 &&
      parsed.strike >= spot * 0.88 &&
      parsed.strike <= spot * 1.12 &&
      scan.length < MAX_SCAN_CONTRACTS
    ) {
      const years = yearsToExpiry(parsed.expiry, now);
      if (years > 0) {
        scan.push({
          strike: parsed.strike,
          years,
          iv,
          oi,
          sign,
        });
      }
    }
  }

  const byStrike = bucketStrikes(byStrikeExact, meta.strike_step, spot);

  const wallSource = byStrikeExact.size ? byStrikeExact : byStrike;
  const strikesSorted = [...byStrike.entries()].sort((a, b) => a[0] - b[0]);
  let callWall: number | null = null;
  let putWall: number | null = null;
  let callWallVal = -Infinity;
  let putWallVal = Infinity;
  for (const [strike, agg] of wallSource) {
    if (agg.call_gex > callWallVal) {
      callWallVal = agg.call_gex;
      callWall = strike;
    }
    if (agg.put_gex < putWallVal) {
      putWallVal = agg.put_gex;
      putWall = strike;
    }
  }

  let nearest = strikesSorted[0]?.[0] ?? spot;
  let nearestGap = Infinity;
  let callWallBar: number | null = null;
  let putWallBar: number | null = null;
  let callWallBarGap = Infinity;
  let putWallBarGap = Infinity;
  for (const [strike] of strikesSorted) {
    const gap = Math.abs(strike - spot);
    if (gap < nearestGap) {
      nearestGap = gap;
      nearest = strike;
    }
    if (callWall != null) {
      const g = Math.abs(strike - callWall);
      if (g < callWallBarGap) {
        callWallBarGap = g;
        callWallBar = strike;
      }
    }
    if (putWall != null) {
      const g = Math.abs(strike - putWall);
      if (g < putWallBarGap) {
        putWallBarGap = g;
        putWallBar = strike;
      }
    }
  }

  const strikes: GammaStrikeBar[] = strikesSorted.map(([strike, agg]) => ({
    strike,
    gex: agg.gex,
    call_gex: agg.call_gex,
    put_gex: agg.put_gex,
    call_oi: agg.call_oi,
    put_oi: agg.put_oi,
    near_spot: strike === nearest,
    call_wall: strike === callWallBar,
    put_wall: strike === putWallBar,
  }));

  const exactSorted = [...byStrikeExact.entries()].sort(
    (a, b) => Math.abs(b[1].gex) - Math.abs(a[1].gex),
  );
  const top_strikes: GammaTopStrike[] = exactSorted.slice(0, 12).map(([strike, agg]) => ({
    strike,
    gex: agg.gex,
    call_gex: agg.call_gex,
    put_gex: agg.put_gex,
    call_oi: agg.call_oi,
    put_oi: agg.put_oi,
  }));

  const { flip, curve } = scanFlip(
    scan,
    spot,
    meta.multiplier,
    GAMMA_RATE,
    meta.div_yield,
  );
  const { regime, regime_ko, regime_en } = regimeOf(net, spot, flip);
  const putCall = callOi > 0 ? putOi / callOi : null;
  const changePct =
    data.price_change_percent != null && Number.isFinite(data.price_change_percent)
      ? Number(data.price_change_percent)
      : null;
  const asOf =
    (typeof chain.timestamp === "string" && chain.timestamp) ||
    data.last_trade_time ||
    null;

  return {
    id: meta.id,
    label: meta.label,
    label_ko: meta.label_ko,
    product: meta.product,
    symbol: data.symbol || meta.symbol,
    venue: meta.venue,
    spot,
    change_pct: changePct,
    iv30: data.iv30 != null && Number.isFinite(data.iv30) ? Number(data.iv30) : null,
    net_gex: net,
    call_gex: callGex,
    put_gex: putGex,
    near_gex: nearGex,
    zero_dte_gex: zeroDteGex,
    call_oi: callOi,
    put_oi: putOi,
    put_call_oi: putCall,
    contracts_used: used,
    contracts_raw: options.length,
    call_wall: callWall,
    put_wall: putWall,
    flip,
    regime,
    regime_ko,
    regime_en,
    drivers: buildDrivers({
      net,
      near: nearGex,
      zeroDte: zeroDteGex,
      putCall,
      spot,
      flip,
      callWall,
      putWall,
    }),
    strikes,
    dte_buckets: [dteMap["0_1"], dteMap["2_7"], dteMap["8_30"], dteMap["31p"]],
    curve,
    top_strikes,
    as_of: asOf,
  };
}

export function fmtGexUsd(n?: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function fmtGexAxis(n: number): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(0)}M`;
  return `${sign}${abs.toFixed(0)}`;
}
