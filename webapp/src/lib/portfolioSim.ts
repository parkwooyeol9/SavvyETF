/**
 * ETF 배분 시뮬레이터 계산부 (포트폴리오 › MP 탭).
 *
 * 데이터: public/portfolio-sim/data.json — SavvyDB/Portfolio/4_코드/build_html.py --webapp 이 만든다.
 * BM(ACWI·S&P500·나스닥100)을 ETF 바스켓(코어)으로 복제하고, 국가·업종·테마 ETF(오버레이)를 더한
 * 포트폴리오의 성과·위험을 브라우저에서 바로 계산한다. 서버 호출 없음.
 */

export type BmId = "acwi" | "spx" | "ndx";
export type Rebal = "M" | "Q" | "Y" | "N";
export type Ccy = "USD" | "KRW";
export type Weights = Record<string, number>; // 티커 → 비중(%)

export type TopRow = { name: string; ticker: string; country?: string; sector: string; w: number };
export type BmBlock = {
  sector: Record<string, number>;
  country?: Record<string, number>;
  country_sector?: Record<string, Record<string, number>>;
  top: TopRow[];
  n: number;
  missing?: string[];
};
export type Look = { country: Record<string, number>; sector: Record<string, number>; src: string };

export type SimData = {
  asof: { acwi: string; acwi_ds: string; spx: string; ndx: string };
  px_asof: string;
  sectors: string[];
  bm: Record<BmId, BmBlock>;
  core: Record<BmId, Record<string, Weights>>;
  bmEtf: Record<BmId, string>;
  tilt: Array<[string, string, string]>; // [그룹, 티커, 이름]
  meta: Record<string, { n: string; ter: number | null; aum: number | null; k: string }>;
  look: Record<string, Look>;
  dates: string[];
  px: Record<string, { start: string; v: number[] }>;
};

export type Tilt = { t: string; w: number };
export type SimState = {
  bm: BmId;
  method: string;
  core: Weights;
  tilts: Tilt[];
  scale: number; // 오버레이 배율(%)
  per: string;
  reb: Rebal;
  ccy: Ccy;
};

export const BM_NAME: Record<BmId, string> = { acwi: "MSCI ACWI", spx: "S&P500", ndx: "나스닥100" };
export const PERIODS: Array<[string, number]> = [["1Y", 1], ["3Y", 3], ["5Y", 5], ["10Y", 10], ["전체", 99]];
export const STRESS: Array<[string, string, string]> = [
  ["2015 위안화 절하", "2015-08-10", "2015-08-25"],
  ["2018 4분기 긴축", "2018-09-20", "2018-12-24"],
  ["2020 코로나", "2020-02-19", "2020-03-23"],
  ["2020 반등", "2020-03-23", "2020-08-31"],
  ["2022 금리 인상", "2022-01-03", "2022-10-12"],
  ["2023 SVB", "2023-03-08", "2023-03-15"],
  ["2024 엔캐리 청산", "2024-07-10", "2024-08-05"],
  ["2025 관세 충격", "2025-02-19", "2025-04-08"],
  ["2025 관세 이후 반등", "2025-04-08", "2025-07-31"],
];
export const PRESETS: Record<string, Array<[string, number]>> = {
  "AI 반도체 집중": [["SOXX", 6], ["EWT", 3], ["EWY", 3]],
  "아시아 테크": [["EWY", 4], ["EWT", 4], ["EWJ", 2]],
  "전력 · 원자력 · 인프라": [["GRID", 4], ["URA", 3], ["PAVE", 3]],
  "방산": [["ITA", 4], ["IDEF", 4]],
  "인도 · 신흥국": [["INDA", 5], ["EMXC", 3]],
  "방어형 (헬스케어 · 필수소비 · 금)": [["XLV", 4], ["XLP", 3], ["GLD", 3]],
};

/** ACWI·S&P500 은 ETF 묶음(국가·업종) 복제, 나스닥100 은 업종 복제 TE 가 3.6%로 커서 QQQ 단일 */
export function defaultMethod(d: SimData, bm: BmId): string {
  return Object.keys(d.core[bm])[bm === "ndx" ? 0 : 1];
}

