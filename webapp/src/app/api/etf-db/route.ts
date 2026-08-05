import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import { botBaseUrl } from "@/lib/bot";
import {
  pickRicherHistory,
  reconstructAumHistories,
} from "@/lib/etfAumHistory";
import {
  aggregateRows,
  buildPayloadFromNaver,
  enrichIndexClassification,
  type EtfDbPayload,
} from "@/lib/etfDb";
import { r2Configured, r2GetObjectText } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const ETF_DB_LATEST_KEY = "etf_db/latest.json";

type NaverListResponse = {
  resultCode?: string;
  result?: { etfItemList?: unknown[] };
};

type Overlay = {
  flowByCode: Record<string, number>;
  benchmarkByCode: Record<string, string>;
  prevAsOf: string | null;
  flowHistory: EtfDbPayload["flow_history"] | undefined;
  aumHistory: EtfDbPayload["aum_history"] | undefined;
  source: "r2" | "bot" | "none";
};

const EMPTY_OVERLAY: Overlay = {
  flowByCode: {},
  benchmarkByCode: {},
  prevAsOf: null,
  flowHistory: undefined,
  aumHistory: undefined,
  source: "none",
};

function overlayFromPayload(data: {
  prev_as_of?: string | null;
  rows?: Array<{
    code?: string;
    flow_eok?: number | null;
    benchmark?: string | null;
  }>;
  flow_history?: EtfDbPayload["flow_history"];
  aum_history?: EtfDbPayload["aum_history"];
}): Omit<Overlay, "source"> {
  const flowByCode: Record<string, number> = {};
  const benchmarkByCode: Record<string, string> = {};
  for (const row of data.rows || []) {
    if (row.code && row.flow_eok != null && Number.isFinite(row.flow_eok)) {
      flowByCode[row.code] = Number(row.flow_eok);
    }
    if (row.code && row.benchmark) {
      benchmarkByCode[row.code] = String(row.benchmark);
    }
  }
  return {
    flowByCode,
    benchmarkByCode,
    prevAsOf: data.prev_as_of ?? null,
    flowHistory: data.flow_history,
    aumHistory: data.aum_history,
  };
}

function historyDepth(
  hist: EtfDbPayload["aum_history"] | EtfDbPayload["flow_history"] | undefined,
): number {
  if (!hist) return 0;
  const dates =
    hist.type?.dates ||
    hist.country?.dates ||
    hist.sector?.dates ||
    hist.index?.dates;
  return Array.isArray(dates) ? dates.length : 0;
}

async function fetchR2Overlay(): Promise<Overlay> {
  if (!r2Configured()) return { ...EMPTY_OVERLAY };
  try {
    const text = await r2GetObjectText(ETF_DB_LATEST_KEY);
    if (!text) return { ...EMPTY_OVERLAY };
    const data = JSON.parse(text) as Parameters<typeof overlayFromPayload>[0];
    return { ...overlayFromPayload(data), source: "r2" };
  } catch {
    return { ...EMPTY_OVERLAY };
  }
}

async function fetchNaverUniverse(): Promise<unknown[]> {
  const res = await fetch(
    "https://finance.naver.com/api/sise/etfItemList.nhn",
    {
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,*/*",
        Referer: "https://finance.naver.com/sise/etf.naver",
      },
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`Naver ETF list HTTP ${res.status}`);
  // Naver serves this endpoint as EUC-KR (charset=EUC-KR). Decoding as UTF-8
  // mojibakes Korean ETF names.
  const buf = Buffer.from(await res.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("euc-kr").decode(buf);
  } catch {
    text = buf.toString("utf8");
  }
  const data = JSON.parse(text) as NaverListResponse;
  const items = data?.result?.etfItemList;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Naver ETF list empty");
  }
  return items;
}

async function fetchBotOverlay(): Promise<Overlay> {
  try {
    const res = await fetch(`${botBaseUrl()}/etfdb.json`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { ...EMPTY_OVERLAY };
    const data = (await res.json()) as Parameters<typeof overlayFromPayload>[0];
    return { ...overlayFromPayload(data), source: "bot" };
  } catch {
    return { ...EMPTY_OVERLAY };
  }
}

/** Prefer R2 (durable); fall back to live bot HTTP if R2 missing/thinner. */
async function fetchOverlay(): Promise<Overlay> {
  const [r2, bot] = await Promise.all([fetchR2Overlay(), fetchBotOverlay()]);
  const r2Score =
    Object.keys(r2.flowByCode).length +
    historyDepth(r2.aumHistory) * 10 +
    historyDepth(r2.flowHistory) * 5;
  const botScore =
    Object.keys(bot.flowByCode).length +
    historyDepth(bot.aumHistory) * 10 +
    historyDepth(bot.flowHistory) * 5;
  if (r2Score >= botScore && r2Score > 0) return r2;
  if (botScore > 0) return bot;
  return r2.source !== "none" ? r2 : bot;
}

export async function GET(request: Request) {
  try {
    const equityOnly = new URL(request.url).searchParams.get("equity") === "1";
    const cacheKey = `etf-db:v3:${equityOnly ? "eq" : "all"}`;

    const payload = await withServerCache(
      cacheKey,
      170_000,
      600_000,
      async () => {
        const [items, overlay] = await Promise.all([
          fetchNaverUniverse(),
          fetchOverlay(),
        ]);
        const built = buildPayloadFromNaver(
          items as Parameters<typeof buildPayloadFromNaver>[0],
          {
            flowByCode: overlay.flowByCode,
            prevAsOf: overlay.prevAsOf,
            flowHistory: equityOnly ? undefined : overlay.flowHistory,
            aumHistory: equityOnly ? undefined : overlay.aumHistory,
            equityOnly,
          },
        );

        built.rows = await enrichIndexClassification(built.rows, {
          knownByCode: overlay.benchmarkByCode,
          fetchMissing: true,
        });
        built.aggregates = {
          ...built.aggregates,
          index: aggregateRows(built.rows, "index"),
        };

        try {
          const reconstructed = await reconstructAumHistories({
            rows: built.rows,
            aggregates: built.aggregates,
            liveDay: built.as_of || built.generated_at.slice(0, 10),
            equityOnly,
          });
          built.aum_history = {
            type: pickRicherHistory(built.aum_history.type, reconstructed.type),
            country: pickRicherHistory(
              built.aum_history.country,
              reconstructed.country,
            ),
            sector: pickRicherHistory(
              built.aum_history.sector,
              reconstructed.sector,
            ),
            index: pickRicherHistory(
              built.aum_history.index,
              reconstructed.index,
            ),
          };
        } catch (histExc) {
          console.warn("etf-db aum history reconstruct failed:", histExc);
        }

        return built;
      },
    );

    return NextResponse.json(payload, {
      headers: { "Cache-Control": cdnCacheHeader("heavy") },
    });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json(
      { ok: false, error: message } satisfies Partial<EtfDbPayload> & {
        ok: false;
        error: string;
      },
      { status: 502 },
    );
  }
}
