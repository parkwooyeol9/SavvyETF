import { NextResponse } from "next/server";

import { isoTodayKst } from "@/lib/chartTrade";
import {
  loadRankStore,
  rankBoards,
  submitRank,
  toPublic,
} from "@/lib/chartTradeRank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const store = await loadRankStore();
  const date = isoTodayKst();
  const boards = rankBoards(store, date);
  const today = boards.today.map(toPublic);
  return NextResponse.json({
    ok: true,
    date,
    leader: today[0] || null,
    today,
    all: boards.all.map(toPublic),
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
      entry: result.entry,
      rank: result.rank,
      hallRank: result.hallRank,
      improved: result.improved,
      ceremony: result.ceremony,
      rival: result.rival,
      today: result.boards.today,
      all: result.boards.all,
    });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "기록 실패" },
      { status: 400 },
    );
  }
}
