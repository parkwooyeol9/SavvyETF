import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE, requireSiteAdmin } from "@/lib/adminGuard";
import { vaultDownloadUrl } from "@/lib/adminVault";
import { r2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns a short-lived presigned R2 URL; bytes never pass through the function. */
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
  try {
    const url = await vaultDownloadUrl(
      String(params.get("post") || ""),
      String(params.get("file") || ""),
    );
    return NextResponse.json({ ok: true, url }, { headers: PRIVATE_NO_STORE });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "download failed" },
      { status: 404, headers: PRIVATE_NO_STORE },
    );
  }
}
