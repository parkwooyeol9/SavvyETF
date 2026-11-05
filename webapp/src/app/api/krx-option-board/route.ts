import { timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE } from "@/lib/adminGuard";
import { cdnCacheHeader, invalidateServerCache, withServerCache } from "@/lib/apiCache";
import {
  KRX_OPTION_BOARD_JSON_KEY,
  KRX_OPTION_BOARD_XLSX_KEY,
  emptyKrxOptionBoard,
  loadKrxOptionBoard,
  type KrxOptionBoardPayload,
} from "@/lib/krxOptionBoard";
import { r2Configured, r2PutJsonDaily, r2PutObject } from "@/lib/r2";
import { siteAdminAuthorized } from "@/lib/siteAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_KEY = "krx-option-board:v1";

function ingestAuthorized(request: Request): boolean {
  if (siteAdminAuthorized(request)) return true;
  const secret = process.env.WEB_INGEST_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const payload = await withServerCache(CACHE_KEY, 300_000, 900_000, loadKrxOptionBoard);
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 503,
      headers: payload.ok ? { "Cache-Control": cdnCacheHeader("etfSlow") } : PRIVATE_NO_STORE,
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(emptyKrxOptionBoard(message), { status: 500, headers: PRIVATE_NO_STORE });
  }
}

/**
 * Bot/local batch → Vercel R2 (`04_국내시장/krx_option_board.py --publish`).
 * Body: KrxOptionBoardPayload JSON + xlsx_base64.
 */
export async function POST(request: Request) {
  if (!ingestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!r2Configured()) {
    return NextResponse.json({ error: "R2 is not configured" }, { status: 503 });
  }
  try {
    const body = (await request.json()) as KrxOptionBoardPayload & {
      xlsx_base64?: string;
      as_of_kst?: string;
    };
    if (!body || typeof body !== "object" || !body.summary || !body.chain || !body.vol) {
      return NextResponse.json({ error: "invalid option board payload" }, { status: 400 });
    }
    const { xlsx_base64: xlsxB64, as_of_kst: asOfIn, ...rest } = body;
    const payload: KrxOptionBoardPayload = { ...rest, ok: true };
    const day =
      (typeof asOfIn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOfIn) && asOfIn) ||
      payload.as_of ||
      new Date().toISOString().slice(0, 10);
    await r2PutJsonDaily(KRX_OPTION_BOARD_JSON_KEY, JSON.stringify(payload), day);
    let xlsx = false;
    if (typeof xlsxB64 === "string" && xlsxB64.length > 0) {
      const raw = Buffer.from(xlsxB64, "base64");
      if (raw.length > 0 && raw.length <= 8_000_000) {
        await r2PutObject(
          KRX_OPTION_BOARD_XLSX_KEY,
          raw,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "public, max-age=120",
        );
        xlsx = true;
      }
    }
    invalidateServerCache(CACHE_KEY);
    return NextResponse.json({ ok: true, key: KRX_OPTION_BOARD_JSON_KEY, xlsx, day, title: payload.title });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "ingest failed" },
      { status: 500 },
    );
  }
}
