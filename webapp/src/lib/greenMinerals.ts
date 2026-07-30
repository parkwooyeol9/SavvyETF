/**
 * Critical Minerals / 녹색 광물 — Phase 1.5 (key-free, curated).
 *
 * In scope (shown in UI):
 * - Mineral taxonomy + industry tags + dual_use
 * - National critical-list membership snapshots (editor-reviewed)
 * - Green–Defence competition matrix (qualitative)
 * - Related ETF Yahoo proxies
 * - Curated geopolitics / policy events
 * - Google News RSS assist
 * - Methodology (definitions, cadence, what we do not claim)
 *
 * Out of scope (not shown in UI — do not re-add as "미구현" teasers):
 * - Licensed exchange mineral prices / Market Tightness
 * - Live USGS/IEA HHI scrapers, trade HS dependency, project maps
 * - Automated social-licence / human-rights scores
 * - Quantitative scenario engine, full DB + daily cron product
 */

export type MineralTag =
  | "clean_energy"
  | "battery"
  | "grid"
  | "semiconductor"
  | "AI_infrastructure"
  | "defence"
  | "aerospace"
  | "nuclear"
  | "industrial"
  | "dual_use";

export type CriticalListId = "US" | "EU" | "CA" | "AU" | "JP" | "KR";

export type GreenMineral = {
  id: string;
  name_en: string;
  name_ko: string;
  group:
    | "battery"
    | "rare_earth"
    | "semiconductor"
    | "grid"
    | "defence"
    | "pgm";
  tags: MineralTag[];
  dual_use: boolean;
  lists: CriticalListId[];
  end_uses_ko: string;
  note_ko?: string;
};

export type DualUsePressure = "high" | "elevated" | "moderate" | "watch";

export type DualUseRow = {
  mineral_id: string;
  name_en: string;
  name_ko: string;
  clean_tech_demand: "rising" | "stable" | "mixed";
  defence_demand: "rising" | "stable" | "mixed";
  pressure: DualUsePressure;
  rationale_ko: string;
  evidence_note: string;
};

export type PolicyStage =
  | "rumour"
  | "proposal"
  | "consultation"
  | "adopted"
  | "effective"
  | "amended"
  | "suspended"
  | "withdrawn"
  | "expired";

export type SupplySecurityDelta = -2 | -1 | 0 | 1 | 2;

export type GreenMineralEvent = {
  id: string;
  date: string;
  jurisdiction: string;
  event_type: string;
  minerals: string[];
  policy_stage: PolicyStage;
  title_ko: string;
  title_en: string;
  summary_ko: string;
  source_name: string;
  source_url: string;
  /** Directional supply-security effect for importers (editor-assigned). */
  security_delta: SupplySecurityDelta;
  security_rationale_ko: string;
};

export type EtfProxySpec = {
  id: string;
  symbol: string;
  label: string;
  thesis: string;
};

export type GreenMineralPoint = { date: string; close: number };

export type GreenMineralEtf = {
  id: string;
  symbol: string;
  label: string;
  thesis: string;
  price: number | null;
  change_1d_pct: number | null;
  change_1m_pct: number | null;
  series?: GreenMineralPoint[];
  error?: string;
};

export type GreenMineralHeadline = {
  headline: string;
  source: string;
  published?: string;
  url?: string;
  query?: string;
};

export type CriticalListMeta = {
  id: CriticalListId;
  label_ko: string;
  label_en: string;
  as_of: string;
  source_name: string;
  source_url: string;
  note_ko: string;
};

export type MethodologyBlock = {
  id: string;
  title_ko: string;
  title_en: string;
  body_ko: string;
};

export type GreenMineralPayload = {
  ok: boolean;
  generated_at: string;
  subtitle_ko: string;
  subtitle_en: string;
  note: string;
  minerals: GreenMineral[];
  dual_use: DualUseRow[];
  events: GreenMineralEvent[];
  etfs: GreenMineralEtf[];
  headlines: GreenMineralHeadline[];
  list_meta: CriticalListMeta[];
  list_labels: Record<CriticalListId, { ko: string; en: string }>;
  methodology: MethodologyBlock[];
  error?: string;
};

