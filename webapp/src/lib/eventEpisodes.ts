/** KOSPI / KOSDAQ / KOSPI-sector episode return comparison (Event Study tab). */

export const MAX_PERIODS = 6;
export const MIN_PERIOD_DAYS = 3;
export const SERIES_LOOKBACK_START = "1996-01-01";

export type EpisodeCategory =
  | "fx_down"
  | "fx_up"
  | "oil_up"
  | "oil_down"
  | "crisis"
  | "cycle";

export type AssetKind = "market" | "sector" | "driver";

export type PricePoint = { date: string; close: number };

export type EpisodePeriod = {
  id: string;
  label: string;
  start: string;
  end: string;
  category?: EpisodeCategory;
  note?: string;
  source?: "catalog" | "detected" | "custom";
};

export type SuggestedEpisode = EpisodePeriod & {
  category: EpisodeCategory;
  category_ko: string;
  driver?: { id: string; label: string; change_pct: number | null };
};

export type AssetSpec = {
  id: string;
  label: string;
  kind: AssetKind;
  symbol: string;
  note?: string;
};

export type PeriodReturn = {
  period_id: string;
  return_pct: number | null;
  start_date?: string;
  end_date?: string;
  start_px?: number;
  end_px?: number;
  n_days?: number;
  error?: string;
};

export type EpisodeAssetResult = AssetSpec & {
  listed_from?: string;
  returns: PeriodReturn[];
};

export type EventEpisodesPayload = {
  ok: boolean;
  error?: string;
  suggestions?: SuggestedEpisode[];
  defaults?: string[];
  categories?: Array<{ id: EpisodeCategory; label: string }>;
  periods?: EpisodePeriod[];
  assets?: EpisodeAssetResult[];
  source?: string;
  generated_at?: string;
  note?: string;
};

export const CATEGORY_META: Array<{ id: EpisodeCategory; label: string }> = [
  { id: "fx_down", label: "원달러 하락" },
  { id: "fx_up", label: "원달러 상승" },
  { id: "oil_up", label: "유가 상승" },
  { id: "oil_down", label: "유가 하락" },
  { id: "crisis", label: "위기·쇼크" },
  { id: "cycle", label: "사이클·정책" },
];

export const CATEGORY_LABEL: Record<EpisodeCategory, string> = Object.fromEntries(
  CATEGORY_META.map((c) => [c.id, c.label]),
) as Record<EpisodeCategory, string>;

/** Cash indices + FX/oil context + KOSPI 200 sector ETF proxies. */
export const EPISODE_ASSETS: AssetSpec[] = [
  { id: "kospi", label: "코스피", kind: "market", symbol: "^KS11" },
  { id: "kosdaq", label: "코스닥", kind: "market", symbol: "^KQ11" },
  { id: "usdkrw", label: "원달러", kind: "driver", symbol: "USDKRW=X", note: "USD/KRW" },
  { id: "wti", label: "WTI 유가", kind: "driver", symbol: "CL=F", note: "원유 선물" },
  { id: "sec_it", label: "IT", kind: "sector", symbol: "139250.KS", note: "TIGER 200 IT" },
  { id: "sec_disc", label: "경기소비재", kind: "sector", symbol: "139260.KS", note: "TIGER 200 경기소비재" },
  { id: "sec_fin", label: "금융", kind: "sector", symbol: "139270.KS", note: "TIGER 200 금융" },
  { id: "sec_chem", label: "에너지화학", kind: "sector", symbol: "139280.KS", note: "TIGER 200 에너지화학" },
  { id: "sec_steel", label: "철강소재", kind: "sector", symbol: "139290.KS", note: "TIGER 200 철강소재" },
  { id: "sec_heavy", label: "중공업", kind: "sector", symbol: "139230.KS", note: "TIGER 200 중공업" },
  { id: "sec_const", label: "건설", kind: "sector", symbol: "139240.KS", note: "TIGER 200 건설" },
  { id: "sec_health", label: "헬스케어", kind: "sector", symbol: "227540.KS", note: "TIGER 200 헬스케어" },
  { id: "sec_ind", label: "산업재", kind: "sector", symbol: "227550.KS", note: "TIGER 200 산업재" },
  { id: "sec_staples", label: "생활소비재", kind: "sector", symbol: "227560.KS", note: "TIGER 200 생활소비재" },
  { id: "sec_semi", label: "반도체", kind: "sector", symbol: "091160.KS", note: "KODEX 반도체" },
  { id: "sec_auto", label: "자동차", kind: "sector", symbol: "091180.KS", note: "KODEX 자동차" },
  { id: "sec_bank", label: "은행", kind: "sector", symbol: "091170.KS", note: "KODEX 은행" },
];

