import { jsonWithCdnCache, withServerCache } from "@/lib/apiCache";
import {
  buildEtfDbUsPayload,
  filterUsDbPayload,
  loadLatestUsPayload,
  persistUsSnapshot,
  toPublicUsDbList,
  type EtfDbUsPayload,
} from "@/lib/etfDbUs";
import { isUsDbWarmWindow, usDbSnapshotStale } from "@/lib/usEquitySession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(req: Request): Promise<EtfDbUsPayload> {
  const url = new URL(req.url);
  const equityOnly = url.searchParams.get("equity") === "1";
  const watchOnly = url.searchParams.get("watch") === "1";
  const snap = await loadLatestUsPayload();
  const age = snap?.generated_at
    ? Date.now() - Date.parse(snap.generated_at)
    : Number.POSITIVE_INFINITY;
  const reusable =
    !!snap?.ok &&
    Number.isFinite(age) &&
    !usDbSnapshotStale(age) &&
    !(isUsDbWarmWindow() && snap.equity_only && !equityOnly);

  if (reusable && snap) {
    return {
      ...filterUsDbPayload(snap, { equityOnly, watchOnly }),
      source: `${snap.source} · r2`,
    };
  }
  try {
    const payload = await buildEtfDbUsPayload({ equityOnly });
    void persistUsSnapshot(payload);
    return watchOnly
      ? filterUsDbPayload(payload, { equityOnly, watchOnly: true })
      : payload;
  } catch (exc) {
    if (snap?.ok) {
      return {
        ...filterUsDbPayload(snap, { equityOnly, watchOnly }),
        source: `${snap.source} · r2-stale`,
        note: `${snap.note} 실시간 갱신 실패로 스냅샷을 표시합니다.`,
        error: exc instanceof Error ? exc.message : String(exc),
      };
    }
    throw exc;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
    const full = url.searchParams.get("full") === "1";
    const cacheKey = `etf-db-us:${url.searchParams.get("equity") || "0"}:${url.searchParams.get("watch") || "0"}`;
    const payload = await withServerCache(cacheKey, 1_800_000, 2_700_000, () =>
      handle(req),
    );

    if (symbol) {
      const series =
        payload.ticker_series?.[symbol] ||
        payload.ticker_series?.[symbol.toUpperCase()] ||
        null;
      return jsonWithCdnCache(
        {
          ok: payload.ok,
          generated_at: payload.generated_at,
          symbol,
          series,
        },
        "yahooSlow",
        payload.ok ? 200 : 400,
      );
    }

    const body = full ? payload : toPublicUsDbList(payload);
    return jsonWithCdnCache(body, "yahooSlow", payload.ok ? 200 : 400);
  } catch (exc) {
    return jsonWithCdnCache(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : String(exc),
      },
      "yahooSlow",
      502,
    );
  }
}
