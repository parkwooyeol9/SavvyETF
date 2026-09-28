import { jsonWithCdnCache } from "@/lib/apiCache";
import { ETF_THEMES, type EtfTheme } from "@/lib/mpEtfPortfolio";
import { fetchThemeNews } from "@/lib/mpNews";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/mp/etf/news?themes=us_eq,semis,ust&lang=ko|en */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") === "en" ? "en" : "ko";
  const keys = (url.searchParams.get("themes") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is EtfTheme => s in ETF_THEMES)
    .slice(0, 24);
  if (!keys.length) {
    return jsonWithCdnCache({ ok: false, error: "themes 파라미터가 필요합니다.", blocks: [] }, "yahoo", 400);
  }
  try {
    const blocks = await fetchThemeNews(
      [...new Set(keys)].map((k) => ({ key: k, label: ETF_THEMES[k].label, query: ETF_THEMES[k][lang] })),
      lang,
    );
    return jsonWithCdnCache({ ok: true, generated_at: new Date().toISOString(), lang, blocks }, "yahooSlow");
  } catch (exc) {
    return jsonWithCdnCache(
      { ok: false, error: exc instanceof Error ? exc.message : String(exc), blocks: [] },
      "yahoo",
      500,
    );
  }
}