/** 일간 수익률을 미리 펼쳐 둔 엔진. data.json 을 한 번 읽어 만든다. */
export type Engine = {
  d: SimData;
  nd: number;
  off: Record<string, number>;
  r: Record<string, Float64Array>;
};

export function makeEngine(d: SimData): Engine {
  const nd = d.dates.length;
  const pos = new Map(d.dates.map((x, i) => [x, i]));
  const off: Record<string, number> = {};
  const r: Record<string, Float64Array> = {};
  for (const t of Object.keys(d.px)) {
    const o = pos.get(d.px[t].start) ?? 0;
    const v = d.px[t].v;
    off[t] = o;
    const a = new Float64Array(nd).fill(NaN);
    for (let i = o + 1; i < nd; i++) a[i] = v[i - o] / v[i - o - 1] - 1;
    r[t] = a;
  }
  return { d, nd, off, r };
}

// ── 비중 ─────────────────────────────────────────
export function tiltTotal(s: SimState): number {
  return (s.tilts.reduce((a, x) => a + x.w, 0) * s.scale) / 100;
}

/** 코어(합 100으로 환산) × (100 − 오버레이) + 오버레이. 합 100. */
export function finalWeights(core: Weights, tilts: Tilt[], scale: number): Weights {
  const raw = tilts.reduce((a, x) => a + x.w, 0);
  const T = Math.min(95, (raw * scale) / 100);
  const cs = Object.values(core).reduce((a, b) => a + b, 0) || 1;
  const W: Weights = {};
  for (const t in core) if (core[t] > 0) W[t] = (core[t] / cs) * (100 - T);
  const tt = raw || 1;
  for (const x of tilts) if (x.w > 0) W[x.t] = (W[x.t] || 0) + (x.w / tt) * T;
  return W;
}

// ── 시뮬레이션 ───────────────────────────────────
function newPeriod(a: string, b: string, reb: Rebal): boolean {
  if (reb === "N") return false;
  const ya = a.slice(0, 4), yb = b.slice(0, 4), ma = +a.slice(5, 7), mb = +b.slice(5, 7);
  if (reb === "Y") return ya !== yb;
  if (reb === "Q") return ya !== yb || Math.floor((ma - 1) / 3) !== Math.floor((mb - 1) / 3);
  return ya !== yb || ma !== mb;
}

function toKRW(e: Engine, a: Float64Array, s: number): Float64Array {
  const fx = e.r["KRW=X"];
  const o = new Float64Array(a.length);
  for (let k = 0; k < a.length; k++) {
    const x = fx[s + 1 + k];
    o[k] = (1 + a[k]) * (1 + (x === x ? x : 0)) - 1;
  }
  return o;
}

/** 목표 비중으로 출발해 reb 주기마다 되돌리는 바스켓의 일간 수익률 (길이 e − s). */
export function sim(e: Engine, W: Weights, s: number, end: number, reb: Rebal, ccy: Ccy): Float64Array {
  const ts = Object.keys(W).filter((t) => W[t] > 0 && e.r[t]);
  const n = ts.length, L = end - s;
  const tot = ts.reduce((a, t) => a + W[t], 0) || 1;
  const tw = ts.map((t) => W[t] / tot), v = tw.slice(), rr = ts.map((t) => e.r[t]);
  const out = new Float64Array(L);
  const dates = e.d.dates;
  for (let k = 0; k < L; k++) {
    const i = s + 1 + k;
    if (k > 0 && newPeriod(dates[i - 1], dates[i], reb)) {
      let V = 0;
      for (let j = 0; j < n; j++) V += v[j];
      for (let j = 0; j < n; j++) v[j] = tw[j] * V;
    }
    let V0 = 0, V1 = 0;
    for (let j = 0; j < n; j++) {
      V0 += v[j];
      const r = rr[j][i];
      v[j] *= 1 + (r === r ? r : 0);
      V1 += v[j];
    }
    out[k] = V0 ? V1 / V0 - 1 : 0;
  }
  return ccy === "KRW" ? toKRW(e, out, s) : out;
}

