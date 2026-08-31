/** Labor-union event study (Event Study tab, 노동리스크 mode). */

export const LABOR_HORIZONS = [0, 5, 20] as const;
export type LaborHorizon = (typeof LABOR_HORIZONS)[number];

export type LaborStage = "demand" | "rights" | "action";
export type LaborActionKind = "strike" | "settle" | "occupy" | "reject" | "rally";

export type LaborCompanyId =
  | "samsung"
  | "bio"
  | "hynix"
  | "hyundai"
  | "kia"
  | "posco"
  | "hhi"
  | "naver"
  | "kakao"
  | "hanwha";

export type LaborCompany = {
  id: LaborCompanyId;
  label: string;
  ticker: string;
  yahoo: string;
  sector: string;
  note: string;
};

export type LaborEvent = {
  id: string;
  company: LaborCompanyId;
  stage: LaborStage;
  date: string;
  label: string;
  summary: string;
  news: string;
  actionKind?: LaborActionKind;
  confidence: "high" | "medium";
  source: string;
};

export type LaborWindowReturn = {
  horizon: LaborHorizon;
  return_pct: number | null;
  kospi_pct: number | null;
  excess_pct: number | null;
  end_date?: string;
  truncated?: boolean;
  error?: string;
};

export type LaborEventResult = LaborEvent & {
  company_label: string;
  ticker: string;
  event_date: string;
  trading_date?: string;
  prior_date?: string;
  prior_px?: number;
  windows: LaborWindowReturn[];
};

export type StageStat = {
  stage: LaborStage;
  label: string;
  n: number;
  mean_d0: number | null;
  mean_d5: number | null;
  mean_d20: number | null;
  mean_xs_d0: number | null;
  mean_xs_d5: number | null;
  mean_xs_d20: number | null;
  win_xs_d5: number | null;
};

export type CompanyStat = {
  id: LaborCompanyId;
  label: string;
  ticker: string;
  n: number;
  mean_xs_d0: number | null;
  mean_xs_d5: number | null;
  mean_xs_d20: number | null;
  win_xs_d5: number | null;
  news: string;
};

export type LaborRiskPayload = {
  ok: boolean;
  error?: string;
  generated_at?: string;
  source?: string;
  note?: string;
  companies?: LaborCompany[];
  stages?: Array<{ id: LaborStage; label: string }>;
  events?: LaborEventResult[];
  stage_stats?: StageStat[];
  company_stats?: CompanyStat[];
  overall_ko?: string;
  differentiation_ko?: string;
};

export const STAGE_META: Array<{ id: LaborStage; label: string; detail: string }> = [
  {
    id: "demand",
    label: "요구안·갈등 공개",
    detail: "임금·단체 요구안이 처음 알려지거나, 갈등이 시장에 처음 인지된 날",
  },
  {
    id: "rights",
    label: "쟁의권·교섭 결렬",
    detail: "조정 중지·쟁의찬반 가결 등 합법 파업권이 생기거나 교섭이 공식 결렬된 날",
  },
  {
    id: "action",
    label: "파업·타결",
    detail: "실제 파업(또는 점거) 돌입, 잠정합의 가결, 부결 등 결과가 나온 날",
  },
];

export const STAGE_LABEL: Record<LaborStage, string> = Object.fromEntries(
  STAGE_META.map((s) => [s.id, s.label]),
) as Record<LaborStage, string>;

export const LABOR_COMPANIES: LaborCompany[] = [
  {
    id: "samsung",
    label: "삼성전자",
    ticker: "005930",
    yahoo: "005930.KS",
    sector: "반도체",
    note: "전삼노. 2024년 창사 첫 파업이 상징 이벤트",
  },
  {
    id: "bio",
    label: "삼성바이오로직스",
    ticker: "207940",
    yahoo: "207940.KS",
    sector: "바이오",
    note: "연속공정이라 파업 시 배치 손실 위험이 큼",
  },
  {
    id: "hynix",
    label: "SK하이닉스",
    ticker: "000660",
    yahoo: "000660.KS",
    sector: "반도체",
    note: "실제 파업보다 성과급(PS) 산식 합의·부결이 핵심",
  },
  {
    id: "hyundai",
    label: "현대차",
    ticker: "005380",
    yahoo: "005380.KS",
    sector: "자동차",
    note: "2025년 6년 무파업 기록이 깨진 부분파업",
  },
  {
    id: "kia",
    label: "기아",
    ticker: "000270",
    yahoo: "000270.KS",
    sector: "자동차",
    note: "쟁의권은 확보했으나 실제 파업 없이 타결",
  },
  {
    id: "posco",
    label: "포스코홀딩스",
    ticker: "005490",
    yahoo: "005490.KS",
    sector: "철강",
    note: "포스코 조업 노조. 홀딩스 상장사로 주가 관찰",
  },
  {
    id: "hhi",
    label: "HD현대중공업",
    ticker: "329180",
    yahoo: "329180.KS",
    sector: "조선",
    note: "반복 부분파업 + 수주·마스가 서사와 겹침",
  },
  {
    id: "naver",
    label: "네이버",
    ticker: "035420",
    yahoo: "035420.KS",
    sector: "인터넷",
    note: "본사는 조기 타결, 갈등은 계열 네이버제트 중심",
  },
  {
    id: "kakao",
    label: "카카오",
    ticker: "035720",
    yahoo: "035720.KS",
    sector: "인터넷",
    note: "2026년 창사 첫 본사 부분파업. 서비스 중단은 제한적",
  },
  {
    id: "hanwha",
    label: "한화오션",
    ticker: "042660",
    yahoo: "042660.KS",
    sector: "조선",
    note: "2022년 하청 51일 파업·독 점거가 가장 강한 생산 충격",
  },
];

