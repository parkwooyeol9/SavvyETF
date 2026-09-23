"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  AreaChart,
  Legend,
} from "recharts";

import type {
  AssetForecast,
  HorizonForecast,
  MinuteForecastAssetId,
  MinuteForecastPayload,
} from "@/lib/minuteForecast";
import type {
  AssetRegimePanel,
  CryptoRegimePayload,
  RegimeStats,
} from "@/lib/cryptoRegimeStudy";

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
        {h.signal_note}
        {h.size_mult != null && h.size_mult !== 1
          ? ` · 사이즈×${h.size_mult.toFixed(2)}`
          : ""}
        {h.regime_label_ko ? ` · ${h.regime_label_ko}` : ""}
        {h.regime_vol_pct != null
          ? ` σ=${h.regime_vol_pct.toFixed(3)}%`
          : ""}{" "}
        · 가격{" "}
        {asset.price != null
          ? asset.price.toLocaleString("en-US", {
              maximumFractionDigits: asset.price >= 100 ? 1 : 3,
            })
          : "—"}{" "}
        · 봉 시각 {fmtWhen(asset.as_of)}
      </p>
      {h.regime_sizing_note ? (
        <p className="meta-soft" style={{ marginTop: 4, fontSize: "0.85em" }}>
          {h.regime_sizing_note}
        </p>
      ) : null}

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
              <th>모델비중</th>
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
              <td>{h.model_weight_pct}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="minutepred-charts">
        <div>
          <h4 className="geo-section-title" style={{ fontSize: "0.95rem" }}>
            수익률 PDF ({horizonId})
          </h4>
          <p className="meta-soft" style={{ marginTop: 0, marginBottom: 6 }}>
            근거: {h.basis_pdf}
          </p>
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
          <p className="meta-soft" style={{ marginTop: 0, marginBottom: 6 }}>
            근거: {h.basis_path}
          </p>
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

const REGIME_STROKE: Record<string, string> = {
  asia: "#5b9fd4",
  us: "#e8c547",
  weekend: "#c97b84",
};

