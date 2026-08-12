import { NextResponse } from "next/server";

import { buildChallengePayload } from "@/lib/challengeEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const force = url.searchParams.get("refresh") === "1";
  try {
    const payload = await buildChallengePayload({
      forceTick: force,
      refreshKimchi: force,
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        name: "천만원 챌린지",
        error: exc instanceof Error ? exc.message : "challenge load failed",
      },
      { status: 500 },
    );
  }
}