export const COMPANY_BY_ID = Object.fromEntries(
  LABOR_COMPANIES.map((c) => [c.id, c]),
) as Record<LaborCompanyId, LaborCompany>;

/**
 * Curated D-days. Only dates tied to a dated news report are included.
 * Stage mapping follows the three-hurdle labor calendar:
 *   demand → first public demand/conflict
 *   rights → strike mandate or official breakdown/mediation stop
 *   action → actual walkout or ratification (or rejection)
 */
export const LABOR_EVENTS: LaborEvent[] = [
  // ── 삼성전자 2024 ──────────────────────────────────────────
  {
    id: "sec-2024-demand",
    company: "samsung",
    stage: "demand",
    date: "2024-02-06",
    label: "삼성노조연대 임금 요구",
    summary: "관계사 노조 연대가 임금 5.4% 인상 등을 공개 요구. 창사 후 노조 리스크가 시황 이슈로 올라온 시점.",
    news: "전삼노·연대가 임금·성과급 의제를 전면에 올렸고, 이후 사측 2.5% vs 노조 8% 격차가 보도되며 ‘무노조 삼성’ 관행이 깨질 수 있다는 해석이 나왔다. 반도체 업황·HBM 뉴스에 가려 주가 민감도는 제한적이었다.",
    confidence: "high",
    source: "연합·ZDNet 2024-02",
  },
  {
    id: "sec-2024-rights",
    company: "samsung",
    stage: "rights",
    date: "2024-04-08",
    label: "쟁의찬반 97.5% 가결",
    summary: "중노위 조정 중지 이후 5개 노조 쟁의 투표. 전삼노 중심 97.5% 찬성으로 합법 파업권 확보(DX노조는 투표율 미달).",
    news: "2월 20일 6차 본교섭 결렬→조정 중지→4월 8일 투표 결과 발표. 창사 55년 만의 합법 파업 가능 국면. 다만 DX(디바이스) 노조는 불참 의사를 밝혀 사업부 간 온도 차가 드러났다.",
    confidence: "high",
    source: "동아일보 2024-04-08",
  },
  {
    id: "sec-2024-strike",
    company: "samsung",
    stage: "action",
    date: "2024-07-08",
    label: "창사 첫 총파업",
    summary: "7/8~10 3일 총파업. 5월 29일 파업 선언, 6월 7일 연가투쟁을 거친 뒤의 실제 현장 집회.",
    news: "노조는 6,500명 참여·생산 차질을 주장했고 사측은 3,000명·차질 없다고 반박. 파운드리·메모리  sym볼은 컸지만 가동 중단 증거는 약했다. 2분기 실적 반등·AI 반도체 서사와 겹쳐 노동 이벤트만으로 추세가 꺾이지는 않았다.",
    actionKind: "strike",
    confidence: "high",
    source: "KBS·연합 2024-07-08",
  },

  // ── 삼성바이오로직스 2026 ──────────────────────────────────
  {
    id: "bio-2026-rights",
    company: "bio",
    stage: "rights",
    date: "2026-03-23",
    label: "조정 중지·교섭 결렬",
    summary: "12월부터 13차 교섭 실패 후 조정 절차 중단. 24일부터 파업 찬반투표 돌입.",
    news: "요구안은 기본급 14%대, 영업이익 20% 성과급, 1인당 3,000만 원 격려금, 인사·M&A 사전합의. 사측은 6.2%+일시금. 바이오 연속공정 특성상 ‘파업=배치 폐기’ 리스크가 반도체·IT보다 직접적이다.",
    confidence: "high",
    source: "EBN·아시아경제 2026-03",
  },
  {
    id: "bio-2026-vote",
    company: "bio",
    stage: "rights",
    date: "2026-03-29",
    label: "파업 찬반 95.5% 가결",
    summary: "투표율 95.4%, 찬성 95.5%. 창사 첫 파업이 일정에 올라온 날.",
    news: "조합원 약 75%가 노조 가입된 상태에서 압도적 찬성. 법원은 이후 핵심 공정 쟁의금지 가처분을 일부 인용했지만, 부분→전면 파업 일정은 유지됐다.",
    confidence: "high",
    source: "아시아경제 2026-03-30",
  },
  {
    id: "bio-2026-strike",
    company: "bio",
    stage: "action",
    date: "2026-05-01",
    label: "창사 첫 전면파업",
    summary: "4/28~30 부분파업 뒤 5/1~5 전면파업. 이후 준법투쟁으로 장기화, 회사 추산 생산 차질 약 1,500억.",
    news: "조합원 2,800여 명 참여. 세포 배양 중단 시 제품 폐기 가능성이 부각되며 증권가 목표주가 하향이 이어졌다. 8월 사후조정 합의까지도 미타결 — 이 샘플에서 유일하게 ‘실제 생산 충격 + 미해소’가 동시에 남은 케이스.",
    actionKind: "strike",
    confidence: "high",
    source: "연합 2026-05-01",
  },

  // ── SK하이닉스 2025–26 ─────────────────────────────────────
  {
    id: "hynix-2025-break",
    company: "hynix",
    stage: "rights",
    date: "2025-07-28",
    label: "10차 교섭 결렬",
    summary: "PS 상한(1,700%+α) vs 영업이익 10% 전액 지급 이견. 강경 투쟁 국면 선언.",
    news: "5~7월 10차례 교섭. 사측은 PS 한도 상향, 노조는 2021년 ‘영업익 10% 재원’ 문구의 전액 지급을 요구. 실제 라인 스톱보다는 ‘보상 산식’ 이슈라 주가는 HBM·실적 모멘텀이 지배했다.",
    confidence: "high",
    source: "파이낸셜뉴스 2025-07-29",
  },
  {
    id: "hynix-2025-rally",
    company: "hynix",
    stage: "action",
    date: "2025-08-06",
    label: "첫 총력투쟁 결의대회",
    summary: "청주 1차(8/6), 이천 2차(8/12). 창사 이래 첫 조합원 총력투쟁 결의. 실제 총파업은 없었음.",
    news: "파업 전운은 있었으나 현장 가동 중단으로 이어지지 않았다. 한 달 뒤 PS 상한 폐지·영업익 10% 재원 10년 유지를 합의하며 ‘인재 쟁탈전’ 프레임으로 전환.",
    actionKind: "rally",
    confidence: "high",
    source: "매일경제 2025-08-06",
  },
  {
    id: "hynix-2025-settle",
    company: "hynix",
    stage: "action",
    date: "2025-09-04",
    label: "PS 상한 폐지 타결",
    summary: "임금 6% + 영업익 10% PS·상한 폐지, 대의원 찬성 95.4% 역대 최고.",
    news: "반도체 호황기 ‘성과 공유’가 제도화된 날. 삼성전자 보상 체계와 비교 뉴스가 따라붙었고, 노동 리스크 해소 + 인력 락인으로 읽히는 편이었다.",
    actionKind: "settle",
    confidence: "high",
    source: "연합 2025-09-04",
  },
  {
    id: "hynix-2026-reject",
    company: "hynix",
    stage: "action",
    date: "2026-08-25",
    label: "자사주 PS 잠정안 부결",
    summary: "PS 60% 자사주 지급안, 전임직 25표 차 부결. 사무직은 가결 → 재교섭.",
    news: "1년 만에 현금 중심 PS를 주식으로 바꾼 데 대한 반발. 신생 통합노조 가입이 늘며 노노 갈등 불씨. HBM 업사이클 한가운데라 주가 충격은 생산 차질형 파업보다 작을 가능성이 크다.",
    actionKind: "reject",
    confidence: "high",
    source: "연합 2026-08-25",
  },

  // ── 현대차 2025 ────────────────────────────────────────────
  {
    id: "hyundai-2025-demand",
    company: "hyundai",
    stage: "demand",
    date: "2025-06-18",
    label: "임단협 상견례",
    summary: "83일 교섭의 시작. 기본급·성과금·정년·주 4.5일제가 테이블에 올랐다.",
    news: "미국 관세·환율·전기차 캐즘이 사측 명분이었고, 노조는 실적 대비 보상·정년을 요구. 요구안 공개 자체보다 이후 부분파업 여부가 시장 초점이었다.",
    confidence: "high",
    source: "헤럴드경제 2025-09",
  },
  {
    id: "hyundai-2025-strike",
    company: "hyundai",
    stage: "action",
    date: "2025-09-03",
    label: "7년 만 부분파업",
    summary: "9/3~5 2~4시간 부분파업. 6년 연속 무파업 기록 종료. 같은 날 HD현대중공업과 9년 만 동시 파업.",
    news: "9/1부터 연장·특근 중단, 9/2 사측 2차안(기본급 9.5만 원 등) 거부. 미국 관세 악재와 겹쳐 ‘생산 차질+수출 비용’ 이중 프레임. 다만 전면 파업이 아니라 시간 단위 부분파업이라 조업 충격은 제한적이었다.",
    actionKind: "strike",
    confidence: "high",
    source: "연합·뉴시스 2025-09-03",
  },
  {
    id: "hyundai-2025-settle",
    company: "hyundai",
    stage: "action",
    date: "2025-09-15",
    label: "잠정합의 가결",
    summary: "9/9 잠정합의, 15일 투표 찬성 52.9%. 기본급 10만 원, 성과금 450%+1,580만 원.",
    news: "파업 시작 12일 만 타결. 찬성률이 간신히 과반이라 내부 불만은 남았지만, 시장은 ‘조기 봉합’으로 해석. 정년·주 4.5일제는 올해 의제에서 빠졌다.",
    actionKind: "settle",
    confidence: "high",
    source: "헤럴드경제 2025-09-16",
  },

  // ── 기아 2025 ──────────────────────────────────────────────
  {
    id: "kia-2025-break",
    company: "kia",
    stage: "demand",
    date: "2025-09-12",
    label: "5차 상견례 무산·조정신청",
    summary: "기본급 14.1만 원, 영업익 30% 성과급, 정년 64세, 주 4일제 등 요구. 중노위 조정 신청.",
    news: "현대차보다 공격적인 요구안. 역대 실적(매출 100조, 영업익 12.7조)을 근거로 내세운 반면 사측은 미국 관세를 이유로 거부. 갈등 수위는 높았으나 이후 실제 파업은 없었다.",
    confidence: "high",
    source: "동아일보 2025-09-20",
  },
  {
    id: "kia-2025-rights",
    company: "kia",
    stage: "rights",
    date: "2025-09-19",
    label: "파업 찬반 79.5% 가결",
    summary: "투표율 86.6%, 총원 대비 찬성 79.5%. 중노위 중지 시 합법 파업권.",
    news: "현대차가 이미 타결된 뒤라 ‘형은 스톱, 동생은 장전’ 프레임. 쟁대위는 22일 회의. 시장은 파업 실행보다 현대차 합의안을 벤치마크한 타결 가능성을 더 높게 봤다.",
    confidence: "high",
    source: "경향 2025-09-19",
  },
  {
    id: "kia-2025-settle",
    company: "kia",
    stage: "action",
    date: "2025-09-30",
    label: "5년 연속 무분규 타결",
    summary: "9/25 잠정합의, 30일 찬성 73.1%. 쟁의권은 있었으나 파업 없이 봉합.",
    news: "기본급 10만 원, 성과·격려금 패키지, 생산직 500명 채용. 현대차 부분파업을 반면교사로 무분규를 선택한 차별화. 같은 그룹인데도 파업 실행 여부가 갈렸다.",
    actionKind: "settle",
    confidence: "high",
    source: "헤럴드경제 2025-09-30",
  },

  // ── 포스코홀딩스 2026 ──────────────────────────────────────
  {
    id: "posco-2026-demand",
    company: "posco",
    stage: "demand",
    date: "2026-06-12",
    label: "임단협 상견례",
    summary: "기본급 7.1%, 격려금 600%, 우리사주 50주 등. 사측 추산 요구안 총재원 약 1.4조.",
    news: "6/16 1차 본교섭. 중국 저가 공세·보호무역이 사측 명분(기본급 1.5%안). 홀딩스 주가는 철강 스프레드·리튬 자회사 이슈와 동시에 움직인다.",
    confidence: "high",
    source: "이투데이 2026-07-23",
  },
  {
    id: "posco-2026-break",
    company: "posco",
    stage: "rights",
    date: "2026-07-23",
    label: "6차 교섭 결렬",
    summary: "유튜브 라이브로 결렬 선언, 중노위 조정신청. 7/8~9 쟁의 투표는 이미 92.2% 가결 상태.",
    news: "투표를 먼저 해 두고 결렬을 선언한 압박 순서. 위원장은 ‘당장의 파업은 목적 아님’이라 선을 그어, 권리 확보와 실행을 분리했다.",
    confidence: "high",
    source: "이투데이 2026-07-23",
  },
  {
    id: "posco-2026-rights",
    company: "posco",
    stage: "rights",
    date: "2026-08-18",
    label: "중노위 조정 중지",
    summary: "창사 58년 만 합법 파업권 확보. 즉각 파업은 하지 않고 추가 교섭. 9/9를 시한으로 거론.",
    news: "삼성전자 2024와 같은 ‘첫 파업 가능’ 헤드라인. 고로 연속조업 특성상 전면파업 비용이 커 노사 모두 실행 문턱이 높다. 샘플 작성 시점(2026-08-31) 기준 실제 파업은 없음.",
    confidence: "high",
    source: "연합 2026-08-18",
  },

  // ── HD현대중공업 2024–25 ───────────────────────────────────
  {
    id: "hhi-2024-demand",
    company: "hhi",
    stage: "demand",
    date: "2024-06-04",
    label: "임단협 상견례",
    summary: "기본급 15.98만 원, 성과급 산식, 정년 연장 요구. 이후 90일 가까이 사측 제시안 지연.",
    news: "조선 호황기 ‘정기선만의 잔치’ 프레임. 수주 잔고는 우호적이나 반복 파업이 인도 일정 리스크로 연결된다는 점이 자동차·IT와 다르다.",
    confidence: "high",
    source: "뉴스웍스 2024-11-21",
  },
  {
    id: "hhi-2024-strike",
    company: "hhi",
    stage: "action",
    date: "2024-08-28",
    label: "올해 첫 부분파업",
    summary: "8/28 첫 부분파업, 이후 9/4 등 누적 24차례. 현장 충돌 보도.",
    news: "시간 단위 반복 파업이라 한 번의 D-day 충격보다 ‘교섭 장기화’가 할인 요인. 11월 1차 잠정안 부결 후 2차안에서 연내 타결.",
    actionKind: "strike",
    confidence: "high",
    source: "포쓰저널 2024-08-28",
  },
  {
    id: "hhi-2024-settle",
    company: "hhi",
    stage: "action",
    date: "2024-11-21",
    label: "2차 잠정안 가결",
    summary: "찬성 59.2%. 기본급 13만 원. 3년 연속 연내 타결.",
    news: "조선 3사 중 가장 늦은 마침표. 파업 누적 피로와 호황 수주가 동시에 작용한 봉합.",
    actionKind: "settle",
    confidence: "high",
    source: "HD현대 보도 2024-11-21",
  },
  {
    id: "hhi-2025-strike",
    company: "hhi",
    stage: "action",
    date: "2025-09-03",
    label: "조선 3사 공동 부분파업",
    summary: "현대차와 9년 만 동시 파업. 7월 1차 잠정안 부결 이후 11번째 부분파업 국면.",
    news: "크레인 고공농성까지 가며 2024년보다 수위가 높았다. 같은 날 자동차·조선이 동시에 멈춰 ‘울산 리스크’ 헤드라인이 나왔다.",
    actionKind: "strike",
    confidence: "high",
    source: "연합 2025-09-03",
  },
  {
    id: "hhi-2025-settle",
    company: "hhi",
    stage: "action",
    date: "2025-09-19",
    label: "2차 잠정안 가결",
    summary: "찬성 59.6%. 파업·고공농성 종료. 전날 공정위가 미포 합병 승인, 마스가 탄력 해석.",
    news: "노동 봉합과 조선 한·미 협력(MASGA) 뉴스가 같은 주에 겹쳐, 타결 후 반등이 노동만의 효과로 보기 어렵다.",
    actionKind: "settle",
    confidence: "high",
    source: "ZDNet 2025-09-19",
  },

  // ── 네이버 2026 ────────────────────────────────────────────
  {
    id: "naver-2026-settle",
    company: "naver",
    stage: "action",
    date: "2026-05-11",
    label: "본사 임금 5.3% 타결",
    summary: "집중 교섭 3주 만 잠정합의. 본사 파업 리스크는 조기 소멸.",
    news: "같은 시기 카카오는 결렬·조정으로 가 대조. 상장사 네이버 주가 관점에서 본사 임단협은 무이슈에 가깝고, 이후 갈등은 적자 계열 네이버제트로 이동했다.",
    actionKind: "settle",
    confidence: "high",
    source: "데일리안 2026-05-11",
  },
  {
    id: "naver-2026-z-rights",
    company: "naver",
    stage: "rights",
    date: "2026-07-24",
    label: "네이버제트 조정 중지",
    summary: "2월 26일 교섭 개시, 임금 0%안 충돌. 7/16·24 조정 중지 후 쟁의찬반 88.6%/98% 가결.",
    news: "제페토 운영사 완전자본잠식·누적 적자. 본사 5.3%와의 격차가 핵심 불만. 상장 모회사 주가에 대한 직접 생산 충격은 없고, ‘그룹 통합교섭’ 요구로 번질지가 관전 포인트.",
    confidence: "high",
    source: "서울파이낸스 2026-08",
  },
  {
    id: "naver-2026-unify",
    company: "naver",
    stage: "demand",
    date: "2026-08-20",
    label: "16개 법인 통합교섭 요구",
    summary: "1784 선포식, 5대 요구안. 8월 말 무응답 시 9/9 제트 행동의 날 예고.",
    news: "본사 주가에 연결되는 지점은 ‘계열 노조가 네이버를 사용자로 묶으려 한다’는 거버넌스 이슈. 샘플 작성 시점 기준 9/9는 미래 일정.",
    confidence: "high",
    source: "연합 2026-08-20",
  },

  // ── 카카오 2026 ────────────────────────────────────────────
  {
    id: "kakao-2026-demand",
    company: "kakao",
    stage: "demand",
    date: "2026-05-15",
    label: "임금교섭 결렬·조정신청",
    summary: "연봉·성과 보상(영업익 연동, RSU 500만 원 포함 여부) 이견. 경기지노위 조정, 20일 결의대회 예고.",
    news: "카카오모빌리티 2025 파업과 달리 본사 교섭이 깨진 첫 해. 계열 매각·분사에 따른 고용 불안이 임금 숫자와 함께 의제화됐다.",
    confidence: "high",
    source: "연합 2026-05-15",
  },
  {
    id: "kakao-2026-rights",
    company: "kakao",
    stage: "rights",
    date: "2026-05-27",
    label: "2차 조정 중지",
    summary: "1차(5/18) 연장 후 2차 중지. 본사 합법 파업권 확보. 계열 4사도 쟁의권.",
    news: "다음날부터 ‘카톡·페이 멈출 수 있나’ 헤드라인. 자동화 비중이 높아 전면 서비스 중단 가능성은 낮다는 사측 설명이 따라붙었다.",
    confidence: "high",
    source: "경향 2026-05-27",
  },
  {
    id: "kakao-2026-strike",
    company: "kakao",
    stage: "action",
    date: "2026-06-10",
    label: "창사 첫 본사 부분파업",
    summary: "10:00~15:00 4~5시간, 판교 행진. 본사+페이+엔터프라이즈 등 5법인, 약 1,500명.",
    news: "상징성은 크나 조업 중단형 제조 파업과 질이 다르다. 6/29 로그오프 데이가 예고됐으나, 주가 동인은 광고·커머스·구조조정 뉴스가 더 큰 경우가 많다.",
    actionKind: "strike",
    confidence: "high",
    source: "파이낸셜뉴스 2026-06-10",
  },

  // ── 한화오션(대우조선) 2022·2025 ──────────────────────────
  {
    id: "hanwha-2022-strike",
    company: "hanwha",
    stage: "demand",
    date: "2022-06-02",
    label: "하청노조 파업 돌입",
    summary: "임금 30%·상여 300%·전임자 인정 요구. 51일 파업의 D-day. 당시 사명 대우조선해양.",
    news: "원청 정규직이 아닌 사내하청 파업이라 교섭 주체가 복잡했다. 요구안 공개와 실제 파업이 같은 날 — 이 샘플에서 갈등 인지와 생산 충격이 동시에 온 유일한 케이스.",
    confidence: "high",
    source: "연합 2022-07-22",
  },
  {
    id: "hanwha-2022-occupy",
    company: "hanwha",
    stage: "rights",
    date: "2022-06-22",
    label: "1독 점거·옥쇄농성",
    summary: "세계 최대 도크 작업 마비, VLCC 인도 지연. 대통령이 공권력 투입을 시사할 정도로 정치 이슈화.",
    news: "합법 쟁의권을 넘어선 시설 점거. 주가 충격이 가장 컸을 구간으로, ‘노동 리스크 = 수주잔고 훼손’이 숫자로 나타난 사례. 이후 470억 손배소로 잔여 리스크가 3년 남았다.",
    actionKind: "occupy",
    confidence: "high",
    source: "중앙일보 2022-06/2025-02",
  },
  {
    id: "hanwha-2022-settle",
    company: "hanwha",
    stage: "action",
    date: "2022-07-22",
    label: "51일 만에 타결",
    summary: "임금 4.5%, 명절·하기휴가비. 점거 해제 조건의 잠정합의.",
    news: "요구 30%에서 4.5%로 급히 접힌 봉합. 생산 정상화 기대로 단기 안도, 다만 손배·형사 리스크는 2025년까지 잔존.",
    actionKind: "settle",
    confidence: "high",
    source: "연합 2022-07-22",
  },
  {
    id: "hanwha-2025-lawsuit",
    company: "hanwha",
    stage: "action",
    date: "2025-10-28",
    label: "470억 손배소 취하",
    summary: "한화 인수 후 하청지회 간부 5인 상대 소송을 취하. 2022 파업의 잔여 리스크 해소.",
    news: "파업 D-day는 아니지만 ‘노동 꼬리 리스크’가 닫힌 날. 조선 호황·수주와 맞물려 긍정적 해석이 우세.",
    actionKind: "settle",
    confidence: "high",
    source: "경향 2025-10-28",
  },
];

