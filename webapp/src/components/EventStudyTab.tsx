"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  CATEGORY_META,
  MAX_PERIODS,
  newCustomPeriod,
  type EpisodeAssetResult,
  type EpisodeCategory,
  type EpisodePeriod,
  type EventEpisodesPayload,
  type SuggestedEpisode,
} from "@/lib/eventEpisodes";
import {
  DEFAULT_FOCUS_MONTHS,
  EXAMPLE_TICKERS,
  LOOKBACK_YEARS,
  MONTH_OPTIONS,
  type SeasonalityPayload,
} from "@/lib/seasonality";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function toneClass(n?: number | null): string {
  if (n == null || Number.isNaN(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function heatBg(pct: number | null, cap = 18): string {
  if (pct == null || Number.isNaN(pct)) return "transparent";
  const t = Math.max(-1, Math.min(1, pct / cap));
  if (t >= 0) return `rgba(61, 214, 140, ${0.1 + 0.58 * t})`;
  return `rgba(248, 113, 113, ${0.1 + 0.58 * -t})`;
}

function shortLabel(label: string, max = 10): string {
  return label.length > max ? `${label.slice(0, max)}…` : label;
}

type StudyMode = "episodes" | "seasonality";

export default function EventStudyTab() {
  const [mode, setMode] = useState<StudyMode>("episodes");

  return (
    <div className="geo-tab macro-tab eventstudy-tab">
      <section className="panel">
        <div className="panel-head eventstudy-hero">
          <div>
            <h2 className="panel-title">이벤트 스터디</h2>
            <p className="macro-subhead">
              {mode === "episodes"
                ? "과거 코스피·코스닥 수익률과 코스피 업종별 수익률을 구간별로 나란히 비교합니다. 날짜를 직접 넣거나, 원달러·유가 등 과거 사건이 있던 구간을 골라 볼 수 있습니다."
                : `특정 종목의 과거 ${LOOKBACK_YEARS}년 월별 수익률을 분석해 집중 시즌(기본 6·7·8·9월) 계절성을 Welch t-검정으로 검증합니다.`}
            </p>
          </div>
          <div className="seg" role="tablist" aria-label="이벤트 스터디 모드">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "episodes"}
              className={mode === "episodes" ? "active" : ""}
              onClick={() => setMode("episodes")}
            >
              구간 비교
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "seasonality"}
              className={mode === "seasonality" ? "active" : ""}
              onClick={() => setMode("seasonality")}
            >
              종목 계절성
            </button>
          </div>
        </div>
      </section>

      {mode === "episodes" ? <EpisodesPanel /> : <SeasonalityPanel />}
    </div>
  );
}

function EpisodesPanel() {
  const [suggestions, setSuggestions] = useState<SuggestedEpisode[]>([]);
  const [categories, setCategories] = useState(CATEGORY_META);
  const [category, setCategory] = useState<EpisodeCategory | "all">("all");
  const [periods, setPeriods] = useState<EpisodePeriod[]>([]);
  const [data, setData] = useState<EventEpisodesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const runCompare = useCallback(async (next: EpisodePeriod[]) => {
    if (!next.length) {
      setError("비교할 구간을 1개 이상 선택해 주세요.");
      return;
    }
    setComparing(true);
    setError(null);
    try {
      const res = await fetch("/api/event-episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periods: next }),
      });
      const payload = (await res.json()) as EventEpisodesPayload;
      if (!payload.ok) {
        setError(payload.error || "비교에 실패했습니다.");
        return;
      }
      setData(payload);
      setNote(payload.note || null);
      setFocusId((prev) =>
        next.some((p) => p.id === prev) ? prev : next[0]?.id || null,
      );
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "네트워크 오류");
    } finally {
      setComparing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/event-episodes?compute=defaults");
        const payload = (await res.json()) as EventEpisodesPayload;
        if (cancelled) return;
        if (!payload.ok) {
          setError(payload.error || "제안 구간을 불러오지 못했습니다.");
          return;
        }
        setSuggestions(payload.suggestions || []);
        if (payload.categories?.length) setCategories(payload.categories);
        const selected =
          payload.periods?.length
            ? payload.periods
            : (payload.suggestions || []).filter((s) =>
                (payload.defaults || []).includes(s.id),
              );
        setPeriods(selected);
        if (payload.assets?.length) {
          setData(payload);
          setNote(payload.note || null);
          setFocusId(selected[0]?.id || null);
        }
      } catch (exc) {
        if (!cancelled) {
          setError(exc instanceof Error ? exc.message : "네트워크 오류");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleSuggestions = useMemo(() => {
    if (category === "all") return suggestions;
    return suggestions.filter((s) => s.category === category);
  }, [suggestions, category]);

  const stale = useMemo(() => {
    if (!data?.periods?.length) return false;
    const key = (rows: EpisodePeriod[]) =>
      rows.map((p) => `${p.id}:${p.start}:${p.end}`).join("|");
    return key(data.periods) !== key(periods);
  }, [data, periods]);

  const selectedIds = useMemo(() => new Set(periods.map((p) => p.id)), [periods]);

  const markets = useMemo(
    () => (data?.assets || []).filter((a) => a.kind === "market"),
    [data],
  );
  const drivers = useMemo(
    () => (data?.assets || []).filter((a) => a.kind === "driver"),
    [data],
  );
  const sectors = useMemo(
    () => (data?.assets || []).filter((a) => a.kind === "sector"),
    [data],
  );

  const barData = useMemo(() => {
    const kospi = markets.find((a) => a.id === "kospi");
    const kosdaq = markets.find((a) => a.id === "kosdaq");
    return (data?.periods || []).map((p) => ({
      name: shortLabel(p.label, 8),
      full: `${p.label} (${p.start.slice(2)}~${p.end.slice(2)})`,
      kospi: kospi?.returns.find((r) => r.period_id === p.id)?.return_pct ?? null,
      kosdaq: kosdaq?.returns.find((r) => r.period_id === p.id)?.return_pct ?? null,
    }));
  }, [data, markets]);

  const focusPeriod = (data?.periods || []).find((p) => p.id === focusId) || data?.periods?.[0];
  const sectorRank = useMemo(() => {
    if (!focusPeriod) return [];
    return sectors
      .map((s) => {
        const ret = s.returns.find((r) => r.period_id === focusPeriod.id);
        return {
          id: s.id,
          label: s.label,
          note: s.note,
          return_pct: ret?.return_pct ?? null,
        };
      })
      .filter((s) => s.return_pct != null)
      .sort((a, b) => (b.return_pct || 0) - (a.return_pct || 0));
  }, [sectors, focusPeriod]);

  function toggleSuggestion(item: SuggestedEpisode) {
    setPeriods((prev) => {
      if (prev.some((p) => p.id === item.id)) {
        return prev.filter((p) => p.id !== item.id);
      }
      if (prev.length >= MAX_PERIODS) {
        setError(`구간은 최대 ${MAX_PERIODS}개까지 비교할 수 있습니다.`);
        return prev;
      }
      setError(null);
      return [...prev, item];
    });
  }

  function updatePeriod(id: string, patch: Partial<EpisodePeriod>) {
    setPeriods((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch, source: "custom" } : p)),
    );
  }

  function removePeriod(id: string) {
    setPeriods((prev) => prev.filter((p) => p.id !== id));
  }

  function addCustom() {
    setPeriods((prev) => {
      if (prev.length >= MAX_PERIODS) {
        setError(`구간은 최대 ${MAX_PERIODS}개까지 비교할 수 있습니다.`);
        return prev;
      }
      setError(null);
      return [...prev, newCustomPeriod(prev.length)];
    });
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">기간 설정</h3>
            <p className="macro-subhead">
              왼쪽에서 날짜를 직접 고르거나, 오른쪽 제안 구간을 눌러 비교 세트에 담으세요. 최대{" "}
              {MAX_PERIODS}개.
            </p>
          </div>
        </div>

        <div className="eventstudy-split">
          <div className="eventstudy-editor">
            {periods.length ? (
              periods.map((p, i) => (
                <div key={p.id} className="eventstudy-period-row">
                  <input
                    type="text"
                    value={p.label}
                    aria-label={`${i + 1}번 구간 이름`}
                    onChange={(e) => updatePeriod(p.id, { label: e.target.value })}
                    placeholder="구간 이름"
                  />
                  <input
                    type="date"
                    value={p.start}
                    aria-label={`${p.label} 시작일`}
                    onChange={(e) => updatePeriod(p.id, { start: e.target.value })}
                  />
                  <span className="eventstudy-tilde">~</span>
                  <input
                    type="date"
                    value={p.end}
                    aria-label={`${p.label} 종료일`}
                    onChange={(e) => updatePeriod(p.id, { end: e.target.value })}
                  />
                  <button
                    type="button"
                    className="eventstudy-remove"
                    onClick={() => removePeriod(p.id)}
                    aria-label={`${p.label} 삭제`}
                  >
                    삭제
                  </button>
                </div>
              ))
            ) : (
              <p className="empty">선택된 구간이 없습니다. 제안을 고르거나 직접 추가하세요.</p>
            )}
            <div className="eventstudy-actions">
              <button type="button" className="btn ghost" onClick={addCustom}>
                직접 입력 추가
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={comparing || loading || !periods.length}
                onClick={() => void runCompare(periods)}
              >
                {comparing ? "비교 중…" : "수익률 비교"}
              </button>
            </div>
            {stale ? (
              <p className="eventstudy-stale">구간이 바뀌었습니다. 수익률 비교를 다시 누르면 표가 갱신됩니다.</p>
            ) : null}
          </div>

          <div className="eventstudy-suggest">
            <div className="eventstudy-suggest-head">
              <span>과거 사건 제안</span>
              <p>
                원달러·WTI 추세에서 탐지한 구간과, 잘 알려진 위기·사이클을 함께 보여 줍니다.
              </p>
            </div>
            <div className="eventstudy-cat-row">
              <button
                type="button"
                className={`eventstudy-cat ${category === "all" ? "active" : ""}`}
                onClick={() => setCategory("all")}
              >
                전체
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`eventstudy-cat ${category === c.id ? "active" : ""}`}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="eventstudy-chips">
              {loading && !suggestions.length ? (
                <p className="empty">제안 구간 불러오는 중…</p>
              ) : null}
              {visibleSuggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`eventstudy-chip ${selectedIds.has(s.id) ? "active" : ""}`}
                  onClick={() => toggleSuggestion(s)}
                  title={s.note || s.label}
                >
                  <strong>{s.label}</strong>
                  <em>
                    {s.start.slice(2)} ~ {s.end.slice(2)}
                    {s.driver?.change_pct != null
                      ? ` · ${s.driver.label} ${fmtPct(s.driver.change_pct)}`
                      : ""}
                  </em>
                </button>
              ))}
            </div>
          </div>
        </div>
        {error ? <p className="empty err">{error}</p> : null}
      </section>

      {loading && !data ? (
        <p className="empty">기본 구간 수익률을 계산하는 중…</p>
      ) : null}

      {data?.ok && data.periods?.length ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">코스피 · 코스닥 구간 수익률</h3>
                <p className="macro-subhead">
                  각 구간의 첫 거래일 종가 대비 마지막 거래일 종가. 막대를 나란히 두면 사건별
                  시장 반응이 바로 보입니다.
                </p>
              </div>
            </div>
            <div className="eventstudy-chart eventstudy-chart-lg">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.full || ""}
                    formatter={(value: number, name: string) => [
                      fmtPct(value),
                      name === "kospi" ? "코스피" : "코스닥",
                    ]}
                  />
                  <Legend
                    formatter={(value) => (value === "kospi" ? "코스피" : "코스닥")}
                  />
                  <Bar dataKey="kospi" name="kospi" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="kosdaq" name="kosdaq" fill="#c084fc" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <MarketSnapRow markets={markets} periods={data.periods} />
          </section>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">업종별 수익률 나란히 보기</h3>
                <p className="macro-subhead">
                  행은 시장·환율·유가·코스피 200 업종 ETF, 열은 선택한 구간입니다. 열 제목을
                  누르면 오른쪽 순위 차트가 바뀝니다.
                </p>
              </div>
            </div>

            <div className="eventstudy-heat-layout">
              <div className="eventstudy-table-wrap">
                <HeatTable
                  periods={data.periods}
                  groups={[
                    { title: "시장", rows: markets },
                    { title: "거시", rows: drivers },
                    { title: "업종 ETF", rows: sectors },
                  ]}
                  focusId={focusPeriod?.id || null}
                  onFocus={setFocusId}
                />
              </div>

              <div className="eventstudy-rank">
                <h4 className="eventstudy-rank-title">
                  {focusPeriod ? `${focusPeriod.label} 업종 순위` : "업종 순위"}
                </h4>
                {focusPeriod ? (
                  <p className="macro-subhead">
                    {focusPeriod.start} ~ {focusPeriod.end}
                    {focusPeriod.note ? ` · ${focusPeriod.note}` : ""}
                  </p>
                ) : null}
                <div className="eventstudy-chart">
                  <ResponsiveContainer width="100%" height={Math.max(280, sectorRank.length * 28)}>
                    <BarChart
                      data={sectorRank}
                      layout="vertical"
                      margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={78}
                        tick={{ fill: "#c5d0dc", fontSize: 11 }}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(value: number) => [fmtPct(value), "수익률"]}
                      />
                      <Bar dataKey="return_pct" radius={[0, 4, 4, 0]}>
                        {sectorRank.map((row) => (
                          <Cell
                            key={row.id}
                            fill={(row.return_pct || 0) >= 0 ? "#3dd68c" : "#f87171"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            {note ? <p className="eventstudy-foot">{note}</p> : null}
          </section>
        </>
      ) : null}
    </>
  );
}

