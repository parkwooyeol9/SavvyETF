import { deleteAlerts, resolveSymbols, setAlertsActive } from "@/lib/tvMcp/operator";
import { withTvSession } from "@/lib/tvMcp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CONDITIONS = new Set(["cross", "cross_up", "cross_down", "greater", "less"]);

type Body = { symbol?: string; price?: number | string; condition?: string; name?: string };

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.clone().json()) as Body;
  } catch {
    // Validation below reports the bad body.
  }
  return withTvSession(request, async (tv) => {
    const price = Number(body.price);
    const condition = CONDITIONS.has(body.condition || "") ? body.condition! : "cross";
    if (!body.symbol?.trim()) throw new Error("종목을 입력하세요.");
    if (!Number.isFinite(price) || price <= 0) throw new Error("가격을 올바르게 입력하세요.");
    const { resolved } = await resolveSymbols(tv, [body.symbol]);
    if (!resolved.length) throw new Error(`종목을 찾지 못했습니다: ${body.symbol}`);
    const symbol = resolved[0];
    await tv.call("mcp-tv-create-alert", {
      symbol,
      price,
      condition,
      resolution: "1D",
      name: (body.name || `Savvy · ${symbol} ${condition} ${price}`).slice(0, 300),
    });
    return { created: true, symbol, price, condition };
  });
}

async function readIds(request: Request): Promise<{ ids: number[]; active?: unknown }> {
  try {
    const body = (await request.clone().json()) as { ids?: Array<number | string>; active?: unknown };
    const ids = (body.ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return { ids: ids.slice(0, 50), active: body.active };
  } catch {
    return { ids: [] };
  }
}

export async function DELETE(request: Request) {
  const { ids } = await readIds(request);
  return withTvSession(request, async (tv) => {
    if (!ids.length) throw new Error("삭제할 알림을 선택하세요.");
    await deleteAlerts(tv, ids);
    return { deleted: ids.length };
  });
}

export async function PATCH(request: Request) {
  const { ids, active } = await readIds(request);
  return withTvSession(request, async (tv) => {
    if (!ids.length) throw new Error("대상 알림을 선택하세요.");
    if (typeof active !== "boolean") throw new Error("active 값이 필요합니다.");
    await setAlertsActive(tv, ids, active);
    return { updated: ids.length, active };
  });
}
