"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  COMPARE_TEMPLATES,
  MAX_COMPARE_SETS,
  MAX_HOLDINGS_BASKET,
  activeSet,
  buildCompareInsights,
  buildCompareRows,
  emptyLibrary,
  fundConcentration,
  fundKey,
  loadLibrary,
  newSetId,
  patchActiveSet,
  saveLibrary,
  type BasketItem,
  type CompareSet,
  type EtfHoldingsMarket,
  type FundSnapshot,
  type HoldingSnap,
  type HoldingsLibrary,
} from "@/lib/etfHoldingsBasket";

type Suggestion = {
  ticker: string;
  name: string;
  market: EtfHoldingsMarket;
  extra?: string;
};

type ApiPayload = {
  ok: boolean;
  ticker?: string;
  market?: EtfHoldingsMarket;
  name?: string;
  type?: string | null;
  region?: string | null;
  as_of?: string | null;
  aum_label?: string | null;
  source?: string;
  source_note?: string;
  holdings?: HoldingSnap[];
  stats?: FundSnapshot["stats"];
  suggestions?: Suggestion[];
  notes?: string[];
  error?: string;
};

type ViewMode = "compare" | "common" | "detail";

const EXAMPLES: BasketItem[] = [
  { ticker: "069500", market: "KR", name: "KODEX 200" },
  { ticker: "091160", market: "KR", name: "KODEX 반도체" },
  { ticker: "QQQ", market: "US", name: "Invesco QQQ" },
  { ticker: "SPY", market: "US", name: "SPDR S&P 500" },
];

