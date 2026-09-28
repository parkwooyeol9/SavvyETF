import { NextResponse } from "next/server";

import {
  isMpPortfolioKind,
  loadSharedMpPortfolio,
  mpStoreConfigured,
  saveSharedMpPortfolio,
  validateMpPortfolio,
} from "@/lib/mpPortfolioStore";
import { siteAdminAuthorized } from "@/lib/siteAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function kindOf(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  return isMpPortfolioKind(kind) ? kind : null;
}

export async function GET(request: Request) {
  const kind = kindOf(request);
  if (!kind) return NextResponse.json({ ok: false, error: "kind=mp|etf" }, { status: 400 });
  try {
    const portfolio = await loadSharedMpPortfolio(kind);
    return NextResponse.json({ ok: true, portfolio, configured: mpStoreConfigured() }, { headers: NO_STORE });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, portfolio: null, error: exc instanceof Error ? exc.message : "load failed" },
      { status: 502, headers: NO_STORE },
    );
  }
}

export async function PUT(request: Request) {
  if (!siteAdminAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "관리자만 편입·리밸런싱을 수정할 수 있습니다." }, { status: 401 });
  }
  const kind = kindOf(request);
  if (!kind) return NextResponse.json({ ok: false, error: "kind=mp|etf" }, { status: 400 });
  if (!mpStoreConfigured()) {
    return NextResponse.json({ ok: false, error: "저장소(R2)가 설정되지 않았습니다." }, { status: 503 });
  }
  let body: { portfolio?: unknown } = {};
  try {
    body = (await request.json()) as { portfolio?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const checked = validateMpPortfolio(kind, body.portfolio);
  if (!checked.ok) return NextResponse.json({ ok: false, error: checked.error }, { status: 400 });
  try {
    await saveSharedMpPortfolio(kind, checked.value);
    return NextResponse.json({ ok: true });
  } catch (exc) {
    return NextResponse.json({ ok: false, error: exc instanceof Error ? exc.message : "save failed" }, { status: 502 });
  }
}
