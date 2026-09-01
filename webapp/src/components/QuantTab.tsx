"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  QUANT_METHODOLOGY,
  QUANT_RANGES,
  QUANT_WINDOWS,
  parseQuantTicker,
  type QuantPayload,
  type QuantRange,
  type QuantSnapshot,
} from "@/lib/quantDesk";

function fmtPx(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(4);
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}

function tone(n?: number | null): string {
  if (n == null || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function ChartTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { label: string; close?: number; rsi?: number; dd?: number; vol?: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;
  return (
    <div className="deriv-tt">
      <strong>{d.label}</strong>
      {d.close != null ? <div>종가 {fmtPx(d.close)}</div> : null}
      {d.vol != null ? <div>Vol22 {d.vol.toFixed(1)}%</div> : null}
      {d.dd != null ? <div>낙폭 {d.dd.toFixed(1)}%</div> : null}
      {d.rsi != null ? <div>RSI {d.rsi.toFixed(1)}</div> : null}
    </div>
  );
}

export default function QuantTab() {
  const [range, setRange] = useState<QuantRange>("1y");
  const [data, setData] = useState<QuantPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusId, setFocusId] = useState("spy");
  const [tickerInput, setTickerInput] = useState("");
  const [customTicker, setCustomTicker] = useState<string | null>(null);
  const [lookup, setLookup] = useState<QuantSnapshot | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const chartRef = useRef<HTMLElement | null>(null);

  const pick = useCallback((id: string) => {
    setFocusId(id);
    window.requestAnimationFrame(() => {
      chartRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, []);

  const load = useCallback(async (next: QuantRange) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/quant?range=${next}`, { cache: "no-store" });
      const json = (await res.json()) as QuantPayload;
      setData(json);
    } catch (exc) {
      setData({
        ok: false,
        generated_at: new Date().toISOString(),
        range: next,
        note: "",
        comment: "",
        snapshots: [],
        ids: [],
        errors: [exc instanceof Error ? exc.message : "로드 실패"],
        error: exc instanceof Error ? exc.message : "로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLookup = useCallback(
    async (raw: string, nextRange: QuantRange) => {
      const parsed = parseQuantTicker(raw);
      if (!parsed) {
        setLookupError("티커 형식을 확인해 주세요. 예: XLK, SMH, 069500");
        return;
      }
      setLookupLoading(true);
      setLookupError(null);
      try {
        const res = await fetch(
          `/api/quant?range=${nextRange}&ticker=${encodeURIComponent(parsed)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as QuantPayload;
        const hit = json.snapshots[0];
        if (!json.ok || !hit) {
          setLookup(null);
          setLookupError(json.error || `${parsed} 시세를 찾지 못했습니다.`);
          return;
        }
        setLookup(hit);
        setFocusId(hit.id);
        window.requestAnimationFrame(() => {
          chartRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      } catch (exc) {
        setLookup(null);
        setLookupError(exc instanceof Error ? exc.message : "조회 실패");
      } finally {
        setLookupLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(range);
  }, [load, range]);

  useEffect(() => {
    if (!customTicker) return;
    void fetchLookup(customTicker, range);
  }, [customTicker, range, fetchLookup]);

  const boardRows = data?.snapshots || [];
  const rows = useMemo(() => {
    if (!lookup) return boardRows;
    const rest = boardRows.filter(
      (r) => r.id !== lookup.id && r.yahoo.toUpperCase() !== lookup.yahoo.toUpperCase(),
    );
    return [lookup, ...rest];
  }, [boardRows, lookup]);

  const focus: QuantSnapshot | null =
    rows.find((r) => r.id === focusId && r.chart.length) ||
    rows.find((r) => r.chart.length) ||
    null;

  const hot = rows.filter((r) => r.stretch === "hot");
  const cold = rows.filter((r) => r.stretch === "cold");
  const drawn = rows.filter((r) => r.stretch === "drawn");

  function onLookupSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseQuantTicker(tickerInput);
    if (!parsed) {
      setLookupError("티커 형식을 확인해 주세요. 예: XLK, SMH, 069500");
      return;
    }
    const existing = boardRows.find(
      (r) =>
        r.yahoo.toUpperCase() === parsed ||
        r.short.toUpperCase() === parsed ||
        r.id.toUpperCase() === parsed,
    );
    if (existing) {
      setCustomTicker(null);
      setLookup(null);
      setLookupError(null);
      pick(existing.id);
      return;
    }
    if (customTicker === parsed) {
      void fetchLookup(parsed, range);
      return;
    }
    setCustomTicker(parsed);
  }

  return (
    <div className="geo-tab quant-tab">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">기술적분석</h2>
          </div>
          <div className="kr-hero-actions">
            <button type="button" className="ghost-btn" onClick={() => void load(range)} disabled={loading}>
              {loading ? "계산 중…" : "새로고침"}
            </button>
          </div>
        </div>
        <div className="nlp-filters">
          {QUANT_RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`tab-btn sub ${range === r.id ? "active" : ""}`}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {data?.ok ? <p className="quant-comment">{data.comment}</p> : null}
        {data?.error ? <p className="meta-soft">{data.error}</p> : null}
      </section>

      <section className="geo-section">
        <h3 className="geo-section-title">Score</h3>
        <p className="macro-subhead">
          행을 누르면 아래 차트에 볼린저·낙폭·RSI와 매수/매도 코멘트가 뜹니다. Vol {QUANT_WINDOWS.vol}일 ·
          Beta/Sharpe {QUANT_WINDOWS.beta}일 · RSI {QUANT_WINDOWS.rsi}일.
        </p>
        {!rows.length ? (
          <p className="empty">{loading ? "Yahoo 시세 수집 중…" : "표시할 종목이 없습니다."}</p>
        ) : (
          <div className="deriv-table-wrap quant-table-wrap">
            <table className="deriv-table">
              <thead>
                <tr>
                  <th>자산</th>
                  <th>가격</th>
                  <th>1일</th>
                  <th>20일</th>
                  <th>Vol22</th>
                  <th>낙폭</th>
                  <th>MaxDD</th>
                  <th>샤프</th>
                  <th>β SPY</th>
                  <th>ρ SPY</th>
                  <th>RSI</th>
                  <th>z</th>
                  <th>%ile</th>
                  <th>상태</th>
                  <th>타이밍</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={focus?.id === r.id ? "volmon-row-active" : ""}
                    onClick={() => pick(r.id)}
                  >
                    <td>
                      <strong>{r.short}</strong>
                      <span className="deriv-ko"> {r.group}</span>
                    </td>
                    <td>{fmtPx(r.price)}</td>
                    <td className={tone(r.ret_1d)}>{fmtPct(r.ret_1d)}</td>
                    <td className={tone(r.ret_20d)}>{fmtPct(r.ret_20d)}</td>
                    <td>{r.vol22 != null ? `${r.vol22.toFixed(1)}%` : "—"}</td>
                    <td className={r.dd != null && r.dd > 0.08 ? "down" : ""}>
                      {r.dd != null ? fmtPct(-r.dd * 100) : "—"}
                    </td>
                    <td>{r.max_dd != null ? fmtPct(-r.max_dd * 100) : "—"}</td>
                    <td className={tone(r.sharpe63)}>{fmtNum(r.sharpe63)}</td>
                    <td>{fmtNum(r.beta_spy)}</td>
                    <td>{fmtNum(r.corr_spy)}</td>
                    <td className={r.rsi != null && (r.rsi >= 70 || r.rsi <= 30) ? (r.rsi >= 70 ? "up" : "down") : ""}>
                      {r.rsi != null ? r.rsi.toFixed(0) : "—"}
                    </td>
                    <td className={tone(r.ret_z)}>{fmtNum(r.ret_z, 1)}</td>
                    <td>{r.px_pctile != null ? r.px_pctile.toFixed(0) : "—"}</td>
                    <td>
                      <span className={`quant-pill quant-${r.stretch}`}>{r.stretch_ko}</span>
                    </td>
                    <td>
                      <span className={`quant-pill quant-${r.timing}`}>{r.timing_ko}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="geo-section">
        <h3 className="geo-section-title">티커 조회</h3>
        <p className="macro-subhead">
          Score에 없는 ETF도 티커를 넣으면 아래에서 같은 기술적 분석이 돌아갑니다. 국내 ETF는
          6자리 코드(예: 069500)로 조회하세요.
        </p>
        <form className="quant-lookup-form" onSubmit={onLookupSubmit}>
          <input
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            placeholder="예: XLK, SMH, ARKK, 069500"
            aria-label="ETF 티커"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" className="ghost-btn" disabled={lookupLoading}>
            {lookupLoading ? "조회 중…" : "분석"}
          </button>
        </form>
        {lookupError ? <p className="empty warn">{lookupError}</p> : null}
      </section>

      {focus ? (
        <section ref={chartRef} className="geo-section nlp-chart-panel">
          <div className="nlp-chart-head">
            <div>
              <h3 className="geo-section-title">
                {focus.label} 심층
                <span className="nlp-chart-iv">{focus.from}</span>
              </h3>
              <p className="macro-subhead">좌축 가격 · 볼린저(22, k=2) · 낙폭% · RSI14</p>
              <p className="nlp-chart-quote">
                <strong>{fmtPx(focus.price)}</strong>
                <span className={tone(focus.ret_1d)}>{fmtPct(focus.ret_1d)}</span>
                <span className="meta-soft">
                  RSI {focus.rsi != null ? focus.rsi.toFixed(0) : "—"} · MACD{" "}
                  {fmtNum(focus.macd, 2)}
                </span>
              </p>
              <div className="quant-timing-flags">
                <span className={`quant-pill ${focus.stretch === "hot" ? "quant-hot" : "quant-neutral"}`}>
                  과열 {focus.stretch === "hot" ? "예" : "아니오"}
                </span>
                <span className={`quant-pill ${focus.momentum === "up" ? "quant-buy" : "quant-neutral"}`}>
                  상승 모멘텀 {focus.momentum === "up" ? "예" : "아니오"}
                </span>
                <span className={`quant-pill quant-${focus.timing}`}>{focus.timing_ko}</span>
              </div>
              <p className={`quant-timing-comment quant-timing-${focus.timing}`}>{focus.timing_comment}</p>
            </div>
          </div>
          <div className="geo-chart-wrap nlp-live-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={focus.chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#93a4c3", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28} />
                <YAxis
                  domain={["auto", "auto"]}
                  width={58}
                  tick={{ fill: "#93a4c3", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => fmtPx(Number(v))}
                />
                <Tooltip content={<ChartTip />} />
                <Line type="monotone" dataKey="upper" stroke="rgba(148,163,184,0.45)" strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="lower" stroke="rgba(148,163,184,0.45)" strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="ma" stroke="#93c5fd" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="close" stroke={focus.color} strokeWidth={1.8} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="quant-split-charts">
            <div className="geo-chart-wrap quant-mini-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={focus.chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#93a4c3", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={32} />
                  <YAxis
                    reversed
                    width={40}
                    tick={{ fill: "#93a4c3", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                  />
                  <Tooltip content={<ChartTip />} />
                  <Line type="monotone" dataKey="dd" stroke="#f87171" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="geo-chart-wrap quant-mini-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={focus.chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#93a4c3", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={32} />
                  <YAxis domain={[0, 100]} width={32} tick={{ fill: "#93a4c3", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <ReferenceLine y={70} stroke="rgba(248,113,113,0.5)" strokeDasharray="3 3" />
                  <ReferenceLine y={30} stroke="rgba(52,211,153,0.5)" strokeDasharray="3 3" />
                  <Tooltip content={<ChartTip />} />
                  <Line type="monotone" dataKey="rsi" stroke="#eab308" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <p className="macro-schedule">위: 가격+볼린저 · 아래 좌: 낙폭(max_drawdown) · 아래 우: RSI</p>
        </section>
      ) : null}

      <div className="nlp-verdict-board">
        <section className="geo-section nlp-verdict-col nlp-cautious">
          <h3 className="geo-section-title">과열</h3>
          {!hot.length ? (
            <p className="empty">RSI·z-score·고가 percentile 극단이 없습니다.</p>
          ) : (
            <ul className="nlp-verdict-list">
              {hot.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => pick(r.id)}>
                    <strong>{r.short}</strong>
                    <span className="up">RSI {r.rsi != null ? r.rsi.toFixed(0) : "—"}</span>
                  </button>
                  <p>
                    z {fmtNum(r.ret_z, 1)} · %ile {r.px_pctile != null ? r.px_pctile.toFixed(0) : "—"} · {r.from}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="geo-section nlp-verdict-col nlp-friendly">
          <h3 className="geo-section-title">위축 · 낙폭</h3>
          {!cold.length && !drawn.length ? (
            <p className="empty">위축·낙폭 신호가 없습니다.</p>
          ) : (
            <ul className="nlp-verdict-list">
              {[...cold, ...drawn].map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => pick(r.id)}>
                    <strong>{r.short}</strong>
                    <span className="down">{r.stretch_ko}</span>
                  </button>
                  <p>
                    낙폭 {r.dd != null ? fmtPct(-r.dd * 100) : "—"} · RSI{" "}
                    {r.rsi != null ? r.rsi.toFixed(0) : "—"} · {r.from}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="geo-section">
        <h3 className="geo-section-title">방법론</h3>
        <ul className="ideas-summary">
          {QUANT_METHODOLOGY.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="macro-schedule">
          {data?.generated_at
            ? new Date(data.generated_at).toLocaleString("ko-KR", { hour12: false })
            : ""}
        </p>
      </section>
    </div>
  );
}