export function single(e: Engine, t: string, s: number, end: number, ccy: Ccy): Float64Array {
  const out = new Float64Array(end - s);
  const a = e.r[t];
  for (let k = 0; k < end - s; k++) {
    const r = a[s + 1 + k];
    out[k] = r === r ? r : 0;
  }
  return ccy === "KRW" ? toKRW(e, out, s) : out;
}

export type Window = { s: number; e: number; lim: string | null };

/** 선택 기간 시작일. 상장이 늦은 ETF가 있으면 그 ETF 상장 다음 날로 당겨진다(lim). */
export function windowFor(e: Engine, per: string, ccy: Ccy, tickers: string[]): Window {
  const end = e.nd - 1;
  const dates = e.d.dates;
  const yrs = (PERIODS.find((p) => p[0] === per) || PERIODS[2])[1];
  let s = 0;
  if (yrs < 99) {
    const dt = new Date(dates[end]);
    dt.setFullYear(dt.getFullYear() - yrs);
    const ds = dt.toISOString().slice(0, 10);
    s = Math.max(0, dates.findIndex((x) => x >= ds));
  }
  let lim: string | null = null;
  for (const t of tickers) {
    if (e.off[t] == null) continue;
    const o = e.off[t] + 1;
    if (o > s) {
      s = o;
      lim = t;
    }
  }
  if (ccy === "KRW" && e.off["KRW=X"] + 1 > s) s = e.off["KRW=X"] + 1;
  return { s, e: end, lim };
}

// ── 지표 ─────────────────────────────────────────
export type Stats = {
  cum: number; cagr: number; vol: number; sharpe: number; mdd: number; beta: number; corr: number;
  te: number; ex: number; ir: number | null; calmar: number | null; upc: number | null; dnc: number | null;
};

export function stats(e: Engine, r: Float64Array, b: Float64Array, s: number): Stats {
  const n = r.length;
  const rf = e.r["BIL"];
  const dates = e.d.dates;
  let cp = 1, cb = 1, peak = 1, mdd = 0, sr = 0, sr2 = 0, sb = 0, sb2 = 0, sab = 0, sa = 0, sa2 = 0, sx = 0;
  for (let k = 0; k < n; k++) {
    cp *= 1 + r[k];
    cb *= 1 + b[k];
    if (cp > peak) peak = cp;
    mdd = Math.min(mdd, cp / peak - 1);
    sr += r[k]; sr2 += r[k] * r[k]; sb += b[k]; sb2 += b[k] * b[k]; sab += r[k] * b[k];
    const a = r[k] - b[k];
    sa += a; sa2 += a * a;
    const f = rf[s + 1 + k];
    sx += r[k] - (f === f ? f : 0);
  }
  const yrs = n / 252, mr = sr / n, mb = sb / n;
  const vr = sr2 / n - mr * mr, vb = sb2 / n - mb * mb, cov = sab / n - mr * mb, va = sa2 / n - (sa / n) ** 2;
  const cagr = Math.pow(cp, 1 / yrs) - 1, bcagr = Math.pow(cb, 1 / yrs) - 1;
  const vol = Math.sqrt(Math.max(0, vr) * 252), te = Math.sqrt(Math.max(0, va) * 252);
  // 월간 상승·하락 포착률
  const up = [0, 0], dn = [0, 0];
  let mp = 1, mbb = 1;
  for (let k = 0; k < n; k++) {
    mp *= 1 + r[k];
    mbb *= 1 + b[k];
    const i = s + 1 + k;
    if (k === n - 1 || dates[i + 1].slice(0, 7) !== dates[i].slice(0, 7)) {
      const x = mp - 1, y = mbb - 1;
      if (y >= 0) { up[0] += x; up[1] += y; } else { dn[0] += x; dn[1] += y; }
      mp = 1; mbb = 1;
    }
  }
  return {
    cum: cp - 1, cagr, vol, sharpe: ((sx / n) * 252) / vol, mdd, beta: cov / vb, corr: cov / Math.sqrt(vr * vb),
    te, ex: cagr - bcagr, ir: te > 1e-9 ? ((sa / n) * 252) / te : null, calmar: mdd < 0 ? cagr / -mdd : null,
    upc: up[1] ? up[0] / up[1] : null, dnc: dn[1] ? dn[0] / dn[1] : null,
  };
}

