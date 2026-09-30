/** Period-return table over a level series (pure — shared by the track-record API and client). */

export type MpTrackPeriod = {
  key: string;
  label: string;
  port_pct: number | null;
  bm_pct: number | null;
  excess_pct: number | null;
  annualized?: boolean;
};

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function trackPeriodTable(dates: string[], p: number[], b: number[]): MpTrackPeriod[] {
  const N = dates.length;
  if (N < 2) return [];
  const last = dates[N - 1]!;
  const at = (lv: number[], d: string) => {
    let v: number | null = null;
    for (let i = 0; i < N && dates[i]! <= d; i++) v = lv[i]!;
    return v;
  };
  const spanYears = (from: string) =>
    (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (365.25 * 86_400_000);
  const defs: Array<{ key: string; label: string; from: string; ann?: boolean }> = [
    { key: "1d", label: "1일", from: dates[N - 2]! },
    { key: "1w", label: "1주", from: shiftDays(last, -7) },
    { key: "1m", label: "1개월", from: shiftDays(last, -30) },
    { key: "3m", label: "3개월", from: shiftDays(last, -91) },
    { key: "6m", label: "6개월", from: shiftDays(last, -182) },
    { key: "ytd", label: "YTD", from: `${Number(last.slice(0, 4)) - 1}-12-31` },
    { key: "1y", label: "1년", from: shiftDays(last, -365) },
    { key: "3y", label: "3년 (연)", from: shiftDays(last, -1096), ann: true },
    { key: "5y", label: "5년 (연)", from: shiftDays(last, -1826), ann: true },
    { key: "all", label: "설정 이후 누적", from: dates[0]! },
    { key: "all_ann", label: "설정 이후 (연)", from: dates[0]!, ann: true },
  ];
  return defs.map((d) => {
    if (d.from < dates[0]!) {
      return { key: d.key, label: d.label, port_pct: null, bm_pct: null, excess_pct: null, annualized: d.ann };
    }
    const p0 = at(p, d.from);
    const b0 = at(b, d.from);
    const yrs = spanYears(d.key.startsWith("all") ? dates[0]! : d.from);
    const conv = (end: number, start: number | null) => {
      if (!start) return null;
      const g = end / start;
      return (d.ann ? Math.pow(g, 1 / Math.max(yrs, 1e-9)) - 1 : g - 1) * 100;
    };
    const pr = conv(p[N - 1]!, p0);
    const br = conv(b[N - 1]!, b0);
    return {
      key: d.key,
      label: d.label,
      port_pct: pr,
      bm_pct: br,
      excess_pct: pr != null && br != null ? pr - br : null,
      annualized: d.ann,
    };
  });
}
