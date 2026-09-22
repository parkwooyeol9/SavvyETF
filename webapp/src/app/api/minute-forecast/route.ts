import { NextResponse } from "next/server";

import {
  UPDATE_COOLDOWN_MS,
  computeMinuteForecast,
  emptyMinuteForecastPayload,
  loadMinuteForecastFromR2,
  saveMinuteForecastToR2,
  type MinuteForecastPayload,
} from "@/lib/minuteForecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

let memCache: MinuteForecastPayload | null = null;
let inflight: Promise<MinuteForecastPayload> | null = null;
let lastComputeAt = 0;

async function runCompute(): Promise<MinuteForecastPayload> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const payload = await computeMinuteForecast();
      memCache = payload;
      lastComputeAt = Date.now();
      try {
        await saveMinuteForecastToR2(payload);
      } catch {
        // R2 optional
      }
      return payload;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function withCooldownMeta(payload: MinuteForecastPayload): MinuteForecastPayload {
  const elapsed = Date.now() - lastComputeAt;
  const remaining = Math.max(
    0,
    Math.ceil((UPDATE_COOLDOWN_MS - elapsed) / 1000),
  );
  return {
    ...payload,
    cooldown_remaining_sec: remaining,
    next_update_after:
      remaining > 0
        ? new Date(lastComputeAt + UPDATE_COOLDOWN_MS).toISOString()
        : null,
  };
}

export async function GET() {
  if (memCache?.ok) {
    return NextResponse.json(withCooldownMeta({ ...memCache, cached: true }));
  }
  const fromR2 = await loadMinuteForecastFromR2();
  if (fromR2?.ok) {
    memCache = fromR2;
    if (!lastComputeAt && fromR2.generated_at) {
      const t = Date.parse(fromR2.generated_at);
      if (Number.isFinite(t)) lastComputeAt = t;
    }
    return NextResponse.json(withCooldownMeta(fromR2));
  }
  return NextResponse.json(
    emptyMinuteForecastPayload(
      "저장된 결과가 없습니다. 업데이트를 눌러 계산하세요.",
    ),
  );
}

export async function POST() {
  const elapsed = Date.now() - lastComputeAt;
  if (lastComputeAt > 0 && elapsed < UPDATE_COOLDOWN_MS) {
    const remaining = Math.ceil((UPDATE_COOLDOWN_MS - elapsed) / 1000);
    const cached =
      memCache ||
      (await loadMinuteForecastFromR2()) ||
      emptyMinuteForecastPayload(
        `업데이트가 너무 잦습니다. ${remaining}초 후 다시 시도하세요.`,
      );
    return NextResponse.json(
      withCooldownMeta({
        ...cached,
        cached: true,
        error: `업데이트가 너무 잦습니다. ${remaining}초 후 다시 시도하세요.`,
      }),
      { status: 429 },
    );
  }

  try {
    const payload = await runCompute();
    return NextResponse.json(withCooldownMeta(payload));
  } catch (exc) {
    return NextResponse.json(
      emptyMinuteForecastPayload(
        exc instanceof Error ? exc.message : "계산 실패",
      ),
      { status: 500 },
    );
  }
}
