import { NextResponse } from "next/server";

import { PRIVATE_NO_STORE } from "@/lib/adminGuard";
import { withServerCache } from "@/lib/apiCache";
import { analyzeMp, type MpMode } from "@/lib/mpAnalytics";
import type { MpPortfolio } from "@/lib/mpPortfolio";
import { loadSharedMpPortfolio } from "@/lib/mpPortfolioStore";
import { redactMpAnalysisForPublic } from "@/lib/mpRedact";
import { siteAdminAuthorized } from "@/lib/siteAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  /** Draft portfolio sent by the admin editor (or any caller using the calculator). */
  portfolio?: MpPortfolio;
  /** Analyse the server-stored shared MP instead of a posted draft. */
  shared?: "mp";
  mode?: MpMode;
  lookback_days?: number;
};

function cleanPortfolio(p: MpPortfolio): MpPortfolio {
  return {
    id: String(p.id || "mp"),
    name: String(p.name || "MP"),
    bm_us_pct: Number.isFinite(Number(p.bm_us_pct)) ? Number(p.bm_us_pct) : 70,
    updated_at: "",
    versions: p.versions.map((v) => ({
      id: String(v.id || ""),
      date: String(v.date || "").slice(0, 10),
      holdings: (Array.isArray(v.holdings) ? v.holdings : []).slice(0, 80).map((h) => ({
        id: String(h.id || ""),
        country: h.country === "CN" || h.country === "CASH" ? h.country : "US",
        sector: String(h.sector || "").slice(0, 40),
        ticker: String(h.ticker || "").slice(0, 16),
        weight_pct: Number(h.weight_pct) || 0,
      })),
    })),
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const shared = body.shared === "mp";
    // Non-admins never receive the stored version dates, so they analyse the
    // shared MP by reference and get a redacted result back.
    const p = shared ? ((await loadSharedMpPortfolio("mp")) as MpPortfolio | null) : body.portfolio;
    if (!p || !Array.isArray(p.versions) || !p.versions.length) {
      return NextResponse.json(
        { ok: false, error: shared ? "공유 MP가 아직 저장되지 않았습니다." : "포트폴리오가 비어 있습니다." },
        { status: 400, headers: PRIVATE_NO_STORE },
      );
    }
    if (p.versions.length > 200) {
      return NextResponse.json({ ok: false, error: "리밸런싱 이력은 최대 200건입니다." }, { status: 400, headers: PRIVATE_NO_STORE });
    }
    const mode: MpMode = body.mode === "backtest" ? "backtest" : "actual";
    const lookback = Math.min(1825, Math.max(30, Number(body.lookback_days) || 365));
    const clean = cleanPortfolio(p);
    const key = `mp:analyze3:${mode}:${lookback}:${JSON.stringify({
      bm: clean.bm_us_pct,
      v: clean.versions.map((v) => [v.date, v.holdings.map((h) => [h.country, h.ticker, h.sector, h.weight_pct])]),
    })}`;
    const result = await withServerCache(key, 5 * 60_000, 10 * 60_000, () => analyzeMp(clean, mode, lookback));
    const out = shared && !siteAdminAuthorized(req) ? redactMpAnalysisForPublic(result) : result;
    return NextResponse.json(out, { status: out.ok ? 200 : 400, headers: PRIVATE_NO_STORE });
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return NextResponse.json({ ok: false, error: message }, { status: 500, headers: PRIVATE_NO_STORE });
  }
}
