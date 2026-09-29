/**
 * Recorded MP track records (MP1 = ETF배분, MP2 = 글로벌주식) crawled from the Atlas
 * portfolio-lab public API, with a bundled snapshot fallback.
 */

import {
  addDays,
  alignTo,
  cachedLookup,
  drawdowns,
  fetchDaily,
  isNum,
  metricSet,
  monthlyReturns,
  relativeMetrics,
  rfDailyFrom,
  toReturns,
  UA,
  weeklyIndex,
  type MpMetricSet,
  type MpRelativeMetrics,
} from "@/lib/mpCore";
import snapshot from "@/lib/mpTrackSnapshot.json";

export type MpTrackId = "MP1" | "MP2";

export const MP_TRACK_SOURCE = "https://atlas-portfolio-lab.savvyetf.chatgpt.site/api/performance";

export const MP_TRACK_META: Record<MpTrackId, { label: string; bm_label: string }> = {
  MP1: { label: "MP1 · ETF배분", bm_label: "BM (원본 파일)" },
  MP2: { label: "MP2 · 글로벌주식", bm_label: "BM (원본 파일)" },
};

type Row = [string, number, number];

export type MpTrackPeriod = {
  key: string;
  label: string;
  port_pct: number | null;
  bm_pct: number | null;
  excess_pct: number | null;
  annualized?: boolean;
};

export type MpTrackRecord = {
  ok: boolean;
  error?: string;
  id: MpTrackId;
  label: string;
  bm_label: string;
  source: string;
  source_url: string;
  from_snapshot: boolean;
  fetched_at: string;
  first_date: string;
  last_date: string;
  notes: string[];
  series: Array<{ date: string; port: number; bm: number; port_dd: number; bm_dd: number }>;
  periods: MpTrackPeriod[];
  years: Array<{ year: string; port_pct: number; bm_pct: number; excess_pct: number; partial: boolean }>;
  monthly: Array<{ month: string; port_pct: number; bm_pct: number; excess_pct: number }>;
  metrics: { port: MpMetricSet; bm: MpMetricSet; rel: MpRelativeMetrics } | null;
  rolling: Array<{ date: string; port_pct: number; bm_pct: number; excess_pct: number }>;
  rf_ann_pct: number | null;
  /** Risk metrics (vol, Sharpe, TE, beta …) are computed on weekly returns; MDD / VaR / best-worst on daily. */
  risk_basis: "weekly";
};

type RawSeries = { source: string; rows: Row[]; fetched_at: string; from_snapshot: boolean };

