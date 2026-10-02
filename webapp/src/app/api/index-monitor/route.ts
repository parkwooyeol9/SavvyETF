import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE } from "@/lib/adminGuard";
import { cdnCacheHeader } from "@/lib/apiCache";
import bundled from "@/data/indexMonitorChanges.json";
import type { IndexChangeRow, IndexMonitorResponse } from "@/lib/indexMonitor";
import { readSealedJson } from "@/lib/sealedData";
import { siteAdminAuthorized } from "@/lib/siteAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RowsFile = { asOf: string; rows: IndexChangeRow[] };

const DATA = bundled as unknown as RowsFile;
const MSCI_KEY = "private/index_monitor/msci_rows.bin";

/**
 * MSCI's public change lists forbid building databases from them and the repo is
 * public, so MSCI_* rows are not bundled: they come from a sealed R2 object and
 * only for the site admin. `?scope=admin` keeps the admin response on its own
 * uncached URL so a CDN copy of the public subset is never served to the admin.
 */
export async function GET(request: Request) {
  const wantsAdmin = new URL(request.url).searchParams.get("scope") === "admin";
  const admin = wantsAdmin && siteAdminAuthorized(request);
  let msci: IndexChangeRow[] = [];
  let error: string | undefined;
  if (admin) {
    try {
      msci = (await readSealedJson<RowsFile>(MSCI_KEY))?.rows ?? [];
      if (!msci.length) error = "MSCI 행이 아직 업로드되지 않았습니다.";
    } catch (e) {
      error = `MSCI 행을 열지 못했습니다: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const body: IndexMonitorResponse = {
    ok: true,
    asOf: DATA.asOf,
    rows: [...DATA.rows, ...msci],
    msciHidden: 0,
    ...(error ? { error } : {}),
  };
  return NextResponse.json(body, {
    headers: wantsAdmin ? PRIVATE_NO_STORE : { "Cache-Control": cdnCacheHeader("yahooSlow") },
  });
}
