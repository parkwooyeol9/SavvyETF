export type CarbonBar = {
  date: string;
  close: number;
  volume: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  value?: number | null;
};

export type CarbonQuote = {
  last: number | null;
  change: number | null;
  change_pct: number | null;
  volume: number | null;
};

export type CarbonSeries = {
  symbol: string;
  name: string;
  market: "KR" | "US" | "EU";
  currency: string;
  unit?: string;
  quote: CarbonQuote;
  daily: CarbonBar[];
  source: string;
};

/** KAU vs EUA (EU ETS) after FX conversion — CBAM relevance. */
export type CarbonSpread = {
  kau_krw: number | null;
  eua_eur: number | null;
  eua_krw: number | null;
  fx_eurkrw: number | null;
  /** KAU − EUA(원/톤). 음수면 KAU 디스카운트. */
  spread_krw: number | null;
  /** (KAU / EUA_krw − 1) × 100. 음수면 디스카운트 %. */
  spread_pct: number | null;
  kau_vs_eua_ratio: number | null;
  label: "premium" | "discount" | "flat" | "n/a";
  comment: string;
};

export type EsgCarbonPayload = {
  ok: boolean;
  generated_at?: string;
  note?: string;
  domestic?: CarbonSeries | null;
  /** Prefer EU EUA; kept as array for chart layout compatibility. */
  global?: CarbonSeries[];
  european?: CarbonSeries | null;
  spread?: CarbonSpread | null;
  error?: string;
};

export function fmtCarbonPrice(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtCarbonVol(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("ko-KR");
}

export function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function buildCarbonSpreadComment(input: {
  kauKrw: number | null;
  euaEur: number | null;
  euaKrw: number | null;
  spreadPct: number | null;
  label: CarbonSpread["label"];
}): string {
  const { kauKrw, euaEur, euaKrw, spreadPct, label } = input;
  if (
    kauKrw == null ||
    euaEur == null ||
    euaKrw == null ||
    spreadPct == null ||
    label === "n/a"
  ) {
    return "KAU·EUA 비교에 필요한 시세가 부족합니다. 데이터가 채워지면 CBAM 관점 스프레드를 다시 계산합니다.";
  }

  const absPct = Math.abs(spreadPct).toFixed(0);
  if (label === "discount") {
    if (spreadPct <= -50) {
      return `KAU는 EUA 대비 약 ${absPct}% 낮은 수준입니다. EU CBAM이 본격화되면 철강·알루미늄·시멘트 등 대EU 수출은 사실상 EUA에 가까운 탄소비용을 추가로 부담할 수 있어, K-ETS 가격 갭이 경쟁력·마진에 직접 영향을 줍니다.`;
    }
    return `KAU는 EUA 대비 약 ${absPct}% 디스카운트입니다. CBAM은 EU 탄소가격(EUA)을 기준으로 하고 한국에서 이미 낸 탄소가격만 차감하므로, 이 갭이 클수록 대EU 수출 기업의 추가 부담 여지가 커집니다.`;
  }
  if (label === "premium") {
    return `KAU가 EUA보다 약 ${absPct}% 비쌉니다. CBAM 추가 부담은 상대적으로 작아지지만, 국내 배출 집약 업종의 원가 압력은 EUA 기준보다 클 수 있습니다.`;
  }
  return `KAU와 EUA(원화 환산)가 거의 비슷한 수준입니다. CBAM 관점에서는 국내 탄소가격이 EU 벤치마크에 수렴한 구간으로, 추가 국경조정 부담이 제한적일 수 있습니다.`;
}
