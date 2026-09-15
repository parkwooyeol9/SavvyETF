/**
 * US midterm event study: rebase election-session close to 100, then compare
 * S&P 500 / Nasdaq / Dow and long-history industry portfolios by chamber outcome.
 *
 * Alignment follows event_study.py: first session on/after election Tuesday is t=0.
 */

export type ChamberParty = "D" | "R";
export type ScenarioId = "d_d" | "d_r" | "r_d" | "r_r";

export type PricePoint = { date: string; close: number };

export type AlignedPoint = {
  date: string;
  trading_day_offset: number;
  rebased: number;
};

export type PathPoint = { t: number; v: number };

export const HORIZON_DAYS = [30, 90, 180, 365] as const;
export type HorizonDay = (typeof HORIZON_DAYS)[number];

export const HORIZON_META: Array<{ days: HorizonDay; id: string; label: string }> = [
  { days: 30, id: "d30", label: "+1개월" },
  { days: 90, id: "d90", label: "+3개월" },
  { days: 180, id: "d180", label: "+6개월" },
  { days: 365, id: "d365", label: "+1년" },
];

export const WINDOW_PRE_DAYS = 30;
export const WINDOW_POST_DAYS = 400;
export const CHART_PRE_TD = 20;
export const CHART_POST_TD = 63;
export const MIN_ALIGN_POINTS = 5;
/** If the first available bar is farther than this, the series does not cover the election. */
export const MAX_T0_GAP_DAYS = 7;

export const DEFAULT_SCENARIO: ScenarioId = "d_r";

export type ChamberSeats = { d: number; r: number; other?: number };

export type MidtermElection = {
  id: string;
  date: string;
  congress: number;
  president: string;
  president_ko: string;
  president_party: ChamberParty;
  house_before: ChamberSeats;
  house_after: ChamberSeats;
  senate_before: ChamberSeats;
  senate_after: ChamberSeats;
  house_control: ChamberParty;
  senate_control: ChamberParty;
  scenario: ScenarioId;
  note: string;
};

export type AssetKind = "market" | "sector";

export type AssetSpec = {
  id: string;
  label: string;
  kind: AssetKind;
  symbol?: string;
  french?: string;
  start?: string;
  note?: string;
};

export type HorizonStat = {
  days: HorizonDay;
  rebased: number | null;
  return_pct: number | null;
  n: number;
};

export type EventAssetSnapshot = {
  asset_id: string;
  t0_date: string | null;
  horizons: HorizonStat[];
};

export type ElectionSnapshot = {
  id: string;
  date: string;
  t0_date: string | null;
  assets: EventAssetSnapshot[];
};

export type ScenarioAssetResult = {
  id: string;
  label: string;
  kind: AssetKind;
  n: number;
  path: PathPoint[];
  horizons: HorizonStat[];
};

export type ScenarioResult = {
  id: ScenarioId;
  n: number;
  elections: ElectionSnapshot[];
  assets: ScenarioAssetResult[];
};

export type MidtermStudyPayload = {
  ok: boolean;
  error?: string;
  generated_at?: string;
  default_scenario: ScenarioId;
  coverage: string[];
  note: string;
  elections: MidtermElection[];
  scenarios: Record<ScenarioId, ScenarioResult>;
  markets: AssetSpec[];
  sectors: AssetSpec[];
};

export const SCENARIO_META: Array<{
  id: ScenarioId;
  house: ChamberParty;
  senate: ChamberParty;
  label: string;
  sub: string;
}> = [
  { id: "d_d", house: "D", senate: "D", label: "하원 민주 · 상원 민주", sub: "민주 통일" },
  { id: "d_r", house: "D", senate: "R", label: "하원 민주 · 상원 공화", sub: "분할 (기본)" },
  { id: "r_d", house: "R", senate: "D", label: "하원 공화 · 상원 민주", sub: "분할" },
  { id: "r_r", house: "R", senate: "R", label: "하원 공화 · 상원 공화", sub: "공화 통일" },
];

export const MARKET_SPECS: AssetSpec[] = [
  { id: "spx", label: "S&P 500", kind: "market", symbol: "^GSPC", start: "1950-01-03" },
  {
    id: "nasdaq",
    label: "나스닥",
    kind: "market",
    symbol: "^IXIC",
    start: "1971-02-05",
    note: "1971-02 이후만 존재",
  },
  {
    id: "dow",
    label: "다우",
    kind: "market",
    symbol: "^DJI",
    start: "1992-01-02",
    note: "Yahoo 일별은 1992부터",
  },
];

