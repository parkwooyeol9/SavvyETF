/**
 * ETF Flow 주간 정기 업데이트 — R2 스냅샷 로더 (server-only).
 *
 * 데이터·엑셀은 Python 배치(`03_ETF/etf_flow_weekly.py --publish`)가 만든다.
 * ETF CHECK 일별 순유입 이력 수백 건을 1초 간격으로 받아야 해서 Vercel 함수(60s)에서는
 * 수집하지 않고, 배치가 올린 결과만 읽는다.
 *   etf_flow_weekly/latest.json   — 탭 화면용 payload
 *   etf_flow_weekly/latest.xlsx   — 요청 양식(정리 / Raw Data) 그대로 채운 엑셀
 */

import { promises as fs } from "fs";
import path from "path";

import { r2Configured, r2GetObjectBytes, r2GetObjectText } from "@/lib/r2";

export const ETF_FLOW_WEEKLY_JSON_KEY = "etf_flow_weekly/latest.json";
export const ETF_FLOW_WEEKLY_XLSX_KEY = "etf_flow_weekly/latest.xlsx";

export type FlowWeek = { label: string; start: string; end: string };

export type FlowTopRow = {
  ticker: string;
  name: string;
  asset_class: string;
  /** $B */
  flow_w: number;
  flow_aum_pct: number | null;
  /** $B */
  flow_4w: number;
  aum_b: number;
  kr_similar: string;
};

export type FlowTheme = {
  name: string;
  /** $B, 오래된 주 → 이번주 */
  weekly: number[];
  total: number;
  count: number;
  top: string[];
};

export type KrInvestorRow = {
  code: string;
  name: string;
  group: string;
  aum_eok: number;
  /** 억원 */
  indiv: number;
  inst: number;
  foreign: number;
};

export type FlowEvent = {
  date: string;
  day: string;
  category: string;
  event: string;
  detail: string;
};

export type EtfFlowWeeklyPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  title: string;
  us: {
    /** [이번주, 지난주, W-2, W-3] */
    weeks: FlowWeek[];
    asset: { labels: string[]; this: number[]; last: number[] };
    themes: FlowTheme[];
    top_in: FlowTopRow[];
    top_out: FlowTopRow[];
    universe_count: number;
    history_count?: number;
    flow_date?: string | null;
  };
  kr: {
    week: FlowWeek;
    groups: Record<string, { indiv: number; inst: number; foreign: number }>;
    indiv_buy: KrInvestorRow[];
    indiv_sell: KrInvestorRow[];
    universe_count: number;
  };
  events: { start: string; end: string; picks: FlowEvent[] };
  sources: string[];
  method: string[];
  error?: string;
};

export function emptyEtfFlowWeekly(error: string): EtfFlowWeeklyPayload {
  return {
    ok: false,
    generated_at: "",
    generated_at_display: "",
    title: "",
    us: {
      weeks: [],
      asset: { labels: [], this: [], last: [] },
      themes: [],
      top_in: [],
      top_out: [],
      universe_count: 0,
    },
    kr: {
      week: { label: "", start: "", end: "" },
      groups: {},
      indiv_buy: [],
      indiv_sell: [],
      universe_count: 0,
    },
    events: { start: "", end: "", picks: [] },
    sources: [],
    method: [],
    error,
  };
}

/** 로컬 개발(R2 미설정): 배치가 저장한 `00_exports/etf_flow_weekly/` 최신 파일. 운영에서는 쓰지 않는다. */
async function localExport(kind: "json" | "xlsx"): Promise<Buffer | null> {
  if (process.env.NODE_ENV === "production") return null;
  const dir = path.resolve(process.cwd(), "..", "00_exports", "etf_flow_weekly");
  try {
    const names = (await fs.readdir(dir))
      .filter((n) => (kind === "json" ? /^etf_flow_weekly_\d{6}\.json$/ : /^ETF Flow Data_\d{6}\.xlsx$/).test(n))
      .sort();
    const last = names[names.length - 1];
    return last ? await fs.readFile(path.join(dir, last)) : null;
  } catch {
    return null;
  }
}

export async function loadEtfFlowWeekly(): Promise<EtfFlowWeeklyPayload> {
  const text = r2Configured()
    ? await r2GetObjectText(ETF_FLOW_WEEKLY_JSON_KEY)
    : (await localExport("json"))?.toString("utf8") ?? null;
  if (!text) return emptyEtfFlowWeekly("주간 Flow 스냅샷이 아직 없습니다");
  const data = JSON.parse(text) as EtfFlowWeeklyPayload;
  // 탭 화면에는 Raw Data 를 싣지 않는다(엑셀 다운로드로 제공).
  const { raw_us_top: _top, raw_us: _raw, ...rest } = data as EtfFlowWeeklyPayload & {
    raw_us_top?: unknown;
    raw_us?: unknown;
  };
  void _top;
  void _raw;
  return { ...rest, ok: true };
}

export async function loadEtfFlowWeeklyXlsx(): Promise<Uint8Array | null> {
  if (!r2Configured()) return (await localExport("xlsx")) ?? null;
  const obj = await r2GetObjectBytes(ETF_FLOW_WEEKLY_XLSX_KEY);
  return obj?.body ?? null;
}

/** "ETF Flow Data_261016.xlsx" — 한글 파일명은 RFC 5987 로 함께 내려준다. */
export function etfFlowWeeklyFilename(payload: Pick<EtfFlowWeeklyPayload, "title">): string {
  return `${payload.title || "ETF Flow Data"}.xlsx`;
}