function MarketSnapRow({
  markets,
  periods,
}: {
  markets: EpisodeAssetResult[];
  periods: EpisodePeriod[];
}) {
  return (
    <div className="eventstudy-snap-grid">
      {periods.map((p) => (
        <article key={p.id} className="macro-snap-card">
          <span className="macro-snap-label">{p.label}</span>
          {markets.map((m) => {
            const ret = m.returns.find((r) => r.period_id === p.id)?.return_pct;
            return (
              <div key={m.id} className="eventstudy-snap-line">
                <em>{m.label}</em>
                <strong className={toneClass(ret)}>{fmtPct(ret)}</strong>
              </div>
            );
          })}
        </article>
      ))}
    </div>
  );
}

function HeatTable({
  periods,
  groups,
  focusId,
  onFocus,
}: {
  periods: EpisodePeriod[];
  groups: Array<{ title: string; rows: EpisodeAssetResult[] }>;
  focusId: string | null;
  onFocus: (id: string) => void;
}) {
  return (
    <table className="eventstudy-table eventstudy-heat">
      <thead>
        <tr>
          <th>항목</th>
          {periods.map((p) => (
            <th key={p.id}>
              <button
                type="button"
                className={`eventstudy-col-btn ${focusId === p.id ? "active" : ""}`}
                onClick={() => onFocus(p.id)}
              >
                {p.label}
                <span>
                  {p.start.slice(2)}~{p.end.slice(2)}
                </span>
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <HeatGroup key={g.title} title={g.title} rows={g.rows} periods={periods} />
        ))}
      </tbody>
    </table>
  );
}

