import { NextResponse } from "next/server";

import { botBaseUrl } from "@/lib/bot";
import { buildPayloadFromNaver, type EtfDbPayload } from "@/lib/etfDb";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

type NaverListResponse = {
  resultCode?: string;
  result?: { etfItemList?: unknown[] };
};

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
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Naver ETF list empty");
  }
  return items;
}

async function fetchBotOverlay(): Promise<{
  flowByCode: Record<string, number>;
  prevAsOf: string | null;
  flowHistory: EtfDbPayload["flow_history"] | undefined;
  aumHistory: EtfDbPayload["aum_history"] | undefined;
}> {
  try {
    const res = await fetch(`${botBaseUrl()}/etfdb.json`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return {
        flowByCode: {},
        prevAsOf: null,
        flowHistory: undefined,
        aumHistory: undefined,
      };
    }
    const data = (await res.json()) as {
      prev_as_of?: string | null;
      rows?: Array<{ code?: string; flow_eok?: number | null }>;
      flow_history?: EtfDbPayload["flow_history"];
      aum_history?: EtfDbPayload["aum_history"];
    };
    const flowByCode: Record<string, number> = {};
    for (const row of data.rows || []) {
      if (row.code && row.flow_eok != null && Number.isFinite(row.flow_eok)) {
        flowByCode[row.code] = Number(row.flow_eok);
      }
    }
    return {
      flowByCode,
      prevAsOf: data.prev_as_of ?? null,
      flowHistory: data.flow_history,
      aumHistory: data.aum_history,
    };
  } catch {
    return {
      flowByCode: {},
      prevAsOf: null,
      flowHistory: undefined,
      aumHistory: undefined,
    };
  }
}

export async function GET() {
  try {
    const [items, overlay] = await Promise.all([
      fetchNaverUniverse(),
      fetchBotOverlay(),
    ]);
    const payload = buildPayloadFromNaver(
      items as Parameters<typeof buildPayloadFromNaver>[0],
      {
        flowByCode: overlay.flowByCode,
        prevAsOf: overlay.prevAsOf,
        flowHistory: overlay.flowHistory,
        aumHistory: overlay.aumHistory,
      },
    );
    return NextResponse.json(payload);
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
