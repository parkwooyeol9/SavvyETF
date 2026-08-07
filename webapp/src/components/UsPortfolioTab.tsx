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
  US_PORTFOLIO_UNIVERSE,
  type PortfolioTrade,
  type PriceMode,
  type SizeMode,
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

function tradeSizeLabel(t: PortfolioTrade): string {
  if (t.shares != null && t.shares > 0) return `${t.shares}주`;
  if (t.weight_pct != null && t.weight_pct > 0) return `포트 ${t.weight_pct}%`;
  if (t.notional_usd != null && t.notional_usd > 0) return fmtUsd(t.notional_usd);
  if (t.side === "sell") return "전량";
  return "—";
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
  const [sizeMode, setSizeMode] = useState<SizeMode>("notional");
  const [sizeValue, setSizeValue] = useState("10000");
  const [universeQuery, setUniverseQuery] = useState("");
  const [universeSector, setUniverseSector] = useState<string>("all");

  useEffect(() => {
    const existing = loadStoredPortfolio();
    setStore(existing || defaultStoredPortfolio());
  }, []);

  useEffect(() => {
    if (side === "buy" && sizeMode === "all") {
      setSizeMode("notional");
      setSizeValue("10000");
    }
  }, [side, sizeMode]);

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

  const filteredUniverse = useMemo(() => {
    const q = universeQuery.trim().toUpperCase();
    return US_PORTFOLIO_UNIVERSE.map((sec) => ({
      ...sec,
      names: sec.names.filter((n) => {
        if (universeSector !== "all" && sec.sector !== universeSector) return false;
        if (!q) return true;
        return (
          n.symbol.includes(q) ||
          n.name.toUpperCase().includes(q) ||
          sec.sector_ko.includes(universeQuery.trim()) ||
          sec.sector.toUpperCase().includes(q)
        );
      }),
    })).filter((sec) => sec.names.length > 0);
  }, [universeQuery, universeSector]);

  const universeCount = useMemo(
    () => US_PORTFOLIO_UNIVERSE.reduce((n, s) => n + s.names.length, 0),
    [],
  );

  const sizePlaceholder =
    sizeMode === "notional"
      ? "금액 USD"
      : sizeMode === "weight_pct"
        ? "포트폴리오 %"
        : sizeMode === "shares"
          ? "수량(주)"
          : "전량";

  const onSizeModeChange = (mode: SizeMode) => {
    setSizeMode(mode);
    if (mode === "notional") setSizeValue((v) => (v && Number(v) > 0 ? v : "10000"));
    else if (mode === "weight_pct") setSizeValue((v) => (v && Number(v) > 0 && Number(v) <= 100 ? v : "10"));
    else if (mode === "shares") setSizeValue((v) => (v && Number(v) > 0 ? v : "10"));
    else setSizeValue("");
  };

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
      shares: null,
      notional_usd: null,
      weight_pct: null,
    };

    if (sizeMode === "all") {
      if (side !== "sell") {
        setError("전량은 매도에만 사용할 수 있습니다.");
        return;
      }
    } else {
      const n = Number(sizeValue);
      if (!(n > 0)) {
        setError(
          sizeMode === "weight_pct"
            ? "포트폴리오 비중(%)을 입력하세요."
            : sizeMode === "shares"
              ? "수량을 입력하세요."
              : "금액(USD)을 입력하세요.",
        );
        return;
      }
      if (sizeMode === "weight_pct") {
        if (n > 100) {
          setError("포트폴리오 비중은 100% 이하로 입력하세요.");
          return;
        }
        trade.weight_pct = n;
      } else if (sizeMode === "shares") {
        trade.shares = n;
      } else {
        trade.notional_usd = n;
      }
    }

    const next = {
      ...store,
      trades: [...store.trades, trade],
      updated_at: new Date().toISOString(),
    };
    persist(next);
    setError(null);
  };

  const removeTrade = (id: string) => {
    if (!store) return;
    persist({
      ...store,
      trades: store.trades.filter((t) => t.id !== id),
      updated_at: new Date().toISOString(),
    });
  };

  const pickSymbol = (sym: string) => {
    setSymbol(sym);
    setError(null);
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
              로그인 없이 브라우저에 저장 · 시가/종가 편출입 · 금액·비중·수량 기준 · SPY 대비
              성과 · 텔레그램 송출용 스냅샷 준비
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

        <h3 className="geo-section-title" style={{ marginTop: 14 }}>
          매매 유니버스
        </h3>
        <p className="meta-soft">
          미국 상장 주요 {universeCount}종 · 클릭하면 티커가 선택됩니다. 목록에 없어도 직접
          입력 가능합니다.
        </p>
        <div className="us-pf-universe-toolbar">
          <input
            value={universeQuery}
            onChange={(e) => setUniverseQuery(e.target.value)}
            placeholder="티커·종목명 검색 (예: NVDA, Apple)"
          />
          <select
            value={universeSector}
            onChange={(e) => setUniverseSector(e.target.value)}
          >
            <option value="all">전체 업종</option>
            {US_PORTFOLIO_UNIVERSE.map((s) => (
              <option key={s.sector} value={s.sector}>
                {s.sector_ko}
              </option>
            ))}
          </select>
        </div>
        <div className="us-pf-universe">
          {!filteredUniverse.length ? (
            <p className="empty">검색 결과가 없습니다. 티커를 직접 입력해 주세요.</p>
          ) : (
            filteredUniverse.map((sec) => (
              <div key={sec.sector} className="us-pf-universe-sector">
                <div className="us-pf-universe-sector-label">{sec.sector_ko}</div>
                <div className="us-pf-universe-chips">
                  {sec.names.map((n) => (
                    <button
                      key={n.symbol}
                      type="button"
                      className={
                        symbol.toUpperCase() === n.symbol
                          ? "us-pf-chip us-pf-chip-active"
                          : "us-pf-chip"
                      }
                      title={n.name}
                      onClick={() => pickSymbol(n.symbol)}
                    >
                      <strong>{n.symbol}</strong>
                      <span>{n.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="us-pf-trade-form" style={{ marginTop: 14 }}>
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
          <select
            value={sizeMode}
            onChange={(e) => onSizeModeChange(e.target.value as SizeMode)}
          >
            <option value="notional">금액(USD)</option>
            <option value="weight_pct">포트폴리오 %</option>
            <option value="shares">수량(주)</option>
            {side === "sell" ? <option value="all">전량 매도</option> : null}
          </select>
          <input
            type="number"
            min={0}
            step={sizeMode === "weight_pct" ? 1 : sizeMode === "shares" ? 1 : 100}
            value={sizeValue}
            onChange={(e) => setSizeValue(e.target.value)}
            placeholder={sizePlaceholder}
            disabled={sizeMode === "all"}
          />
          <button type="button" className="tab-btn" onClick={addTrade}>
            추가
          </button>
        </div>
        <p className="meta-soft" style={{ marginTop: 6 }}>
          {sizeMode === "weight_pct"
            ? "포트폴리오 %: 해당 시점 평가액(현금+보유) 대비 비중으로 체결합니다."
            : sizeMode === "notional"
              ? "금액(USD): 시가/종가 기준으로 수량을 환산합니다."
              : sizeMode === "shares"
                ? "수량(주): 입력한 주수만큼 체결합니다."
                : "전량 매도: 해당 종목 보유분 전체를 매도합니다."}
        </p>

        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>일자</th>
                <th>종목</th>
                <th>구분</th>
                <th>가격</th>
                <th>수량/금액/비중</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!store.trades.length ? (
                <tr>
                  <td colSpan={6} className="empty">
                    유니버스에서 종목을 고르거나 티커를 입력한 뒤 편출입을 추가하세요.
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
                      <td>{tradeSizeLabel(t)}</td>
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
