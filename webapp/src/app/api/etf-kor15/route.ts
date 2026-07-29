import { NextResponse } from "next/server";

import { fetchBotJson } from "@/lib/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type EtfKor15Payload = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

export async function GET() {
  try {
    const data = await fetchBotJson<EtfKor15Payload>("/api/web/etf-kor15", {
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
            : "Render /api/web/etf-kor15 unreachable",
      },
      { status: 502 },
    );
  }
}
