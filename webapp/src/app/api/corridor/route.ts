import { NextResponse } from "next/server";

import {
  runCorridorAnalysis,
  type CorridorRequest,
  type CorridorScenarioConfig,
  type RebalanceTargetMode,
} from "@/lib/corridor";
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
    const raw = (await req.json()) as CorridorRequest & {
      scenarios?: unknown;
    };
    const body: CorridorRequest = {
      ...raw,
      scenarios: normalizeScenarios(raw.scenarios),
    };
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

function normalizeScenarios(raw: unknown): CorridorScenarioConfig[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CorridorScenarioConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const lower_pct = Number(o.lower_pct);
    const upper_pct = Number(o.upper_pct);
    const delay_days = Number(o.delay_days ?? 0);
    const rebalance_to = String(o.rebalance_to || "band") as RebalanceTargetMode;
    if (!Number.isFinite(lower_pct) || !Number.isFinite(upper_pct)) continue;
    out.push({
      id: typeof o.id === "string" ? o.id : undefined,
      label: typeof o.label === "string" ? o.label : undefined,
      lower_pct,
      upper_pct,
      delay_days: Number.isFinite(delay_days) ? delay_days : 0,
      rebalance_to:
        rebalance_to === "cushion" || rebalance_to === "target" ? rebalance_to : "band",
      cushion_pct:
        o.cushion_pct != null && Number.isFinite(Number(o.cushion_pct))
          ? Number(o.cushion_pct)
          : 5,
    });
  }
  return out.length ? out : undefined;
}
