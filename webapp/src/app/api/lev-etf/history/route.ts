import { NextResponse } from "next/server";

import {
  levEtfStoreConfigured,
  listTraderDates,
  loadTraderDay,
} from "@/lib/levEtfStore";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/lev-etf/history           → { ok, dates: string[] }
 * GET /api/lev-etf/history?date=YYYY-MM-DD → trader day archive
 */
export async function GET(request: Request) {
  try {
    if (!levEtfStoreConfigured()) {
      return NextResponse.json(
        { ok: false, error: "R2 is not configured" },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date")?.trim() || "";

    if (!date) {
      const dates = await listTraderDates();
      return NextResponse.json({
        ok: true,
        dates,
        count: dates.length,
        note: "거래원 일간(window=1) 스냅샷 목록. KRX 거래일 16:00에 적재.",
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { ok: false, error: "date must be YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const day = await loadTraderDay(date);
    if (!day) {
      return NextResponse.json(
        { ok: false, error: `No trader snapshot for ${date}` },
        { status: 404 },
      );
    }
    return NextResponse.json(day);
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "history load failed",
      },
      { status: 500 },
    );
  }
}