/** Ken French 12 industry value-weighted daily portfolios (1926–). Not GICS. */
export const SECTOR_SPECS: AssetSpec[] = [
  { id: "nodur", label: "필수소비", kind: "sector", french: "NoDur" },
  { id: "durbl", label: "내구재", kind: "sector", french: "Durbl" },
  { id: "manuf", label: "제조", kind: "sector", french: "Manuf" },
  { id: "enrgy", label: "에너지", kind: "sector", french: "Enrgy" },
  { id: "chems", label: "화학", kind: "sector", french: "Chems" },
  {
    id: "buseq",
    label: "기술·장비",
    kind: "sector",
    french: "BusEq",
    note: "컴퓨터·전자장비. 나스닥 이전 기술 대용",
  },
  { id: "telcm", label: "통신", kind: "sector", french: "Telcm" },
  { id: "utils", label: "유틸리티", kind: "sector", french: "Utils" },
  { id: "shops", label: "유통", kind: "sector", french: "Shops" },
  { id: "hlth", label: "헬스케어", kind: "sector", french: "Hlth" },
  { id: "money", label: "금융", kind: "sector", french: "Money" },
  { id: "other", label: "기타", kind: "sector", french: "Other" },
];

export const ALL_ASSET_SPECS: AssetSpec[] = [...MARKET_SPECS, ...SECTOR_SPECS];

/**
 * Chamber control = majority of the Congress seated the following January.
 * Seat counts follow Clerk of the House / Senate Historical Office party divisions
 * (Independents folded into `other`; caucus still decides `*_control`).
 */
