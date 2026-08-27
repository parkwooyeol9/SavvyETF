"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  ExtraMetric,
  ExtraMetricUnit,
  EtfMarketStructurePayload,
  EtfMarketStructureRegion,
  RegionId,
} from "@/lib/etfMarketStructure";

const tooltipStyle = {
  background: "#121b2d",
  border: "1px solid #243049",
  borderRadius: 8,
  color: "#e8eef5",
};

function fmtUsd(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtInt(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

function fmtExtra(unit: ExtraMetricUnit, n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (unit === "usd") return fmtUsd(n);
  if (unit === "pct") return fmtPct(n);
  if (unit === "ratio") return `${n.toFixed(1)}×`;
  return fmtInt(n);
}

function maxOf(metric: ExtraMetric): number {
  return Math.max(
    0,
    ...Object.values(metric.values).filter((v): v is number => v != null && v > 0),
  );
}

export default function EtfMarketStructurePanel() {
  const [data, setData] = useState<EtfMarketStructurePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<RegionId>("us");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/etf-market-structure", { cache: "no-store" });
      const json = (await res.json()) as EtfMarketStructurePayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setError(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const regions = data?.regions || [];
  const region = regions.find((r) => r.id === active) || regions[0];

  const chartAum = useMemo(
    () =>
      regions.map((r) => ({
        name: r.name_ko,
        aum_tn: r.aum_usd != null ? r.aum_usd / 1e12 : null,
        fill: r.color,
      })),
    [regions],
  );

  const chartPen = useMemo(
    () =>
      regions.map((r) => ({
        name: r.name_ko,
        pen: r.equity_etf_to_mcap_pct,
        fill: r.color,
      })),
    [regions],
  );

  return (
    <section className="geo-section geo-featured etf-ms" style={{ marginTop: 28 }}>
      <div className="kr-hero">
        <div>
          <h2 className="kr-hero-title">국가별 ETF 시장 구조</h2>
          <p className="kr-hero-sub">
            위 패널(미국 상장 국가·브로드 ETF 편입)과 별개로, 각 권역 유가증권시장에
            <strong> 상장된 ETF</strong>의 종목 수·AUM(달러)·시총 대비 침투율을 비교합니다.
            대상은 미국·중국·일본·한국·유럽 5개 권역.
          </p>
        </div>
        <div className="kr-hero-actions">
          <button type="button" className="ghost-btn" disabled={loading} onClick={() => void load()}>
            {loading ? "불러오는 중…" : "새로고침"}
          </button>
        </div>
      </div>
      <p className="meta-soft">
        {data?.generated_at
          ? new Date(data.generated_at).toLocaleString("ko-KR", { hour12: false })
          : loading
            ? "집계 중…"
            : ""}
        {data?.fx.usdkrw ? ` · USD/KRW ${data.fx.usdkrw.toFixed(1)}` : ""}
        {data?.fx.usdjpy ? ` · USD/JPY ${data.fx.usdjpy.toFixed(1)}` : ""}
        {data?.fx.usdcny ? ` · USD/CNY ${data.fx.usdcny.toFixed(2)}` : ""}
      </p>
      {error ? <p className="empty">{error}</p> : null}

      {!regions.length && !loading ? (
        <p className="empty">시장 구조 데이터가 없습니다.</p>
      ) : (
        <>
          <div className="etf-ms-chips">
            {regions.map((r) => (
              <button
                key={r.id}
                type="button"
                className={active === r.id ? "us-pf-chip us-pf-chip-active" : "us-pf-chip"}
                onClick={() => setActive(r.id)}
              >
                <strong>{r.name_ko}</strong>
                <span className="meta-soft">{r.live ? "실시간" : r.as_of || ""}</span>
              </button>
            ))}
          </div>

          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="data-table etf-ms-table">
              <thead>
                <tr>
                  <th>권역</th>
                  <th className="num">ETF 수</th>
                  <th className="num">ETF AUM</th>
                  <th className="num">유가증권 시총</th>
                  <th className="num">주식ETF/시총</th>
                  <th className="num">전체AUM/시총</th>
                </tr>
              </thead>
              <tbody>
                {!regions.length ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      {loading ? "…" : "—"}
                    </td>
                  </tr>
                ) : (
                  regions.map((r) => (
                    <tr
                      key={r.id}
                      className={active === r.id ? "etf-ms-row-active" : undefined}
                      onClick={() => setActive(r.id)}
                    >
                      <td>
                        <span className="etf-ms-dot" style={{ background: r.color }} />
                        <strong>{r.name_ko}</strong>
                        {r.live ? <span className="etf-ms-live">LIVE</span> : null}
                      </td>
                      <td className="num">{fmtInt(r.etf_count)}</td>
                      <td className="num">
                        <strong>{fmtUsd(r.aum_usd)}</strong>
                      </td>
                      <td className="num">{fmtUsd(r.equity_mcap_usd)}</td>
                      <td className="num">
                        <strong>{fmtPct(r.equity_etf_to_mcap_pct)}</strong>
                      </td>
                      <td className="num">{fmtPct(r.aum_to_mcap_pct)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="meta-soft" style={{ marginTop: 6 }}>
            AUM은 달러 환산. <strong>주식ETF/시총</strong>이 침투율의 본지표입니다 (주식형만
            분자). 전체AUM/시총은 채권·상품 ETF를 포함한 규모 비교용입니다.
          </p>

          <div className="etf-ms-charts">
            <div>
              <h4 className="geo-section-title">상장 ETF AUM (달러)</h4>
              <div className="etf-ms-chart">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartAum} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="name" tick={{ fill: "#93a4c3", fontSize: 11 }} />
                    <YAxis
                      tick={{ fill: "#93a4c3", fontSize: 11 }}
                      tickFormatter={(v) => `$${Number(v).toFixed(1)}T`}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v) => [`$${Number(v ?? 0).toFixed(2)}T`, "AUM"]}
                    />
                    <Bar dataKey="aum_tn" radius={[4, 4, 0, 0]}>
                      {chartAum.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <h4 className="geo-section-title">주식 ETF AUM / 유가증권 시총</h4>
              <div className="etf-ms-chart">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartPen} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                    <XAxis dataKey="name" tick={{ fill: "#93a4c3", fontSize: 11 }} />
                    <YAxis
                      tick={{ fill: "#93a4c3", fontSize: 11 }}
                      tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v) => [`${Number(v ?? 0).toFixed(2)}%`, "침투율"]}
                    />
                    <Bar dataKey="pen" radius={[4, 4, 0, 0]}>
                      {chartPen.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <h3 className="geo-section-title" style={{ marginTop: 20 }}>
            추가로 볼 시장구조 지표
          </h3>
          <p className="meta-soft">
            종목 수·AUM·침투율 외에, 파편화·자산구성·파생형·액티브 전환·발행사 과점을
            같이 봐야 구조가 보입니다.
          </p>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="data-table etf-ms-table">
              <thead>
                <tr>
                  <th>지표</th>
                  {regions.map((r) => (
                    <th key={r.id} className="num">
                      {r.name_ko}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.extras || []).map((m) => (
                  <ExtraRow key={m.id} metric={m} regions={regions} />
                ))}
              </tbody>
            </table>
          </div>

          {region ? (
            <div className="etf-ms-spot">
              <h3 className="geo-section-title">
                {region.name_ko} 구조 포인트
                <span className="meta-soft"> · {region.exchanges}</span>
              </h3>
              <p className="meta-soft">{region.source}</p>
              <div className="etf-ms-spot-grid">
                {region.spotlight.map((s) => (
                  <article key={s.title} className="us-snap">
                    <span className="meta-soft">{s.title}</span>
                    <p>{s.body}</p>
                  </article>
                ))}
                <article className="us-snap">
                  <span className="meta-soft">한 줄 요약</span>
                  <p>
                    ETF {fmtInt(region.etf_count)}종 · AUM {fmtUsd(region.aum_usd)} · 주식형{" "}
                    {fmtPct(region.equity_etf_share_pct)} · 시총 대비 주식ETF{" "}
                    {fmtPct(region.equity_etf_to_mcap_pct)}
                    {region.avg_aum_usd != null ? ` · 평균 ${fmtUsd(region.avg_aum_usd)}` : ""}
                  </p>
                </article>
              </div>
            </div>
          ) : null}

          {data?.methodology?.length ? (
            <ul className="etf-ms-notes">
              {data.methodology.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

function ExtraRow({
  metric,
  regions,
}: {
  metric: ExtraMetric;
  regions: EtfMarketStructureRegion[];
}) {
  const peak = maxOf(metric) || 1;
  return (
    <tr>
      <td>
        <strong>{metric.label}</strong>
        <div className="meta-soft">{metric.hint}</div>
      </td>
      {regions.map((r) => {
        const v = metric.values[r.id];
        const w = v != null && v > 0 ? Math.max(4, Math.min(100, (100 * v) / peak)) : 0;
        return (
          <td key={r.id} className="num">
            {fmtExtra(metric.unit, v)}
            {v != null && v > 0 ? (
              <span
                className="etf-ms-mini-bar"
                style={{ width: `${w}%`, background: r.color }}
              />
            ) : null}
          </td>
        );
      })}
    </tr>
  );
}
