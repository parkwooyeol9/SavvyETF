"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { MpRegression, MpStyleRegression } from "@/lib/mpCore";
import type { EtfAnalysis } from "@/lib/mpEtfAnalytics";
import {
  assetLabel,
  defaultEtfPortfolio,
  diffEtfVersions,
  ETF_ASSETS,
  etfHoldingKey,
  etfMeta,
  etfWeightSum,
  formatEtfText,
  latestEtfVersion,
  loadLocalEtfPortfolio,
  newMpId,
  normalizeEtfPortfolio,
  normalizeEtfTicker,
  parseEtfText,
  saveLocalEtfPortfolio,
  sortedEtfVersions,
  todayIso,
  type EtfAsset,
  type EtfBm,
  type EtfHolding,
  type EtfPortfolio,
  type EtfTheme,
  type EtfVersion,
} from "@/lib/mpEtfPortfolio";
import type { MpThemeNewsBlock } from "@/lib/mpNews";

type Mode = "actual" | "backtest";

const BM_FIELDS: Array<{ key: keyof EtfBm; label: string; group: "top" | "alt" }> = [
  { key: "eq", label: "주식 (ACWI)", group: "top" },
  { key: "fi", label: "채권 (Global Agg)", group: "top" },
  { key: "alt", label: "대체", group: "top" },
  { key: "alt_cmdty", label: "대체 내 원자재", group: "alt" },
  { key: "alt_reit", label: "대체 내 리츠", group: "alt" },
  { key: "alt_btc", label: "대체 내 비트코인", group: "alt" },
];

