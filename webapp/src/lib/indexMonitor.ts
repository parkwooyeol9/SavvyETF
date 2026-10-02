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

export type IndexGroup = "ALL" | "KR" | "US" | "JP" | "CN" | "EU" | "IN" | "MSCI";

export const INDEX_GROUPS: { id: IndexGroup; label: string }[] = [
  { id: "ALL", label: "전체" },
  { id: "KR", label: "한국" },
  { id: "US", label: "미국" },
  { id: "JP", label: "일본" },
  { id: "CN", label: "중국·홍콩" },
  { id: "EU", label: "유럽" },
  { id: "IN", label: "인도" },
  { id: "MSCI", label: "MSCI 국가별" },
];

/** Display order inside each region (bar chart, index picker). */
export const INDEX_ORDER: { group: Exclude<IndexGroup, "ALL" | "MSCI">; ids: string[] }[] = [
  { group: "KR", ids: ["KOSPI200", "KOSDAQ150", "FTSE_KOREA", "MSCI_KOREA"] },
  { group: "US", ids: ["SP500", "SP100", "NDX"] },
  { group: "JP", ids: ["NIKKEI225"] },
  { group: "CN", ids: ["CSI300", "HSI"] },
  { group: "EU", ids: ["FTSE100", "DAX", "ESTX50"] },
  { group: "IN", ids: ["NIFTY50"] },
];

const NAMES: Record<string, string> = {
  KOSPI200: "코스피200",
  KOSDAQ150: "코스닥150",
  FTSE_KOREA: "FTSE Korea",
  MSCI_KOREA: "MSCI Korea",
  SP500: "S&P 500",
  SP100: "S&P 100",
  NDX: "Nasdaq-100",
  NIKKEI225: "닛케이225",
  CSI300: "CSI 300",
  HSI: "항셍",
  FTSE100: "FTSE 100",
  DAX: "DAX",
  ESTX50: "EURO STOXX 50",
  NIFTY50: "Nifty 50",
};

export function isMsciIndex(id: string): boolean {
  return id.startsWith("MSCI_");
}

export function indexName(id: string): string {
  if (NAMES[id]) return NAMES[id];
  if (!isMsciIndex(id)) return id;
  const country = id
    .replace("MSCI_", "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Usa", "USA");
  return `MSCI ${country}`;
}

export function indexGroup(id: string): Exclude<IndexGroup, "ALL"> {
  if (id === "MSCI_KOREA") return "KR";
  if (isMsciIndex(id)) return "MSCI";
  return INDEX_ORDER.find((g) => g.ids.includes(id))?.group ?? "US";
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
        (b.effective || "9999").localeCompare(a.effective || "9999") ||
        (b.announce || "").localeCompare(a.announce || "") ||
        a.index_id.localeCompare(b.index_id),
    );
}

/** Latest event per region, newest announcement first. */
export function latestEventPerRegion(events: IndexEvent[]): IndexEvent[] {
  const best = new Map<string, IndexEvent>();
  const key = (e: IndexEvent) => e.announce || e.effective || "";
  for (const e of events) {
    const g = indexGroup(e.index_id);
    const cur = best.get(g);
    if (!cur || key(e).localeCompare(key(cur)) > 0) best.set(g, e);
  }
  return [...best.values()].sort((a, b) => key(b).localeCompare(key(a)));
}

/** `date` is ISO when the provider has fixed it; otherwise a coarse label like "2026-11 하순". */
export type RebalanceCalendarItem = {
  date: string;
  title: string;
  sub: string;
  confirmed: boolean;
  url?: string;
};

