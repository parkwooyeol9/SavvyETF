/**
 * KRX 옵션 보드 — R2 스냅샷 로더 (server-only).
 *
 * 데이터·엑셀은 Python 배치(`04_국내시장/krx_option_board.py --publish`)가 만든다.
 * KRX Open API 를 130영업일 × 5개 API 로 받아야 해서 Vercel 함수에서는 수집하지 않고,
 * 배치가 올린 결과만 읽는다 (ETF Flow 주간과 같은 구조).
 *   krx_option_board/latest.json   — 탭 화면용 payload
 *   krx_option_board/latest.xlsx   — 정리 + 시계열 시트 엑셀
 */

import { promises as fs } from "fs";
import path from "path";

import { r2Configured, r2GetObjectBytes, r2GetObjectText } from "@/lib/r2";

export const KRX_OPTION_BOARD_JSON_KEY = "krx_option_board/latest.json";
export const KRX_OPTION_BOARD_XLSX_KEY = "krx_option_board/latest.xlsx";

export type OptSummary = {
  k200: number;
  k200_chg: number | null;
  vkospi: number | null;
  vkospi_chg: number | null;
  vkospi_pctile: number | null;
  rv20: number | null;
  vrp: number | null;
  atm_iv: number | null;
  skew: number | null;
  pc_oi: number | null;
  pc_vol: number | null;
  basis: number | null;
  fut_oi_chg: number | null;
  call_wall: number | null;
  put_wall: number | null;
  max_pain: number | null;
  /** 억원 / 1% */
  gex_eok: number | null;
};

export type VolPoint = {
  date: string;
  k200: number;
  vkospi: number | null;
  rv20: number | null;
  vrp: number | null;
};

export type OptExpiry = {
  product: string;
  code: string;
  expiry: string;
  dte: number;
  spot: number;
  atm: number;
  atm_iv: number | null;
  put_iv: number | null;
  call_iv: number | null;
  skew: number | null;
  call_oi: number;
  put_oi: number;
  call_vol: number;
  put_vol: number;
  pc_oi: number | null;
  pc_vol: number | null;
  call_wall: number;
  put_wall: number;
  max_pain: number | null;
  gex_eok: number;
};

export type OptStrike = {
  strike: number;
  c_oi: number;
  p_oi: number;
  c_vol: number;
  p_vol: number;
  c_iv: number | null;
  p_iv: number | null;
  c_px: number | null;
  p_px: number | null;
  gex_eok: number;
};

export type PcPoint = {
  date: string;
  pc_vol: number | null;
  pc_oi: number | null;
  pc_val: number | null;
  c_vol: number;
  p_vol: number;
  c_oi: number;
  p_oi: number;
  prem_eok: number;
};

export type FutPoint = {
  date: string;
  name: string;
  close: number | null;
  spot: number | null;
  basis: number | null;
  oi: number;
  oi_all: number;
  oi_chg: number | null;
  vol: number;
};

export type StrategyRow = {
  name: string;
  close: number | null;
  r1d: number | null;
  r1m: number | null;
  r3m: number | null;
  ex1m?: number | null;
  ex3m?: number | null;
};

export type EtfFlowRow = {
  code: string;
  name: string;
  base: string;
  dir: string;
  aum_eok: number;
  chg: number | null;
  val_eok: number;
  flow_1d: number | null;
  flow_5d: number | null;
  flow_20d: number | null;
};

export type StockOptRow = {
  name: string;
  spot: number | null;
  val_eok: number;
  share: number;
  pc_val: number | null;
  call_oi: number;
  put_oi: number;
  pc_oi: number | null;
  atm_iv: number | null;
  skew: number | null;
};

export type KrxOptionBoardPayload = {
  ok: boolean;
  as_of: string;
  generated_at: string;
  generated_at_display: string;
  title: string;
  summary: OptSummary;
  vol: {
    series: VolPoint[];
    vkospi: number | null;
    vkospi_pctile: number | null;
    vkospi_min: number | null;
    vkospi_max: number | null;
    rv20: number | null;
    vrp: number | null;
  };
  chain: {
    expiries: OptExpiry[];
    front: (OptExpiry & { strikes: OptStrike[] }) | null;
    gex_total_eok: number;
  };
  pc: PcPoint[];
  futures: FutPoint[];
  strategy: StrategyRow[];
  etf: {
    /** 억원, 키: "코스피200_레버리지" 등 */
    series: Array<Record<string, number | string>>;
    table: EtfFlowRow[];
    totals: Record<string, { aum_eok: number; flow_5d: number; flow_20d: number }>;
  };
  stocks: StockOptRow[];
  sources: string[];
  method: string[];
  error?: string;
};

export function emptyKrxOptionBoard(error: string): KrxOptionBoardPayload {
  return {
    ok: false,
    as_of: "",
    generated_at: "",
    generated_at_display: "",
    title: "",
    summary: {} as OptSummary,
    vol: { series: [], vkospi: null, vkospi_pctile: null, vkospi_min: null, vkospi_max: null, rv20: null, vrp: null },
    chain: { expiries: [], front: null, gex_total_eok: 0 },
    pc: [],
    futures: [],
    strategy: [],
    etf: { series: [], table: [], totals: {} },
    stocks: [],
    sources: [],
    method: [],
    error,
  };
}

/** 로컬 개발(R2 미설정): 배치가 저장한 `00_exports/krx_option_board/` 최신 파일. 운영에서는 쓰지 않는다. */
async function localExport(kind: "json" | "xlsx"): Promise<Buffer | null> {
  if (process.env.NODE_ENV === "production") return null;
  const dir = path.resolve(process.cwd(), "..", "00_exports", "krx_option_board");
  try {
    const names = (await fs.readdir(dir))
      .filter((n) => (kind === "json" ? /^krx_option_board_\d{6}\.json$/ : /^KRX 옵션보드_\d{6}\.xlsx$/).test(n))
      .sort();
    const last = names[names.length - 1];
    return last ? await fs.readFile(path.join(dir, last)) : null;
  } catch {
    return null;
  }
}

export async function loadKrxOptionBoard(): Promise<KrxOptionBoardPayload> {
  const text = r2Configured()
    ? await r2GetObjectText(KRX_OPTION_BOARD_JSON_KEY)
    : (await localExport("json"))?.toString("utf8") ?? null;
  if (!text) return emptyKrxOptionBoard("옵션 보드 스냅샷이 아직 없습니다");
  const data = JSON.parse(text) as KrxOptionBoardPayload;
  return { ...data, ok: true };
}

export async function loadKrxOptionBoardXlsx(): Promise<Uint8Array | null> {
  if (!r2Configured()) return (await localExport("xlsx")) ?? null;
  const obj = await r2GetObjectBytes(KRX_OPTION_BOARD_XLSX_KEY);
  return obj?.body ?? null;
}

/** "KRX 옵션보드_261104.xlsx" — 한글 파일명은 RFC 5987 로 함께 내려준다. */
export function krxOptionBoardFilename(payload: Pick<KrxOptionBoardPayload, "title">): string {
  return `${payload.title || "KRX 옵션보드"}.xlsx`;
}
