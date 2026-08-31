/**
 * Educational payoff figures for overlay ETFs and listed derivatives.
 * Spot S0 = 100. P/L in index points (≈ %). Illustrative, not a quote.
 */

export type PayoffPt = { x: number; y: number };

export type PayoffSeries = {
  id: string;
  label: string;
  color: string;
  width?: number;
  dash?: string;
  fill?: boolean;
  points: PayoffPt[];
};

export type PayoffMark = {
  x?: number;
  y?: number;
  label: string;
  edge?: "top" | "bottom" | "left" | "right";
};

export type PayoffBand = {
  x0: number;
  x1: number;
  fill: string;
  label?: string;
};

export type PayoffFigure = {
  id: string;
  fig: string;
  title: string;
  title_en: string;
  caption: string;
  xLabel: string;
  yLabel: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  series: PayoffSeries[];
  marks?: PayoffMark[];
  bands?: PayoffBand[];
  legend?: boolean;
};

export type DerivEduSection = {
  id: string;
  kicker: string;
  title: string;
  lead: string;
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
  figures: PayoffFigure[];
  schematic?: "els-barrier";
};

export const PAYOFF_INK = {
  paper: "#f6f7f9",
  rule: "#e8eaee",
  axis: "#111111",
  muted: "#6b7280",
  navy: "#2563eb",
  teal: "#64748b",
  rust: "#111111",
  slate: "#9ca3af",
  wine: "#4b5563",
  band: "rgba(37, 99, 235, 0.08)",
  bandTeal: "rgba(100, 116, 139, 0.12)",
  bandRust: "rgba(17, 17, 17, 0.06)",
  bandWine: "rgba(75, 85, 99, 0.10)",
} as const;

export const DERIV_EDU_DISCLAIMER =
  "아래 도판은 만기 손익의 형태를 보이기 위한 교육용 스케치입니다. 프리미엄·캡·버퍼·쿠폰은 가정값이며 실제 ETF·ELS 조건, 롤오버, 수수료, 세금과 다릅니다. 투자 권유가 아닙니다.";

const S0 = 100;
const X0 = 60;
const X1 = 140;

function kinks(ks: number[], lo = X0, hi = X1): number[] {
  return [...new Set([lo, ...ks.filter((k) => k > lo && k < hi), hi])].sort(
    (a, b) => a - b,
  );
}

function poly(xs: number[], fn: (x: number) => number): PayoffPt[] {
  return xs.map((x) => ({ x, y: Number(fn(x).toFixed(4)) }));
}

function dense(lo: number, hi: number, step: number, fn: (x: number) => number): PayoffPt[] {
  const xs: number[] = [];
  for (let x = lo; x <= hi + 1e-9; x += step) xs.push(Number(x.toFixed(4)));
  return poly(xs, fn);
}

function underlying(): PayoffSeries {
  return {
    id: "ul",
    label: "현물",
    color: PAYOFF_INK.slate,
    width: 1.1,
    dash: "5 3.5",
    points: poly(kinks([]), (s) => s - S0),
  };
}

function fig(
  partial: Omit<PayoffFigure, "xLabel" | "yLabel" | "xMin" | "xMax" | "yMin" | "yMax"> &
    Partial<Pick<PayoffFigure, "xLabel" | "yLabel" | "xMin" | "xMax" | "yMin" | "yMax">>,
): PayoffFigure {
  return {
    xLabel: "기초자산 S",
    yLabel: "손익",
    xMin: X0,
    xMax: X1,
    yMin: -40,
    yMax: 40,
    ...partial,
  };
}

/** Long stock + short calls with overwrite weight w at strike K, premium p. */
function cc(s: number, k: number, p: number, w: number): number {
  return s - S0 - w * Math.max(s - k, 0) + w * p;
}

/** Covered call with a call spread (short K1, long K2). */
function ccSpread(s: number, k1: number, k2: number, pNet: number, w: number): number {
  return s - S0 - w * Math.max(s - k1, 0) + w * Math.max(s - k2, 0) + w * pNet;
}

