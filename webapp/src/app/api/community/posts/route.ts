import { NextResponse } from "next/server";

import {
  communityBoardConfigured,
  createPost,
  loadBoard,
  publicPostList,
} from "@/lib/communityStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!communityBoardConfigured()) {
    return NextResponse.json(
      { ok: false, error: "R2 not configured", posts: [] },
      { status: 503 },
    );
  }
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const store = await loadBoard();
  return NextResponse.json({
    ok: true,
    updated_at: store.updated_at,
    posts: publicPostList(store, category),
  });
}

export async function POST(request: Request) {
  if (!communityBoardConfigured()) {
    return NextResponse.json(
      { ok: false, error: "R2 not configured" },
      { status: 503 },
    );
  }
  try {
    const body = (await request.json()) as {
      nickname?: string;
      title?: string;
      body?: string;
      category?: string;
    };
    const result = await createPost({
      nickname: body.nickname || "",
      title: body.title || "",
      body: body.body || "",
      category: body.category || "question",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "create failed" },
      { status: 400 },
    );
  }
}