export function weightedTER(d: SimData, W: Weights): number | null {
  let t = 0, c = 0;
  for (const k in W) {
    const m = d.meta[k];
    if (m && m.ter != null) { t += W[k] * m.ter; c += W[k]; }
  }
  return c ? t / c : null;
}

// ── look-through 노출 ────────────────────────────
export function bmExposure(d: SimData, bm: BmId): { country: Record<string, number>; sector: Record<string, number> } {
  if (bm === "acwi") return { country: d.bm.acwi.country || {}, sector: d.bm.acwi.sector };
  const l = d.look[d.bmEtf[bm]];
  return { country: l.country, sector: l.sector };
}

export function portExposure(d: SimData, W: Weights) {
  const c: Record<string, number> = {}, s: Record<string, number> = {};
  for (const t in W) {
    const l = d.look[t], w = W[t] / 100;
    if (!l) {
      c["미분류"] = (c["미분류"] || 0) + w * 100;
      s["미분류"] = (s["미분류"] || 0) + w * 100;
      continue;
    }
    const tc = Object.values(l.country).reduce((a, b) => a + b, 0) || 1;
    const tsum = Object.values(l.sector).reduce((a, b) => a + b, 0) || 1;
    for (const k in l.country) c[k] = (c[k] || 0) + (w * l.country[k] * 100) / tc;
    for (const k in l.sector) s[k] = (s[k] || 0) + (w * l.sector[k] * 100) / tsum;
  }
  return { country: c, sector: s };
}

export type ActiveRow = { k: string; a: number; p: number; b: number };
export function active(p: Record<string, number>, b: Record<string, number>, topN: number): ActiveRow[] {
  const keys = new Set([...Object.keys(p), ...Object.keys(b)]);
  const rows: ActiveRow[] = [];
  for (const k of keys) {
    if (k === "기타") continue;
    rows.push({ k, a: (p[k] || 0) - (b[k] || 0), p: p[k] || 0, b: b[k] || 0 });
  }
  rows.sort((x, y) => Math.abs(y.a) - Math.abs(x.a));
  return rows.slice(0, topN).sort((x, y) => y.a - x.a);
}

// ── 위험 기여 · 상관 ─────────────────────────────
export function riskContrib(e: Engine, W: Weights, bmT: string, w: Window, ccy: Ccy) {
  const ts = Object.keys(W).filter((t) => W[t] > 0);
  const all = [...ts];
  if (!all.includes(bmT)) all.push(bmT);
  const rets = all.map((t) => single(e, t, w.s, w.e, ccy));
  const n = all.length, L = w.e - w.s;
  const mu = rets.map((r) => r.reduce((a, b) => a + b, 0) / L);
  const cov = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++)
    for (let j = i; j < n; j++) {
      let x = 0;
      const ri = rets[i], rj = rets[j];
      for (let k = 0; k < L; k++) x += (ri[k] - mu[i]) * (rj[k] - mu[j]);
      cov[i][j] = cov[j][i] = x / L;
    }
  const wv = all.map((t) => (W[t] || 0) / 100);
  const av = wv.slice();
  av[all.indexOf(bmT)] -= 1; // TE 기여: BM 을 −100% 로 둔 액티브 비중
  const rc = (vec: number[]) => {
    const m = vec.map((_, i) => vec.reduce((acc, vj, j) => acc + cov[i][j] * vj, 0));
    const tot = vec.reduce((acc, vi, i) => acc + vi * m[i], 0);
    return vec.map((vi, i) => (tot ? (vi * m[i]) / tot : 0));
  };
  const corr = cov.map((row, i) => Array.from(row).map((c, j) => c / Math.sqrt(cov[i][i] * cov[j][j])));
  return { tickers: all, vc: rc(wv), tc: rc(av), corr };
}

