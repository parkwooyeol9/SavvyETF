import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE, requireSiteAdmin } from "@/lib/adminGuard";
import { vaultDownloadUrl, vaultFileChunk } from "@/lib/adminVault";
import { r2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Without `part`: a short-lived presigned R2 URL (download bytes never pass
 * through the function). With `part=N`: that chunk's raw bytes, for the viewer.
 */
export async function GET(request: Request) {
  const denied = requireSiteAdmin(request);
  if (denied) return denied;
  if (!r2Configured()) {
    return NextResponse.json(
      { ok: false, error: "저장소(R2)가 설정되지 않았습니다." },
      { status: 503, headers: PRIVATE_NO_STORE },
    );
  }
  const params = new URL(request.url).searchParams;
  const postId = String(params.get("post") || "");
  const fileId = String(params.get("file") || "");
  try {
    if (params.has("part")) {
      const chunk = await vaultFileChunk(postId, fileId, Number(params.get("part")));
      return new NextResponse(Buffer.from(chunk.body), {
        headers: {
          ...PRIVATE_NO_STORE,
          "Content-Type": "application/octet-stream",
          "X-Vault-Size": String(chunk.size),
          "X-Vault-Parts": String(chunk.parts),
        },
      });
    }
    const url = await vaultDownloadUrl(postId, fileId);
    return NextResponse.json({ ok: true, url }, { headers: PRIVATE_NO_STORE });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "download failed" },
      { status: 404, headers: PRIVATE_NO_STORE },
    );
  }
}
