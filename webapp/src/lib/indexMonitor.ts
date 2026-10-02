export type IndexChangeAction = "ADD" | "DEL" | "WEIGHT";

export type IndexChangeRow = {
  index_id: string;
  review: string;
  announce_date: string;
  effective_date: string;
  event_type: string;
  action: IndexChangeAction;
  security_name: string;
  code: string;
  note: string;
  source_tier: string;
  source_url: string;
};

export type IndexMonitorResponse = {
  ok: boolean;
  asOf: string;
  rows: IndexChangeRow[];
  /** MSCI_* rows withheld from non-admin callers (MSCI public-list licence). */
  msciHidden: number;
  error?: string;
};

export type IndexEvent = {
  key: string;
  index_id: string;
  review: string;
  announce: string;
  effective: string;
  rows: IndexChangeRow[];
  tiers: string[];
  url: string;
};

export type IndexGroup = "ALL" | "KR" | "MSCI" | "US" | "JP";

export const INDEX_GROUPS: { id: IndexGroup; label: string }[] = [
  { id: "ALL", label: "전체" },
  { id: "KR", label: "한국(KRX)" },
  { id: "MSCI", label: "MSCI" },
  { id: "US", label: "미국" },
  { id: "JP", label: "일본" },
];

const NAMES: Record<string, string> = {
  KOSPI200: "코스피200",
  KOSDAQ150: "코스닥150",
  MSCI_KOREA: "MSCI Korea",
  SP500: "S&P 500",
  SP100: "S&P 100",
  NDX: "Nasdaq-100",
  NIKKEI225: "닛케이225",
};

export function isMsciIndex(id: string): boolean {
  return id.startsWith("MSCI_");
}

export function indexName(id: string): string {
  if (NAMES[id]) return NAMES[id];
  const country = id
    .replace("MSCI_", "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Usa", "USA");
  return `MSCI ${country}`;
}

export function indexGroup(id: string): Exclude<IndexGroup, "ALL"> {
  if (isMsciIndex(id)) return "MSCI";
  if (id.startsWith("KOS")) return "KR";
  if (id.startsWith("NIKKEI")) return "JP";
  return "US";
}

export const SOURCE_TIER_LABEL: Record<string, string> = {
  official_pdf: "공식 PDF",
  official_pr: "공식 보도자료",
  primary_news: "언론 보도(공식 발표 인용)",
  wiki: "Wikipedia",
  news: "언론 보도",
  secondary: "2차 출처 · 대조 필요",
};

export function groupEvents(rows: IndexChangeRow[]): IndexEvent[] {
  const map = new Map<string, IndexEvent & { tierSet: Set<string> }>();
  for (const r of rows) {
    const key = `${r.index_id}|${r.review}`;
    let e = map.get(key);
    if (!e) {
      e = {
        key,
        index_id: r.index_id,
        review: r.review,
        announce: r.announce_date,
        effective: r.effective_date,
        rows: [],
        tiers: [],
        url: r.source_url,
        tierSet: new Set(),
      };
      map.set(key, e);
    }
    e.rows.push(r);
    e.tierSet.add(r.source_tier);
    if (!e.url && r.source_url) e.url = r.source_url;
  }
  return [...map.values()]
    .map(({ tierSet, ...e }) => ({ ...e, tiers: [...tierSet] }))
    .sort(
      (a, b) =>
        (b.effective || "").localeCompare(a.effective || "") || a.index_id.localeCompare(b.index_id),
    );
}

export const HIGHLIGHT_EVENTS = [
  "MSCI_KOREA|2026-08 분기",
  "SP500|2026-09 분기",
  "NDX|2026-09 분기",
  "NIKKEI225|2026-10 정기",
  "KOSPI200|2026-06 정기",
  "NDX|2026-06 분기",
];

/** `date` is ISO when the provider has fixed it; otherwise a coarse label like "2026-11 하순". */
export type RebalanceCalendarItem = {
  date: string;
  title: string;
  sub: string;
  confirmed: boolean;
};

