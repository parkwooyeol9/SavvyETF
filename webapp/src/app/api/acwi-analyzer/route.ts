import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE, requireSiteAdmin } from "@/lib/adminGuard";
import {
  seriesBucket,
  type AcwiBacktest,
  type AcwiPublic,
  type AcwiSeries,
  type AcwiSummary,
  type BtRegionResult,
  type BtSignalResult,
} from "@/lib/acwiAnalyzer";
import { readSealedJson, sealedSourceConfigured } from "@/lib/sealedData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIX = "private/acwi/latest";
const PUBLIC_CACHE = { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };
const PUBLIC_SOURCE = "LSEG Datastream 기반 자체 계산";

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: PRIVATE_NO_STORE });
}

function publicSignal(s: BtSignalResult): BtSignalResult {
  const { q, ls, ic, to, stats_q, stats_ls, ic_stats, to_mean, spread_mono } = s;
  return { q, ls, ic, to, stats_q, stats_ls, ic_stats, to_mean, spread_mono };
}

function publicRegion(r: BtRegionResult): BtRegionResult {
  return {
    bench_ew: r.bench_ew,
    bench_cw: r.bench_cw,
    bench_ew_stats: r.bench_ew_stats,
    bench_cw_stats: r.bench_cw_stats,
    n: r.n,
    sig: Object.fromEntries(Object.entries(r.sig).map(([k, v]) => [k, publicSignal(v)])),
  };
}

/**
 * Whitelist only: aggregate quintile/long-short/IC series and universe counts.
 * MSCI 구성종목 수(재구성)·원자료 파일명·진단값은 빼고, 종목 단위 값은 애초에 backtest.bin 에 없다.
 */
function toPublic(B: AcwiBacktest, S: AcwiSummary | null): AcwiPublic {
  const { built_at, start, end, n_months, lag_months, nq, currency, rebalance, regions } = B.meta;
  return {
    backtest: {
      meta: { built_at, source: PUBLIC_SOURCE, start, end, n_months, lag_months, nq, currency, rebalance, regions },
      dates: B.dates,
      signals: B.signals.map(({ key, label, kind, desc, weights }) => ({ key, label, kind, desc, weights })),
      results: Object.fromEntries(
        Object.entries(B.results).map(([mode, regs]) => [
          mode,
          Object.fromEntries(Object.entries(regs).map(([reg, r]) => [reg, publicRegion(r)])),
        ]),
      ) as AcwiBacktest["results"],
      factor_corr: { keys: B.factor_corr.keys, labels: B.factor_corr.labels, m: B.factor_corr.m },
      coverage: B.coverage.map(({ date, n_pit, n_static, n_pit_large }) => ({
        date,
        n_pit,
        n_static,
        n_pit_large,
        members_upper: null,
        members_confirmed: null,
      })),
    },
    as_of: S?.meta.ri_last ?? end,
    next_reviews: (S?.meta.next_reviews ?? []).map(({ review, announce, effective }) => ({ review, announce, effective })),
  };
}

/**
 * Datastream/Refinitiv + MSCI-derived analytics.
 * `?part=public` → 비로그인 공개분 (집계 백테스트·리뷰 일정, CDN 캐시 허용).
 * 나머지는 관리자 전용·no-store: `?part=summary` → screener/breadth/events;
 * `?part=series&code=XXX` → one stock's charts; `?part=backtest` → 10년 팩터 백테스트 전체.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const part = params.get("part") ?? "summary";

  if (part !== "public") {
    const denied = requireSiteAdmin(request);
    if (denied) return denied;
  }
  if (!sealedSourceConfigured()) return fail(503, "R2 또는 SEALED_DATA_KEY 미설정");

  try {
    if (part === "public") {
      const [B, S] = await Promise.all([
        readSealedJson<AcwiBacktest>(`${PREFIX}/backtest.bin`),
        readSealedJson<AcwiSummary>(`${PREFIX}/summary.bin`).catch(() => null),
      ]);
      if (!B) return fail(503, "백테스트 결과가 아직 준비되지 않았습니다.");
      return NextResponse.json({ ok: true, data: toPublic(B, S) }, { headers: PUBLIC_CACHE });
    }
    if (part === "summary") {
      const data = await readSealedJson<AcwiSummary>(`${PREFIX}/summary.bin`);
      if (!data) return fail(503, "ACWI 데이터가 아직 업로드되지 않았습니다.");
      return NextResponse.json({ ok: true, data }, { headers: PRIVATE_NO_STORE });
    }
    if (part === "series") {
      const code = params.get("code")?.trim() ?? "";
      if (!code || code.length > 40) return fail(400, "code 가 필요합니다.");
      const bucket = String(seriesBucket(code)).padStart(2, "0");
      const all = await readSealedJson<Record<string, AcwiSeries>>(`${PREFIX}/series/${bucket}.bin`);
      if (!all) return fail(503, "ACWI 시계열이 아직 업로드되지 않았습니다.");
      return NextResponse.json({ ok: true, data: all[code] ?? {} }, { headers: PRIVATE_NO_STORE });
    }
    if (part === "backtest") {
      const data = await readSealedJson<AcwiBacktest>(`${PREFIX}/backtest.bin`);
      if (!data) return fail(503, "백테스트 결과가 아직 업로드되지 않았습니다. (python -m Claude_DB.factor.export_webapp --upload)");
      return NextResponse.json({ ok: true, data }, { headers: PRIVATE_NO_STORE });
    }
    return fail(400, "part 는 public · summary · series · backtest 입니다.");
  } catch (e) {
    return fail(500, part === "public" ? "읽기 실패" : e instanceof Error ? e.message : "읽기 실패");
  }
}
