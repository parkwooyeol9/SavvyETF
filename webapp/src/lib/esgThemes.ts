/**
 * ESG tab priority themes — ranked by financial significance.
 * Market proxies: Yahoo daily bars (no persistent storage).
 */

export type EsgThemeId = "power" | "climate" | "governance";

export type EsgThemePoint = {
  date: string;
  close: number;
};

export type EsgThemeSignal = {
  id: string;
  symbol: string;
  label: string;
  thesis: string;
  price: number | null;
  change_1d_pct: number | null;
  change_1m_pct: number | null;
  series?: EsgThemePoint[];
  error?: string;
};

export type EsgThemePillar = {
  id: EsgThemeId;
  rank: 1 | 2 | 3;
  title: string;
  title_en: string;
  significance: string;
  implication: string;
  implication_ko: string;
  blurb: string;
  signals: EsgThemeSignal[];
};

export type EsgThemesPayload = {
  ok: boolean;
  generated_at: string;
  note: string;
  pillars: EsgThemePillar[];
  error?: string;
};

export const ESG_THEME_SPECS: Array<{
  id: EsgThemeId;
  rank: 1 | 2 | 3;
  title: string;
  title_en: string;
  significance: string;
  implication: string;
  implication_ko: string;
  blurb: string;
  signals: Array<{
    id: string;
    symbol: string;
    label: string;
    thesis: string;
  }>;
}> = [
  {
    id: "power",
    rank: 1,
    title: "전력 수요·그리드·에너지 안보",
    title_en: "Electricity demand, grids and energy security",
    significance: "Very high",
    implication: "Structural investment opportunity",
    implication_ko: "구조적 투자 기회",
    blurb:
      "AI·데이터센터·전가화가 전력 수요를 끌어올리고, 송배전·유틸리티·청정전력이 병목이 됩니다.",
    signals: [
      {
        id: "grid",
        symbol: "GRID",
        label: "스마트그리드",
        thesis: "송배전·그리드 인프라",
      },
      {
        id: "xlu",
        symbol: "XLU",
        label: "유틸리티",
        thesis: "규제 전력·배당 방어",
      },
      {
        id: "icln",
        symbol: "ICLN",
        label: "클린에너지",
        thesis: "재생·에너지 전환",
      },
      {
        id: "nlr",
        symbol: "NLR",
        label: "원자력",
        thesis: "기저부하·에너지 안보",
      },
      {
        id: "pave",
        symbol: "PAVE",
        label: "인프라",
        thesis: "건설·전력망 확장",
      },
    ],
  },
  {
    id: "climate",
    rank: 2,
    title: "물리적 기후위험·적응",
    title_en: "Physical climate risk and adaptation",
    significance: "Very high",
    implication: "Underappreciated portfolio downside",
    implication_ko: "과소평가된 포트폴리오 하방",
    blurb:
      "폭염·홍수·지진 등 물리적 충격은 자산·공급망 손실로 이어집니다. 적응·인프라·물 스트레스가 핵심입니다.",
    signals: [
      {
        id: "ifra",
        symbol: "IFRA",
        label: "실물 인프라",
        thesis: "적응·내구 인프라",
      },
      {
        id: "pio",
        symbol: "PHO",
        label: "물 인프라",
        thesis: "물 스트레스·수처리",
      },
      {
        id: "wood",
        symbol: "WOOD",
        label: "임업·목재",
        thesis: "자연자본·공급 충격",
      },
      {
        id: "krbn",
        symbol: "KRBN",
        label: "탄소배출권",
        thesis: "전환·탄소가격 압력",
      },
    ],
  },
  {
    id: "governance",
    rank: 3,
    title: "거버넌스·AI·사이버보안",
    title_en: "Governance, AI and cybersecurity",
    significance: "Very high",
    implication: "Essential company-level quality screen",
    implication_ko: "기업 단위 품질 스크리닝 필수",
    blurb:
      "AI 도입과 사이버 위협이 운영·평판 리스크를 키웁니다. 이사회·보안·주주환원 공시가 품질 필터입니다.",
    signals: [
      {
        id: "hack",
        symbol: "HACK",
        label: "사이버보안",
        thesis: "보안 지출·침해 대응",
      },
      {
        id: "cibr",
        symbol: "CIBR",
        label: "사이버 (CIBR)",
        thesis: "보안 소프트웨어·서비스",
      },
      {
        id: "botz",
        symbol: "BOTZ",
        label: "AI·로보틱스",
        thesis: "자동화·AI 인프라",
      },
      {
        id: "igv",
        symbol: "IGV",
        label: "소프트웨어",
        thesis: "기업 IT·거버넌스 툴",
      },
    ],
  },
];
