import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { r2Configured, r2GetObjectText } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LATEST_KEY = "kospi200_panel/latest.json";
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type Kospi200PanelRow = {
  code: string;
  name: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  nlp_score: number | null;
  nlp_n: number;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  roe: number | null;
  op_margin: number | null;
  net_margin: number | null;
  debt_ratio: number | null;
  dividend_yield: number | null;
  fiscal_label: string | null;
};

export type Kospi200PanelPayload = {
  ok: boolean;
  universe?: string;
  as_of: string | null;
  generated_at?: string;
  membership?: string[];
  n: number;
  coverage?: { bars: number; nlp: number; fund: number };
  note?: string;
  rows: Kospi200PanelRow[];
  error?: string;
};

function emptyPayload(error: string): Kospi200PanelPayload {
  return { ok: false, as_of: null, n: 0, rows: [], error };
}

async function loadPanel(date: string | null): Promise<Kospi200PanelPayload> {
  if (!r2Configured()) return emptyPayload("R2 is not configured");
  const key = date ? `kospi200_panel/snapshots/${date}.json` : LATEST_KEY;
  const text = await r2GetObjectText(key);
  if (!text) return emptyPayload(date ? `no snapshot for ${date}` : "no latest panel");
  const parsed = JSON.parse(text) as Kospi200PanelPayload;
  if (!parsed || !Array.isArray(parsed.rows)) {
    return emptyPayload("invalid panel json");
  }
  return { ...parsed, ok: true };
}

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") || "";
  if (date && !YMD.test(date)) {
    return NextResponse.json(emptyPayload("invalid date"), { status: 400 });
  }
  try {
    const payload = await withServerCache(
      `kospi200-panel:v1:${date || "latest"}`,
      120_000,
      600_000,
      () => loadPanel(date || null),
    );
    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("yahooSlow") },
    });
  } catch (exc) {
    return NextResponse.json(
      emptyPayload(exc instanceof Error ? exc.message : "panel failed"),
      { status: 500 },
    );
  }
}