export const MIDTERM_ELECTIONS: MidtermElection[] = [
  {
    id: "1950",
    date: "1950-11-07",
    congress: 82,
    president: "Harry S. Truman",
    president_ko: "트루먼",
    president_party: "D",
    house_before: { d: 263, r: 171 },
    house_after: { d: 234, r: 199, other: 1 },
    senate_before: { d: 54, r: 42 },
    senate_after: { d: 48, r: 47, other: 1 },
    house_control: "D",
    senate_control: "D",
    scenario: "d_d",
    note: "민주당이 양원을 지켰으나 하원 −29석. 한국전쟁 중 중간선거.",
  },
  {
    id: "1954",
    date: "1954-11-02",
    congress: 84,
    president: "Dwight D. Eisenhower",
    president_ko: "아이젠하워",
    president_party: "R",
    house_before: { d: 213, r: 221 },
    house_after: { d: 232, r: 203 },
    senate_before: { d: 47, r: 48, other: 1 },
    senate_after: { d: 48, r: 47, other: 1 },
    house_control: "D",
    senate_control: "D",
    scenario: "d_d",
    note: "아이젠하워 1기 중간선거. 민주당이 양원 탈환.",
  },
  {
    id: "1958",
    date: "1958-11-04",
    congress: 86,
    president: "Dwight D. Eisenhower",
    president_ko: "아이젠하워",
    president_party: "R",
    house_before: { d: 234, r: 201 },
    house_after: { d: 283, r: 153 },
    senate_before: { d: 49, r: 47 },
    senate_after: { d: 64, r: 34 },
    house_control: "D",
    senate_control: "D",
    scenario: "d_d",
    note: "경기침체 직후. 민주당 하원 +49, 상원 +15.",
  },
  {
    id: "1962",
    date: "1962-11-06",
    congress: 88,
    president: "John F. Kennedy",
    president_ko: "케네디",
    president_party: "D",
    house_before: { d: 262, r: 175 },
    house_after: { d: 258, r: 176 },
    senate_before: { d: 64, r: 36 },
    senate_after: { d: 67, r: 33 },
    house_control: "D",
    senate_control: "D",
    scenario: "d_d",
    note: "쿠바 미사일 위기 직후. 여당이 양원을 유지.",
  },
  {
    id: "1966",
    date: "1966-11-08",
    congress: 90,
    president: "Lyndon B. Johnson",
    president_ko: "존슨",
    president_party: "D",
    house_before: { d: 295, r: 140 },
    house_after: { d: 248, r: 187 },
    senate_before: { d: 68, r: 32 },
    senate_after: { d: 64, r: 36 },
    house_control: "D",
    senate_control: "D",
    scenario: "d_d",
    note: "베트남·물가. 민주당이 양원을 지켰으나 하원 −47석.",
  },
  {
    id: "1970",
    date: "1970-11-03",
    congress: 92,
    president: "Richard Nixon",
    president_ko: "닉슨",
    president_party: "R",
    house_before: { d: 243, r: 192 },
    house_after: { d: 255, r: 180 },
    senate_before: { d: 57, r: 43 },
    senate_after: { d: 54, r: 44, other: 2 },
    house_control: "D",
    senate_control: "D",
    scenario: "d_d",
    note: "공화 대통령 아래 민주당 양원 유지. 하원은 민주 +12.",
  },
  {
    id: "1974",
    date: "1974-11-05",
    congress: 94,
    president: "Gerald Ford",
    president_ko: "포드",
    president_party: "R",
    house_before: { d: 242, r: 192 },
    house_after: { d: 291, r: 144 },
    senate_before: { d: 56, r: 42, other: 2 },
    senate_after: { d: 60, r: 38, other: 2 },
    house_control: "D",
    senate_control: "D",
    scenario: "d_d",
    note: "워터게이트·닉슨 사임 후. 민주당 하원 산사태.",
  },
  {
    id: "1978",
    date: "1978-11-07",
    congress: 96,
    president: "Jimmy Carter",
    president_ko: "카터",
    president_party: "D",
    house_before: { d: 292, r: 143 },
    house_after: { d: 277, r: 158 },
    senate_before: { d: 61, r: 38, other: 1 },
    senate_after: { d: 58, r: 41, other: 1 },
    house_control: "D",
    senate_control: "D",
    scenario: "d_d",
    note: "인플레·에너지 쇼크. 민주당 양원 유지, 의석 소폭 상실.",
  },
  {
    id: "1982",
    date: "1982-11-02",
    congress: 98,
    president: "Ronald Reagan",
    president_ko: "레이건",
    president_party: "R",
    house_before: { d: 242, r: 192 },
    house_after: { d: 269, r: 166 },
    senate_before: { d: 46, r: 53, other: 1 },
    senate_after: { d: 46, r: 54 },
    house_control: "D",
    senate_control: "R",
    scenario: "d_r",
    note: "더블딥 불황. 하원 민주, 상원 공화 — 2026 기본 시나리오와 같은 분할.",
  },
  {
    id: "1986",
    date: "1986-11-04",
    congress: 100,
    president: "Ronald Reagan",
    president_ko: "레이건",
    president_party: "R",
    house_before: { d: 253, r: 182 },
    house_after: { d: 258, r: 177 },
    senate_before: { d: 47, r: 53 },
    senate_after: { d: 55, r: 45 },
    house_control: "D",
    senate_control: "D",
    scenario: "d_d",
    note: "상원이 민주당으로 전환. 이란-콘트라 직전.",
  },
  {
    id: "1990",
    date: "1990-11-06",
    congress: 102,
    president: "George H. W. Bush",
    president_ko: "부시(부)",
    president_party: "R",
    house_before: { d: 260, r: 175 },
    house_after: { d: 267, r: 167 },
    senate_before: { d: 55, r: 45 },
    senate_after: { d: 56, r: 44 },
    house_control: "D",
    senate_control: "D",
    scenario: "d_d",
    note: "걸프전 직전. 민주당 양원 유지.",
  },
  {
    id: "1994",
    date: "1994-11-08",
    congress: 104,
    president: "Bill Clinton",
    president_ko: "클린턴",
    president_party: "D",
    house_before: { d: 258, r: 176, other: 1 },
    house_after: { d: 204, r: 230, other: 1 },
    senate_before: { d: 57, r: 43 },
    senate_after: { d: 47, r: 53 },
    house_control: "R",
    senate_control: "R",
    scenario: "r_r",
    note: "Gingrich 혁명. 40년 민주 하원 지배 종료, 공화 양원.",
  },
  {
    id: "1998",
    date: "1998-11-03",
    congress: 106,
    president: "Bill Clinton",
    president_ko: "클린턴",
    president_party: "D",
    house_before: { d: 206, r: 228 },
    house_after: { d: 211, r: 223 },
    senate_before: { d: 45, r: 55 },
    senate_after: { d: 45, r: 55 },
    house_control: "R",
    senate_control: "R",
    scenario: "r_r",
    note: "탄핵 국면에도 여당이 하원 의석을 늘린 이례적 6년차.",
  },
  {
    id: "2002",
    date: "2002-11-05",
    congress: 108,
    president: "George W. Bush",
    president_ko: "부시(자)",
    president_party: "R",
    house_before: { d: 212, r: 221, other: 2 },
    house_after: { d: 204, r: 229, other: 1 },
    senate_before: { d: 50, r: 49, other: 1 },
    senate_after: { d: 48, r: 51, other: 1 },
    house_control: "R",
    senate_control: "R",
    scenario: "r_r",
    note: "9/11 이후. 전시 중간선거에서 여당이 양원 강화.",
  },
  {
    id: "2006",
    date: "2006-11-07",
    congress: 110,
    president: "George W. Bush",
    president_ko: "부시(자)",
    president_party: "R",
    house_before: { d: 202, r: 232, other: 1 },
    house_after: { d: 233, r: 202 },
    senate_before: { d: 44, r: 55, other: 1 },
    senate_after: { d: 49, r: 49, other: 2 },
    house_control: "D",
    senate_control: "D",
    scenario: "d_d",
    note: "이라크전. 민주당 양원 탈환(상원은 코커스 기준).",
  },
  {
    id: "2010",
    date: "2010-11-02",
    congress: 112,
    president: "Barack Obama",
    president_ko: "오바마",
    president_party: "D",
    house_before: { d: 257, r: 178 },
    house_after: { d: 193, r: 242 },
    senate_before: { d: 59, r: 41 },
    senate_after: { d: 51, r: 47, other: 2 },
    house_control: "R",
    senate_control: "D",
    scenario: "r_d",
    note: "티파티·오바마케어. 하원 공화 탈환, 상원은 민주 유지.",
  },
  {
    id: "2014",
    date: "2014-11-04",
    congress: 114,
    president: "Barack Obama",
    president_ko: "오바마",
    president_party: "D",
    house_before: { d: 201, r: 234 },
    house_after: { d: 188, r: 247 },
    senate_before: { d: 53, r: 45, other: 2 },
    senate_after: { d: 44, r: 54, other: 2 },
    house_control: "R",
    senate_control: "R",
    scenario: "r_r",
    note: "상원까지 공화당. 오바마 2기 분할정부 종료.",
  },
  {
    id: "2018",
    date: "2018-11-06",
    congress: 116,
    president: "Donald Trump",
    president_ko: "트럼프",
    president_party: "R",
    house_before: { d: 194, r: 241 },
    house_after: { d: 235, r: 199 },
    senate_before: { d: 47, r: 51, other: 2 },
    senate_after: { d: 45, r: 53, other: 2 },
    house_control: "D",
    senate_control: "R",
    scenario: "d_r",
    note: "블루 웨이브. 하원 민주 탈환, 상원 공화 유지 — 기본 시나리오.",
  },
  {
    id: "2022",
    date: "2022-11-08",
    congress: 118,
    president: "Joe Biden",
    president_ko: "바이든",
    president_party: "D",
    house_before: { d: 222, r: 213 },
    house_after: { d: 213, r: 222 },
    senate_before: { d: 48, r: 50, other: 2 },
    senate_after: { d: 49, r: 49, other: 2 },
    house_control: "R",
    senate_control: "D",
    scenario: "r_d",
    note: "예상보다 약한 레드 웨이브. 하원 공화, 상원 민주(VP 캐스팅).",
  },
];

