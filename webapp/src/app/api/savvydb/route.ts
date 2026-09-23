import { jsonWithCdnCache, withServerCache } from "@/lib/apiCache";
import { isSavvyDbFile, SAVVYDB_ORIGIN } from "@/lib/savvyDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

async function fetchSavvyFile(file: string): Promise<unknown> {
  const url = `${SAVVYDB_ORIGIN}/data/${encodeURIComponent(file)}.json`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`savvyDB HTTP ${res.status} (${file})`);
  return res.json();
}

export async function GET(req: Request) {
  const file = new URL(req.url).searchParams.get("file") || "";
  if (!isSavvyDbFile(file)) {
    return jsonWithCdnCache(
      { ok: false, error: "지원하지 않는 파일입니다.", files: [] },
      "yahooSlow",
      400,
    );
  }
  try {
    const data = await withServerCache(
      `savvydb:${file}`,
      30 * 60_000,
      2 * 60 * 60_000,
      () => fetchSavvyFile(file),
    );
    return jsonWithCdnCache(
      { ok: true, file, data, source: SAVVYDB_ORIGIN },
      "yahooSlow",
    );
  } catch (exc) {
    return jsonWithCdnCache(
      {
        ok: false,
        file,
        error: exc instanceof Error ? exc.message : "savvyDB 로드 실패",
      },
      "yahooSlow",
      502,
    );
  }
}