export const MARKET_IDS = ["kospi", "kosdaq"] as const;
export const DRIVER_IDS = ["usdkrw", "wti"] as const;

/**
 * Curated historical windows. Dates are the primary shock/move span, not
 * a single announcement day — so period returns are comparable.
 */
export const CATALOG_EPISODES: SuggestedEpisode[] = [
  {
    id: "fx-down-gfc-rebound",
    label: "GFC 이후 원화 회복",
    start: "2009-03-02",
    end: "2011-07-29",
    category: "fx_down",
    category_ko: CATEGORY_LABEL.fx_down,
    note: "금융위기 고점(약 1,570원) 이후 원화 강세",
    source: "catalog",
  },
  {
    id: "fx-down-2017",
    label: "2017 원화 강세",
    start: "2016-02-25",
    end: "2018-01-31",
    category: "fx_down",
    category_ko: CATEGORY_LABEL.fx_down,
    note: "달러 약세·수출 호조로 원달러 하락",
    source: "catalog",
  },
  {
    id: "fx-down-covid-rebound",
    label: "COVID 이후 원화 회복",
    start: "2020-03-19",
    end: "2021-01-04",
    category: "fx_down",
    category_ko: CATEGORY_LABEL.fx_down,
    note: "패닉 고점 이후 원달러 약 1,285→1,080",
    source: "catalog",
  },
  {
    id: "fx-up-gfc",
    label: "GFC 원화 급락",
    start: "2008-08-01",
    end: "2009-03-02",
    category: "fx_up",
    category_ko: CATEGORY_LABEL.fx_up,
    note: "리먼 사태 전후 원달러 급등",
    source: "catalog",
  },
  {
    id: "fx-up-taper",
    label: "테이퍼 텐트럼",
    start: "2013-05-22",
    end: "2013-08-28",
    category: "fx_up",
    category_ko: CATEGORY_LABEL.fx_up,
    note: "연준 양적완화 축소 시사 후 신흥국 환율 충격",
    source: "catalog",
  },
  {
    id: "fx-up-fed-2022",
    label: "2022 연준 긴축",
    start: "2022-01-03",
    end: "2022-10-24",
    category: "fx_up",
    category_ko: CATEGORY_LABEL.fx_up,
    note: "금리 인상 사이클, 원달러 약 1,190→1,445",
    source: "catalog",
  },
  {
    id: "oil-up-2008",
    label: "2008 유가 슈퍼스파이크",
    start: "2007-01-16",
    end: "2008-07-11",
    category: "oil_up",
    category_ko: CATEGORY_LABEL.oil_up,
    note: "WTI 약 50달러 → 147달러",
    source: "catalog",
  },
  {
    id: "oil-up-opec-2016",
    label: "OPEC 감산 반등",
    start: "2016-02-11",
    end: "2018-10-03",
    category: "oil_up",
    category_ko: CATEGORY_LABEL.oil_up,
    note: "2016년 저점 이후 감산·수요 회복",
    source: "catalog",
  },
  {
    id: "oil-up-ukraine",
    label: "우크라이나 에너지 쇼크",
    start: "2020-04-21",
    end: "2022-03-08",
    category: "oil_up",
    category_ko: CATEGORY_LABEL.oil_up,
    note: "COVID 저점 → 전쟁 직후 WTI 고점",
    source: "catalog",
  },
  {
    id: "oil-down-shale",
    label: "셰일 유가 붕괴",
    start: "2014-06-20",
    end: "2016-02-11",
    category: "oil_down",
    category_ko: CATEGORY_LABEL.oil_down,
    note: "미국 셰일 증산, WTI 약 107→26달러",
    source: "catalog",
  },
  {
    id: "oil-down-covid",
    label: "COVID 유가 급락",
    start: "2020-01-06",
    end: "2020-04-21",
    category: "oil_down",
    category_ko: CATEGORY_LABEL.oil_down,
    note: "수요 증발·마이너스 유가 에피소드",
    source: "catalog",
  },
  {
    id: "oil-down-2022-23",
    label: "2022–23 유가 되돌림",
    start: "2022-06-08",
    end: "2023-06-12",
    category: "oil_down",
    category_ko: CATEGORY_LABEL.oil_down,
    note: "전쟁 고점 이후 수요 둔화",
    source: "catalog",
  },
  {
    id: "crisis-gfc",
    label: "글로벌 금융위기",
    start: "2008-09-15",
    end: "2009-03-09",
    category: "crisis",
    category_ko: CATEGORY_LABEL.crisis,
    note: "리먼 파산 → 증시 저점",
    source: "catalog",
  },
  {
    id: "crisis-eu-2011",
    label: "유럽 재정위기",
    start: "2011-07-01",
    end: "2011-10-04",
    category: "crisis",
    category_ko: CATEGORY_LABEL.crisis,
    note: "유로존 부채 우려로 위험자산 급락",
    source: "catalog",
  },
  {
    id: "crisis-china-2015",
    label: "2015 중국 증시 급락",
    start: "2015-06-12",
    end: "2015-08-24",
    category: "crisis",
    category_ko: CATEGORY_LABEL.crisis,
    note: "상해 버블 붕괴·위안화 절하",
    source: "catalog",
  },
  {
    id: "crisis-covid-panic",
    label: "COVID 패닉",
    start: "2020-02-19",
    end: "2020-03-23",
    category: "crisis",
    category_ko: CATEGORY_LABEL.crisis,
    note: "팬데믹 선언 전후 글로벌 급락",
    source: "catalog",
  },
  {
    id: "crisis-svb",
    label: "SVB 은행 위기",
    start: "2023-03-08",
    end: "2023-03-24",
    category: "crisis",
    category_ko: CATEGORY_LABEL.crisis,
    note: "미국 지역은행 스트레스",
    source: "catalog",
  },
  {
    id: "cycle-covid-rebound",
    label: "COVID 유동성 반등",
    start: "2020-03-23",
    end: "2020-12-30",
    category: "cycle",
    category_ko: CATEGORY_LABEL.cycle,
    note: "정책 대응 이후 위험자산 회복",
    source: "catalog",
  },
  {
    id: "cycle-trade-war",
    label: "미중 무역분쟁",
    start: "2018-03-22",
    end: "2019-08-14",
    category: "cycle",
    category_ko: CATEGORY_LABEL.cycle,
    note: "관세 확대 국면",
    source: "catalog",
  },
  {
    id: "cycle-semi-super",
    label: "반도체 슈퍼사이클",
    start: "2016-01-04",
    end: "2018-01-24",
    category: "cycle",
    category_ko: CATEGORY_LABEL.cycle,
    note: "메모리 호황 구간",
    source: "catalog",
  },
  {
    id: "cycle-semi-down",
    label: "반도체 다운사이클",
    start: "2018-01-24",
    end: "2019-08-15",
    category: "cycle",
    category_ko: CATEGORY_LABEL.cycle,
    note: "메모리 가격 하락 국면",
    source: "catalog",
  },
  {
    id: "cycle-ai-rally",
    label: "AI 랠리",
    start: "2023-01-03",
    end: "2024-06-28",
    category: "cycle",
    category_ko: CATEGORY_LABEL.cycle,
    note: "생성 AI 투자 사이클",
    source: "catalog",
  },
  {
    id: "cycle-yen-unwind",
    label: "엔캐리 언와인드",
    start: "2024-07-31",
    end: "2024-08-06",
    category: "cycle",
    category_ko: CATEGORY_LABEL.cycle,
    note: "2024년 8월 엔화 급등·글로벌 변동성",
    source: "catalog",
  },
];

