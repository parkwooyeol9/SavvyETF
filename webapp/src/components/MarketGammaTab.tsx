"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  GAMMA_FAMILIES,
  catalogById,
  fmtGexAxis,
  fmtGexUsd,
  type GammaFamily,
  type GammaMarketId,
  type GammaPayload,
  type GammaStrikeBar,
} from "@/lib/marketGamma";

function fmtPx(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: n >= 1000 ? 0 : digits,
  });
}

function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtOi(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.02) return "up";
  if (n < -0.02) return "down";
  return "flat";
}

function gexClass(n?: number | null): string {
  if (n == null || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function strikeLabel(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function GexTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: GammaStrikeBar }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;
  return (
    <div className="deriv-tt">
      <strong>행사가 {strikeLabel(d.strike)}</strong>
      <div>순 GEX {fmtGexUsd(d.gex)}</div>
      <div>콜 {fmtGexUsd(d.call_gex)}</div>
      <div>풋 {fmtGexUsd(d.put_gex)}</div>
      <div>
        OI 콜 {fmtOi(d.call_oi)} · 풋 {fmtOi(d.put_oi)}
      </div>
    </div>
  );
}

function CurveTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { spot: number; gex: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;
  return (
    <div className="deriv-tt">
      <strong>가정 현물 {fmtPx(d.spot, 1)}</strong>
      <div>순 GEX {fmtGexUsd(d.gex)}</div>
    </div>
  );
}

export default function MarketGammaTab() {
  const [family, setFamily] = useState<GammaFamily>("spx");
  const [marketId, setMarketId] = useState<GammaMarketId>("spx");
  const [data, setData] = useState<GammaPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (id: GammaMarketId) => {
    setLoading(true);
    setData((prev) => (prev?.market?.id === id ? prev : null));
    try {
      const res = await fetch(`/api/market-gamma?market=${id}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as GammaPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setError(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(marketId);
    const id = window.setInterval(() => void load(marketId), 180_000);
    return () => window.clearInterval(id);
  }, [load, marketId]);

  const familyIds = useMemo(
    () => GAMMA_FAMILIES.find((f) => f.id === family)?.ids || ["spx"],
    [family],
  );

  const snap = data?.market ?? null;

  const strikeTicks = useMemo(() => {
    const rows = snap?.strikes || [];
    if (rows.length <= 8) return rows.map((r) => r.strike);
    const step = Math.ceil(rows.length / 7);
    return rows.filter((_, i) => i % step === 0).map((r) => r.strike);
  }, [snap]);

  function selectFamily(next: GammaFamily) {
    setFamily(next);
    const first = GAMMA_FAMILIES.find((f) => f.id === next)?.ids[0] || "spx";
    setMarketId(first);
  }

  return (
    <div className="geo-tab macro-tab deriv-tab gamma-tab">
      <section className="feature-block">
        <div className="feature-head geo-head-row">
          <div>
            <h2 className="feature-title">Gamma · 딜러 감마 익스포저</h2>
            <p className="macro-subhead">
              시장 감마(GEX)는 풋 OI 그 자체가 아니라, 옵션 딜러가 1% 움직임시
              헤지해야 하는 달러 규모입니다. 숏 감마 구간에서 하락이 헤지 매도를
              부르는 압력이 됩니다.
            </p>
          </div>
          <div className="chip-row geo-range-chips" role="group" aria-label="기초 시장">
            {GAMMA_FAMILIES.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`chip ${family === f.id ? "active" : ""}`}
                onClick={() => selectFamily(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {familyIds.length > 1 ? (
          <div className="chip-row geo-range-chips" role="group" aria-label="옵션 상품">
            {familyIds.map((id) => {
              const meta = catalogById(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`chip ${marketId === id ? "active" : ""}`}
                  onClick={() => setMarketId(id)}
                >
                  {meta.label} · {meta.product.split(" · ")[0]}
                </button>
              );
            })}
          </div>
        ) : null}

        {loading && !data ? (
          <p className="empty">옵션 체인으로 감마를 계산하는 중…</p>
        ) : null}
        {error ? <p className="empty warn">{error}</p> : null}

        {data ? (
          <p className="macro-schedule">
            {data.note} ·{" "}
            {new Date(data.generated_at).toLocaleString("ko-KR", { hour12: false })}
            {loading ? " · 갱신 중" : ""}
          </p>
        ) : null}

        {snap ? (
          <>
            <div className="geo-composite macro-stress">
              <div
                className="geo-score-ring"
                data-level={
                  snap.regime === "short" ? "hot" : snap.regime === "long" ? "cool" : "warm"
                }
              >
                <span className={`geo-score-num ${gexClass(snap.net_gex)}`}>
                  {fmtGexUsd(snap.net_gex, 1)}
                </span>
                <span className="geo-score-label">순 GEX</span>
              </div>
              <div className="geo-composite-body">
                <h3>
                  {snap.regime_ko}{" "}
                  <span className="macro-regime-en">{snap.regime_en}</span>
                </h3>
                <p className="gamma-product">
                  {snap.product} · {snap.symbol} {fmtPx(snap.spot)}{" "}
                  <em className={retClass(snap.change_pct)}>{fmtPct(snap.change_pct)}</em>
                  {snap.iv30 != null ? ` · IV30 ${snap.iv30.toFixed(1)}%` : ""}
                </p>
                <ul>
                  {snap.drivers.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="macro-snap-grid gamma-kpi-grid">
              <article className="macro-snap-card">
                <span className="macro-snap-label">콜 GEX</span>
                <strong className="macro-snap-value up">{fmtGexUsd(snap.call_gex)}</strong>
                <em className="macro-snap-sub">딜러 롱콜 가정</em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">풋 GEX</span>
                <strong className="macro-snap-value down">{fmtGexUsd(snap.put_gex)}</strong>
                <em className="macro-snap-sub">딜러 숏풋 가정</em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">0–1일물</span>
                <strong className={`macro-snap-value ${gexClass(snap.zero_dte_gex)}`}>
                  {fmtGexUsd(snap.zero_dte_gex)}
                </strong>
                <em className="macro-snap-sub">당일 헤지 압력</em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">7일 이내</span>
                <strong className={`macro-snap-value ${gexClass(snap.near_gex)}`}>
                  {fmtGexUsd(snap.near_gex)}
                </strong>
                <em className="macro-snap-sub">근월물 합</em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">제로감마</span>
                <strong className="macro-snap-value">{fmtPx(snap.flip, 0)}</strong>
                <em className="macro-snap-sub">
                  {snap.flip != null
                    ? `현물 대비 ${fmtPct(((snap.spot - snap.flip) / snap.flip) * 100)}`
                    : "교차점 없음"}
                </em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">풋월 / 콜월</span>
                <strong className="macro-snap-value">
                  {fmtPx(snap.put_wall, 0)} / {fmtPx(snap.call_wall, 0)}
                </strong>
                <em className="macro-snap-sub">
                  풋/콜 OI {snap.put_call_oi != null ? snap.put_call_oi.toFixed(2) : "—"}
                </em>
              </article>
            </div>

            <section className="geo-section">
              <h3 className="geo-section-title">행사가별 GEX</h3>
              <p className="meta-soft">
                현물 ±10% · 양수(녹)는 콜 감마가 우세, 음수(적)는 풋 감마가 우세.
                막대는 딜러가 그 행사가 부근에서 사고팔 헤지 규모입니다.
              </p>
              <div className="gamma-chart">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={snap.strikes} barCategoryGap="12%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#243049" />
                    <XAxis
                      dataKey="strike"
                      ticks={strikeTicks}
                      tickFormatter={strikeLabel}
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={fmtGexAxis}
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                      width={56}
                    />
                    <Tooltip content={<GexTooltip />} />
                    <ReferenceLine y={0} stroke="#64748b" />
                    <Bar dataKey="gex" maxBarSize={18}>
                      {snap.strikes.map((row) => (
                        <Cell
                          key={row.strike}
                          fill={
                            row.near_spot
                              ? "#38bdf8"
                              : row.gex >= 0
                                ? "#34d399"
                                : "#f87171"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <div className="gamma-split">
              <section className="geo-section">
                <h3 className="geo-section-title">제로감마 곡선</h3>
                <p className="meta-soft">
                  현물 ±8%에서 블랙숄즈 감마를 다시 합산합니다. 0을 통과하는 지점이
                  플립 레벨입니다. 스큐 이동은 반영하지 않습니다.
                </p>
                <div className="gamma-chart">
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={snap.curve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#243049" />
                      <XAxis
                        dataKey="spot"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tickFormatter={(v) => fmtPx(Number(v), 0)}
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                      />
                      <YAxis
                        tickFormatter={fmtGexAxis}
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        width={56}
                      />
                      <Tooltip content={<CurveTooltip />} />
                      <ReferenceLine y={0} stroke="#64748b" />
                      {snap.flip != null ? (
                        <ReferenceLine
                          x={snap.flip}
                          stroke="#fbbf24"
                          strokeDasharray="4 4"
                        />
                      ) : null}
                      <ReferenceLine x={snap.spot} stroke="#38bdf8" strokeDasharray="3 3" />
                      <Line
                        type="monotone"
                        dataKey="gex"
                        stroke="#a78bfa"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="geo-section">
                <h3 className="geo-section-title">만기 구간</h3>
                <p className="meta-soft">
                  0DTE·주간물은 감마가 크고, 원월물은 OI는 커도 일중 헤지 충격은
                  작습니다.
                </p>
                <div className="gamma-chart">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={snap.dte_buckets}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#243049" />
                      <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                      <YAxis
                        tickFormatter={fmtGexAxis}
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        width={56}
                      />
                      <Tooltip
                        formatter={(value) => fmtGexUsd(Number(value))}
                        contentStyle={{
                          background: "#121b2d",
                          border: "1px solid #243049",
                          borderRadius: 8,
                        }}
                      />
                      <ReferenceLine y={0} stroke="#64748b" />
                      <Bar dataKey="gex" maxBarSize={42}>
                        {snap.dte_buckets.map((row) => (
                          <Cell
                            key={row.id}
                            fill={row.gex >= 0 ? "#34d399" : "#f87171"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </div>

            <section className="geo-section">
              <h3 className="geo-section-title">주요 행사가</h3>
              <div className="deriv-table-wrap">
                <table className="deriv-table">
                  <thead>
                    <tr>
                      <th>행사가</th>
                      <th>순 GEX</th>
                      <th>콜 GEX</th>
                      <th>풋 GEX</th>
                      <th>콜 OI</th>
                      <th>풋 OI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.top_strikes.map((row) => (
                      <tr key={row.strike}>
                        <td>{strikeLabel(row.strike)}</td>
                        <td className={gexClass(row.gex)}>{fmtGexUsd(row.gex)}</td>
                        <td className="up">{fmtGexUsd(row.call_gex)}</td>
                        <td className="down">{fmtGexUsd(row.put_gex)}</td>
                        <td>{fmtOi(row.call_oi)}</td>
                        <td>{fmtOi(row.put_oi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="meta-soft">
                {snap.contracts_used.toLocaleString("en-US")}개 계약 사용 · 체인{" "}
                {snap.contracts_raw.toLocaleString("en-US")}개
                {snap.as_of ? ` · 체인 시각 ${snap.as_of}` : ""}
              </p>
            </section>

            <section className="geo-section gamma-explain">
              <h3 className="geo-section-title">정의와 산식</h3>
              <p>
                흔히 말하는 “풋이 쌓이면 매도가 매도를 부른다”는{" "}
                <strong>숏 감마 국면</strong>의 설명에 가깝습니다. 풋 미결제약정은
                입력이고, 시장 감마는 그 계약을 ATM·만기 근처 감마로 가중해 딜러
                헤지 금액으로 바꾼 값입니다.
              </p>
              <p>
                계약별 GEX = Γ × OI × 승수(100) × S² × 0.01. 콜은 +, 풋은 −로 두고
                전 체인을 합산합니다. 고객이 헤지용 풋을 사고 콜을 파는 경향을 전제로
                딜러를 롱콜/숏풋으로 두는 관례이며, 실제 북은 관측되지 않습니다.
              </p>
              <p>
                순 GEX &gt; 0 (롱 감마): 딜러가 하락 때 사고 상승 때 팔아 변동성을
                줄입니다. 순 GEX &lt; 0 또는 현물이 제로감마 아래 (숏 감마): 딜러가
                하락 때 더 팔아 추세를 키울 수 있습니다.
              </p>
            </section>
          </>
        ) : null}
      </section>
    </div>
  );
}
