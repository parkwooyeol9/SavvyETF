import { MAX_SYNC_SYMBOLS, resolveSymbols, syncWatchlist } from "@/lib/tvMcp/operator";
import { withTvSession } from "@/lib/tvMcp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = { name?: string; symbols?: string[]; mode?: string };

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.clone().json()) as Body;
  } catch {
    // withTvSession still enforces auth; validation below reports the bad body.
  }
  return withTvSession(request, async (tv) => {
    const name = (body.name || "").trim().slice(0, 200);
    const tokens = Array.isArray(body.symbols) ? body.symbols.map(String) : [];
    if (!name) throw new Error("워치리스트 이름을 입력하세요.");
    if (!tokens.length) throw new Error("보낼 종목이 없습니다.");
    if (tokens.length > MAX_SYNC_SYMBOLS) {
      throw new Error(`한 번에 최대 ${MAX_SYNC_SYMBOLS}개까지 보낼 수 있습니다.`);
    }
    const { resolved, unresolved } = await resolveSymbols(tv, tokens);
    if (!resolved.length) {
      return { synced: false, resolved, unresolved };
    }
    const result = await syncWatchlist(tv, {
      name,
      symbols: resolved,
      mode: body.mode === "replace" ? "replace" : "append",
    });
    return { synced: true, resolved, unresolved, ...result };
  });
}
