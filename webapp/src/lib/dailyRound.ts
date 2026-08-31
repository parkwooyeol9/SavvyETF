/** Daily 4-question learning round. Uses cached heatmap + briefs + static catalogs. */

import { loadAllBriefs } from "@/lib/briefs";
import {
  COMPANY_BY_ID,
  LABOR_EVENTS,
  STAGE_LABEL,
  STAGE_META,
  isoTodayKst,
  type LaborStage,
} from "@/lib/laborRisk";
import { buildLocalHeatmap, type HeatmapCell } from "@/lib/heatmap";
import { TAB_LABELS, type ShellTabId, type TabId } from "@/lib/types";
import { withServerCache } from "@/lib/apiCache";

export type DailyRoundChoice = {
  id: string;
  label: string;
};

export type DailyRoundQuestion = {
  id: string;
  kicker: string;
  prompt: string;
  detail?: string;
  choices: DailyRoundChoice[];
  answerId: string;
  explain: string;
  moreTab: ShellTabId;
  moreLabel: string;
};

export type DailyRoundPayload = {
  ok: boolean;
  error?: string;
  date: string;
  generated_at: string;
  questions: DailyRoundQuestion[];
};

const STYLE_GROUPS: Array<{
  id: string;
  label: string;
  tickers: string[];
}> = [
  { id: "growth", label: "성장", tickers: ["VUG", "IWF", "VGT", "QQQ", "SMH"] },
  { id: "value", label: "가치", tickers: ["VTV", "SCHD", "XLF"] },
  { id: "intl", label: "해외", tickers: ["VEA", "VXUS", "IEMG"] },
];

const TAX_BANK: Array<{
  prompt: string;
  detail?: string;
  answer: string;
  distractors: string[];
  explain: string;
}> = [
  {
    prompt: "국내 코스피·코스닥을 추종하는 국내주식형 ETF의 매매차익은?",
    answer: "비과세",
    distractors: ["배당소득세 15.4%", "양도소득세 22%"],
    explain:
      "국내주식형 ETF 매매차익은 비과세입니다. 분배금만 배당소득으로 원천징수됩니다.",
  },
  {
    prompt: "국내 상장 해외주식형 ETF를 매도할 때 매매차익의 세금 분류는?",
    answer: "배당소득 15.4%",
    distractors: ["비과세", "양도소득 22%(기본공제 250만 원)"],
    explain:
      "국내상장 해외·기타 ETF 매매차익은 양도세가 아니라 배당소득 15.4%입니다. 금융소득종합과세에 잡힐 수 있습니다.",
  },
  {
    prompt: "미국 상장 ETF(예: SPY) 매매차익의 기본 과세는?",
    answer: "양도소득 22%(연 250만 원 공제)",
    distractors: ["비과세", "배당소득 15.4%만"],
    explain:
      "해외 직투 매매차익은 양도소득세 22%(기본공제 연 250만 원)이고, 다음 해 5월 신고가 일반적입니다.",
  },
  {
    prompt: "중개형 ISA에서 미국 상장 ETF를 직접 매매할 수 있나요?",
    answer: "불가 — 국내 상장 ETF만",
    distractors: ["가능 — 한도 없음", "가능 — 연 2,000만 원까지"],
    explain:
      "중개형 ISA는 국내 상장 ETF·주식 중심입니다. 해외 상장 ETF 직접매매는 일반 해외주식 계좌에서 합니다.",
  },
];

