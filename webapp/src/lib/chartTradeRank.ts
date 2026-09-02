import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import {
  ROUNDS,
  clampWeight,
  fmtKrw,
  getChartTrade,
  isoTodayKst,
  scoreRun,
  shiftIsoDate,
} from "@/lib/chartTrade";
import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

const STORE_KEY = "chart-trade/rankings.json";
const MAX_ENTRIES = 200;
export const BOARD_TODAY = 15;
export const BOARD_ALL = 10;
export const TODAY_TOP = 3;

export type RankEntry = {
  id: string;
  nickname: string;
  date: string;
  equity: number;
  pnl_pct: number;
  weights: number[];
  created_at: string;
};

export type RankPublic = {
  id: string;
  nickname: string;
  date: string;
  equity: number;
  pnl_pct: number;
  created_at: string;
};

export type RankRival = {
  nickname: string;
  equity: number;
  pnl_pct: number;
  weights: number[];
};

export type CeremonyKind = "alltime" | "today1" | "hall" | "top3" | "none";

export type Ceremony = {
  kind: CeremonyKind;
  title: string;
  body: string;
  dealer: string;
};

export type RankStore = {
  updated_at: string;
  entries: RankEntry[];
};

export type RankBoards = {
  today: RankEntry[];
  all: RankEntry[];
};

function emptyStore(): RankStore {
  return { updated_at: new Date().toISOString(), entries: [] };
}

function parseStore(raw: string | null): RankStore {
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as RankStore;
    if (!parsed || !Array.isArray(parsed.entries)) return emptyStore();
    return {
      updated_at: parsed.updated_at || new Date().toISOString(),
      entries: parsed.entries.filter(
        (e) =>
          e &&
          typeof e.nickname === "string" &&
          typeof e.date === "string" &&
          Number.isFinite(e.equity),
      ),
    };
  } catch {
    return emptyStore();
  }
}

function localRankPath(): string {
  const dir = process.env.VERCEL === "1" ? "/tmp" : path.join(process.cwd(), "data");
  return path.join(dir, "chart-trade-rank.json");
}

async function loadLocal(): Promise<RankStore> {
  try {
    const raw = await readFile(localRankPath(), "utf8");
    return parseStore(raw);
  } catch {
    return emptyStore();
  }
}

async function saveLocal(store: RankStore): Promise<void> {
  const file = localRankPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(store), "utf8");
}

export async function loadRankStore(): Promise<RankStore> {
  if (r2Configured()) {
    const raw = await r2GetObjectText(STORE_KEY);
    return parseStore(raw);
  }
  return loadLocal();
}

async function saveRankStore(store: RankStore): Promise<void> {
  store.updated_at = new Date().toISOString();
  store.entries = store.entries
    .slice()
    .sort((a, b) => b.equity - a.equity || (a.created_at < b.created_at ? 1 : -1))
    .slice(0, MAX_ENTRIES);
  const payload = JSON.stringify(store);
  if (r2Configured()) {
    await r2PutObject(
      STORE_KEY,
      payload,
      "application/json; charset=utf-8",
      "private, max-age=0",
    );
    return;
  }
  await saveLocal(store);
}

function nickKey(name: string): string {
  return name.trim().toLowerCase();
}

function buildCeremony(input: {
  improved: boolean;
  rank: number;
  hallRank: number;
  wasInHall: boolean;
  wasTodayTop3: boolean;
  prevTodayLead: RankEntry | null;
  prevAllLead: RankEntry | null;
  entry: RankEntry;
  key: string;
}): Ceremony {
  const {
    improved,
    rank,
    hallRank,
    wasInHall,
    wasTodayTop3,
    prevTodayLead,
    prevAllLead,
    entry,
    key,
  } = input;
  if (!improved) {
    return { kind: "none", title: "", body: "", dealer: "" };
  }
  const other = (e: RankEntry | null) =>
    e && nickKey(e.nickname) !== key ? e : null;
  const beatenAll = other(prevAllLead);
  const beatenToday = other(prevTodayLead);

  if (hallRank === 1 && beatenAll) {
    return {
      kind: "alltime",
      title: "역대 최고",
      body: `${beatenAll.nickname}보다 ${fmtKrw(entry.equity - beatenAll.equity)} 앞선다.`,
      dealer: "전당 꼭대기. 오늘 차트 네 거야.",
    };
  }
  if (hallRank === 1) {
    return {
      kind: "alltime",
      title: "역대 최고",
      body: `전당 1위 · ${fmtKrw(entry.equity)}`,
      dealer: "전당 꼭대기. 오늘 차트 네 거야.",
    };
  }
  if (rank === 1 && beatenToday) {
    return {
      kind: "today1",
      title: "오늘 1위",
      body: `${beatenToday.nickname}보다 ${fmtKrw(entry.equity - beatenToday.equity)} 앞선다.`,
      dealer: "오늘 차트 네 거야. 이름 남겼다.",
    };
  }
  if (rank === 1) {
    return {
      kind: "today1",
      title: "오늘 1위",
      body: `오늘 차트 1위 · ${fmtKrw(entry.equity)}`,
      dealer: "오늘 차트 네 거야. 이름 남겼다.",
    };
  }
  if (!wasInHall && hallRank >= 1 && hallRank <= BOARD_ALL) {
    return {
      kind: "hall",
      title: "전당 진입",
      body: `명예의 전당 ${hallRank}위.`,
      dealer: "전당이다. 박수.",
    };
  }
  if (!wasTodayTop3 && rank >= 1 && rank <= TODAY_TOP) {
    return {
      kind: "top3",
      title: "오늘 톱3",
      body: `오늘 ${rank}위. 1위가 아직 위에 있어.`,
      dealer: "톱3. 아직 끝이 아니다.",
    };
  }
  return { kind: "none", title: "", body: "", dealer: "" };
}