export type PricePoint = { date: string; close: number };

export function isoTodayKst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function indexOnOrAfter(dates: string[], iso: string): number {
  for (let i = 0; i < dates.length; i++) {
    if (dates[i]! >= iso) return i;
  }
  return -1;
}

export function windowReturn(
  points: PricePoint[],
  eventIso: string,
  horizon: LaborHorizon,
): Omit<LaborWindowReturn, "kospi_pct" | "excess_pct"> {
  if (points.length < 3) {
    return { horizon, return_pct: null, error: "시계열 없음" };
  }
  const dates = points.map((p) => p.date);
  const t0 = indexOnOrAfter(dates, eventIso);
  if (t0 <= 0) {
    return { horizon, return_pct: null, error: t0 < 0 ? "이후 시세 없음" : "전일 종가 없음" };
  }
  const prior = points[t0 - 1]!;
  const endIdx = t0 + horizon;
  if (endIdx >= points.length) {
    const last = points[points.length - 1]!;
    if (last.date <= prior.date || prior.close <= 0) {
      return { horizon, return_pct: null, error: "구간 부족", truncated: true };
    }
    const ret = (last.close / prior.close - 1) * 100;
    return {
      horizon,
      return_pct: Number.isFinite(ret) ? ret : null,
      end_date: last.date,
      truncated: true,
      error: Number.isFinite(ret) ? undefined : "계산 실패",
    };
  }
  const end = points[endIdx]!;
  if (!(prior.close > 0) || !(end.close > 0)) {
    return { horizon, return_pct: null, error: "가격 없음" };
  }
  const ret = (end.close / prior.close - 1) * 100;
  return {
    horizon,
    return_pct: Number.isFinite(ret) ? ret : null,
    end_date: end.date,
    error: Number.isFinite(ret) ? undefined : "계산 실패",
  };
}

