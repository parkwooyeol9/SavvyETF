import type { LevEtfItem, TraderWindow } from "@/lib/levEtf";
import { LEV_ETF_GROUP_LABELS, TRADER_WINDOWS } from "@/lib/levEtf";

function windowLabel(w: TraderWindow): string {
  return w === 1 ? "당일" : `${w}일`;
}

function shortCodeLabel(item: LevEtfItem): string {
  return `${item.code}_${LEV_ETF_GROUP_LABELS[item.group]}`;
}

function sheetName(raw: string): string {
  // Excel sheet name max 31 chars, no \ / ? * [ ]
  return raw.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
}

type BrokerSideMaps = {
  buy: Map<string, number>;
  sell: Map<string, number>;
  net: Map<string, number>;
};

function brokerSidesForWindow(
  item: LevEtfItem,
  window: TraderWindow,
): BrokerSideMaps {
  const snap = item.traders.find((t) => t.window === window);
  const buy = new Map<string, number>();
  const sell = new Map<string, number>();
  const net = new Map<string, number>();
  if (!snap) return { buy, sell, net };
  for (const r of snap.buy_top) {
    buy.set(r.broker, (buy.get(r.broker) || 0) + r.volume);
    net.set(r.broker, (net.get(r.broker) || 0) + r.volume);
  }
  for (const r of snap.sell_top) {
    sell.set(r.broker, (sell.get(r.broker) || 0) + r.volume);
    net.set(r.broker, (net.get(r.broker) || 0) - r.volume);
  }
  return { buy, sell, net };
}

function brokerNetForWindow(
  item: LevEtfItem,
  window: TraderWindow,
): Map<string, number> {
  return brokerSidesForWindow(item, window).net;
}

function addMaps(into: Map<string, number>, from: Map<string, number>) {
  for (const [broker, v] of from) {
    into.set(broker, (into.get(broker) || 0) + v);
  }
}

function collectBrokers(items: LevEtfItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    for (const snap of item.traders) {
      for (const r of snap.buy_top) set.add(r.broker);
      for (const r of snap.sell_top) set.add(r.broker);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}

function collectDates(items: LevEtfItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    for (const d of item.investors) set.add(d.date);
  }
  return [...set].sort();
}

function wideMetricSheet(
  items: LevEtfItem[],
  dates: string[],
  pick: (d: {
    volume: number;
    foreign_net: number;
    institution_net: number;
    individual_net: number;
  }) => number,
): Array<Record<string, string | number | null>> {
  const byCode = new Map(
    items.map((item) => [
      item.code,
      new Map(item.investors.map((d) => [d.date, d])),
    ]),
  );
  return dates.map((date) => {
    const row: Record<string, string | number | null> = { date };
    for (const item of items) {
      const d = byCode.get(item.code)?.get(date);
      row[shortCodeLabel(item)] = d ? pick(d) : null;
    }
    return row;
  });
}

