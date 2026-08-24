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
  PoliEtfQuote,
  PoliPipelineFund,
  PoliThemesPayload,
} from "@/lib/poliThemes";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
  fontSize: 11,
};

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
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

function chartStroke(change?: number | null, party?: string): string {
  if (change != null && change > 0.05) return "#3dd68c";
  if (change != null && change < -0.05) return "#f87171";
  if (party === "D") return "#7eb6ff";
  if (party === "R") return "#f19797";
  return "#4da3ff";
}

function Spark({ quote }: { quote: PoliEtfQuote }) {
  const data = quote.series || [];
  const stroke = chartStroke(quote.change_1m_pct, quote.party);
  const gradId = `poli-${quote.id}`;
  if (data.length < 2) {
    return <div className="poli-spark-empty">—</div>;
  }
  return (
    <div className="poli-spark">
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
            contentStyle={tooltipStyle}
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

function EtfCard({ quote }: { quote: PoliEtfQuote }) {
  return (
    <article className="poli-etf-card" data-party={quote.party.toLowerCase()}>
      <header>
        <div>
          <em>{quote.theme}</em>
          <h4>{quote.name_ko}</h4>
          <span>{quote.issuer || quote.name}</span>
        </div>
        <code>{quote.symbol}</code>
      </header>
      <div className="poli-etf-px">
        <strong>{fmtPrice(quote.price)}</strong>
        <span className={retClass(quote.change_1d_pct)}>
          1D {fmtPct(quote.change_1d_pct)}
        </span>
        <span className={retClass(quote.change_1m_pct)}>
          1M {fmtPct(quote.change_1m_pct)}
        </span>
        <span className={retClass(quote.vs_spy_1m_pct)}>
          vs SPY {fmtPct(quote.vs_spy_1m_pct)}
        </span>
      </div>
      <Spark quote={quote} />
      <p>{quote.thesis}</p>
      {quote.expense ? <small>보수 {quote.expense}</small> : null}
      {quote.error ? <p className="empty warn">{quote.error}</p> : null}
    </article>
  );
}

function partyLabel(party: PoliPipelineFund["party"]): string {
  if (party === "D") return "민주";
  if (party === "R") return "공화";
  return "양당";
}

export default function PoliThemesTab() {
  const [data, setData] = useState<PoliThemesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/poli-themes", { cache: "no-store" });
      const json = (await res.json()) as PoliThemesPayload;
      if (!res.ok || json.ok === false) {
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
    void load();
    const id = window.setInterval(() => void load(), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const basketsD = (data?.baskets || []).filter((b) => b.party === "D");
  const basketsR = (data?.baskets || []).filter((b) => b.party === "R");
  const listedPipeline = (data?.pipeline || []).filter((p) => p.listed);
  const pendingPipeline = (data?.pipeline || []).filter((p) => !p.listed);

  return (
    <div className="poli-tab">
      <section className="feature-block">
        <div className="feature-head geo-head-row">
          <div>
            <h2 className="feature-title">정치테마상품</h2>
            <p className="feature-lead">
              미국 상장 ETF 중 민주당·공화당 수혜로 분류되는 바스켓과 업종 프록시,
              그리고 SEC 심사 중인 정치베팅(예측시장) ETF.
            </p>
          </div>
          <button type="button" className="ghost-btn" onClick={() => void load()}>
            {loading ? "갱신 중…" : "새로고침"}
          </button>
        </div>

        {loading && !data ? <p className="empty">시세 불러오는 중…</p> : null}
        {error ? <p className="empty warn">{error}</p> : null}
        {data?.warnings?.map((w) => (
          <p key={w} className="empty warn">
            {w}
          </p>
        ))}

        {data ? (
          <div className="poli-spread-grid">
            <article>
              <span>NANC − KRUZ 1M</span>
              <strong
                className={retClass(data.nanc_kruz_1m_spread)}
                data-party={
                  (data.nanc_kruz_1m_spread ?? 0) >= 0 ? "d" : "r"
                }
              >
                {fmtPct(data.nanc_kruz_1m_spread)}
              </strong>
              <em>의원 매매 바스켓 스프레드</em>
            </article>
            <article>
              <span>DEMZ − MAGA 1M</span>
              <strong
                className={retClass(data.demz_maga_1m_spread)}
                data-party={
                  (data.demz_maga_1m_spread ?? 0) >= 0 ? "d" : "r"
                }
              >
                {fmtPct(data.demz_maga_1m_spread)}
              </strong>
              <em>PAC 기부 바스켓 스프레드</em>
            </article>
            <article>
              <span>SPY 1M</span>
              <strong className={retClass(data.spy_change_1m_pct)}>
                {fmtPct(data.spy_change_1m_pct)}
              </strong>
              <em>벤치마크</em>
            </article>
          </div>
        ) : null}
      </section>

      {data?.baskets?.length ? (
        <section className="geo-section">
          <h3 className="geo-section-title">정당 바스켓 ETF</h3>
          <p className="meta-soft">
            의원 STOCK Act 공시 복제(NANC·KRUZ)와 기업 PAC 기부 지수(DEMZ·MAGA).
          </p>
          <div className="poli-party-cols">
            <div>
              <h4 data-party="d">민주당</h4>
              <div className="poli-etf-grid">
                {basketsD.map((q) => (
                  <EtfCard key={q.id} quote={q} />
                ))}
              </div>
            </div>
            <div>
              <h4 data-party="r">공화당</h4>
              <div className="poli-etf-grid">
                {basketsR.map((q) => (
                  <EtfCard key={q.id} quote={q} />
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {data ? (
        <section className="geo-section">
          <h3 className="geo-section-title">정책 수혜 업종</h3>
          <p className="meta-soft">
            정당 전용 ETF는 아니지만, 중간선거·입법 결과에 따라 수혜·피해가 갈리는
            업종 프록시. vs SPY는 1개월 초과수익.
          </p>
          <div className="poli-party-cols">
            <div>
              <h4 data-party="d">민주 정책 민감</h4>
              <div className="poli-etf-grid">
                {data.sectors_d.map((q) => (
                  <EtfCard key={q.id} quote={q} />
                ))}
              </div>
            </div>
            <div>
              <h4 data-party="r">공화 정책 민감</h4>
              <div className="poli-etf-grid">
                {data.sectors_r.map((q) => (
                  <EtfCard key={q.id} quote={q} />
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {data?.pipeline?.length ? (
        <section className="geo-section">
          <h3 className="geo-section-title">정치베팅 ETF 파이프라인</h3>
          <p className="meta-soft">
            Roundhill·Bitwise·GraniteShares가 2026년 2월 제출한 예측시장 ETF.
            Kalshi 등 CFTC 이벤트 계약을 브로커 계좌로 담는 상품으로, 패배 시 원금
            거의 전액 손실. 2026년 5월 자동효력이 SEC 자료 요청으로 멈춘 상태.
            상장되면 이 표에 시세가 붙습니다.
          </p>
          {listedPipeline.length ? (
            <p className="empty">상장 감지 {listedPipeline.length}건 — 시세 표시</p>
          ) : null}
          <div className="poli-pipe-table-wrap">
            <table className="poli-pipe-table">
              <thead>
                <tr>
                  <th>발행</th>
                  <th>티커</th>
                  <th>상품</th>
                  <th>선거</th>
                  <th>상태</th>
                  <th>구조</th>
                </tr>
              </thead>
              <tbody>
                {pendingPipeline.concat(listedPipeline).map((row) => (
                  <tr key={row.id} data-party={row.party.toLowerCase()}>
                    <td>{row.issuer}</td>
                    <td>
                      <code>{row.ticker || "TBD"}</code>
                      {row.listed && row.price != null ? (
                        <div className="poli-pipe-px">
                          {fmtPrice(row.price)}{" "}
                          <span className={retClass(row.change_1d_pct)}>
                            {fmtPct(row.change_1d_pct)}
                          </span>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <strong>{row.name_ko}</strong>
                      <div className="meta-soft">
                        {partyLabel(row.party)} · {row.exchange}
                      </div>
                    </td>
                    <td>
                      {row.race_ko}
                      <div className="meta-soft">{row.election_date}</div>
                    </td>
                    <td>
                      <em className={`poli-status status-${row.status}`}>
                        {row.status_ko}
                      </em>
                      {row.target_launch ? (
                        <div className="meta-soft">{row.target_launch}</div>
                      ) : null}
                    </td>
                    <td>
                      {row.mechanic}
                      <div className="meta-soft">{row.note}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data ? (
        <p className="meta-soft midterm-footnote">
          {data.note}
          {data.generated_at
            ? ` · ${new Date(data.generated_at).toLocaleString("ko-KR", {
                timeZone: "Asia/Seoul",
                hour12: false,
              })} KST`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