export const MIDTERM_STUDY_NOTE =
  "중간선거 당일(화) 이후 첫 거래일 종가를 100으로 두고 이후 경로를 평균합니다. " +
  "업종은 GICS/섹터 ETF가 1990년대 이후에야 생기므로, 1926년부터 있는 Ken French 12산업 " +
  "가치가중 포트폴리오를 대용합니다. 당대 대표 종목으로 메우지 않은 이유는 상장폐지·합병 " +
  "생존자 편향 때문입니다. 나스닥은 1971-02, 다우는 Yahoo 기준으로 1992부터만 있습니다. " +
  "기본값(하원 민주·상원 공화)은 1982·2018 두 해뿐입니다.";

export function scenarioLabel(id: ScenarioId): string {
  return SCENARIO_META.find((s) => s.id === id)?.label ?? id;
}

export function addCalendarDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function mean(vals: number[]): number | null {
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function seatsLabel(s: ChamberSeats): string {
  const o = s.other ? ` · 기타 ${s.other}` : "";
  return `D ${s.d} · R ${s.r}${o}`;
}

export function netDemSeats(before: ChamberSeats, after: ChamberSeats): number {
  return after.d - before.d;
}

export function signedSeats(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

/**
 * First session on/after eventDate is t=0 at rebased=100.
 * Mirrors event_study.align_series_to_event, scaled to 100 instead of 0%.
 */
export function alignSeriesToEvent(
  points: PricePoint[],
  eventDate: string,
  preDays = WINDOW_PRE_DAYS,
  postDays = WINDOW_POST_DAYS,
): AlignedPoint[] | null {
  if (!points.length) return null;
  const windowStart = addCalendarDays(eventDate, -preDays);
  const windowEnd = addCalendarDays(eventDate, postDays);
  const series: PricePoint[] = [];
  for (const p of points) {
    if (p.date < windowStart) continue;
    if (p.date > windowEnd) break;
    if (!(p.close > 0) || !Number.isFinite(p.close)) continue;
    series.push(p);
  }
  let t0 = -1;
  for (let i = 0; i < series.length; i++) {
    if (series[i]!.date >= eventDate) {
      t0 = i;
      break;
    }
  }
  if (t0 < 0) return null;
  if (series[t0]!.date > addCalendarDays(eventDate, MAX_T0_GAP_DAYS)) return null;
  const base = series[t0]!.close;
  if (!(base > 0)) return null;
  const out: AlignedPoint[] = series.map((p, i) => ({
    date: p.date,
    trading_day_offset: i - t0,
    rebased: (p.close / base) * 100,
  }));
  return out.length >= MIN_ALIGN_POINTS ? out : null;
}

export function valueAtCalendarHorizon(
  aligned: AlignedPoint[],
  days: number,
): { rebased: number; date: string } | null {
  const t0 = aligned.find((p) => p.trading_day_offset === 0);
  if (!t0) return null;
  const target = addCalendarDays(t0.date, days);
  const hit = aligned.find((p) => p.date >= target);
  if (!hit || !Number.isFinite(hit.rebased)) return null;
  return { rebased: hit.rebased, date: hit.date };
}

export function clipPath(aligned: AlignedPoint[]): PathPoint[] {
  return aligned
    .filter((p) => p.trading_day_offset >= -CHART_PRE_TD && p.trading_day_offset <= CHART_POST_TD)
    .map((p) => ({ t: p.trading_day_offset, v: round2(p.rebased) }));
}

export function averagePaths(paths: AlignedPoint[][]): PathPoint[] {
  const buckets = new Map<number, number[]>();
  for (const path of paths) {
    const seen = new Set<number>();
    for (const p of path) {
      if (p.trading_day_offset < -CHART_PRE_TD || p.trading_day_offset > CHART_POST_TD) continue;
      if (seen.has(p.trading_day_offset)) continue;
      seen.add(p.trading_day_offset);
      const arr = buckets.get(p.trading_day_offset) || [];
      arr.push(p.rebased);
      buckets.set(p.trading_day_offset, arr);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, vals]) => ({ t, v: round2(mean(vals) ?? 100) }));
}

export function averageHorizons(paths: AlignedPoint[][]): HorizonStat[] {
  return HORIZON_DAYS.map((days) => {
    const vals: number[] = [];
    for (const path of paths) {
      const hit = valueAtCalendarHorizon(path, days);
      if (hit) vals.push(hit.rebased);
    }
    const rebased = mean(vals);
    return {
      days,
      rebased: rebased == null ? null : round2(rebased),
      return_pct: rebased == null ? null : round2(rebased - 100),
      n: vals.length,
    };
  });
}

export function snapshotForEvent(
  specs: AssetSpec[],
  seriesMap: Record<string, PricePoint[]>,
  eventDate: string,
): ElectionSnapshot {
  const assets: EventAssetSnapshot[] = [];
  let t0Date: string | null = null;
  for (const spec of specs) {
    const aligned = alignSeriesToEvent(seriesMap[spec.id] || [], eventDate);
    const t0 = aligned?.find((p) => p.trading_day_offset === 0)?.date ?? null;
    if (spec.id === "spx" && t0) t0Date = t0;
    assets.push({
      asset_id: spec.id,
      t0_date: t0,
      horizons: HORIZON_DAYS.map((days) => {
        if (!aligned) return { days, rebased: null, return_pct: null, n: 0 };
        const hit = valueAtCalendarHorizon(aligned, days);
        return {
          days,
          rebased: hit ? round2(hit.rebased) : null,
          return_pct: hit ? round2(hit.rebased - 100) : null,
          n: hit ? 1 : 0,
        };
      }),
    });
  }
  return { id: eventDate.slice(0, 4), date: eventDate, t0_date: t0Date, assets };
}

export function buildScenario(
  scenario: ScenarioId,
  elections: MidtermElection[],
  specs: AssetSpec[],
  seriesMap: Record<string, PricePoint[]>,
): ScenarioResult {
  const rows = elections.filter((e) => e.scenario === scenario);
  const eventSnaps = rows.map((e) => snapshotForEvent(specs, seriesMap, e.date));
  const assets: ScenarioAssetResult[] = specs.map((spec) => {
    const paths: AlignedPoint[][] = [];
    for (const e of rows) {
      const aligned = alignSeriesToEvent(seriesMap[spec.id] || [], e.date);
      if (aligned) paths.push(aligned);
    }
    return {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      n: paths.length,
      path: averagePaths(paths),
      horizons: averageHorizons(paths),
    };
  });
  return {
    id: scenario,
    n: rows.length,
    elections: eventSnaps,
    assets,
  };
}

export function parseFrench12DailyCsv(text: string): Record<string, PricePoint[]> {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/NoDur/i.test(line) && /BusEq/i.test(line) && /Money/i.test(line)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("French 12 industry header not found");

  const header = lines[headerIdx]!.split(",").map((h) => h.trim());
  const colIndex = new Map<string, number>();
  for (let i = 1; i < header.length; i++) {
    if (header[i]) colIndex.set(header[i]!, i);
  }
  const acc: Record<string, { level: number; points: PricePoint[] }> = {};
  for (const spec of SECTOR_SPECS) {
    acc[spec.id] = { level: 100, points: [] };
  }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw) continue;
    if (/equal weighted/i.test(raw) || /average equal/i.test(raw)) break;
    if (!/^\d{8}/.test(raw)) continue;
    const cols = raw.split(",");
    const ymd = cols[0]!.trim();
    if (ymd.length < 8) continue;
    const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    for (const spec of SECTOR_SPECS) {
      const col = colIndex.get(spec.french!);
      if (col == null) continue;
      const ret = Number(cols[col]);
      if (!Number.isFinite(ret) || ret <= -99) continue;
      const bucket = acc[spec.id]!;
      bucket.level *= 1 + ret / 100;
      if (date >= "1949-01-01") {
        bucket.points.push({ date, close: bucket.level });
      }
    }
  }

  const out: Record<string, PricePoint[]> = {};
  for (const spec of SECTOR_SPECS) {
    out[spec.id] = acc[spec.id]?.points || [];
  }
  return out;
}