function hashDay(iso: string): number {
  let h = 2166136261;
  for (let i = 0; i < iso.length; i++) {
    h = Math.imul(h ^ iso.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = Math.imul(a ^ (a >>> 15), a | 1);
    a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length) % items.length]!;
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function meanReturn(cells: HeatmapCell[], tickers: string[]): number | null {
  const set = new Set(tickers);
  const hits = cells.filter((c) => set.has(c.ticker));
  if (!hits.length) return null;
  return hits.reduce((s, c) => s + c.daily_return_pct, 0) / hits.length;
}

async function heatmapQuestion(
  date: string,
  rand: () => number,
): Promise<DailyRoundQuestion> {
  try {
    const heat = await withServerCache(
      "heatmap:v1:etf:30:local",
      110_000,
      300_000,
      () => buildLocalHeatmap("etf", 30),
    );
    const cells = heat.ok ? heat.cells || [] : [];
    const scored = STYLE_GROUPS.map((g) => ({
      ...g,
      avg: meanReturn(cells, g.tickers),
    })).filter((g) => g.avg != null) as Array<{
      id: string;
      label: string;
      avg: number;
    }>;
    if (scored.length >= 2) {
      scored.sort((a, b) => b.avg - a.avg);
      const winner = scored[0]!;
      const choices = shuffle(
        STYLE_GROUPS.map((g) => ({ id: g.id, label: g.label })),
        rand,
      );
      const bestCell = (heat.cells || [])
        .slice()
        .sort((a, b) => b.daily_return_pct - a.daily_return_pct)[0];
      return {
        id: "heatmap",
        kicker: "1. 히트맵",
        prompt: "오늘 ETF 히트맵에서 상대적으로 강한 스타일은?",
        detail: bestCell
          ? `참고: 상위 칸 예 ${bestCell.ticker} ${bestCell.daily_return_pct >= 0 ? "+" : ""}${bestCell.daily_return_pct.toFixed(1)}%`
          : undefined,
        choices,
        answerId: winner.id,
        explain: `${winner.label} 스타일 평균이 오늘 더 강했습니다. 메인 히트맵에서 칸 크기는 AUM, 색은 일간 수익률입니다.`,
        moreTab: "main",
        moreLabel: "메인 히트맵 보기",
      };
    }
  } catch {
    // fall through to static
  }
  return {
    id: "heatmap",
    kicker: "1. 히트맵",
    prompt: "미국 상장 VUG ETF가 주로 담는 스타일은?",
    choices: shuffle(
      STYLE_GROUPS.map((g) => ({ id: g.id, label: g.label })),
      rand,
    ),
    answerId: "growth",
    explain:
      "VUG는 대형 성장주 바구니입니다. 가치(VTV)·해외(VXUS)와 나눠 보면 히트맵 색깔이 더 잘 읽힙니다.",
    moreTab: "main",
    moreLabel: "메인 히트맵 보기",
  };
}

async function briefQuestion(rand: () => number): Promise<DailyRoundQuestion> {
  const fallback: DailyRoundQuestion = {
    id: "brief",
    kicker: "2. 시황 한 줄",
    prompt: "국내시황·미국시황·ETF시황 브리프가 올라가는 탭은 어디인가요?",
    choices: [
      { id: "kr", label: TAB_LABELS.kr },
      { id: "us", label: TAB_LABELS.us },
      { id: "etf", label: TAB_LABELS.etf },
    ],
    answerId: "kr",
    explain: "시황 대분류 아래 국내·미국·ETF 탭에 텔레그램 브리프가 쌓입니다.",
    moreTab: "kr",
    moreLabel: "국내시황 보기",
  };
  try {
    const loaded = await withServerCache("briefs:v1", 45_000, 180_000, loadAllBriefs);
    const candidates: Array<{ tab: TabId; title: string }> = [];
    for (const tab of ["kr", "us", "etf"] as TabId[]) {
      const slots = Object.values(loaded.briefs[tab]?.slots || {});
      const titled = slots.find((s) => (s.title || "").trim().length > 4);
      if (titled) candidates.push({ tab, title: titled.title.trim() });
    }
    if (!candidates.length) return fallback;
    const picked = pick(candidates, rand);
    const title =
      picked.title.length > 72 ? `${picked.title.slice(0, 70)}…` : picked.title;
    return {
      id: "brief",
      kicker: "2. 시황 한 줄",
      prompt: "이 브리프 제목은 어느 시황 탭의 것인가요?",
      detail: title,
      choices: shuffle(
        (["kr", "us", "etf"] as TabId[]).map((id) => ({
          id,
          label: TAB_LABELS[id],
        })),
        rand,
      ),
      answerId: picked.tab,
      explain: `「${title}」은 ${TAB_LABELS[picked.tab]} 슬롯입니다. 해설은 해당 탭 브리프에서 이어집니다.`,
      moreTab: picked.tab,
      moreLabel: `${TAB_LABELS[picked.tab]} 보기`,
    };
  } catch {
    return fallback;
  }
}

function laborQuestion(rand: () => number): DailyRoundQuestion {
  const ev = pick(LABOR_EVENTS, rand);
  const company = COMPANY_BY_ID[ev.company];
  const choices = shuffle(
    STAGE_META.map((s) => ({ id: s.id, label: s.label })),
    rand,
  );
  return {
    id: "labor",
    kicker: "3. 사건 추리",
    prompt: `${company.label} · ${ev.date}`,
    detail: ev.summary,
    choices,
    answerId: ev.stage,
    explain: `${STAGE_LABEL[ev.stage as LaborStage]} 단계입니다. ${ev.news} 시황 → 이벤트 스터디 → 노동리스크에서 D/D+5/D+20을 볼 수 있습니다.`,
    moreTab: "eventstudy",
    moreLabel: "이벤트 스터디 보기",
  };
}

function taxQuestion(date: string, rand: () => number): DailyRoundQuestion {
  const item = TAX_BANK[hashDay(date) % TAX_BANK.length]!;
  const labels = shuffle([item.answer, ...item.distractors], rand);
  const choices = labels.map((label, i) => ({ id: `t${i}`, label }));
  const answerId = choices.find((c) => c.label === item.answer)!.id;
  return {
    id: "tax",
    kicker: "4. 세금·계좌",
    prompt: item.prompt,
    detail: item.detail,
    choices,
    answerId,
    explain: item.explain,
    moreTab: "education",
    moreLabel: "환율·세금 보기",
  };
}

export async function buildDailyRound(): Promise<DailyRoundPayload> {
  const date = isoTodayKst();
  const rand = rng(hashDay(date) ^ 0x9e3779b9);
  const questions = [
    await heatmapQuestion(date, rand),
    await briefQuestion(rand),
    laborQuestion(rand),
    taxQuestion(date, rand),
  ];
  return {
    ok: true,
    date,
    generated_at: new Date().toISOString(),
    questions,
  };
}
