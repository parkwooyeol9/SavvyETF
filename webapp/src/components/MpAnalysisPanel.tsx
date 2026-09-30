"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  fmtNum,
  fmtPct,
  fmtPrice,
  FreqToggle,
  heat,
  Kpi,
  MetricsTable,
  MpEditStatus,
  Row,
  STYLE_COLORS,
  timeAgo,
  tone,
  tooltipStyle,
  type Freq,
} from "@/components/MpUi";
import MpTrackRecord from "@/components/MpTrackRecord";
import { useSharedMpPortfolio } from "@/components/useSharedMpPortfolio";
import type { MpAnalysis, MpRegression, MpStyleRegression } from "@/lib/mpAnalytics";
import type { MpNewsBlock, MpNewsLang } from "@/lib/mpNews";
import {
  countryLabel,
  defaultMpPortfolio,
  diffVersions,
  formatMpText,
  latestVersion,
  loadLocalMpPortfolio,
  mpSectorLabel,
  newMpId,
  normalizeMpPortfolio,
  normalizeTicker,
  parseMpText,
  saveLocalMpPortfolio,
  sortedVersions,
  tickerMeta,
  todayIso,
  weightSum,
  type MpCountry,
  type MpHolding,
  type MpPortfolio,
  type MpVersion,
} from "@/lib/mpPortfolio";

function fmtCap(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return `$${(n / 1e6).toFixed(0)}M`;
}

const SIZE_ROWS = [
  { key: "large", label: "대형" },
  { key: "mid", label: "중형" },
  { key: "small", label: "소형" },
];
const STYLE_COLS = [
  { key: "value", label: "가치" },
  { key: "blend", label: "혼합" },
  { key: "growth", label: "성장" },
];
const STYLE_LABEL: Record<string, string> = {
  value: "가치",
  blend: "혼합",
  growth: "성장",
  na: "—",
  cash: "—",
};

type Mode = "actual" | "backtest";

