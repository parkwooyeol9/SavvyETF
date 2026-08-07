"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  appendHistory,
  defaultStoredPortfolio,
  formatTelegramPortfolioBrief,
  loadStoredPortfolio,
  newTradeId,
  saveStoredPortfolio,
  type PortfolioTrade,
  type PriceMode,
  type StoredUsPortfolio,
  type TradeSide,
  type UsPortfolioResult,
} from "@/lib/usPortfolio";

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

function fmtUsd(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function tone(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

export default function UsPortfolioTab() {
  const [store, setStore] = useState<StoredUsPortfolio | null>(null);
  const [result, setResult] = useState<UsPortfolioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [symbol, setSymbol] = useState("AAPL");
  const [side, setSide] = useState<TradeSide>("buy");
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [priceMode, setPriceMode] = useState<PriceMode>("close");
  const [notional, setNotional] = useState("10000");
  const [shares, setShares] = useState("");

  useEffect(() => {
    const existing = loadStoredPortfolio();
    setStore(existing || defaultStoredPortfolio());
  }, []);

  const persist = useCallback((next: StoredUsPortfolio) => {
    setStore(next);
    saveStoredPortfolio(next);
  }, []);

  const run = useCallback(
    async (s: StoredUsPortfolio) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/us-portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolio_id: s.portfolio_id,
            name: s.name,
            initial_cash: s.initial_cash,
            trades: s.trades,
          }),
        });
        const json = (await res.json()) as UsPortfolioResult;
        if (!json.ok) {
          setError(json.error || "시뮬레이션 실패");
          setResult(json);
          return;
        }
        setResult(json);
        persist(appendHistory(s, json));
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc));
      } finally {
        setLoading(false);
      }
    },
    [persist],
  );

  const addTrade = () => {
    if (!store) return;
    const sym = symbol.trim().toUpperCase();
    if (!sym || !date) return;
    const trade: PortfolioTrade = {
      id: newTradeId(),
      symbol: sym,
      side,
      date,
      price_mode: priceMode,
      shares: shares.trim() ? Number(shares) : null,
      notional_usd: !shares.trim() && notional.trim() ? Number(notional) : null,
    };
    if (!(trade.shares || trade.notional_usd)) {
      setError("수량 또는 금액(USD)을 입력하세요.");
      return;
    }
    const next = {
      ...store,
      trades: [...store.trades, trade],
      updated_at: new Date().toISOString(),
    };
    persist(next);
    setShares("");
  };

  const removeTrade = (id: string) => {
    if (!store) return;
    persist({
      ...store,
      trades: store.trades.filter((t) => t.id !== id),
      updated_at: new Date().toISOString(),
    });
  };

  const chartData = useMemo(
    () =>
      (result?.series || []).map((p) => ({
        t: p.date.slice(5),
        포트폴리오: Math.round(p.portfolio),
        SPY: Math.round(p.spy),
      })),
    [result],
  );

  const telegramPreview = result?.ok
    ? formatTelegramPortfolioBrief(result.telegram_snapshot)
    : "";

  if (!store) {
    return <p className="empty">포트폴리오 불러오는 중…</p>;
  }

  return (
    <div className="panel-stack us-pf">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">미국 주식 포트폴리오</h2>
            <p className="kr-hero-sub">
              로그인 없이 브라우저에 저장 · 시가/종가 편출입 · SPY 대비 성과 · 업종·종목
              분해 · 텔레그램 송출용 스냅샷 준비
            </p>
          </div>
          <div className="kr-hero-actions">
            <button
              type="button"
              className="ghost-btn"
              disabled={loading || !store.trades.length}
              onClick={() => void run(store)}
            >
              {loading ? "계산 중…" : "시뮬레이션 실행"}
            </button>
          </div>
        </div>
        <p className="meta-soft">
          ID {store.portfolio_id} · 누적 기록 {store.history.length}회
          {store.updated_at
            ? ` · 저장 ${new Date(store.updated_at).toLocaleString("ko-KR", {
                hour12: false,
              })}`
            : ""}
        </p>
      </section>

      <section className="geo-section" style={{ marginTop: 12 }}>
        <div className="us-pf-form">
          <label>
            포트 이름
            <input
              value={store.name}
              onChange={(e) =>
                persist({ ...store, name: e.target.value, updated_at: new Date().toISOString() })
              }
            />
          </label>
          <label>
            초기 현금 (USD)
            <input
              type="number"
              min={1000}
              step={1000}
              value={store.initial_cash}
              onChange={(e) =>
                persist({
                  ...store,
                  initial_cash: Number(e.target.value) || 0,
                  updated_at: new Date().toISOString(),
                })
              }
            />
          </label>
        </div>

        <div className="us-pf-trade-form">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="티커 AAPL"
          />
          <select value={side} onChange={(e) => setSide(e.target.value as TradeSide)}>
            <option value="buy">편입(매수)</option>
            <option value="sell">편출(매도)</option>
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <select
            value={priceMode}
            onChange={(e) => setPriceMode(e.target.value as PriceMode)}
          >
            <option value="close">종가</option>
            <option value="open">시가</option>
          </select>
          <input
            value={notional}
            onChange={(e) => setNotional(e.target.value)}
            placeholder="금액 USD"
            disabled={Boolean(shares.trim())}
          />
          <input
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="수량(선택)"
          />
          <button type="button" className="tab-btn" onClick={addTrade}>
            추가
          </button>
        </div>

        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>일자</th>
                <th>종목</th>
                <th>구분</th>
                <th>가격</th>
                <th>수량/금액</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!store.trades.length ? (
                <tr>
                  <td colSpan={6} className="empty">
                    편출입을 추가한 뒤 시뮬레이션을 실행하세요.
                  </td>
                </tr>
              ) : (
                [...store.trades]
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((t) => (
                    <tr key={t.id}>
                      <td>{t.date}</td>
                      <td>
                        <strong>{t.symbol}</strong>
                      </td>
                      <td>{t.side === "buy" ? "편입" : "편출"}</td>
                      <td>{t.price_mode === "open" ? "시가" : "종가"}</td>
                      <td>
                        {t.shares
                          ? `${t.shares}주`
                          : t.notional_usd
                            ? fmtUsd(t.notional_usd)
                            : "—"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => removeTrade(t.id)}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {result?.ok ? (
        <>
          <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
            <div className="us-pf-stats">
              <div>
                <span className="meta-soft">누적 수익률</span>
                <strong className={tone(result.cumulative_return_pct)}>
                  {fmtPct(result.cumulative_return_pct)}
                </strong>
              </div>
              <div>
                <span className="meta-soft">SPY 대비</span>
                <strong className={tone(result.excess_vs_spy_pct)}>
                  {fmtPct(result.excess_vs_spy_pct)}
                </strong>
              </div>
              <div>
                <span className="meta-soft">주간</span>
                <strong className={tone(result.week_return_pct)}>
                  {fmtPct(result.week_return_pct)}
                </strong>
              </div>
              <div>
                <span className="meta-soft">MDD</span>
                <strong>{fmtPct(result.max_drawdown_pct)}</strong>
              </div>
              <div>
                <span className="meta-soft">최종 평가액</span>
                <strong>{fmtUsd(result.final_value)}</strong>
              </div>
              <div>
                <span className="meta-soft">현금</span>
                <strong>{fmtUsd(result.cash)}</strong>
              </div>
            </div>
            <div className="kr-chart" style={{ height: 280, marginTop: 12 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                  <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={24} />
                  <YAxis
                    tick={{ fill: "#8fa3b8", fontSize: 10 }}
                    width={64}
                    tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="포트폴리오"
                    stroke="#60a5fa"
                    strokeWidth={2.2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="SPY"
                    stroke="#94a3b8"
                    strokeWidth={1.6}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
            <div className="us-pf-split">
              <div>
                <h3 className="geo-section-title">종목 성과 분해</h3>
                <AttrTable rows={result.stock_attribution} />
              </div>
              <div>
                <h3 className="geo-section-title">업종 성과 분해</h3>
                <AttrTable rows={result.sector_attribution} />
              </div>
            </div>
          </section>

          <section className="geo-section" style={{ marginTop: 16 }}>
            <h3 className="geo-section-title">텔레그램 송출 미리보기</h3>
            <p className="meta-soft">
              주간 누적·SPY 초과·업종/종목 분해가 `telegram_snapshot`으로 저장됩니다. 봇
              연동 시 이 텍스트를 그대로 보낼 수 있습니다.
            </p>
            <pre className="us-pf-tg">{telegramPreview}</pre>
          </section>

          {store.history.length ? (
            <section className="geo-section" style={{ marginTop: 16 }}>
              <h3 className="geo-section-title">누적 성과 기록 (로컬)</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>기준일</th>
                      <th>누적</th>
                      <th>주간</th>
                      <th>vs SPY</th>
                      <th>평가액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...store.history].reverse().map((h) => (
                      <tr key={h.as_of}>
                        <td>{h.as_of}</td>
                        <td className={tone(h.cumulative_return_pct)}>
                          {fmtPct(h.cumulative_return_pct)}
                        </td>
                        <td className={tone(h.week_return_pct)}>
                          {fmtPct(h.week_return_pct)}
                        </td>
                        <td className={tone(h.excess_vs_spy_pct)}>
                          {fmtPct(h.excess_vs_spy_pct)}
                        </td>
                        <td>{fmtUsd(h.final_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function AttrTable({
  rows,
}: {
  rows: Array<{
    label: string;
    weight_pct: number | null;
    return_pct: number | null;
    contribution_pct: number;
  }>;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>항목</th>
            <th className="num">비중</th>
            <th className="num">수익률</th>
            <th className="num">기여</th>
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr>
              <td colSpan={4} className="empty">
                —
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num">{fmtPct(r.weight_pct, 1)}</td>
                <td className={`num ${tone(r.return_pct)}`}>{fmtPct(r.return_pct)}</td>
                <td className={`num ${tone(r.contribution_pct)}`}>
                  {fmtPct(r.contribution_pct)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
