"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  LEV_ETF_GROUP_LABELS,
  TRADER_WINDOWS,
  fmtNet,
  fmtPct,
  fmtVol,
  type InvestorDay,
  type LevEtfPayload,
  type LevEtfTraderDayArchive,
  type TraderWindow,
} from "@/lib/levEtf";
import { downloadLevEtfExcel } from "@/lib/levEtfExcel";
import type { LevGroupKey } from "@/lib/krMarket";
import type { MarketLeveragePayload } from "@/lib/marketLeverage";
import MarketLeveragePanels from "@/components/MarketLeveragePanels";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

type Panel = "traders" | "investors" | "history" | "table";
type GroupFilter = "all" | LevGroupKey;
type Side = "buy" | "sell" | "net";

function toneClass(n?: number | null): string {
  if (n == null || Number.isNaN(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function shortName(name: string): string {
  return name
    .replace(/단일종목/g, "")
    .replace(/레버리지/g, "2x")
    .replace(/인버스2X/g, "-2x")
    .replace(/선물/g, "선물 ")
    .trim();
}

export default function LevEtfTab() {
  const [data, setData] = useState<LevEtfPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mkt, setMkt] = useState<MarketLeveragePayload | null>(null);
  const [mktLoading, setMktLoading] = useState(true);
  const [mktError, setMktError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("traders");
  const [group, setGroup] = useState<GroupFilter>("all");
  const [code, setCode] = useState<string>("all");
  const [windowDays, setWindowDays] = useState<TraderWindow>(5);
  const [side, setSide] = useState<Side>("net");
  const [exporting, setExporting] = useState(false);
  const [histDates, setHistDates] = useState<string[]>([]);
  const [histDate, setHistDate] = useState<string>("");
  const [hist, setHist] = useState<LevEtfTraderDayArchive | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState<string | null>(null);

  const loadMarket = useCallback(async () => {
    setMktLoading(true);
    setMktError(null);
    try {
      const res = await fetch("/api/market-leverage?refresh=1", {
        cache: "no-store",
      });
      const json = (await res.json()) as MarketLeveragePayload;
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setMkt(json);
    } catch (exc) {
      setMktError(exc instanceof Error ? exc.message : "레버리지 지표 실패");
      setMkt(null);
    } finally {
      setMktLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lev-etf?refresh=1", { cache: "no-store" });
      const json = (await res.json()) as LevEtfPayload;
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "불러오기 실패");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistDates = useCallback(async () => {
    try {
      const res = await fetch("/api/lev-etf/history", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        dates?: string[];
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const dates = json.dates || [];
      setHistDates(dates);
      if (!histDate && dates[0]) setHistDate(dates[0]);
    } catch {
      setHistDates([]);
    }
  }, [histDate]);

  const loadHistDay = useCallback(async (date: string) => {
    if (!date) return;
    setHistLoading(true);
    setHistError(null);
    try {
      const res = await fetch(
        `/api/lev-etf/history?date=${encodeURIComponent(date)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as LevEtfTraderDayArchive & {
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setHist(json);
    } catch (exc) {
      setHistError(exc instanceof Error ? exc.message : "히스토리 실패");
      setHist(null);
    } finally {
      setHistLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMarket();
    void load();
    void loadHistDates();
  }, [load, loadMarket, loadHistDates]);

  useEffect(() => {
    if (panel === "history" && histDate) void loadHistDay(histDate);
  }, [panel, histDate, loadHistDay]);

  const items = useMemo(() => {
    const all = data?.items || [];
    if (group === "all") return all;
    return all.filter((i) => i.group === group);
  }, [data, group]);

  const activeItems = useMemo(() => {
    if (code === "all") return items;
    return items.filter((i) => i.code === code);
  }, [items, code]);

  const brokerChart = useMemo(() => {
    const buy = new Map<string, number>();
    const sell = new Map<string, number>();
    for (const item of activeItems) {
      const snap = item.traders.find((t) => t.window === windowDays);
      if (!snap) continue;
      for (const r of snap.buy_top) {
        buy.set(r.broker, (buy.get(r.broker) || 0) + r.volume);
      }
      for (const r of snap.sell_top) {
        sell.set(r.broker, (sell.get(r.broker) || 0) + r.volume);
      }
    }
    const brokers = new Set([...buy.keys(), ...sell.keys()]);
    const rows = [...brokers].map((broker) => {
      const b = buy.get(broker) || 0;
      const s = sell.get(broker) || 0;
      return {
        broker: broker.replace(/증권$/, ""),
        buy: b,
        sell: s,
        net: b - s,
      };
    });
    rows.sort((a, b) => {
      const av = side === "buy" ? a.buy : side === "sell" ? a.sell : Math.abs(a.net);
      const bv = side === "buy" ? b.buy : side === "sell" ? b.sell : Math.abs(b.net);
      return bv - av;
    });
    return rows.slice(0, 12);
  }, [activeItems, windowDays, side]);

  const investorChart = useMemo(() => {
    if (code !== "all" && activeItems[0]) {
      return activeItems[0].investors.map((d) => ({
        t: d.date.slice(5),
        date: d.date,
        volume: d.volume,
        foreign: d.foreign_net,
        institution: d.institution_net,
        individual: d.individual_net,
        close: d.close,
      }));
    }
    // Aggregate across selected universe by date
    const byDate = new Map<
      string,
      {
        volume: number;
        foreign: number;
        institution: number;
        individual: number;
        n: number;
      }
    >();
    for (const item of activeItems) {
      for (const d of item.investors) {
        const cur = byDate.get(d.date) || {
          volume: 0,
          foreign: 0,
          institution: 0,
          individual: 0,
          n: 0,
        };
        cur.volume += d.volume;
        cur.foreign += d.foreign_net;
        cur.institution += d.institution_net;
        cur.individual += d.individual_net;
        cur.n += 1;
        byDate.set(d.date, cur);
      }
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({
        t: date.slice(5),
        date,
        volume: v.volume,
        foreign: v.foreign,
        institution: v.institution,
        individual: v.individual,
        close: null as number | null,
      }));
  }, [activeItems, code]);

  const tableRows = useMemo(() => {
    if (panel === "traders") {
      const rows: Array<{
        key: string;
        etf: string;
        code: string;
        side: string;
        broker: string;
        volume: number;
        window: number;
      }> = [];
      for (const item of activeItems) {
        const snap = item.traders.find((t) => t.window === windowDays);
        if (!snap) continue;
        snap.sell_top.forEach((r, i) =>
          rows.push({
            key: `${item.code}-s-${i}`,
            etf: shortName(item.name),
            code: item.code,
            side: "매도",
            broker: r.broker,
            volume: r.volume,
            window: windowDays,
          }),
        );
        snap.buy_top.forEach((r, i) =>
          rows.push({
            key: `${item.code}-b-${i}`,
            etf: shortName(item.name),
            code: item.code,
            side: "매수",
            broker: r.broker,
            volume: r.volume,
            window: windowDays,
          }),
        );
      }
      return rows;
    }
    return [];
  }, [activeItems, panel, windowDays]);

  const investorTable = useMemo(() => {
    const rows: Array<InvestorDay & { etf: string; code: string }> = [];
    for (const item of activeItems) {
      for (const d of item.investors.slice().reverse()) {
        rows.push({ ...d, etf: shortName(item.name), code: item.code });
      }
    }
    return rows.slice(0, 400);
  }, [activeItems]);

  return (
    <div className="kr-tab lev-etf-tab">
      <header className="kr-hero">
        <div>
          <h2 className="kr-hero-title">레버리지 ETF · 거래원·수급</h2>
          <p className="kr-hero-sub">
            KRX 거래일 오후 4시에 한 번 수집·DB(R2) 적재합니다. 페이지를 열 때마다
            실시간 스크랩하지 않으며, 거래원 당일 TOP5는 일간 히스토리로 쌓입니다.
          </p>
        </div>
        <div className="kr-hero-actions">
          <div className="kr-toggles">
            {(
              [
                ["traders", "거래원"],
                ["investors", "투자자 일별"],
                ["history", "일간 히스토리"],
                ["table", "테이블"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={panel === id ? "on" : ""}
                onClick={() => setPanel(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              void loadMarket();
              void load();
              void loadHistDates();
            }}
            disabled={loading || mktLoading}
          >
            {loading || mktLoading ? "불러오는 중…" : "저장본 다시 불러오기"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={!data?.items?.length || exporting}
            onClick={() => {
              if (!data?.items?.length) return;
              setExporting(true);
              void downloadLevEtfExcel(data.items, data.generated_at)
                .catch((exc) => {
                  setError(
                    exc instanceof Error
                      ? `엑셀 저장 실패: ${exc.message}`
                      : "엑셀 저장 실패",
                  );
                })
                .finally(() => setExporting(false));
            }}
          >
            {exporting ? "엑셀 작성 중…" : "엑셀 다운로드"}
          </button>
        </div>
      </header>

      <div className="kr-card-head" style={{ margin: "0 0 8px" }}>
        <div>
          <h3 className="kr-card-title">단일종목 레버 ETF · 거래원·수급</h3>
          <p className="kr-card-sub">
            종목별 회원사 상위·일별 외국인·기관·개인(추정) 순매매
          </p>
        </div>
      </div>

      {data?.note ? <p className="kr-note">{data.note}</p> : null}
      {data?.source || data?.as_of ? (
        <p className="etf-flow-meta">
          {data.as_of ? <span>스냅샷 기준일 {data.as_of}</span> : null}
          {data.source ? <span>출처: {data.source}</span> : null}
          {data.stored_at || data.generated_at ? (
            <span>
              적재{" "}
              {new Date(data.stored_at || data.generated_at || "").toLocaleString(
                "ko-KR",
                { hour12: false },
              )}
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="lev-filters">
        <div className="kr-toggles">
          {(
            [
              ["all", "전체"],
              ["samsung_lev", LEV_ETF_GROUP_LABELS.samsung_lev],
              ["samsung_inv", LEV_ETF_GROUP_LABELS.samsung_inv],
              ["hynix_inv", LEV_ETF_GROUP_LABELS.hynix_inv],
              ["hynix_lev", LEV_ETF_GROUP_LABELS.hynix_lev],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={group === id ? "on" : ""}
              onClick={() => {
                setGroup(id);
                setCode("all");
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          className="lev-select"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        >
          <option value="all">종목 합산 / 전체</option>
          {items.map((i) => (
            <option key={i.code} value={i.code}>
              {i.code} · {shortName(i.name)}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="empty">{error}</p> : null}
      {loading && !data ? (
        <p className="empty">저장된 레버리지ETF 스냅샷을 불러오는 중…</p>
      ) : null}

      {!loading && data && panel === "traders" ? (
        <>
          <div className="lev-filters">
            <div className="kr-toggles">
              {TRADER_WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className={windowDays === w ? "on" : ""}
                  onClick={() => setWindowDays(w)}
                >
                  {w === 1 ? "당일" : `${w}일`}
                </button>
              ))}
            </div>
            <div className="kr-toggles">
              {(
                [
                  ["buy", "매수"],
                  ["sell", "매도"],
                  ["net", "순매수"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={side === id ? "on" : ""}
                  onClick={() => setSide(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <article className="kr-card">
            <div className="kr-card-head">
              <div>
                <h3 className="kr-card-title">증권사별 거래량</h3>
                <p className="kr-card-sub">
                  {windowDays === 1 ? "당일" : `${windowDays}일`} 누적 상위 합산 ·
                  단위 주
                </p>
              </div>
            </div>
            <div className="kr-chart" style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={brokerChart}
                  margin={{ top: 8, right: 8, left: 0, bottom: 28 }}
                >
                  <CartesianGrid
                    stroke="rgba(43,54,72,0.85)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="broker"
                    tick={{ fill: "#8fa3b8", fontSize: 10 }}
                    interval={0}
                    angle={-25}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis
                    tick={{ fill: "#8fa3b8", fontSize: 10 }}
                    width={64}
                    tickFormatter={(v: number) =>
                      Math.abs(v) >= 1e8
                        ? `${(v / 1e8).toFixed(1)}억`
                        : Math.abs(v) >= 1e4
                          ? `${(v / 1e4).toFixed(0)}만`
                          : `${v}`
                    }
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number, name: string) => [
                      fmtVol(Number(value)),
                      name === "buy" ? "매수" : name === "sell" ? "매도" : "순매수",
                    ]}
                  />
                  <Legend />
                  {side === "buy" || side === "net" ? (
                    <Bar dataKey="buy" name="buy" fill="#3b82f6" isAnimationActive={false} />
                  ) : null}
                  {side === "sell" || side === "net" ? (
                    <Bar dataKey="sell" name="sell" fill="#f87171" isAnimationActive={false} />
                  ) : null}
                  {side === "net" ? (
                    <Bar dataKey="net" name="net" fill="#34d399" isAnimationActive={false} />
                  ) : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </article>

          <div className="lev-broker-cards">
            {activeItems.map((item) => {
              const snap = item.traders.find((t) => t.window === windowDays);
              if (!snap) return null;
              return (
                <article key={item.code} className="kr-card lev-mini-card">
                  <div className="kr-card-head">
                    <div>
                      <h4 className="kr-card-title" style={{ fontSize: 14 }}>
                        {shortName(item.name)}
                      </h4>
                      <p className="kr-card-sub">
                        {item.code} · {LEV_ETF_GROUP_LABELS[item.group]}
                        {snap.foreign_label
                          ? ` · ${snap.foreign_label} ${fmtNet(snap.foreign_net)}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="lev-mini-cols">
                    <div>
                      <strong>매도상위</strong>
                      <ul>
                        {snap.sell_top.map((r) => (
                          <li key={`s-${r.broker}`}>
                            <span>{r.broker}</span>
                            <em>{fmtVol(r.volume)}</em>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong>매수상위</strong>
                      <ul>
                        {snap.buy_top.map((r) => (
                          <li key={`b-${r.broker}`}>
                            <span>{r.broker}</span>
                            <em>{fmtVol(r.volume)}</em>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : null}

      {!loading && data && panel === "investors" ? (
        <article className="kr-card">
          <div className="kr-card-head">
            <div>
              <h3 className="kr-card-title">
                일별 거래량 · 외국인·기관·개인 순매매
              </h3>
              <p className="kr-card-sub">
                {code === "all"
                  ? "선택 그룹 합산"
                  : activeItems[0]
                    ? shortName(activeItems[0].name)
                    : ""}
                {" · 개인 = -(외국인+기관)"}
              </p>
            </div>
          </div>
          <div className="kr-chart" style={{ height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={investorChart}
                margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
              >
                <CartesianGrid
                  stroke="rgba(43,54,72,0.85)"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="t"
                  tick={{ fill: "#8fa3b8", fontSize: 10 }}
                  minTickGap={24}
                />
                <YAxis
                  yAxisId="vol"
                  orientation="left"
                  tick={{ fill: "#8fa3b8", fontSize: 10 }}
                  width={56}
                  tickFormatter={(v: number) =>
                    Math.abs(v) >= 1e8
                      ? `${(v / 1e8).toFixed(1)}억`
                      : `${Math.round(v / 1e4)}만`
                  }
                />
                <YAxis
                  yAxisId="net"
                  orientation="right"
                  tick={{ fill: "#8fa3b8", fontSize: 10 }}
                  width={56}
                  tickFormatter={(v: number) =>
                    Math.abs(v) >= 1e6
                      ? `${(v / 1e6).toFixed(1)}M`
                      : `${Math.round(v / 1e3)}k`
                  }
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number, name: string) => {
                    if (name === "volume") return [fmtVol(Number(value)), "거래량"];
                    if (name === "foreign") return [fmtNet(Number(value)), "외국인"];
                    if (name === "institution")
                      return [fmtNet(Number(value)), "기관"];
                    if (name === "individual")
                      return [fmtNet(Number(value)), "개인"];
                    return [value, name];
                  }}
                />
                <Legend />
                <Bar
                  yAxisId="vol"
                  dataKey="volume"
                  name="volume"
                  fill="rgba(148,163,184,0.35)"
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="net"
                  type="monotone"
                  dataKey="foreign"
                  name="foreign"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="net"
                  type="monotone"
                  dataKey="institution"
                  name="institution"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="net"
                  type="monotone"
                  dataKey="individual"
                  name="individual"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </article>
      ) : null}

      {panel === "history" ? (
        <article className="kr-card">
          <div className="kr-card-head">
            <div>
              <h3 className="kr-card-title">거래원 일간 히스토리</h3>
              <p className="kr-card-sub">
                매일 16:00에 적재한 당일(window=1) TOP5. 웹에서 과거 일별 거래원을
                다시 볼 수 있습니다.
              </p>
            </div>
            <select
              className="lev-select"
              value={histDate}
              onChange={(e) => setHistDate(e.target.value)}
              disabled={!histDates.length}
            >
              {!histDates.length ? (
                <option value="">적재된 일자 없음</option>
              ) : (
                histDates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))
              )}
            </select>
          </div>
          {histLoading ? <p className="empty">히스토리 불러오는 중…</p> : null}
          {histError ? <p className="empty">{histError}</p> : null}
          {!histLoading && hist ? (
            <>
              <p className="etf-flow-meta">
                <span>기준일 {hist.as_of}</span>
                {hist.generated_at ? (
                  <span>
                    적재{" "}
                    {new Date(hist.generated_at).toLocaleString("ko-KR", {
                      hour12: false,
                    })}
                  </span>
                ) : null}
              </p>
              <div className="kr-table-wrap">
                <table className="kr-table">
                  <thead>
                    <tr>
                      <th>종목</th>
                      <th>구분</th>
                      <th>증권사</th>
                      <th>거래량</th>
                      <th>외인순매매</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hist.items
                      .filter((i) => group === "all" || i.group === group)
                      .filter((i) => code === "all" || i.code === code)
                      .flatMap((item) => {
                        const rows: Array<{
                          key: string;
                          etf: string;
                          side: string;
                          broker: string;
                          volume: number;
                          foreign: number | null;
                        }> = [];
                        item.trader.sell_top.forEach((r, idx) =>
                          rows.push({
                            key: `${item.code}-s-${idx}`,
                            etf: shortName(item.name),
                            side: "매도",
                            broker: r.broker,
                            volume: r.volume,
                            foreign: item.trader.foreign_net,
                          }),
                        );
                        item.trader.buy_top.forEach((r, idx) =>
                          rows.push({
                            key: `${item.code}-b-${idx}`,
                            etf: shortName(item.name),
                            side: "매수",
                            broker: r.broker,
                            volume: r.volume,
                            foreign: item.trader.foreign_net,
                          }),
                        );
                        return rows;
                      })
                      .map((r) => (
                        <tr key={r.key}>
                          <td>{r.etf}</td>
                          <td>{r.side}</td>
                          <td>{r.broker}</td>
                          <td className="num">
                            {r.volume.toLocaleString("ko-KR")}
                          </td>
                          <td className={`num ${toneClass(r.foreign)}`}>
                            {fmtNet(r.foreign)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="kr-table-note">
                {hist.note ||
                  "당일 거래원 TOP5만 저장됩니다. 전 회원사 전체 체결은 아닙니다."}
              </p>
            </>
          ) : null}
        </article>
      ) : null}

      {!loading && data && panel === "table" ? (
        <article className="kr-card">
          <div className="kr-card-head">
            <div>
              <h3 className="kr-card-title">원천 테이블</h3>
              <p className="kr-card-sub">
                거래원({windowDays === 1 ? "당일" : `${windowDays}일`}) 및 투자자
                일별
              </p>
            </div>
            <div className="kr-toggles">
              {TRADER_WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className={windowDays === w ? "on" : ""}
                  onClick={() => setWindowDays(w)}
                >
                  {w === 1 ? "당일" : `${w}일`}
                </button>
              ))}
            </div>
          </div>

          <h4 className="lev-table-title">거래원</h4>
          <div className="kr-table-wrap">
            <table className="kr-table">
              <thead>
                <tr>
                  <th>종목</th>
                  <th>코드</th>
                  <th>구분</th>
                  <th>증권사</th>
                  <th>거래량</th>
                  <th>창</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.etf}</td>
                    <td>
                      <code>{r.code}</code>
                    </td>
                    <td>{r.side}</td>
                    <td>{r.broker}</td>
                    <td className="num">{r.volume.toLocaleString("ko-KR")}</td>
                    <td>{r.window === 1 ? "당일" : `${r.window}일`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 className="lev-table-title">투자자 일별</h4>
          <div className="kr-table-wrap">
            <table className="kr-table">
              <thead>
                <tr>
                  <th>일자</th>
                  <th>종목</th>
                  <th>종가</th>
                  <th>등락률</th>
                  <th>거래량</th>
                  <th>외국인</th>
                  <th>기관</th>
                  <th>개인(추정)</th>
                  <th>외인보유율</th>
                </tr>
              </thead>
              <tbody>
                {investorTable.map((r) => (
                  <tr key={`${r.code}-${r.date}`}>
                    <td>{r.date}</td>
                    <td>
                      {r.etf} <code>{r.code}</code>
                    </td>
                    <td className="num">{r.close.toLocaleString("ko-KR")}</td>
                    <td className={`num ${toneClass(r.change_pct)}`}>
                      {fmtPct(r.change_pct)}
                    </td>
                    <td className="num">{r.volume.toLocaleString("ko-KR")}</td>
                    <td className={`num ${toneClass(r.foreign_net)}`}>
                      {fmtNet(r.foreign_net)}
                    </td>
                    <td className={`num ${toneClass(r.institution_net)}`}>
                      {fmtNet(r.institution_net)}
                    </td>
                    <td className={`num ${toneClass(r.individual_net)}`}>
                      {fmtNet(r.individual_net)}
                    </td>
                    <td className="num">
                      {r.foreign_ratio != null ? `${r.foreign_ratio.toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      <div style={{ marginTop: 24 }}>
        <MarketLeveragePanels
          data={mkt}
          loading={mktLoading}
          error={mktError}
        />
      </div>
    </div>
  );
}
