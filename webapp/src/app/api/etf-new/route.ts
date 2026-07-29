import { NextResponse } from "next/server";

import { fetchBotJson } from "@/lib/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type EtfNewPayload = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams({
    kr: searchParams.get("kr") || "15",
    us: searchParams.get("us") || "15",
    analyze_kr: searchParams.get("analyze_kr") || "4",
    analyze_us: searchParams.get("analyze_us") || "2",
  });

  try {
    const data = await fetchBotJson<EtfNewPayload>(`/api/web/etf-new?${qs}`, {
      timeoutMs: 55_000,
    });
    return NextResponse.json(data, { status: data.ok ? 200 : 503 });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error:
          exc instanceof Error
            ? exc.message
            : "Render /api/web/etf-new unreachable",
      },
      { status: 502 },
    );
  }
}
