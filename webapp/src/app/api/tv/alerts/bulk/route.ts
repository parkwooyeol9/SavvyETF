import { TvToolError } from "@/lib/tvMcp/client";
import { getQuotes, resolveSymbols, roundAlertPrice } from "@/lib/tvMcp/operator";
import { withTvSession } from "@/lib/tvMcp/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BULK_SYMBOLS = 10;

type Direction = "up" | "down" | "both";
type Body = { symbols?: unknown[]; pct?: number | string; direction?: string; label?: string };
type Condition = "cross_up" | "cross_down";
type Created = { symbol: string; condition: Condition; price: number; base: number };

export async function POST(request: Request) {
  let body: Body = {};
  try {
    body = (await request.clone().json()) as Body;
  } catch {
    // Validation below reports the bad body.
  }
  return withTvSession(request, async (tv) => {
    const tokens = Array.isArray(body.symbols) ? body.symbols.map(String).filter((s) => s.trim()) : [];
    const pct = Number(body.pct);
    const direction: Direction =
      body.direction === "up" || body.direction === "down" ? body.direction : "both";
    const label = String(body.label || "").trim().slice(0, 60);
    if (!tokens.length) throw new Error("대상 종목이 없습니다.");
    if (tokens.length > MAX_BULK_SYMBOLS) {
      throw new Error(`일괄 알림은 한 번에 최대 ${MAX_BULK_SYMBOLS}종목까지 만들 수 있습니다.`);
    }
    if (!Number.isFinite(pct) || pct < 0.5 || pct > 50) {
      throw new Error("변동폭은 0.5%~50% 사이로 입력하세요.");
    }

    const { resolved, unresolved } = await resolveSymbols(tv, tokens);
    if (!resolved.length) return { created: [], unresolved, missing: [], failed: [] };
    const { quotes, missing } = await getQuotes(tv, resolved);

    const legs: Array<{ condition: Condition; factor: number; sign: string }> = [];
    if (direction !== "down") legs.push({ condition: "cross_up", factor: 1 + pct / 100, sign: "+" });
    if (direction !== "up") legs.push({ condition: "cross_down", factor: 1 - pct / 100, sign: "-" });

    const created: Created[] = [];
    const failed: string[] = [];
    let stopped = false;
    for (const symbol of resolved) {
      const quote = quotes[symbol];
      if (!quote || stopped) continue;
      for (const leg of legs) {
        const price = roundAlertPrice(quote.close * leg.factor, quote.currency);
        try {
          await tv.call("mcp-tv-create-alert", {
            symbol,
            price,
            condition: leg.condition,
            resolution: "1D",
            auto_deactivate: true,
            name: `Savvy · ${label ? `${label} ` : ""}${symbol} ${leg.sign}${pct}%`.slice(0, 300),
            message: `${symbol} ${leg.sign}${pct}% (기준 ${quote.close} → ${price})`,
          });
          created.push({ symbol, condition: leg.condition, price, base: quote.close });
        } catch (exc) {
          failed.push(`${symbol} ${leg.sign}${pct}%: ${exc instanceof Error ? exc.message : "실패"}`);
          if (exc instanceof TvToolError && exc.rateLimited) {
            stopped = true;
            break;
          }
        }
      }
    }
    return { created, unresolved, missing, failed, stopped };
  });
}