export const REBALANCE_CALENDAR: RebalanceCalendarItem[] = [
  { date: "2026-10-30", title: "Russell 12월 재구성 Rank Day", sub: "FTSE Russell · 첫 12월 반기 재구성", confirmed: true },
  { date: "2026-11-11", title: "MSCI 11월 분기 리뷰 발표", sub: "한국시간 11-12 새벽 · 11-30 종가 반영", confirmed: true },
  { date: "2026-11-13", title: "Russell 예비 편출입 리스트", sub: "11-20 · 27, 12-04 갱신", confirmed: true },
  { date: "2026-11 하순", title: "KRX 주가지수운영위원회", sub: "코스피200·코스닥150·KRX300 12월 정기변경 심의", confirmed: false },
  { date: "2026-12-04", title: "S&P 500 4분기 변경 발표", sub: "리밸런싱 2주 전 금요일 관행", confirmed: false },
  { date: "2026-12-11", title: "Nasdaq-100 연례 재구성 발표", sub: "12-21 반영 · Russell 재구성 효력(종가)", confirmed: false },
  { date: "2026-12-11", title: "코스피200·코스닥150 정기변경 반영", sub: "12월 선물옵션 만기(12-10) 다음 거래일", confirmed: false },
  { date: "2026-12-18", title: "미국 지수·FTSE 분기 리밸런싱 종가", sub: "S&P · Nasdaq-100 · FTSE GEIS, 12-21 반영", confirmed: true },
  { date: "2027-02 중순", title: "MSCI 2월 반기 리뷰 발표", sub: "2월 말 종가 반영", confirmed: false },
  { date: "2027-03 초", title: "닛케이225 춘계 정기변경 발표", sub: "4월 첫 영업일 반영", confirmed: false },
  { date: "2027-06", title: "MSCI 연례 시장분류 리뷰", sub: "한국 선진시장 관찰대상국 등재 여부", confirmed: false },
];

export type IndexMethodology = {
  name: string;
  provider: string;
  universe: string;
  selection: string;
  weighting: string;
  schedule: string;
  memo: string;
};

