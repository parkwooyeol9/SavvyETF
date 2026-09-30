import { NextResponse } from "next/server";
import { getFundDetail, getOverview, lookupHolders } from "@/lib/thirteenFServer";
import { findInvestor } from "@/lib/thirteenF";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CDN = "public, s-maxage=21600, stale-while-revalidate=86400";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const fund = (sp.get("fund") || "").trim();
  const q = (sp.get("q") || "").trim().slice(0, 40);
  try {
    if (fund) {
      if (!findInvestor(fund)) {
        return NextResponse.json({ error: "unknown fund" }, { status: 404 });
      }
      return NextResponse.json(await getFundDetail(fund), { headers: { "Cache-Control": CDN } });
    }
    if (q) {
      return NextResponse.json(await lookupHolders(q), { headers: { "Cache-Control": CDN } });
    }
    return NextResponse.json(await getOverview(), { headers: { "Cache-Control": CDN } });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