async function fetchRemote(id: MpTrackId): Promise<RawSeries | null> {
  const res = await fetch(`${MP_TRACK_SOURCE}?series=${id}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    source?: string;
    rows?: Array<{ date?: string; portfolio?: number; benchmark?: number }>;
  };
  const rows: Row[] = [];
  for (const r of json.rows || []) {
    if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
    if (!isNum(r.portfolio!) || !isNum(r.benchmark!) || r.portfolio! <= 0 || r.benchmark! <= 0) continue;
    rows.push([r.date, r.portfolio!, r.benchmark!]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (rows.length < 20) return null;
  return { source: json.source || "", rows, fetched_at: new Date().toISOString(), from_snapshot: false };
}

function fromSnapshot(id: MpTrackId): RawSeries {
  const s = (snapshot as unknown as Record<string, { source?: string; rows: Row[] }>)[id]!;
  return {
    source: s.source || "",
    rows: s.rows,
    fetched_at: (snapshot as unknown as { fetched_at: string }).fetched_at,
    from_snapshot: true,
  };
}

async function loadRaw(id: MpTrackId): Promise<RawSeries> {
  const live = await cachedLookup(`mp:track:raw1:${id}`, 3 * 3600_000, 24 * 3600_000, () => fetchRemote(id));
  return live ?? fromSnapshot(id);
}

function periodTable(dates: string[], p: number[], b: number[]): MpTrackPeriod[] {
  const N = dates.length;
  const last = dates[N - 1]!;
  const at = (lv: number[], d: string) => {
    let v: number | null = null;
    for (let i = 0; i < N && dates[i]! <= d; i++) v = lv[i]!;
    return v;
  };
  const spanYears = (from: string) => (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (365.25 * 86_400_000);
  const defs: Array<{ key: string; label: string; from: string; ann?: boolean }> = [
    { key: "1w", label: "1주", from: addDays(last, -7) },
    { key: "1m", label: "1개월", from: addDays(last, -30) },
    { key: "3m", label: "3개월", from: addDays(last, -91) },
    { key: "6m", label: "6개월", from: addDays(last, -182) },
    { key: "ytd", label: "YTD", from: `${Number(last.slice(0, 4)) - 1}-12-31` },
    { key: "1y", label: "1년", from: addDays(last, -365) },
    { key: "3y", label: "3년 (연)", from: addDays(last, -1096), ann: true },
    { key: "5y", label: "5년 (연)", from: addDays(last, -1826), ann: true },
    { key: "all", label: "설정 이후 누적", from: dates[0]! },
    { key: "all_ann", label: "설정 이후 (연)", from: dates[0]!, ann: true },
  ];
  return defs.map((d) => {
    if (d.from < dates[0]!) return { key: d.key, label: d.label, port_pct: null, bm_pct: null, excess_pct: null, annualized: d.ann };
    const p0 = at(p, d.from);
    const b0 = at(b, d.from);
    const yrs = spanYears(d.key.startsWith("all") ? dates[0]! : d.from);
    const conv = (end: number, start: number | null) => {
      if (!start) return null;
      const g = end / start;
      return (d.ann ? Math.pow(g, 1 / Math.max(yrs, 1e-9)) - 1 : g - 1) * 100;
    };
    const pr = conv(p[N - 1]!, p0);
    const br = conv(b[N - 1]!, b0);
    return { key: d.key, label: d.label, port_pct: pr, bm_pct: br, excess_pct: pr != null && br != null ? pr - br : null, annualized: d.ann };
  });
}

function yearTable(dates: string[], p: number[], b: number[]) {
  const out: MpTrackRecord["years"] = [];
  let i0 = 0;
  for (let i = 0; i < dates.length; i++) {
    const y = dates[i]!.slice(0, 4);
    if (i === dates.length - 1 || dates[i + 1]!.slice(0, 4) !== y) {
      const pp = (p[i]! / p[i0]! - 1) * 100;
      const bb = (b[i]! / b[i0]! - 1) * 100;
      const partial = (i0 === 0 && dates[0]! > `${y}-01-07`) || (i === dates.length - 1 && dates[i]! < `${y}-12-24`);
      out.push({ year: y, port_pct: pp, bm_pct: bb, excess_pct: pp - bb, partial });
      i0 = i;
    }
  }
  return out;
}

export async function loadMpTrackRecord(id: MpTrackId): Promise<MpTrackRecord> {
  const meta = MP_TRACK_META[id];
  const raw = await loadRaw(id);
  const notes: string[] = [];
  let rows = raw.rows;

  let stale = 0;
  while (rows.length - stale - 1 > 0 && rows[rows.length - 1 - stale]![1] === rows[rows.length - 2 - stale]![1]) stale++;
  if (stale > 0) {
    const cut = rows.slice(rows.length - stale);
    notes.push(
      `마지막 ${stale}개 평가일(${cut[0]![0]}~${cut[cut.length - 1]![0]})은 MP 지수가 갱신되지 않아(값 동일) 분석에서 제외했습니다.`,
    );
    rows = rows.slice(0, rows.length - stale);
  }
  if (raw.from_snapshot) notes.push(`원본 사이트 조회 실패 — ${raw.fetched_at.slice(0, 10)} 스냅샷을 사용했습니다.`);

  const dates = rows.map((r) => r[0]);
  const p = rows.map((r) => r[1]);
  const b = rows.map((r) => r[2]);
  const N = dates.length;
  const p0 = p[0]!;
  const b0 = b[0]!;
  const pN = p.map((v) => (v / p0) * 100);
  const bN = b.map((v) => (v / b0) * 100);
  const pdd = drawdowns(pN);
  const bdd = drawdowns(bN);

  let rf: number[] = new Array<number>(N).fill(0);
  let rfAnn: number | null = null;
  try {
    const irx = await fetchDaily("^IRX", addDays(dates[0]!, -10));
    rf = rfDailyFrom(dates, alignTo(dates, irx));
    const span = (Date.parse(`${dates[N - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86_400_000;
    rfAnn = span > 0 ? (rf.reduce((s, v) => s + v, 0) * 365) / span * 100 : null;
  } catch {
    notes.push("무위험수익률(^IRX) 조회 실패 — Sharpe·Sortino·알파는 무위험수익률 0% 기준");
  }

  const rp = toReturns(pN);
  const rb = toReturns(bN);
  const rfR = rf.slice(1);
  const spanDays = (Date.parse(`${dates[N - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86_400_000;
  const obsPerYear = spanDays > 0 ? ((N - 1) * 365.25) / spanDays : 252;
  const dp = metricSet(dates, pN, rp, rfR, obsPerYear, spanDays);
  const db = metricSet(dates, bN, rb, rfR, obsPerYear, spanDays);

  // Daily rows mix valuation timings (US/China closes, holidays carried forward), which
  // distorts daily vol / TE / beta; weekly returns are robust to one-day misalignment.
  const wk = weeklyIndex(dates);
  const wDates = wk.map((i) => dates[i]!);
  const wP = wk.map((i) => pN[i]!);
  const wB = wk.map((i) => bN[i]!);
  const wRf = wk.slice(1).map((i, k) => {
    let s = 0;
    for (let j = wk[k]! + 1; j <= i; j++) s += rf[j] || 0;
    return s;
  });
  const wRp = toReturns(wP);
  const wRb = toReturns(wB);
  const wp = metricSet(wDates, wP, wRp, wRf, 52, spanDays);
  const wb = metricSet(wDates, wB, wRb, wRf, 52, spanDays);
  const riskFrom = (d: MpMetricSet, w: MpMetricSet): MpMetricSet => ({ ...d, vol_pct: w.vol_pct, sharpe: w.sharpe, sortino: w.sortino });
  const mp = riskFrom(dp, wp);
  const mb = riskFrom(db, wb);
  const rel = relativeMetrics(wRp, wRb, wRf, 52, mp.total_return_pct, mb.total_return_pct);

  const flatRuns: string[] = [];
  for (let i = 1; i < N - 1; ) {
    if (p[i] === p[i - 1] && b[i] === b[i - 1]) {
      let j = i;
      while (j + 1 < N && p[j + 1] === p[j] && b[j + 1] === b[j]) j++;
      if (j > i) flatRuns.push(`${dates[i]}~${dates[j]}`);
      i = j + 1;
    } else i++;
  }
  if (flatRuns.length) {
    notes.push(`MP·BM 지수가 연속으로 동일한(미갱신 추정) 구간: ${flatRuns.join(", ")} — 누적 수익률에는 영향이 없고 다음 평가일에 몰아서 반영됩니다.`);
  }

  const corrOf = (a: number[], c: number[]) => {
    const n = Math.min(a.length, c.length);
    if (n < 30) return null;
    const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
    const mc = c.slice(0, n).reduce((s, v) => s + v, 0) / n;
    let sab = 0;
    let saa = 0;
    let scc = 0;
    for (let k = 0; k < n; k++) {
      sab += (a[k]! - ma) * (c[k]! - mc);
      saa += (a[k]! - ma) ** 2;
      scc += (c[k]! - mc) ** 2;
    }
    return saa > 0 && scc > 0 ? sab / Math.sqrt(saa * scc) : null;
  };
  const tail = Math.min(126, rp.length - 1);
  if (tail >= 60) {
    const a = rp.slice(-tail);
    const same = corrOf(a, rb.slice(-tail));
    const prev = corrOf(a, rb.slice(-tail - 1, -1));
    if (same != null && prev != null && prev > 0.25) {
      notes.push(
        `최근 6개월 MP 일간 수익률의 BM 상관이 당일 ${same.toFixed(2)} · 전일 ${prev.toFixed(2)}로, MP 평가일이 하루씩 어긋난 날이 섞여 있는 것으로 보입니다. 일간 기준 지표(최고·최저일, VaR)는 참고용이며, 위험지표는 주간 수익률로 계산했습니다.`,
      );
    }
  }

  const rolling: MpTrackRecord["rolling"] = [];
  let j = 0;
  for (const i of wk) {
    const from = addDays(dates[i]!, -365);
    if (from < dates[0]!) continue;
    while (j < i && dates[j + 1]! <= from) j++;
    const pp = (pN[i]! / pN[j]! - 1) * 100;
    const bb = (bN[i]! / bN[j]! - 1) * 100;
    rolling.push({ date: dates[i]!, port_pct: pp, bm_pct: bb, excess_pct: pp - bb });
  }

  return {
    ok: true,
    id,
    label: meta.label,
    bm_label: meta.bm_label,
    source: raw.source,
    source_url: `${MP_TRACK_SOURCE}?series=${id}`,
    from_snapshot: raw.from_snapshot,
    fetched_at: raw.fetched_at,
    first_date: dates[0]!,
    last_date: dates[N - 1]!,
    notes,
    series: dates.map((d, i) => ({ date: d, port: pN[i]!, bm: bN[i]!, port_dd: pdd[i]!, bm_dd: bdd[i]! })),
    periods: periodTable(dates, pN, bN),
    years: yearTable(dates, pN, bN),
    monthly: monthlyReturns(dates, pN, bN),
    metrics: { port: mp, bm: mb, rel },
    rolling,
    rf_ann_pct: rfAnn,
    risk_basis: "weekly",
  };
}
