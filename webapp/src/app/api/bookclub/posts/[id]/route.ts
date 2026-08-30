import { NextResponse } from "next/server";

import {
  deletePost,
  loadBoard,
  publicPost,
} from "@/lib/communityStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOARD = "bookclub" as const;

type Params = Promise<{ id: string }>;

export async function GET(
  _request: Request,
  context: { params: Params },
) {
  const { id } = await context.params;
  const store = await loadBoard(BOARD);
  const post = store.posts.find((p) => p.id === id);
  if (!post) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, post: publicPost(post) });
}

export async function DELETE(
  request: Request,
  context: { params: Params },
) {
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      delete_key?: string;
      admin_secret?: string;
    };
    await deletePost(id, body.delete_key || "", body.admin_secret, BOARD);
    return NextResponse.json({ ok: true });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "delete failed" },
      { status: 400 },
    );
  }
}