function bufferPay(s: number, buffer: number, cap: number): number {
  const r = (s - S0) / S0;
  if (r >= cap) return cap * 100;
  if (r >= 0) return r * 100;
  if (r >= -buffer) return 0;
  return (r + buffer) * 100;
}

function floorPay(s: number, cap: number): number {
  const r = (s - S0) / S0;
  if (r >= cap) return cap * 100;
  if (r >= 0) return r * 100;
  return 0;
}

function callPay(s: number, k: number, p: number, sign: 1 | -1): number {
  return sign * (Math.max(s - k, 0) - p);
}

function putPay(s: number, k: number, p: number, sign: 1 | -1): number {
  return sign * (Math.max(k - s, 0) - p);
}

const GEN1: PayoffSeries = {
  id: "g1",
  label: "1세대 전량",
  color: PAYOFF_INK.navy,
  width: 2.15,
  fill: true,
  points: poly(kinks([100]), (s) => cc(s, 100, 2.2, 1)),
};

const GEN2: PayoffSeries = {
  id: "g2",
  label: "2세대 부분",
  color: PAYOFF_INK.teal,
  width: 2.15,
  fill: true,
  points: poly(kinks([100]), (s) => cc(s, 100, 2.2, 0.5)),
};

const GEN3: PayoffSeries = {
  id: "g3",
  label: "3세대 스프레드",
  color: PAYOFF_INK.rust,
  width: 2.15,
  fill: true,
  points: poly(kinks([104, 114]), (s) => ccSpread(s, 104, 114, 1.45, 1)),
};

export const COVERED_CALL_TABLE = {
  headers: ["세대", "콜 매도", "행사가", "상승 구간", "분배", "예시"],
  rows: [
    [
      "1세대",
      "전량 100%",
      "ATM",
      "K에서 완전 캡. 기울기 0",
      "가장 두꺼움",
      "QYLD · XYLD · 국내 ATM 커버드콜",
    ],
    [
      "2세대",
      "부분 30–50%",
      "ATM / 약한 OTM",
      "K 이후에도 기울기 잔존",
      "중간",
      "QYLG · JEPI(ELN) · 부분매도형",
    ],
    [
      "3세대",
      "동적 · 콜스프레드",
      "OTM / 타겟",
      "짧은 캡 후 상단 재개방",
      "목표 수익률",
      "SPYI · QQQI · 타겟 데일리 커버드콜",
    ],
  ],
};

const coveredCallFigures: PayoffFigure[] = [
  fig({
    id: "cc-g1",
    fig: "01",
    title: "1세대 · ATM 전량매도",
    title_en: "Covered call · 100% ATM overwrite",
    caption:
      "현물 100% + ATM 콜 전량 매도. 프리미엄(+2.2)만큼 하락이 완충되지만, S>K에서 손익이 수평이 된다. 고배당의 대가.",
    series: [underlying(), { ...GEN1, fill: true }],
    marks: [
      { x: 100, label: "K=ATM", edge: "bottom" },
      { y: 2.2, label: "캡", edge: "right" },
    ],
  }),
  fig({
    id: "cc-g2",
    fig: "02",
    title: "2세대 · 콜 부분매도",
    title_en: "Covered call · 50% overwrite",
    caption:
      "콜을 절반만 판다. K 아래는 현물에 가깝고, K 위에서는 기울기 0.5가 남는다. 분배는 줄고 강세 참여가 열린다.",
    series: [underlying(), { ...GEN2, fill: true }],
    marks: [
      { x: 100, label: "K", edge: "bottom" },
    ],
  }),
  fig({
    id: "cc-g3",
    fig: "03",
    title: "3세대 · OTM 콜스프레드",
    title_en: "Covered call spread · OTM",
    caption:
      "OTM 콜을 팔고 더 높은 행사가 콜을 되산다. K1–K2 구간만 캡이고, K2 위에서 기울기가 현물과 다시 평행해진다.",
    series: [underlying(), { ...GEN3, fill: true }],
    marks: [
      { x: 104, label: "K1", edge: "bottom" },
      { x: 114, label: "K2", edge: "bottom" },
    ],
    bands: [{ x0: 104, x1: 114, fill: PAYOFF_INK.bandRust, label: "캡 구간" }],
  }),
  fig({
    id: "cc-all",
    fig: "04",
    title: "1·2·3세대 중첩",
    title_en: "Generation overlay",
    caption:
      "같은 현물 위에서 전량 캡(남색), 부분 기울기(청록), 스프레드 재개방(적갈)이 갈린다. 분배와 상승 참여는 트레이드오프.",
    legend: true,
    series: [
      underlying(),
      { ...GEN1, fill: false, width: 1.85 },
      { ...GEN2, fill: false, width: 1.85 },
      { ...GEN3, fill: false, width: 1.85 },
    ],
    marks: [{ x: 100, label: "S₀", edge: "bottom" }],
  }),
];