// ── 한 번에 계산 ─────────────────────────────────
export type SimResult = {
  W: Weights;
  win: Window;
  rp: Float64Array;
  rc: Float64Array;
  rb: Float64Array;
  P: Stats;
  C: Stats;
  B: Stats;
  bmT: string;
};

export function run(e: Engine, st: SimState): SimResult {
  const W = finalWeights(st.core, st.tilts, st.scale);
  const bmT = e.d.bmEtf[st.bm];
  const used = [...new Set([...Object.keys(W), ...Object.keys(st.core).filter((t) => st.core[t] > 0), bmT, "BIL"])];
  const win = windowFor(e, st.per, st.ccy, used);
  const rp = sim(e, W, win.s, win.e, st.reb, st.ccy);
  const rc = sim(e, st.core, win.s, win.e, st.reb, st.ccy);
  const rb = single(e, bmT, win.s, win.e, st.ccy);
  return { W, win, rp, rc, rb, bmT, P: stats(e, rp, rb, win.s), C: stats(e, rc, rb, win.s), B: stats(e, rb, rb, win.s) };
}

/** 차트용 시계열 (최대 ~700점으로 솎음). 값은 %. */
export function seriesFor(e: Engine, res: SimResult) {
  const { rp, rc, rb, win } = res;
  const L = rp.length, step = Math.max(1, Math.ceil(L / 700));
  const dates = e.d.dates;
  const out: Array<{ d: string; P: number; C: number; B: number; Pdd: number; Cdd: number; Bdd: number; ex: number | null; te: number | null }> = [];
  const cp = [1, 1, 1], pk = [1, 1, 1], arrs = [rp, rc, rb];
  const cpa = new Float64Array(L + 1), cba = new Float64Array(L + 1);
  cpa[0] = 1; cba[0] = 1;
  const act = new Float64Array(L);
  let sa = 0, sa2 = 0;
  for (let k = 0; k < L; k++) {
    for (let j = 0; j < 3; j++) { cp[j] *= 1 + arrs[j][k]; pk[j] = Math.max(pk[j], cp[j]); }
    cpa[k + 1] = cp[0]; cba[k + 1] = cp[2];
    act[k] = rp[k] - rb[k];
    sa += act[k]; sa2 += act[k] * act[k];
    if (k >= 252) { sa -= act[k - 252]; sa2 -= act[k - 252] * act[k - 252]; }
    if (k % step === 0 || k === L - 1) {
      let ex: number | null = null, te: number | null = null;
      if (k >= 252) {
        ex = ((cpa[k + 1] / cpa[k + 1 - 252]) / (cba[k + 1] / cba[k + 1 - 252]) - 1) * 100;
        const m = sa / 252;
        te = Math.sqrt(Math.max(0, sa2 / 252 - m * m) * 252) * 100;
      }
      out.push({
        d: dates[win.s + 1 + k],
        P: (cp[0] - 1) * 100, C: (cp[1] - 1) * 100, B: (cp[2] - 1) * 100,
        Pdd: (cp[0] / pk[0] - 1) * 100, Cdd: (cp[1] / pk[1] - 1) * 100, Bdd: (cp[2] / pk[2] - 1) * 100,
        ex, te,
      });
    }
  }
  return out;
}

export function yearly(e: Engine, res: SimResult) {
  const yr: Record<string, [number, number, number]> = {};
  const { rp, rb, win } = res;
  for (let k = 0; k < rp.length; k++) {
    const y = e.d.dates[win.s + 1 + k].slice(0, 4);
    if (!yr[y]) yr[y] = [1, 1, 0];
    yr[y][0] *= 1 + rp[k];
    yr[y][1] *= 1 + rb[k];
    yr[y][2]++;
  }
  return Object.keys(yr).map((y) => ({ y, P: (yr[y][0] - 1) * 100, B: (yr[y][1] - 1) * 100, partial: yr[y][2] < 240 }));
}