export const INDEX_METHODOLOGY: IndexMethodology[] = [
  { name: "MSCI ACWI / EM", provider: "MSCI", universe: "선진 23 · 신흥 24개국 대·중형주 (ACWI 약 2,500종목)", selection: "규칙 기반. GIMI 사이즈 세그먼트 컷오프 + 유동 시총·외국인 한도 + 버퍼", weighting: "유동 시총(FIF)", schedule: "2·5·8·11월 (2·8월 반기, 5·11월 분기). 말일 종가 반영", memo: "8월 리뷰 ACWI 편입 55 · 편출 92. 방글라데시 변경은 11월부터 재개" },
  { name: "MSCI Korea", provider: "MSCI", universe: "MSCI EM 내 한국 대·중형주 (8월 리뷰 후 74종목)", selection: "전체 시총과 유동 시총 두 기준 동시 충족. 가격 기준일은 직전 월말 10영업일 중 임의일", weighting: "유동 시총", schedule: "MSCI 분기 리뷰와 동일", memo: "투자경고·위험종목 편입 제한 관찰기간 단축(당회 리뷰 기준일부터). 2026-06 선진시장 관찰대상국 등재 보류" },
  { name: "FTSE All-World", provider: "FTSE Russell", universe: "GEIS 대·중형주, 한국은 선진시장 분류", selection: "규칙 기반. 지역별 상대 순위 + 유동성 심사", weighting: "유동 시총", schedule: "반기 3·9월, 분기 6·12월. 셋째 금요일 종가", memo: "베트남 2026-09부터 4단계 편입(첫 단계 10%)" },
  { name: "S&P 500", provider: "S&P DJI", universe: "미국 대형주 500사(503종목)", selection: "위원회 재량. 시총 기준·흑자(최근 분기와 4분기 합)·유동비율·유동성 요건", weighting: "유동 시총", schedule: "3·6·9·12월 셋째 금요일 종가, 수시 변경 다수", memo: "2026년 9월까지 편입·편출 각 10여 건. 9월 Bloom Energy 등 3종목 편입" },
  { name: "Nasdaq-100", provider: "Nasdaq", universe: "Nasdaq 상장 비금융 상위 100사", selection: "규칙 기반. 12월 연례 재구성 + 3·6·9월 순위 심사(125위 밖 제거)", weighting: "수정 시총, 유동주식 33.3% 미만이면 유동주식의 3배로 상한", schedule: "12월 연례, 3·6·9월 분기. 셋째 금요일 다음 거래일 반영", memo: "2026-05-01 개정: Fast Entry(상위 40위 이내 신규상장 15거래일 후 편입), 최소 유동비율 폐지. SpaceX 7월 편입" },
  { name: "Russell 1000 / 2000", provider: "FTSE Russell", universe: "미국 상위 3,000사 (1000 = 대형, 2000 = 소형)", selection: "규칙 기반. Rank Day 총시총 순위 + 밴딩", weighting: "유동 시총", schedule: "2026년부터 반기: 6월 넷째 금요일, 12월 둘째 금요일. 분기별 IPO 편입", memo: "12월 재구성 30여 년 만에 부활: Rank Day 10-30, 반영 12-11" },
  { name: "EURO STOXX 50", provider: "STOXX", universe: "유로존 섹터 대표 대형주 50", selection: "규칙 기반. 섹터별 상위 + 40/60 버퍼, Fast Entry/Exit", weighting: "유동 시총, 10% 상한", schedule: "연 1회 9월 정기 + 분기 비중 조정", memo: "이번 조사에서 2026 변경 이력은 수집하지 않음" },
  { name: "닛케이225", provider: "日本経済新聞社", universe: "도쿄증권거래소 프라임 225종목", selection: "규칙 + 업종 균형. 고유동성 450위 기준, 미편입 상위 75위 편입 후보, 450위 밖 제외 후보. 회당 최대 3종목(기업재편 제외)", weighting: "가격 가중(주가환산계수 적용)", schedule: "연 2회 4·10월 첫 영업일 반영 (2023년부터 춘계 추가)", memo: "2026-04 키옥시아 등 편입, 2026-10 JX금속·KOKUSAI ELECTRIC·캡콤 편입" },
  { name: "TOPIX", provider: "JPX 총연", universe: "도쿄증권거래소 상장 종목(프라임 중심)", selection: "유동 시총 기준 단계적 재편 진행 중", weighting: "유동 시총", schedule: "재편 일정은 JPX 공지 확인 필요", memo: "이번 조사 범위 밖. 재편 진행 상황 별도 확인 필요" },
  { name: "코스피200", provider: "KRX", universe: "유가증권시장 200종목 (정기변경 후 코스피 시총 대비 94.9%)", selection: "산업군별 누적 시총·거래대금 기준, 기존 종목 버퍼, 대형 신규상장 특례 편입", weighting: "유동 시총(상한 규정 있음)", schedule: "연 2회 6·12월. 선물옵션 만기 다음 거래일 반영, 주가지수운영위원회 심의", memo: "2026-06 4종목 교체(추정 추종자금 약 91.8조원, 유안타)" },
  { name: "코스닥150", provider: "KRX", universe: "코스닥 150종목 (기술주 중심 산업군)", selection: "산업군별 시총·유동성 기준, 기존 종목 버퍼", weighting: "유동 시총", schedule: "연 2회 6·12월 (코스피200과 동일)", memo: "2026-06 16종목 교체로 코스피200보다 교체 폭이 큼" },
  { name: "KRX300 / 코스피 · 코스닥", provider: "KRX", universe: "KRX300: 양 시장 통합 300 / 종합지수: 전 상장종목", selection: "KRX300 규칙 기반 / 종합지수는 상장·상폐 이벤트로만 변동", weighting: "유동 시총 / 시총", schedule: "KRX300 6월 정기 + 수시", memo: "KRX300 2026-06 45종목 교체, 정기변경 후 양 시장 시총 대비 96.0%" },
];

export const METHODOLOGY_LINKS: { label: string; href?: string }[] = [
  { label: "MSCI Index Review 페이지 · GIMI Methodology", href: "https://www.msci.com/index-review" },
  { label: "S&P U.S. Indices Methodology", href: "https://www.spglobal.com/spdji/en/documents/methodologies/methodology-sp-us-indices.pdf" },
  { label: "Nasdaq-100 2026 방법론 변경 FAQ", href: "https://indexes.nasdaqomx.com/docs/2026_NDX_Changes_FAQ.pdf" },
  { label: "Russell Reconstitution", href: "https://www.lseg.com/en/ftse-russell/russell-reconstitution" },
  { label: "FTSE All-World", href: "https://www.lseg.com/en/ftse-russell/indices/ftseall-world" },
  { label: "日経平均プロフィル", href: "https://indexes.nikkei.co.jp/nkave" },
  { label: "KRX 지수 산출방법서: KRX 정보데이터시스템 · 지수 → 지수 방법론 (로그인 필요)" },
];