export const REBALANCE_CALENDAR: RebalanceCalendarItem[] = [
  { date: "2026-10-09", title: "Nasdaq-100 수시 변경 반영", sub: "Moderna 편입 · Warner Bros. Discovery 편출 (개장 전)", confirmed: true, url: "https://www.globenewswire.com/news-release/2026/10/02/3373491/6948/en/moderna-inc-to-join-the-nasdaq-100-index-beginning-october-9-2026.html" },
  { date: "2026-10-30", title: "Russell 12월 재구성 Rank Day", sub: "FTSE Russell · 첫 12월 반기 재구성", confirmed: true },
  { date: "2026-11-11", title: "MSCI 11월 분기 리뷰 발표", sub: "한국시간 11-12 새벽 · 11-30 종가 반영", confirmed: true },
  { date: "2026-11-13", title: "Russell 예비 편출입 리스트", sub: "11-20 · 27, 12-04 갱신", confirmed: true },
  { date: "2026-11 하순", title: "HSI 3분기 정기 리뷰 결과 발표", sub: "9-30 기준 데이터, 8주 이내 발표 원칙 · 12-07 반영", confirmed: false, url: "https://www.hsi.com.hk/static/uploads/contents/en/dl_centre/methodologies/index_methodology_guide_e.pdf" },
  { date: "2026-11 하순", title: "CSI 300 12월 정기심사 결과 발표", sub: "반영 약 2주 전 공표 관행 · 12-14 반영 예상", confirmed: false, url: "https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/000300_Index_Methodology_cn.pdf" },
  { date: "2026-11 하순", title: "KRX 주가지수운영위원회", sub: "코스피200·코스닥150·KRX300 12월 정기변경 심의", confirmed: false },
  { date: "2026-12-02", title: "FTSE 100 12월 분기 리뷰 발표", sub: "12-01 종가 기준 순위 · 영국 장 마감 후 발표", confirmed: true, url: "https://www.lseg.com/content/dam/ftse-russell/en_us/documents/policy-documents/ftse-faq-document-uk-2026.pdf" },
  { date: "2026-12-03", title: "DAX 12월 분기심사 발표", sub: "22시(CET) 이후 발표 · 12-21 반영", confirmed: true, url: "https://stoxx.com/stoxx-gibt-neuzusammensetzung-der-dax-blue-chip-indizes-bekannt-3-sep-2026/" },
  { date: "2026-12-04", title: "S&P 500 4분기 변경 발표", sub: "리밸런싱 2주 전 금요일 관행", confirmed: false },
  { date: "2026-12-07", title: "항셍지수 12월 리밸런싱 반영", sub: "12-04 장 마감 후 실시 (HSI 2026 리밸런싱 일정표)", confirmed: true, url: "https://www.hsi.com.hk/static/uploads/contents/en/products/is_update.xlsx" },
  { date: "2026-12-11", title: "Nasdaq-100 연례 재구성 발표", sub: "12-21 반영 · Russell 재구성 효력(종가)", confirmed: false },
  { date: "2026-12-11", title: "코스피200·코스닥150 정기변경 반영", sub: "12월 선물옵션 만기(12-10) 다음 거래일", confirmed: false },
  { date: "2026-12-14", title: "CSI 300 12월 정기변경 반영", sub: "12월 둘째 금요일(12-11) 다음 거래일 · 규칙 기준", confirmed: false },
  { date: "2026-12-18", title: "미국·유럽 지수 분기 리밸런싱 종가", sub: "S&P · Nasdaq-100 · FTSE 100 · FTSE GEIS · DAX, 12-21 반영", confirmed: true, url: "https://www.lseg.com/content/dam/ftse-russell/en_us/documents/policy-documents/ftse-faq-document-geis-2026.pdf" },
  { date: "2027-02 중순", title: "MSCI 2월 반기 리뷰 발표", sub: "2월 말 종가 반영", confirmed: false },
  { date: "2027-02", title: "Nifty 50 3월 반기 정기변경 발표", sub: "반영 최소 4주 전 공지 · 3월 마지막 거래일 반영", confirmed: false, url: "https://archives.nseindia.com/content/indices/Method_Nifty_50.pdf" },
  { date: "2027-03 초", title: "닛케이225 춘계 정기변경 발표", sub: "4월 첫 영업일 반영", confirmed: false },
  { date: "2027-03-22", title: "FTSE GEIS 3월 반기 리뷰 반영", sub: "FTSE Korea 등 대·중형주 편출입 · 베트남 2단계 편입과 동시", confirmed: true, url: "https://www.lseg.com/content/dam/ftse-russell/en_us/documents/country-classification/country-classification-roadmap.pdf" },
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
  url?: string;
};