export const CRITICAL_LIST_META: CriticalListMeta[] = [
  {
    id: "US",
    label_ko: "미국 핵심광물",
    label_en: "US Critical Minerals List",
    as_of: "2025-11",
    source_name: "USGS / DOI Critical Minerals List (2025 update)",
    source_url: "https://www.usgs.gov/programs/mineral-resources-program",
    note_ko: "연방 목록은 개정됨. 멤버십은 편집 검수 스냅샷이며 법령 원문 대체 아님.",
  },
  {
    id: "EU",
    label_ko: "EU 핵심원자재",
    label_en: "EU Critical / Strategic Raw Materials",
    as_of: "2025-05",
    source_name: "European Commission CRM / CRMA (2024 act, 2025 lists)",
    source_url: "https://single-market-economy.ec.europa.eu/sectors/raw-materials/crm_en",
    note_ko: "Critical vs Strategic 구분 가능. 본 표는 모니터용 단순 포함 여부.",
  },
  {
    id: "CA",
    label_ko: "캐나다",
    label_en: "Canada Critical Minerals List",
    as_of: "2025-12",
    source_name: "Natural Resources Canada critical minerals strategy",
    source_url: "https://www.canada.ca/en/natural-resources-canada.html",
    note_ko: "캐나다 공식 목록 기준 편집 매핑.",
  },
  {
    id: "AU",
    label_ko: "호주",
    label_en: "Australia Critical Minerals List",
    as_of: "2025-06",
    source_name: "Australian Government critical minerals (2025 update)",
    source_url: "https://www.industry.gov.au/",
    note_ko: "호주 목록·전략 문서 기준. 개정 시 as_of 갱신.",
  },
  {
    id: "JP",
    label_ko: "일본 전략광물",
    label_en: "Japan strategic / specified minerals",
    as_of: "2023-06",
    source_name: "METI mineral security materials (public briefings)",
    source_url: "https://www.meti.go.jp/",
    note_ko: "일본은 '지정'·전략 표현이 문서마다 다름 — 근사 매핑.",
  },
  {
    id: "KR",
    label_ko: "한국 핵심광물",
    label_en: "Korea critical minerals",
    as_of: "2023-02",
    source_name: "MOTIE 핵심광물 확보 전략 관련 공개자료",
    source_url: "https://www.motie.go.kr/",
    note_ko: "한국 전략 대상 광물 중심 매핑. 법정 단일 리스트와 1:1이 아닐 수 있음.",
  },
];

export const CRITICAL_LIST_LABELS: Record<
  CriticalListId,
  { ko: string; en: string }
> = Object.fromEntries(
  CRITICAL_LIST_META.map((m) => [m.id, { ko: m.label_ko, en: m.label_en }]),
) as Record<CriticalListId, { ko: string; en: string }>;

