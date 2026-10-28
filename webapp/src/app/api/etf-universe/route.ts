import { jsonWithCdnCache, withServerCache } from "@/lib/apiCache";
import indexJson from "@/data/etfUniverse/index.json";
import { r2Configured, r2GetObjectText } from "@/lib/r2";
import {
  isEtfUniverseMarket,
  type EtfUniverseFile,
  type EtfUniverseMarket,
  type EtfUniverseRow,
} from "@/lib/etfUniverse";

/**
 * ETF universe snapshots bundled from SavvyDB (03_ETF/etf_universe.py).
 * `?market=kr|us|eu|jp|hk|cn` → that market's columnar file; no market → the per-market index.
 * Return columns are overlaid from R2 `etf_universe_px/latest.json` when the 20:10 job has run.
 * Served through the API (not public/) so the same-site gate and bot block in middleware apply.
 */
export const dynamic = "force-dynamic";

const RETURN_KEYS = ["r1w", "r1m", "r3m", "r1y"] as const;
const PX_KEY = "etf_universe_px/latest.json";

const LOADERS: Record<EtfUniverseMarket, () => Promise<{ default: unknown }>> = {
  kr: () => import("@/data/etfUniverse/kr.json"),
  us: () => import("@/data/etfUniverse/us.json"),
  eu: () => import("@/data/etfUniverse/eu.json"),
  jp: () => import("@/data/etfUniverse/jp.json"),
  hk: () => import("@/data/etfUniverse/hk.json"),
  cn: () => import("@/data/etfUniverse/cn.json"),
};

type PxMarket = {
  as_of?: string | null;
  source?: string | null;
  rows?: unknown[][];
};

type PxFile = {
  markets?: Partial<Record<EtfUniverseMarket, PxMarket>>;
};

async function loadReturnOverlay(): Promise<PxFile | null> {
  return withServerCache("etf-universe-px", 10 * 60_000, 60 * 60_000, async () => {
    if (!r2Configured()) return null;
    try {
      const text = await r2GetObjectText(PX_KEY);
      if (!text) return null;
      const data = JSON.parse(text) as PxFile;
      return data && typeof data === "object" ? data : null;
    } catch {
      return null;
    }
  });
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Copy rows, then replace only the return cells the daily job actually has. */
function applyReturns(file: EtfUniverseFile, px: PxMarket | null | undefined): EtfUniverseFile {
  if (!px?.rows?.length) return file;
  const byTicker = new Map<string, unknown[]>();
  for (const row of px.rows) {
    if (Array.isArray(row) && row[0] != null) byTicker.set(String(row[0]), row);
  }
  if (!byTicker.size) return file;
  const extra = RETURN_KEYS.filter((key) => !file.cols.includes(key));
  const cols = (extra.length ? [...file.cols, ...extra] : file.cols) as Array<keyof EtfUniverseRow>;
  const index = Object.fromEntries(cols.map((col, i) => [col, i]));
  const rows = file.rows.map((src) => {
    const next = cols.map((_, i) => (i < src.length ? src[i] : null));
    const hit = byTicker.get(String(next[index.t] ?? ""));
    if (!hit) return next;
    RETURN_KEYS.forEach((key, j) => {
      const value = finite(hit[j + 1]);
      if (value != null) next[index[key]] = value;
    });
    return next;
  });
  return {
    ...file,
    cols,
    rows,
    returns_as_of: px.as_of ?? null,
    returns_source: px.source ?? null,
  };
}

export async function GET(req: Request) {
  const market = new URL(req.url).searchParams.get("market");
  if (!market) return jsonWithCdnCache({ ok: true, ...indexJson }, "snapshot");
  if (!isEtfUniverseMarket(market)) {
    return jsonWithCdnCache({ ok: false, error: `unknown market: ${market}` }, "snapshot", 400);
  }
  const mod = await LOADERS[market]();
  const file = mod.default as EtfUniverseFile;
  const overlay = await loadReturnOverlay();
  const body = applyReturns(file, overlay?.markets?.[market]);
  return jsonWithCdnCache(body, "dailyClose");
}
