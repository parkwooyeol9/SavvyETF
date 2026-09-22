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
  /** Symbols drawn from midterm ETF quotes when available. */
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
    bill: "H.R.6500 · 2027 회계연도 임시예산 (P.L. 119-103)",
    signed: "2026-09-02",
    cr_start: "2026-10-01",
    cr_end: FY2027_CR_END,
    days_to_cliff: days,
    cliff_label: "2026-12-12(금) ET",
    headline:
      days > 0
        ? "가을 셧다운은 넘겼음. 다음 고비는 12월 11일 임시예산 만료"
        : "임시예산이 끝남. 연장·일괄합의·셧다운 중 하나로 갈림",
    summary:
      "9월 초 하원 370대 48·상원 90대 6으로 72일짜리 임시예산이 서명됐음. 11월 3일 중간선거 뒤엔 민생·방산·보조금 예외를 두고 다시 줄다리기할 가능성이 큼.",
    status_bullets: [
      "10~12월은 대체로 2026년 수준으로 정부를 돌림. CBO 연환산 약 1.701조 달러.",
      "하원 강경파는 보조금 통제 조항에 반발했으나, 선거 앞두고 셧다운을 피하는 쪽이 이겼음.",
      "12월 12일부터는 본예산 12개·임시예산 추가 연장·부분 셧다운 중 하나를 택해야 함.",
      "과거 셧다운 기간 S&P 중간값은 거의 0%였음. 채무한도·지표 공백이 겹치면 흔들림은 커짐.",
    ],
    scenarios: [
      {
        id: "cr-bridge",
        label: "12월에 또 임시예산",
        tone: "base",
        probability_ko: "유력",
        trigger: "12월 11일 직전, 4~8주짜리 임시예산이나 작은 일괄합의로 기한을 미룸.",
        politics:
          "중간선거 직후엔 어느 쪽도 ‘정부 문 닫은 당’이 되고 싶지 않음. 강경파가 보조금·예외를 걸고늘어져도, 짧게 연장해 시간을 사는 쪽이 흔함.",
        market:
          "변동성이 잠깐 튀었다가 금방 가라앉는 편임. S&P는 ±1% 안팎, 채권·금은 안전자산 수요가 조금 붙는 정도. 실적·연준 전망이 여전히 더 셈.",
        watch: ["SPY", "TLT", "GLD", "UUP"],
        tickers: ["SPY", "IWM"],
      },
      {
        id: "short-shutdown",
        label: "닷새~열흘 셧다운",
        tone: "risk",
        probability_ko: "선거 직후",
        trigger: "임시예산이 끊기고 하원 강경파가 버티면 12월 중순~말 부분 셧다운.",
        politics:
          "보조금·방산 예외, WIC·재난 예산이 쟁점임. 민주 하원·공화 상원 분할이면 협상은 더 늘어질 수 있음.",
        market:
          "시작 직후 S&P 1~2% 조정 뒤, 재개되면 대부분 되돌림(2013·2018–19). 고용·물가 발표가 밀리면 장중만 흔들리고 추세는 잘 안 바뀜. 금·초단기채가 상대적으로 단단함.",
        watch: ["SPY", "XLF", "IWM", "GLD", "SHY"],
        tickers: ["SPY", "XLF", "IWM"],
      },
      {
        id: "omnibus-lite",
        label: "일부만 본예산으로",
        tone: "upside",
        probability_ko: "의외 타결",
        trigger:
          "국방·재향군인·교통 등 2~4개만 먼저 확정하고, 나머지는 임시예산으로 넘김.",
        politics:
          "국방·재향군인은 먼저 통과시키고, 국내 지출·보조금 통제는 내년 1분기로 미루는 식임. 9월안에 이미 예외 조항이 들어가 있어 비슷한 틀로 다시 짤 여지는 있음.",
        market:
          "불확실성이 줄면 대형·소형주가 소폭 우위인 편임. 방산(ITA)은 예산이 확정되면 반응하고, 헬스케어(XLV)는 NIH·FDA 예외 유지 여부를 봄.",
        watch: ["ITA", "IWM", "XLV", "SPY"],
        tickers: ["ITA", "IWM", "XLV", "SPY"],
      },
      {
        id: "debt-ceiling-overlap",
        label: "장기 셧다운 + 채무한도",
        tone: "tail",
        probability_ko: "낮은 편",
        trigger: "만료 후 2주 넘게 셧다운이 이어지고, 2027년 초 채무한도 시한까지 겹침.",
        politics:
          "2011·2023처럼 ‘예산 지연’이 아니라 ‘디폴트’ 이야기로 번질 때 충격이 큼. 지출 삭감·보조금 통제가 한꺼번에 들어오면 합의는 더 멀어짐.",
        market:
          "S&P가 3% 이상 밀릴 수 있음. 국채는 안전자산 매수와 디폴트 공포가 동시에 들어와 방향이 갈림. 달러 약세·금 강세, 변동성 비용이 커져 포지션을 줄이는 구간임.",
        watch: ["SPY", "TLT", "GLD", "UUP", "VIXY"],
        tickers: ["SPY", "XLF", "IWM"],
      },
    ],
    history: [
      {
        year: "2013",
        days: 16,
        spx_note: "+2.4%",
        tlt_note: "채무한도와 혼재",
        gold_note: "상대 강세",
        lesson: "초반 하락 뒤 재개 전에 이미 회복한 경우가 많았음.",
      },
      {
        year: "2018–19",
        days: 35,
        spx_note: "+10~11%",
        tlt_note: "TLT -1% 미만",
        gold_note: "약 +5%",
        lesson: "연준·실적이 셧다운보다 더 크게 작용했음.",
      },
      {
        year: "2023*",
        days: 0,
        spx_note: "지연 시 -6.7%",
        tlt_note: "안전자산 매수",
        gold_note: "헤지 수요",
        lesson: "셧다운이 아니라 채무한도 사례. 디폴트 공포가 훨씬 무거웠음.",
      },
    ],
    sources: [
      {
        name: "CRS R49353",
        url: "https://www.everycrsreport.com/reports/R49353.html",
      },
      {
        name: "Congress.gov H.R.6500",
        url: "https://www.congress.gov/bill/119th-congress/house-bill/6500",
      },
      {
        name: "Roll Call (9/1)",
        url: "https://rollcall.com/2026/09/01/funding-extension-clears-house-avoiding-shutdown-threat/",
      },
    ],
    note: "9월 입법·과거 사례 기준 참고용임. 투자·법률 조언 아님. *2023은 채무한도 참고.",
  };
}

export const BUDGET_SCENARIO_TONE_LABEL: Record<BudgetScenarioTone, string> = {
  base: "기본",
  risk: "경계",
  tail: "최악",
  upside: "타결",
};
