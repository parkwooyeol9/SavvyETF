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
  AiGovBucket,
  AiGovHeadline,
  AiGovPayload,
  AiGovPolicyEvent,
  AiGovScreenPayload,
  AiGovSignal,
} from "@/lib/aiGov";
import { AI_GOV_BRIEF_SLOTS, AI_POLICY_CALENDAR } from "@/lib/aiGov";
import type { AllBriefs, BriefSlot } from "@/lib/types";
import { emptyAllBriefs } from "@/lib/types";
import { sanitizeBriefHtml } from "@/lib/sanitizeHtml";

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

  return (
    <section className="esg-carbon-support ai-gov-screen">
      <div className="esg-carbon-support-head">
        <div>
          <h3 className="esg-carbon-support-title">거버넌스 스크린 · 멀티소스</h3>
          <p className="esg-carbon-support-sub">
            공개 소스 우선: SEC · Google News RSS · AI기본법/EU AI Act 캘린더 (API 키 불필요).
            DART/Finnhub/봇은 키가 있을 때만 보강합니다.
          </p>
        </div>
        <button type="button" className="ghost-btn" onClick={onRefresh}>
          {loading ? "갱신 중…" : "스크린 새로고침"}
        </button>
      </div>

      {screen?.error ? <p className="empty warn">{screen.error}</p> : null}
      {screen?.errors?.length ? (
        <p className="empty warn">{screen.errors.slice(0, 3).join(" · ")}</p>
      ) : null}

      <div className="ai-gov-panels">
        <article className="ai-gov-panel">
          <h4>
            DART · AI·개인정보·보안
            {screen?.dart?.hit_count != null ? ` (${screen.dart.hit_count})` : ""}
          </h4>
          {screen?.dart?.error ? (
            <p className="empty warn">{screen.dart.error}</p>
          ) : null}
          {!dartHits.length ? (
            <p className="empty">
              최근 90일 감시 유니버스(네이버·카카오·통신·반도체 등) 공시{" "}
              <em>제목</em>에 AI·개인정보·보안 키워드 매칭 없음. 사고성 공시가 없을 때
              흔하며, 아래 뉴스·SEC·정책 캘린더를 우선 보세요.
            </p>
          ) : (
            <ul className="ai-gov-list">
              {dartHits.slice(0, 12).map((h, i) => (
                <li key={`${h.rcept_no || h.report_nm}-${i}`}>
                  <span className="ai-gov-meta">
                    {h.date} · {h.corp_name}
                    {h.stock_code ? ` · ${h.stock_code}` : ""}
                    {h.matched?.length ? ` · ${h.matched.join(",")}` : ""}
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
          )}
        </article>

        <article className="ai-gov-panel">
          <h4>
            SEC · Cyber / Item 1.05
            {screen?.sec?.filing_count != null
              ? ` (≈${screen.sec.filing_count})`
              : ""}
          </h4>
          {screen?.sec?.error ? (
            <p className="empty warn">{screen.sec.error}</p>
          ) : null}
          {!filings.length ? (
            <p className="empty">최근 샘플 없음/미수신</p>
          ) : (
            <ul className="ai-gov-list">
              {filings.slice(0, 10).map((f, i) => (
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
          )}
        </article>

        <article className="ai-gov-panel">
          <h4>정책 캘린더 · AI기본법 / EU AI Act</h4>
          <ul className="ai-gov-list">
            {policy.map((e) => (
              <li key={`${e.region}-${e.date}-${e.title}`}>
                <span className="ai-gov-meta">
                  {e.date} · {e.region}
                  {e.status ? ` · ${e.status}` : ""}
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

        <article className="ai-gov-panel">
          <h4>뉴스 · Google News RSS / (선택) Finnhub·Naver</h4>
          {!headlines.length ? (
            <p className="empty">헤드라인 없음/미수신</p>
          ) : (
            <ul className="ai-gov-list">
              {headlines.slice(0, 12).map((h, i) => {
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
          )}
        </article>
      </div>

      {screen?.generated_at ? (
        <p className="kr-foot esg-themes-foot">
          {screen.note || "멀티소스 스크린"}
          {` · ${new Date(screen.generated_at).toLocaleString("ko-KR", {
            hour12: false,
          })}`}
        </p>
      ) : null}
    </section>
  );
}

function BriefSlotCards({ slots }: { slots: BriefSlot[] }) {
  if (!slots.length) {
    return (
      <section className="esg-carbon-support">
        <div className="esg-carbon-support-head">
          <div>
            <h3 className="esg-carbon-support-title">AI 거버넌스 브리프 슬롯</h3>
            <p className="esg-carbon-support-sub">
              <code>esg_ai_gov</code> · <code>esg_ai_gov_brief</code> — 텔레그램{" "}
              <code>/esg aigov</code> · <code>/esg aibrief</code> 또는 스케줄 후 채워집니다.
              기존 monitor/overview/accident/data_briefing 슬롯은 그대로입니다.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="esg-carbon-support">
      <div className="esg-carbon-support-head">
        <div>
          <h3 className="esg-carbon-support-title">AI 거버넌스 브리프 슬롯</h3>
          <p className="esg-carbon-support-sub">
            신규 슬롯만 표시합니다 (기존 ESG 슬롯 비덮어쓰기).
          </p>
        </div>
      </div>
      <div className="ai-gov-brief-grid">
        {slots.map((slot) => (
          <article key={slot.slot} className="ai-gov-panel">
            <h4>{slot.title || slot.slot}</h4>
            <p className="ai-gov-meta">
              {slot.slot}
              {slot.generated_at ? ` · ${slot.generated_at}` : ""}
            </p>
            {(slot.sections || []).slice(0, 2).map((sec, i) => (
              <div
                key={i}
                className="ai-gov-brief-body"
                dangerouslySetInnerHTML={{
                  __html: sanitizeBriefHtml(sec.html_or_text || ""),
                }}
              />
            ))}
            {!slot.sections?.length && slot.html ? (
              <div
                className="ai-gov-brief-body"
                dangerouslySetInnerHTML={{ __html: sanitizeBriefHtml(slot.html) }}
              />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export default function AiGovTab() {
  const [data, setData] = useState<AiGovPayload | null>(null);
  const [screen, setScreen] = useState<AiGovScreenPayload | null>(null);
  const [briefs, setBriefs] = useState<AllBriefs>(emptyAllBriefs());
  const [loading, setLoading] = useState(true);
  const [screenLoading, setScreenLoading] = useState(true);

  const loadRadar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai-gov");
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

  const loadScreen = useCallback(async () => {
    setScreenLoading(true);
    try {
      const res = await fetch("/api/ai-gov-screen");
      const json = (await res.json()) as AiGovScreenPayload;
      setScreen(json);
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

  const loadBriefs = useCallback(async () => {
    try {
      const res = await fetch("/api/briefs");
      const json = (await res.json()) as { ok?: boolean; briefs?: AllBriefs };
      if (json.briefs) setBriefs(json.briefs);
    } catch {
      // ignore — radar/screen still work
    }
  }, []);

  useEffect(() => {
    void loadRadar();
    void loadScreen();
    void loadBriefs();
    const id = window.setInterval(() => {
      void loadRadar();
      void loadScreen();
      void loadBriefs();
    }, 5 * 60_000);
    return () => window.clearInterval(id);
  }, [loadRadar, loadScreen, loadBriefs]);

  const aiSlots = useMemo(() => {
    const map = briefs.esg?.slots || {};
    return AI_GOV_BRIEF_SLOTS.map((key) => map[key]).filter(Boolean) as BriefSlot[];
  }, [briefs]);

  return (
    <div className="esg-themes-tab ai-gov-tab">
      <div className="kr-hero esg-themes-hero">
        <div>
          <h2 className="kr-hero-title">AI 거버넌스 · Transformation</h2>
          <p className="kr-hero-sub">
            AI 기회(인프라·반도체)와 신뢰(사이버·소프트웨어) 시장 프록시, DART/SEC/뉴스·규제
            스크린을 함께 봅니다. 전력·기후·기존 DART 거버넌스는 ESG시황 탭을 유지합니다.
          </p>
        </div>
        <div className="kr-hero-actions">
          <button type="button" className="ghost-btn" onClick={() => void loadRadar()}>
            {loading ? "갱신 중…" : "레이더 새로고침"}
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

      <ScreenPanels
        screen={screen}
        loading={screenLoading}
        onRefresh={() => void loadScreen()}
      />

      <BriefSlotCards slots={aiSlots} />
    </div>
  );
}
