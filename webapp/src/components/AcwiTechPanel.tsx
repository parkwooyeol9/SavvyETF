"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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

import type { AcwiTechBoard, AcwiTechLookup, AcwiTechRow } from "@/lib/acwiTech";
import { QUANT_RANGES, type QuantRange, type QuantSnapshot } from "@/lib/quantDesk";

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
  payload?: Array<{ payload: { label: string; close?: number; rsi?: number; dd?: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;
  return (
    <div className="deriv-tt">
      <strong>{d.label}</strong>
      {d.close != null ? <div>종가 {fmtPx(d.close)}</div> : null}
      {d.dd != null ? <div>낙폭 {d.dd.toFixed(1)}%</div> : null}
      {d.rsi != null ? <div>RSI {d.rsi.toFixed(1)}</div> : null}
    </div>
  );
}

export default function AcwiTechPanel() {
  const [range, setRange] = useState<QuantRange>("1y");
  const [country, setCountry] = useState("미국");
  const [sector, setSector] = useState("전체");
  const [board, setBoard] = useState<AcwiTechBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [tickerInput, setTickerInput] = useState("");
  const [lookup, setLookup] = useState<QuantSnapshot | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const load = useCallback(async (nextCountry: string, nextSector: string, nextRange: QuantRange) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        country: nextCountry,
        sector: nextSector,
        range: nextRange,
      });
      const res = await fetch(`/api/acwi-tech?${qs.toString()}`, { cache: "no-store" });
      const body = (await res.json()) as AcwiTechBoard & { error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || "표를 읽지 못했습니다.");
      setBoard(body);
      setPicked((cur) => {
        if (cur && body.rows.some((r) => r.yahoo === cur && r.snapshot)) return cur;
        return body.rows.find((r) => r.snapshot)?.yahoo ?? null;
      });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "표를 읽지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(country, sector, range);
  }, [country, sector, range, load]);

  const focus = useMemo(() => {
    if (lookup) return lookup;
    return board?.rows.find((r) => r.yahoo === picked)?.snapshot ?? null;
  }, [board, picked, lookup]);

  function selectRow(row: AcwiTechRow) {
    setLookup(null);
    setLookupError(null);
    setTickerInput("");
    setPicked(row.yahoo);
  }

  async function onLookup(event: FormEvent) {
    event.preventDefault();
    const raw = tickerInput.trim();
    if (!raw) return;
    const hit = board?.rows.find(
      (r) =>
        r.yahoo.toUpperCase() === raw.toUpperCase() ||
        r.ric.toUpperCase() === raw.toUpperCase() ||
        r.name.toLowerCase() === raw.toLowerCase(),
    );
    if (hit?.snapshot) {
      selectRow(hit);
      setTickerInput(raw);
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    try {
      const qs = new URLSearchParams({ ticker: raw, range });
      const res = await fetch(`/api/acwi-tech?${qs.toString()}`, { cache: "no-store" });
      const body = (await res.json()) as AcwiTechLookup & { error?: string };
      if (!res.ok || !body.snapshot) {
        setLookup(null);
        setLookupError(body.error || "시세를 찾지 못했습니다.");
        return;
      }
      setLookup(body.snapshot);
      setPicked(null);
    } catch (exc) {
      setLookup(null);
      setLookupError(exc instanceof Error ? exc.message : "조회에 실패했습니다.");
    } finally {
      setLookupLoading(false);
    }
  }

  const chips = board?.country_chips ?? ["미국"];
  const countries = board?.countries ?? chips;
  const sectors = board?.sectors ?? [];

  return (
    <div className="geo-tab quant-tab">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">기술적분석</h2>
            <p className="macro-subhead">
              ACWI 편입 종목. {board?.source || "Yahoo Finance"}
              {board?.as_of ? ` · 기준 ${board.as_of}` : ""}
            </p>
          </div>
          <div className="kr-hero-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void load(country, sector, range)}
              disabled={loading}
            >
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
              onClick={() => {
                setLookup(null);
                setRange(r.id);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        {error ? <p className="empty warn">{error}</p> : null}
      </section>

      <section className="geo-section">
        <h3 className="geo-section-title">국가 · 업종</h3>
        <div className="nlp-filters">
          <button
            type="button"
            className={`tab-btn sub ${country === "전체" ? "active" : ""}`}
            onClick={() => setCountry("전체")}
          >
            전체
          </button>
          {chips.map((name) => (
            <button
              key={name}
              type="button"
              className={`tab-btn sub ${country === name ? "active" : ""}`}
              onClick={() => setCountry(name)}
            >
              {name}
            </button>
          ))}
          <select
            aria-label="국가"
            value={countries.includes(country) || country === "전체" ? country : "미국"}
            onChange={(e) => setCountry(e.target.value)}
          >
            <option value="전체">국가 전체</option>
            {countries.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="nlp-filters">
          <button
            type="button"
            className={`tab-btn sub ${sector === "전체" ? "active" : ""}`}
            onClick={() => setSector("전체")}
          >
            업종 전체
          </button>
          {sectors.map((name) => (
            <button
              key={name}
              type="button"
              className={`tab-btn sub ${sector === name ? "active" : ""}`}
              onClick={() => setSector(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <p className="macro-subhead">{board?.note}</p>
        <form className="quant-lookup-form" onSubmit={onLookup}>
          <input
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            placeholder="티커 또는 RIC · NVDA, 005930, 005930.KS, SIEGn.DE"
            aria-label="종목 티커"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" className="ghost-btn" disabled={lookupLoading}>
            {lookupLoading ? "조회 중…" : "분석"}
          </button>
        </form>
        {lookupError ? <p className="empty warn">{lookupError}</p> : null}
        {!board?.rows.length ? (
          <p className="empty">{loading ? "주요 종목 시세 수집 중…" : "표시할 종목이 없습니다."}</p>
        ) : (
          <div className="deriv-table-wrap quant-table-wrap">
            <table className="deriv-table">
              <thead>
                <tr>
                  <th>종목</th>
                  <th>국가</th>
                  <th>업종</th>
                  <th>비중</th>
                  <th>가격</th>
                  <th>1일</th>
                  <th>20일</th>
                  <th>RSI</th>
                  <th>상태</th>
                  <th>타이밍</th>
                </tr>
              </thead>
              <tbody>
                {board.rows.map((row) => {
                  const snap = row.snapshot;
                  const active = !lookup && picked === row.yahoo;
                  return (
                    <tr
                      key={row.yahoo}
                      className={active ? "volmon-row-active" : ""}
                      onClick={() => selectRow(row)}
                    >
                      <td>
                        <strong>{row.name}</strong>
                        <span className="deriv-ko"> {snap?.short || row.yahoo}</span>
                      </td>
                      <td>{row.country}</td>
                      <td>{row.sector}</td>
                      <td>{(row.weight * 100).toFixed(2)}%</td>
                      <td>{fmtPx(snap?.price)}</td>
                      <td className={tone(snap?.ret_1d)}>{fmtPct(snap?.ret_1d)}</td>
                      <td className={tone(snap?.ret_20d)}>{fmtPct(snap?.ret_20d)}</td>
                      <td
                        className={
                          snap?.rsi != null && (snap.rsi >= 70 || snap.rsi <= 30)
                            ? snap.rsi >= 70
                              ? "up"
                              : "down"
                            : ""
                        }
                      >
                        {snap?.rsi != null ? snap.rsi.toFixed(0) : "—"}
                      </td>
                      <td>
                        {snap ? <span className={`quant-pill quant-${snap.stretch}`}>{snap.stretch_ko}</span> : "—"}
                      </td>
                      <td>
                        {snap ? <span className={`quant-pill quant-${snap.timing}`}>{snap.timing_ko}</span> : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {focus ? (
        <section className="geo-section nlp-chart-panel">
          <div className="nlp-chart-head">
            <div>
              <h3 className="geo-section-title">
                {focus.label}
                <span className="nlp-chart-iv">{focus.from}</span>
              </h3>
              <p className="nlp-chart-quote">
                <strong>{fmtPx(focus.price)}</strong>
                <span className={tone(focus.ret_1d)}>{fmtPct(focus.ret_1d)}</span>
                <span className="meta-soft">
                  20일 {fmtPct(focus.ret_20d)} · RSI {focus.rsi != null ? focus.rsi.toFixed(0) : "—"} · β{" "}
                  {fmtNum(focus.beta_spy)}
                </span>
              </p>
              <div className="quant-timing-flags">
                <span className={`quant-pill quant-${focus.stretch}`}>{focus.stretch_ko}</span>
                <span className={`quant-pill ${focus.momentum === "up" ? "quant-buy" : "quant-neutral"}`}>
                  {focus.momentum_ko}
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
        </section>
      ) : null}
    </div>
  );
}