const bufferFigures: PayoffFigure[] = [
  fig({
    id: "buf-10",
    fig: "05",
    title: "버퍼 ETF · 10% / 캡 15%",
    title_en: "Defined outcome · 10% buffer",
    caption:
      "성과기간 초반 하락 10%를 깎고, 그 비용을 콜 매도로 댄다. 0~−10%는 수평, −10% 이하는 1:1, +15%에서 캡.",
    series: [
      underlying(),
      {
        id: "buf",
        label: "버퍼10",
        color: PAYOFF_INK.navy,
        width: 2.15,
        fill: true,
        points: poly(kinks([90, 100, 115]), (s) => bufferPay(s, 0.1, 0.15)),
      },
    ],
    bands: [{ x0: 90, x1: 100, fill: PAYOFF_INK.band, label: "Buffer" }],
    marks: [
      { x: 90, label: "−10%", edge: "bottom" },
      { x: 115, label: "캡", edge: "bottom" },
    ],
  }),
  fig({
    id: "buf-15",
    fig: "06",
    title: "파워버퍼 · 15% / 캡 10%",
    title_en: "Power buffer · 15%",
    caption:
      "버퍼를 깊게 하면 캡이 낮아진다. 방어형 시리즈(파워·울트라)의 전형. 기간 중 매수 시 남은 버퍼·캡이 달라진다.",
    series: [
      underlying(),
      {
        id: "pbuf",
        label: "파워15",
        color: PAYOFF_INK.teal,
        width: 2.15,
        fill: true,
        points: poly(kinks([85, 100, 110]), (s) => bufferPay(s, 0.15, 0.1)),
      },
    ],
    bands: [{ x0: 85, x1: 100, fill: PAYOFF_INK.bandTeal, label: "Buffer" }],
    marks: [
      { x: 85, label: "−15%", edge: "bottom" },
      { x: 110, label: "캡", edge: "bottom" },
    ],
  }),
  fig({
    id: "buf-floor",
    fig: "07",
    title: "플로어 0% · 캡 8%",
    title_en: "Outcome floor at 0%",
    caption:
      "버퍼가 아니라 원금 하단(0%)을 목표로 풋을 더 깊게 산다. 하락은 막히지만 강세 소외가 가장 크다.",
    series: [
      underlying(),
      {
        id: "fl",
        label: "플로어",
        color: PAYOFF_INK.rust,
        width: 2.15,
        fill: true,
        points: poly(kinks([100, 108]), (s) => floorPay(s, 0.08)),
      },
    ],
    marks: [
      { y: 0, label: "Floor", edge: "left" },
      { x: 108, label: "캡", edge: "bottom" },
    ],
  }),
];