export default function MpEtfPanel() {
  const { pf, update, canEdit, saveState, saveError } = useSharedMpPortfolio<EtfPortfolio>({
    kind: "etf",
    normalize: normalizeEtfPortfolio,
    fallback: defaultEtfPortfolio,
    loadLocal: loadLocalEtfPortfolio,
    saveLocal: saveLocalEtfPortfolio,
  });
  const [selId, setSelId] = useState("");
  const [mode, setMode] = useState<Mode>("actual");
  const [lookback, setLookback] = useState(365);
  const [res, setRes] = useState<EtfAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [freq, setFreq] = useState<Freq>("daily");
  const [newsLang, setNewsLang] = useState<"ko" | "en">("ko");
  const [news, setNews] = useState<MpThemeNewsBlock[] | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsFilter, setNewsFilter] = useState("all");
  const autoRan = useRef(false);

  useEffect(() => {
    if (pf && !selId) setSelId(latestEtfVersion(pf)?.id || "");
  }, [pf, selId]);

  const persist = useCallback(
    (next: EtfPortfolio) => {
      if (update({ ...next, updated_at: new Date().toISOString() })) setDirty(true);
    },
    [update],
  );

  const versions = useMemo(() => (pf ? sortedEtfVersions(pf) : []), [pf]);
  const sel = versions.find((v) => v.id === selId) || versions[versions.length - 1] || null;

  const run = useCallback(async (p: EtfPortfolio, m: Mode, lb: number) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/mp/etf/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio: p, mode: m, lookback_days: lb }),
      });
      const json = (await r.json()) as EtfAnalysis;
      setRes(json);
      if (!json.ok) setError(json.error || "분석 실패");
      else setDirty(false);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNews = useCallback(async (p: EtfPortfolio, lang: "ko" | "en") => {
    const last = latestEtfVersion(p);
    if (!last) return;
    const w = new Map<EtfTheme, number>();
    for (const h of last.holdings) {
      const t = etfMeta(h.ticker)?.theme;
      if (t && (Number(h.weight_pct) || 0) > 0) w.set(t, (w.get(t) || 0) + Number(h.weight_pct));
    }
    const themes = [...w.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    if (!themes.length) {
      setNews([]);
      return;
    }
    setNewsLoading(true);
    try {
      const r = await fetch(`/api/mp/etf/news?lang=${lang}&themes=${encodeURIComponent(themes.join(","))}`);
      const json = (await r.json()) as { ok: boolean; blocks: MpThemeNewsBlock[] };
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

  if (!pf || !sel) return <p className="empty">MP-ETF배분 불러오는 중…</p>;

  const updateVersion = (id: string, patch: Partial<EtfVersion>) => {
    persist({ ...pf, versions: pf.versions.map((v) => (v.id === id ? { ...v, ...patch } : v)) });
  };
  const updateHolding = (hid: string, patch: Partial<EtfHolding>) => {
    updateVersion(sel.id, { holdings: sel.holdings.map((h) => (h.id === hid ? { ...h, ...patch } : h)) });
  };
  const addHolding = (asset: EtfAsset) => {
    updateVersion(sel.id, {
      holdings: [...sel.holdings, { id: newMpId(), asset, group: asset === "CASH" ? "현금" : "", ticker: asset === "CASH" ? "USD" : "", weight_pct: 0 }],
    });
  };
  const removeHolding = (hid: string) => updateVersion(sel.id, { holdings: sel.holdings.filter((h) => h.id !== hid) });
  const addRebalance = () => {
    const base = latestEtfVersion(pf)!;
    let date = todayIso();
    if (date <= base.date) {
      const d = new Date(`${base.date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      date = d.toISOString().slice(0, 10);
    }
    const v: EtfVersion = { id: newMpId("v"), date, note: "리밸런싱", holdings: base.holdings.map((h) => ({ ...h, id: newMpId() })) };
    persist({ ...pf, versions: [...pf.versions, v] });
    setSelId(v.id);
  };
  const deleteVersion = (id: string) => {
    if (pf.versions.length <= 1) return;
    const rest = pf.versions.filter((v) => v.id !== id);
    persist({ ...pf, versions: rest });
    if (id === sel.id) setSelId(sortedEtfVersions({ ...pf, versions: rest }).at(-1)?.id || "");
  };
  const applyBulk = () => {
    const { holdings, errors } = parseEtfText(bulkText);
    if (!holdings.length) {
      setBulkMsg(errors[0] || "입력 형식을 확인하세요.");
      return;
    }
    updateVersion(sel.id, { holdings });
    setBulkMsg(`${holdings.length}개 행 반영${errors.length ? ` · 해석 실패 ${errors.length}건: ${errors.slice(0, 3).join(" / ")}` : ""}`);
  };
  const resetDefault = () => {
    if (!window.confirm("기본 MP-ETF배분 구성으로 되돌릴까요? 편입 이력이 모두 초기화됩니다.")) return;
    const d = defaultEtfPortfolio();
    persist(d);
    setSelId(d.versions[0]!.id);
  };
  const setBm = (key: keyof EtfBm, v: number) => persist({ ...pf, bm: { ...pf.bm, [key]: Math.min(100, Math.max(0, v)) } });

  const byAsset = (a: EtfAsset) => etfWeightSum(sel.holdings.filter((h) => h.asset === a));
  const total = etfWeightSum(sel.holdings);
  const selIdx = versions.findIndex((v) => v.id === sel.id);
  const onRun = () => {
    void run(pf, mode, lookback);
    void loadNews(pf, newsLang);
  };
  const bmTop = pf.bm.eq + pf.bm.fi + pf.bm.alt;
  const bmAlt = pf.bm.alt_cmdty + pf.bm.alt_reit + pf.bm.alt_btc;

  return (
    <div className="panel-stack mp-panel">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">MP-ETF배분 성과 분석</h2>
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
          {BM_FIELDS.map((f) => (
            <label key={f.key}>
              BM {f.label} (%)
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={pf.bm[f.key]}
                disabled={!canEdit}
                onChange={(e) => setBm(f.key, Number(e.target.value) || 0)}
              />
            </label>
          ))}
          <span className={`meta-soft ${Math.abs(bmTop - 100) > 0.05 || Math.abs(bmAlt - 100) > 0.05 ? "down" : ""}`} style={{ alignSelf: "center" }}>
            자산 합계 {bmTop}% · 대체 구성 합계 {bmAlt}% · 일간 리밸런싱 · 달러·총수익 기준
          </span>
        </div>
        {mode === "backtest" ? (
          <p className="meta-soft">
            백테스트는 최신 편입비를 기간 내내 일간 리밸런싱으로 유지했다고 가정합니다(사전적 배분·팩터 점검용). 상장 전 구간의 비중은 현금으로 처리합니다.
          </p>
        ) : null}
        {error ? <p className="empty">{error}</p> : null}
      </section>

      <MpTrackRecord
        id="MP1"
        ext={res?.ok ? res.series.map((p) => ({ date: p.date, port: p.port, bm: p.bm })) : undefined}
        extNote="현재 편입 구성 시뮬레이션 수익률"
      />

      <section className="geo-section" style={{ marginTop: 12 }}>
        <div className="geo-head-row" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 className="geo-section-title">편입·리밸런싱 이력</h3>
          {canEdit ? (
            <div className="us-pf-alloc-actions" style={{ marginTop: 0 }}>
              <button type="button" className="tab-btn" onClick={addRebalance}>
                리밸런싱 추가
              </button>
              <button type="button" className="ghost-btn" onClick={resetDefault}>
                기본 구성으로 초기화
              </button>
            </div>
          ) : null}
        </div>
        <MpEditStatus canEdit={canEdit} saveState={saveState} saveError={saveError} />
        <p className="meta-soft">
          각 일자의 종가로 해당 편입비에 맞춰 리밸런싱하고, 그 사이에는 가격 변동에 따라 비중이 움직입니다.{" "}
          {canEdit ? "행을 선택해 아래에서 편집하세요." : "행을 선택하면 아래에 해당 시점의 구성이 표시됩니다."}
        </p>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{canEdit ? "편입일" : "구분"}</th>
                <th>메모</th>
                <th className="num">ETF</th>
                <th className="num">주식/채권/대체</th>
                <th className="num">합계</th>
                <th>직전 대비 변경</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {versions.map((v, i) => {
                const d = diffEtfVersions(i ? versions[i - 1]! : null, v);
                const parts = i
                  ? [
                      d.added.length ? `편입 ${d.added.join(", ")}` : "",
                      d.removed.length ? `편출 ${d.removed.join(", ")}` : "",
                      d.changed.length
                        ? `비중 ${d.changed
                            .slice(0, 6)
                            .map((c) => `${c.key.replace("CASH:", "")} ${c.from}→${c.to}`)
                            .join(", ")}${d.changed.length > 6 ? " …" : ""}`
                        : "",
                    ].filter(Boolean)
                  : ["최초 편입"];
                const sum = etfWeightSum(v.holdings);
                const part = (a: EtfAsset) => etfWeightSum(v.holdings.filter((h) => h.asset === a)).toFixed(1);
                return (
                  <tr key={v.id} className={v.id === sel.id ? "us-pf-row-active" : undefined}>
                    <td>
                      <strong>{canEdit ? v.date : i === 0 ? "최초 편입" : `리밸런싱 #${i}`}</strong>
                    </td>
                    <td className="meta-soft">{v.note || ""}</td>
                    <td className="num">{v.holdings.filter((h) => h.asset !== "CASH").length}</td>
                    <td className="num">
                      {part("EQ")} / {part("FI")} / {part("ALT")}
                    </td>
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
                          <button type="button" className="ghost-btn" onClick={() => deleteVersion(v.id)} disabled={versions.length <= 1}>
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

      <section className="geo-section" style={{ marginTop: 12 }}>
        <h3 className="geo-section-title">
          편입 ETF <span className="meta-soft">({selIdx === 0 ? "최초 편입" : `리밸런싱 #${selIdx}`})</span>
        </h3>
        <div className="us-pf-form us-pf-alloc-toolbar">
          {canEdit ? (
            <>
              <label>
                편입 일자
                <input type="date" value={sel.date} max={todayIso()} onChange={(e) => e.target.value && updateVersion(sel.id, { date: e.target.value })} />
              </label>
              <label>
                메모
                <input value={sel.note || ""} onChange={(e) => updateVersion(sel.id, { note: e.target.value })} placeholder="예: 채권 듀레이션 축소" />
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
            주식 {byAsset("EQ").toFixed(1)}% · 채권 {byAsset("FI").toFixed(1)}% · 대체 {byAsset("ALT").toFixed(1)}%
            {byAsset("CASH") ? ` · 현금 ${byAsset("CASH").toFixed(1)}%` : ""} · 합계 {total.toFixed(1)}%
            {Math.abs(total - 100) <= 0.05 ? " ✓" : total < 100 ? " (잔여는 달러 현금)" : " (100% 초과 = 차입)"}
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table us-pf-alloc-table mp-edit-table">
            <thead>
              <tr>
                <th>자산</th>
                <th>그룹</th>
                <th>티커</th>
                <th className="num">편입비(%)</th>
                <th>ETF명</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {sel.holdings.map((h) => {
                const meta = etfMeta(h.ticker);
                const row = res?.holdings.find((x) => x.key === etfHoldingKey(h));
                const name = h.asset === "CASH" ? "달러 현금" : meta ? `${meta.name_ko} · ${meta.name}` : row?.name || "";
                if (!canEdit) {
                  return (
                    <tr key={h.id}>
                      <td>{assetLabel(h.asset)}</td>
                      <td>{h.group}</td>
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
                      <select value={h.asset} onChange={(e) => updateHolding(h.id, { asset: e.target.value as EtfAsset })} aria-label="자산">
                        {ETF_ASSETS.map((a) => (
                          <option key={a.key} value={a.key}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input value={h.group} onChange={(e) => updateHolding(h.id, { group: e.target.value })} placeholder="선진 미국" aria-label="그룹" />
                    </td>
                    <td>
                      <input
                        value={h.ticker}
                        onChange={(e) => updateHolding(h.id, { ticker: e.target.value.toUpperCase() })}
                        onBlur={(e) => updateHolding(h.id, { ticker: normalizeEtfTicker(e.target.value) })}
                        placeholder={h.asset === "CASH" ? "USD" : "SPY / 159915.SZ"}
                        aria-label="티커"
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        step={0.1}
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
              {ETF_ASSETS.map((a) => (
                <button key={a.key} type="button" className="ghost-btn" onClick={() => addHolding(a.key)}>
                  + {a.label}
                </button>
              ))}
            </div>
            <details style={{ marginTop: 12 }}>
              <summary className="meta-soft" style={{ cursor: "pointer" }}>
                텍스트로 일괄 입력 / 내보내기
              </summary>
              <p className="meta-soft" style={{ marginTop: 6 }}>
                <code>(주식)</code> / <code>(채권)</code> / <code>(대체)</code> 머리말 다음 줄에 <code>그룹 티커 비중 티커 비중</code>. 메신저 형식(
                <code>주식 합계 60 / 선진 / 미국 spy 26.5 …</code>)도 그대로 붙여넣을 수 있습니다. 중국·홍콩은 159915.SZ · 588000.SS · 2823.HK.
              </p>
              <textarea
                className="us-pf-quick"
                rows={10}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"(주식)\n선진 미국 SPY 26.5 SOXX 3\n(채권)\n미국 국채 VGIT 10.4\n(대체)\n원자재 GLD 1.5"}
              />
              <div className="us-pf-alloc-actions">
                <button type="button" className="tab-btn" onClick={applyBulk}>
                  선택한 편입일에 반영 (덮어쓰기)
                </button>
                <button type="button" className="ghost-btn" onClick={() => setBulkText(formatEtfText(sel.holdings))}>
                  현재 구성 불러오기
                </button>
                {bulkMsg ? <span className="meta-soft">{bulkMsg}</span> : null}
              </div>
            </details>
          </>
        ) : null}
      </section>

      {res?.ok ? <Results res={res} freq={freq} setFreq={setFreq} canEdit={canEdit} /> : null}

      <section className="geo-section" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <h3 className="geo-section-title">자산·테마별 주요 뉴스</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div className="seg">
              {(
                [
                  ["ko", "한국어"],
                  ["en", "English"],
                ] as Array<["ko" | "en", string]>
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
        <p className="meta-soft">최신 편입 구성의 자산·테마(편입비 순) · Google News RSS 최근 1주 헤드라인 (20분 캐시)</p>
        {news && news.length ? (
          <div className="us-pf-universe-chips" style={{ margin: "8px 0" }}>
            <button type="button" className={newsFilter === "all" ? "us-pf-chip us-pf-chip-active" : "us-pf-chip"} onClick={() => setNewsFilter("all")}>
              <strong>전체</strong>
            </button>
            {news.map((b) => (
              <button
                key={b.key}
                type="button"
                className={newsFilter === b.key ? "us-pf-chip us-pf-chip-active" : "us-pf-chip"}
                onClick={() => setNewsFilter(b.key)}
              >
                <strong>{b.label}</strong>
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
              <div key={b.key} className="mp-news-card">
                <div className="mp-news-head">
                  <strong>{b.label}</strong>
                  <span className="meta-soft">
                    {(pf.versions.length ? latestEtfVersion(pf)!.holdings : [])
                      .filter((h) => etfMeta(h.ticker)?.theme === b.key)
                      .map((h) => normalizeEtfTicker(h.ticker))
                      .join(", ")}
                  </span>
                </div>
                {b.error ? <p className="meta-soft">{b.error}</p> : null}
                {!b.items.length && !b.error ? <p className="meta-soft">최근 1주 헤드라인이 없습니다.</p> : null}
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

function Results({ res, freq, setFreq, canEdit }: { res: EtfAnalysis; freq: Freq; setFreq: (f: Freq) => void; canEdit: boolean }) {
  const m = res.metrics!;
  const chart = useMemo(
    () =>
      res.series.map((p) => ({
        t: p.date,
        MP: Math.round(p.port * 100) / 100,
        BM: Math.round(p.bm * 100) / 100,
        ACWI: Math.round(p.eq * 100) / 100,
        "Global Agg": Math.round(p.fi * 100) / 100,
        "대체 BM": Math.round(p.alt * 100) / 100,
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
      lo = Math.min(lo, d.MP, d.BM, d.ACWI, d["Global Agg"], d["대체 BM"]);
      hi = Math.max(hi, d.MP, d.BM, d.ACWI, d["Global Agg"], d["대체 BM"]);
    }
    const pad = Math.max((hi - lo) * 0.06, 0.5);
    return [Math.floor(lo - pad), Math.ceil(hi + pad)] as [number, number];
  }, [chart]);

  const reg: MpRegression | null = freq === "daily" ? res.factors.daily : res.factors.weekly;
  const rbsa: MpStyleRegression | null = freq === "daily" ? res.style.rbsa.daily : res.style.rbsa.weekly;
  const eq = res.equity;
  const bd = res.bonds;
  const rbsaRows = (rbsa?.weights || []).map((w) => ({ ...w, target_pct: res.style.target[w.key] ?? 0 }));
  const assetOf = new Map(res.holdings.map((h) => [h.key, h.asset]));

  return (
    <>
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 className="geo-section-title">
            성과 요약 <span className="meta-soft">· {res.mode === "actual" ? "실제 추적" : "현재 비중 백테스트"}</span>
          </h3>
          <span className="meta-soft">
            {canEdit || res.mode === "backtest" ? `${res.start_date} ~ ${res.as_of}` : `${res.as_of} 기준`} · Rf {fmtPct(res.rf_ann_pct, 2, false)}
          </span>
        </div>
        <p className="meta-soft">BM {res.bm_label}</p>
        <div className="us-pf-stats" style={{ marginTop: 10 }}>
          <Kpi label="MP 누적" v={fmtPct(m.port.total_return_pct)} cls={tone(m.port.total_return_pct)} />
          <Kpi label="BM 누적" v={fmtPct(m.bm.total_return_pct)} cls={tone(m.bm.total_return_pct)} />
          <Kpi label="초과수익" v={fmtPct(m.rel.excess_return_pct)} cls={tone(m.rel.excess_return_pct)} />
          <Kpi
            label="1일"
            v={fmtPct(res.period_returns.find((p) => p.key === "1d")?.port_pct)}
            cls={tone(res.period_returns.find((p) => p.key === "1d")?.port_pct)}
          />
          <Kpi label="변동성(연)" v={fmtPct(m.port.vol_pct, 1, false)} />
          <Kpi label="Sharpe" v={fmtNum(m.port.sharpe)} />
          <Kpi label="MDD" v={fmtPct(m.port.mdd_pct, 1)} cls="down" />
          <Kpi label="TE / IR" v={`${fmtPct(m.rel.tracking_error_pct, 1, false)} / ${fmtNum(m.rel.information_ratio)}`} />
          <Kpi label="가중 보수" v={fmtPct(res.costs.expense_ratio_pct, 2, false)} />
          <Kpi label="가중 분배수익률" v={fmtPct(res.costs.yield_pct, 2, false)} />
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
              <Line type="monotone" dataKey="ACWI" stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="Global Agg" stroke="#a78bfa" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="대체 BM" stroke="#f87171" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
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
                      <td className={`num ${tone(r.excess_pct)}`} style={{ background: heat(r.excess_pct, 3) }}>
                        {fmtPct(r.excess_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {res.monthly.some((r) => r.estimated) ? (
              <p className="meta-soft" style={{ marginTop: 6 }}>
                * 최초 편입 이전 구간이 포함된 수익률 — 최초 편입 비중을 매일 유지했다고 가정한 추정치입니다(당시 미상장 ETF 비중은 현금).
              </p>
            ) : null}
          </div>
          <div>
            <h3 className="geo-section-title">펀드 성과 지표</h3>
            <p className="meta-soft">일간 총수익률(분배금 재투자) · 연환산 {res.ann_factor.toFixed(0)}일 · 무위험수익률 = 미 13주 T-bill</p>
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
                  <Row label="상승 포착률" v={fmtPct(m.rel.up_capture_pct, 1, false)} />
                  <Row label="하락 포착률" v={fmtPct(m.rel.down_capture_pct, 1, false)} />
                  <Row label="BM 대비 승률 (일간)" v={fmtPct(m.rel.hit_ratio_pct, 1, false)} />
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Asset allocation ---------- */}
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">자산배분 vs BM</h3>
        <div className="us-pf-split" style={{ marginTop: 8 }}>
          <div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>자산</th>
                    <th className="num">현재</th>
                    <th className="num">목표</th>
                    <th className="num">BM</th>
                    <th className="num">Active</th>
                    <th className="num">기여</th>
                  </tr>
                </thead>
                <tbody>
                  {res.assets
                    .filter((a) => a.key !== "CASH" || a.port_pct > 0.005 || a.bm_pct > 0.005)
                    .map((a) => (
                      <tr key={a.key}>
                        <td>{a.label}</td>
                        <td className="num">{a.port_pct.toFixed(1)}%</td>
                        <td className="num meta-soft">{a.target_pct.toFixed(1)}%</td>
                        <td className="num">{a.bm_pct.toFixed(1)}%</td>
                        <td className={`num ${tone(a.active_pct)}`} style={{ background: heat(a.active_pct, 5) }}>
                          {fmtPct(a.active_pct, 1)}
                        </td>
                        <td className={`num ${tone(a.contribution_pct)}`}>{fmtPct(a.contribution_pct)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <h3 className="geo-section-title" style={{ marginTop: 14 }}>
              대체 내 구성
            </h3>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>구분</th>
                    <th className="num">포트 비중</th>
                    <th className="num">대체 내</th>
                    <th className="num">BM 대체 내</th>
                    <th>ETF</th>
                  </tr>
                </thead>
                <tbody>
                  {res.alt_mix.map((a) => (
                    <tr key={a.key}>
                      <td>{a.label}</td>
                      <td className="num">{a.port_pct.toFixed(1)}%</td>
                      <td className="num">{a.in_alt_pct.toFixed(0)}%</td>
                      <td className="num meta-soft">{a.bm_in_alt_pct.toFixed(0)}%</td>
                      <td className="meta-soft">{a.tickers.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 className="geo-section-title">PM 그룹</h3>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>자산</th>
                    <th>그룹</th>
                    <th className="num">현재</th>
                    <th className="num">목표</th>
                    <th className="num">기여</th>
                  </tr>
                </thead>
                <tbody>
                  {res.groups
                    .filter((g) => g.asset !== "CASH" || g.port_pct > 0.005)
                    .map((g) => (
                      <tr key={g.key}>
                        <td>{assetLabel(g.asset)}</td>
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
        {res.brinson ? (
          <>
            <h3 className="geo-section-title" style={{ marginTop: 14 }}>
              자산군 성과 요인 (Brinson-Fachler)
            </h3>
            <p className="meta-soft">
              배분 = 자산 비중 차이 효과, 선택 = 자산 내 ETF 선택 효과(BM 지수 대비) · 일별 효과를 GRAP 방식으로 연결(합계 = 누적 초과수익) · 대체 합계는 원자재·리츠·디지털자산 행의 합
            </p>
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
                  {res.brinson.rows
                    .filter((r) => r.segment !== "CASH" || r.port_weight_pct > 0.005 || r.bm_weight_pct > 0.005)
                    .map((r) => {
                      const child = ["cmdty", "reit", "digital"].includes(r.segment);
                      return (
                        <tr key={r.segment} className={child ? "meta-soft" : undefined}>
                          <td style={child ? { paddingLeft: 22 } : undefined}>{r.subtotal ? <strong>{r.label}</strong> : r.label}</td>
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
                      );
                    })}
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
      </section>

      {/* ---------- Equity ---------- */}
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">주식 — 국가별 배분 효과 (vs MSCI ACWI)</h3>
        <p className="meta-soft">
          주식 {eq.weight_pct.toFixed(1)}% 부분만 ETF 보유국가 룩스루로 분석 · 배분 효과 = (MP 국가비중 − ACWI 국가비중) × (국가지수 − ACWI), 국가지수는 MSCI 국가
          ETF(총수익) · 일별 GRAP 연결 · ACWI 국가비중: {eq.country_source}
        </p>
        <div className="us-pf-stats" style={{ marginTop: 10 }}>
          <Kpi label="주식 부분 수익률" v={fmtPct(eq.sleeve_return_pct)} cls={tone(eq.sleeve_return_pct)} />
          <Kpi label="ACWI" v={fmtPct(eq.acwi_return_pct)} cls={tone(eq.acwi_return_pct)} />
          <Kpi label="국가 배분 효과" v={fmtPct(eq.allocation_pct)} cls={tone(eq.allocation_pct)} />
          <Kpi label="국가 내 선택·기타" v={fmtPct(eq.selection_pct)} cls={tone(eq.selection_pct)} />
          <Kpi label="선진 / 신흥 (MP)" v={`${eq.region.port_dm.toFixed(0)}% / ${eq.region.port_em.toFixed(0)}%`} />
          <Kpi label="선진 / 신흥 (ACWI)" v={`${eq.region.bm_dm.toFixed(0)}% / ${eq.region.bm_em.toFixed(0)}%`} />
        </div>
        <div className="us-pf-split" style={{ marginTop: 10 }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>국가</th>
                  <th className="num">MP 주식 내</th>
                  <th className="num">ACWI</th>
                  <th className="num">Active</th>
                  <th className="num" title="국가 ETF 총수익률(분석 기간)">국가지수</th>
                  <th className="num" title="주식 부분 수익률 기준">배분 효과</th>
                  <th className="num" title="포트 전체 수익률 기준(≈ 주식 비중 × 효과)">포트 환산</th>
                </tr>
              </thead>
              <tbody>
                {eq.countries.map((c) => (
                  <tr key={c.key}>
                    <td title={c.proxy ? `국가지수: ${c.proxy}` : "ACWI 수익률 사용"}>
                      {c.label}
                      {c.em ? <span className="meta-soft"> · EM</span> : null}
                    </td>
                    <td className="num">{c.port_pct.toFixed(1)}%</td>
                    <td className="num">{c.bm_pct.toFixed(1)}%</td>
                    <td className={`num ${tone(c.active_pct)}`} style={{ background: heat(c.active_pct, 6) }}>
                      {fmtPct(c.active_pct, 1)}
                    </td>
                    <td className={`num ${tone(c.bm_ret_pct)}`}>{fmtPct(c.bm_ret_pct, 1)}</td>
                    <td className={`num ${tone(c.allocation_pct)}`}>{fmtPct(c.allocation_pct)}</td>
                    <td className={`num ${tone(c.allocation_total_pct)}`}>{fmtPct(c.allocation_total_pct)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="meta-soft" colSpan={5} title="Σ ACWI 비중 × 국가 ETF 수익률 − ACWI 수익률">
                    국가지수 대용치 괴리(참고)
                  </td>
                  <td className="num meta-soft">{fmtPct(eq.proxy_gap_pct)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="kr-chart" style={{ height: Math.max(280, Math.min(eq.countries.length, 16) * 24) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={eq.countries.slice(0, 16)} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fill: "#8fa3b8", fontSize: 10 }} unit="%" />
                <YAxis type="category" dataKey="label" tick={{ fill: "#8fa3b8", fontSize: 11 }} width={64} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)}%`} />
                <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                <Bar dataKey="port_pct" name="MP 주식 내" fill="#60a5fa" isAnimationActive={false} />
                <Bar dataKey="bm_pct" name="ACWI" fill="#e8c547" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="us-pf-split" style={{ marginTop: 14 }}>
          <div>
            <h3 className="geo-section-title">주식 업종비 (룩스루)</h3>
            <p className="meta-soft">
              ETF별 Yahoo 업종 구성 × 편입비 vs ACWI(동일 분류) · PER {fmtNum(eq.pe, 1)} / ACWI {fmtNum(eq.bm_pe, 1)} · PBR {fmtNum(eq.pb, 1)} / ACWI{" "}
              {fmtNum(eq.bm_pb, 1)}
            </p>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>업종</th>
                    <th className="num">MP 주식 내</th>
                    <th className="num">ACWI</th>
                    <th className="num">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {eq.sectors.map((s) => (
                    <tr key={s.key}>
                      <td>{s.label}</td>
                      <td className="num">{s.port_pct.toFixed(1)}%</td>
                      <td className="num">{s.bm_pct.toFixed(1)}%</td>
                      <td className={`num ${tone(s.active_pct)}`} style={{ background: heat(s.active_pct, 10) }}>
                        {fmtPct(s.active_pct, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="kr-chart" style={{ height: Math.max(260, eq.sectors.length * 26) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={eq.sectors} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fill: "#8fa3b8", fontSize: 10 }} unit="%" />
                <YAxis type="category" dataKey="label" tick={{ fill: "#8fa3b8", fontSize: 11 }} width={78} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)}%`} />
                <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                <Bar dataKey="port_pct" name="MP 주식 내" fill="#60a5fa" isAnimationActive={false} />
                <Bar dataKey="bm_pct" name="ACWI" fill="#e8c547" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* ---------- Bonds ---------- */}
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">채권 — 듀레이션·신용 (vs Bloomberg Global Agg)</h3>
        <p className="meta-soft">
          듀레이션은 운용사 공시 근사치(2026), 금리 민감도는 최근 1년 주간 수익률을 미 5년 금리 변화에 회귀한 실측치(해외·물가채·장기채는 5년 금리와 괴리) · 신용등급·분배수익률은 Yahoo
        </p>
        <div className="us-pf-stats" style={{ marginTop: 10 }}>
          <Kpi label="채권 비중 (BM)" v={`${bd.weight_pct.toFixed(1)}% (${(res.bm.fi).toFixed(0)}%)`} />
          <Kpi label="듀레이션 (BM)" v={`${fmtNum(bd.duration, 1)} (${fmtNum(bd.bm_duration, 1)})`} />
          <Kpi label="5Y 금리 민감도 (BM)" v={`${fmtNum(bd.duration_emp, 1)} (${fmtNum(bd.bm_duration_emp, 1)})`} />
          <Kpi label="포트 전체 듀레이션 기여 (BM)" v={`${fmtNum(bd.duration_contrib, 2)} (${fmtNum(bd.bm_duration_contrib, 2)})`} />
          <Kpi label="채권 분배수익률" v={fmtPct(bd.yield_pct, 2, false)} />
          <Kpi label="채권 부분 수익률" v={fmtPct(bd.sleeve_return_pct)} cls={tone(bd.sleeve_return_pct)} />
          <Kpi label="Global Agg / 헤지" v={`${fmtPct(bd.bm_return_pct)} / ${fmtPct(bd.bm_hedged_return_pct)}`} />
        </div>
        <div className="us-pf-split" style={{ marginTop: 10 }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>그룹</th>
                  <th>티커</th>
                  <th className="num">비중</th>
                  <th className="num">듀레이션</th>
                  <th className="num">5Y 민감도</th>
                  <th className="num">분배수익률</th>
                  <th>주요 등급</th>
                </tr>
              </thead>
              <tbody>
                {bd.rows.map((r) => (
                  <tr key={r.ticker}>
                    <td className="meta-soft">{r.group}</td>
                    <td title={r.name_ko}>
                      <strong>{r.ticker}</strong> <span className="meta-soft">{r.name_ko}</span>
                    </td>
                    <td className="num">{r.weight_pct.toFixed(1)}%</td>
                    <td className="num">{fmtNum(r.duration, 1)}</td>
                    <td className="num">{fmtNum(r.duration_emp, 1)}</td>
                    <td className="num">{fmtPct(r.yield_pct, 2, false)}</td>
                    <td className="meta-soft">{r.top_rating || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="kr-chart" style={{ height: Math.max(240, bd.credit.length * 28) }}>
            <p className="meta-soft">채권 신용등급 구성 (채권 부분 = 100%)</p>
            <ResponsiveContainer width="100%" height="90%">
              <BarChart data={bd.credit} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fill: "#8fa3b8", fontSize: 10 }} unit="%" />
                <YAxis type="category" dataKey="label" tick={{ fill: "#8fa3b8", fontSize: 11 }} width={78} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)}%`} />
                <Bar dataKey="pct" name="비중" fill="#a78bfa" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* ---------- Holdings ---------- */}
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">편입 ETF 현황</h3>
        <p className="meta-soft">
          USD 총수익 기준(분배금 재투자, 중국·홍콩 ETF는 달러 환산). 기여도는 설정일 NAV 대비 누적 손익(%p)으로 합계가 MP 누적수익률과 일치합니다.
        </p>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="data-table mp-hold-table">
            <thead>
              <tr>
                <th>자산</th>
                <th>그룹</th>
                <th>티커</th>
                <th>ETF명</th>
                <th className="num">목표</th>
                <th className="num">현재</th>
                {canEdit ? <th>편입일</th> : null}
                <th className="num">현재가</th>
                <th className="num" title="각 ETF의 최근 거래일 기준">1일</th>
                <th className="num" title="최근 1개월(30일) 총수익률, 달러 기준">1개월</th>
                <th className="num">기여</th>
                <th className="num">주간 기여</th>
                <th className="num">보수</th>
                <th className="num">분배수익률</th>
              </tr>
            </thead>
            <tbody>
              {res.holdings
                .filter((h) => h.asset !== "CASH" || Math.abs(h.current_pct) > 0.005 || h.target_pct > 0)
                .map((h) => (
                  <tr key={h.key} className={h.status === "exited" ? "meta-soft" : undefined}>
                    <td>{assetLabel(h.asset)}</td>
                    <td className="meta-soft">{h.group}</td>
                    <td>
                      <strong>{h.ticker}</strong>
                      {h.status === "pending" ? <span className="meta-soft"> · 편입대기</span> : null}
                      {h.status === "exited" ? <span className="meta-soft"> · 편출</span> : null}
                    </td>
                    <td className="meta-soft" title={h.name}>
                      {h.name_ko || h.name}
                    </td>
                    <td className="num">{h.target_pct.toFixed(1)}%</td>
                    <td className="num">{h.current_pct.toFixed(2)}%</td>
                    {canEdit ? <td className="meta-soft">{h.first_date || "—"}</td> : null}
                    <td className="num">{h.asset === "CASH" ? "—" : fmtPrice(h.last_price, h.currency)}</td>
                    <td className={`num ${tone(h.day_change_pct)}`}>{fmtPct(h.day_change_pct)}</td>
                    <td className={`num ${tone(h.month_return_pct)}`}>{fmtPct(h.month_return_pct)}</td>
                    <td className={`num ${tone(h.contribution_pct)}`}>{fmtPct(h.contribution_pct)}</td>
                    <td className={`num ${tone(h.week_contribution_pct)}`}>{fmtPct(h.week_contribution_pct)}</td>
                    <td className="num">{fmtPct(h.expense_ratio_pct, 2, false)}</td>
                    <td className="num">{fmtPct(h.yield_pct, 2, false)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- Returns-based asset mix ---------- */}
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 className="geo-section-title">수익률 기반 실효 자산배분 (RBSA)</h3>
          <FreqToggle freq={freq} setFreq={setFreq} />
        </div>
        <p className="meta-soft">
          MP 수익률을 BM 구성지수에 비음·합 100% 제약으로 회귀{rbsa ? ` · n=${rbsa.n} · R² ${fmtNum(rbsa.r2)}` : ""} · 주식 추정치가 목표보다 높으면 고베타(반도체·신흥국)
          틸트, 채권이 낮고 현금이 높으면 저듀레이션 성향으로 해석합니다.
        </p>
        <div className="us-pf-split" style={{ marginTop: 8 }}>
          {rbsa ? (
            <div className="kr-chart" style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rbsaRows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fill: "#8fa3b8", fontSize: 10 }} unit="%" domain={[0, 100]} />
                  <YAxis type="category" dataKey="label" tick={{ fill: "#8fa3b8", fontSize: 11 }} width={130} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)}%`} />
                  <Legend wrapperStyle={{ color: "#8fa3b8", fontSize: 12 }} />
                  <Bar dataKey="weight_pct" name="실효 비중" isAnimationActive={false}>
                    {rbsaRows.map((_, i) => (
                      <Cell key={i} fill={STYLE_COLORS[i % STYLE_COLORS.length]} />
                    ))}
                  </Bar>
                  <Bar dataKey="target_pct" name="BM 비중" fill="rgba(232,197,71,0.55)" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="empty">관측치가 부족합니다. 기간을 늘리거나 백테스트 모드를 사용하세요.</p>
          )}
          {res.style.rolling.length ? (
            <div className="kr-chart" style={{ height: 250 }}>
              <p className="meta-soft">롤링 실효 배분 (63거래일 창, 일간)</p>
              <ResponsiveContainer width="100%" height="90%">
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
          ) : (
            <p className="meta-soft">롤링 분석은 약 4개월(83거래일) 이상 데이터가 필요합니다. 백테스트 모드에서 확인하세요.</p>
          )}
        </div>
      </section>

      {/* ---------- Factors ---------- */}
      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 className="geo-section-title">멀티에셋 팩터 분석</h3>
          <FreqToggle freq={freq} setFreq={setFreq} />
        </div>
        <p className="meta-soft">
          MP 초과수익(−Rf)을 자산 팩터에 다중회귀: 주식(ACWI−Rf), 금리(IEF−Rf), 크레딧(HYG−IEF), 달러(UUP−Rf), 원자재(DJP−Rf), 비트코인(BTC−Rf), 신흥국 상대(EEM−ACWI). |t| ≥ 2이면
          통계적으로 유의.
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
                n={reg.n} ({reg.freq === "daily" ? "일간" : "주간"}) · R² {fmtNum(reg.r2)} · 조정 R² {fmtNum(reg.adj_r2)} · 잔차 변동성 {fmtPct(reg.resid_vol_pct, 1, false)}
              </p>
            </div>
            <div className="kr-chart" style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reg.betas} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fill: "#8fa3b8", fontSize: 10 }} />
                  <YAxis type="category" dataKey="label" tick={{ fill: "#8fa3b8", fontSize: 11 }} width={96} />
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
          <p className="empty">{freq === "weekly" ? "주간" : "일간"} 관측치가 부족해 팩터 회귀를 생략했습니다. 백테스트 모드(6개월 이상)로 사전 노출을 확인하세요.</p>
        )}
        {res.factors.holdings.length ? (
          <>
            <h3 className="geo-section-title" style={{ marginTop: 14 }}>
              ETF별 팩터 노출 (일간)
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
                  {res.factors.holdings.map((h, i, all) => (
                    <Fragment key={h.key}>
                      {i > 0 && assetOf.get(all[i - 1]!.key) !== assetOf.get(h.key) ? (
                        <tr>
                          <td colSpan={99} className="meta-soft">
                            {assetLabel(assetOf.get(h.key) || "EQ")}
                          </td>
                        </tr>
                      ) : null}
                      <tr>
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
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <section className="geo-section" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">데이터 메모</h3>
        <ul className="ideas-summary">
          {[...res.notes, ...eq.look_through_notes].map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>
            BM 대용치: MSCI ACWI ← ACWI, Bloomberg Global Aggregate ← {res.bm_fi_symbol === "AGGG.L" ? "AGGG.L(iShares Global Agg, USD 비헤지)" : "BNDW"}, 원자재종합 ← DJP(BCOM TR),
            리츠종합 ← REET(FTSE EPRA Nareit Global REITs), 비트코인 ← BTC-USD(현물, 주말 변동은 다음 거래일 반영)
          </li>
        </ul>
        <p className="meta-soft" style={{ marginTop: 6 }}>
          가격: Yahoo Finance 수정종가(분배금 재투자 총수익) · 최종일{" "}
          {Object.entries(res.last_dates)
            .map(([k, v]) => `${k} ${v || "—"}`)
            .join(" · ")}
        </p>
      </section>
    </>
  );
}

