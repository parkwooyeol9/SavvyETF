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
  AiGovHeadline,
  AiGovPayload,
  AiGovPolicyEvent,
  AiGovScreenPayload,
  AiGovSignal,
} from "@/lib/aiGov";
import { AI_POLICY_CALENDAR } from "@/lib/aiGov";
import type {
  AiInfraCountryMetric,
  AiInfraPayload,
  AiInfraProvenance,
  AiInfraSignal,
} from "@/lib/aiInfra";

type ProxySignal = {
  id: string;
  symbol: string;
  label: string;
  thesis: string;
  price: number | null;
  change_1d_pct: number | null;
  change_1m_pct: number | null;
  excess_1m_vs_spy?: number | null;
  series?: Array<{ date: string; close: number }>;
  provenance?: AiInfraProvenance;
  error?: string;
};

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

function headlineText(h: AiGovHeadline): string {
  return (h.headline || h.title || "").trim();
}

function enrichPolicy(events?: AiGovPolicyEvent[]): AiGovPolicyEvent[] {
  const base = events?.length ? events : AI_POLICY_CALENDAR;
  const today = new Date().toISOString().slice(0, 10);
  return base.map((e) => {
    if (e.days_from_today != null && e.status) return e;
    const days = Math.round(
      (Date.parse(e.date) - Date.parse(today)) / (24 * 3600 * 1000),
    );
    return {
      ...e,
      days_from_today: days,
      status: days < 0 ? "past" : days === 0 ? "today" : "upcoming",
    };
  });
}

function asProxy(s: AiGovSignal | AiInfraSignal): ProxySignal {
  return {
    id: s.id,
    symbol: s.symbol,
    label: s.label,
    thesis: s.thesis,
    price: s.price,
    change_1d_pct: s.change_1d_pct,
    change_1m_pct: s.change_1m_pct,
    excess_1m_vs_spy: "excess_1m_vs_spy" in s ? s.excess_1m_vs_spy : undefined,
    series: s.series,
    provenance: "provenance" in s ? s.provenance : undefined,
    error: s.error,
  };
}

function Spark({ signal }: { signal: ProxySignal }) {
  const data = signal.series || [];
  const stroke = chartStroke(signal.change_1m_pct);
  const gradId = `infra-${signal.id}`;
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

function SignalCard({ signal }: { signal: ProxySignal }) {
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
      {signal.error ? <p className="empty warn">{signal.error}</p> : null}
    </div>
  );
}

function ProxyColumn({
  title,
  en,
  blurb,
  accent,
  signals,
}: {
  title: string;
  en: string;
  blurb: string;
  accent: "power" | "stack" | "trust";
  signals: ProxySignal[];
}) {
  return (
    <article className={`infra-col accent-${accent}`}>
      <header>
        <h3>{title}</h3>
        <p className="esg-pillar-en">{en}</p>
      </header>
      <p className="esg-pillar-blurb">{blurb}</p>
      <div className="esg-theme-signal-grid">{signals.map((s) => (
        <SignalCard key={s.id} signal={s} />
      ))}</div>
    </article>
  );
}

