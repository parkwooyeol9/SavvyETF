import { jsonWithCdnCache } from "@/lib/apiCache";
import { fetchMpNews, type MpNewsLang } from "@/lib/mpNews";
import type { MpCountry } from "@/lib/mpPortfolio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/mp/news?items=US:NVDA,CN:601899&lang=auto|ko|en */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lang = (["auto", "ko", "en"].includes(url.searchParams.get("lang") || "")
    ? url.searchParams.get("lang")
    : "auto") as MpNewsLang;
  const items = (url.searchParams.get("items") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((s) => {
      const [c, t] = s.includes(":") ? s.split(":") : ["US", s];
      const country: MpCountry = c === "CN" ? "CN" : "US";
      return { country, ticker: (t || "").slice(0, 16) };
    })
    .filter((x) => /^[A-Za-z0-9.\-^=]+$/.test(x.ticker));
  if (!items.length) {
    return jsonWithCdnCache({ ok: false, error: "items 파라미터가 필요합니다.", blocks: [] }, "yahoo", 400);
  }
  try {
    const blocks = await fetchMpNews(items, lang);
    return jsonWithCdnCache(
      { ok: true, generated_at: new Date().toISOString(), lang, blocks },
      "yahooSlow",
    );
  } catch (exc) {
    return jsonWithCdnCache(
      { ok: false, error: exc instanceof Error ? exc.message : String(exc), blocks: [] },
      "yahoo",
      500,
    );
  }
}
