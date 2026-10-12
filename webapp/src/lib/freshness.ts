/**
 * "Is this snapshot late?" — one rule for every daily dataset.
 *
 * Counts weekdays strictly between the data's as-of date and today (KST).
 * A dataset published every weekday is late once more than `allowWeekdays`
 * weekdays have passed without a newer snapshot. Holidays are not modelled, so
 * a long KR/US holiday can show "지연" for a day — the tooltip says why.
 */

export type Freshness = {
  level: "fresh" | "stale" | "unknown";
  /** Weekdays with no update, when the as-of date could be parsed. */
  missedWeekdays: number | null;
  asOf: string | null;
};

const KST_OFFSET_MS = 9 * 3_600_000;

/** Accepts YYYY-MM-DD, YYYYMMDD, YYYY.MM.DD, YYYY/MM/DD, or an ISO timestamp. */
export function parseAsOfDay(raw: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function kstToday(now: Date): { y: number; m: number; d: number } {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() };
}

/** Weekdays strictly between `from` and `to` (both calendar days, UTC-anchored). */
export function weekdaysBetween(
  from: { y: number; m: number; d: number },
  to: { y: number; m: number; d: number },
): number {
  const a = Date.UTC(from.y, from.m - 1, from.d);
  const b = Date.UTC(to.y, to.m - 1, to.d);
  if (b - a <= 86_400_000) return 0;
  let n = 0;
  for (let t = a + 86_400_000; t < b; t += 86_400_000) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
  }
  return n;
}

export function freshnessOf(
  asOf: string | null | undefined,
  allowWeekdays = 1,
  now: Date = new Date(),
): Freshness {
  const day = parseAsOfDay(asOf);
  if (!day) return { level: "unknown", missedWeekdays: null, asOf: asOf ?? null };
  const missed = weekdaysBetween(day, kstToday(now));
  return {
    level: missed > allowWeekdays ? "stale" : "fresh",
    missedWeekdays: missed,
    asOf: asOf ?? null,
  };
}

export function freshnessTitle(f: Freshness): string {
  if (f.level === "unknown") return "기준일을 알 수 없습니다.";
  if (f.level === "fresh") return `기준일 ${f.asOf} · 정상 갱신`;
  return `기준일 ${f.asOf} 이후 평일 ${f.missedWeekdays}일 동안 새 데이터가 없습니다. 수집 스케줄 실패 또는 휴장일일 수 있습니다.`;
}
