import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import whitepaperJson from "@/data/rebalanceWhitepaper.json";
import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { r2Configured, r2GetObjectText } from "@/lib/r2";
import type { RebalanceWhitepaper, WhitepaperLiveDoc } from "@/lib/rebalance";
import { WP_LIVE_R2_KEY, mergeLive } from "@/lib/rebalanceWhitepaperLive";

/**
 * 리밸런싱 백서. 과거 실측·해외·방법론은 번들(research/rebalance_whitepaper → export_webapp.py) 고정,
 * 국내 그룹 예상은 봇이 거래일 18:10 이후 올리는 R2 `rebalance/whitepaper_live.json` 으로 덮는다.
 * R2 를 못 읽으면 번들 그대로(10/16 기준) — 화면은 `live.source` 로 고정 스냅샷 경고를 띄운다.
 */
export const dynamic = "force-dynamic";

/** 과거 이벤트 종목 행은 |매매| 상위만 (S&P500 이벤트당 500행 → 화면·엑셀은 상위만 씀). */
const ROWS_PER_EVENT = 30;

function slim(src: RebalanceWhitepaper): RebalanceWhitepaper {
  return {
    ...src,
    groups: src.groups.map((g) => ({
      ...g,
      events: g.events.map((e) => ({
        ...e,
        rows: [...e.rows].sort((a, b) => Math.abs(b[5]) - Math.abs(a[5])).slice(0, ROWS_PER_EVENT),
      })),
    })),
  };
}

const bundled = whitepaperJson as unknown as RebalanceWhitepaper;

async function loadLive(): Promise<{ doc: WhitepaperLiveDoc | null; reason: string }> {
  try {
    if (r2Configured()) {
      const text = await r2GetObjectText(WP_LIVE_R2_KEY);
      return text ? { doc: JSON.parse(text) as WhitepaperLiveDoc, reason: "" } : { doc: null, reason: "R2 미발행" };
    }
    if (process.env.NODE_ENV === "development") {
      // 로컬: python -m Claude_Work.rebalance.wp_forecast 결과
      const file = path.join(process.cwd(), "..", "Claude_Work", "data", "whitepaper_live.json");
      return { doc: JSON.parse(await readFile(file, "utf-8")) as WhitepaperLiveDoc, reason: "" };
    }
    return { doc: null, reason: "R2 미설정" };
  } catch (exc) {
    return { doc: null, reason: exc instanceof Error ? exc.message : String(exc) };
  }
}

async function buildPayload(): Promise<RebalanceWhitepaper> {
  const { doc, reason } = await loadLive();
  if (doc?.events?.length && doc.as_of >= bundled.as_of) return slim(mergeLive(bundled, doc));
  return slim({ ...bundled, live: { source: "bundled", reason: reason || "R2 기준일이 번들보다 오래됨" } });
}

export async function GET() {
  const whitepaper = await withServerCache("rebalance:whitepaper:v2", 300_000, 900_000, buildPayload);
  return NextResponse.json({ ok: true, whitepaper }, { headers: { "Cache-Control": cdnCacheHeader("etfSlow") } });
}