function AnnualTable({ metrics }: { metrics: AiInfraCountryMetric[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, AiInfraCountryMetric[]>();
    for (const m of metrics) {
      const list = map.get(m.metric_ko) || [];
      list.push(m);
      map.set(m.metric_ko, list);
    }
    return [...map.entries()];
  }, [metrics]);

  if (!metrics.length) return <p className="empty">연간 전력 지표 N/A</p>;

  return (
    <div className="ai-infra-annual">
      {groups.map(([title, rows]) => (
        <article key={title} className="ai-infra-panel">
          <h4>{title}</h4>
          <p className="ai-infra-meta">
            {rows[0]?.metric}
            {rows[0]?.unit ? ` · ${rows[0].unit}` : ""}
            {rows[0]?.provenance.source_name
              ? ` · ${rows[0].provenance.source_name}`
              : ""}
          </p>
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

function ScreenPanels({
  screen,
  loading,
  onRefresh,
}: {
  screen: AiGovScreenPayload | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const policy = enrichPolicy(screen?.policy?.events);
  const dartHits = screen?.dart?.hits || [];
  const filings = screen?.sec?.filings || [];
  const headlines = [
    ...(screen?.naver?.headlines || []),
    ...(screen?.finnhub?.headlines || []),
  ].filter((h) => headlineText(h));

  const showDart = !screen?.dart?.error && dartHits.length > 0;
  const showSec = !screen?.sec?.error && filings.length > 0;
  const showNews = headlines.length > 0;

  if (!showDart && !showSec && !showNews && !policy.length) return null;

  return (
    <section className="infra-block">
      <div className="esg-carbon-support-head">
        <div>
          <h3 className="esg-carbon-support-title">거버넌스 스크린</h3>
          <p className="esg-carbon-support-sub">
            AI기본법·EU AI Act 캘린더와 수신된 공시·뉴스만 표시합니다.
          </p>
        </div>
        <button type="button" className="ghost-btn" onClick={onRefresh}>
          {loading ? "갱신 중…" : "스크린 새로고침"}
        </button>
      </div>

      <div className="ai-gov-panels">
        {showDart ? (
          <article className="ai-gov-panel">
            <h4>
              DART · AI·개인정보·보안
              {screen?.dart?.hit_count != null ? ` (${screen.dart.hit_count})` : ""}
            </h4>
            <ul className="ai-gov-list">
              {dartHits.slice(0, 8).map((h, i) => (
                <li key={`${h.rcept_no || h.report_nm}-${i}`}>
                  <span className="ai-gov-meta">
                    {h.date} · {h.corp_name}
                    {h.stock_code ? ` · ${h.stock_code}` : ""}
                  </span>
                  <span className="ai-gov-title">
                    {h.viewer ? (
                      <a href={h.viewer} target="_blank" rel="noreferrer">
                        {h.report_nm}
                      </a>
                    ) : (
                      h.report_nm
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ) : null}

        {showSec ? (
          <article className="ai-gov-panel">
            <h4>
              SEC · Cyber / Item 1.05
              {screen?.sec?.filing_count != null
                ? ` (≈${screen.sec.filing_count})`
                : ""}
            </h4>
            <ul className="ai-gov-list">
              {filings.slice(0, 8).map((f, i) => (
                <li key={`${f.company}-${f.file_date}-${i}`}>
                  <span className="ai-gov-meta">
                    {f.file_date} · {f.form}
                    {f.item_summary ? ` · ${f.item_summary}` : ""}
                  </span>
                  <span className="ai-gov-title">
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer">
                        {f.company}
                      </a>
                    ) : (
                      f.company
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ) : null}

        <article className="ai-gov-panel">
          <h4>정책 캘린더</h4>
          <ul className="ai-gov-list">
            {policy.map((e) => (
              <li key={`${e.region}-${e.date}-${e.title}`}>
                <span className="ai-gov-meta">
                  {e.date} · {e.region}
                  {e.days_from_today != null
                    ? ` · ${e.days_from_today > 0 ? "+" : ""}${e.days_from_today}d`
                    : ""}
                </span>
                <span className="ai-gov-title">{e.title}</span>
                <span className="ai-gov-note">{e.note}</span>
              </li>
            ))}
          </ul>
        </article>

        {showNews ? (
          <article className="ai-gov-panel">
            <h4>뉴스</h4>
            <ul className="ai-gov-list">
              {headlines.slice(0, 8).map((h, i) => {
                const title = headlineText(h);
                return (
                  <li key={`${title}-${i}`}>
                    <span className="ai-gov-meta">
                      {h.source || "news"}
                      {h.published || h.date ? ` · ${h.published || h.date}` : ""}
                    </span>
                    <span className="ai-gov-title">
                      {h.url ? (
                        <a href={h.url} target="_blank" rel="noreferrer">
                          {title}
                        </a>
                      ) : (
                        title
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </article>
        ) : null}
      </div>
    </section>
  );
}

export default function InfraTab() {
  const [infra, setInfra] = useState<AiInfraPayload | null>(null);
  const [gov, setGov] = useState<AiGovPayload | null>(null);
  const [screen, setScreen] = useState<AiGovScreenPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [screenLoading, setScreenLoading] = useState(true);

  const loadMarket = useCallback(async () => {
    setLoading(true);
    try {
      const [infraRes, govRes] = await Promise.all([
        fetch("/api/ai-infra"),
        fetch("/api/ai-gov"),
      ]);
      setInfra((await infraRes.json()) as AiInfraPayload);
      setGov((await govRes.json()) as AiGovPayload);
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : "로드 실패";
      setInfra({
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
        error: msg,
      });
      setGov({
        ok: false,
        generated_at: new Date().toISOString(),
        note: "",
        buckets: [],
        error: msg,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadScreen = useCallback(async () => {
    setScreenLoading(true);
    try {
      const res = await fetch("/api/ai-gov-screen");
      setScreen((await res.json()) as AiGovScreenPayload);
    } catch (exc) {
      setScreen({
        ok: false,
        generated_at: new Date().toISOString(),
        policy: { ok: true, events: AI_POLICY_CALENDAR },
        error: exc instanceof Error ? exc.message : "스크린 로드 실패",
      });
    } finally {
      setScreenLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMarket();
    void loadScreen();
    const id = window.setInterval(() => {
      void loadMarket();
      void loadScreen();
    }, 5 * 60_000);
    return () => window.clearInterval(id);
  }, [loadMarket, loadScreen]);

  const power = useMemo(
    () =>
      (infra?.daily.buckets.find((b) => b.id === "power_grid")?.signals || []).map(
        asProxy,
      ),
    [infra],
  );
  const stack = useMemo(
    () =>
      (infra?.daily.buckets.find((b) => b.id === "ai_stack")?.signals || []).map(
        asProxy,
      ),
    [infra],
  );
  const trust = useMemo(() => {
    const bucket = gov?.buckets.find((b) => b.id === "trust");
    return (bucket?.signals || [])
      .filter((s) => s.symbol !== "CIBR")
      .map(asProxy);
  }, [gov]);

  const stress = infra?.daily.power_stress_proxy;

  return (
    <div className="esg-themes-tab infra-tab">
      <div className="kr-hero esg-themes-hero">
        <div>
          <h2 className="kr-hero-title">인프라</h2>
          <p className="kr-hero-sub">
            전력·그리드·반도체 프록시와 AI 정책·공시 스크린을 한 화면에서 봅니다.
            같은 티커는 한 번만 표시합니다.
          </p>
        </div>
        <div className="kr-hero-actions">
          <button type="button" className="ghost-btn" onClick={() => void loadMarket()}>
            {loading ? "갱신 중…" : "새로고침"}
          </button>
        </div>
      </div>

      {loading && !infra && !gov ? <p className="empty">인프라 시그널 불러오는 중…</p> : null}
      {infra && !infra.ok ? (
        <p className="empty warn">{infra.error || "인프라 로드 실패"}</p>
      ) : null}

      <div className="infra-kpis">
        <article className="infra-kpi stress">
          <span className="meta-soft">{stress?.label || "Power Stress Proxy"}</span>
          <strong className={retClass(stress?.value ?? null)}>
            {stress?.value == null ? "N/A" : fmtPct(stress.value)}
          </strong>
          <em>GRID·XLU·NLR·DTCR 1M vs SPY · 추정 지표</em>
        </article>
        <article className="infra-kpi">
          <span className="meta-soft">시장 프록시</span>
          <strong>
            {power.length + stack.length + trust.length}
            <span className="infra-kpi-unit"> ETF</span>
          </strong>
          <em>전력 · AI 스택 · 사이버</em>
        </article>
        <article className="infra-kpi">
          <span className="meta-soft">연간 전력</span>
          <strong>
            {infra?.annual.metrics.length ?? 0}
            <span className="infra-kpi-unit"> 시리즈</span>
          </strong>
          <em>Ember / OWID · 보간 없음</em>
        </article>
      </div>

      <section className="infra-block">
        <h3 className="esg-carbon-support-title">시장 프록시</h3>
        <p className="esg-carbon-support-sub">
          반도체·데이터센터는 전력 스택과 한 번만 표시합니다. 사이버는 아래 공시
          스크린과 같이 보세요.
        </p>
        <div className="infra-proxy-grid">
          <ProxyColumn
            title="전력·그리드"
            en="Power & grid"
            accent="power"
            blurb="AI 전력 병목을 가격으로 보는 그리드·유틸·원자력 프록시."
            signals={power}
          />
          <ProxyColumn
            title="AI 스택"
            en="Chips & digital"
            accent="stack"
            blurb="반도체·데이터센터·AI 테마. AIQ·SMH·DTCR은 여기만 표시합니다."
            signals={stack}
          />
          <ProxyColumn
            title="신뢰·사이버"
            en="Trust & software"
            accent="trust"
            blurb="보안·기업 소프트웨어. 아래 공시 스크린과 같이 보세요."
            signals={trust}
          />
        </div>
      </section>

      {infra?.ok && infra.annual.metrics.length ? (
        <section className="infra-block">
          <h3 className="esg-carbon-support-title">연간 전력</h3>
          <p className="esg-carbon-support-sub">{infra.annual.note}</p>
          <AnnualTable metrics={infra.annual.metrics} />
        </section>
      ) : null}

      <ScreenPanels
        screen={screen}
        loading={screenLoading}
        onRefresh={() => void loadScreen()}
      />

      <p className="kr-foot esg-themes-foot">
        {infra?.note || gov?.note || "Yahoo 일봉 + Ember/OWID + 거버넌스 스크린"}
        {infra?.generated_at
          ? ` · ${new Date(infra.generated_at).toLocaleString("ko-KR", {
              hour12: false,
            })}`
          : ""}
      </p>
    </div>
  );
}