export const METHODOLOGY_BLOCKS: MethodologyBlock[] = [
  {
    id: "scope",
    title_ko: "범위",
    title_en: "Scope",
    body_ko:
      "투자자 관점의 핵심광물 모니터. 단일 '세계 핵심광물' 목록이 아니라 국가·산업별 분류를 병기한다. UI 기본 언어는 한국어, 고유명사는 영어 병기.",
  },
  {
    id: "cadence",
    title_ko: "갱신 주기",
    title_en: "Cadence",
    body_ko:
      "fetched_at(수집)과 발표일·발효일을 구분한다. ETF 프록시는 Yahoo 일봉(수분~수시간 캐시). 국가목록·정책 이벤트는 편집 큐레이션(수시). RSS는 탐지용이며 확정 사실이 아니다.",
  },
  {
    id: "security_delta",
    title_ko: "Supply Security delta",
    title_en: "Editor-assigned directional score",
    body_ko:
      "수입국 관점 방향성(+2~-2). +2 실공급 다변화/개시, +1 자금·장기계약, 0 조사·MOU·전략발표, -1 허가지연·관세 불확실, -2 수출금지·중대 중단. 종합 Mineral Security Score는 산출하지 않는다.",
  },
  {
    id: "dual_use",
    title_ko: "이중용도 맵",
    title_en: "Green–Defence map",
    body_ko:
      "방산·청정 동시 수요 압력은 정성 등급이다. 미공개 무기체계 투입량을 추정 수치로 만들지 않는다.",
  },
  {
    id: "etf_proxy",
    title_ko: "ETF 프록시",
    title_en: "ETF proxies",
    body_ko:
      "Yahoo 상장 ETF 가격·수익률만 표시. 광물 현물·선물·평가가격과 혼합하지 않는다. 투자 조언이 아니다.",
  },
  {
    id: "out_of_scope",
    title_ko: "의도적 비범위",
    title_en: "Out of scope",
    body_ko:
      "거래소급 광물가·재고, 무역 HS 의존도 자동화, 프로젝트 지도 DB, Social Licence 자동점수, 정량 시나리오, 통합 위험 종합점수는 제품 범위에서 제외한다(화면에도 미표시).",
  },
];