function RegimeVolBars({ regimes }: { regimes: RegimeStats[] }) {
  const data = useMemo(
    () =>
      regimes.map((r) => ({
        name: r.label_ko.replace(/\(.*\)/, "").trim(),
        vol: Number(r.vol_pct.toFixed(4)),
        fill: REGIME_STROKE[r.id] || "#8b9bb4",
      })),
    [regimes],
  );
  const maxVol = Math.max(...data.map((d) => d.vol), 1e-6);

  return (
    <div style={{ width: "100%", height: 160 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2b3648" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: "#8b9bb4", fontSize: 11 }}
            axisLine={{ stroke: "#2b3648" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#8b9bb4", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${v.toFixed(2)}%`}
            width={48}
            domain={[0, maxVol * 1.15]}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`${v.toFixed(4)}%`, "σ"]}
          />
          <Bar
            dataKey="vol"
            name="σ"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RegimeOverlayChart({
  regimes,
}: {
  regimes: RegimeStats[];
}) {
  const rows = useMemo(() => {
    // Densities share one KDE axis — zip by index / identical x_pct.
    const first = regimes.find((r) => r.density.length > 0);
    if (!first) return [];
    return first.density.map((p, i) => {
      const row: Record<string, number | null> = { x: p.x_pct };
      for (const reg of regimes) {
        const pt = reg.density[i];
        row[reg.id] =
          pt && Math.abs(pt.x_pct - p.x_pct) < 1e-6
            ? pt.density
            : reg.density.find((d) => Math.abs(d.x_pct - p.x_pct) < 1e-6)
                ?.density ?? null;
      }
      return row;
    });
  }, [regimes]);

  if (!rows.length) {
    return <p className="empty">분포 곡선 데이터 없음</p>;
  }

  return (
    <div style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2b3648" />
          <XAxis
            dataKey="x"
            tick={{ fill: "#8b9bb4", fontSize: 11 }}
            tickFormatter={(v: number) => `${Number(v).toFixed(2)}%`}
            minTickGap={28}
          />
          <YAxis hide domain={[0, 1.08]} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(l: number) => `5m 로그수익 ${Number(l).toFixed(3)}%`}
            formatter={(v: number, name: string) => [
              Number(v).toFixed(3),
              name,
            ]}
          />
          <Legend />
          {regimes.map((r) => (
            <Area
              key={r.id}
              type="basis"
              dataKey={r.id}
              name={r.label_ko}
              stroke={REGIME_STROKE[r.id]}
              fill={REGIME_STROKE[r.id]}
              fillOpacity={0.12}
              strokeWidth={2.25}
              connectNulls
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 3 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function RegimeAssetBlock({ asset }: { asset: AssetRegimePanel }) {
  const maxVolId = useMemo(() => {
    let best: RegimeStats | null = null;
    for (const r of asset.regimes) {
      if (!best || r.vol_pct > best.vol_pct) best = r;
    }
    return best?.id ?? null;
  }, [asset.regimes]);

  const peerMed = useMemo(() => {
    const vols = asset.regimes.map((r) => r.vol_pct).filter((v) => v > 0);
    if (!vols.length) return 0;
    const s = [...vols].sort((a, b) => a - b);
    return s[Math.floor((s.length - 1) / 2)]!;
  }, [asset.regimes]);

  if (asset.error) {
    return (
      <section className="geo-section">
        <h4 className="geo-section-title">
          {asset.symbol} · {asset.label}
        </h4>
        <p className="empty">{asset.error}</p>
      </section>
    );
  }

  return (
    <section className="geo-section">
      <h4 className="geo-section-title">
        {asset.symbol} · {asset.label}
        <span className="meta-soft">
          {" "}
          · {asset.source}
          {asset.lookback_days != null ? ` · ${asset.lookback_days}d` : ""}
          {asset.bars_used ? ` · ${asset.bars_used.toLocaleString()} bars` : ""}
        </span>
      </h4>
      <p className="meta-soft">{asset.summary_ko}</p>

      <div className="regime-study-charts">
        <div>
          <p className="meta-soft" style={{ marginTop: 0, marginBottom: 4 }}>
            레짐별 5분 σ (%)
          </p>
          <RegimeVolBars regimes={asset.regimes} />
        </div>
        <div>
          <p className="meta-soft" style={{ marginTop: 0, marginBottom: 4 }}>
            수익률 PDF (공통축 KDE · 피크=1)
          </p>
          <RegimeOverlayChart regimes={asset.regimes} />
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>레짐</th>
              <th>n</th>
              <th>σ</th>
              <th>σ 대비</th>
              <th>평균</th>
              <th>P(↑)</th>
              <th>왜도</th>
              <th>첨도*</th>
              <th>q05</th>
              <th>q95</th>
            </tr>
          </thead>
          <tbody>
            {asset.regimes.map((r) => {
              const rel = peerMed > 0 ? r.vol_pct / peerMed : 1;
              const hot = r.id === maxVolId;
              return (
                <tr
                  key={r.id}
                  style={
                    hot
                      ? { background: "rgba(232, 197, 71, 0.08)" }
                      : undefined
                  }
                >
                  <td>
                    <strong
                      style={{
                        borderLeft: `3px solid ${REGIME_STROKE[r.id]}`,
                        paddingLeft: 8,
                      }}
                    >
                      {r.label_ko}
                      {hot ? " · 최고 σ" : ""}
                    </strong>
                  </td>
                  <td>{r.n_bars.toLocaleString()}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmtNum(r.vol_pct, 4)}%
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {peerMed > 0 ? `×${rel.toFixed(2)}` : "—"}
                  </td>
                  <td>{fmtPct(r.mean_ret_pct, 4)}</td>
                  <td>{(r.p_up * 100).toFixed(0)}%</td>
                  <td>{fmtNum(r.skew, 2)}</td>
                  <td>{fmtNum(r.kurtosis_excess, 2)}</td>
                  <td>{fmtPct(r.q05_pct, 3)}</td>
                  <td>{fmtPct(r.q95_pct, 3)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CryptoRegimeStudySection() {
  const [data, setData] = useState<CryptoRegimePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [assetId, setAssetId] = useState<"btc" | "eth">("btc");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/crypto-regime");
        const json = (await res.json()) as CryptoRegimePayload;
        if (cancelled) return;
        setData(json);
        if (!json.ok) setError(json.error || "레짐 분석 실패");
      } catch (exc) {
        if (!cancelled) {
          setError(exc instanceof Error ? exc.message : String(exc));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected =
    data?.assets.find((a) => a.id === assetId) || data?.assets[0] || null;

  return (
    <section className="geo-section" style={{ marginTop: 28 }}>
      <h3 className="geo-section-title">레짐별 BTC·ETH 분포 연구</h3>
      <p className="macro-subhead">
        아시아장 · 미국장 · 주말에서 5분 수익률 분포·변동성이 어떻게 갈리는지
        비교합니다. (단기예측 사이징과 동일 레짐 정의)
      </p>
      {loading ? <p className="empty">레짐 분석 불러오는 중…</p> : null}
      {error ? <p className="empty warn">{error}</p> : null}

      {!loading && data?.assets?.length ? (
        <div className="chip-row" style={{ marginBottom: 10 }}>
          {data.assets.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`chip ${assetId === a.id ? "active" : ""}`}
              onClick={() => setAssetId(a.id)}
            >
              {a.id === "btc" ? "BTC" : "ETH"}
            </button>
          ))}
        </div>
      ) : null}

      {selected ? <RegimeAssetBlock key={selected.id} asset={selected} /> : null}

      {data?.methodology?.length ? (
        <details style={{ marginTop: 10 }}>
          <summary className="meta-soft" style={{ cursor: "pointer" }}>
            방법론 · 레짐 정의
          </summary>
          <ul className="meta-soft" style={{ marginTop: 8, paddingLeft: 18 }}>
            {data.methodology.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>
              첨도* = 초과첨도(정규=0). PDF는 레짐 공통 x축 Gaussian KDE(피크
              정규화). 교육·연구용.
            </li>
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export default function MinuteForecastTab() {
  const [data, setData] = useState<MinuteForecastPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [assetId, setAssetId] = useState<MinuteForecastAssetId>("btc");
  const [horizon, setHorizon] = useState<"1h" | "4h">("1h");
  const [cooldown, setCooldown] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/minute-forecast");
      const json = (await res.json()) as MinuteForecastPayload;
      setData(json);
      setCooldown(json.cooldown_remaining_sec || 0);
      if (!json.ok && json.error) setError(json.error);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const update = useCallback(async () => {
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch("/api/minute-forecast", { method: "POST" });
      const json = (await res.json()) as MinuteForecastPayload;
      setData(json);
      setCooldown(json.cooldown_remaining_sec || 0);
      if (!res.ok || !json.ok) {
        setError(json.error || "계산 실패");
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setUpdating(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  const selected =
    data?.assets.find((a) => a.id === assetId) || data?.assets[0] || null;

  const updateDisabled = updating || cooldown > 0;

  return (
    <div className="geo-tab macro-tab">
      <section className="feature-block">
      <div className="feature-head geo-head-row">
        <div>
          <h2 className="feature-title">단기예측</h2>
          <p className="macro-subhead">
            BTC · GLD · WTI 5분봉 → 다음 1시간/4시간 수익률 PDF·경로 추정
            (walk-forward 분위수 회귀 · EWMA 보정)
          </p>
        </div>
        <button
          type="button"
          className="ghost-btn"
          disabled={updateDisabled}
          onClick={() => void update()}
        >
          {updating
            ? "계산 중…"
            : cooldown > 0
              ? `대기 ${cooldown}s`
              : "업데이트"}
        </button>
      </div>

      <p className="macro-schedule">
        {data?.generated_at
          ? `계산 시각 ${fmtWhen(data.generated_at)}${data.cached ? " (캐시)" : ""}`
          : null}
        {data?.as_of_note ? ` · ${data.as_of_note}` : null}
        {" · "}재계산은 2분마다 가능
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

      <CryptoRegimeStudySection />
      </section>
    </div>
  );
}