const elsFigures: PayoffFigure[] = [
  fig({
    id: "els-terminal",
    fig: "08",
    title: "오토콜 · 만기 페이오프",
    title_en: "Autocallable ELS · terminal",
    caption:
      "KI 미발생(청록): 배리어 위에서는 쿠폰으로 수평. KI 발생(적갈): 100 이하는 1:1 원금손실, 100 이상은 쿠폰. 조기상환은 도판 09.",
    legend: true,
    xMin: 50,
    yMin: -45,
    yMax: 25,
    series: [
      {
        id: "noki",
        label: "KI 없음",
        color: PAYOFF_INK.teal,
        width: 2.05,
        points: poly([55, 100, 140], () => 12),
      },
      {
        id: "ki",
        label: "KI 발생",
        color: PAYOFF_INK.wine,
        width: 2.15,
        fill: true,
        points: poly(kinks([55, 100], 50, 140), (s) => (s >= 100 ? 12 : s - S0)),
      },
    ],
    bands: [{ x0: 55, x1: 100, fill: PAYOFF_INK.bandWine, label: "KI 존" }],
    marks: [
      { x: 55, label: "KI 55%", edge: "bottom" },
      { x: 100, label: "행사가", edge: "bottom" },
      { y: 12, label: "쿠폰", edge: "right" },
    ],
  }),
];