function mean(vals: number[]): number | null {
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function pickHorizon(row: LaborEventResult, h: LaborHorizon, key: "return_pct" | "excess_pct"): number | null {
  const w = row.windows.find((x) => x.horizon === h);
  const v = w?.[key];
  return v == null || Number.isNaN(v) ? null : v;
}

export function stageStats(rows: LaborEventResult[]): StageStat[] {
  return STAGE_META.map((meta) => {
    const subset = rows.filter((r) => r.stage === meta.id);
    const xs0 = subset.map((r) => pickHorizon(r, 0, "excess_pct")).filter((n): n is number => n != null);
    const xs5 = subset.map((r) => pickHorizon(r, 5, "excess_pct")).filter((n): n is number => n != null);
    const xs20 = subset.map((r) => pickHorizon(r, 20, "excess_pct")).filter((n): n is number => n != null);
    const d0 = subset.map((r) => pickHorizon(r, 0, "return_pct")).filter((n): n is number => n != null);
    const d5 = subset.map((r) => pickHorizon(r, 5, "return_pct")).filter((n): n is number => n != null);
    const d20 = subset.map((r) => pickHorizon(r, 20, "return_pct")).filter((n): n is number => n != null);
    return {
      stage: meta.id,
      label: meta.label,
      n: subset.length,
      mean_d0: mean(d0),
      mean_d5: mean(d5),
      mean_d20: mean(d20),
      mean_xs_d0: mean(xs0),
      mean_xs_d5: mean(xs5),
      mean_xs_d20: mean(xs20),
      win_xs_d5: xs5.length ? (100 * xs5.filter((x) => x > 0).length) / xs5.length : null,
    };
  });
}

const COMPANY_DIFF: Record<LaborCompanyId, string> = {
  samsung:
    "상징 파업이었고 사측은 ‘생산 차질 없다’고 맞받았다. DS 비중이 큰 전삼노 파업인데도 HBM·실적 뉴스가 주가를 더 좌우했다. 무노조 신화 붕괴라는 헤드라인 대비 초과수익 민감도는 낮을 가능성이 크다.",
  bio: "이 유니버스에서 생산 충격이 가장 직접적이다. 연속 배양 공정 + 1,500억 차질 추산 + 8월까지 미타결. 목표주가 하향이 노동 이슈와 같이 나온 드문 케이스.",
  hynix:
    "라인 스톱이 아니라 PS 산식 싸움. 2025년 타결은 ‘인재 락인’으로 읽혀 부정적 노동 쇼크가 아니었다. 2026년 자사주 PS 부결은 재교섭이지 파업이 아니다.",
  hyundai:
    "7년 만 부분파업이 미국 관세 악재와 같은 주에 겹쳤다. 전면 파업이 아니라 2~4시간이라 조업 충격은 제한, 12일 만 타결로 봉합 속도는 빨랐다. 찬성률 52.9%는 내부 불만 잔존을 시사.",
  kia: "같은 그룹인데 현대차와 반대로 쟁의권만 확보하고 파업은 안 했다. 현대차 합의안을 벤치마크해 5년 연속 무분규. ‘권리 확보 ≠ 주가 충격’의 대표 사례.",
  posco:
    "58년 무분규 파괴 가능 헤드라인. 고로 연속조업이라 전면파업 문턱이 높고, 8월 말 기준 실행 전. 홀딩스 주가는 철강 스프레드·이차전지 자회사와 노동이 섞여 있다.",
  hhi: "반복 부분파업(2024년 24회)이라 한 방의 D-day보다 교섭 장기화가 할인 요인. 타결 국면은 수주·마스가 뉴스와 겹쳐 노동만의 반등으로 보기 어렵다.",
  naver:
    "본사는 3주 만에 5.3% 타결로 무이슈. 갈등은 적자 계열 네이버제트·통합교섭 요구. 소프트웨어라 생산 차질 경로가 없고 거버넌스 이슈에 가깝다.",
  kakao:
    "창사 첫 본사 파업의 상징성은 크나 4~5시간 부분파업·자동화 서비스라 카톡 중단 리스크는 과장된 편. 구조조정·계열 매각 고용 불안정이 본 의제.",
  hanwha:
    "샘플 최악 생산 충격 — 51일, 1독 점거, VLCC 인도 지연, 공권력 투입 언급. 요구안 공개일과 파업일이 같다. 2025년 손배소 취하는 잔여 꼬리 리스크 종료.",
};

export function companyStats(rows: LaborEventResult[]): CompanyStat[] {
  return LABOR_COMPANIES.map((c) => {
    const subset = rows.filter((r) => r.company === c.id);
    const xs0 = subset.map((r) => pickHorizon(r, 0, "excess_pct")).filter((n): n is number => n != null);
    const xs5 = subset.map((r) => pickHorizon(r, 5, "excess_pct")).filter((n): n is number => n != null);
    const xs20 = subset.map((r) => pickHorizon(r, 20, "excess_pct")).filter((n): n is number => n != null);
    return {
      id: c.id,
      label: c.label,
      ticker: c.ticker,
      n: subset.length,
      mean_xs_d0: mean(xs0),
      mean_xs_d5: mean(xs5),
      mean_xs_d20: mean(xs20),
      win_xs_d5: xs5.length ? (100 * xs5.filter((x) => x > 0).length) / xs5.length : null,
      news: COMPANY_DIFF[c.id],
    };
  });
}

function fmt(n: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function buildOverallNarrative(stats: StageStat[], rows: LaborEventResult[]): string {
  const demand = stats.find((s) => s.stage === "demand");
  const rights = stats.find((s) => s.stage === "rights");
  const action = stats.find((s) => s.stage === "action");
  const xs0 = rows
    .map((r) => pickHorizon(r, 0, "excess_pct"))
    .filter((n): n is number => n != null);
  const xs5 = rows
    .map((r) => pickHorizon(r, 5, "excess_pct"))
    .filter((n): n is number => n != null);
  const win = xs5.length ? (100 * xs5.filter((x) => x > 0).length) / xs5.length : null;
  const strikes = rows.filter((r) => r.actionKind === "strike" || r.actionKind === "occupy");
  const settles = rows.filter((r) => r.actionKind === "settle");
  const strikeXs = strikes
    .map((r) => pickHorizon(r, 5, "excess_pct"))
    .filter((n): n is number => n != null);
  const settleXs = settles
    .map((r) => pickHorizon(r, 5, "excess_pct"))
    .filter((n): n is number => n != null);

  const bits: string[] = [];
  bits.push(
    `표본 ${rows.length}개 이벤트(10개사, 2022~2026)를 코스피 대비 초과수익률로 보면, 기준일(D) 평균 ${fmt(mean(xs0))}p, D+5 평균 ${fmt(mean(xs5))}p입니다. D+5 초과수익이 플러스인 비율은 ${win == null ? "—" : `${win.toFixed(0)}%`}입니다.`,
  );
  bits.push(
    `단계별로 보면 요구안·갈등 공개 D+5 초과 ${fmt(demand?.mean_xs_d5 ?? null)}p, 쟁의권·결렬 ${fmt(rights?.mean_xs_d5 ?? null)}p, 파업·타결 ${fmt(action?.mean_xs_d5 ?? null)}p입니다. 헤드라인이 커져도 당일 충격이 작고, D+5~D+20에 섹터 뉴스와 섞이며 흐려지는 경우가 많습니다.`,
  );
  bits.push(
    `파업·점거만 모으면 D+5 초과 ${fmt(mean(strikeXs))}p, 타결·소 취하는 ${fmt(mean(settleXs))}p입니다. 생산이 실제로 멈춘 사건(한화오션 2022 독 점거, 삼성바이오 2026 전면파업)과, 권리만 확보하거나 몇 시간 부분파업에 그친 사건(삼성전자 2024, 카카오 2026, 기아 2025)은 주가 반응이 질적으로 다릅니다.`,
  );
  bits.push(
    `공통 특징은 ① 한국 대형주는 노동 이벤트보다 업황(반도체 사이클, 자동차 관세, 조선 수주, 철강 스프레드)이 더 큰 경우가 많고 ② ‘첫 파업’ 헤드라인은 당일 변동성을 키우지만 지속 할인은 생산 차질이 숫자로 나올 때 나타나며 ③ 타결은 안도 반등보다 ‘원래 보던 업황 차트’로 돌아가는 쪽에 가깝습니다.`,
  );
  return bits.join(" ");
}

export function buildDifferentiationNarrative(stats: CompanyStat[]): string {
  const ranked = [...stats].filter((s) => s.mean_xs_d5 != null).sort(
    (a, b) => (a.mean_xs_d5 || 0) - (b.mean_xs_d5 || 0),
  );
  const worst = ranked[0];
  const best = ranked[ranked.length - 1];
  const lines = [
    `기업별 D+5 평균 코스피 초과가 가장 부진한 쪽은 ${worst ? `${worst.label}(${fmt(worst.mean_xs_d5)}p)` : "—"}, 가장 양호한 쪽은 ${best ? `${best.label}(${fmt(best.mean_xs_d5)}p)` : "—"}입니다.`,
    "차이가 난 지점은 노조 이슈의 ‘헤드라인 크기’가 아니라 ① 생산이 실제로 멈췄는지 ② 미타결로 남았는지 ③ 같은 주 업황 뉴스의 방향입니다.",
    "한화오션 2022는 하청 51일·도크 점거로 인도 일정 자체가 흔들렸고, 삼성바이오로직스 2026은 배치 폐기형 손실이 공시·증권 리포트에 숫자로 박혔습니다. 반대로 삼성전자 2024 총파업과 카카오 2026 부분파업은 상징 대비 가동률 증거가 약했습니다.",
    "현대차 2025 부분파업은 미국 관세와 겹쳐 노동만의 충격으로 읽기 어렵고, 기아는 쟁의권만 쥐고 파업 없이 타결해 같은 그룹 안에서도 실행 여부가 갈렸습니다. SK하이닉스 2025 타결은 성과급 상한 폐지가 ‘인재 락인’으로 해석돼 전형적인 노조 할인 패턴을 따르지 않았습니다.",
    "네이버는 본사 조기 타결 후 갈등이 적자 계열로 이동했고, 포스코는 58년 만 파업권이라는 헤드라인만 있고 실행 전입니다. HD현대중공업은 반복 부분파업 + 마스가·수주 뉴스가 타결일에 겹칩니다.",
  ];
  return lines.join(" ");
}

export const LABOR_NOTE =
  "수익률은 기준일 직전 거래일 종가 대비 D / D+5 / D+20 거래일 종가입니다. 초과수익률은 같은 창의 코스피 수익률을 뺀 값. 주말·휴일은 다음 거래일로 정렬. 일부 최근 이벤트는 D+20이 아직 없어 마지막 거래일까지 잘린 값(표시)입니다. 기준일은 일자 있는 공신력 보도를 기준으로 했고, 상견례일이 월 단위로만 나온 사건은 넣지 않았습니다.";
