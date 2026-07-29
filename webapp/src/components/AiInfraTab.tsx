"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";

import type {
  AiInfraBucket,
  AiInfraCountryMetric,
  AiInfraPayload,
  AiInfraProvenance,
  AiInfraSignal,
} from "@/lib/aiInfra";

function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtNum(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "N/A";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function fmtPrice(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 100) return n.toFixed(2);
  return n.toFixed(3);
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

function chartStroke(change?: number | null): string {
  if (change == null) return "#4da3ff";
  if (change > 0.05) return "#3dd68c";
  if (change < -0.05) return "#f87171";
  return "#4da3ff";
}

function ProvenanceBadges({ p }: { p?: AiInfraProvenance | null }) {
  if (!p) return null;
  return (
    <div className="ai-infra-prov">
      <span className="ai-infra-chip cadence">{p.cadence}</span>
      {p.collected_today ? (
        <span className="ai-infra-chip collected">오늘 수집</span>
      ) : (
        <span className="ai-infra-chip">수집≠오늘</span>
      )}
      {p.newly_published_today ? (
        <span className="ai-infra-chip published">오늘 발표·관측</span>
      ) : (
        <span className="ai-infra-chip muted">오늘 신규 발표 아님</span>
      )}
      {p.revision_status === "estimated" ? (
        <span className="ai-infra-chip estimated">estimated</span>
      ) : null}
    </div>
  );
}

function ProvMeta({ p }: { p?: AiInfraProvenance | null }) {
  if (!p) return null;
  return (
    <p className="ai-infra-meta">
      {p.source_name}
      {p.unit ? ` · ${p.unit}` : ""}
      {p.observed_at ? ` · observed ${p.observed_at}` : ""}
      {p.period_end ? ` · period_end ${p.period_end}` : ""}
      {` · fetched ${new Date(p.fetched_at).toLocaleString("ko-KR", { hour12: false })}`}
    </p>
  );
}

function Spark({ signal }: { signal: AiInfraSignal }) {
  const data = signal.series || [];
  const stroke = chartStroke(signal.change_1m_pct);
  const gradId = `aiInfra-${signal.id}`;
  if (data.length < 2) {
    return <div className="esg-theme-spark-empty">—</div>;
  }
  return (
    <div className="esg-theme-spark">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{
              background: "#141d2b",
              border: "1px solid #2b3648",
              borderRadius: 8,
              color: "#e8eef5",
              fontSize: 11,
            }}
            formatter={(v: number) => [fmtPrice(Number(v)), "종가"]}
            labelFormatter={(l) => String(l)}
          />
          <Area
            type="monotone"
            dataKey="close"
            stroke={stroke}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function SignalCard({ signal }: { signal: AiInfraSignal }) {
  return (
    <div className="esg-theme-signal">
      <div className="esg-theme-signal-top">
        <strong>{signal.label}</strong>
        <code>{signal.symbol}</code>
      </div>
      <div className="esg-theme-signal-price">{fmtPrice(signal.price)}</div>
      <div className="esg-theme-signal-chgs">
        <span className={retClass(signal.change_1d_pct)}>
          1D {fmtPct(signal.change_1d_pct)}
        </span>
        <span className={retClass(signal.change_1m_pct)}>
          1M {fmtPct(signal.change_1m_pct)}
        </span>
        {signal.excess_1m_vs_spy != null ? (
          <span className={retClass(signal.excess_1m_vs_spy)}>
            vs SPY {fmtPct(signal.excess_1m_vs_spy)}
          </span>
        ) : null}
      </div>
      <Spark signal={signal} />
      <p className="esg-theme-thesis">{signal.thesis}</p>
      <ProvenanceBadges p={signal.provenance} />
      {signal.error ? <p className="empty warn">{signal.error}</p> : null}
    </div>
  );
}

function BucketCard({ bucket }: { bucket: AiInfraBucket }) {
  return (
    <article className="esg-pillar rank-1">
      <header className="esg-pillar-head">
        <div className="esg-pillar-titles">
          <h3 className="esg-pillar-title">{bucket.title}</h3>
          <p className="esg-pillar-en">{bucket.title_en}</p>
        </div>
      </header>
      <p className="esg-pillar-blurb">{bucket.blurb}</p>
      <div className="esg-theme-signal-grid">
        {bucket.signals.map((s) => (
          <SignalCard key={s.id} signal={s} />
        ))}
      </div>
    </article>
  );
}

function AnnualTable({ metrics }: { metrics: AiInfraCountryMetric[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, AiInfraCountryMetric[]>();
    for (const m of metrics) {
      const key = m.metric_ko;
      const list = map.get(key) || [];
      list.push(m);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [metrics]);

  if (!metrics.length) {
    return <p className="empty">연간 전력 지표 N/A</p>;
  }

  return (
    <div className="ai-infra-annual">
      {groups.map(([title, rows]) => (
        <article key={title} className="ai-infra-panel">
          <h4>{title}</h4>
          <p className="ai-infra-meta">
            {rows[0]?.metric} · {rows[0]?.unit}
          </p>
          <ProvenanceBadges p={rows[0]?.provenance} />
          <ProvMeta p={rows[0]?.provenance} />
          <div className="ai-infra-table-wrap">
            <table className="ai-infra-table">
              <thead>
                <tr>
                  <th>국가</th>
                  <th>period_end</th>
                  <th>값</th>
                  <th>YoY</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.entity}-${r.metric}`}>
                    <td>
                      {r.entity_ko}
                      <span className="ai-infra-en"> {r.entity}</span>
                    </td>
                    <td>{r.period_end || "N/A"}</td>
                    <td>{fmtNum(r.value)}</td>
                    <td className={retClass(r.yoy_pct)}>{fmtPct(r.yoy_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function AiInfraTab() {
  const [data, setData] = useState<AiInfraPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai-infra", { cache: "no-store" });
      const json = (await res.json()) as AiInfraPayload;
      setData(json);
    } catch (exc) {
      setData({
        ok: false,
        generated_at: new Date().toISOString(),
        note: "",
        timezone_display: "Asia/Seoul",
        daily: {
          buckets: [],
          power_stress_proxy: {
            value: null,
            label: "Power Stress Proxy",
            note: "",
            provenance: {
              cadence: "daily",
              source_name: "n/a",
              fetched_at: new Date().toISOString(),
              collected_today: true,
              newly_published_today: false,
            },
          },
        },
        annual: { metrics: [], note: "" },
        roadmap: [],
        error: exc instanceof Error ? exc.message : "로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const collectedCount = useMemo(() => {
    if (!data?.ok) return { collected: 0, published: 0 };
    let collected = 0;
    let published = 0;
    for (const b of data.daily.buckets) {
      for (const s of b.signals) {
        if (s.provenance?.collected_today) collected += 1;
        if (s.provenance?.newly_published_today) published += 1;
      }
    }
    for (const m of data.annual.metrics) {
      if (m.provenance.collected_today) collected += 1;
      if (m.provenance.newly_published_today) published += 1;
    }
    return { collected, published };
  }, [data]);

  return (
    <div className="esg-themes-tab ai-infra-tab">
      <div className="kr-hero esg-themes-hero">
        <div>
          <h2 className="kr-hero-title">AI 인프라 · Energy Transition</h2>
          <p className="kr-hero-sub">
            AI·데이터센터 수요가 전력·그리드·탄소에 미치는 신호를 갱신주기별로 구분합니다.
            오늘 수집한 값과 오늘 새로 발표·관측된 값을 섞지 않습니다.
          </p>
        </div>
        <div className="kr-hero-actions">
          <button type="button" className="ghost-btn" onClick={() => void load()}>
            {loading ? "갱신 중…" : "새로고침"}
          </button>
        </div>
      </div>

      <div className="ai-infra-summary">
        <div className="ai-infra-summary-card">
          <strong>오늘 수집</strong>
          <span>{collectedCount.collected} series</span>
          <em>fetched_at = 오늘(KST)</em>
        </div>
        <div className="ai-infra-summary-card">
          <strong>오늘 신규 발표·관측</strong>
          <span>{collectedCount.published} series</span>
          <em>observed/published = 오늘(KST)</em>
        </div>
        <div className="ai-infra-summary-card">
          <strong>표시 시간대</strong>
          <span>Asia/Seoul</span>
          <em>저장·비교는 UTC ISO</em>
        </div>
      </div>

      {loading && !data ? <p className="empty">AI 인프라 시그널 불러오는 중…</p> : null}
      {data && !data.ok ? (
        <p className="empty warn">{data.error || "로드 실패"}</p>
      ) : null}

      {data?.ok ? (
        <>
          <section className="ai-infra-section">
            <div className="esg-carbon-support-head">
              <div>
                <h3 className="esg-carbon-support-title">일간 · Daily market</h3>
                <p className="esg-carbon-support-sub">
                  Yahoo 일봉 프록시. observed_at은 마지막 거래일, fetched_at은 수집 시각입니다.
                </p>
              </div>
            </div>

            <article className="ai-infra-panel stress">
              <h4>{data.daily.power_stress_proxy.label}</h4>
              <div className={`ai-infra-stress-val ${retClass(data.daily.power_stress_proxy.value)}`}>
                {data.daily.power_stress_proxy.value == null
                  ? "N/A"
                  : fmtPct(data.daily.power_stress_proxy.value)}
              </div>
              <p className="esg-theme-thesis">{data.daily.power_stress_proxy.note}</p>
              <ProvenanceBadges p={data.daily.power_stress_proxy.provenance} />
              <ProvMeta p={data.daily.power_stress_proxy.provenance} />
            </article>

            <ol className="esg-pillar-list">
              {data.daily.buckets.map((b) => (
                <li key={b.id}>
                  <BucketCard bucket={b} />
                </li>
              ))}
            </ol>

            {data.daily.carbon_etf ? (
              <article className="esg-pillar rank-2">
                <header className="esg-pillar-head">
                  <div className="esg-pillar-titles">
                    <h3 className="esg-pillar-title">탄소시장 일간 프록시</h3>
                    <p className="esg-pillar-en">Carbon ETF (KRBN) · KAU는 ESG시황 참고</p>
                  </div>
                </header>
                <div className="esg-theme-signal-grid">
                  <SignalCard signal={data.daily.carbon_etf} />
                </div>
              </article>
            ) : null}
          </section>

          <section className="ai-infra-section">
            <div className="esg-carbon-support-head">
              <div>
                <h3 className="esg-carbon-support-title">연간 · Annual electricity (Ember via OWID)</h3>
                <p className="esg-carbon-support-sub">{data.annual.note}</p>
              </div>
            </div>
            <AnnualTable metrics={data.annual.metrics} />
          </section>

          <section className="ai-infra-section">
            <div className="esg-carbon-support-head">
              <div>
                <h3 className="esg-carbon-support-title">로드맵 · 실제 갱신주기 보존</h3>
                <p className="esg-carbon-support-sub">
                  월간 Ember API, 분기 CapEx, NGFS 등은 주기에 맞게 추가합니다. 없는 값은
                  보간하지 않고 N/A·planned로 둡니다.
                </p>
              </div>
            </div>
            <div className="ai-infra-roadmap">
              {data.roadmap.map((item) => (
                <article key={item.id} className={`ai-infra-panel status-${item.status}`}>
                  <h4>
                    {item.title}
                    <span className="ai-infra-en"> · {item.title_en}</span>
                  </h4>
                  <div className="ai-infra-prov">
                    <span className="ai-infra-chip cadence">{item.cadence}</span>
                    <span className={`ai-infra-chip status-${item.status}`}>{item.status}</span>
                  </div>
                  <p className="esg-theme-thesis">{item.note}</p>
                  <p className="ai-infra-meta">{item.preferred_sources.join(" · ")}</p>
                </article>
              ))}
            </div>
          </section>

          <p className="kr-foot esg-themes-foot">
            {data.note}
            {data.generated_at
              ? ` · ${new Date(data.generated_at).toLocaleString("ko-KR", {
                  hour12: false,
                })}`
              : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}
