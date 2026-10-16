"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
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

import {
  fmtCarbonPrice,
  fmtCarbonVol,
  fmtPct,
  type CarbonSeries,
  type EsgCarbonPayload,
} from "@/lib/esgCarbon";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

function toneClass(n?: number | null): string {
  if (n == null || Number.isNaN(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function formatMoney(
  value: number | null | undefined,
  currency: string,
  digits: number,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (currency === "KRW") return `${fmtCarbonPrice(value, 0)}원`;
  if (currency === "EUR") return `€${fmtCarbonPrice(value, digits)}`;
  return `$${fmtCarbonPrice(value, digits)}`;
}

function SeriesChart({
  series,
  priceDigits,
}: {
  series: CarbonSeries;
  priceDigits: number;
}) {
  const showVolume = series.daily.some((b) => (b.volume || 0) > 0);
  const data = useMemo(
    () =>
      series.daily.slice(-180).map((b) => ({
        t: b.date.slice(5),
        close: b.close,
        volume: b.volume,
      })),
    [series.daily],
  );

  const q = series.quote;
  const priceFmt =
    series.currency === "KRW"
      ? (v: number) => `${Math.round(v).toLocaleString("ko-KR")}`
      : (v: number) => v.toFixed(2);

  return (
    <article className="kr-card esg-carbon-card">
      <div className="kr-card-head">
        <div>
          <h3 className="kr-card-title">{series.name}</h3>
          <p className="kr-card-sub">
            {series.symbol}
            {series.unit ? ` · ${series.unit}` : ""} · {series.source}
          </p>
        </div>
        <div className={`kr-quote ${toneClass(q.change)}`}>
          <div className="kr-last">
            {formatMoney(q.last, series.currency, priceDigits)}
          </div>
          <div className="kr-chg">
            {series.currency === "KRW"
              ? `${fmtCarbonPrice(q.change, 0)} (${fmtPct(q.change_pct)})`
              : `${fmtCarbonPrice(q.change, priceDigits)} (${fmtPct(q.change_pct)})`}
          </div>
          {showVolume ? (
            <div className="kr-status">거래량 {fmtCarbonVol(q.volume)}</div>
          ) : (
            <div className="kr-status">일별 종가</div>
          )}
        </div>
      </div>

      <div className="kr-chart esg-carbon-chart">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#2b3648" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              tick={{ fill: "#8b98a8", fontSize: 11 }}
              minTickGap={28}
            />
            <YAxis
              yAxisId="price"
              tick={{ fill: "#8b98a8", fontSize: 11 }}
              tickFormatter={priceFmt}
              width={series.currency === "KRW" ? 64 : 48}
              domain={["auto", "auto"]}
            />
            {showVolume ? (
              <YAxis
                yAxisId="vol"
                orientation="right"
                tick={{ fill: "#8b98a8", fontSize: 11 }}
                tickFormatter={(v: number) => fmtCarbonVol(v)}
                width={48}
              />
            ) : null}
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: "#c5d0dc" }}
              formatter={(value: number, name: string) => {
                if (name === "종가") {
                  return [formatMoney(value, series.currency, priceDigits), name];
                }
                return [fmtCarbonVol(value), name];
              }}
            />
            <Legend wrapperStyle={{ color: "#c5d0dc", fontSize: 12 }} />
            {showVolume ? (
              <Bar
                yAxisId="vol"
                dataKey="volume"
                name="거래량"
                fill="#3d5a80"
                opacity={0.55}
                maxBarSize={10}
              />
            ) : null}
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="close"
              name="종가"
              stroke="#5eead4"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

export default function EsgCarbonTab({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const [data, setData] = useState<EsgCarbonPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/esg-carbon");
      const json = (await res.json()) as EsgCarbonPayload;
      setData(json);
    } catch (exc) {
      setData({
        ok: false,
        error: exc instanceof Error ? exc.message : "로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div className={`kr-tab esg-carbon-tab ${embedded ? "embedded" : ""}`}>
      {!embedded ? (
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">탄소배출권 모니터</h2>
            <p className="kr-hero-sub">
              국내 KAU(KRX)와 유럽 EUA(EU ETS) 종가, 원화 환산 스프레드·CBAM 함의를
              함께 봅니다.
            </p>
          </div>
          <div className="kr-hero-actions">
            <button type="button" className="ghost-btn" onClick={() => void load()}>
              새로고침
            </button>
          </div>
        </div>
      ) : (
        <div className="kr-hero-actions" style={{ marginBottom: "0.55rem" }}>
          <button type="button" className="ghost-btn" onClick={() => void load()}>
            탄소 시황 새로고침
          </button>
        </div>
      )}

      {loading && !data ? <p className="empty">탄소배출권 시황 불러오는 중…</p> : null}
      {data && !data.ok ? (
        <p className="empty">시황 로드 실패: {data.error || "unknown"}</p>
      ) : null}

      {data?.ok ? (
        <>
          {data.note ? <p className="kr-note">{data.note}</p> : null}

          <section className="esg-carbon-section">
            <div className="kr-grid-2 esg-carbon-pair">
              <div>
                <h3 className="esg-carbon-section-title">국내 배출권 (KAU)</h3>
                {data.domestic ? (
                  <SeriesChart series={data.domestic} priceDigits={0} />
                ) : (
                  <p className="empty">국내 배출권 데이터를 불러오지 못했습니다.</p>
                )}
              </div>
              <div>
                <h3 className="esg-carbon-section-title">유럽 배출권 (EUA)</h3>
                {data.european || data.global?.[0] ? (
                  <SeriesChart
                    series={(data.european || data.global?.[0])!}
                    priceDigits={2}
                  />
                ) : (
                  <p className="empty">유럽 EUA 데이터를 불러오지 못했습니다.</p>
                )}
              </div>
            </div>
          </section>

          {data.spread ? (
            <section className="esg-carbon-spread">
              <div className="esg-carbon-spread-head">
                <h3 className="esg-carbon-section-title">KAU vs EUA 스프레드</h3>
                <p className={`esg-carbon-spread-badge ${data.spread.label}`}>
                  {data.spread.label === "discount"
                    ? "디스카운트"
                    : data.spread.label === "premium"
                      ? "프리미엄"
                      : data.spread.label === "flat"
                        ? "유사"
                        : "비교 불가"}
                  {data.spread.spread_pct != null
                    ? ` · ${fmtPct(data.spread.spread_pct)}`
                    : ""}
                </p>
              </div>
              <div className="esg-carbon-spread-metrics">
                <span>
                  KAU {fmtCarbonPrice(data.spread.kau_krw, 0)}원/톤
                </span>
                <span>
                  EUA €{fmtCarbonPrice(data.spread.eua_eur, 2)}
                  {data.spread.eua_krw != null
                    ? ` ≈ ${fmtCarbonPrice(data.spread.eua_krw, 0)}원/톤`
                    : ""}
                </span>
                <span>
                  EUR/KRW {fmtCarbonPrice(data.spread.fx_eurkrw, 1)}
                </span>
                <span>
                  갭{" "}
                  {data.spread.spread_krw != null
                    ? `${fmtCarbonPrice(data.spread.spread_krw, 0)}원/톤`
                    : "—"}
                </span>
              </div>
              <p className="esg-carbon-spread-comment">{data.spread.comment}</p>
            </section>
          ) : null}

          <p className="kr-foot">
            출처: KRX ETS · Sendeco2 (EUA) · Yahoo EURKRW · 약 60초마다 갱신 ·{" "}
            {data.generated_at
              ? new Date(data.generated_at).toLocaleString("ko-KR", {
                  hour12: false,
                })
              : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}