const optionFigures: PayoffFigure[] = [
  fig({
    id: "opt-lc",
    fig: "10",
    title: "롱 콜",
    title_en: "Long call",
    caption: "권리만 산다. 손실은 프리미엄으로 한정, 상승은 열린다. 볼·방향 매수.",
    yMin: -20,
    yMax: 40,
    series: [
      {
        id: "lc",
        label: "Long call",
        color: PAYOFF_INK.navy,
        width: 2.15,
        fill: true,
        points: poly(kinks([100]), (s) => callPay(s, 100, 4, 1)),
      },
    ],
    marks: [{ x: 100, label: "K", edge: "bottom" }],
  }),
  fig({
    id: "opt-sc",
    fig: "11",
    title: "숏 콜",
    title_en: "Short call",
    caption: "커버드콜의 옵션 다리. 이익은 프리미엄, 손실은 이론상 무한. 나체 매도는 증거금이 큼.",
    yMin: -40,
    yMax: 20,
    series: [
      {
        id: "sc",
        label: "Short call",
        color: PAYOFF_INK.wine,
        width: 2.15,
        fill: true,
        points: poly(kinks([100]), (s) => callPay(s, 100, 4, -1)),
      },
    ],
    marks: [{ x: 100, label: "K", edge: "bottom" }],
  }),
  fig({
    id: "opt-lp",
    fig: "12",
    title: "롱 풋",
    title_en: "Long put",
    caption: "하락 보험. 프로텍티브 풋의 옵션 다리. 시간가치 소모가 비용.",
    yMin: -20,
    yMax: 40,
    series: [
      {
        id: "lp",
        label: "Long put",
        color: PAYOFF_INK.navy,
        width: 2.15,
        fill: true,
        points: poly(kinks([100]), (s) => putPay(s, 100, 4, 1)),
      },
    ],
    marks: [{ x: 100, label: "K", edge: "bottom" }],
  }),
  fig({
    id: "opt-sp",
    fig: "13",
    title: "숏 풋",
    title_en: "Short put",
    caption: "현금담보 풋매도와 같은 형태. 횡보·완만한 상승에서 프리미엄, 급락 시 현물 매수와 유사.",
    yMin: -40,
    yMax: 20,
    series: [
      {
        id: "sp",
        label: "Short put",
        color: PAYOFF_INK.wine,
        width: 2.15,
        fill: true,
        points: poly(kinks([100]), (s) => putPay(s, 100, 4, -1)),
      },
    ],
    marks: [{ x: 100, label: "K", edge: "bottom" }],
  }),
  fig({
    id: "opt-bull",
    fig: "14",
    title: "불 콜 스프레드",
    title_en: "Bull call spread",
    caption: "K1 콜 매수 + K2 콜 매도. 순차변. 상승 폭을 제한해 프리미엄을 낮춘다. 3세대 커버드콜의 상단 조각.",
    yMin: -15,
    yMax: 20,
    series: [
      {
        id: "bull",
        label: "Bull",
        color: PAYOFF_INK.teal,
        width: 2.15,
        fill: true,
        points: poly(kinks([95, 110]), (s) => callPay(s, 95, 6, 1) + callPay(s, 110, 2.2, -1)),
      },
    ],
    marks: [
      { x: 95, label: "K1", edge: "bottom" },
      { x: 110, label: "K2", edge: "bottom" },
    ],
  }),
  fig({
    id: "opt-straddle",
    fig: "15",
    title: "롱 스트래들",
    title_en: "Long straddle",
    caption: "같은 행사가 콜+풋 매수. 큰 움직임이면 이익, 작은 움직임이면 프리미엄 소진. 숏은 반대(아이언 플라이의 핵).",
    yMin: -20,
    yMax: 40,
    series: [
      {
        id: "str",
        label: "Straddle",
        color: PAYOFF_INK.navy,
        width: 2.15,
        fill: true,
        points: poly(kinks([100]), (s) => callPay(s, 100, 4, 1) + putPay(s, 100, 4, 1)),
      },
    ],
    marks: [{ x: 100, label: "K", edge: "bottom" }],
  }),
  fig({
    id: "opt-fly",
    fig: "16",
    title: "롱 버터플라이",
    title_en: "Long butterfly",
    caption: "K−d 콜 + 2×K 숏 콜 + K+d 콜. 만기가 K 근처로 오면 이익. 낮은 실현변동성 베팅.",
    yMin: -12,
    yMax: 18,
    series: [
      {
        id: "fly",
        label: "Butterfly",
        color: PAYOFF_INK.navy,
        width: 2.15,
        fill: true,
        points: poly(kinks([90, 100, 110]), (s) => {
          const debit = 1.6;
          return (
            Math.max(s - 90, 0) -
            2 * Math.max(s - 100, 0) +
            Math.max(s - 110, 0) -
            debit
          );
        }),
      },
    ],
    marks: [
      { x: 90, label: "K−d", edge: "bottom" },
      { x: 100, label: "K", edge: "bottom" },
      { x: 110, label: "K+d", edge: "bottom" },
    ],
  }),
  fig({
    id: "opt-ic",
    fig: "17",
    title: "숏 아이언 콘도르",
    title_en: "Short iron condor",
    caption: "OTM 풋스프레드 + OTM 콜스프레드 매도. 범위 안에 머물면 순프리미엄. 양 날개가 손실 한도.",
    yMin: -18,
    yMax: 12,
    series: [
      {
        id: "ic",
        label: "Iron condor",
        color: PAYOFF_INK.rust,
        width: 2.15,
        fill: true,
        points: poly(kinks([80, 90, 110, 120]), (s) => {
          const put = putPay(s, 90, 2.4, -1) + putPay(s, 80, 1.1, 1);
          const call = callPay(s, 110, 2.4, -1) + callPay(s, 120, 1.1, 1);
          return put + call;
        }),
      },
    ],
    marks: [
      { x: 90, label: "Ps", edge: "bottom" },
      { x: 110, label: "Cs", edge: "bottom" },
    ],
    bands: [{ x0: 90, x1: 110, fill: PAYOFF_INK.bandRust, label: "수익 구간" }],
  }),
];