/** First-load comparison set — crisis, FX, oil, structural cycle. */
export const DEFAULT_EPISODE_IDS = [
  "crisis-covid-panic",
  "fx-up-fed-2022",
  "oil-up-ukraine",
  "cycle-ai-rally",
] as const;

export function isEpisodeCategory(value: string): value is EpisodeCategory {
  return CATEGORY_META.some((c) => c.id === value);
}

export function isoTodayKst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function parseIsoDate(value: string): string | null {
  const text = (value || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== text) return null;
  return text;
}

export function calendarDays(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function validatePeriod(
  raw: { id?: string; label?: string; start?: string; end?: string },
  index: number,
): { ok: true; period: EpisodePeriod } | { ok: false; error: string } {
  const start = parseIsoDate(String(raw.start || ""));
  const end = parseIsoDate(String(raw.end || ""));
  if (!start || !end) {
    return { ok: false, error: `구간 ${index + 1}: 날짜 형식은 YYYY-MM-DD 입니다.` };
  }
  if (start > end) {
    return { ok: false, error: `구간 ${index + 1}: 시작일이 종료일보다 늦습니다.` };
  }
  if (calendarDays(start, end) < MIN_PERIOD_DAYS) {
    return { ok: false, error: `구간 ${index + 1}: 최소 ${MIN_PERIOD_DAYS}일 이상이어야 합니다.` };
  }
  const today = isoTodayKst();
  if (start > today) {
    return { ok: false, error: `구간 ${index + 1}: 미래 시작일은 사용할 수 없습니다.` };
  }
  const clippedEnd = end > today ? today : end;
  const label = (raw.label || "").trim() || `구간 ${index + 1}`;
  const id = (raw.id || "").trim() || `custom-${start}-${clippedEnd}-${index}`;
  return {
    ok: true,
    period: { id, label: label.slice(0, 40), start, end: clippedEnd, source: "custom" },
  };
}

export function closeOnOrAfter(points: PricePoint[], iso: string): PricePoint | null {
  for (const p of points) {
    if (p.date >= iso) return p;
  }
  return null;
}

export function closeOnOrBefore(points: PricePoint[], iso: string): PricePoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    if (p.date <= iso) return p;
  }
  return null;
}

