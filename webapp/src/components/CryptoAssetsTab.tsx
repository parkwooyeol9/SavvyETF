"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  BtcCandle,
  BtcChartBarId,
  CryptoAssetRow,
  CryptoAssetsPayload,
  CryptoIndicator,
  CryptoMoneyFlowPanel,
  CryptoSelectedCoin,
  CryptoStrategy,
  FuturesPanel,
  KimchiRow,
} from "@/lib/cryptoAssets";

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1)
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${n.toPrecision(4)}`;
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtKrw(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) {
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
  }
  if (n >= 1) {
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
  if (n >= 0.01) {
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  }
  return `$${n.toPrecision(4)}`;
}

function toneClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function actionClass(action: string | undefined): string {
  if (action === "buy") return "up";
  if (action === "sell") return "down";
  return "flat";
}

function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return <span className="meta-soft">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const up = last >= first;
  const data = values.map((v, i) => ({ i, v }));
  const pad = (max - min) * 0.05 || 1;
  return (
    <div className="crypto-spark" style={{ width: 88, height: 28 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <Area
            type="monotone"
            dataKey="v"
            stroke={up ? "#34d399" : "#f87171"}
            fill={up ? "rgba(52,211,153,0.18)" : "rgba(248,113,113,0.15)"}
            strokeWidth={1.4}
            dot={false}
            isAnimationActive={false}
          />
          <YAxis hide domain={[min - pad, max + pad]} />
          <XAxis hide dataKey="i" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function IndicatorGrid({ items }: { items: CryptoIndicator[] }) {
  return (
    <div className="macro-snap-grid macro-snap-grid-wide">
      {items.map((c) => (
        <article key={c.id} className="macro-snap-card">
          <span className="macro-snap-label">{c.label}</span>
          <strong className={`macro-snap-value ${c.tone || "flat"}`}>
            {c.display}
          </strong>
          <em className="macro-snap-sub">{c.note || "—"}</em>
        </article>
      ))}
    </div>
  );
}

function AssetsTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: CryptoAssetRow[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>자산</th>
            <th>가격(USD)</th>
            <th>24h</th>
            <th>7d</th>
            <th>시총</th>
            <th>24h 거래대금</th>
            <th>7d</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.id}
              className={selectedId === r.id ? "volmon-row-active" : ""}
              style={onSelect ? { cursor: "pointer" } : undefined}
              onClick={() => onSelect?.(r.id)}
            >
              <td>{i + 1}</td>
              <td>
                <strong>{r.symbol}</strong>
                <span className="meta-soft" style={{ marginLeft: 6 }}>
                  {r.name}
                </span>
              </td>
              <td>{fmtUsd(r.price_usd)}</td>
              <td className={toneClass(r.change_24h_pct)}>
                {fmtPct(r.change_24h_pct)}
              </td>
              <td className={toneClass(r.change_7d_pct)}>
                {fmtPct(r.change_7d_pct)}
              </td>
              <td>{fmtUsd(r.market_cap)}</td>
              <td>{fmtUsd(r.volume_24h)}</td>
              <td>
                <Sparkline values={r.sparkline_7d} />
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={8} className="empty">
                시세 없음
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function KimchiTable({ rows }: { rows: KimchiRow[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>심볼</th>
            <th>Upbit (KRW)</th>
            <th>공정가 (USD×FX)</th>
            <th>해외 (USD)</th>
            <th>김치 프리미엄</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <td>
                <strong>{r.symbol}</strong>
              </td>
              <td>{fmtKrw(r.upbit_krw)}</td>
              <td>{fmtKrw(r.fair_krw)}</td>
              <td>{fmtUsd(r.usd)}</td>
              <td className={toneClass(r.premium_pct)}>
                {fmtPct(r.premium_pct)}
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={5} className="empty">
                김치 데이터 없음
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function FuturesCharts({ futures }: { futures: FuturesPanel }) {
  const oiData = useMemo(
    () =>
      futures.oi_series.map((p) => ({
        label: p.label.slice(5),
        oi: p.value / 1e9,
      })),
    [futures.oi_series],
  );
  const lsData = useMemo(
    () =>
      futures.ls_series.map((p) => ({
        label: p.label.slice(5),
        ls: p.value,
      })),
    [futures.ls_series],
  );
  const fundingData = useMemo(
    () =>
      futures.funding_series.map((p) => ({
        label: p.label.slice(5),
        funding: p.value,
      })),
    [futures.funding_series],
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 16,
        marginTop: 8,
      }}
    >
      <div>
        <h4 className="geo-section-title" style={{ fontSize: "0.95rem" }}>
          OI (USD, 1H · 최근 72)
        </h4>
        <div className="geo-chart-wrap" style={{ height: 180 }}>
          {oiData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={oiData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="oiFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  minTickGap={28}
                />
                <YAxis
                  width={40}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickFormatter={(v) => `${Number(v).toFixed(2)}B`}
                />
                <Tooltip
                  formatter={(v) =>
                    typeof v === "number" ? `$${v.toFixed(3)}B` : "—"
                  }
                  contentStyle={{
                    background: "rgba(15,23,42,0.92)",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="oi"
                  name="OI"
                  stroke="#38bdf8"
                  fill="url(#oiFill)"
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="geo-chart-empty">OI 시계열 없음</div>
          )}
        </div>
      </div>
      <div>
        <h4 className="geo-section-title" style={{ fontSize: "0.95rem" }}>
          L/S Ratio (1H · 최근 72)
        </h4>
        <div className="geo-chart-wrap" style={{ height: 180 }}>
          {lsData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={lsData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="lsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  minTickGap={28}
                />
                <YAxis
                  width={36}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  formatter={(v) =>
                    typeof v === "number" ? v.toFixed(2) : "—"
                  }
                  contentStyle={{
                    background: "rgba(15,23,42,0.92)",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="ls"
                  name="L/S"
                  stroke="#a78bfa"
                  fill="url(#lsFill)"
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="geo-chart-empty">L/S 시계열 없음</div>
          )}
        </div>
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <h4 className="geo-section-title" style={{ fontSize: "0.95rem" }}>
          Funding Rate 이력 (%)
        </h4>
        <div className="geo-chart-wrap" style={{ height: 140 }}>
          {fundingData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={fundingData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  minTickGap={28}
                />
                <YAxis
                  width={44}
                  tick={{ fontSize: 10, fill: "#94a3b8" }}
                  tickFormatter={(v) => Number(v).toFixed(3)}
                />
                <Tooltip
                  formatter={(v) =>
                    typeof v === "number" ? `${v.toFixed(4)}%` : "—"
                  }
                  contentStyle={{
                    background: "rgba(15,23,42,0.92)",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="funding"
                  name="Funding %"
                  fill="rgba(52,211,153,0.55)"
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="geo-chart-empty">펀딩 이력 없음</div>
          )}
        </div>
      </div>
    </div>
  );
}

function BtcLiveChart({
  candles,
  interval,
  intervals,
  strategy,
  selected,
  onIntervalChange,
}: {
  candles: BtcCandle[];
  interval: string;
  intervals: Array<{ id: BtcChartBarId; label: string }>;
  strategy: CryptoStrategy | null;
  selected: CryptoSelectedCoin | null;
  onIntervalChange: (id: BtcChartBarId) => void;
}) {
  const data = useMemo(
    () =>
      candles.map((c) => ({
        label: c.label.slice(5),
        close: c.close,
        sma20: c.sma20,
        sma50: c.sma50,
        volume: c.volume,
        support: strategy?.support ?? null,
        resistance: strategy?.resistance ?? null,
      })),
    [candles, strategy],
  );
  const last = candles.at(-1);

  return (
    <div>
      <div className="etfdbus-chart-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 className="etfdb-detail-title" style={{ margin: 0 }}>
          {selected
            ? `${selected.symbol} · ${selected.name} ${
                selected.chart_source === "okx" ? "퍼프" : "현물"
              } (${interval})`
            : `라이브 (${interval})`}
          {last ? (
            <span className="etfdb-chart-mode">
              {fmtPx(last.close)} · {last.label}
            </span>
          ) : null}
        </h3>
        <div className="kr-hero-actions" style={{ marginLeft: "auto" }}>
          {(intervals.length
            ? intervals
            : [
                { id: "1m" as const, label: "1분" },
                { id: "5m" as const, label: "5분" },
                { id: "15m" as const, label: "15분" },
                { id: "1H" as const, label: "1시간" },
                { id: "4H" as const, label: "4시간" },
                { id: "1D" as const, label: "1일" },
              ]
          ).map((b) => (
            <button
              key={b.id}
              type="button"
              className={`tab-btn sub ${interval === b.id ? "active" : ""}`}
              onClick={() => onIntervalChange(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
      <div className="geo-chart-wrap etfdbus-chart-lg" style={{ height: 320 }}>
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
            >
              <defs>
                <linearGradient id="btcFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                minTickGap={32}
              />
              <YAxis
                yAxisId="px"
                domain={["auto", "auto"]}
                width={64}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickFormatter={(v) =>
                  Number(v).toLocaleString("en-US", {
                    maximumFractionDigits: 0,
                  })
                }
              />
              <YAxis
                yAxisId="vol"
                orientation="right"
                hide
                domain={[0, "auto"]}
              />
              <Tooltip
                formatter={(v, name) => {
                  if (typeof v !== "number") return "—";
                  if (String(name).includes("Vol")) return `${v.toFixed(1)} BTC`;
                  return fmtPx(v);
                }}
                contentStyle={{
                  background: "rgba(15,23,42,0.92)",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend />
              <Bar
                yAxisId="vol"
                dataKey="volume"
                name="Vol"
                fill="rgba(148,163,184,0.22)"
                isAnimationActive={false}
              />
              <Area
                yAxisId="px"
                type="monotone"
                dataKey="close"
                name="Close"
                stroke="#34d399"
                fill="url(#btcFill)"
                strokeWidth={1.8}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="px"
                type="monotone"
                dataKey="sma20"
                name="SMA20"
                stroke="#fbbf24"
                strokeWidth={1.2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              <Line
                yAxisId="px"
                type="monotone"
                dataKey="sma50"
                name="SMA50"
                stroke="#60a5fa"
                strokeWidth={1.2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              {strategy?.support != null ? (
                <Line
                  yAxisId="px"
                  type="monotone"
                  dataKey="support"
                  name="Support"
                  stroke="#f87171"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                />
              ) : null}
              {strategy?.resistance != null ? (
                <Line
                  yAxisId="px"
                  type="monotone"
                  dataKey="resistance"
                  name="Resistance"
                  stroke="#fb923c"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="geo-chart-empty">BTC 차트 없음</div>
        )}
      </div>
      <p className="meta-soft" style={{ marginTop: 6 }}>
        OKX {selected?.inst_id || "퍼프"} {interval} · 타임프레임 전환 시 재조회 · 약 60초 자동
        갱신
        {selected?.chart_source === "coingecko"
          ? " · 해당 종목은 OKX 퍼프가 없어 CoinGecko 현물 OHLC입니다."
          : " · SMA20/50 (지지/저항은 1H 기준)"}
      </p>
    </div>
  );
}

function MoneyFlowPanel({ mf }: { mf: CryptoMoneyFlowPanel }) {
  const volChart = useMemo(
    () =>
      (mf.volume_leaders || []).slice(0, 8).map((r) => ({
        name: r.symbol,
        volume: (r.volume_24h || 0) / 1e9,
        chg: r.change_24h_pct,
      })),
    [mf.volume_leaders],
  );

  const fmtAbsUsd = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return `${sign}${fmtUsd(n)}`;
  };

  return (
    <div style={{ marginTop: 16, marginBottom: 8 }}>
      <h3 className="geo-section-title">크립토 자금 흐름</h3>
      <p className="meta-soft" style={{ marginBottom: 8 }}>
        거래대금 상위 · 스테이블(테더) 순발행 · 현물 ETF AUM — Flow/Position
        합산 없음 · 공개 데이터만
      </p>
      {mf.headlines.length ? (
        <ul className="panel-sub" style={{ marginBottom: 12 }}>
          {mf.headlines.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}

      <div className="macro-snap-grid macro-snap-grid-wide">
        <article className="macro-snap-card">
          <span className="macro-snap-label">크립토 시총</span>
          <strong className="macro-snap-value">
            {fmtUsd(mf.market?.total_mcap_usd)}
          </strong>
          <em className="macro-snap-sub">
            24h Vol {fmtUsd(mf.market?.total_volume_24h_usd)}
            {mf.market?.btc_dominance_pct != null
              ? ` · BTC.D ${mf.market.btc_dominance_pct.toFixed(1)}%`
              : ""}
          </em>
        </article>
        <article className="macro-snap-card">
          <span className="macro-snap-label">스테이블 공급</span>
          <strong className="macro-snap-value">
            {fmtUsd(mf.stables.total_usd)}
          </strong>
          <em className={`macro-snap-sub ${toneClass(mf.stables.chg_1d_usd)}`}>
            1일 {fmtAbsUsd(mf.stables.chg_1d_usd)} ({fmtPct(mf.stables.chg_1d_pct)})
            {" · "}7일 {fmtAbsUsd(mf.stables.chg_7d_usd)}
          </em>
        </article>
        <article className="macro-snap-card">
          <span className="macro-snap-label">USDT 순발행 프록시</span>
          <strong className="macro-snap-value">
            {fmtUsd(mf.stables.usdt_usd)}
          </strong>
          <em
            className={`macro-snap-sub ${toneClass(mf.stables.usdt_chg_1d_usd)}`}
          >
            1일 {fmtAbsUsd(mf.stables.usdt_chg_1d_usd)} (
            {fmtPct(mf.stables.usdt_chg_1d_pct)}) · 7일{" "}
            {fmtAbsUsd(mf.stables.usdt_chg_7d_usd)}
          </em>
        </article>
        {(mf.etf.rows || []).map((e) => (
          <article key={e.symbol} className="macro-snap-card">
            <span className="macro-snap-label">{e.symbol} AUM</span>
            <strong className="macro-snap-value">{fmtUsd(e.aum_usd)}</strong>
            <em className={`macro-snap-sub ${toneClass(e.change_24h_pct)}`}>
              {e.name}
              {e.change_24h_pct != null ? ` · ${fmtPct(e.change_24h_pct)}` : ""}
            </em>
          </article>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
          marginTop: 12,
        }}
      >
        <div>
          <h4 className="geo-section-title" style={{ fontSize: "0.95rem" }}>
            24h 거래대금 상위 (USD bn)
          </h4>
          <div className="geo-chart-wrap" style={{ height: 220 }}>
            {volChart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={volChart}
                  margin={{ top: 8, right: 8, left: 0, bottom: 24 }}
                >
                  <CartesianGrid
                    stroke="rgba(148,163,184,0.12)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                  />
                  <YAxis
                    width={36}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    tickFormatter={(v) => `${Number(v).toFixed(1)}`}
                  />
                  <Tooltip
                    formatter={(v, name) => {
                      if (typeof v !== "number") return "—";
                      if (String(name).includes("chg") || name === "chg")
                        return fmtPct(v);
                      return `$${v.toFixed(2)}B`;
                    }}
                    contentStyle={{
                      background: "rgba(15,23,42,0.92)",
                      border: "none",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="volume"
                    name="Vol $B"
                    fill="rgba(52,211,153,0.65)"
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="geo-chart-empty">거래대금 데이터 없음</div>
            )}
          </div>
        </div>
        <div>
          <h4 className="geo-section-title" style={{ fontSize: "0.95rem" }}>
            거래대금 상세
          </h4>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>심볼</th>
                  <th>24h Vol</th>
                  <th>점유</th>
                  <th>24h</th>
                </tr>
              </thead>
              <tbody>
                {(mf.volume_leaders || []).slice(0, 10).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.symbol}</strong>
                    </td>
                    <td>{fmtUsd(r.volume_24h)}</td>
                    <td>
                      {r.volume_share_pct != null
                        ? `${r.volume_share_pct.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className={toneClass(r.change_24h_pct)}>
                      {fmtPct(r.change_24h_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meta-soft" style={{ marginTop: 8 }}>
            {mf.stables.source}
            {mf.etf.note ? ` · ${mf.etf.note}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

function StrategyPanel({ strategy }: { strategy: CryptoStrategy }) {
  return (
    <div className="geo-composite macro-stress" style={{ marginTop: 12 }}>
      <div
        className="geo-score-ring"
        data-level={
          strategy.action === "buy"
            ? "cool"
            : strategy.action === "sell"
              ? "hot"
              : "warm"
        }
      >
        <span className={`geo-score-num ${actionClass(strategy.action)}`}>
          {strategy.action_ko}
        </span>
        <span className="geo-score-label">점수 {strategy.score}</span>
      </div>
      <div className="geo-composite-body">
        <h3>{strategy.title}</h3>
        <p className="geo-thesis">{strategy.summary}</p>
        {strategy.bias_note ? (
          <p className="meta-soft" style={{ marginTop: 6 }}>
            {strategy.bias_note}
          </p>
        ) : null}
        <div className="macro-snap-grid" style={{ marginTop: 12 }}>
          <article className="macro-snap-card">
            <span className="macro-snap-label">진입</span>
            <strong className="macro-snap-value" style={{ fontSize: "0.92rem" }}>
              {strategy.entry}
            </strong>
          </article>
          <article className="macro-snap-card">
            <span className="macro-snap-label">손절 / 리스크</span>
            <strong className="macro-snap-value" style={{ fontSize: "0.92rem" }}>
              {strategy.stop}
            </strong>
          </article>
          <article className="macro-snap-card">
            <span className="macro-snap-label">목표가</span>
            <strong className="macro-snap-value" style={{ fontSize: "0.92rem" }}>
              {strategy.targets.join(" · ") || "—"}
            </strong>
          </article>
          <article className="macro-snap-card">
            <span className="macro-snap-label">무효 조건</span>
            <strong className="macro-snap-value" style={{ fontSize: "0.92rem" }}>
              {strategy.invalidation}
            </strong>
          </article>
        </div>
        {strategy.drivers.length ? (
          <p className="meta-soft" style={{ marginTop: 10 }}>
            드라이버: {strategy.drivers.join(" · ")}
          </p>
        ) : null}
        {strategy.risk_notes.length ? (
          <ul className="panel-sub" style={{ marginTop: 8 }}>
            {strategy.risk_notes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export default function CryptoAssetsTab() {
  const [data, setData] = useState<CryptoAssetsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveTick, setLiveTick] = useState(0);
  const [bar, setBar] = useState<BtcChartBarId>("1H");
  const [coin, setCoin] = useState("bitcoin");

  const load = useCallback(
    async (
      silent = false,
      nextBar: BtcChartBarId = bar,
      nextCoin: string = coin,
    ) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/crypto-assets?bar=${encodeURIComponent(nextBar)}` +
            `&coin=${encodeURIComponent(nextCoin)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as CryptoAssetsPayload;
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        setData(json);
        setBar(json.btc_chart_interval || nextBar);
        if (json.selected_coin?.id) setCoin(json.selected_coin.id);
        setLiveTick((n) => n + 1);
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc));
        if (!silent) setData(null);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [bar, coin],
  );

  useEffect(() => {
    void load(false, bar, coin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void load(true, bar, coin);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [load, bar, coin]);

  const onIntervalChange = useCallback(
    (id: BtcChartBarId) => {
      setBar(id);
      void load(false, id, coin);
    },
    [load, coin],
  );

  const onCoinChange = useCallback(
    (id: string) => {
      setCoin(id);
      void load(false, bar, id);
    },
    [load, bar],
  );

  const fngChart = useMemo(
    () =>
      (data?.fear_greed || []).map((p) => ({
        date: p.date.slice(5),
        value: p.value,
        label: p.classification,
      })),
    [data],
  );

  const highlightIds = [
    "btc_dom",
    "usdt_dom",
    "kimchi_btc",
    "fear_greed",
    "total_mcap",
    "liquidity",
  ];
  const highlight = (data?.indicators || []).filter((i) =>
    highlightIds.includes(i.id),
  );
  const rest = (data?.indicators || []).filter(
    (i) => !highlightIds.includes(i.id),
  );

  return (
    <div className="geo-tab macro-tab">
      <section className="feature-block">
        <div className="feature-head geo-head-row">
          <div>
            <h2 className="feature-title">가상자산</h2>
            <p className="macro-subhead">
              시총 상위 20 코인(스테이블 제외) · 종목별 차트·코멘트 · 자금흐름 ·
              김치·도미넌스
            </p>
          </div>
          <div className="kr-hero-actions" style={{ gap: 8 }}>
            <label className="meta-soft" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              종목
              <select
                className="kq-select"
                value={coin}
                onChange={(e) => onCoinChange(e.target.value)}
                aria-label="시가총액 상위 코인 선택"
              >
                {(data?.watchlist?.length
                  ? data.watchlist
                  : [{ id: "bitcoin", symbol: "BTC", name: "Bitcoin", rank: 1, market_cap: null }]
                ).map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.rank} {c.symbol} · {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void load(false, bar, coin)}
              disabled={loading}
            >
              새로고침
            </button>
          </div>
        </div>

        {loading && !data ? (
          <p className="empty">가상자산 불러오는 중…</p>
        ) : null}
        {error ? <p className="empty warn">{error}</p> : null}

        {data ? (
          <>
            <p className="macro-schedule">{data.schedule_note}</p>
            <p className="meta-soft">
              {data.generated_at_display} · {data.source}
              {liveTick > 1 ? ` · live #${liveTick}` : ""}
            </p>
            <p className="kr-note">{data.note}</p>

            {data.strategy ? (
              <>
                <h3 className="geo-section-title" style={{ marginBottom: 0 }}>
                  {data.selected_coin?.symbol || "BTC"} · {data.selected_coin?.name || "Bitcoin"}{" "}
                  코멘트
                </h3>
                <StrategyPanel strategy={data.strategy} />
              </>
            ) : null}

            <BtcLiveChart
              candles={data.btc_chart || []}
              interval={data.btc_chart_interval || bar}
              intervals={data.btc_chart_intervals || []}
              strategy={data.strategy}
              selected={data.selected_coin}
              onIntervalChange={onIntervalChange}
            />

            {data.money_flow ? (
              <MoneyFlowPanel mf={data.money_flow} />
            ) : null}

            <h3 className="geo-section-title">
              {data.selected_coin?.symbol || "BTC"} 선물 · 포지셔닝
            </h3>
            <IndicatorGrid items={data.futures?.indicators || []} />
            {data.futures ? <FuturesCharts futures={data.futures} /> : null}

            {data.interpretations?.length ? (
              <div style={{ marginTop: 16, marginBottom: 12 }}>
                <h3 className="geo-section-title">현재 데이터 해석</h3>
                <ul className="panel-sub">
                  {data.interpretations.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="meta-soft" style={{ marginTop: 8 }}>
                  휴리스틱 해석입니다. 투자 권유가 아닙니다.
                </p>
              </div>
            ) : null}

            <h3 className="geo-section-title">시장 보조지표</h3>
            <IndicatorGrid items={highlight} />
            {rest.length ? (
              <>
                <h3 className="geo-section-title">추가 지표</h3>
                <IndicatorGrid items={rest} />
              </>
            ) : null}

            <h3 className="geo-section-title">시가총액 상위 20 (스테이블 제외)</h3>
            <p className="meta-soft" style={{ marginBottom: 8 }}>
              행을 클릭하면 위 차트·코멘트가 해당 코인으로 바뀝니다.
            </p>
            <AssetsTable
              rows={data.assets}
              selectedId={data.selected_coin?.id || coin}
              onSelect={onCoinChange}
            />

            <h3 className="geo-section-title">김치 프리미엄 (Upbit vs 해외)</h3>
            <p className="meta-soft" style={{ marginBottom: 8 }}>
              Upbit KRW ÷ (CoinGecko USD × Yahoo KRW=X)
              {data.usdkrw != null ? ` · FX ${data.usdkrw.toFixed(2)}` : ""}
            </p>
            <KimchiTable rows={data.kimchi} />

            <h3 className="geo-section-title">Fear & Greed (30일)</h3>
            <div className="geo-chart-wrap" style={{ height: 180 }}>
              {fngChart.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={fngChart}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="fngFill" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="#f59e0b"
                          stopOpacity={0.35}
                        />
                        <stop
                          offset="100%"
                          stopColor="#f59e0b"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="rgba(148,163,184,0.12)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      minTickGap={24}
                    />
                    <YAxis
                      domain={[0, 100]}
                      width={36}
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                    />
                    <Tooltip
                      formatter={(value, _name, item) => {
                        const label =
                          item && typeof item === "object" && "payload" in item
                            ? (item.payload as { label?: string }).label
                            : "";
                        return typeof value === "number"
                          ? [`${value}${label ? ` · ${label}` : ""}`, "F&G"]
                          : ["—", "F&G"];
                      }}
                      contentStyle={{
                        background: "rgba(15,23,42,0.92)",
                        border: "none",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#f59e0b"
                      fill="url(#fngFill)"
                      strokeWidth={1.8}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="geo-chart-empty">Fear & Greed 시계열 없음</div>
              )}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