const futuresFigures: PayoffFigure[] = [
  fig({
    id: "fut-long",
    fig: "18",
    title: "롱 선물",
    title_en: "Long futures",
    caption: "만기 손익 = S_T − F₀. 프리미엄이 없고 기울기 1. 증거금·일일정산이 현물 매수와 다른 점.",
    series: [
      {
        id: "lf",
        label: "Long F",
        color: PAYOFF_INK.navy,
        width: 2.15,
        fill: true,
        points: poly(kinks([100]), (s) => s - 100),
      },
    ],
    marks: [{ x: 100, label: "F₀", edge: "bottom" }],
  }),
  fig({
    id: "fut-short",
    fig: "19",
    title: "숏 선물",
    title_en: "Short futures",
    caption: "헤지·약세 포지션. 손익 = F₀ − S_T. 현물 보유와 결합하면 베이시스만 남는다.",
    series: [
      {
        id: "sf",
        label: "Short F",
        color: PAYOFF_INK.wine,
        width: 2.15,
        fill: true,
        points: poly(kinks([100]), (s) => 100 - s),
      },
    ],
    marks: [{ x: 100, label: "F₀", edge: "bottom" }],
  }),
  fig({
    id: "fut-pp",
    fig: "20",
    title: "프로텍티브 풋",
    title_en: "Protective put",
    caption: "현물 + 롱 풋. 하락은 K − S₀ − p에서 바닥, 상승은 현물에 가깝다. 버퍼 ETF가 이 보험을 캡 매도로 산다.",
    series: [
      underlying(),
      {
        id: "pp",
        label: "Stock+put",
        color: PAYOFF_INK.navy,
        width: 2.15,
        fill: true,
        points: poly(kinks([90]), (s) => s - S0 + putPay(s, 90, 3.2, 1)),
      },
    ],
    marks: [{ x: 90, label: "Put K", edge: "bottom" }],
  }),
  fig({
    id: "fut-collar",
    fig: "21",
    title: "칼라",
    title_en: "Collar",
    caption: "현물 + 롱 풋 + 숏 콜. 버퍼 ETF의 뼈대. 풋 비용을 콜 프리미엄으로 상쇄하고 상승을 캡으로 판다.",
    series: [
      underlying(),
      {
        id: "col",
        label: "Collar",
        color: PAYOFF_INK.teal,
        width: 2.15,
        fill: true,
        points: poly(kinks([90, 112]), (s) => s - S0 + putPay(s, 90, 3.2, 1) + callPay(s, 112, 2.4, -1)),
      },
    ],
    marks: [
      { x: 90, label: "Put", edge: "bottom" },
      { x: 112, label: "Call", edge: "bottom" },
    ],
  }),
  fig({
    id: "fut-cal",
    fig: "22",
    title: "캘린더 스프레드",
    title_en: "Calendar spread (near expiry)",
    caption:
      "근월 숏 + 원월 롱(같은 K). 근월 만기 시점의 손익은 ATM 근처에서 봉우리. 시간가치·낮은 실현볼 베팅.",
    series: [
      {
        id: "cal",
        label: "Calendar",
        color: PAYOFF_INK.navy,
        width: 2.15,
        fill: true,
        points: dense(X0, X1, 2, (s) => {
          const z = (s - 100) / 13;
          return 3.5 * Math.exp(-0.5 * z * z) - 1.05;
        }),
      },
    ],
    marks: [{ x: 100, label: "K", edge: "bottom" }],
    yMin: -8,
    yMax: 8,
  }),
  fig({
    id: "fut-cac",
    fig: "23",
    title: "캐시 앤 캐리",
    title_en: "Cash-and-carry",
    caption:
      "현물 매수 + 선물 매도. 만기 두 다리가 상쇄되어 손익이 수평(보유비용 대비 베이시스). 시장 선물이 이론가보다 높을 때 잠근다.",
    legend: true,
    series: [
      {
        id: "spotleg",
        label: "롱 현물",
        color: PAYOFF_INK.slate,
        width: 1.15,
        dash: "5 3.5",
        points: poly(kinks([]), (s) => s - S0),
      },
      {
        id: "futleg",
        label: "숏 선물",
        color: PAYOFF_INK.wine,
        width: 1.15,
        dash: "4 3",
        points: poly(kinks([]), (s) => 105 - s),
      },
      {
        id: "net",
        label: "순손익",
        color: PAYOFF_INK.navy,
        width: 2.2,
        fill: true,
        points: poly(kinks([]), () => 5),
      },
    ],
    marks: [
      { x: 100, label: "S₀", edge: "bottom" },
      { y: 5, label: "베이시스", edge: "right" },
    ],
    yMin: -40,
    yMax: 40,
  }),
];

