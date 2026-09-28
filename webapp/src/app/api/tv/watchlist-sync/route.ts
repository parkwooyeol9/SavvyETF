import {
  listWatchlists,
  MAX_SYNC_SYMBOLS,
  removeFromWatchlist,
  resolveSymbols,
  syncWatchlist,
} from "@/lib/tvMcp/operator";
import { withTvSession } from "@/lib/tvMcp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = { name?: string; id?: string; symbols?: string[]; mode?: string };

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.clone().json()) as Body;
  } catch {
    // withTvSession still enforces auth; validation below reports the bad body.
  }
  return withTvSession(request, async (tv) => {
    const name = (body.name || "").trim().slice(0, 200);
    const id = String(body.id || "").trim();
    const tokens = Array.isArray(body.symbols) ? body.symbols.map(String) : [];
    if (id && !/^\d+$/.test(id)) throw new Error("워치리스트 id가 올바르지 않습니다.");
    if (!name && !id) throw new Error("워치리스트 이름을 입력하세요.");
    if (!tokens.length) throw new Error("대상 종목이 없습니다.");
    if (tokens.length > MAX_SYNC_SYMBOLS) {
      throw new Error(`한 번에 최대 ${MAX_SYNC_SYMBOLS}개까지 처리할 수 있습니다.`);
    }
    const { resolved, unresolved } = await resolveSymbols(tv, tokens);
    if (!resolved.length) {
      return { synced: false, resolved, unresolved };
    }
    const result =
      body.mode === "remove"
        ? { created: false, added: 0, ...(await removeFromWatchlist(tv, { id, name, symbols: resolved })) }
        : await syncWatchlist(tv, {
            id: id || undefined,
            name,
            symbols: resolved,
            mode: body.mode === "replace" ? "replace" : "append",
          });
    const watchlists = await listWatchlists(tv).catch(() => null);
    return { synced: true, resolved, unresolved, ...result, ...(watchlists ? { watchlists } : {}) };
  });
}
