import { uniqueUsUniverse, US_ETF_UNIVERSE_META } from "../src/lib/etfDbUsUniverse";
import { buildEtfDbUsPayload, US_ETF_UNIVERSE } from "../src/lib/etfDbUs";

async function main() {
  console.log("meta", US_ETF_UNIVERSE_META);
  console.log("universe", uniqueUsUniverse().length, US_ETF_UNIVERSE.length);
  const t0 = Date.now();
  const w = await buildEtfDbUsPayload({ watchOnly: true, equityOnly: true });
  console.log("watch", {
    ms: Date.now() - t0,
    count: w.count,
    ok: w.ok,
    top: w.rows.slice(0, 5).map((r) => `${r.symbol}:${Math.round(r.aum_mn)}`),
  });
  const t1 = Date.now();
  const full = await buildEtfDbUsPayload({ equityOnly: true });
  console.log("full", {
    ms: Date.now() - t1,
    count: full.count,
    ok: full.ok,
    quoted: full.source,
    sectors: full.aggregates.sector.slice(0, 8).map((a) => `${a.label}:${a.count}`),
    top: full.rows.slice(0, 8).map((r) => `${r.symbol}:${Math.round(r.aum_mn)}`),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
