/**
 * Public (non-admin) views of the shared MP portfolio and its analysis.
 *
 * The MP tab hides 편입·리밸런싱 일자 from non-admins. That has to happen on the
 * server: anything in a JSON response can be read with devtools or curl.
 * Pure functions only — no fetch, no Next imports — so they are easy to test.
 */

import type { MpAnalysis } from "@/lib/mpAnalytics";
import type { MpPortfolio } from "@/lib/mpPortfolio";

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

/**
 * Versions are pre-sorted by date and their dates blanked. Client code orders
 * versions with a stable sort on `date`, so equal ("") keys keep this order and
 * "최초 편입 / 리밸런싱 #n" labels still line up.
 */
export function redactMpPortfolioForPublic(p: MpPortfolio): MpPortfolio {
  const versions = [...p.versions]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((v) => ({ ...v, date: "" }));
  return { ...p, versions, updated_at: "" };
}

/**
 * Strips the fields that reveal when holdings were bought or rebalanced:
 * the actual-mode start date, per-holding entry dates, since-entry returns
 * (entry price + price history ⇒ entry date) and dates quoted in notes.
 * Backtest windows are derived from the lookback, not the portfolio, so they stay.
 */
export function redactMpAnalysisForPublic(a: MpAnalysis): MpAnalysis {
  return {
    ...a,
    start_date: a.mode === "actual" ? null : a.start_date,
    error: a.error?.replace(ISO_DATE, "해당일"),
    notes: a.notes.map((n) => n.replace(ISO_DATE, "해당일")),
    holdings: a.holdings.map((h) => ({
      ...h,
      first_date: null,
      return_since_entry_pct: null,
      local_return_since_entry_pct: null,
    })),
  };
}