export function buildMidtermStudyPayload(
  seriesMap: Record<string, PricePoint[]>,
  coverage: string[],
): MidtermStudyPayload {
  const scenarios = {} as Record<ScenarioId, ScenarioResult>;
  for (const meta of SCENARIO_META) {
    scenarios[meta.id] = buildScenario(meta.id, MIDTERM_ELECTIONS, ALL_ASSET_SPECS, seriesMap);
  }
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    default_scenario: DEFAULT_SCENARIO,
    coverage,
    note: MIDTERM_STUDY_NOTE,
    elections: MIDTERM_ELECTIONS,
    scenarios,
    markets: MARKET_SPECS,
    sectors: SECTOR_SPECS,
  };
}

export function emptyMidtermStudyPayload(error: string): MidtermStudyPayload {
  const scenarios = {} as Record<ScenarioId, ScenarioResult>;
  for (const meta of SCENARIO_META) {
    scenarios[meta.id] = { id: meta.id, n: 0, elections: [], assets: [] };
  }
  return {
    ok: false,
    error,
    default_scenario: DEFAULT_SCENARIO,
    coverage: [],
    note: MIDTERM_STUDY_NOTE,
    elections: MIDTERM_ELECTIONS,
    scenarios,
    markets: MARKET_SPECS,
    sectors: SECTOR_SPECS,
  };
}

export function pickHorizon(
  asset: ScenarioAssetResult | undefined,
  days: HorizonDay,
): HorizonStat | undefined {
  return asset?.horizons.find((h) => h.days === days);
}

export function eventHorizon(
  snap: ElectionSnapshot,
  assetId: string,
  days: HorizonDay,
): HorizonStat | undefined {
  return snap.assets.find((a) => a.asset_id === assetId)?.horizons.find((h) => h.days === days);
}