export default function MpAnalysisPanel() {
  const { pf, update, canEdit, saveState, saveError } = useSharedMpPortfolio<MpPortfolio>({
    kind: "mp",
    normalize: normalizeMpPortfolio,
    fallback: defaultMpPortfolio,
    loadLocal: loadLocalMpPortfolio,
    saveLocal: saveLocalMpPortfolio,
  });
  const [selId, setSelId] = useState<string>("");
  const [mode, setMode] = useState<Mode>("actual");
  const [lookback, setLookback] = useState(365);
  const [res, setRes] = useState<MpAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [freq, setFreq] = useState<Freq>("daily");
  const [newsLang, setNewsLang] = useState<MpNewsLang>("auto");
  const [news, setNews] = useState<MpNewsBlock[] | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsFilter, setNewsFilter] = useState<string>("all");
  const autoRan = useRef(false);

  useEffect(() => {
    if (pf && !selId) setSelId(latestVersion(pf)?.id || "");
  }, [pf, selId]);

  const persist = useCallback(
    (next: MpPortfolio) => {
      if (update({ ...next, updated_at: new Date().toISOString() })) setDirty(true);
    },
    [update],
  );

  const versions = useMemo(() => (pf ? sortedVersions(pf) : []), [pf]);
  const sel = versions.find((v) => v.id === selId) || versions[versions.length - 1] || null;

  const run = useCallback(
    async (p: MpPortfolio, m: Mode, lb: number) => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch("/api/mp/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolio: p, mode: m, lookback_days: lb }),
        });
        const json = (await r.json()) as MpAnalysis;
        setRes(json);
        if (!json.ok) setError(json.error || "분석 실패");
        else setDirty(false);
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadNews = useCallback(async (p: MpPortfolio, lang: MpNewsLang) => {
    const last = latestVersion(p);
    if (!last) return;
    const items = last.holdings
      .filter((h) => h.country !== "CASH" && h.ticker.trim() && (Number(h.weight_pct) || 0) > 0)
      .map((h) => `${h.country}:${normalizeTicker(h.ticker, h.country)}`);
    if (!items.length) {
      setNews([]);
      return;
    }
    setNewsLoading(true);
    try {
      const r = await fetch(`/api/mp/news?lang=${lang}&items=${encodeURIComponent([...new Set(items)].join(","))}`);
      const json = (await r.json()) as { ok: boolean; blocks: MpNewsBlock[] };
      setNews(json.blocks || []);
    } catch {
      setNews([]);
    } finally {
      setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!pf || autoRan.current) return;
    autoRan.current = true;
    void run(pf, mode, lookback);
    void loadNews(pf, newsLang);
  }, [pf, mode, lookback, newsLang, run, loadNews]);

  if (!pf || !sel) return <p className="empty">MP 불러오는 중…</p>;

  /* ------------------------- editing ------------------------- */
  const updateVersion = (id: string, patch: Partial<MpVersion>) => {
    persist({ ...pf, versions: pf.versions.map((v) => (v.id === id ? { ...v, ...patch } : v)) });
  };
  const updateHolding = (hid: string, patch: Partial<MpHolding>) => {
    updateVersion(sel.id, {
      holdings: sel.holdings.map((h) => (h.id === hid ? { ...h, ...patch } : h)),
    });
  };
  const addHolding = (country: MpCountry) => {
    updateVersion(sel.id, {
      holdings: [...sel.holdings, { id: newMpId(), country, sector: country === "CASH" ? "현금" : "", ticker: "", weight_pct: 0 }],
    });
  };
  const removeHolding = (hid: string) => {
    updateVersion(sel.id, { holdings: sel.holdings.filter((h) => h.id !== hid) });
  };
  const addRebalance = () => {
    const base = latestVersion(pf)!;
    const latestDate = base.date;
    let date = todayIso();
    if (date <= latestDate) {
      const d = new Date(`${latestDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      date = d.toISOString().slice(0, 10);
    }
    const v: MpVersion = {
      id: newMpId("v"),
      date,
      note: "리밸런싱",
      holdings: base.holdings.map((h) => ({ ...h, id: newMpId() })),
    };
    persist({ ...pf, versions: [...pf.versions, v] });
    setSelId(v.id);
  };
  const deleteVersion = (id: string) => {
    if (pf.versions.length <= 1) return;
    const rest = pf.versions.filter((v) => v.id !== id);
    persist({ ...pf, versions: rest });
    if (id === sel.id) setSelId(sortedVersions({ ...pf, versions: rest }).at(-1)?.id || "");
  };
  const applyBulk = () => {
    const { holdings, errors } = parseMpText(bulkText);
    if (!holdings.length) {
      setBulkMsg(errors[0] || "입력 형식을 확인하세요.");
      return;
    }
    updateVersion(sel.id, { holdings });
    setBulkMsg(`${holdings.length}개 행 반영${errors.length ? ` · 해석 실패 ${errors.length}건: ${errors.slice(0, 3).join(" / ")}` : ""}`);
  };
  const resetDefault = () => {
    if (!window.confirm("기본 MP 구성으로 되돌릴까요? 편입 이력이 모두 초기화됩니다.")) return;
    const d = defaultMpPortfolio();
    persist(d);
    setSelId(d.versions[0]!.id);
  };

  const byCountry = (c: MpCountry) => weightSum(sel.holdings.filter((h) => h.country === c));
  const total = weightSum(sel.holdings);
  const selIdx = versions.findIndex((v) => v.id === sel.id);

  const onRun = () => {
    void run(pf, mode, lookback);
    void loadNews(pf, newsLang);
  };

  return (
    <div className="panel-stack mp-panel">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">MP-글로벌주식 성과 분석</h2>
            {res?.ok && res.weekly ? (
              <ul className="mp-week-comment">
                {res.weekly.comment.map((line, i) => (
                  <li key={i} className={line.startsWith("※") ? "meta-soft" : undefined}>
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="kr-hero-sub">{loading ? "주간 성과 분석 중…" : "편입일 이후 1주 이상 데이터가 쌓이면 주간 코멘트가 표시됩니다."}</p>
            )}
          </div>
          <div className="kr-hero-actions">
            <button type="button" className="tab-btn" disabled={loading} onClick={onRun}>
              {loading ? "분석 중…" : dirty ? "변경 반영 · 분석" : "분석 업데이트"}
            </button>
          </div>
        </div>
        <div className="us-pf-form" style={{ marginTop: 12 }}>
          <label>
            분석 모드
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="actual">실제 추적 (편입일 이후)</option>
              <option value="backtest">현재 비중 백테스트</option>
            </select>
          </label>
          {mode === "backtest" ? (
            <label>
              백테스트 기간
              <select value={lookback} onChange={(e) => setLookback(Number(e.target.value))}>
                <option value={91}>3개월</option>
                <option value={182}>6개월</option>
                <option value={365}>1년</option>
                <option value={730}>2년</option>
                <option value={1095}>3년</option>
              </select>
            </label>
          ) : null}
          <label>
            BM S&P500 비중 (%)
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={pf.bm_us_pct}
              disabled={!canEdit}
              onChange={(e) => persist({ ...pf, bm_us_pct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
            />
          </label>
          <span className="meta-soft" style={{ alignSelf: "center" }}>
            CSI300 {100 - pf.bm_us_pct}% · 일간 리밸런싱 · 달러 환산
          </span>
        </div>
        {mode === "backtest" ? (
          <p className="meta-soft">
            백테스트는 최신 편입비를 기간 내내 일간 리밸런싱으로 유지했다고 가정합니다(사전적 스타일·팩터 점검용). 상장 전 구간의 비중은 현금으로 처리합니다.
          </p>
        ) : null}
        {error ? <p className="empty">{error}</p> : null}
      </section>

      <MpTrackRecord
        id="MP2"
        ext={res?.ok ? res.series.map((p) => ({ date: p.date, port: p.port, bm: p.bm })) : undefined}
        extNote="현재 편입 구성 시뮬레이션 수익률(실제 기록 아님)"
      />

      {/* ---------------- Versions ---------------- */}
      <section className="geo-section" style={{ marginTop: 12 }}>
        <div className="geo-head-row" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 className="geo-section-title">편입·리밸런싱 이력</h3>
          {canEdit ? (
            <div className="us-pf-alloc-actions" style={{ marginTop: 0 }}>
              <button type="button" className="tab-btn" onClick={addRebalance}>
                리밸런싱 추가
              </button>
              <button type="button" className="ghost-btn" onClick={resetDefault}>
                기본 MP로 초기화
              </button>
            </div>
          ) : null}
        </div>
        <MpEditStatus canEdit={canEdit} saveState={saveState} saveError={saveError} />
        <p className="meta-soft">
          각 일자의 종가로 해당 편입비에 맞춰 리밸런싱하고, 그 사이에는 가격 변동에 따라 비중이 자연스럽게 움직입니다.{" "}
          {canEdit ? "행을 선택해 아래에서 편집하세요." : "행을 선택하면 아래에 해당 시점의 구성이 표시됩니다."}
        </p>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{canEdit ? "편입일" : "구분"}</th>
                <th>메모</th>
                <th className="num">종목</th>
                <th className="num">합계</th>
                <th>직전 대비 변경</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {versions.map((v, i) => {
                const d = diffVersions(i ? versions[i - 1]! : null, v);
                const parts = i
                  ? [
                      d.added.length ? `편입 ${d.added.map((k) => k.replace("CASH:", "")).join(", ")}` : "",
                      d.removed.length ? `편출 ${d.removed.map((k) => k.replace("CASH:", "")).join(", ")}` : "",
                      d.changed.length
                        ? `비중 ${d.changed
                            .slice(0, 6)
                            .map((c) => `${c.key.replace("CASH:", "")} ${c.from}→${c.to}`)
                            .join(", ")}${d.changed.length > 6 ? " …" : ""}`
                        : "",
                    ].filter(Boolean)
                  : ["최초 편입"];
                const sum = weightSum(v.holdings);
                return (
                  <tr key={v.id} className={v.id === sel.id ? "us-pf-row-active" : undefined}>
                    <td>
                      <strong>{canEdit ? v.date : i === 0 ? "최초 편입" : `리밸런싱 #${i}`}</strong>
                    </td>
                    <td className="meta-soft">{v.note || ""}</td>
                    <td className="num">{v.holdings.filter((h) => h.country !== "CASH").length}</td>
                    <td className={`num ${Math.abs(sum - 100) > 0.05 ? "down" : ""}`}>{sum.toFixed(1)}%</td>
                    <td className="meta-soft" style={{ maxWidth: 420 }}>
                      {parts.join(" · ") || "변경 없음"}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="ghost-btn" onClick={() => setSelId(v.id)} disabled={v.id === sel.id}>
                        {canEdit ? "편집" : "보기"}
                      </button>
                      {canEdit ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => deleteVersion(v.id)}
                            disabled={versions.length <= 1}
                          >
                            삭제
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------- Holdings editor ---------------- */}
      <section className="geo-section" style={{ marginTop: 12 }}>
        <h3 className="geo-section-title">
          편입 종목 <span className="meta-soft">({selIdx === 0 ? "최초 편입" : `리밸런싱 #${selIdx}`})</span>
        </h3>
        <div className="us-pf-form us-pf-alloc-toolbar">
          {canEdit ? (
            <>
              <label>
                편입 일자
                <input
                  type="date"
                  value={sel.date}
                  max={todayIso()}
                  onChange={(e) => e.target.value && updateVersion(sel.id, { date: e.target.value })}
                />
              </label>
              <label>
                메모
                <input value={sel.note || ""} onChange={(e) => updateVersion(sel.id, { note: e.target.value })} placeholder="예: 반도체 비중 확대" />
              </label>
            </>
          ) : (
            sel.note ? (
              <span className="meta-soft" style={{ alignSelf: "center" }}>
                {sel.note}
              </span>
            ) : null
          )}
          <span className={`us-pf-alloc-sum ${Math.abs(total - 100) <= 0.05 ? "ok" : "warn"}`} style={{ alignSelf: "center" }}>
            미국 {byCountry("US").toFixed(1)}% · 중국 {byCountry("CN").toFixed(1)}% · 현금 {byCountry("CASH").toFixed(1)}% · 합계{" "}
            {total.toFixed(1)}%{Math.abs(total - 100) <= 0.05 ? " ✓" : total < 100 ? " (잔여는 달러 현금)" : " (100% 초과 = 차입)"}
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table us-pf-alloc-table mp-edit-table">
            <thead>
              <tr>
                <th>국가</th>
                <th>업종</th>
                <th>티커</th>
                <th className="num">편입비(%)</th>
                <th>종목명</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {sel.holdings.map((h) => {
                const t = normalizeTicker(h.ticker, h.country);
                const meta = tickerMeta(t);
                const row = res?.holdings.find((x) => x.key === (h.country === "CASH" ? `CASH:${t}` : t));
                const name =
                  h.country === "CASH"
                    ? t === "CNY"
                      ? "위안화 현금"
                      : "달러 현금"
                    : meta
                      ? `${meta.name_ko}${meta.name_zh ? ` · ${meta.name_zh}` : ""}`
                      : row?.name || "";
                if (!canEdit) {
                  return (
                    <tr key={h.id}>
                      <td>{countryLabel(h.country)}</td>
                      <td>{h.sector}</td>
                      <td>
                        <strong>{h.ticker}</strong>
                      </td>
                      <td className="num">{(Number(h.weight_pct) || 0).toFixed(1)}</td>
                      <td className="meta-soft">{name}</td>
                    </tr>
                  );
                }
                return (
                  <tr key={h.id}>
                    <td>
                      <select
                        value={h.country}
                        onChange={(e) => updateHolding(h.id, { country: e.target.value as MpCountry })}
                        aria-label="국가"
                      >
                        <option value="US">미국</option>
                        <option value="CN">중국</option>
                        <option value="CASH">현금</option>
                      </select>
                    </td>
                    <td>
                      <input value={h.sector} onChange={(e) => updateHolding(h.id, { sector: e.target.value })} placeholder="IT H/W" aria-label="업종" />
                    </td>
                    <td>
                      <input
                        value={h.ticker}
                        onChange={(e) => updateHolding(h.id, { ticker: e.target.value.toUpperCase() })}
                        placeholder={h.country === "CN" ? "601899" : h.country === "CASH" ? "USD / CNY" : "NVDA"}
                        aria-label="티커"
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        step={0.5}
                        value={Number.isFinite(h.weight_pct) ? h.weight_pct : 0}
                        onChange={(e) => updateHolding(h.id, { weight_pct: Number(e.target.value) || 0 })}
                        aria-label="편입비"
                      />
                    </td>
                    <td className="meta-soft">{name}</td>
                    <td>
                      <button type="button" className="ghost-btn" onClick={() => removeHolding(h.id)}>
                        삭제
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canEdit ? (
          <>
            <div className="us-pf-alloc-actions">
              <button type="button" className="ghost-btn" onClick={() => addHolding("US")}>
                + 미국 종목
              </button>
              <button type="button" className="ghost-btn" onClick={() => addHolding("CN")}>
                + 중국 종목
              </button>
              <button type="button" className="ghost-btn" onClick={() => addHolding("CASH")}>
                + 현금
              </button>
            </div>
            <details style={{ marginTop: 12 }}>
              <summary className="meta-soft" style={{ cursor: "pointer" }}>
                텍스트로 일괄 입력 / 내보내기
              </summary>
              <p className="meta-soft" style={{ marginTop: 6 }}>
                형식: <code>(미국)</code> / <code>(중국)</code> / <code>(현금)</code> 머리말 다음 줄에 <code>업종 티커 비중, 티커 비중</code>. 중국은 6자리 코드(상해 6·5로 시작 → .SS, 그 외 .SZ).
              </p>
              <textarea
                className="us-pf-quick"
                rows={8}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"(미국)\nIT H/W nvda 3, tsmc 3\n(중국)\n588200 10\n(현금) 위안화 0, 달러 10"}
              />
              <div className="us-pf-alloc-actions">
                <button type="button" className="tab-btn" onClick={applyBulk}>
                  선택한 편입일에 반영 (덮어쓰기)
                </button>
                <button type="button" className="ghost-btn" onClick={() => setBulkText(formatMpText(sel.holdings))}>
                  현재 구성 불러오기
                </button>
                {bulkMsg ? <span className="meta-soft">{bulkMsg}</span> : null}
              </div>
            </details>
          </>
        ) : null}
      </section>

      {res?.ok ? <Results res={res} freq={freq} setFreq={setFreq} canEdit={canEdit} /> : null}

      {/* ---------------- News ---------------- */}
      <section className="geo-section" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <h3 className="geo-section-title">종목별 주요 뉴스</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="seg">
              {(
                [
                  ["auto", "자동(미국 영문·중국 중문)"],
                  ["ko", "한국어"],
                  ["en", "English"],
                ] as Array<[MpNewsLang, string]>
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={newsLang === k ? "active" : ""}
                  onClick={() => {
                    setNewsLang(k);
                    void loadNews(pf, k);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="ghost-btn" disabled={newsLoading} onClick={() => void loadNews(pf, newsLang)}>
              {newsLoading ? "수집 중…" : "새로고침"}
            </button>
          </div>
        </div>
        <p className="meta-soft">최신 편입 구성 기준 · Google News / Yahoo Finance RSS 최근 2주 헤드라인 (15–20분 캐시)</p>
        {news && news.length ? (
          <div className="us-pf-universe-chips" style={{ margin: "8px 0" }}>
            <button
              type="button"
              className={newsFilter === "all" ? "us-pf-chip us-pf-chip-active" : "us-pf-chip"}
              onClick={() => setNewsFilter("all")}
            >
              <strong>전체</strong>
            </button>
            {news.map((b) => (
              <button
                key={`${b.country}:${b.key}`}
                type="button"
                className={newsFilter === b.key ? "us-pf-chip us-pf-chip-active" : "us-pf-chip"}
                onClick={() => setNewsFilter(b.key)}
              >
                <strong>{b.ticker}</strong>
                <span>{b.items.length}건</span>
              </button>
            ))}
          </div>
        ) : null}
        {newsLoading && !news ? <p className="empty">뉴스 수집 중…</p> : null}
        <div className="mp-news-grid">
          {(news || [])
            .filter((b) => newsFilter === "all" || b.key === newsFilter)
            .map((b) => (
              <div key={`${b.country}:${b.key}`} className="mp-news-card">
                <div className="mp-news-head">
                  <strong>{b.ticker}</strong>
                  <span className="meta-soft">
                    {b.name} · {countryLabel(b.country)}
                  </span>
                </div>
                {b.error ? <p className="meta-soft">{b.error}</p> : null}
                {!b.items.length && !b.error ? <p className="meta-soft">최근 2주 헤드라인이 없습니다.</p> : null}
                <ul>
                  {b.items.map((it) => (
                    <li key={it.link}>
                      <a href={it.link} target="_blank" rel="noopener noreferrer">
                        {it.title}
                      </a>
                      <span className="meta-soft">
                        {it.source}
                        {it.ts ? ` · ${timeAgo(it.ts)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}

/* ================================================================== */

function Results({ res, freq, setFreq, canEdit }: { res: MpAnalysis; freq: Freq; setFreq: (f: Freq) => void; canEdit: boolean }) {
  const m = res.metrics!;
  const chart = useMemo(
    () =>
      res.series.map((p) => ({
        t: p.date,
        MP: Math.round(p.port * 100) / 100,
        BM: Math.round(p.bm * 100) / 100,
        "S&P500": Math.round(p.spx * 100) / 100,
        "CSI300(USD)": Math.round(p.csi * 100) / 100,
        초과: Math.round((p.port / p.bm - 1) * 10000) / 100,
        MP_DD: Math.round(p.port_dd * 100) / 100,
        BM_DD: Math.round(p.bm_dd * 100) / 100,
      })),
    [res.series],
  );
  const domain = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of chart) {
      lo = Math.min(lo, d.MP, d.BM, d["S&P500"], d["CSI300(USD)"]);
      hi = Math.max(hi, d.MP, d.BM, d["S&P500"], d["CSI300(USD)"]);
    }
    const pad = Math.max((hi - lo) * 0.06, 0.5);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)] as [number, number];
  }, [chart]);

  const reg: MpRegression | null = freq === "daily" ? res.factors.daily : res.factors.weekly;
  const rbsa: MpStyleRegression | null = freq === "daily" ? res.style.rbsa.daily : res.style.rbsa.weekly;
  const hs = res.style.holdings;
  const equityRows = res.holdings.filter((h) => h.country !== "CASH");
  const unclassified = equityRows
    .filter((h) => h.style_bucket === "na" || h.size_bucket === "etf")
    .reduce((s, h) => s + h.current_pct, 0);
  const maxBox = Math.max(1, ...Object.values(hs.box));

  return (
    <>
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 className="geo-section-title">
            성과 요약 <span className="meta-soft">· {res.mode === "actual" ? "실제 추적" : "현재 비중 백테스트"}</span>
          </h3>
          <span className="meta-soft">
            {canEdit || res.mode === "backtest" ? `${res.start_date} ~ ${res.as_of}` : `${res.as_of} 기준`} · BM {res.bm_label} · Rf {fmtPct(res.rf_ann_pct, 2, false)}
          </span>
        </div>
        <div className="us-pf-stats" style={{ marginTop: 10 }}>
          <Kpi label="MP 누적" v={fmtPct(m.port.total_return_pct)} cls={tone(m.port.total_return_pct)} />
          <Kpi label="BM 누적" v={fmtPct(m.bm.total_return_pct)} cls={tone(m.bm.total_return_pct)} />
          <Kpi label="초과수익" v={fmtPct(m.rel.excess_return_pct)} cls={tone(m.rel.excess_return_pct)} />
          <Kpi label="1일" v={fmtPct(res.period_returns.find((p) => p.key === "1d")?.port_pct)} cls={tone(res.period_returns.find((p) => p.key === "1d")?.port_pct)} />
          <Kpi label="변동성(연)" v={fmtPct(m.port.vol_pct, 1, false)} />
          <Kpi label="Sharpe" v={fmtNum(m.port.sharpe)} />
          <Kpi label="MDD" v={fmtPct(m.port.mdd_pct, 1)} cls="down" />
          <Kpi label="IR" v={fmtNum(m.rel.information_ratio)} cls={tone(m.rel.information_ratio)} />
          <Kpi label="Beta" v={fmtNum(m.rel.beta)} />
          <Kpi label="환율 기여" v={fmtPct(res.fx_contribution_pct)} cls={tone(res.fx_contribution_pct)} />
        </div>
        <div className="kr-chart" style={{ height: 320, marginTop: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={32} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis domain={domain} tick={{ fill: "#8fa3b8", fontSize: 10 }} width={48} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => v.toFixed(2)} />
              <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
              <ReferenceLine y={100} stroke="#475569" />
              <Line type="monotone" dataKey="MP" stroke="#60a5fa" strokeWidth={2.4} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="BM" stroke="#e8c547" strokeWidth={1.8} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="S&P500" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="CSI300(USD)" stroke="#f87171" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="us-pf-split" style={{ marginTop: 10 }}>
          <div className="kr-chart" style={{ height: 170 }}>
            <p className="meta-soft">누적 초과수익 (MP/BM − 1, %)</p>
            <ResponsiveContainer width="100%" height="88%">
              <AreaChart data={chart} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={32} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={42} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(2)}%`} />
                <ReferenceLine y={0} stroke="#475569" />
                <Area type="monotone" dataKey="초과" stroke="#34d399" fill="rgba(52,211,153,0.18)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="kr-chart" style={{ height: 170 }}>
            <p className="meta-soft">드로다운 (%)</p>
            <ResponsiveContainer width="100%" height="88%">
              <AreaChart data={chart} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                <XAxis dataKey="t" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={32} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={42} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(2)}%`} />
                <Area type="monotone" dataKey="MP_DD" name="MP" stroke="#60a5fa" fill="rgba(96,165,250,0.2)" isAnimationActive={false} />
                <Area type="monotone" dataKey="BM_DD" name="BM" stroke="#e8c547" fill="rgba(232,197,71,0.08)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* ---------- Fund metrics ---------- */}
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <div className="us-pf-split">
          <div>
            <h3 className="geo-section-title">월별 수익률</h3>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>월</th>
                    <th className="num">MP</th>
                    <th className="num">BM</th>
                    <th className="num">초과</th>
                  </tr>
                </thead>
                <tbody>
                  {[...res.monthly].reverse().map((r) => (
                    <tr key={r.month}>
                      <td>
                        {r.month}
                        {r.estimated ? <span className="meta-soft">*</span> : null}
                      </td>
                      <td className={`num ${tone(r.port_pct)}`}>{fmtPct(r.port_pct)}</td>
                      <td className={`num ${tone(r.bm_pct)}`}>{fmtPct(r.bm_pct)}</td>
                      <td className={`num ${tone(r.excess_pct)}`} style={{ background: heat(r.excess_pct, 5) }}>
                        {fmtPct(r.excess_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {res.monthly.some((r) => r.estimated) ? (
              <p className="meta-soft" style={{ marginTop: 6 }}>
                * 최초 편입 이전 구간이 포함된 수익률 — 최초 편입 비중을 매일 유지했다고 가정한 추정치입니다(당시 미상장 종목 비중은 현금).
              </p>
            ) : null}
          </div>
          <div>
            <h3 className="geo-section-title">펀드 성과 지표</h3>
            <p className="meta-soft">
              일간 수익률 · 연환산 {res.ann_factor.toFixed(0)}일 · 무위험수익률 = 미 13주 T-bill
            </p>
            <MetricsTable p={m.port} b={m.bm} />
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>BM 대비 지표</th>
                    <th className="num">값</th>
                  </tr>
                </thead>
                <tbody>
                  <Row label="Beta" v={fmtNum(m.rel.beta)} />
                  <Row label="Jensen Alpha (연)" v={fmtPct(m.rel.alpha_pct)} cls={tone(m.rel.alpha_pct)} />
                  <Row label="상관계수 / R²" v={`${fmtNum(m.rel.correlation)} / ${fmtNum(m.rel.r2)}`} />
                  <Row label="Tracking Error (연)" v={fmtPct(m.rel.tracking_error_pct, 2, false)} />
                  <Row label="Information Ratio" v={fmtNum(m.rel.information_ratio)} cls={tone(m.rel.information_ratio)} />
                  <Row label="Treynor (연)" v={fmtPct(m.rel.treynor_pct)} />
                  <Row label="상승 포착률" v={fmtPct(m.rel.up_capture_pct, 1, false)} />
                  <Row label="하락 포착률" v={fmtPct(m.rel.down_capture_pct, 1, false)} />
                  <Row label="BM 대비 승률 (일간)" v={fmtPct(m.rel.hit_ratio_pct, 1, false)} />
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Sectors ---------- */}
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">벤치마크 대비 업종비</h3>
        <p className="meta-soft">
          현재 비중(편입 후 가격 변동 반영) vs BM = S&P500(SPY) × {Math.round((res.countries[0]?.bm_pct ?? 70))}% + CSI300(ASHR) ×{" "}
          {Math.round(res.countries[1]?.bm_pct ?? 30)}% · 섹터 분류 Morningstar/Yahoo 11개 ·{" "}
          {res.bm_sector_source === "live" ? "BM 섹터 비중 실시간(Yahoo)" : "BM 섹터 비중 2026-09 스냅샷(대체값)"}
        </p>
        <div className="us-pf-split" style={{ marginTop: 8 }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>업종</th>
                  <th className="num">MP 현재</th>
                  <th className="num">MP 목표</th>
                  <th className="num">BM</th>
                  <th className="num">Active</th>
                  <th className="num">기여</th>
                </tr>
              </thead>
              <tbody>
                {res.sectors.map((s) => (
                  <tr key={s.key}>
                    <td title={`S&P500 ${s.bm_us_pct.toFixed(1)}% · CSI300 ${s.bm_cn_pct.toFixed(1)}%`}>{s.label}</td>
                    <td className="num">{s.port_pct.toFixed(1)}%</td>
                    <td className="num meta-soft">{s.target_pct.toFixed(1)}%</td>
                    <td className="num">{s.bm_pct.toFixed(1)}%</td>
                    <td className={`num ${tone(s.active_pct)}`} style={{ background: heat(s.active_pct, 20) }}>
                      {fmtPct(s.active_pct, 1)}
                    </td>
                    <td className={`num ${tone(s.contribution_pct)}`}>{fmtPct(s.contribution_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="kr-chart" style={{ height: Math.max(240, res.sectors.length * 26) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={res.sectors} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fill: "#8fa3b8", fontSize: 10 }} unit="%" />
                <YAxis type="category" dataKey="label" tick={{ fill: "#8fa3b8", fontSize: 11 }} width={78} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)}%`} />
                <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                <Bar dataKey="port_pct" name="MP" fill="#60a5fa" isAnimationActive={false} />
                <Bar dataKey="bm_pct" name="BM" fill="#e8c547" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="us-pf-split" style={{ marginTop: 14 }}>
          <div>
            <h3 className="geo-section-title">국가 배분</h3>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>국가</th>
                    <th className="num">MP</th>
                    <th className="num">BM</th>
                    <th className="num">Active</th>
                    <th className="num">기여</th>
                  </tr>
                </thead>
                <tbody>
                  {res.countries.map((c) => (
                    <tr key={c.key}>
                      <td>{c.label}</td>
                      <td className="num">{c.port_pct.toFixed(1)}%</td>
                      <td className="num">{c.bm_pct.toFixed(1)}%</td>
                      <td className={`num ${tone(c.active_pct)}`}>{fmtPct(c.active_pct, 1)}</td>
                      <td className={`num ${tone(c.contribution_pct)}`}>{fmtPct(c.contribution_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {res.brinson ? (
              <>
                <h3 className="geo-section-title" style={{ marginTop: 14 }}>
                  국가 성과 요인 (Brinson-Fachler)
                </h3>
                <p className="meta-soft">배분 = 국가 비중 차이 효과, 선택 = 국가 내 종목 선택 효과 · 일별 효과를 GRAP 방식으로 연결(합계 = 누적 초과수익)</p>
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>구분</th>
                        <th className="num">평균 비중</th>
                        <th className="num">MP 수익</th>
                        <th className="num">BM 수익</th>
                        <th className="num">배분</th>
                        <th className="num">선택</th>
                        <th className="num">상호</th>
                        <th className="num">합계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.brinson.rows.map((r) => (
                        <tr key={r.segment}>
                          <td>{r.label}</td>
                          <td className="num">
                            {r.port_weight_pct.toFixed(1)}% <span className="meta-soft">/ {r.bm_weight_pct.toFixed(0)}%</span>
                          </td>
                          <td className={`num ${tone(r.port_return_pct)}`}>{fmtPct(r.port_return_pct)}</td>
                          <td className={`num ${tone(r.bm_return_pct)}`}>{fmtPct(r.bm_return_pct)}</td>
                          <td className={`num ${tone(r.allocation_pct)}`}>{fmtPct(r.allocation_pct)}</td>
                          <td className={`num ${tone(r.selection_pct)}`}>{fmtPct(r.selection_pct)}</td>
                          <td className={`num ${tone(r.interaction_pct)}`}>{fmtPct(r.interaction_pct)}</td>
                          <td className={`num ${tone(r.total_pct)}`}>
                            <strong>{fmtPct(r.total_pct)}</strong>
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="meta-soft" colSpan={7}>
                          연결 잔차
                        </td>
                        <td className="num meta-soft">{fmtPct(res.brinson.residual_pct)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
          <div>
            <h3 className="geo-section-title">PM 업종 분류</h3>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>국가</th>
                    <th>업종</th>
                    <th className="num">현재</th>
                    <th className="num">목표</th>
                    <th className="num">기여</th>
                  </tr>
                </thead>
                <tbody>
                  {res.pm_sectors.map((g) => (
                    <tr key={g.key}>
                      <td>{countryLabel(g.country)}</td>
                      <td title={g.tickers.join(", ")}>{g.label}</td>
                      <td className="num">{g.port_pct.toFixed(1)}%</td>
                      <td className="num meta-soft">{g.target_pct.toFixed(1)}%</td>
                      <td className={`num ${tone(g.contribution_pct)}`}>{fmtPct(g.contribution_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Holdings ---------- */}
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">편입 종목 현황</h3>
        <p className="meta-soft">
          1개월 수익률은 최근 30일 가격 수익률로 USD 기준(중국은 현지통화 병기). 기여도는 설정일 NAV 대비 누적 손익(%p)으로 합계가 MP 누적수익률과 일치합니다.
        </p>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data-table mp-hold-table">
            <thead>
              <tr>
                <th>국가</th>
                <th>업종</th>
                <th>티커</th>
                <th>종목명</th>
                <th className="num">목표</th>
                <th className="num">현재</th>
                {canEdit ? <th>편입일</th> : null}
                <th className="num">현재가</th>
                <th className="num" title="각 종목의 최근 거래일 기준">1일</th>
                <th className="num" title="최근 1개월(30일) 가격 수익률, 달러 기준">1개월</th>
                <th className="num">기여</th>
                <th className="num">시총</th>
                <th className="num">PER</th>
                <th className="num">PBR</th>
                <th>스타일</th>
              </tr>
            </thead>
            <tbody>
              {res.holdings.map((h) => (
                <tr key={h.key} className={h.status === "exited" ? "meta-soft" : undefined}>
                  <td>{countryLabel(h.country)}</td>
                  <td>{h.sector_label}</td>
                  <td>
                    <strong>{h.ticker}</strong>
                    {h.status === "pending" ? <span className="meta-soft"> · 편입대기</span> : null}
                    {h.status === "exited" ? <span className="meta-soft"> · 편출</span> : null}
                  </td>
                  <td className="meta-soft" title={mpSectorLabel(h.msector)}>
                    {h.name}
                  </td>
                  <td className="num">{h.target_pct.toFixed(1)}%</td>
                  <td className="num">{h.current_pct.toFixed(1)}%</td>
                  {canEdit ? <td className="meta-soft">{h.first_date || "—"}</td> : null}
                  <td className="num">{h.country === "CASH" ? "—" : fmtPrice(h.last_price, h.currency)}</td>
                  <td className={`num ${tone(h.day_change_pct)}`}>{fmtPct(h.day_change_pct)}</td>
                  <td className={`num ${tone(h.month_return_pct)}`}>
                    {fmtPct(h.month_return_pct)}
                    {h.country === "CN" && h.local_month_return_pct != null ? (
                      <span className="meta-soft"> ({fmtPct(h.local_month_return_pct, 1)} CNY)</span>
                    ) : null}
                  </td>
                  <td className={`num ${tone(h.contribution_pct)}`}>{fmtPct(h.contribution_pct)}</td>
                  <td className="num">{fmtCap(h.market_cap_usd)}</td>
                  <td className="num">{h.pe ? fmtNum(h.pe, 1) : h.forward_pe ? `${fmtNum(h.forward_pe, 1)}F` : "—"}</td>
                  <td className="num">{fmtNum(h.pb, 1)}</td>
                  <td>{STYLE_LABEL[h.style_bucket] || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- Style ---------- */}
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 className="geo-section-title">스타일 분석</h3>
          <FreqToggle freq={freq} setFreq={setFreq} />
        </div>
        <div className="us-pf-split" style={{ marginTop: 8 }}>
          <div>
            <p className="meta-soft">보유종목 기반 (Yahoo 펀더멘털 · 커버리지 {hs.coverage_pct.toFixed(0)}%)</p>
            <div className="us-pf-stats" style={{ marginTop: 8 }}>
              <Kpi label="PER (MP / BM)" v={`${fmtNum(hs.pe, 1)} / ${fmtNum(hs.bm_pe, 1)}`} />
              <Kpi label="선행 PER" v={fmtNum(hs.forward_pe, 1)} />
              <Kpi label="PBR (MP / BM)" v={`${fmtNum(hs.pb, 1)} / ${fmtNum(hs.bm_pb, 1)}`} />
              <Kpi label="배당수익률" v={fmtPct(hs.div_yield_pct, 2, false)} />
              <Kpi label="가중평균 시총" v={fmtCap(hs.wavg_mcap_usd)} />
              <Kpi label="가중 중위 시총" v={fmtCap(hs.median_mcap_usd)} />
            </div>
            <p className="meta-soft" style={{ marginTop: 12 }}>
              스타일 박스 (시총 × 지역 BM 대비 PER 상대수준: &lt;0.8배 가치, &gt;1.25배 성장)
            </p>
            <div className="mp-style-box">
              <div />
              {STYLE_COLS.map((c) => (
                <div key={c.key} className="mp-style-box-head">
                  {c.label}
                </div>
              ))}
              {SIZE_ROWS.map((r) => (
                <FragmentRow key={r.key} label={r.label}>
                  {STYLE_COLS.map((c) => {
                    const v = hs.box[`${r.key}:${c.key}`] || 0;
                    return (
                      <div
                        key={c.key}
                        className="mp-style-box-cell"
                        style={{ background: `rgba(96,165,250,${v ? 0.1 + (v / maxBox) * 0.55 : 0.03})` }}
                      >
                        {v ? `${v.toFixed(1)}%` : ""}
                      </div>
                    );
                  })}
                </FragmentRow>
              ))}
            </div>
            <p className="meta-soft">ETF·분류불가 {unclassified.toFixed(1)}% 제외</p>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>시총 구간</th>
                    <th className="num">비중</th>
                  </tr>
                </thead>
                <tbody>
                  {hs.size.map((s) => (
                    <tr key={s.key}>
                      <td>{s.label}</td>
                      <td className="num">{s.weight_pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <p className="meta-soft">
              수익률 기반 (Sharpe RBSA: 비음·합 100% 제약 회귀){rbsa ? ` · n=${rbsa.n} · R² ${fmtNum(rbsa.r2)}` : ""}
            </p>
            {rbsa ? (
              <div className="kr-chart" style={{ height: 230, marginTop: 8 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rbsa.weights} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fill: "#8fa3b8", fontSize: 10 }} unit="%" domain={[0, 100]} />
                    <YAxis type="category" dataKey="label" tick={{ fill: "#8fa3b8", fontSize: 11 }} width={120} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)}%`} />
                    <Bar dataKey="weight_pct" name="스타일 비중" isAnimationActive={false}>
                      {rbsa.weights.map((_, i) => (
                        <Cell key={i} fill={STYLE_COLORS[i % STYLE_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="empty">관측치가 부족합니다. 기간을 늘리거나 백테스트 모드를 사용하세요.</p>
            )}
            {res.style.rolling.length ? (
              <>
                <p className="meta-soft" style={{ marginTop: 8 }}>
                  롤링 스타일 (63거래일 창, 일간)
                </p>
                <div className="kr-chart" style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={res.style.rolling} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: "#8fa3b8", fontSize: 10 }} minTickGap={32} tickFormatter={(v: string) => v.slice(2, 7)} />
                      <YAxis tick={{ fill: "#8fa3b8", fontSize: 10 }} width={36} domain={[0, 100]} unit="%" />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)}%`} />
                      <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 11 }} />
                      {(rbsa?.weights || res.style.rbsa.daily?.weights || []).map((w, i) => (
                        <Area
                          key={w.key}
                          type="monotone"
                          dataKey={w.key}
                          name={w.label}
                          stackId="1"
                          stroke={STYLE_COLORS[i % STYLE_COLORS.length]}
                          fill={STYLE_COLORS[i % STYLE_COLORS.length]}
                          fillOpacity={0.55}
                          isAnimationActive={false}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {/* ---------- Factors ---------- */}
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 className="geo-section-title">팩터 분석</h3>
          <FreqToggle freq={freq} setFreq={setFreq} />
        </div>
        <p className="meta-soft">
          MP 초과수익(−Rf)을 ETF 롱숏 팩터에 다중회귀: 시장(BM−Rf), 규모(IWM−SPY), 가치(IVE−IVW), 모멘텀(MTUM−SPY), 퀄리티(QUAL−SPY),
          저변동(USMV−SPY), 반도체(SOXX−SPY), 중국 상대(CSI300−S&P500). |t| ≥ 2이면 통계적으로 유의.
        </p>
        {reg ? (
          <div className="us-pf-split" style={{ marginTop: 8 }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>팩터</th>
                    <th className="num">노출(β)</th>
                    <th className="num">t</th>
                    <th className="num">수익 기여</th>
                    <th className="num">위험 기여</th>
                  </tr>
                </thead>
                <tbody>
                  {reg.betas.map((b) => (
                    <tr key={b.key}>
                      <td>{b.label}</td>
                      <td className="num" style={{ background: heat(b.beta, 1) }}>
                        {fmtNum(b.beta)}
                      </td>
                      <td className={`num ${b.t != null && Math.abs(b.t) >= 2 ? "" : "meta-soft"}`}>
                        {b.t != null && Math.abs(b.t) >= 2 ? <strong>{fmtNum(b.t, 1)}</strong> : fmtNum(b.t, 1)}
                      </td>
                      <td className={`num ${tone(b.return_contrib_pct)}`}>{fmtPct(b.return_contrib_pct)}</td>
                      <td className="num">{fmtPct(b.risk_share_pct, 1, false)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>알파 (연)</td>
                    <td className={`num ${tone(reg.alpha_ann_pct)}`}>{fmtPct(reg.alpha_ann_pct)}</td>
                    <td className="num">{fmtNum(reg.alpha_t, 1)}</td>
                    <td />
                    <td className="num meta-soft">고유 {fmtPct(reg.specific_risk_share_pct, 1, false)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="meta-soft" style={{ marginTop: 6 }}>
                n={reg.n} ({reg.freq === "daily" ? "일간" : "주간"}) · R² {fmtNum(reg.r2)} · 조정 R² {fmtNum(reg.adj_r2)} · 잔차 변동성{" "}
                {fmtPct(reg.resid_vol_pct, 1, false)}
              </p>
            </div>
            <div className="kr-chart" style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reg.betas} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fill: "#8fa3b8", fontSize: 10 }} />
                  <YAxis type="category" dataKey="label" tick={{ fill: "#8fa3b8", fontSize: 11 }} width={86} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => v.toFixed(3)} />
                  <ReferenceLine x={0} stroke="#64748b" />
                  <Bar dataKey="beta" name="β" isAnimationActive={false}>
                    {reg.betas.map((b) => (
                      <Cell key={b.key} fill={b.beta >= 0 ? "#34d399" : "#f87171"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="empty">
            {freq === "weekly" ? "주간" : "일간"} 관측치가 부족해 팩터 회귀를 생략했습니다. 백테스트 모드(6개월 이상)로 사전 노출을 확인하세요.
          </p>
        )}
        {res.factors.holdings.length ? (
          <>
            <h3 className="geo-section-title" style={{ marginTop: 14 }}>
              종목별 팩터 노출 (일간)
            </h3>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>티커</th>
                    {(reg?.betas || res.factors.daily?.betas || []).map((b) => (
                      <th key={b.key} className="num">
                        {b.label}
                      </th>
                    ))}
                    <th className="num">R²</th>
                  </tr>
                </thead>
                <tbody>
                  {res.factors.holdings.map((h) => (
                    <tr key={h.key}>
                      <td>
                        <strong>{h.ticker}</strong>
                      </td>
                      {Object.entries(h.betas).map(([k, v]) => (
                        <td key={k} className="num" style={{ background: heat(v, 1.5) }}>
                          {v.toFixed(2)}
                        </td>
                      ))}
                      <td className="num meta-soft">{h.r2.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      {res.notes.length ? (
        <section className="geo-section" style={{ marginTop: 16 }}>
          <h3 className="geo-section-title">데이터 메모</h3>
          <ul className="ideas-summary">
            {res.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="meta-soft" style={{ marginTop: 6 }}>
            가격: Yahoo Finance 종가(가격수익률, 배당 제외) · CSI300은 510300.SS ETF로 대체 · 최종일{" "}
            {Object.entries(res.last_dates)
              .map(([k, v]) => `${k} ${v || "—"}`)
              .join(" · ")}
          </p>
        </section>
      ) : null}
    </>
  );
}

function FragmentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="mp-style-box-head">{label}</div>
      {children}
    </>
  );
}
