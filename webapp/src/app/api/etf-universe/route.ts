import { jsonWithCdnCache } from "@/lib/apiCache";
import indexJson from "@/data/etfUniverse/index.json";
import { isEtfUniverseMarket, type EtfUniverseFile, type EtfUniverseMarket } from "@/lib/etfUniverse";

/**
 * ETF universe snapshots bundled from SavvyDB (03_ETF/etf_universe.py).
 * `?market=kr|us|eu|jp|hk|cn` → that market's columnar file; no market → the per-market index.
 * Served through the API (not public/) so the same-site gate and bot block in middleware apply.
 */
export const dynamic = "force-dynamic";

const LOADERS: Record<EtfUniverseMarket, () => Promise<{ default: unknown }>> = {
  kr: () => import("@/data/etfUniverse/kr.json"),
  us: () => import("@/data/etfUniverse/us.json"),
  eu: () => import("@/data/etfUniverse/eu.json"),
  jp: () => import("@/data/etfUniverse/jp.json"),
  hk: () => import("@/data/etfUniverse/hk.json"),
  cn: () => import("@/data/etfUniverse/cn.json"),
};

export async function GET(req: Request) {
  const market = new URL(req.url).searchParams.get("market");
  if (!market) return jsonWithCdnCache({ ok: true, ...indexJson }, "snapshot");
  if (!isEtfUniverseMarket(market)) {
    return jsonWithCdnCache({ ok: false, error: `unknown market: ${market}` }, "snapshot", 400);
  }
  const mod = await LOADERS[market]();
  return jsonWithCdnCache(mod.default as EtfUniverseFile, "snapshot");
}