export function periodReturn(points: PricePoint[], start: string, end: string): PeriodReturn {
  if (points.length < 2) {
    return { period_id: "", return_pct: null, error: "시계열 없음" };
  }
  const listed = points[0]!.date;
  if (end < listed) {
    return { period_id: "", return_pct: null, error: "상장 전" };
  }
  const startPx = closeOnOrAfter(points, start) || closeOnOrBefore(points, start);
  const endPx = closeOnOrBefore(points, end);
  if (!startPx || !endPx) {
    return { period_id: "", return_pct: null, error: "해당 구간 데이터 없음" };
  }
  if (startPx.date > end) {
    return { period_id: "", return_pct: null, error: "상장 전" };
  }
  if (endPx.date < startPx.date || startPx.close <= 0) {
    return { period_id: "", return_pct: null, error: "가격 없음" };
  }
  const ret = (endPx.close / startPx.close - 1) * 100;
  if (!Number.isFinite(ret)) {
    return { period_id: "", return_pct: null, error: "계산 실패" };
  }
  return {
    period_id: "",
    return_pct: ret,
    start_date: startPx.date,
    end_date: endPx.date,
    start_px: startPx.close,
    end_px: endPx.close,
    n_days: calendarDays(startPx.date, endPx.date),
  };
}

function overlapRatio(a: EpisodePeriod, b: EpisodePeriod): number {
  const s = Math.max(Date.parse(`${a.start}T00:00:00Z`), Date.parse(`${b.start}T00:00:00Z`));
  const e = Math.min(Date.parse(`${a.end}T00:00:00Z`), Date.parse(`${b.end}T00:00:00Z`));
  const overlap = Math.max(0, e - s);
  const aLen = Math.max(1, Date.parse(`${a.end}T00:00:00Z`) - Date.parse(`${a.start}T00:00:00Z`));
  const bLen = Math.max(1, Date.parse(`${b.end}T00:00:00Z`) - Date.parse(`${b.start}T00:00:00Z`));
  return overlap / Math.min(aLen, bLen);
}