export type DataSourceVerdict = "go" | "mid" | "no";

export type IndexDataSource = {
  name: string;
  content: string;
  access: string;
  depth: string;
  automation: 1 | 2 | 3;
  risk: string;
  verdict: DataSourceVerdict;
  verdictLabel: string;
};

export const INDEX_DATA_SOURCES: IndexDataSource[] = [
  { name: "MSCI 공개 편출입 리스트", content: "국가별 편입·편출 종목명 (Standard · Small Cap · IMI)", access: "PDF, 파일명 규칙 일정 (MSCI_Aug26_STPublicList.pdf). 일부 과거 경로는 자동 수집 차단", depth: "리뷰 아카이브 수년치", automation: 3, risk: "높음 · DB 생성 금지 고지", verdict: "mid", verdictLabel: "내부용 적재 가능" },
  { name: "MSCI 구독자 데이터", content: "구성종목·비중·유동비율·예상 회전율", access: "구독 계약 필요", depth: "전체", automation: 1, risk: "계약 범위 내", verdict: "no", verdictLabel: "계약 시에만" },
  { name: "S&P DJI 보도자료", content: "지수·편입/편출·티커·GICS 표", access: "HTML 표, PR Newswire 동시 배포", depth: "수십 년", automation: 3, risk: "낮음 · 공개 보도자료", verdict: "go", verdictLabel: "즉시" },
  { name: "Nasdaq 보도자료 · Wikipedia", content: "편입·편출·사유", access: "HTML. Wikipedia 변경표 2007-02 ~ 2026-06 확인", depth: "약 20년", automation: 3, risk: "낮음 · 위키는 CC BY-SA", verdict: "go", verdictLabel: "즉시" },
  { name: "Wikipedia S&P 500 구성표", content: "현재 구성종목 + 편입일 + CIK", access: "HTML 표", depth: "편입일 기준 역추적", automation: 3, risk: "낮음", verdict: "go", verdictLabel: "보조용" },
  { name: "FTSE Russell 공지 · 예비 리스트", content: "리뷰 결과, 예비 편출입, 정지종목 등", access: "HTML · PDF · XLSX 첨부", depth: "수년", automation: 2, risk: "중간 · 공개 공지", verdict: "go", verdictLabel: "즉시" },
  { name: "KRX 정보데이터시스템", content: "특정일 지수 구성종목, 지수 시세", access: "웹 조회. 2025-12-27부터 로그인 필수(무료). pykrx는 KRX_ID/PW 필요", depth: "2000년대 이후", automation: 2, risk: "낮음 · 이용약관 확인", verdict: "mid", verdictLabel: "인증 처리 후" },
  { name: "KRX 정기변경 보도자료", content: "코스피200·코스닥150·KRX300 결과", access: "PDF 보도자료", depth: "장기", automation: 1, risk: "낮음", verdict: "go", verdictLabel: "수기 보완" },
  { name: "닛케이 지수 사이트", content: "구성종목, 정기변경 릴리스", access: "HTML · PDF. 무단 전재 금지 고지", depth: "장기", automation: 2, risk: "중간", verdict: "mid", verdictLabel: "내부용" },
  { name: "Datastream (보유 중)", content: "지수 구성종목 리스트, 과거 시점 리스트", access: "Excel 애드인 / DSWS. 과거 시점 리스트 제공 범위는 계정에서 확인 필요", depth: "지수별 상이", automation: 3, risk: "계약 범위 내", verdict: "go", verdictLabel: "P2 백필 핵심" },
  { name: "ETF 보유종목", content: "EWY·IEMG(MSCI), KODEX 200(코스피200), QQQ 등 일별 보유", access: "CSV · KRX PDF(구성내역)", depth: "운용사별 수년", automation: 3, risk: "낮음", verdict: "go", verdictLabel: "실제 반영 검증용" },
];
