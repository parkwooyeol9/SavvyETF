/**
 * Server-only loader for AI Pick. Reads only what other jobs already produced:
 * bundled ETF universe / ACWI files, R2 `etf_universe_px`, `acwi_px`, `kospi200_panel`,
 * and the weekly ETF Flow snapshot. No crawling here.
 */

import factsFile from "@/data/acwiTechFacts.json";
import universeFile from "@/data/acwiYahooUniverse.json";
import kosdaq100File from "@/data/kosdaq100Universe.json";
import kospi200File from "@/data/kospi200Universe.json";
import { loadAcwiStored, storedPoints } from "@/lib/acwiPxStore";
import type { AcwiTechFacts, AcwiUniverseRow } from "@/lib/acwiTech";
import {
  AI_PICK_DISCLAIMER,
  AI_PICK_METHOD,
  buildEtfMarketPicks,
  buildStockPicks,
  ETF_PICK_MARKETS,
  flowIndex,
  STOCK_COUNTRIES,
  type AiPickPayload,
  type AiPickSource,
  type StockInput,
} from "@/lib/aiPick";
import { loadEtfFlowWeekly } from "@/lib/etfFlowWeekly";
import { loadEtfUniverse } from "@/lib/etfUniverseServer";
import { buildQuantSnapshot, lookupQuantSpec } from "@/lib/quantDesk";
import { r2Configured, r2GetObjectText } from "@/lib/r2";

const UNIVERSE = (universeFile.rows || []) as AcwiUniverseRow[];
const FACTS = factsFile.rows as Record<string, AcwiTechFacts>;
const FACTS_AS_OF = (factsFile.as_of as string | undefined) || null;
/** ACWI names are English; Korean screens read better with the KRX names. */
const KR_NAME = new Map<string, string>(
  [...kospi200File.constituents, ...kosdaq100File.constituents].map((c) => [c.code, c.name]),
);
/** Same 1-year window the ACWI tech board uses for its 1y range. */
const SNAPSHOT_BARS = 270;

type PanelRow = { code: string; nlp_score: number | null; nlp_n: number };
type Panel = { as_of: string | null; rows: PanelRow[] };

async function loadKospiPanel(): Promise<Panel | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText("kospi200_panel/latest.json");
    if (!text) return null;
    const parsed = JSON.parse(text) as { as_of?: string | null; rows?: PanelRow[] };
    return Array.isArray(parsed.rows) ? { as_of: parsed.as_of ?? null, rows: parsed.rows } : null;
  } catch {
    return null;
  }
}

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export async function buildAiPick(): Promise<AiPickPayload> {
  const [flow, stored, panel, ...files] = await Promise.all([
    settle(loadEtfFlowWeekly()),
    settle(loadAcwiStored()),
    settle(loadKospiPanel()),
    ...ETF_PICK_MARKETS.map((m) => settle(loadEtfUniverse(m))),
  ]);

  const flowOk = !!flow?.ok;
  const flowIdx = flowIndex(flowOk ? flow : null);
  const flowAsOf = flowOk ? flow!.us?.weeks?.[0]?.end || flow!.kr?.week?.end || null : null;

  const markets = ETF_PICK_MARKETS.flatMap((m, i) => {
    const file = files[i];
    return file ? [buildEtfMarketPicks(m, file, flowIdx)] : [];
  });

  const nlpByCode = new Map<string, { score: number; n: number }>();
  for (const r of panel?.rows || []) {
    if (typeof r.nlp_score === "number" && Number.isFinite(r.nlp_score) && r.nlp_n > 0) {
      nlpByCode.set(r.code, { score: r.nlp_score, n: r.nlp_n });
    }
  }
  const pxAsOf = stored?.as_of ?? null;
  const nlpAsOf = panel?.as_of ?? null;

  const countries = STOCK_COUNTRIES.map((country) => {
    const rows = UNIVERSE.filter((r) => r.country === country);
    const inputs: StockInput[] = rows.map((row) => {
      const prices = stored ? storedPoints(stored.series, row.yahoo) : null;
      const snap =
        prices && prices.length >= 60
          ? buildQuantSnapshot(
              { ...lookupQuantSpec(row.yahoo, row.name), group: "주식", from: "ACWI" },
              prices.slice(-SNAPSHOT_BARS),
              null,
              null,
            )
          : null;
      const code = country === "한국" ? row.yahoo.replace(/\.(KS|KQ)$/i, "") : "";
      const nlp = code ? nlpByCode.get(code) : undefined;
      const krName = code ? KR_NAME.get(code) : undefined;
      return {
        row: krName ? { ...row, name: krName } : row,
        facts: FACTS[row.ric] ?? null,
        snap,
        nlp: nlp ? { ...nlp, date: nlpAsOf } : null,
      };
    });
    return buildStockPicks(country, inputs, { facts: FACTS_AS_OF, px: pxAsOf, nlp: nlpAsOf });
  });

  const krFile = files[0];
  const sources: AiPickSource[] = [
    {
      label: "ETF 유니버스 스냅샷",
      as_of: krFile?.as_of?.slice(0, 10) ?? null,
      ok: markets.length > 0,
    },
    {
      label: "ETF 일간 수익률 (R2 etf_universe_px)",
      as_of: markets.find((m) => m.returns_as_of)?.returns_as_of ?? null,
      ok: markets.some((m) => m.returns_as_of),
      note: markets.some((m) => m.returns_as_of) ? undefined : "없음 — 스냅샷 수익률 사용",
    },
    {
      label: "ETF Flow 주간",
      as_of: flowAsOf,
      ok: flowOk,
      note: flowOk ? undefined : "없음 — 수급 가감 생략",
    },
    { label: "ACWI 추세·밸류 팩트", as_of: FACTS_AS_OF, ok: !!FACTS_AS_OF },
    {
      label: "ACWI 일봉 (R2 acwi_px)",
      as_of: pxAsOf,
      ok: !!stored,
      note: stored ? undefined : "없음 — 일봉 타이밍 생략",
    },
    {
      label: "KOSPI200 뉴스 NLP (R2 kospi200_panel)",
      as_of: nlpAsOf,
      ok: nlpByCode.size > 0,
      note: nlpByCode.size ? undefined : "없음 — 뉴스 가감 생략",
    },
  ];

  return {
    ok: markets.length > 0 || countries.some((c) => c.buys.length || c.sells.length),
    generated_at: new Date().toISOString(),
    etf: { markets, flow_as_of: flowAsOf },
    stocks: { facts_as_of: FACTS_AS_OF, px_as_of: pxAsOf, nlp_as_of: nlpAsOf, countries },
    sources,
    methodology: AI_PICK_METHOD,
    disclaimer: AI_PICK_DISCLAIMER,
  };
}
