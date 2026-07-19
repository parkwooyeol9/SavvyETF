import { NextResponse } from "next/server";

import { ETF_CATALOG } from "@/lib/simulate";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({ ok: true, etfs: ETF_CATALOG });
}
