import { NextResponse } from "next/server";

import whitepaperJson from "@/data/rebalanceWhitepaper.json";
import type { RebalanceWhitepaper } from "@/lib/rebalance";

/**
 * 리밸런싱 백서(research/rebalance_whitepaper → export_webapp.py) 정적 데이터.
 * 본 `/api/rebalance` 와 분리해 탭 첫 로딩을 가볍게 하고, 바뀔 때는 재배포로만 갱신한다.
 */
export const dynamic = "force-static";

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

const payload = slim(whitepaperJson as unknown as RebalanceWhitepaper);

export function GET() {
  return NextResponse.json(
    { ok: true, whitepaper: payload },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
