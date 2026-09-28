import { deleteWatchlist, listWatchlists } from "@/lib/tvMcp/operator";
import { withTvSession } from "@/lib/tvMcp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BULK_DELETE = 20;

export async function POST(request: Request) {
  let ids: string[] = [];
  try {
    const body = (await request.clone().json()) as { id?: unknown; ids?: unknown[] };
    const raw = Array.isArray(body.ids) ? body.ids : body.id != null ? [body.id] : [];
    ids = Array.from(new Set(raw.map((v) => String(v).trim())));
  } catch {
    // Validation below reports the bad body.
  }
  return withTvSession(request, async (tv) => {
    if (!ids.length || ids.some((id) => !/^\d+$/.test(id))) {
      throw new Error("삭제할 워치리스트를 선택하세요.");
    }
    if (ids.length > MAX_BULK_DELETE) {
      throw new Error(`한 번에 최대 ${MAX_BULK_DELETE}개까지 삭제할 수 있습니다.`);
    }
    const deleted: string[] = [];
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await deleteWatchlist(tv, id);
        deleted.push(id);
      } catch (exc) {
        if (!deleted.length && ids.length === 1) throw exc;
        failed.push(`${id}: ${exc instanceof Error ? exc.message : "실패"}`);
      }
    }
    const watchlists = await listWatchlists(tv).catch(() => null);
    return { deleted, failed, ...(watchlists ? { watchlists } : {}) };
  });
}
