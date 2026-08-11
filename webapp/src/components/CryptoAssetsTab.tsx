"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  CryptoAssetRow,
  CryptoAssetsPayload,
  CryptoIndicator,
  KimchiRow,
} from "@/lib/cryptoAssets";

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
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

function toneClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
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

function AssetsTable({ rows }: { rows: CryptoAssetRow[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
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
          {rows.map((r) => (
            <tr key={r.id}>
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
              <td colSpan={7} className="empty">
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

export default function CryptoAssetsTab() {
  const [data, setData] = useState<CryptoAssetsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/crypto-assets", { cache: "no-store" });
      const json = (await res.json()) as CryptoAssetsPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    "funding",
    "total_mcap",
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
              BTC·ETH 등 주요 코인 · BTC/ETH/USDT 도미넌스 · 김치 프리미엄 ·
              Fear&Greed · 펀딩
            </p>
          </div>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void load()}
            disabled={loading}
          >
            새로고침
          </button>
        </div>

        {loading && !data ? <p className="empty">가상자산 불러오는 중…</p> : null}
        {error ? <p className="empty warn">{error}</p> : null}

        {data ? (
          <>
            <p className="macro-schedule">{data.schedule_note}</p>
            <p className="meta-soft">
              {data.generated_at_display} · {data.source}
            </p>
            <p className="kr-note">{data.note}</p>

            {data.interpretations?.length ? (
              <div style={{ marginBottom: 12 }}>
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

            <h3 className="geo-section-title">핵심 보조지표</h3>
            <IndicatorGrid items={highlight} />

            {rest.length ? (
              <>
                <h3 className="geo-section-title">추가 지표</h3>
                <IndicatorGrid items={rest} />
              </>
            ) : null}

            <h3 className="geo-section-title">주요 자산</h3>
            <AssetsTable rows={data.assets} />

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
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
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
