"use client";

import { freshnessOf, freshnessTitle } from "@/lib/freshness";

/**
 * Amber "지연" chip when a daily snapshot has not been refreshed on time.
 * Renders nothing while the data is current (the as-of date is already shown
 * next to it), so it only draws attention when something is wrong.
 */
export default function FreshnessBadge({
  asOf,
  allowWeekdays = 1,
}: {
  asOf: string | null | undefined;
  /** Weekdays without an update that are still normal (1 = daily data). */
  allowWeekdays?: number;
}) {
  const f = freshnessOf(asOf, allowWeekdays);
  if (f.level !== "stale") return null;
  return (
    <em className="data-cat-badge warn" title={freshnessTitle(f)} style={{ marginLeft: 6 }}>
      지연 · 평일 {f.missedWeekdays}일 미갱신
    </em>
  );
}