/** Build multi-sheet workbook optimized for Excel charting. */
export async function downloadLevEtfExcel(
  items: LevEtfItem[],
  generatedAt?: string,
): Promise<void> {
  const XLSX = await import("xlsx");
  const dates = collectDates(items);
  const brokers = collectBrokers(items);

  const metaRows = [
    { field: "generated_at", value: generatedAt || new Date().toISOString() },
    { field: "source", value: "Naver Finance item/frgn (20분 지연)" },
    { field: "universe_count", value: items.length },
    {
      field: "individual_net_formula",
      value: "individual_net = -(foreign_net + institution_net)",
    },
    {
      field: "individual_net_note",
      value:
        "네이버 표가 개인·기관·외국인 삼분법일 때 성립. 기타법인이 별도면 오차 가능.",
    },
    {
      field: "volume_note",
      value: "volume(거래량)은 전체 체결량. 순매매 컬럼과 직접 합산 비교 대상이 아님.",
    },
    {
      field: "broker_timeseries_note",
      value:
        "거래원 일별 시계열은 원천에 없음. broker_* 시트는 창(당일/5/20/60일)을 시간축으로 한 TOP5 기반 수량.",
    },
    {
      field: "broker_agg_window_note",
      value:
        "broker_agg_window: 유니버스 합산. metric=buy|sell|net (net=buy−sell). 창×metric 행, 열=증권사.",
    },
    {
      field: "chart_tip_investors",
      value:
        "inv_foreign_wide / inv_institution_wide / inv_individual_wide / inv_volume_wide: A열=일자, 이후 열=종목. 영역 선택 후 꺾은선 차트.",
    },
    {
      field: "chart_tip_brokers",
      value:
        "broker_net_wide: 종목×창 행, 열=증권사 net. broker_agg_window: metric 필터로 buy/sell/net 분리 차트.",
    },
  ];

  // Long tidy investors (with individual)
  const investorLong: Array<Record<string, string | number | null>> = [];
  for (const item of items) {
    for (const d of item.investors) {
      investorLong.push({
        date: d.date,
        code: item.code,
        name: item.name,
        group: LEV_ETF_GROUP_LABELS[item.group],
        close: d.close,
        change_pct: d.change_pct,
        volume: d.volume,
        foreign_net: d.foreign_net,
        institution_net: d.institution_net,
        individual_net: d.individual_net,
        foreign_shares: d.foreign_shares,
        foreign_ratio: d.foreign_ratio,
      });
    }
  }

  const invForeignWide = wideMetricSheet(items, dates, (d) => d.foreign_net);
  const invInstWide = wideMetricSheet(items, dates, (d) => d.institution_net);
  const invIndivWide = wideMetricSheet(items, dates, (d) => d.individual_net);
  const invVolWide = wideMetricSheet(items, dates, (d) => d.volume);

  // Per-ETF investor chart sheet: date | volume | foreign | institution | individual | close
  const perEtfInvestorSheets: Array<{
    name: string;
    rows: Array<Record<string, string | number | null>>;
  }> = items.map((item) => ({
    name: sheetName(`inv_${item.code}`),
    rows: item.investors.map((d) => ({
      date: d.date,
      volume: d.volume,
      foreign_net: d.foreign_net,
      institution_net: d.institution_net,
      individual_net: d.individual_net,
      close: d.close,
      change_pct: d.change_pct,
      foreign_ratio: d.foreign_ratio,
    })),
  }));

  // Broker wide: rows = code × window, columns = brokers (net)
  const brokerWide: Array<Record<string, string | number | null>> = [];
  for (const item of items) {
    for (const w of TRADER_WINDOWS) {
      const nets = brokerNetForWindow(item, w);
      const row: Record<string, string | number | null> = {
        code: item.code,
        name: item.name,
        group: LEV_ETF_GROUP_LABELS[item.group],
        window_days: w,
        window_label: windowLabel(w),
      };
      for (const broker of brokers) {
        row[broker] = nets.has(broker) ? nets.get(broker)! : null;
      }
      brokerWide.push(row);
    }
  }

  // Broker universe aggregate by window × metric (buy / sell / net)
  const brokerAggWide: Array<Record<string, string | number | null>> = [];
  for (const w of TRADER_WINDOWS) {
    const buy = new Map<string, number>();
    const sell = new Map<string, number>();
    const net = new Map<string, number>();
    for (const item of items) {
      const sides = brokerSidesForWindow(item, w);
      addMaps(buy, sides.buy);
      addMaps(sell, sides.sell);
      addMaps(net, sides.net);
    }
    for (const [metric, map] of [
      ["buy", buy],
      ["sell", sell],
      ["net", net],
    ] as const) {
      const row: Record<string, string | number | null> = {
        window_days: w,
        window_label: windowLabel(w),
        metric,
        metric_label:
          metric === "buy" ? "매수" : metric === "sell" ? "매도" : "순매수",
      };
      for (const broker of brokers) {
        row[broker] = map.has(broker) ? map.get(broker)! : null;
      }
      brokerAggWide.push(row);
    }
  }

  // Per-ETF broker "time" series: rows = window, columns = brokers
  const perEtfBrokerSheets = items.map((item) => {
    const rows = TRADER_WINDOWS.map((w) => {
      const nets = brokerNetForWindow(item, w);
      const row: Record<string, string | number | null> = {
        window_label: windowLabel(w),
        window_days: w,
      };
      for (const broker of brokers) {
        row[broker] = nets.has(broker) ? nets.get(broker)! : null;
      }
      return row;
    });
    return { name: sheetName(`broker_${item.code}`), rows };
  });

  // Raw long traders (reference)
  const traderLong: Array<Record<string, string | number | null>> = [];
  for (const item of items) {
    for (const snap of item.traders) {
      const n = Math.max(snap.sell_top.length, snap.buy_top.length, 1);
      for (let i = 0; i < n; i++) {
        const sell = snap.sell_top[i];
        const buy = snap.buy_top[i];
        traderLong.push({
          code: item.code,
          name: item.name,
          window_label: windowLabel(snap.window),
          window_days: snap.window,
          rank: sell || buy ? i + 1 : null,
          sell_broker: sell?.broker ?? "",
          sell_volume: sell?.volume ?? null,
          buy_broker: buy?.broker ?? "",
          buy_volume: buy?.volume ?? null,
          foreign_label: snap.foreign_label,
          foreign_net_est: snap.foreign_net,
        });
      }
    }
  }

  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: Array<Record<string, unknown>>) => {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(rows),
      sheetName(name),
    );
  };

  add("meta", metaRows);
  add("inv_long", investorLong);
  add("inv_foreign_wide", invForeignWide);
  add("inv_institution_wide", invInstWide);
  add("inv_individual_wide", invIndivWide);
  add("inv_volume_wide", invVolWide);
  add("broker_net_wide", brokerWide);
  add("broker_agg_window", brokerAggWide);
  add("traders_long", traderLong);

  // Limit extra sheets: first 8 ETFs get dedicated chart sheets to stay under Excel comfort;
  // all codes still covered in wide sheets above.
  for (const s of perEtfInvestorSheets) add(s.name, s.rows);
  for (const s of perEtfBrokerSheets) add(s.name, s.rows);

  const stamp = (generatedAt || new Date().toISOString()).slice(0, 10);
  XLSX.writeFile(wb, `savvyetf-lev-etf-${stamp}.xlsx`);
}
