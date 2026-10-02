import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE } from "@/lib/adminGuard";
import { cdnCacheHeader } from "@/lib/apiCache";
import bundled from "@/data/indexMonitorChanges.json";
import { isMsciIndex, type IndexChangeRow, type IndexMonitorResponse } from "@/lib/indexMonitor";
import { siteAdminAuthorized } from "@/lib/siteAdmin";

export const dynamic = "force-dynamic";

const DATA = bundled as unknown as { asOf: string; rows: IndexChangeRow[] };

/**
 * MSCI's public change lists forbid building databases from them, so MSCI_* rows
 * only go to the site admin. `?scope=admin` keeps the admin response on its own
 * uncached URL so a CDN copy of the public subset is never served to the admin.
 */
export async function GET(request: Request) {
  const wantsAdmin = new URL(request.url).searchParams.get("scope") === "admin";
  const admin = wantsAdmin && siteAdminAuthorized(request);
  const rows = admin ? DATA.rows : DATA.rows.filter((r) => !isMsciIndex(r.index_id));
  const body: IndexMonitorResponse = {
    ok: true,
    asOf: DATA.asOf,
    rows,
    msciHidden: DATA.rows.length - rows.length,
  };
  return NextResponse.json(body, {
    headers: wantsAdmin ? PRIVATE_NO_STORE : { "Cache-Control": cdnCacheHeader("yahooSlow") },
  });
}
