import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { r2Configured, r2GetObjectText } from "@/lib/r2";
import {
  REBALANCE_R2_KEY,
  type RebalancePayload,
  type RebalanceResponse,
} from "@/lib/rebalance";
import bundled from "@/lib/rebalanceSnapshot.json";

export const dynamic = "force-dynamic";

async function loadFromR2(): Promise<RebalancePayload | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(REBALANCE_R2_KEY);
    return text ? (JSON.parse(text) as RebalancePayload) : null;
  } catch {
    return null;
  }
}

function newer(a: RebalancePayload, b: RebalancePayload): boolean {
  return Date.parse(a.generated_at) > Date.parse(b.generated_at);
}

async function buildPayload(): Promise<RebalanceResponse> {
  const local = bundled as unknown as RebalancePayload;
  const remote = await loadFromR2();
  if (remote && newer(remote, local)) return { ok: true, source: "r2", ...remote };
  return { ok: true, source: "bundled", ...local };
}

export async function GET() {
  try {
    const payload = await withServerCache("rebalance:v1", 300_000, 900_000, buildPayload);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("etfSlow") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json({ ok: false, error: message } satisfies RebalanceResponse, {
      status: 502,
    });
  }
}
