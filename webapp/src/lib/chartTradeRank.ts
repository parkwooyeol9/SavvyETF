import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import {
  ROUNDS,
  clampWeight,
  getChartTrade,
  isoTodayKst,
  scoreRun,
  shiftIsoDate,
} from "@/lib/chartTrade";
import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

const STORE_KEY = "chart-trade/rankings.json";
const MAX_ENTRIES = 200;
const BOARD_TODAY = 15;
const BOARD_ALL = 10;

export type RankEntry = {
  id: string;
  nickname: string;
  date: string;
  equity: number;
  pnl_pct: number;
  weights: number[];
  created_at: string;
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

export function publicEntry(entry: RankEntry): RankEntry {
  return entry;
}

export async function submitRank(input: {
  nickname: string;
  date: string;
  weights: number[];
}): Promise<{ entry: RankEntry; boards: RankBoards; rank: number }> {
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
  const key = nickKey(nickname);
  const existingIdx = store.entries.findIndex(
    (e) => e.date === date && nickKey(e.nickname) === key,
  );
  if (existingIdx >= 0) {
    const prev = store.entries[existingIdx]!;
    if (entry.equity > prev.equity) {
      store.entries[existingIdx] = { ...entry, nickname: prev.nickname };
    } else {
      const boards = rankBoards(store, date);
      const rank =
        boards.today.findIndex((e) => nickKey(e.nickname) === key) + 1 ||
        boards.today.length + 1;
      return { entry: prev, boards, rank };
    }
  } else {
    store.entries.push(entry);
  }

  await saveRankStore(store);
  const boards = rankBoards(store, date);
  const rank =
    boards.today.findIndex((e) => nickKey(e.nickname) === key) + 1 ||
    boards.today.length + 1;
  return { entry: store.entries.find((e) => e.id === entry.id) || entry, boards, rank };
}
