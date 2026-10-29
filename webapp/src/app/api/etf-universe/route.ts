import { jsonWithCdnCache } from "@/lib/apiCache";
import indexJson from "@/data/etfUniverse/index.json";
import { isEtfUniverseMarket } from "@/lib/etfUniverse";
import { loadEtfUniverse } from "@/lib/etfUniverseServer";

/**
 * ETF universe snapshots bundled from SavvyDB (03_ETF/etf_universe.py).
 * `?market=kr|us|eu|jp|hk|cn` → that market's columnar file; no market → the per-market index.
 * Return columns are overlaid from R2 `etf_universe_px/latest.json` when the 20:10 job has run.
 * Served through the API (not public/) so the same-site gate and bot block in middleware apply.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const market = new URL(req.url).searchParams.get("market");
  if (!market) return jsonWithCdnCache({ ok: true, ...indexJson }, "snapshot");
  if (!isEtfUniverseMarket(market)) {
    return jsonWithCdnCache({ ok: false, error: `unknown market: ${market}` }, "snapshot", 400);
  }
  return jsonWithCdnCache(await loadEtfUniverse(market), "dailyClose");
}
