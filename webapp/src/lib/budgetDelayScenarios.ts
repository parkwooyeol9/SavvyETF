/**
 * FY2027 US appropriations / CR cliff — editorial scenario map for the politics tab.
 * Updated for H.R.6500 (P.L. 119-103), signed 2026-09-02.
 */

export type BudgetScenarioTone = "base" | "risk" | "tail" | "upside";

export type BudgetScenario = {
  id: string;
  label: string;
  tone: BudgetScenarioTone;
  probability_ko: string;
  trigger: string;
  politics: string;
  market: string;
  watch: string[];
  tickers: string[];
};

export type BudgetHistoryEpisode = {
  year: string;
  days: number;
  spx_note: string;
  tlt_note: string;
  gold_note: string;
  lesson: string;
};

export type BudgetDelayContext = {
  bill: string;
  signed: string;
  cr_start: string;
  cr_end: string;
  days_to_cliff: number;
  cliff_label: string;
  headline: string;
  summary: string;
  status_bullets: string[];
  scenarios: BudgetScenario[];
  history: BudgetHistoryEpisode[];
  sources: Array<{ name: string; url: string }>;
  note: string;
};

export const FY2027_CR_END = "2026-12-11";

export function daysToBudgetCliff(now = new Date(), end = FY2027_CR_END): number {
  const target = new Date(`${end}T23:59:59-05:00`);
  const ms = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function buildBudgetDelayContext(now = new Date()): BudgetDelayContext {
  const days = daysToBudgetCliff(now);
  return {
    bill: "H.R.6500 · Continuing Appropriations and Extensions Act, 2027 (P.L. 119-103)",
    signed: "2026-09-02",
    cr_start: "2026-10-01",
    cr_end: FY2027_CR_END,
    days_to_cliff: days,
    cliff_label: "2026년 12월 12일(금) 00:01 ET",
    headline:
      days > 0
        ? "가을 셧다운은 피했지만, 12월 11일 CR 만료가 다음 예산 클리프"
        : "FY2027 CR 만료 — 연속결의·옴니버스·셧다운 분기점",
    summary:
      "9월 초 하원 370–48·상원 90–6로 72일 CR이 서명됐다. 11월 3일 중간선거 직후 민생·방산·이상(anomaly) 예산을 두고 여야가 다시 맞붙을 가능성이 크다.",
    status_bullets: [
      "FY2027 상반기(10–12월)는 대체로 FY2026 수준 CR로 운영 — CBO 연환산 약 $1.701조.",
      "하원 강경파는 연방 보조금 통제(anomaly) 등을 두고 CR에 반발했으나, 선거 전 셧다운 회피가 우선했다.",
      "12월 12일 이후 full-year 12개 법안·추가 CR·부분 셧다운 중 하나가 필요하다.",
      "역사적으로 셧다운 기간 SPX 중앙값은 0%에 가깝지만, 채무한도·데이터 공백이 겹치면 변동성은 커진다.",
    ],
    scenarios: [
      {
        id: "cr-bridge",
        label: "12월 CR 연장 (기본)",
        tone: "base",
        probability_ko: "가능성 높음",
        trigger: "12월 11일 직전, 4–8주 CR 또는 소규모 옴니버스로 마감 연장.",
        politics:
          "양당 모두 11·3 중간선거 직후 ‘정부 폐쇄’ 책임을 피하려는 인센티브가 강하다. 강경파는 anomaly·보조금 통제를 협상 카드로 쓰지만, 최종적으로는 단기 연장으로 시간을 산다.",
        market:
          "단기 VIX 스파이크 후 빠른 평준화. SPY는 ±1% 내 횡보가 흔하고, TLT·GLD는 ‘안전자산’ 수요만 소폭 증가. 실적·연준 경로가 셧다운보다 지배적.",
        watch: ["SPY", "TLT", "GLD", "UUP"],
        tickers: ["SPY", "SHY", "GLD"],
      },
      {
        id: "short-shutdown",
        label: "단기 셧다운 (5–10일)",
        tone: "risk",
        probability_ko: "선거 후 1–2주",
        trigger: "CR 만료 + 하원 강경파 거부권 → 12월 중순~말 부분 셧다운.",
        politics:
          "트럼프 행정부가 요구한 연방 보조금·방산 anomaly, WIC·재난 예산 등이 쟁점. 민주 하원(예측시장 우세)과 공화 상원의 분할정부가 협상을 지연시킬 수 있다.",
        market:
          "공표 직후 SPX -1~2% 조정 후 재개 시 대부분 회복(2013·2018–19 패턴). 지연 고용·물가 데이터는 변동성만 키우고 추세는 바꾸지 않는 경우가 많다. 금·초단기채(SHY) 상대 강세.",
        watch: ["SPY", "XLF", "IWM", "GLD", "SHY"],
        tickers: ["SPY", "XLF", "GLD", "SHY"],
      },
      {
        id: "omnibus-lite",
        label: "옴니버스 일부 합의",
        tone: "upside",
        probability_ko: "서프라이즈",
        trigger: "국방·VA·교통(표면교통 12/11 연장 포함) 등 2–4개 법안 조기 확정 + 나머지 CR.",
        politics:
          "양당이 ‘국방·재향군’은 먼저 통과시키고, 국내 discretionary·보조금 통제는 2027 Q1로 미루는 패키지. 9월 CR에 이미 일부 anomaly가 들어 있어 협상 템플릿이 존재한다.",
        market:
          "리스크 프리미엄 축소 → SPY·IWM 소폭 우위. 방산(ITA)·인프라 수혜주는 예산 certainty에 반응. 헬스케어(XLV)는 NIH/FDA anomaly 유지 여부에 민감.",
        watch: ["ITA", "IWM", "XLV", "SPY"],
        tickers: ["ITA", "IWM", "XLV", "SPY"],
      },
      {
        id: "debt-ceiling-overlap",
        label: "장기 셧다운 + 채무한도",
        tone: "tail",
        probability_ko: "꼬리 리스크",
        trigger: "CR 만료 후 2주+ 셧다운 + 2027 Q1 채무한도(X-date) 혼선.",
        politics:
          "2011·2023처럼 ‘예산’이 아니라 ‘디폴트’ 내러티브로 확대될 때 시장 충격이 커진다. 재정보수(anomaly)·DOGE식 지출 삭감 요구가 겹치면 합의 지연이 길어진다.",
        market:
          "SPX -3% 이상 조정, TLT 양방향(플라이트투퀄리티 vs 디폴트 공포). 달러 약세·금 강세. 변동성(VIX) 급등 구간 — 포지션 축소·헤지 비용 상승.",
        watch: ["SPY", "TLT", "GLD", "UUP", "VIXY"],
        tickers: ["TLT", "GLD", "SPY"],
      },
    ],
    history: [
      {
        year: "2013 (16일)",
        days: 16,
        spx_note: "기간 +2.4%",
        tlt_note: "금리 불확실(채무한도)로 요인 혼재",
        gold_note: "상대 강세",
        lesson: "초기 하락 후 재개 전 회복 — anticipation effect.",
      },
      {
        year: "2018–19 (35일)",
        days: 35,
        spx_note: "기간 +10~11%",
        tlt_note: "TLT -1% 미만",
        gold_note: "약 +5%",
        lesson: "연준 피벗·실적이 셧다운보다 지배 — 인과 분리 필요.",
      },
      {
        year: "2023 (채무한도)",
        days: 0,
        spx_note: "협상 지연 시 -6.7% (2011 유사)",
        tlt_note: "플라이트 투 퀄리티",
        gold_note: "헤지 수요",
        lesson: "셧다운보다 디폴트 리스크가 훨씬 큰 이벤트.",
      },
    ],
    sources: [
      {
        name: "CRS R49353 (FY2027 CR)",
        url: "https://www.everycrsreport.com/reports/R49353.html",
      },
      {
        name: "Congress.gov H.R.6500",
        url: "https://www.congress.gov/bill/119th-congress/house-bill/6500",
      },
      {
        name: "Roll Call (2026-09-01)",
        url: "https://rollcall.com/2026/09/01/funding-extension-clears-house-avoiding-shutdown-threat/",
      },
    ],
    note: "교육용 시나리오 맵입니다. 확률·수치는 역사적 패턴과 2026년 9월 입법 상황을 바탕으로 한 편집 추정이며, 투자·법률 자문이 아닙니다.",
  };
}

export const BUDGET_SCENARIO_TONE_LABEL: Record<BudgetScenarioTone, string> = {
  base: "기본",
  risk: "리스크",
  tail: "꼬리",
  upside: "상방",
};
