import { NextResponse } from "next/server";

import { ALLOC_METHODS, ETF_CATALOG } from "@/lib/etfCatalog";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({
    ok: true,
    etfs: ETF_CATALOG,
    methods: ALLOC_METHODS,
  });
}
