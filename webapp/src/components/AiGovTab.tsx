"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";

import type {
  AiGovBucket,
  AiGovPayload,
  AiGovSignal,
} from "@/lib/aiGov";

function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
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

function Spark({ signal }: { signal: AiGovSignal }) {
  const data = signal.series || [];
  const stroke = chartStroke(signal.change_1m_pct);
  const gradId = `aiGov-${signal.id}`;
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

function BucketCard({ bucket }: { bucket: AiGovBucket }) {
  return (
    <article className={`esg-pillar rank-${bucket.rank}`} data-rank={bucket.rank}>
      <header className="esg-pillar-head">
        <div className="esg-pillar-rank" aria-label={`우선순위 ${bucket.rank}`}>
          {bucket.rank}
        </div>
        <div className="esg-pillar-titles">
          <h3 className="esg-pillar-title">{bucket.title}</h3>
          <p className="esg-pillar-en">{bucket.title_en}</p>
        </div>
      </header>

      <p className="esg-pillar-blurb">{bucket.blurb}</p>

      <div className="esg-theme-signal-grid">
        {bucket.signals.map((s) => (
          <div key={s.id} className="esg-theme-signal">
            <div className="esg-theme-signal-top">
              <strong>{s.label}</strong>
              <code>{s.symbol}</code>
            </div>
            <div className="esg-theme-signal-price">{fmtPrice(s.price)}</div>
            <div className="esg-theme-signal-chgs">
              <span className={retClass(s.change_1d_pct)}>
                1D {fmtPct(s.change_1d_pct)}
              </span>
              <span className={retClass(s.change_1m_pct)}>
                1M {fmtPct(s.change_1m_pct)}
              </span>
            </div>
            <Spark signal={s} />
            <p className="esg-theme-thesis">{s.thesis}</p>
            {s.error ? <p className="empty warn">{s.error}</p> : null}
          </div>
        ))}
      </div>
    </article>
  );
}

export default function AiGovTab() {
  const [data, setData] = useState<AiGovPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai-gov", { cache: "no-store" });
      const json = (await res.json()) as AiGovPayload;
      setData(json);
    } catch (exc) {
      setData({
        ok: false,
        generated_at: new Date().toISOString(),
        note: "",
        buckets: [],
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

  return (
    <div className="esg-themes-tab ai-gov-tab">
      <div className="kr-hero esg-themes-hero">
        <div>
          <h2 className="kr-hero-title">AI 거버넌스 · Transformation</h2>
          <p className="kr-hero-sub">
            AI 기회(인프라·반도체)와 신뢰(사이버·소프트웨어) 시장 프록시를 모아 봅니다.
            전력·기후·DART 기업 거버넌스는 ESG시황 탭을 그대로 유지합니다.
          </p>
        </div>
        <div className="kr-hero-actions">
          <button type="button" className="ghost-btn" onClick={() => void load()}>
            {loading ? "갱신 중…" : "새로고침"}
          </button>
        </div>
      </div>

      {loading && !data ? <p className="empty">AI 시그널 불러오는 중…</p> : null}
      {data && !data.ok ? (
        <p className="empty warn">{data.error || "로드 실패"}</p>
      ) : null}

      {data?.ok ? (
        <>
          <ol className="esg-pillar-list">
            {data.buckets.map((b) => (
              <li key={b.id}>
                <BucketCard bucket={b} />
              </li>
            ))}
          </ol>
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

      <section className="esg-carbon-support">
        <div className="esg-carbon-support-head">
          <div>
            <h3 className="esg-carbon-support-title">다음 단계 (미연동)</h3>
            <p className="esg-carbon-support-sub">
              DART AI·개인정보·보안 공시 스크린, AI기본법 이벤트, 주간 거버넌스 브리프는
              별도 슬롯으로 추가할 예정입니다. 기존 ESG/지정학 브리프 저장소는 건드리지
              않습니다.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