const COL_COLORS = ["#14b8a6", "#38bdf8", "#f59e0b", "#a78bfa", "#f472b6"];

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtDelta(n?: number | null): string {
  if (n == null || Number.isNaN(n) || Math.abs(n) < 0.005) return "";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}pp`;
}

function toneClass(n?: number | null): string {
  if (n == null || Math.abs(n) < 0.005) return "";
  return n > 0 ? "up" : "down";
}

function WeightBar({ pct, color }: { pct?: number | null; color?: string }) {
  const w = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="etf-hold-weight">
      <div className="etf-hold-weight-track" aria-hidden>
        <div
          className="etf-hold-weight-fill"
          style={{ width: `${w}%`, background: color || undefined }}
        />
      </div>
      <span>{fmtPct(pct)}</span>
    </div>
  );
}

async function fetchFund(
  ticker: string,
  market?: EtfHoldingsMarket,
  signal?: AbortSignal,
): Promise<ApiPayload> {
  const qs = new URLSearchParams({ ticker, limit: "120" });
  if (market) qs.set("market", market);
  const res = await fetch(`/api/etf-holdings?${qs}`, { signal });
  return (await res.json()) as ApiPayload;
}

function snapshotFromPayload(json: ApiPayload): FundSnapshot | null {
  if (!json.ok || !json.ticker || !json.market) return null;
  return {
    ticker: json.ticker,
    market: json.market,
    name: json.name || json.ticker,
    type: json.type,
    region: json.region,
    as_of: json.as_of,
    aum_label: json.aum_label,
    source: json.source,
    source_note: json.source_note,
    fetched_at: new Date().toISOString(),
    holdings: (json.holdings || []).map((h) => ({
      code: h.code || "",
      name: h.name || h.code || "",
      weight_pct: h.weight_pct ?? null,
      change_pct: h.change_pct,
    })),
    stats: json.stats,
  };
}

function applySnap(lib: HoldingsLibrary, snap: FundSnapshot, addIfMissing: boolean): HoldingsLibrary {
  const key = fundKey(snap.market, snap.ticker);
  const item: BasketItem = { ticker: snap.ticker, market: snap.market, name: snap.name };
  const prevSnap = lib.snapshots[key];
  const next = patchActiveSet(lib, (set) => {
    const exists = set.items.some((it) => fundKey(it.market, it.ticker) === key);
    if (exists) {
      return {
        ...set,
        items: set.items.map((it) => (fundKey(it.market, it.ticker) === key ? item : it)),
      };
    }
    if (!addIfMissing || set.items.length >= MAX_HOLDINGS_BASKET) return set;
    return { ...set, items: [...set.items, item] };
  });
  return {
    ...next,
    snapshots: { ...next.snapshots, [key]: snap },
    prev: prevSnap ? { ...next.prev, [key]: prevSnap } : next.prev,
  };
}

export default function EtfHoldingsTab() {
  const [input, setInput] = useState("");
  const [library, setLibrary] = useState<HoldingsLibrary>(emptyLibrary);
  const [hydrated, setHydrated] = useState(false);
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [openSuggest, setOpenSuggest] = useState(false);
  const [view, setView] = useState<ViewMode>("compare");
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const current = activeSet(library);

  useEffect(() => {
    const loaded = loadLibrary();
    setLibrary(loaded);
    setHydrated(true);
    const first = activeSet(loaded).items[0];
    if (first) setDetailKey(fundKey(first.market, first.ticker));
  }, []);

  useEffect(() => {
    if (hydrated) saveLibrary(library);
  }, [library, hydrated]);

  const funds = useMemo(
    () =>
      current.items
        .map((item) => library.snapshots[fundKey(item.market, item.ticker)])
        .filter((s): s is FundSnapshot => Boolean(s)),
    [current.items, library.snapshots],
  );

  const compareRows = useMemo(
    () => buildCompareRows(funds, library.prev),
    [funds, library.prev],
  );

  const visibleRows = useMemo(() => {
    if (view === "common") return compareRows.filter((r) => r.present >= 2);
    return compareRows;
  }, [compareRows, view]);

  const overlapCount = useMemo(
    () => compareRows.filter((r) => r.present >= 2).length,
    [compareRows],
  );

  const insight = useMemo(() => buildCompareInsights(funds, compareRows), [funds, compareRows]);

  const loadOne = useCallback(async (item: BasketItem, signal?: AbortSignal) => {
    const key = fundKey(item.market, item.ticker);
    setLoadingMap((m) => ({ ...m, [key]: true }));
    setErrorMap((m) => {
      const next = { ...m };
      delete next[key];
      return next;
    });
    try {
      const json = await fetchFund(item.ticker, item.market, signal);
      if (!json.ok || !json.ticker) {
        throw new Error(json.error || "조회 실패");
      }
      const snap = snapshotFromPayload(json);
      if (!snap) throw new Error("편입비 데이터가 없습니다.");
      setLibrary((prev) => applySnap(prev, snap, false));
      setDetailKey(fundKey(snap.market, snap.ticker));
    } catch (exc) {
      if ((exc as { name?: string })?.name === "AbortError") return;
      setErrorMap((m) => ({
        ...m,
        [key]: exc instanceof Error ? exc.message : String(exc),
      }));
    } finally {
      setLoadingMap((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      });
    }
  }, []);

  const libraryRef = useRef(library);
  libraryRef.current = library;

  const addTicker = useCallback(
    async (ticker: string, market?: EtfHoldingsMarket) => {
      const raw = ticker.trim();
      if (!raw) return;
      setLoadingMap((m) => ({ ...m, add: true }));
      try {
        const json = await fetchFund(raw, market);
        if (json.suggestions?.length && !json.ok) {
          setSuggestions(json.suggestions);
          setOpenSuggest(true);
          return;
        }
        const snap = snapshotFromPayload(json);
        if (!snap) throw new Error(json.error || "조회 실패");
        const key = fundKey(snap.market, snap.ticker);
        const cur = activeSet(libraryRef.current);
        const exists = cur.items.some((it) => fundKey(it.market, it.ticker) === key);
        if (!exists && cur.items.length >= MAX_HOLDINGS_BASKET) {
          setErrorMap((m) => ({
            ...m,
            add: `한 비교군에 최대 ${MAX_HOLDINGS_BASKET}개까지 담을 수 있습니다.`,
          }));
          return;
        }
        setLibrary((prev) => applySnap(prev, snap, true));
        setDetailKey(key);
        setInput("");
        setSuggestions([]);
        setOpenSuggest(false);
        setErrorMap((m) => {
          const next = { ...m };
          delete next[key];
          delete next.add;
          return next;
        });
      } catch (exc) {
        if ((exc as { name?: string })?.name === "AbortError") return;
        setErrorMap((m) => ({
          ...m,
          add: exc instanceof Error ? exc.message : String(exc),
        }));
      } finally {
        setLoadingMap((m) => {
          const next = { ...m };
          delete next.add;
          return next;
        });
      }
    },
    [],
  );

  const refreshAll = useCallback(async () => {
    for (const item of current.items) {
      await loadOne(item);
    }
  }, [current.items, loadOne]);

  const removeItem = useCallback((item: BasketItem) => {
    const key = fundKey(item.market, item.ticker);
    setLibrary((prev) =>
      patchActiveSet(prev, (set) => ({
        ...set,
        items: set.items.filter((it) => fundKey(it.market, it.ticker) !== key),
      })),
    );
    setDetailKey((cur) => (cur === key ? null : cur));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    for (const item of current.items) {
      const key = fundKey(item.market, item.ticker);
      if (!library.snapshots[key]) void loadOne(item, ctrl.signal);
    }
    return () => ctrl.abort();
    // snapshots intentionally omitted — only refetch missing names when the set changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, current.id, current.items.map((it) => fundKey(it.market, it.ticker)).join("|")]);

  useEffect(() => {
    const q = input.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/etf-holdings?suggest=1&q=${encodeURIComponent(q)}`,
        );
        const json = (await res.json()) as ApiPayload;
        setSuggestions(json.suggestions || []);
        const inputEl = boxRef.current?.querySelector("input");
        setOpenSuggest(document.activeElement === inputEl);
      } catch {
        /* ignore */
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (!boxRef.current?.contains(ev.target as Node)) setOpenSuggest(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    void addTicker(input);
  };

  const switchSet = (id: string) => {
    setLibrary((prev) => ({ ...prev, activeId: id }));
    const next = library.sets.find((s) => s.id === id);
    const first = next?.items[0];
    setDetailKey(first ? fundKey(first.market, first.ticker) : null);
    setView("compare");
    setEditingId(null);
  };

  const addEmptySet = () => {
    if (library.sets.length >= MAX_COMPARE_SETS) {
      setErrorMap((m) => ({ ...m, add: `비교군은 최대 ${MAX_COMPARE_SETS}개입니다.` }));
      return;
    }
    const id = newSetId();
    const name = `비교군 ${library.sets.length + 1}`;
    setLibrary((prev) => ({
      ...prev,
      activeId: id,
      sets: [...prev.sets, { id, name, items: [] }],
    }));
    setDetailKey(null);
    setView("compare");
  };

  const applyTemplate = (tpl: (typeof COMPARE_TEMPLATES)[number]) => {
    if (library.sets.length >= MAX_COMPARE_SETS) {
      setErrorMap((m) => ({ ...m, add: `비교군은 최대 ${MAX_COMPARE_SETS}개입니다.` }));
      return;
    }
    const id = newSetId();
    setLibrary((prev) => ({
      ...prev,
      activeId: id,
      sets: [...prev.sets, { id, name: tpl.name, items: tpl.items.slice(0, MAX_HOLDINGS_BASKET) }],
    }));
    setDetailKey(fundKey(tpl.items[0]!.market, tpl.items[0]!.ticker));
    setView("compare");
  };

  const duplicateSet = () => {
    if (library.sets.length >= MAX_COMPARE_SETS) {
      setErrorMap((m) => ({ ...m, add: `비교군은 최대 ${MAX_COMPARE_SETS}개입니다.` }));
      return;
    }
    const id = newSetId();
    setLibrary((prev) => {
      const src = activeSet(prev);
      return {
        ...prev,
        activeId: id,
        sets: [...prev.sets, { id, name: `${src.name} 복사`, items: src.items.slice() }],
      };
    });
  };

  const deleteSet = () => {
    if (library.sets.length <= 1) {
      setLibrary((prev) => patchActiveSet(prev, (s) => ({ ...s, items: [] })));
      setDetailKey(null);
      return;
    }
    setLibrary((prev) => {
      const sets = prev.sets.filter((s) => s.id !== prev.activeId);
      return { ...prev, sets, activeId: sets[0]!.id };
    });
    setDetailKey(null);
  };

  const commitRename = (set: CompareSet) => {
    const name = draftName.trim().slice(0, 24) || set.name;
    setLibrary((prev) => ({
      ...prev,
      sets: prev.sets.map((s) => (s.id === set.id ? { ...s, name } : s)),
    }));
    setEditingId(null);
  };

  const detail = funds.find((f) => fundKey(f.market, f.ticker) === detailKey) || funds[0];
  const anyLoading = Object.keys(loadingMap).length > 0;
  const addError = errorMap.add;

  return (
    <section className="panel etf-hold-panel">
      <div className="panel-head">
        <div>
          <h2>편입비 비교 · 추적</h2>
          <p className="kr-note">
            비교군을 여러 개 저장해 두고 바꿔 가며 봅니다. 이 브라우저에만 남습니다.
            한 비교군에 ETF {MAX_HOLDINGS_BASKET}개까지 담을 수 있습니다.
          </p>
        </div>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => void refreshAll()}
          disabled={!current.items.length || anyLoading}
        >
          {anyLoading ? "갱신 중…" : "전체 새로고침"}
        </button>
      </div>

      <div className="etf-hold-sets">
        {library.sets.map((set) => (
          <button
            key={set.id}
            type="button"
            className={`etf-hold-set-chip ${set.id === library.activeId ? "active" : ""}`}
            onClick={() => switchSet(set.id)}
            onDoubleClick={() => {
              setEditingId(set.id);
              setDraftName(set.name);
            }}
          >
            {set.name}
            <em>{set.items.length}</em>
          </button>
        ))}
        <button
          type="button"
          className="ghost-btn"
          onClick={addEmptySet}
          disabled={library.sets.length >= MAX_COMPARE_SETS}
        >
          + 새 비교군
        </button>
      </div>

      <div className="etf-hold-set-tools">
        {editingId === current.id ? (
          <form
            className="etf-hold-rename"
            onSubmit={(ev) => {
              ev.preventDefault();
              commitRename(current);
            }}
          >
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              maxLength={24}
              autoFocus
              aria-label="비교군 이름"
            />
            <button type="submit" className="chip">
              저장
            </button>
            <button type="button" className="ghost-btn" onClick={() => setEditingId(null)}>
              취소
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setEditingId(current.id);
              setDraftName(current.name);
            }}
          >
            이름 바꾸기
          </button>
        )}
        <button type="button" className="ghost-btn" onClick={duplicateSet}>
          복제
        </button>
        <button type="button" className="ghost-btn" onClick={deleteSet}>
          {library.sets.length <= 1 ? "비우기" : "비교군 삭제"}
        </button>
        <span className="etf-hold-templates-label">유형 불러오기</span>
        {COMPARE_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            className="ghost-btn"
            onClick={() => applyTemplate(tpl)}
            disabled={anyLoading || library.sets.length >= MAX_COMPARE_SETS}
          >
            {tpl.name}
          </button>
        ))}
      </div>

      <form className="etf-hold-form" onSubmit={onSubmit}>
        <div className="etf-hold-search" ref={boxRef}>
          <input
            type="search"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setOpenSuggest(true);
            }}
            onFocus={() => suggestions.length && setOpenSuggest(true)}
            placeholder="티커 또는 종목명 추가 (예: 069500, QQQ)"
            className="etfdb-search etf-hold-input"
            autoComplete="off"
            spellCheck={false}
          />
          {openSuggest && suggestions.length ? (
            <ul className="etf-hold-suggest" role="listbox">
              {suggestions.map((s) => (
                <li key={`${s.market}-${s.ticker}`}>
                  <button
                    type="button"
                    onClick={() => void addTicker(s.ticker, s.market)}
                  >
                    <code>{s.ticker}</code>
                    <span>{s.name}</span>
                    <em>{s.market === "KR" ? "국내" : "미국"}</em>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button type="submit" className="chip" disabled={anyLoading || !input.trim()}>
          추가
        </button>
      </form>

      <div className="etf-hold-examples">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.ticker}
            type="button"
            className="ghost-btn"
            onClick={() => void addTicker(ex.ticker, ex.market)}
            disabled={anyLoading}
          >
            {ex.market} {ex.ticker}
            <span> {ex.name}</span>
          </button>
        ))}
      </div>

      {addError ? <p className="empty">오류: {addError}</p> : null}

      {current.items.length ? (
        <div className="etf-hold-chips">
          {current.items.map((item, idx) => {
            const key = fundKey(item.market, item.ticker);
            const snap = library.snapshots[key];
            const busy = Boolean(loadingMap[key]);
            const err = errorMap[key];
            return (
              <article
                key={key}
                className={`etf-hold-chip ${detailKey === key ? "active" : ""}`}
                style={{ borderColor: COL_COLORS[idx % COL_COLORS.length] }}
              >
                <button
                  type="button"
                  className="etf-hold-chip-main"
                  onClick={() => {
                    setDetailKey(key);
                    setView("detail");
                  }}
                >
                  <strong>
                    <i style={{ background: COL_COLORS[idx % COL_COLORS.length] }} />
                    {item.ticker}
                  </strong>
                  <span>
                    {snap?.name || item.name} · {item.market === "KR" ? "국내" : "미국"}
                    {snap?.as_of ? ` · ${snap.as_of}` : ""}
                    {busy ? " · 불러오는 중" : ""}
                  </span>
                  {err ? <em className="down">{err}</em> : null}
                </button>
                <button
                  type="button"
                  className="etf-hold-chip-x"
                  onClick={() => removeItem(item)}
                  aria-label={`${item.ticker} 제거`}
                >
                  ×
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="kr-note">
          이 비교군에 ETF를 검색해 넣거나, 위의 유형을 불러오세요. 비교군은 이 컴퓨터
          브라우저에만 저장됩니다.
        </p>
      )}

      {funds.length ? (
        <>
          <div className="table-wrap etf-hold-table">
            <table className="kr-table etf-hold-fund-stats">
              <thead>
                <tr>
                  <th>ETF</th>
                  <th>종목 수</th>
                  <th>Top5</th>
                  <th>최대 1종</th>
                  <th>유효 종목 수</th>
                  <th>공개 합</th>
                  <th>AUM</th>
                </tr>
              </thead>
              <tbody>
                {funds.map((f, idx) => {
                  const c = fundConcentration(f);
                  return (
                    <tr key={fundKey(f.market, f.ticker)}>
                      <td>
                        <span style={{ color: COL_COLORS[idx % COL_COLORS.length] }}>
                          {f.ticker}
                        </span>
                        <span className="etf-result-code"> {c.label}</span>
                      </td>
                      <td>{c.n}</td>
                      <td>{fmtPct(c.top5, 1)}</td>
                      <td>{fmtPct(c.maxW, 1)}</td>
                      <td>{c.effectiveN != null ? c.effectiveN : "—"}</td>
                      <td>{fmtPct(c.coverage, 0)}</td>
                      <td>{f.aum_label || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="kr-note">
            Top5가 높을수록 소수 종목에 기댑니다. 유효 종목 수는 편입비를 제곱해 만든 분산
            척도로, 숫자가 작을수록 실질적으로 몇 종목에 모여 있습니다. 공개 합이 90%보다
            낮으면 상위 종목만 공개된 표일 수 있습니다.
          </p>

          {insight ? (
            <article className="etf-hold-insight">
              <h3>비교 해석</h3>
              <p className="etf-hold-insight-head">{insight.headline}</p>
              <div className="etf-hold-metrics">
                {insight.metrics.map((m) => (
                  <div key={m.label}>
                    <em>{m.label}</em>
                    <strong>{m.value}</strong>
                    {m.note ? <span>{m.note}</span> : null}
                  </div>
                ))}
              </div>
              {insight.bullets.length ? (
                <ul className="etf-hold-insight-bullets">
                  {insight.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
              {insight.gaps.length ? (
                <div>
                  <h4>비중 차이가 큰 종목</h4>
                  <ul className="etf-hold-gap-list">
                    {insight.gaps.map((g) => (
                      <li key={`${g.code}-${g.highLabel}`}>
                        <strong>{g.name}</strong>
                        <span>
                          {g.highLabel} {g.highW.toFixed(1)}% · {g.lowLabel} {g.lowW.toFixed(1)}%
                          <em className="up"> +{g.diff.toFixed(1)}pp</em>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {insight.uniques.length ? (
                <div>
                  <h4>한쪽에만 있는 큰 종목</h4>
                  <ul className="etf-hold-gap-list">
                    {insight.uniques.map((u) => (
                      <li key={`${u.fundLabel}-${u.code}`}>
                        <strong>{u.name}</strong>
                        <span>
                          {u.fundLabel}만 {u.weight.toFixed(1)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ) : current.items.length === 1 ? (
            <p className="kr-note">ETF를 하나 더 넣으면 겹침 비중과 차이 종목을 해석합니다.</p>
          ) : null}

          <div className="etf-hold-view-row">
            <div className="etf-hold-modes">
              {(
                [
                  ["compare", "비교표"],
                  ["common", "공통종목"],
                  ["detail", "개별"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`chip ${view === id ? "active" : ""}`}
                  onClick={() => setView(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="meta-line">
              {funds.length}개 ETF · 공통 {overlapCount}종
              {funds.length >= 2 ? ` · 전체 유니온 ${compareRows.length}종` : ""}
            </p>
          </div>

          {view !== "detail" ? (
            <div className="table-wrap etf-hold-table">
              <table className="kr-table etf-hold-compare">
                <thead>
                  <tr>
                    <th>종목</th>
                    {funds.map((f, idx) => (
                      <th key={fundKey(f.market, f.ticker)}>
                        <span style={{ color: COL_COLORS[idx % COL_COLORS.length] }}>
                          {f.ticker}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.slice(0, 80).map((row) => (
                    <tr key={row.key}>
                      <td>
                        <div className="etf-result-cell">
                          <span className="etf-result-name">{row.name}</span>
                          <span className="etf-result-code">{row.code}</span>
                        </div>
                      </td>
                      {funds.map((f, idx) => {
                        const fk = fundKey(f.market, f.ticker);
                        const w = row.weights[fk];
                        const d = row.deltas[fk];
                        const isMax =
                          w != null && row.present > 1 && Math.abs(w - row.maxWeight) < 0.005;
                        return (
                          <td key={fk} className={isMax ? "etf-hold-max" : undefined}>
                            <WeightBar
                              pct={w}
                              color={COL_COLORS[idx % COL_COLORS.length]}
                            />
                            {d != null && Math.abs(d) >= 0.005 ? (
                              <small className={toneClass(d)}>{fmtDelta(d)}</small>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {!visibleRows.length ? (
                    <tr>
                      <td colSpan={funds.length + 1} className="empty">
                        {view === "common"
                          ? "두 개 이상 ETF에 공통으로 들어 있는 종목이 없습니다."
                          : "구성종목이 없습니다."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : detail ? (
            <>
              <div className="etf-new-meta">
                <strong>
                  {detail.ticker} · {detail.name}
                </strong>
                <span>
                  {detail.market === "KR" ? "국내 상장" : "미국 상장"}
                  {detail.type ? ` · ${detail.type}` : ""}
                  {detail.aum_label ? ` · AUM ${detail.aum_label}` : ""}
                  {detail.as_of ? ` · 비중기준 ${detail.as_of}` : ""}
                </span>
                {detail.source_note ? <span>{detail.source_note}</span> : null}
              </div>
              <div className="etf-new-stats">
                <div>
                  <em>구성종목</em>
                  <strong>{detail.stats?.holding_count ?? detail.holdings.length}</strong>
                </div>
                <div>
                  <em>Top5</em>
                  <strong>{fmtPct(detail.stats?.top5_weight_pct)}</strong>
                </div>
                <div>
                  <em>Top10</em>
                  <strong>{fmtPct(detail.stats?.top10_weight_pct)}</strong>
                </div>
                <div>
                  <em>커버리지</em>
                  <strong>{fmtPct(detail.stats?.coverage_weight_pct)}</strong>
                </div>
              </div>
              <div className="table-wrap etf-hold-table">
                <table className="kr-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>코드</th>
                      <th>종목</th>
                      <th>편입비</th>
                      <th>직전 대비</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.holdings.map((h, idx) => {
                      const hk = `${h.code}-${idx}`;
                      const prev = library.prev[fundKey(detail.market, detail.ticker)];
                      const prevW = prev?.holdings.find(
                        (p) =>
                          (p.code || "").toUpperCase() === (h.code || "").toUpperCase() &&
                          p.code,
                      )?.weight_pct;
                      const delta =
                        h.weight_pct != null && prevW != null ? h.weight_pct - prevW : null;
                      return (
                        <tr key={hk}>
                          <td>{idx + 1}</td>
                          <td>
                            <code>{h.code || "—"}</code>
                          </td>
                          <td>{h.name || "—"}</td>
                          <td>
                            <WeightBar pct={h.weight_pct} />
                          </td>
                          <td className={toneClass(delta)}>{fmtDelta(delta) || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
