import type { LevEtfItem, TraderWindow } from "@/lib/levEtf";
import { LEV_ETF_GROUP_LABELS, TRADER_WINDOWS } from "@/lib/levEtf";

function windowLabel(w: TraderWindow): string {
  return w === 1 ? "당일" : `${w}일`;
}

/** Build multi-sheet workbook and trigger browser download. */
export async function downloadLevEtfExcel(
  items: LevEtfItem[],
  generatedAt?: string,
): Promise<void> {
  const XLSX = await import("xlsx");

  const metaRows = [
    {
      field: "generated_at",
      value: generatedAt || new Date().toISOString(),
    },
    {
      field: "source",
      value: "Naver Finance item/frgn (20분 지연)",
    },
    {
      field: "universe_count",
      value: items.length,
    },
    {
      field: "note_traders",
      value:
        "거래원은 종목별 매수/매도 상위 5개 회원사만 포함. 증권사 합산은 TOP5 합이며 전체 회원사 전수가 아님.",
    },
    {
      field: "note_foreign_est",
      value:
        "거래원 하단 외국인순매매량/외국계추정합은 상위 5개 회원사 기반 추정치이며, 투자자 일별 외국인 순매매량과 일치하지 않을 수 있음.",
    },
  ];

  const traderRows: Array<Record<string, string | number | null>> = [];
  for (const item of items) {
    for (const snap of item.traders) {
      const n = Math.max(snap.sell_top.length, snap.buy_top.length);
      for (let i = 0; i < n; i++) {
        const sell = snap.sell_top[i];
        const buy = snap.buy_top[i];
        traderRows.push({
          code: item.code,
          name: item.name,
          group: LEV_ETF_GROUP_LABELS[item.group],
          underlying: item.underlying,
          direction: item.direction,
          structure: item.structure,
          window_days: snap.window,
          window_label: windowLabel(snap.window),
          rank: i + 1,
          sell_broker: sell?.broker ?? "",
          sell_volume: sell?.volume ?? null,
          buy_broker: buy?.broker ?? "",
          buy_volume: buy?.volume ?? null,
          foreign_label: snap.foreign_label,
          foreign_net: snap.foreign_net,
        });
      }
      if (n === 0) {
        traderRows.push({
          code: item.code,
          name: item.name,
          group: LEV_ETF_GROUP_LABELS[item.group],
          underlying: item.underlying,
          direction: item.direction,
          structure: item.structure,
          window_days: snap.window,
          window_label: windowLabel(snap.window),
          rank: null,
          sell_broker: "",
          sell_volume: null,
          buy_broker: "",
          buy_volume: null,
          foreign_label: snap.foreign_label,
          foreign_net: snap.foreign_net,
        });
      }
    }
  }

  const investorRows: Array<Record<string, string | number | null>> = [];
  for (const item of items) {
    for (const d of item.investors) {
      investorRows.push({
        code: item.code,
        name: item.name,
        group: LEV_ETF_GROUP_LABELS[item.group],
        date: d.date,
        close: d.close,
        change: d.change,
        change_pct: d.change_pct,
        volume: d.volume,
        institution_net: d.institution_net,
        foreign_net: d.foreign_net,
        foreign_shares: d.foreign_shares,
        foreign_ratio: d.foreign_ratio,
      });
    }
  }

  // Broker aggregate across universe for each window (TOP5-only sum)
  const brokerAggRows: Array<Record<string, string | number>> = [];
  for (const w of TRADER_WINDOWS) {
    const buy = new Map<string, number>();
    const sell = new Map<string, number>();
    for (const item of items) {
      const snap = item.traders.find((t) => t.window === w);
      if (!snap) continue;
      for (const r of snap.buy_top) {
        buy.set(r.broker, (buy.get(r.broker) || 0) + r.volume);
      }
      for (const r of snap.sell_top) {
        sell.set(r.broker, (sell.get(r.broker) || 0) + r.volume);
      }
    }
    const brokers = new Set([...buy.keys(), ...sell.keys()]);
    for (const broker of brokers) {
      const b = buy.get(broker) || 0;
      const s = sell.get(broker) || 0;
      brokerAggRows.push({
        window_days: w,
        window_label: windowLabel(w),
        broker,
        buy_volume: b,
        sell_volume: s,
        net_volume: b - s,
        note: "종목별 TOP5 합산",
      });
    }
  }
  brokerAggRows.sort((a, b) => {
    if (a.window_days !== b.window_days) {
      return Number(a.window_days) - Number(b.window_days);
    }
    return Number(b.buy_volume) + Number(b.sell_volume) - (Number(a.buy_volume) + Number(a.sell_volume));
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metaRows), "meta");
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(traderRows),
    "traders",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(investorRows),
    "investors_daily",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(brokerAggRows),
    "broker_agg_top5",
  );

  const stamp = (generatedAt || new Date().toISOString()).slice(0, 10);
  XLSX.writeFile(wb, `savvyetf-lev-etf-${stamp}.xlsx`);
}
