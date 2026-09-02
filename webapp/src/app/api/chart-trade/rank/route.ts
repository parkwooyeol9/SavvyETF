import { NextResponse } from "next/server";

import { isoTodayKst } from "@/lib/chartTrade";
import {
  loadRankStore,
  publicEntry,
  rankBoards,
  submitRank,
} from "@/lib/chartTradeRank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const store = await loadRankStore();
  const date = isoTodayKst();
  const boards = rankBoards(store, date);
  return NextResponse.json({
    ok: true,
    date,
    today: boards.today.map(publicEntry),
    all: boards.all.map(publicEntry),
    updated_at: store.updated_at,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      nickname?: string;
      date?: string;
      weights?: number[];
    };
    const result = await submitRank({
      nickname: body.nickname || "",
      date: body.date || "",
      weights: Array.isArray(body.weights) ? body.weights : [],
    });
    return NextResponse.json({
      ok: true,
      entry: publicEntry(result.entry),
      rank: result.rank,
      today: result.boards.today.map(publicEntry),
      all: result.boards.all.map(publicEntry),
    });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "기록 실패" },
      { status: 400 },
    );
  }
}