/** Phase-1 curated taxonomy — not a single universal “critical” list. */
export const GREEN_MINERALS: GreenMineral[] = [
  {
    id: "lithium",
    name_en: "Lithium",
    name_ko: "리튬",
    group: "battery",
    tags: ["battery", "clean_energy", "industrial"],
    dual_use: false,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "배터리·ESS",
  },
  {
    id: "nickel",
    name_en: "Nickel",
    name_ko: "니켈",
    group: "battery",
    tags: ["battery", "clean_energy", "industrial", "defence", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "배터리·합금·방산",
  },
  {
    id: "cobalt",
    name_en: "Cobalt",
    name_ko: "코발트",
    group: "battery",
    tags: ["battery", "clean_energy", "defence", "aerospace", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "배터리·초합금·방산",
    note_ko: "아동노동·강제노동 공급망 위험이 높은 대표 광물",
  },
  {
    id: "manganese",
    name_en: "Manganese",
    name_ko: "망간",
    group: "battery",
    tags: ["battery", "clean_energy", "industrial"],
    dual_use: false,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "배터리·철강",
  },
  {
    id: "graphite",
    name_en: "Graphite",
    name_ko: "흑연",
    group: "battery",
    tags: ["battery", "clean_energy", "industrial"],
    dual_use: false,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "음극재·산업용",
  },
  {
    id: "copper",
    name_en: "Copper",
    name_ko: "구리",
    group: "grid",
    tags: ["grid", "clean_energy", "industrial", "AI_infrastructure"],
    dual_use: false,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "전력망·EV·데이터센터",
    note_ko: "일부 국가 목록에서 전략/중요 원자재로만 취급 — 배지=모니터용 포함",
  },
  {
    id: "neodymium",
    name_en: "Neodymium",
    name_ko: "네오디뮴",
    group: "rare_earth",
    tags: ["clean_energy", "defence", "aerospace", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "영구자석·풍력·방산",
  },
  {
    id: "praseodymium",
    name_en: "Praseodymium",
    name_ko: "프라세오디뮴",
    group: "rare_earth",
    tags: ["clean_energy", "defence", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "영구자석",
  },
  {
    id: "dysprosium",
    name_en: "Dysprosium",
    name_ko: "디스프로슘",
    group: "rare_earth",
    tags: ["clean_energy", "defence", "aerospace", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "고온 자석·방산",
  },
  {
    id: "terbium",
    name_en: "Terbium",
    name_ko: "테르븀",
    group: "rare_earth",
    tags: ["clean_energy", "defence", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "자석·형광",
  },
  {
    id: "gallium",
    name_en: "Gallium",
    name_ko: "갈륨",
    group: "semiconductor",
    tags: ["semiconductor", "AI_infrastructure", "defence", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "반도체·RF·방산",
  },
  {
    id: "germanium",
    name_en: "Germanium",
    name_ko: "게르마늄",
    group: "semiconductor",
    tags: ["semiconductor", "defence", "aerospace", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "반도체·광학·방산",
  },
  {
    id: "tantalum",
    name_en: "Tantalum",
    name_ko: "탄탈럼",
    group: "semiconductor",
    tags: ["semiconductor", "aerospace", "defence", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "커패시터·항공",
  },
  {
    id: "tungsten",
    name_en: "Tungsten",
    name_ko: "텅스텐",
    group: "defence",
    tags: ["defence", "aerospace", "industrial", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "방산·공구·항공",
  },
  {
    id: "tin",
    name_en: "Tin",
    name_ko: "주석",
    group: "semiconductor",
    tags: ["semiconductor", "industrial"],
    dual_use: false,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "솔더·반도체 패키징",
  },
  {
    id: "aluminium",
    name_en: "Aluminium",
    name_ko: "알루미늄",
    group: "grid",
    tags: ["grid", "clean_energy", "aerospace", "industrial"],
    dual_use: false,
    lists: ["US", "EU", "CA", "AU"],
    end_uses_ko: "전력·경량화",
  },
  {
    id: "silver",
    name_en: "Silver",
    name_ko: "은",
    group: "grid",
    tags: ["clean_energy", "industrial", "semiconductor"],
    dual_use: false,
    lists: ["US", "EU", "CA", "AU"],
    end_uses_ko: "태양광·전자",
  },
  {
    id: "uranium",
    name_en: "Uranium",
    name_ko: "우라늄",
    group: "grid",
    tags: ["nuclear", "clean_energy", "defence", "dual_use"],
    dual_use: true,
    lists: ["US", "CA", "AU", "JP", "KR"],
    end_uses_ko: "원전·방산(별도 규제)",
  },
  {
    id: "vanadium",
    name_en: "Vanadium",
    name_ko: "바나듐",
    group: "grid",
    tags: ["grid", "clean_energy", "industrial", "defence", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "레독스 전지·합금",
  },
  {
    id: "antimony",
    name_en: "Antimony",
    name_ko: "안티몬",
    group: "defence",
    tags: ["defence", "industrial", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "방산·난연·합금",
  },
  {
    id: "titanium",
    name_en: "Titanium",
    name_ko: "티타늄",
    group: "defence",
    tags: ["aerospace", "defence", "industrial", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "항공우주·방산",
  },
  {
    id: "beryllium",
    name_en: "Beryllium",
    name_ko: "베릴륨",
    group: "defence",
    tags: ["aerospace", "defence", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP"],
    end_uses_ko: "항공·방산·전자",
  },
  {
    id: "platinum",
    name_en: "Platinum",
    name_ko: "백금",
    group: "pgm",
    tags: ["clean_energy", "industrial", "defence", "dual_use"],
    dual_use: true,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "촉매·수소·산업",
  },
  {
    id: "palladium",
    name_en: "Palladium",
    name_ko: "팔라듐",
    group: "pgm",
    tags: ["industrial", "clean_energy"],
    dual_use: false,
    lists: ["US", "EU", "CA", "AU", "JP", "KR"],
    end_uses_ko: "촉매·전자",
  },
];

export const DUAL_USE_MAP: DualUseRow[] = [
  {
    mineral_id: "neodymium",
    name_en: "Neodymium",
    name_ko: "네오디뮴",
    clean_tech_demand: "rising",
    defence_demand: "rising",
    pressure: "high",
    rationale_ko: "풍력·EV 모터와 방산 센서/유도체계가 동일 자석 체인을 공유",
    evidence_note: "qualitative curated · 투입량 미공개 체계는 수치화하지 않음",
  },
  {
    mineral_id: "dysprosium",
    name_en: "Dysprosium",
    name_ko: "디스프로슘",
    clean_tech_demand: "rising",
    defence_demand: "rising",
    pressure: "high",
    rationale_ko: "고온 영구자석 — 청정기술·방산 모두 희소 중희토 의존",
    evidence_note: "qualitative curated",
  },
  {
    mineral_id: "gallium",
    name_en: "Gallium",
    name_ko: "갈륨",
    clean_tech_demand: "rising",
    defence_demand: "rising",
    pressure: "high",
    rationale_ko: "화합물 반도체·RF — AI/통신과 방산 전자가 동시에 수요 증가",
    evidence_note: "qualitative curated · 수출통제 이슈와 연동",
  },
  {
    mineral_id: "germanium",
    name_en: "Germanium",
    name_ko: "게르마늄",
    clean_tech_demand: "rising",
    defence_demand: "rising",
    pressure: "elevated",
    rationale_ko: "광학·반도체·적외선 — 이중용도 성격이 뚜렷",
    evidence_note: "qualitative curated",
  },
  {
    mineral_id: "cobalt",
    name_en: "Cobalt",
    name_ko: "코발트",
    clean_tech_demand: "mixed",
    defence_demand: "rising",
    pressure: "elevated",
    rationale_ko: "배터리 화학 변화로 청정측은 혼조, 초합금·방산은 지속",
    evidence_note: "qualitative curated",
  },
  {
    mineral_id: "copper",
    name_en: "Copper",
    name_ko: "구리",
    clean_tech_demand: "rising",
    defence_demand: "stable",
    pressure: "moderate",
    rationale_ko: "전력망·EV·AI 인프라 수요가 주도, 방산은 상대적 안정",
    evidence_note: "qualitative curated · dual_use=false but grid stress high",
  },
  {
    mineral_id: "antimony",
    name_en: "Antimony",
    name_ko: "안티몬",
    clean_tech_demand: "stable",
    defence_demand: "rising",
    pressure: "elevated",
    rationale_ko: "방산·탄약 관련 수요 민감, 공급 집중도가 높음",
    evidence_note: "qualitative curated",
  },
  {
    mineral_id: "tungsten",
    name_en: "Tungsten",
    name_ko: "텅스텐",
    clean_tech_demand: "stable",
    defence_demand: "rising",
    pressure: "elevated",
    rationale_ko: "공구·방산 탄두/장갑 — 방산 사이클에 민감",
    evidence_note: "qualitative curated",
  },
];

/** Small curated event set — expand later via cron + official gazettes. */
export const GREEN_MINERAL_EVENTS: GreenMineralEvent[] = [
  {
    id: "cn-ga-ge-export-2023",
    date: "2023-08-01",
    jurisdiction: "CN",
    event_type: "export_control",
    minerals: ["gallium", "germanium"],
    policy_stage: "effective",
    title_ko: "중국 갈륨·게르마늄 수출허가제",
    title_en: "China gallium & germanium export licensing",
    summary_ko:
      "이중용도 품목 수출허가 — 반도체·방산 공급망의 허가 지연·가격 프리미엄 리스크.",
    source_name: "PRC MOFCOM (public reporting)",
    source_url: "https://english.mofcom.gov.cn/",
    security_delta: -2,
    security_rationale_ko: "수입국 관점 중대 공급충격 가능",
  },
  {
    id: "eu-crma-2024",
    date: "2024-05-23",
    jurisdiction: "EU",
    event_type: "industrial_policy",
    minerals: ["lithium", "rare_earth", "copper", "nickel", "cobalt"],
    policy_stage: "adopted",
    title_ko: "EU Critical Raw Materials Act",
    title_en: "EU Critical Raw Materials Act",
    summary_ko:
      "채굴·가공·재활용 목표와 전략 프로젝트 — 발표와 실제 생산 개시는 구분 필요.",
    source_name: "European Commission",
    source_url: "https://single-market-economy.ec.europa.eu/sectors/raw-materials/crm_en",
    security_delta: 1,
    security_rationale_ko: "자금·허가 프레임 강화(+1). 생산 개시 확정은 아님(0에 가깝지만 정책 축)",
  },
  {
    id: "us-ira-critical-minerals",
    date: "2022-08-16",
    jurisdiction: "US",
    event_type: "subsidy",
    minerals: ["lithium", "nickel", "cobalt", "graphite", "manganese"],
    policy_stage: "effective",
    title_ko: "미국 IRA 핵심광물·배터리 세액공제 체계",
    title_en: "US IRA critical minerals / battery credit framework",
    summary_ko:
      "공급망 지리적 요건이 조달 경로를 재편. 보조금 경쟁 vs 실생산 다변화 검증 필요.",
    source_name: "US Treasury / IRS guidance track",
    source_url: "https://home.treasury.gov/",
    security_delta: 1,
    security_rationale_ko: "장기 구매·투자 유인(+1), 실생산은 프로젝트별로 분리 평가",
  },
  {
    id: "kr-critical-minerals-strategy",
    date: "2023-02-27",
    jurisdiction: "KR",
    event_type: "strategy",
    minerals: ["lithium", "nickel", "cobalt", "graphite", "rare_earth"],
    policy_stage: "adopted",
    title_ko: "한국 핵심광물 확보 전략",
    title_en: "Korea critical minerals security strategy",
    summary_ko: "비축·해외자원·재활용 축. 후속 이행·예산·계약이 관건.",
    source_name: "MOTIE (public briefings)",
    source_url: "https://www.motie.go.kr/",
    security_delta: 0,
    security_rationale_ko: "전략 발표 단계 — 비구속·이행 추적이 필요(0)",
  },
  {
    id: "cn-graphite-controls-2023",
    date: "2023-12-01",
    jurisdiction: "CN",
    event_type: "export_control",
    minerals: ["graphite"],
    policy_stage: "effective",
    title_ko: "중국 흑연 관련 수출통제 강화",
    title_en: "China graphite export control measures",
    summary_ko: "음극재 공급망의 허가·대체조달 압력 증가.",
    source_name: "PRC MOFCOM (public reporting)",
    source_url: "https://english.mofcom.gov.cn/",
    security_delta: -1,
    security_rationale_ko: "허가 불확실성·가격 프리미엄(-1)",
  },
  {
    id: "au-critical-minerals-facility",
    date: "2024-06-01",
    jurisdiction: "AU",
    event_type: "government_support",
    minerals: ["lithium", "rare_earth", "nickel"],
    policy_stage: "effective",
    title_ko: "호주 Critical Minerals 금융·지원 체계 확대",
    title_en: "Australia critical minerals financing / support",
    summary_ko: "프로젝트 자금조달 여건 개선 가능. 단계별 실현 확률은 별도.",
    source_name: "Australian Government",
    source_url: "https://www.industry.gov.au/",
    security_delta: 1,
    security_rationale_ko: "자금지원 축(+1)",
  },
  {
    id: "cn-antimony-controls-2024",
    date: "2024-09-15",
    jurisdiction: "CN",
    event_type: "export_control",
    minerals: ["antimony"],
    policy_stage: "effective",
    title_ko: "중국 안티몬 관련 수출통제 보도·조치",
    title_en: "China antimony export control measures (reported)",
    summary_ko: "방산·난연 공급망의 허가·대체조달 압력. 원문·발효일은 관보 대조 권장.",
    source_name: "Public trade / MOFCOM reporting track",
    source_url: "https://english.mofcom.gov.cn/",
    security_delta: -2,
    security_rationale_ko: "이중용도·방산 민감 품목의 공급충격 가능(-2)",
  },
  {
    id: "us-defense-production-minerals",
    date: "2022-03-31",
    jurisdiction: "US",
    event_type: "defence_priority",
    minerals: ["lithium", "nickel", "cobalt", "graphite", "manganese", "rare_earth"],
    policy_stage: "effective",
    title_ko: "미국 국방생산법 등 핵심광물·배터리 공급망 우선조치",
    title_en: "US DPA / defence mineral supply-chain actions",
    summary_ko: "국방·산업정책이 동일 광물 체인을 끌어올림. 발표≠즉시 신규 광산 가동.",
    source_name: "White House / DoD public releases",
    source_url: "https://www.defense.gov/",
    security_delta: 1,
    security_rationale_ko: "구매·투자 유인(+1). 실생산은 프로젝트별",
  },
  {
    id: "jp-economic-security-minerals",
    date: "2022-05-11",
    jurisdiction: "JP",
    event_type: "economic_security",
    minerals: ["rare_earth", "gallium", "germanium", "graphite"],
    policy_stage: "adopted",
    title_ko: "일본 경제안보 추진법 체계와 특정중요물자 축",
    title_en: "Japan economic security framework / critical materials axis",
    summary_ko: "비축·공급망 조사·지원 틀. 개별 광물 수출입 충격과는 별개로 추적.",
    source_name: "METI / Cabinet Office (public)",
    source_url: "https://www.meti.go.jp/",
    security_delta: 0,
    security_rationale_ko: "제도 프레임(0) — 이행·비축 규모는 후속 확인",
  },
  {
    id: "ca-critical-minerals-strategy",
    date: "2022-12-09",
    jurisdiction: "CA",
    event_type: "strategy",
    minerals: ["lithium", "nickel", "copper", "graphite", "rare_earth", "uranium"],
    policy_stage: "adopted",
    title_ko: "캐나다 Critical Minerals Strategy",
    title_en: "Canada Critical Minerals Strategy",
    summary_ko: "동맹 조달·국내 개발·원주민 협의 축을 동시에 언급. 허가·사회수용이 병목.",
    source_name: "Natural Resources Canada",
    source_url: "https://www.canada.ca/en/natural-resources-canada.html",
    security_delta: 0,
    security_rationale_ko: "전략 발표(0). FPIC·허가 리스크는 프로젝트별",
  },
];

export const GREEN_MINERAL_ETF_SPECS: EtfProxySpec[] = [
  {
    id: "lit",
    symbol: "LIT",
    label: "리튬·배터리",
    thesis: "Lithium & battery value chain proxy",
  },
  {
    id: "batt",
    symbol: "BATT",
    label: "배터리 테마",
    thesis: "Broader battery / materials theme proxy",
  },
  {
    id: "copx",
    symbol: "COPX",
    label: "구리 광산",
    thesis: "Copper miners — grid / electrification",
  },
  {
    id: "remx",
    symbol: "REMX",
    label: "희토류",
    thesis: "Rare earth / strategic metals proxy",
  },
  {
    id: "ura",
    symbol: "URA",
    label: "우라늄",
    thesis: "Uranium / nuclear fuel cycle",
  },
  {
    id: "pick",
    symbol: "PICK",
    label: "금속·광업",
    thesis: "Diversified metals & mining",
  },
  {
    id: "xme",
    symbol: "XME",
    label: "금속·광업(US)",
    thesis: "US metals & mining sector SPDR",
  },
  {
    id: "gdx",
    symbol: "GDX",
    label: "금광(참조)",
    thesis: "Gold miners — risk-off / mining beta reference",
  },
];

export const GROUP_LABELS: Record<
  GreenMineral["group"],
  { ko: string; en: string }
> = {
  battery: { ko: "배터리·전기화", en: "Battery & electrification" },
  rare_earth: { ko: "희토류·자석", en: "Rare earths & magnets" },
  semiconductor: { ko: "반도체·AI", en: "Semiconductor & AI" },
  grid: { ko: "전력망·에너지", en: "Grid & energy" },
  defence: { ko: "방산·항공", en: "Defence & aerospace" },
  pgm: { ko: "PGM·촉매", en: "PGMs & catalysts" },
};

export const PRESSURE_LABELS: Record<
  DualUsePressure,
  { ko: string; className: string }
> = {
  high: { ko: "높음", className: "down" },
  elevated: { ko: "상승", className: "down" },
  moderate: { ko: "보통", className: "flat" },
  watch: { ko: "주시", className: "flat" },
};
