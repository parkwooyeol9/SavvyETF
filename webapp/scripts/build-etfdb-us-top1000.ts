/**
 * One-shot builder: NASDAQ ETF directory → equity filter → Yahoo AUM → top 1000.
 * Run: npx tsx scripts/build-etfdb-us-top1000.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { classifyUsEtf, isLikelyEquityEtf } from "../src/lib/etfDbUsClassify";
import { uniqueUsUniverse } from "../src/lib/etfDbUsUniverseCurated";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type Meta = {
  symbol: string;
  name: string;
  type: string;
  region: string;
  sector: string;
  theme: string;
  watch?: boolean;
  aum_mn?: number;
};

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () =>
      worker(),
    ),
  );
  return out;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/plain" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function parseNasdaqListed(text: string): Array<{ symbol: string; name: string }> {
  const out: Array<{ symbol: string; name: string }> = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line || line.startsWith("File Creation")) continue;
    const p = line.split("|");
    // Symbol|Security Name|...|ETF|
    if ((p[6] || "").trim() !== "Y") continue;
    const symbol = (p[0] || "").trim().toUpperCase();
    const name = (p[1] || "").trim();
    if (!symbol || symbol.includes("$") || symbol.includes(".")) continue;
    out.push({ symbol, name });
  }
  return out;
}

function parseOtherListed(text: string): Array<{ symbol: string; name: string }> {
  const out: Array<{ symbol: string; name: string }> = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line || line.startsWith("File Creation")) continue;
    const p = line.split("|");
    // ACT Symbol|Security Name|Exchange|CQS|ETF|
    if ((p[4] || "").trim() !== "Y") continue;
    const symbol = (p[0] || "").trim().toUpperCase();
    const name = (p[1] || "").trim();
    if (!symbol || symbol.includes("$") || symbol.includes(".")) continue;
    out.push({ symbol, name });
  }
  return out;
}

type YahooJar = { cookie: string; crumb: string };

async function getYahooJar(): Promise<YahooJar> {
  const warm = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    redirect: "manual",
  });
  const headersAny = warm.headers as Headers & { getSetCookie?: () => string[] };
  const raw =
    typeof headersAny.getSetCookie === "function" ? headersAny.getSetCookie() : [];
  let cookie = raw.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) {
    const sc = warm.headers.get("set-cookie") || "";
    cookie = sc
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(";")[0].trim())
      .filter((c) => c.includes("="))
      .join("; ");
  }
  const crumbRes = await fetch(
    "https://query2.finance.yahoo.com/v1/test/getcrumb",
    { headers: { "User-Agent": UA, Cookie: cookie, Accept: "text/plain" } },
  );
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("bad crumb");
  return { cookie, crumb };
}

async function fetchAumMn(jar: YahooJar, symbol: string): Promise<number> {
  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=defaultKeyStatistics,summaryDetail,price&crumb=${encodeURIComponent(jar.crumb)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Cookie: jar.cookie,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as {
      quoteSummary?: {
        result?: Array<{
          defaultKeyStatistics?: Record<string, { raw?: number }>;
          summaryDetail?: Record<string, { raw?: number }>;
          price?: Record<string, { raw?: number }>;
        }>;
      };
    };
    const r = json.quoteSummary?.result?.[0];
    const assets =
      r?.defaultKeyStatistics?.totalAssets?.raw ??
      r?.summaryDetail?.totalAssets?.raw ??
      r?.price?.marketCap?.raw ??
      0;
    return assets > 0 ? assets / 1_000_000 : 0;
  } catch {
    return 0;
  }
}

async function main() {
  console.log("Downloading NASDAQ symbol directories…");
  const [nas, oth] = await Promise.all([
    fetchText("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"),
    fetchText("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"),
  ]);
  const listed = new Map<string, string>();
  for (const row of [...parseNasdaqListed(nas), ...parseOtherListed(oth)]) {
    if (!listed.has(row.symbol)) listed.set(row.symbol, row.name);
  }
  console.log("Listed ETFs:", listed.size);

  const curated = new Map(
    uniqueUsUniverse().map((r) => [r.symbol.toUpperCase(), r] as const),
  );

  const candidates: Meta[] = [];
  for (const [symbol, name] of listed) {
    if (!isLikelyEquityEtf(name, symbol)) continue;
    const c = curated.get(symbol);
    if (c) {
      // Skip pure commodity trusts even if curated (equity-only request)
      if (c.type === "원자재") continue;
      candidates.push({
        symbol,
        name: c.name || name,
        type: c.type,
        region: c.region,
        sector: c.sector,
        theme: c.theme,
        watch: c.watch,
      });
      continue;
    }
    const cls = classifyUsEtf(name, symbol);
    candidates.push({
      symbol,
      name,
      type: cls.type,
      region: cls.region,
      sector: cls.sector,
      theme: cls.theme,
      watch: cls.watch,
    });
  }
  console.log("Equity candidates:", candidates.length);

  let jar = await getYahooJar();
  console.log("Yahoo crumb ok — fetching AUM…");
  let done = 0;
  const withAum = await mapPool(candidates, 18, async (row) => {
    let aum = await fetchAumMn(jar, row.symbol);
    // refresh crumb occasionally on zeros streak is hard; retry once on zero for large names
    if (!(aum > 0) && done % 40 === 0) {
      try {
        jar = await getYahooJar();
      } catch {
        /* keep */
      }
      aum = await fetchAumMn(jar, row.symbol);
    }
    done += 1;
    if (done % 100 === 0) console.log(`  AUM progress ${done}/${candidates.length}`);
    return { ...row, aum_mn: aum };
  });

  withAum.sort((a, b) => (b.aum_mn || 0) - (a.aum_mn || 0));
  const positive = withAum.filter((r) => (r.aum_mn || 0) > 0);
  console.log("With AUM>0:", positive.length);

  const top = positive.slice(0, 1000);
  // Force-include curated watch equity names if missing
  const have = new Set(top.map((r) => r.symbol));
  for (const c of curated.values()) {
    if (c.type === "원자재") continue;
    if (!c.watch) continue;
    if (have.has(c.symbol)) continue;
    const found = withAum.find((r) => r.symbol === c.symbol);
    if (found) {
      top.push(found);
      have.add(c.symbol);
    } else {
      top.push({
        symbol: c.symbol,
        name: c.name,
        type: c.type,
        region: c.region,
        sector: c.sector,
        theme: c.theme,
        watch: true,
        aum_mn: 0,
      });
      have.add(c.symbol);
    }
  }
  top.sort((a, b) => (b.aum_mn || 0) - (a.aum_mn || 0));
  const finalList = top.slice(0, Math.max(1000, have.size));

  const outPath = resolve(
    process.cwd(),
    "src/lib/etfDbUsUniverseTop1000.json",
  );
  const payload = {
    generated_at: new Date().toISOString(),
    source:
      "NASDAQ Trader symbol directory · equity name filter · Yahoo totalAssets · AUM top 1000",
    count: finalList.length,
    rows: finalList.map(({ symbol, name, type, region, sector, theme, watch, aum_mn }) => ({
      symbol,
      name,
      type,
      region,
      sector,
      theme,
      aum_seed_mn: Math.round((aum_mn || 0) * 10) / 10,
      ...(watch ? { watch: true } : {}),
    })),
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log("Wrote", outPath, "count", payload.count);
  console.log(
    "Top10",
    finalList.slice(0, 10).map((r) => `${r.symbol}:${Math.round(r.aum_mn || 0)}`),
  );
  const sectors = new Map<string, number>();
  for (const r of finalList) sectors.set(r.sector, (sectors.get(r.sector) || 0) + 1);
  console.log(
    "Sectors",
    [...sectors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
