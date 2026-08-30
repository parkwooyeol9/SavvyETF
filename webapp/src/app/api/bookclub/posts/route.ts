import { NextResponse } from "next/server";

import {
  createPost,
  loadBoard,
  publicPostList,
} from "@/lib/communityStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOARD = "bookclub" as const;

export async function GET() {
  const store = await loadBoard(BOARD);
  return NextResponse.json({
    ok: true,
    updated_at: store.updated_at,
    posts: publicPostList(store),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      nickname?: string;
      title?: string;
      body?: string;
    };
    const result = await createPost({
      nickname: body.nickname || "",
      title: body.title || "",
      body: body.body || "",
      category: "question",
      board: BOARD,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "create failed" },
      { status: 400 },
    );
  }
}