export function stressRows(e: Engine, st: SimState, W: Weights) {
  const bmT = e.d.bmEtf[st.bm];
  const used = [...new Set([...Object.keys(W), ...Object.keys(st.core), bmT])].filter((t) => e.off[t] != null);
  const firstOk = Math.max(...used.map((t) => e.off[t] + 1));
  const cr = (r: Float64Array) => r.reduce((x, y) => x * (1 + y), 1) - 1;
  return STRESS.map(([name, a, b]) => {
    const s = e.d.dates.findIndex((d) => d >= a), en = e.d.dates.findIndex((d) => d >= b);
    if (s < 0 || en < 0 || s < firstOk) return { name, a, b, na: true as const };
    const p = cr(sim(e, W, s, en, "N", st.ccy)), c = cr(sim(e, st.core, s, en, "N", st.ccy)), bb = cr(single(e, bmT, s, en, st.ccy));
    return { name, a: e.d.dates[s], b: e.d.dates[en], na: false as const, p, c, bb };
  });
}

/** 오버레이 배율 0~200% 경로 (TE, 초과수익; %) */
export function frontier(e: Engine, st: SimState, res: SimResult) {
  const out: Array<{ x: number; y: number; k: number }> = [];
  for (let k = 0; k <= 200; k += 20) {
    const r = sim(e, finalWeights(st.core, st.tilts, k), res.win.s, res.win.e, st.reb, st.ccy);
    const s = stats(e, r, res.rb, res.win.s);
    out.push({ x: s.te * 100, y: s.ex * 100, k });
  }
  return out;
}

/** 목표 TE 에 맞는 오버레이 배율(%). 코어만으로 목표를 넘으면 null. */
export function fitScale(e: Engine, st: SimState, res: SimResult, target: number): { scale: number | null; te0: number } {
  const te = (k: number) => stats(e, sim(e, finalWeights(st.core, st.tilts, k), res.win.s, res.win.e, st.reb, st.ccy), res.rb, res.win.s).te;
  const te0 = te(0);
  if (te0 >= target) return { scale: null, te0 };
  let lo = 0, hi = 100;
  while (te(hi) < target && hi < 1600) hi *= 2;
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2;
    if (te(m) < target) lo = m; else hi = m;
  }
  return { scale: Math.round((lo + hi) / 2), te0 };
}

export type ScreenRow =
  | { grp: string; t: string; na: true }
  | { grp: string; t: string; na: false; cagr: number; vol: number; mdd: number; corr: number; beta: number; dex: number; dte: number; dvol: number; dmdd: number; ir: number | null };

/** 후보 ETF 를 현재 포트폴리오에 w% 더했을 때의 변화 */
export function screen(e: Engine, st: SimState, res: SimResult, w: number, group: string): ScreenRow[] {
  const { s, e: end } = res.win;
  const rows: ScreenRow[] = [];
  for (const [grp, t] of e.d.tilt) {
    if (group && grp !== group) continue;
    if (e.off[t] == null || e.off[t] + 1 > s) { rows.push({ grp, t, na: true }); continue; }
    const tilts = [...st.tilts.map((x) => ({ t: x.t, w: (x.w * st.scale) / 100 })), { t, w }];
    const r = sim(e, finalWeights(st.core, tilts, 100), s, end, st.reb, st.ccy);
    const a = stats(e, r, res.rb, s), so = stats(e, single(e, t, s, end, st.ccy), res.rb, s);
    rows.push({
      grp, t, na: false, cagr: so.cagr, vol: so.vol, mdd: so.mdd, corr: so.corr, beta: so.beta,
      dex: a.ex - res.P.ex, dte: a.te - res.P.te, dvol: a.vol - res.P.vol, dmdd: a.mdd - res.P.mdd, ir: a.ir,
    });
  }
  return rows;
}

// ── 표시 ─────────────────────────────────────────
/** 음수는 괄호, 양수에 + 없음 */
export function f(x: number | null | undefined, d = 1): string {
  if (x == null || !Number.isFinite(x)) return "–";
  const s = Math.abs(x).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  return x < -0.5 * Math.pow(10, -d) ? `(${s})` : s;
}
export const pc = (x: number | null | undefined, d = 1) => (x == null ? "–" : f(x * 100, d));
