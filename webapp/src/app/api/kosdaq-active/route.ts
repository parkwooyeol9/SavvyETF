import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { fetchBotJson } from "@/lib/bot";
import {
  collectKosdaqActiveLive,
  loadCompareFromR2,
  type KosdaqActivePayload,
} from "@/lib/kosdaqActive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function kstHourMinute(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return { hour, minute };
}

/** After 15:50 KST prefer fresher cache so post-close PDFs surface quickly. */
function cacheTtls(): { freshMs: number; staleMs: number } {
  const { hour, minute } = kstHourMinute();
  const mins = hour * 60 + minute;
  if (mins >= 15 * 60 + 50 && mins < 18 * 60) {
    return { freshMs: 60_000, staleMs: 180_000 };
  }
  return { freshMs: 180_000, staleMs: 600_000 };
}

async function buildPayload(refresh: boolean): Promise<KosdaqActivePayload> {
  if (!refresh) {
    const fromR2 = await loadCompareFromR2();
    if (fromR2?.ok && (fromR2.funds || []).some((f) => f.holdings?.length)) {
      // If R2 as_of is older than today (KST) after 15:50, refresh live.
      const todayKst = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Seoul",
      });
      const { hour, minute } = kstHourMinute();
      const afterClose = hour > 15 || (hour === 15 && minute >= 50);
      if (!afterClose || !fromR2.as_of || fromR2.as_of >= todayKst) {
        return fromR2;
      }
    }
  }

  try {
    return await collectKosdaqActiveLive();
  } catch (liveErr) {
    try {
      const bot = await fetchBotJson<KosdaqActivePayload>(
        refresh ? "/api/web/kosdaq-active?refresh=1" : "/api/web/kosdaq-active",
        { timeoutMs: 55_000 },
      );
      return { ...bot, source: bot.source || "bot" };
    } catch (botErr) {
      const message =
        liveErr instanceof Error
          ? liveErr.message
          : botErr instanceof Error
            ? botErr.message
            : String(liveErr);
      return {
        ok: false,
        generated_at: new Date().toISOString(),
        as_of: null,
        schedule_note: "매일 15:50 KST 장마감 후 스냅샷",
        disclaimer: "투자 권유가 아닙니다.",
        source_note: "",
        universe_count: 0,
        funds: [],
        matrix: [],
        consensus: [],
        manager_overweights: [],
        insights: [],
        error: message,
      };
    }
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh =
    url.searchParams.get("refresh") === "1" ||
    url.searchParams.get("refresh") === "true";
  const { freshMs, staleMs } = cacheTtls();
  const cacheKey = refresh
    ? `kosdaq-active:refresh:${Date.now()}`
    : "kosdaq-active:v1";

  try {
    const payload = await withServerCache(cacheKey, freshMs, staleMs, () =>
      buildPayload(refresh),
    );
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 502,
      headers: { "Cache-Control": cdnCacheHeader("etfSlow") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(
      {
        ok: false,
        generated_at: new Date().toISOString(),
        as_of: null,
        schedule_note: "매일 15:50 KST 장마감 후 스냅샷",
        disclaimer: "투자 권유가 아닙니다.",
        source_note: "",
        universe_count: 0,
        funds: [],
        matrix: [],
        consensus: [],
        manager_overweights: [],
        insights: [],
        error: message,
      } satisfies KosdaqActivePayload,
      { status: 502 },
    );
  }
}
