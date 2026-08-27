import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { fetchBotJson } from "@/lib/bot";
import {
  attachKosdaqSparks,
  buildKosdaq100Payload,
  KOSDAQ100_SCHEDULE_NOTE,
  loadKosdaq100FromR2,
  type Kosdaq100Payload,
} from "@/lib/kosdaq100";

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

/** After 15:45 KST prefer fresher scheduled snapshot + briefing. */
function cacheTtls(): { freshMs: number; staleMs: number } {
  const { hour, minute } = kstHourMinute();
  const mins = hour * 60 + minute;
  if (mins >= 15 * 60 + 45 && mins < 18 * 60) {
    return { freshMs: 60_000, staleMs: 180_000 };
  }
  return { freshMs: 90_000, staleMs: 300_000 };
}

function emptyPayload(error: string): Kosdaq100Payload {
  return {
    ok: false,
    generated_at: new Date().toISOString(),
    as_of: null,
    universe_as_of: null,
    universe_count: 0,
    universe_source: "",
    schedule_note: KOSDAQ100_SCHEDULE_NOTE,
    weight_note: "",
    disclaimer: "투자 권유가 아닙니다.",
    briefing: [],
    briefing_generated_at: null,
    summary: {
      total_mcap: null,
      advancers: 0,
      decliners: 0,
      unchanged: 0,
      high_quality: 0,
      median_per: null,
      median_roe: null,
      top_weight: [],
    },
    rows: [],
    error,
  };
}

async function buildPayload(refresh: boolean): Promise<Kosdaq100Payload> {
  if (!refresh) {
    const fromR2 = await loadKosdaq100FromR2();
    if (fromR2?.ok && (fromR2.rows || []).some((r) => r.price != null)) {
      const todayKst = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Seoul",
      });
      const { hour, minute } = kstHourMinute();
      const afterClose = hour > 15 || (hour === 15 && minute >= 45);
      if (!afterClose || !fromR2.as_of || fromR2.as_of >= todayKst) {
        return fromR2;
      }
    }
  }

  if (refresh) {
    try {
      const bot = await fetchBotJson<Kosdaq100Payload>(
        "/api/web/kosdaq100?refresh=1",
        { timeoutMs: 55_000 },
      );
      if (bot?.ok) return { ...bot, source: bot.source || "bot" };
    } catch {
      /* fall through to live build */
    }
  }

  try {
    return await buildKosdaq100Payload({ refreshFundamentals: refresh });
  } catch (liveErr) {
    try {
      const bot = await fetchBotJson<Kosdaq100Payload>("/api/web/kosdaq100", {
        timeoutMs: 55_000,
      });
      return { ...bot, source: bot.source || "bot" };
    } catch (botErr) {
      const message =
        liveErr instanceof Error
          ? liveErr.message
          : botErr instanceof Error
            ? botErr.message
            : String(liveErr);
      throw new Error(message);
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
    ? `kosdaq100:refresh:${Date.now()}`
    : "kosdaq100:v3";

  try {
    const payload = await withServerCache(cacheKey, freshMs, staleMs, async () => {
      const raw = await buildPayload(refresh);
      return attachKosdaqSparks(raw);
    });
    return NextResponse.json(payload, {
      status: payload.ok ? 200 : 502,
      headers: { "Cache-Control": cdnCacheHeader("market") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(emptyPayload(message), { status: 502 });
  }
}