export const INDEX_METHODOLOGY: IndexMethodology[] = [
  { name: "MSCI ACWI / EM", provider: "MSCI", universe: "선진 23 · 신흥 24개국 대·중형주 (ACWI 약 2,500종목)", selection: "규칙 기반. GIMI 사이즈 세그먼트 컷오프 + 유동 시총·외국인 한도 + 버퍼", weighting: "유동 시총(FIF)", schedule: "2·5·8·11월 (2·8월 반기, 5·11월 분기). 말일 종가 반영", memo: "8월 리뷰 ACWI 편입 55 · 편출 92. 방글라데시 변경은 11월부터 재개", url: "https://www.msci.com/index-review" },
  { name: "MSCI Korea", provider: "MSCI", universe: "MSCI EM 내 한국 대·중형주 (8월 리뷰 후 74종목)", selection: "전체 시총과 유동 시총 두 기준 동시 충족. 가격 기준일은 직전 월말 10영업일 중 임의일", weighting: "유동 시총", schedule: "MSCI 분기 리뷰와 동일", memo: "투자경고·위험종목 편입 제한 관찰기간 단축(당회 리뷰 기준일부터). 2026-06 선진시장 관찰대상국 등재 보류" },
  { name: "FTSE All-World / FTSE Korea", provider: "FTSE Russell", universe: "GEIS 대·중형주. FTSE는 한국을 선진시장으로 분류(2009~)", selection: "지역별 전체 시총 순위로 상위 70% 대형주, 다음 20% 중형주(버퍼존). All-World·FTSE Korea는 대+중형주, 종목 라인별 유동성 심사", weighting: "유동비율·외국인 한도 반영 시총", schedule: "3·9월 반기 리뷰(12월 말·6월 말 데이터), 6·12월 분기 리뷰는 IPO·주식수 위주. 셋째 금요일 종가 반영", memo: "아태 반기 결과는 반영 약 한 달 전 발표(2026: 02-20, 08-21). 중형↔스몰캡 승강이 All-World 편출입. 베트남 2026-09부터 단계 편입", url: "https://www.lseg.com/content/dam/ftse-russell/en_us/documents/ground-rules/ftse-global-equity-index-series-ground-rules.pdf" },
  { name: "S&P 500", provider: "S&P DJI", universe: "미국 대형주 500사(503종목)", selection: "위원회 재량. 시총 기준·흑자(최근 분기와 4분기 합)·유동비율·유동성 요건", weighting: "유동 시총", schedule: "3·6·9·12월 셋째 금요일 종가, 수시 변경 다수", memo: "2026년 9월까지 편입·편출 각 10여 건. 9월 Bloom Energy 등 3종목 편입", url: "https://www.spglobal.com/spdji/en/documents/methodologies/methodology-sp-us-indices.pdf" },
  { name: "Nasdaq-100", provider: "Nasdaq", universe: "Nasdaq 상장 비금융 상위 100사", selection: "규칙 기반. 12월 연례 재구성 + 3·6·9월 순위 심사(125위 밖 제거)", weighting: "수정 시총, 유동주식 33.3% 미만이면 유동주식의 3배로 상한", schedule: "12월 연례, 3·6·9월 분기. 셋째 금요일 다음 거래일 반영", memo: "2026-05-01 개정: Fast Entry(상위 40위 이내 신규상장 15거래일 후 편입), 최소 유동비율 폐지. SpaceX 7월 편입", url: "https://indexes.nasdaqomx.com/docs/2026_NDX_Changes_FAQ.pdf" },
  { name: "Russell 1000 / 2000", provider: "FTSE Russell", universe: "미국 상위 3,000사 (1000 = 대형, 2000 = 소형)", selection: "규칙 기반. Rank Day 총시총 순위 + 밴딩", weighting: "유동 시총", schedule: "2026년부터 반기: 6월 넷째 금요일, 12월 둘째 금요일. 분기별 IPO 편입", memo: "12월 재구성 30여 년 만에 부활: Rank Day 10-30, 반영 12-11", url: "https://www.lseg.com/en/ftse-russell/russell-reconstitution" },
  { name: "EURO STOXX 50", provider: "STOXX", universe: "EURO STOXX(유로존) 구성종목", selection: "20개 ICB 슈퍼섹터별 대형주로 선정목록 → 유동시총 상위 40종목 + 41~60위 기존 종목 순(40/60 버퍼)", weighting: "유동 시총, 종목당 10% 상한", schedule: "연 1회 9월 정기(셋째 금요일 종가). 월간 Fast Exit(2개월 연속 75위 밖), 분기 Fast Entry(1~25위)", memo: "2026-09 Engie·Nokia 편입, Wolters Kluwer·폭스바겐 우선주 편출", url: "https://www.stoxx.com/document/News/2026/January/stoxx_index_guide_20260130.pdf" },
  { name: "DAX", provider: "STOXX (도이체뵈르제)", universe: "프랑크푸르트 규제시장 상장, Xetra 연속매매, 유동비율 10% 이상, 최소 거래대금 요건", selection: "유동시총 순위 40종목. 분기 Fast Exit 60위 밖 / Fast Entry 33위 이내, 3·9월 Regular Exit 53위 밖 / Entry 40위 이내. 신규 편입은 최근 2년 EBITDA 흑자", weighting: "유동 시총, 종목당 15% 상한", schedule: "3·6·9·12월 분기. 셋째 거래일 22시(CET) 발표, 셋째 금요일 종가 반영", memo: "2026-06 Hochtief 편입·Porsche SE 편출. 2025-12·2026-03·2026-09는 변경 없음", url: "https://www.stoxx.com/document/News/2026/March/DAX%20Equity%20Index%20Methodology%20Guide_5526498614.pdf" },
  { name: "FTSE 100", provider: "FTSE Russell", universe: "런던증권거래소 메인마켓 상장 영국 국적 적격 종목(유동비율·유동성 테스트)", selection: "전체 시총 상위 100. 정기 리뷰에서 90위 이내 비구성종목 편입, 111위 이하 구성종목 편출(FTSE 250과 교체). 인수 등 수시 편출은 차순위로 대체", weighting: "투자가능 가중 시총", schedule: "3·6·9·12월 분기(6월 연간). 첫째 금요일 직전 화요일 종가로 순위, 다음 날 발표. 셋째 금요일 종가 반영", memo: "2026-09 Easyjet·Ithaca Energy 편입, Entain·Persimmon 편출. 10-01 Beazley·Schroders 인수 편출 → WPP·Balfour Beatty 편입", url: "https://www.lseg.com/content/dam/ftse-russell/en_us/documents/ground-rules/ftse-uk-index-series-ground-rules.pdf" },
  { name: "닛케이225", provider: "日本経済新聞社", universe: "도쿄증권거래소 프라임 225종목", selection: "규칙 + 업종 균형. 고유동성 450위 기준, 미편입 상위 75위 편입 후보, 450위 밖 제외 후보. 회당 최대 3종목(기업재편 제외)", weighting: "가격 가중(주가환산계수 적용)", schedule: "연 2회 4·10월 첫 영업일 반영 (2023년부터 춘계 추가)", memo: "2026-04 키옥시아 등 편입, 2026-10 JX금속·KOKUSAI ELECTRIC·캡콤 편입", url: "https://indexes.nikkei.co.jp/nkave" },
  { name: "TOPIX", provider: "JPX 총연", universe: "도쿄증권거래소 상장 종목(프라임 중심)", selection: "유동 시총 기준 단계적 재편 진행 중", weighting: "유동 시총", schedule: "재편 일정은 JPX 공지 확인 필요", memo: "이번 조사 범위 밖. 재편 진행 상황 별도 확인 필요" },
  { name: "CSI 300 (沪深300)", provider: "中证指数 (CSI)", universe: "상하이·선전 A주(비ST). 과창판·창업판은 상장 1년, 기타는 1분기 초과", selection: "1년 일평균 거래대금 하위 50% 제외 → 일평균 총시총 상위 300. 버퍼: 신규 240위 이내 우선 편입, 기존 360위 이내 우선 유지. 회당 교체 통상 10% 이내", weighting: "자유유통 시총(구간별 가중비율)", schedule: "5·11월 하순 심사, 6·12월 둘째 금요일 다음 거래일 반영. 결과는 약 2주 전 공표", memo: "2025-12 11종목, 2026-06 19종목 교체. 2026-09 中金公司 합병으로 信达证券→信立泰 수시 교체 예정(상폐일 미정)", url: "https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/000300_Index_Methodology_cn.pdf" },
  { name: "항셍지수 (HSI)", provider: "Hang Seng Indexes", universe: "항셍종합 대·중형주 구성종목(2차상장 외국기업·B/P 종목 제외), 상장 3개월 이상", selection: "7개 산업그룹별 시총 50% 이상 커버 목표, 시총·거래대금·재무성과 고려, 홍콩 분류 기업 최소 20개. 최종 결정은 자문위원회", weighting: "유동 시총, 종목당 8% 상한(외국기업 4%·합계 10%)", schedule: "분기(3·6·9·12월 말 데이터), 8주 이내 발표, 3·6·9·12월 첫째 금요일 종가 반영", memo: "목표 100종목으로 확대 중: 2025-12 89 → 2026-09 95종목. 2026-01 항셍은행 사유화로 편출", url: "https://www.hsi.com.hk/static/uploads/contents/en/dl_centre/methodologies/IM_hsie.pdf" },
  { name: "Nifty 50", provider: "NSE Indices", universe: "Nifty 100 중 NSE 선물·옵션 거래 가능 종목", selection: "6개월 거래빈도 100%, 충격비용 0.50% 이하. 신규 편입은 6개월 평균 유동시총이 최소 구성종목의 1.5배 이상", weighting: "유동 시총", schedule: "반기: 1·7월 말까지 데이터로 심사, 3·9월 마지막 거래일 반영(최소 4주 전 공지)", memo: "2026-03 변경 없음, 2026-09 BSE 편입·Wipro 편출. 분할 신설법인은 임시 편입 후 요건 미충족 시 제외", url: "https://archives.nseindia.com/content/indices/Method_Nifty_50.pdf" },
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
