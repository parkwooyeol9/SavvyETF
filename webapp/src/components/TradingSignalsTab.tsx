"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  AssetSignal,
  CryptoIndicator,
  SignalAction,
  TradingSignalsPayload,
} from "@/lib/tradingSignals";

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtNum(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtPp(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}pp`;
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

function signalClass(s: SignalAction): string {
  if (s === "buy") return "up";
  if (s === "sell") return "down";
  return "flat";
}

function stressLevel(score: number): "cool" | "warm" | "hot" {
  if (score >= 55) return "hot";
  if (score >= 35) return "warm";
  return "cool";
}

function SignalTable({
  rows,
  showRs = true,
}: {
  rows: AssetSignal[];
  showRs?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>자산</th>
            <th>시그널</th>
            <th>점수</th>
            <th>가격</th>
            <th>1D</th>
            <th>5D</th>
            <th>20D</th>
            {showRs ? <th>vs SPY 20D</th> : null}
            <th>드라이버</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.symbol}</strong>
                <div className="meta-soft">{r.label}</div>
              </td>
              <td className={signalClass(r.signal)}>
                <strong>{r.signal_ko}</strong>
                <div className="meta-soft">{r.signal.toUpperCase()}</div>
              </td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.score}</td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtNum(r.price, r.price != null && r.price >= 1000 ? 1 : 2)}
              </td>
              <td className={retClass(r.change_1d_pct)}>
                {fmtPct(r.change_1d_pct)}
              </td>
              <td className={retClass(r.change_5d_pct)}>
                {fmtPct(r.change_5d_pct)}
              </td>
              <td className={retClass(r.change_20d_pct)}>
                {fmtPct(r.change_20d_pct)}
              </td>
              {showRs ? (
                <td className={retClass(r.excess_20d_vs_spy)}>
                  {fmtPp(r.excess_20d_vs_spy)}
                </td>
              ) : null}
              <td className="meta-soft">
                {(r.drivers || []).slice(0, 2).join(" · ") || "—"}
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={showRs ? 9 : 8} className="empty">
                데이터 없음
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function CryptoIndicatorGrid({ items }: { items: CryptoIndicator[] }) {
  return (
    <div className="macro-snap-grid macro-snap-grid-wide">
      {items.map((c) => (
        <article key={c.id} className="macro-snap-card">
          <span className="macro-snap-label">{c.label}</span>
          <strong className={`macro-snap-value ${c.tone || "flat"}`}>
            {c.display}
          </strong>
          <em className="macro-snap-sub">{c.note || "—"}</em>
        </article>
      ))}
    </div>
  );
}

export default function TradingSignalsTab() {
  const [data, setData] = useState<TradingSignalsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trading-signals", { cache: "no-store" });
      const json = (await res.json()) as TradingSignalsPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="geo-tab macro-tab">
      <section className="feature-block">
        <div className="feature-head geo-head-row">
          <div>
            <h2 className="feature-title">트레이딩 시그널</h2>
            <p className="macro-subhead">
              SPY · QQQ · 섹터 · 테마 · 금/은 · BTCUSDT.P — 룰 기반 Buy/Hold/Sell
            </p>
          </div>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void load()}
            disabled={loading}
          >
            새로고침
          </button>
        </div>

        {loading && !data ? (
          <p className="empty">시그널 불러오는 중…</p>
        ) : null}
        {error ? <p className="empty warn">{error}</p> : null}

        {data ? (
          <>
            <p className="macro-schedule">{data.schedule_note}</p>

            <div className="geo-composite macro-stress">
              <div
                className="geo-score-ring"
                data-level={stressLevel(data.risk.score)}
              >
                <span className="geo-score-num">{data.risk.score}</span>
                <span className="geo-score-label">리스크</span>
              </div>
              <div className="geo-composite-body">
                <h3>
                  {data.risk.regime_ko}{" "}
                  <span className="macro-regime-en">{data.risk.regime}</span>
                </h3>
                <ul>
                  {data.risk.drivers.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                <p className="meta-soft">
                  as of {data.as_of || "—"} · VIX {fmtNum(data.risk.vix, 1)} ·
                  HY OAS {fmtNum(data.risk.hy_oas)}% · SPY 20D{" "}
                  {fmtPct(data.risk.spy_20d_pct)} · 섹터 SMA20 상회{" "}
                  {data.risk.breadth_above_sma20 != null
                    ? `${data.risk.breadth_above_sma20}%`
                    : "—"}
                </p>
              </div>
            </div>

            {(data.methodology || []).length ? (
              <section className="geo-section" style={{ marginTop: 16 }}>
                <h3 className="geo-section-title">시그널 근거</h3>
                <ul className="panel-sub">
                  {data.methodology.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {(data.summary || []).length ? (
              <section className="geo-section" style={{ marginTop: 16 }}>
                <h3 className="geo-section-title">한줄 요약</h3>
                <ul className="panel-sub">
                  {data.summary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="geo-section geo-featured" style={{ marginTop: 18 }}>
              <h3 className="geo-section-title">코어 · 금속</h3>
              <p className="geo-thesis">
                추세(SMA) · 모멘텀 · 변동성 · 매크로 오버레이로 Buy/Hold/Sell
              </p>
              <SignalTable rows={data.core} showRs />
            </section>

            <section className="geo-section geo-featured" style={{ marginTop: 18 }}>
              <h3 className="geo-section-title">섹터 로테이션</h3>
              <p className="geo-thesis">
                SPDR XL* · 20D excess vs SPY 기준 정렬 · 상대강도 반영 시그널
              </p>
              <SignalTable rows={data.sectors} />
            </section>

            <section className="geo-section geo-featured" style={{ marginTop: 18 }}>
              <h3 className="geo-section-title">테마 모멘텀</h3>
              <p className="geo-thesis">
                반도체·바이오·사이버·로봇/AI·ARK 등 테마 ETF
              </p>
              <SignalTable rows={data.themes} />
            </section>

            <section className="geo-section geo-featured" style={{ marginTop: 24 }}>
              <h3 className="geo-section-title">암호화폐 · BTCUSDT.P</h3>
              <p className="geo-thesis">
                퍼프 가격 시그널 + 시장 참여자가 매일 보는 주요 지표 (테더
                도미넌스 · L/S · 펀딩 · OI · 유동성)
              </p>
              {data.crypto?.signal ? (
                <SignalTable rows={[data.crypto.signal]} showRs={false} />
              ) : (
                <p className="empty">BTCUSDT.P 시그널 없음</p>
              )}
              {data.crypto?.indicators?.length ? (
                <div style={{ marginTop: 14 }}>
                  <CryptoIndicatorGrid items={data.crypto.indicators} />
                </div>
              ) : null}
              {data.crypto?.bias_note || data.crypto?.interpretations?.length ? (
                <div style={{ marginTop: 16 }}>
                  <h4 className="geo-section-title" style={{ fontSize: "1rem" }}>
                    현재 데이터 해석
                  </h4>
                  {data.crypto.bias_note ? (
                    <p className="geo-thesis" style={{ marginBottom: 8 }}>
                      {data.crypto.bias_note}
                    </p>
                  ) : null}
                  {(data.crypto.interpretations || []).length ? (
                    <ul className="panel-sub">
                      {data.crypto.interpretations.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="meta-soft" style={{ marginTop: 8 }}>
                    휴리스틱 해석입니다. OI·L/S·펀딩의 “높다/낮다”는 절대 수준·최근
                    감각 기준이며, 투자 권유가 아닙니다.
                  </p>
                </div>
              ) : null}
              {data.crypto?.source_note ? (
                <p className="meta-soft" style={{ marginTop: 10 }}>
                  {data.crypto.source_note}
                </p>
              ) : null}
            </section>

            <p className="meta-soft" style={{ marginTop: 16 }}>
              {data.disclaimer}
            </p>
            <p className="meta-soft">
              갱신{" "}
              {new Date(data.generated_at).toLocaleString("ko-KR", {
                hour12: false,
              })}{" "}
              · {data.note}
            </p>
          </>
        ) : null}
      </section>
    </div>
  );
}
