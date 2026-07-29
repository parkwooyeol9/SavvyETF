/**
 * Critical Minerals / 녹색 광물 — Phase 1 (key-free, curated).
 *
 * Implemented now:
 * - Mineral taxonomy + industry tags + dual_use
 * - National critical-list membership (curated snapshot)
 * - Green–Defence competition matrix (qualitative)
 * - Related ETF Yahoo proxies
 * - Curated geopolitics / policy events
 * - Google News RSS assist
 *
 * Deferred (needs DB, licensed prices, trade APIs, geo pipeline):
 * - Spot/futures mineral prices, Market Tightness
 * - USGS/IEA production & refining HHI live refresh
 * - Project pipeline + maps
 * - UN Comtrade trade dependency
 * - Social licence / human-rights incident scoring
 * - Recycling throughput, substitution commercialisation tracker
 * - Scenario engine, daily briefing cron, PostgreSQL schema
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

export type DeferredModule = {
  id: string;
  title_ko: string;
  title_en: string;
  reason_ko: string;
  effort: "M" | "L" | "XL";
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
  deferred: DeferredModule[];
  list_labels: Record<CriticalListId, { ko: string; en: string }>;
  error?: string;
};

export const CRITICAL_LIST_LABELS: Record<
  CriticalListId,
  { ko: string; en: string }
> = {
  US: { ko: "미국 핵심광물", en: "US Critical Minerals List" },
  EU: { ko: "EU 핵심원자재", en: "EU Critical Raw Materials" },
  CA: { ko: "캐나다", en: "Canada Critical Minerals List" },
  AU: { ko: "호주", en: "Australia Critical Minerals List" },
  JP: { ko: "일본 전략광물", en: "Japan strategic minerals" },
  KR: { ko: "한국 핵심광물", en: "Korea critical minerals" },
};

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
];

export const GREEN_MINERAL_ETF_SPECS: EtfProxySpec[] = [
  {
    id: "lit",
    symbol: "LIT",
    label: "리튬·배터리",
    thesis: "Lithium & battery value chain proxy",
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
    id: "gdx",
    symbol: "GDX",
    label: "금광(참조)",
    thesis: "Gold miners — risk-off / mining beta reference",
  },
];

export const DEFERRED_MODULES: DeferredModule[] = [
  {
    id: "prices",
    title_ko: "광물 현물·선물·재고·Market Tightness",
    title_en: "Spot/futures/inventory & tightness",
    reason_ko: "LME/SHFE/평가가격은 라이선스·벤치마크 혼용 금지 — 유료·공식 feed 확보 후",
    effort: "XL",
  },
  {
    id: "production_hhi",
    title_ko: "채굴·정제 HHI / USGS·IEA 라이브",
    title_en: "Production & refining concentration",
    reason_ko: "연간 통계 파서 + 단위 정규화 + 수정이력 DB 필요",
    effort: "L",
  },
  {
    id: "projects_map",
    title_ko: "프로젝트 파이프라인·지도",
    title_en: "Project pipeline & map",
    reason_ko: "좌표·단계·허가 이벤트 DB + MapLibre — 수집 배치가 병목",
    effort: "XL",
  },
  {
    id: "trade",
    title_ko: "무역의존도·HS 단계 분해",
    title_en: "Trade dependency / HS stages",
    reason_ko: "UN Comtrade·관세청 매핑, HS≠광물 1:1 — 추정 표시 인프라 필요",
    effort: "XL",
  },
  {
    id: "social_licence",
    title_ko: "Social Licence Risk Score",
    title_en: "Social licence monitor",
    reason_ko: "allegation/confirmed 구분·증거 coverage — 뉴스 카운트만으로 확정 금지",
    effort: "XL",
  },
  {
    id: "recycling",
    title_ko: "재활용 실처리량·대체기술 상업화",
    title_en: "Recycling & substitution",
    reason_ko: "발표용량≠가동≠회수량 — 시설별 실적 수집이 선행",
    effort: "L",
  },
  {
    id: "scenarios",
    title_ko: "투자 스트레스 시나리오 엔진",
    title_en: "Scenario analysis",
    reason_ko: "정량 입력(공급·수요) 없으면 directional만 — 상위 데이터 모듈 이후",
    effort: "L",
  },
  {
    id: "db_cron",
    title_ko: "PostgreSQL/D1 스키마 + 일간 크론 브리핑",
    title_en: "DB schema & daily pipeline",
    reason_ko: "스펙 §8–9 전체 — Phase 1은 서버리스 큐레이션+Yahoo/RSS만",
    effort: "XL",
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