/** Percentage-swing zigzag → labeled trend episodes. */
export function detectTrendEpisodes(
  points: PricePoint[],
  opts: {
    thresholdPct: number;
    minDays: number;
    maxPerDirection: number;
    up: { category: EpisodeCategory; labelPrefix: string };
    down: { category: EpisodeCategory; labelPrefix: string };
    driverId: string;
    driverLabel: string;
  },
): SuggestedEpisode[] {
  if (points.length < 60) return [];
  type Pivot = { idx: number; date: string; price: number };
  const pivots: Pivot[] = [{ idx: 0, date: points[0]!.date, price: points[0]!.close }];
  let dir = 0;
  let ext = 0;

  for (let i = 1; i < points.length; i++) {
    const px = points[i]!.close;
    if (!(px > 0)) continue;
    const base = points[ext]!.close;
    if (!(base > 0)) {
      ext = i;
      continue;
    }
    const move = ((px - base) / base) * 100;

    if (dir === 0) {
      if (move >= opts.thresholdPct) {
        dir = 1;
        ext = i;
      } else if (move <= -opts.thresholdPct) {
        dir = -1;
        ext = i;
      }
      continue;
    }

    if (dir === 1) {
      if (px >= points[ext]!.close) {
        ext = i;
      } else if (((px - points[ext]!.close) / points[ext]!.close) * 100 <= -opts.thresholdPct) {
        pivots.push({ idx: ext, date: points[ext]!.date, price: points[ext]!.close });
        dir = -1;
        ext = i;
      }
    } else if (px <= points[ext]!.close) {
      ext = i;
    } else if (((px - points[ext]!.close) / points[ext]!.close) * 100 >= opts.thresholdPct) {
      pivots.push({ idx: ext, date: points[ext]!.date, price: points[ext]!.close });
      dir = 1;
      ext = i;
    }
  }
  pivots.push({ idx: ext, date: points[ext]!.date, price: points[ext]!.close });

  const unique: Pivot[] = [];
  for (const p of pivots) {
    const last = unique[unique.length - 1];
    if (!last || last.idx !== p.idx) unique.push(p);
  }

  const episodes: SuggestedEpisode[] = [];
  for (let i = 1; i < unique.length; i++) {
    const a = unique[i - 1]!;
    const b = unique[i]!;
    const days = calendarDays(a.date, b.date);
    if (days < opts.minDays) continue;
    if (!(a.price > 0)) continue;
    const change = ((b.price / a.price) - 1) * 100;
    if (Math.abs(change) < opts.thresholdPct) continue;
    const rising = change > 0;
    const spec = rising ? opts.up : opts.down;
    const year = a.date.slice(0, 4);
    episodes.push({
      id: `det-${opts.driverId}-${rising ? "up" : "dn"}-${a.date}`,
      label: `${spec.labelPrefix} ${year}`,
      start: a.date,
      end: b.date,
      category: spec.category,
      category_ko: CATEGORY_LABEL[spec.category],
      note: `${opts.driverLabel} ${change > 0 ? "+" : ""}${change.toFixed(1)}%`,
      source: "detected",
      driver: { id: opts.driverId, label: opts.driverLabel, change_pct: change },
    });
  }

  const up = episodes
    .filter((e) => e.driver && (e.driver.change_pct || 0) > 0)
    .sort((a, b) => Math.abs(b.driver!.change_pct || 0) - Math.abs(a.driver!.change_pct || 0))
    .slice(0, opts.maxPerDirection);
  const down = episodes
    .filter((e) => e.driver && (e.driver.change_pct || 0) < 0)
    .sort((a, b) => Math.abs(b.driver!.change_pct || 0) - Math.abs(a.driver!.change_pct || 0))
    .slice(0, opts.maxPerDirection);
  return [...down, ...up];
}

export function mergeSuggestions(
  catalog: SuggestedEpisode[],
  detected: SuggestedEpisode[],
): SuggestedEpisode[] {
  const out = [...catalog];
  for (const d of detected) {
    const overlaps = catalog.some((c) => overlapRatio(c, d) >= 0.55 && c.category === d.category);
    if (overlaps) continue;
    out.push(d);
  }
  return out.sort((a, b) => b.start.localeCompare(a.start) || a.label.localeCompare(b.label, "ko"));
}

export function attachDriverMoves(
  episodes: SuggestedEpisode[],
  series: Record<string, PricePoint[]>,
): SuggestedEpisode[] {
  return episodes.map((ep) => {
    if (ep.driver?.change_pct != null) return ep;
    const driverId = ep.category.startsWith("oil") ? "wti" : ep.category.startsWith("fx") ? "usdkrw" : null;
    if (!driverId) return ep;
    const points = series[driverId];
    if (!points?.length) return ep;
    const ret = periodReturn(points, ep.start, ep.end);
    const spec = EPISODE_ASSETS.find((a) => a.id === driverId);
    return {
      ...ep,
      driver: {
        id: driverId,
        label: spec?.label || driverId,
        change_pct: ret.return_pct,
      },
    };
  });
}

export function newCustomPeriod(index: number): EpisodePeriod {
  const today = isoTodayKst();
  const startDate = new Date(`${today}T00:00:00Z`);
  startDate.setUTCMonth(startDate.getUTCMonth() - 3);
  const start = startDate.toISOString().slice(0, 10);
  return {
    id: `custom-${Date.now()}-${index}`,
    label: `직접 입력 ${index + 1}`,
    start,
    end: today,
    source: "custom",
  };
}
