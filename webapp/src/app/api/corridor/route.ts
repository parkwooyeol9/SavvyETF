import { NextResponse } from "next/server";

import { runCorridorAnalysis, type CorridorRequest } from "@/lib/corridor";
import { cdnCacheHeader } from "@/lib/apiCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const body: CorridorRequest = {
    equity_symbol: url.searchParams.get("equity") || undefined,
    bond_symbol: url.searchParams.get("bond") || undefined,
    target_equity_pct: num(url.searchParams.get("target")),
    upper_pct: num(url.searchParams.get("upper")),
    lower_pct: num(url.searchParams.get("lower")),
    start_date: url.searchParams.get("start") || undefined,
    end_date: url.searchParams.get("end") || undefined,
  };
  try {
    const payload = await runCorridorAnalysis(body);
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 400,
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : String(exc) },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CorridorRequest;
    const payload = await runCorridorAnalysis(body);
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 400,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : String(exc) },
      { status: 502 },
    );
  }
}

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