export const DERIV_EDU_SECTIONS: DerivEduSection[] = [
  {
    id: "covered-call",
    kicker: "I",
    title: "커버드콜 ETF · 1·2·3세대",
    lead:
      "현물을 들고 콜을 파는 구조는 같다. 세대 차이는 ‘얼마를, 어느 행사가에, 전량인지 일부인지’다. 전량 ATM은 분배가 크고 상승이 닫히며, 부분매도는 기울기를 남기고, 콜스프레드·OTM 타겟은 캡을 짧게 한 뒤 상단을 다시 연다.",
    table: COVERED_CALL_TABLE,
    bullets: [
      "손익은 만기 한 장의 스냅샷이다. 실제 ETF는 월·주·0DTE로 롤하므로 캡이 매달 리셋된다.",
      "JEPI류 2세대는 옵션 대신 ELN으로 콜 매도를 복제하는 경우가 많다. 페이오프 형태는 부분 오버라이트에 가깝다.",
    ],
    figures: coveredCallFigures,
  },
  {
    id: "buffer",
    kicker: "II",
    title: "버퍼 · 정의된 성과 ETF",
    lead:
      "커버드콜이 프리미엄을 분배로 가져간다면, 버퍼는 그 돈으로 풋을 산다. FLEX 옵션으로 1년 성과기간의 하단 버퍼와 상단 캡을 고정한다. 이노베이터·FT 베스트·알리안츠IM이 같은 뼈대다.",
    bullets: [
      "기간 중간에 사면 남은 버퍼와 캡이 시세에 따라 달라진다. 래더 상품은 월별 시리즈를 나눠 담아 그 타이밍을 죽인다.",
      "울트라 버퍼는 처음 수 %를 본인 부담(deductible)으로 두고 그다음 구간을 두껍게 깎는다. 아래 도판은 표준 버퍼·파워·플로어.",
    ],
    figures: bufferFigures,
  },
  {
    id: "autocall",
    kicker: "III",
    title: "오토콜러블 ETF · ELS (배리어 옵션)",
    lead:
      "한국 ELS와 미국 오토콜러블 정의성과 ETF는 같은 배리어 옵션 가족이다. 관측일에 기초자산이 조기상환 장벽 위면 쿠폰과 함께 상환되고, 만기까지 배리어(KI)를 깨면 원금이 지수에 1:1로 묶일 수 있다.",
    bullets: [
      "낙인(KI)은 경로 의존이다. 한 번이라도 배리어를 찍으면 ‘쿠폰 수평’이 사라지고 만기 1:1이 열린다.",
      "스텝다운: 조기상환 장벽이 관측일마다 내려가 상환 확률을 높이는 대신 쿠폰이 얇아지기도 한다.",
      "리자드·부분보장형은 KI 아래를 일부만 노출한다. 아래는 표준 스텝다운 2-star의 뼈대.",
    ],
    figures: elsFigures,
    schematic: "els-barrier",
  },
  {
    id: "options",
    kicker: "IV",
    title: "옵션 기본 전략",
    lead:
      "ETF 페이오프는 아래 블록의 합이다. 콜·풋의 장·숏, 스프레드, 스트래들, 버터플라이, 콘도르만 읽혀도 대부분의 오버레이를 분해할 수 있다.",
    figures: optionFigures,
  },
  {
    id: "futures",
    kicker: "V",
    title: "선물 · 헤지 결합",
    lead:
      "선물 한 다리는 기울기 ±1의 직선이다. 현물과 붙이면 베이시스, 옵션과 붙이면 칼라·커버드콜, 원근월을 붙이면 캘린더가 된다.",
    bullets: [
      "캐시 앤 캐리: 선물이 이론 선도(보유비용)보다 비싸면 현물 매수+선물 매도로 잠근다. 반대는 리버스 캐리.",
      "크랙·크러시 등 상품 간 스프레드도 결국 여러 선물의 기울기를 더해 하나의 스프레드 가격에 베팅하는 것이다.",
    ],
    figures: futuresFigures,
  },
];