function HeatGroup({
  title,
  rows,
  periods,
}: {
  title: string;
  rows: EpisodeAssetResult[];
  periods: EpisodePeriod[];
}) {
  if (!rows.length) return null;
  return (
    <>
      <tr className="eventstudy-heat-section">
        <td colSpan={periods.length + 1}>{title}</td>
      </tr>
      {rows.map((row) => (
        <tr key={row.id}>
          <td>
            <span className="eventstudy-asset-name">{row.label}</span>
            {row.note ? <span className="eventstudy-asset-note">{row.note}</span> : null}
          </td>
          {periods.map((p) => {
            const ret = row.returns.find((r) => r.period_id === p.id);
            const pct = ret?.return_pct ?? null;
            return (
              <td
                key={p.id}
                className={toneClass(pct)}
                style={{ background: heatBg(pct, row.kind === "driver" ? 25 : 18) }}
                title={
                  ret?.error
                    ? ret.error
                    : ret?.start_date && ret.end_date
                      ? `${ret.start_date} → ${ret.end_date}`
                      : undefined
                }
              >
                {pct == null ? ret?.error || "—" : fmtPct(pct)}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function seasonalityTone(tone?: string): string {
  switch (tone) {
    case "positive":
      return "up";
    case "negative":
      return "down";
    case "caution":
      return "flat";
    default:
      return "flat";
  }
}

function SeasonalityPanel() {
  const [ticker, setTicker] = useState("");
  const [focusMonths, setFocusMonths] = useState<number[]>([...DEFAULT_FOCUS_MONTHS]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SeasonalityPayload | null>(null);

  const chartData = useMemo(() => {
    if (!data?.monthly_stats?.length) return [];
    return data.monthly_stats.map((row) => ({
      name: row.label_ko,
      mean: row.mean_pct,
      winRate: row.win_rate_pct,
      inFocus: row.in_focus,
    }));
  }, [data]);

  const runAnalysis = useCallback(async () => {
    const q = ticker.trim();
    if (!q) {
      setError("티커를 입력해 주세요.");
      return;
    }
    if (!focusMonths.length) {
      setError("집중 시즌 월을 1개 이상 선택해 주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const months = focusMonths.slice().sort((a, b) => a - b).join(",");
      const res = await fetch(
        `/api/seasonality?ticker=${encodeURIComponent(q)}&months=${months}`,
      );
      const payload = (await res.json()) as SeasonalityPayload;
      if (!payload.ok) {
        setError(payload.error || "분석에 실패했습니다.");
        setData(null);
        return;
      }
      setData(payload);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "네트워크 오류");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ticker, focusMonths]);

  function toggleMonth(month: number) {
    setFocusMonths((prev) => {
      if (prev.includes(month)) {
        const next = prev.filter((m) => m !== month);
        return next.length ? next : prev;
      }
      return [...prev, month].sort((a, b) => a - b);
    });
  }

  function applyExample(exampleTicker: string) {
    setTicker(exampleTicker);
    setFocusMonths([...DEFAULT_FOCUS_MONTHS]);
  }

  return (
    <>
      <section className="panel">
        <div className="eventstudy-form">
          <label className="eventstudy-field">
            <span>티커</span>
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="005180, 빙그레, CARR …"
              onKeyDown={(e) => {
                if (e.key === "Enter") void runAnalysis();
              }}
            />
          </label>

          <div className="eventstudy-months">
            <span className="eventstudy-months-label">집중 시즌 (월)</span>
            <div className="eventstudy-month-grid">
              {MONTH_OPTIONS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  className={`eventstudy-month-btn ${focusMonths.includes(m.value) ? "active" : ""}`}
                  onClick={() => toggleMonth(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="eventstudy-actions">
            <button
              type="button"
              className="btn primary"
              disabled={loading}
              onClick={() => void runAnalysis()}
            >
              {loading ? "분석 중…" : "계절성 검증"}
            </button>
          </div>

          <div className="eventstudy-examples">
            <span>예시:</span>
            {EXAMPLE_TICKERS.map((ex) => (
              <button
                key={ex.ticker}
                type="button"
                className="eventstudy-example-btn"
                onClick={() => applyExample(ex.ticker)}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>
        {error ? <p className="empty err">{error}</p> : null}
      </section>

      {data?.ok ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">
                  {data.display || data.symbol}
                  <span className="slot-badge">{data.symbol}</span>
                </h3>
                <p className="macro-subhead">
                  {data.start_date} ~ {data.end_date} · {data.n_months}개월 · 집중 시즌{" "}
                  {data.focus_label_ko}
                  {data.source ? ` · ${data.source}` : ""}
                </p>
              </div>
              <span className={`slot-badge ${seasonalityTone(data.verdict?.tone)}`}>
                {data.verdict?.label || "—"}
              </span>
            </div>

            <p className="eventstudy-summary">{data.verdict?.summary_ko}</p>

            <div className="macro-snap-grid">
              <article className="macro-snap-card">
                <span className="macro-snap-label">집중 시즌 평균</span>
                <strong className={`macro-snap-value ${seasonalityTone("positive")}`}>
                  {fmtPct(data.focus_mean_pct, 2)}
                </strong>
                <em className="macro-snap-sub">n={data.focus_n}</em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">나머지 달 평균</span>
                <strong className="macro-snap-value">{fmtPct(data.other_mean_pct, 2)}</strong>
                <em className="macro-snap-sub">n={data.other_n}</em>
              </article>
              <article className="macro-snap-card">
                <span className="macro-snap-label">차이 (집중−기타)</span>
                <strong
                  className={`macro-snap-value ${seasonalityTone(
                    (data.diff_focus_minus_other_pct ?? 0) > 0 ? "positive" : "negative",
                  )}`}
                >
                  {fmtPct(data.diff_focus_minus_other_pct, 2)}
                </strong>
                <em className="macro-snap-sub">
                  p=
                  {data.ttest_p != null && !Number.isNaN(data.ttest_p)
                    ? data.ttest_p.toFixed(3)
                    : "—"}
                  {data.verdict?.significant ? " · 유의" : ""}
                </em>
              </article>
            </div>
          </section>

          <section className="panel">
            <h3 className="panel-title">월별 평균 수익률</h3>
            <div className="eventstudy-chart">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <YAxis
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number, name: string) => {
                      if (name === "mean") return [fmtPct(value, 2), "평균 수익률"];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="mean" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={entry.inFocus ? "#f59e0b" : "#60a5fa"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="macro-subhead">주황색 막대 = 집중 시즌 · 파란색 = 나머지 달</p>
          </section>

          <section className="panel">
            <h3 className="panel-title">월별 상세</h3>
            <div className="eventstudy-table-wrap">
              <table className="eventstudy-table">
                <thead>
                  <tr>
                    <th>월</th>
                    <th>평균</th>
                    <th>중앙값</th>
                    <th>승률</th>
                    <th>표본</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.monthly_stats || []).map((row) => (
                    <tr key={row.month} className={row.in_focus ? "focus" : ""}>
                      <td>
                        {row.in_focus ? "★ " : ""}
                        {row.label_ko}
                      </td>
                      <td
                        className={toneClass(row.mean_pct)}
                      >
                        {fmtPct(row.mean_pct, 2)}
                      </td>
                      <td>{fmtPct(row.median_pct, 2)}</td>
                      <td>
                        {row.win_rate_pct != null && !Number.isNaN(row.win_rate_pct)
                          ? `${row.win_rate_pct.toFixed(0)}%`
                          : "—"}
                      </td>
                      <td>{row.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {(data.yearly_focus?.length ?? 0) > 0 ? (
            <section className="panel">
              <h3 className="panel-title">연도별 집중 시즌 누적 수익률</h3>
              <div className="eventstudy-year-grid">
                {data.yearly_focus!.map((row) => (
                  <div
                    key={row.year}
                    className={`eventstudy-year-card ${row.return_pct > 0 ? "up" : row.return_pct < 0 ? "down" : "flat"}`}
                  >
                    <span className="eventstudy-year">{row.year}</span>
                    <strong>{fmtPct(row.return_pct, 2)}</strong>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
