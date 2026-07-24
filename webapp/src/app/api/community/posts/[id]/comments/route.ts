import { NextResponse } from "next/server";

import { communityBoardConfigured, createComment } from "@/lib/communityStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function POST(
  request: Request,
  context: { params: Params },
) {
  if (!communityBoardConfigured()) {
    return NextResponse.json({ ok: false, error: "R2 not configured" }, { status: 503 });
  }
  const { id } = await context.params;
  try {
    const body = (await request.json()) as {
      nickname?: string;
      body?: string;
    };
    const result = await createComment({
      postId: id,
      nickname: body.nickname || "",
      body: body.body || "",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "comment failed" },
      { status: 400 },
    );
  }
}