export async function submitRank(input: {
  nickname: string;
  date: string;
  weights: number[];
}): Promise<{
  entry: RankPublic;
  boards: { today: RankPublic[]; all: RankPublic[] };
  rank: number;
  hallRank: number;
  improved: boolean;
  ceremony: Ceremony;
  rival: RankRival | null;
}> {
  const nickname = sanitizePlayName(input.nickname);
  if (nickname.length < 1) throw new Error("이름을 입력해 주세요.");
  const today = isoTodayKst();
  const date = input.date.trim();
  if (date !== today && date !== shiftIsoDate(today, -1)) {
    throw new Error("오늘은 오늘의 차트로만 기록됩니다.");
  }
  if (!Array.isArray(input.weights) || input.weights.length !== ROUNDS) {
    throw new Error("다섯 판의 비중을 모두 보내 주세요.");
  }
  const weights = input.weights.map((w) => clampWeight(Number(w)));

  const payload = await getChartTrade(date);
  if (!payload.ok || payload.rounds.length !== ROUNDS) {
    throw new Error(payload.error || "오늘 차트를 채점할 수 없습니다.");
  }
  const scored = scoreRun(payload.rounds, weights);

  const entry: RankEntry = {
    id: randomUUID(),
    nickname,
    date,
    equity: Math.round(scored.equity),
    pnl_pct: scored.pnl_pct,
    weights,
    created_at: new Date().toISOString(),
  };

  const store = await loadRankStore();
  const before = rankBoards(store, date);
  const key = nickKey(nickname);
  const prevTodayLead = before.today[0] || null;
  const prevAllLead = before.all[0] || null;
  const wasInHall = before.all.some((e) => nickKey(e.nickname) === key);
  const wasTodayTop3 = before.today
    .slice(0, TODAY_TOP)
    .some((e) => nickKey(e.nickname) === key);

  let improved = true;
  const existingIdx = store.entries.findIndex(
    (e) => e.date === date && nickKey(e.nickname) === key,
  );
  if (existingIdx >= 0) {
    const prev = store.entries[existingIdx]!;
    if (entry.equity > prev.equity) {
      store.entries[existingIdx] = { ...entry, nickname: prev.nickname };
    } else {
      improved = false;
    }
  } else {
    store.entries.push(entry);
  }

  if (improved) await saveRankStore(store);
  const boards = rankBoards(store, date);
  const rank =
    boards.today.findIndex((e) => nickKey(e.nickname) === key) + 1 ||
    boards.today.length + 1;
  const hallRank =
    boards.all.findIndex((e) => nickKey(e.nickname) === key) + 1 ||
    boards.all.length + 1;
  const stored =
    store.entries.find(
      (e) => e.date === date && nickKey(e.nickname) === key,
    ) || entry;
  const ceremony = buildCeremony({
    improved,
    rank,
    hallRank,
    wasInHall,
    wasTodayTop3,
    prevTodayLead,
    prevAllLead,
    entry: stored,
    key,
  });
  const lead = boards.today[0] || null;
  const rival =
    lead && nickKey(lead.nickname) !== key ? toRival(lead) : null;

  return {
    entry: toPublic(stored),
    boards: {
      today: boards.today.map(toPublic),
      all: boards.all.map(toPublic),
    },
    rank,
    hallRank,
    improved,
    ceremony,
    rival,
  };
}

function bestPerNick(entries: RankEntry[]): RankEntry[] {
  const best = new Map<string, RankEntry>();
  for (const entry of entries) {
    const key = nickKey(entry.nickname);
    const prev = best.get(key);
    if (!prev || entry.equity > prev.equity) best.set(key, entry);
  }
  return [...best.values()].sort((a, b) => b.equity - a.equity);
}

export function rankBoards(store: RankStore, date = isoTodayKst()): RankBoards {
  const today = bestPerNick(store.entries.filter((e) => e.date === date)).slice(
    0,
    BOARD_TODAY,
  );
  const all = bestPerNick(store.entries).slice(0, BOARD_ALL);
  return { today, all };
}

export function sanitizePlayName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/gi, "")
    .slice(0, 16);
}

export function toPublic(entry: RankEntry): RankPublic {
  return {
    id: entry.id,
    nickname: entry.nickname,
    date: entry.date,
    equity: entry.equity,
    pnl_pct: entry.pnl_pct,
    created_at: entry.created_at,
  };
}

export function toRival(entry: RankEntry): RankRival {
  return {
    nickname: entry.nickname,
    equity: entry.equity,
    pnl_pct: entry.pnl_pct,
    weights: entry.weights,
  };
}

export function publicEntry(entry: RankEntry): RankPublic {
  return toPublic(entry);
}
