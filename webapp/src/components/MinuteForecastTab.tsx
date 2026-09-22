"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  AreaChart,
} from "recharts";

import { useAdminSession } from "@/components/AdminSession";
import type {
  AssetForecast,
  HorizonForecast,
  MinuteForecastAssetId,
  MinuteForecastPayload,
} from "@/lib/minuteForecast";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtNum(n?: number | null, digits = 3): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtWhen(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function signalClass(s: string): string {
  if (s === "buy") return "up";
  if (s === "sell") return "down";
  return "flat";
}

function AssetCard({
  asset,
  horizonId,
}: {
  asset: AssetForecast;
  horizonId: "1h" | "4h";
}) {
  const h: HorizonForecast | undefined = asset.horizons.find(
    (x) => x.horizon === horizonId,
  );

  const densityRows = useMemo(
    () =>
      (h?.density || []).map((d) => ({
        x: d.x_pct,
        density: d.density,
      })),
    [h],
  );

  const pathRows = useMemo(
    () =>
      (h?.path || []).map((p) => ({
        min: p.step_min,
        median: p.median_pct,
        lo: p.lo_pct,
        hi: p.hi_pct,
        band: Math.max(p.hi_pct - p.lo_pct, 0),
      })),
    [h],
  );

  if (asset.error && !h) {
    return (
      <section className="geo-section">
        <h3 className="geo-section-title">
          {asset.symbol} · {asset.label}
        </h3>
        <p className="empty">{asset.error}</p>
      </section>
    );
  }

  if (!h) {
    return (
      <section className="geo-section">
        <h3 className="geo-section-title">
          {asset.symbol} · {asset.label}
        </h3>
        <p className="empty">해당 호라이즌 결과 없음</p>
      </section>
    );
  }

  return (
    <section className="geo-section">
      <div className="geo-section-head">
        <h3 className="geo-section-title">
          {asset.symbol} · {asset.label}
          <span className="meta-soft">
            {" "}
            · {asset.source} · {asset.bars_used} bars
            {asset.lookback_days != null
              ? ` · ${asset.lookback_days}d`
              : ""}
          </span>
        </h3>
        <span className={signalClass(h.signal)}>
          <strong>{h.signal_ko}</strong>
        </span>
      </div>
      <p className="meta-soft" style={{ marginTop: 0 }}>
        {h.signal_note} · 가격{" "}
        {asset.price != null
          ? asset.price.toLocaleString("en-US", {
              maximumFractionDigits: asset.price >= 100 ? 1 : 3,
            })
          : "—"}{" "}
        · 봉 시각 {fmtWhen(asset.as_of)}
      </p>

      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>P(상승)</th>
              <th>중앙</th>
              <th>기대</th>
              <th>q05</th>
              <th>q95</th>
              <th>CRPS↑</th>
              <th>Coverage90</th>
              <th>Brier</th>
              <th>방향적중</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>
                {(h.p_up * 100).toFixed(1)}%
              </td>
              <td className={signalClass(h.quantiles_pct.q50! > 0 ? "buy" : "sell")}>
                {fmtPct(h.quantiles_pct.q50)}
              </td>
              <td>{fmtPct(h.expected_pct)}</td>
              <td>{fmtPct(h.quantiles_pct.q5)}</td>
              <td>{fmtPct(h.quantiles_pct.q95)}</td>
              <td>
                {h.crps_improvement_pct != null
                  ? `${h.crps_improvement_pct > 0 ? "+" : ""}${h.crps_improvement_pct.toFixed(1)}%`
                  : "—"}
              </td>
              <td>
                {h.coverage_90 != null
                  ? `${(h.coverage_90 * 100).toFixed(0)}%`
                  : "—"}
              </td>
              <td>{fmtNum(h.brier, 3)}</td>
              <td>
                {h.direction_hit != null
                  ? `${(h.direction_hit * 100).toFixed(0)}%`
                  : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="minutepred-charts">
        <div>
          <h4 className="geo-section-title" style={{ fontSize: "0.95rem" }}>
            수익률 PDF ({horizonId})
          </h4>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <AreaChart data={densityRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2b3648" />
                <XAxis
                  dataKey="x"
                  tick={{ fill: "#8b9bb4", fontSize: 11 }}
                  tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                />
                <YAxis hide domain={[0, 1.05]} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [v.toFixed(3), "density"]}
                  labelFormatter={(l: number) => `수익률 ${Number(l).toFixed(2)}%`}
                />
                <Area
                  type="monotone"
                  dataKey="density"
                  stroke="#5b9fd4"
                  fill="#5b9fd4"
                  fillOpacity={0.35}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <h4 className="geo-section-title" style={{ fontSize: "0.95rem" }}>
            경로 밴드 ({horizonId})
          </h4>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <ComposedChart data={pathRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2b3648" />
                <XAxis
                  dataKey="min"
                  tick={{ fill: "#8b9bb4", fontSize: 11 }}
                  tickFormatter={(v: number) => `${v}m`}
                />
                <YAxis
                  tick={{ fill: "#8b9bb4", fontSize: 11 }}
                  tickFormatter={(v: number) => `${v}%`}
                  width={42}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number, name: string) => [
                    `${Number(v).toFixed(3)}%`,
                    name,
                  ]}
                  labelFormatter={(l: number) => `+${l}분`}
                />
                <Line
                  type="monotone"
                  dataKey="hi"
                  stroke="#5b9fd4"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  name="q95"
                />
                <Line
                  type="monotone"
                  dataKey="median"
                  stroke="#e8c547"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name="중앙"
                />
                <Line
                  type="monotone"
                  dataKey="lo"
                  stroke="#5b9fd4"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  name="q05"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {asset.fold_summary.length ? (
        <p className="meta-soft" style={{ marginTop: 8 }}>
          Walk-forward:{" "}
          {asset.fold_summary
            .map(
              (f) =>
                `F${f.fold}(n=${f.test_n}, CRPS1h ${
                  f.crps_1h_impr_pct != null
                    ? `${f.crps_1h_impr_pct > 0 ? "+" : ""}${f.crps_1h_impr_pct}%`
                    : "—"
                })`,
            )
            .join(" · ")}
        </p>
      ) : null}
    </section>
  );
}

export default function MinuteForecastTab() {
  const { secret, unlocked } = useAdminSession();
  const [data, setData] = useState<MinuteForecastPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [assetId, setAssetId] = useState<MinuteForecastAssetId>("btc");
  const [horizon, setHorizon] = useState<"1h" | "4h">("1h");

  const authHeaders = useMemo(() => {
    if (!secret) return {} as HeadersInit;
    return { Authorization: `Bearer ${secret}` };
  }, [secret]);

  const load = useCallback(async () => {
    if (!unlocked || !secret) {
      setLoading(false);
      setError("관리자 로그인 후 이용할 수 있습니다.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/minute-forecast", { headers: authHeaders });
      const json = (await res.json()) as MinuteForecastPayload;
      setData(json);
      if (!json.ok && json.error) setError(json.error);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, secret, unlocked]);

  const update = useCallback(async () => {
    if (!unlocked || !secret) {
      setError("관리자 로그인 후 이용할 수 있습니다.");
      return;
    }
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch("/api/minute-forecast", {
        method: "POST",
        headers: authHeaders,
      });
      const json = (await res.json()) as MinuteForecastPayload;
      setData(json);
      if (!json.ok) {
        setError(json.error || "계산 실패");
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setUpdating(false);
    }
  }, [authHeaders, secret, unlocked]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected =
    data?.assets.find((a) => a.id === assetId) || data?.assets[0] || null;

  return (
    <div className="geo-tab macro-tab">
      <section className="feature-block">
      <div className="feature-head geo-head-row">
        <div>
          <h2 className="feature-title">분봉예측</h2>
          <p className="macro-subhead">
            BTC · GLD · WTI 5분봉 → 다음 1시간/4시간 수익률 PDF·경로 추정
            (walk-forward 분위수 회귀)
          </p>
        </div>
        <button
          type="button"
          className="ghost-btn"
          disabled={updating || !unlocked}
          onClick={() => void update()}
        >
          {updating ? "계산 중…" : "업데이트"}
        </button>
      </div>

      <p className="macro-schedule">
        {data?.generated_at
          ? `계산 시각 ${fmtWhen(data.generated_at)}${data.cached ? " (캐시)" : ""}`
          : null}
        {data?.as_of_note ? ` · ${data.as_of_note}` : null}
      </p>

      {loading ? <p className="empty">불러오는 중…</p> : null}
      {error ? <p className="empty warn">{error}</p> : null}

      <div className="chip-row">
        {(
          [
            ["btc", "BTC"],
            ["gld", "GLD"],
            ["wti", "WTI"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`chip ${assetId === id ? "active" : ""}`}
            onClick={() => setAssetId(id)}
          >
            {label}
          </button>
        ))}
        {(
          [
            ["1h", "1시간"],
            ["4h", "4시간"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`chip ${horizon === id ? "active" : ""}`}
            onClick={() => setHorizon(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {selected ? <AssetCard asset={selected} horizonId={horizon} /> : null}

      {!loading && data?.assets?.length ? (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <h3 className="geo-section-title">요약</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>자산</th>
                <th>1h 시그널</th>
                <th>1h P(↑)</th>
                <th>1h 중앙</th>
                <th>4h 시그널</th>
                <th>4h P(↑)</th>
                <th>4h 중앙</th>
                <th>CRPS 1h↑</th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map((a) => {
                const h1 = a.horizons.find((x) => x.horizon === "1h");
                const h4 = a.horizons.find((x) => x.horizon === "4h");
                return (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.symbol}</strong>
                      {a.error ? (
                        <div className="meta-soft">{a.error}</div>
                      ) : null}
                    </td>
                    <td className={signalClass(h1?.signal || "hold")}>
                      {h1?.signal_ko || "—"}
                    </td>
                    <td>
                      {h1 ? `${(h1.p_up * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td>{fmtPct(h1?.quantiles_pct.q50)}</td>
                    <td className={signalClass(h4?.signal || "hold")}>
                      {h4?.signal_ko || "—"}
                    </td>
                    <td>
                      {h4 ? `${(h4.p_up * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td>{fmtPct(h4?.quantiles_pct.q50)}</td>
                    <td>
                      {h1?.crps_improvement_pct != null
                        ? `${h1.crps_improvement_pct > 0 ? "+" : ""}${h1.crps_improvement_pct.toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <section className="geo-section" style={{ marginTop: 20 }}>
        <h3 className="geo-section-title">방법론</h3>
        <ul className="meta-soft" style={{ margin: 0, paddingLeft: 18 }}>
          {(data?.methodology || []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="meta-soft" style={{ marginTop: 10 }}>
          {data?.disclaimer}
        </p>
      </section>
      </section>
    </div>
  );
}
