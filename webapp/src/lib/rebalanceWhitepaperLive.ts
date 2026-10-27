import type {
  AddendumEvent,
  AddendumStockRow,
  RebalanceWhitepaper,
  WhitepaperLiveDoc,
  WhitepaperRowTuple,
} from "./rebalance";

/** 봇 `Claude_Work/rebalance/wp_forecast.py` 가 거래일 18:10 이후 올리는 국내 그룹 예상 */
export const WP_LIVE_R2_KEY = "rebalance/whitepaper_live.json";

type LiveEvent = AddendumEvent & { all?: AddendumStockRow[] };

/**
 * 번들 백서(과거 실측·해외·방법론은 고정) 위에 매일 계산한 국내 그룹 예상을 덮는다.
 * research/rebalance_whitepaper/export_webapp.py 의 addendum → 그룹 예상(fc) 변환과 같은 규칙.
 */
export function mergeLive(base: RebalanceWhitepaper, live: WhitepaperLiveDoc): RebalanceWhitepaper {
  const byKey = new Map(live.events.map((e) => [`${e.gid}|${e.date}`, e as LiveEvent]));
  const events = base.addendum.events.map((e) => {
    const n = byKey.get(`${e.gid}|${e.date}`);
    if (!n) return e;
    const { all: _all, ...rest } = n;
    return rest;
  });
  const groups = base.groups.map((g) => {
    if (g.market !== "KR") return g;
    return {
      ...g,
      events: g.events.map((fc) => {
        const a = fc.fc ? byKey.get(`${g.id}|${fc.date}`) : undefined;
        if (!a) return fc;
        const all = a.all || [];
        const rows: WhitepaperRowTuple[] = all.map((r) => [
          r.name, r.code, r.w0, r.w1, r.dw, r.flow, r.adv, r.imp, null, r.status, r.float, r.close,
        ]);
        const mx = all.filter((r) => r.imp != null).sort((x, y) => (y.imp ?? 0) - (x.imp ?? 0))[0];
        return {
          ...fc,
          buy: a.buy,
          sell: a.sell,
          turn: a.turn,
          aum: a.aum_jo,
          nin: a.n_add,
          nout: a.n_del,
          hi: a.n30,
          mid: all.filter((r) => (r.imp ?? 0) >= 10).length,
          max: mx ? ([mx.name, mx.imp as number] as [string, number]) : fc.max,
          scheme: a.scheme,
          fit_dist: a.fit_dist,
          conf_w: a.conf_w,
          conf_s: a.conf_s,
          sel_note: a.sel_note,
          target_note: a.target_note,
          adds: a.adds,
          dels: a.dels,
          assume: `${a.target_note} · 교체[${a.conf_s}]: ${a.sel_note}`,
          rows: rows.length ? rows : fc.rows,
        };
      }),
    };
  });
  return {
    ...base,
    as_of: live.as_of,
    groups,
    addendum: { ...base.addendum, asof: live.as_of, events, combined: live.combined },
    live: {
      source: "r2",
      as_of: live.as_of,
      generated_at: live.generated_at,
      float_asof: live.float_asof,
      errors: live.errors || [],
      bundled_as_of: base.as_of,
    },
  };
}
