"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MAX_HOLDINGS_BASKET,
  buildCompareRows,
  emptyBasket,
  fundKey,
  loadBasket,
  saveBasket,
  type BasketItem,
  type BasketStore,
  type EtfHoldingsMarket,
  type FundSnapshot,
  type HoldingSnap,
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
  const res = await fetch(`/api/etf-holdings?${qs}`, {
    cache: "no-store",
    signal,
  });
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

export default function EtfHoldingsTab() {
  const [input, setInput] = useState("");
  const [store, setStore] = useState<BasketStore>(emptyBasket);
  const [hydrated, setHydrated] = useState(false);
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [openSuggest, setOpenSuggest] = useState(false);
  const [view, setView] = useState<ViewMode>("compare");
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const loaded = loadBasket();
    setStore(loaded);
    setHydrated(true);
    if (loaded.items[0]) {
      setDetailKey(fundKey(loaded.items[0].market, loaded.items[0].ticker));
    }
  }, []);

  useEffect(() => {
    if (hydrated) saveBasket(store);
  }, [store, hydrated]);

  const funds = useMemo(
    () =>
      store.items
        .map((item) => store.snapshots[fundKey(item.market, item.ticker)])
        .filter((s): s is FundSnapshot => Boolean(s)),
    [store],
  );

  const compareRows = useMemo(
    () => buildCompareRows(funds, store.prev),
    [funds, store.prev],
  );

  const visibleRows = useMemo(() => {
    if (view === "common") return compareRows.filter((r) => r.present >= 2);
    return compareRows;
  }, [compareRows, view]);

  const overlapCount = useMemo(
    () => compareRows.filter((r) => r.present >= 2).length,
    [compareRows],
  );

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
      setStore((prev) => {
        const k = fundKey(snap.market, snap.ticker);
        const prevSnap = prev.snapshots[k];
        const items = prev.items.some(
          (it) => fundKey(it.market, it.ticker) === k,
        )
          ? prev.items.map((it) =>
              fundKey(it.market, it.ticker) === k
                ? { ticker: snap.ticker, market: snap.market, name: snap.name }
                : it,
            )
          : prev.items;
        return {
          items,
          snapshots: { ...prev.snapshots, [k]: snap },
          prev: prevSnap ? { ...prev.prev, [k]: prevSnap } : prev.prev,
        };
      });
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

  const storeRef = useRef(store);
  storeRef.current = store;

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
        const cur = storeRef.current;
        const exists = cur.items.some((it) => fundKey(it.market, it.ticker) === key);
        if (!exists && cur.items.length >= MAX_HOLDINGS_BASKET) {
          setErrorMap((m) => ({
            ...m,
            add: `최대 ${MAX_HOLDINGS_BASKET}개까지 비교할 수 있습니다.`,
          }));
          return;
        }
        setStore((prev) => {
          if (prev.items.some((it) => fundKey(it.market, it.ticker) === key)) {
            const prevSnap = prev.snapshots[key];
            return {
              ...prev,
              items: prev.items.map((it) =>
                fundKey(it.market, it.ticker) === key
                  ? { ticker: snap.ticker, market: snap.market, name: snap.name }
                  : it,
              ),
              snapshots: { ...prev.snapshots, [key]: snap },
              prev: prevSnap ? { ...prev.prev, [key]: prevSnap } : prev.prev,
            };
          }
          if (prev.items.length >= MAX_HOLDINGS_BASKET) return prev;
          return {
            items: [
              ...prev.items,
              { ticker: snap.ticker, market: snap.market, name: snap.name },
            ],
            snapshots: { ...prev.snapshots, [key]: snap },
            prev: prev.prev,
          };
        });
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
    const items = store.items;
    for (const item of items) {
      await loadOne(item);
    }
  }, [store.items, loadOne]);

  const removeItem = useCallback((item: BasketItem) => {
    const key = fundKey(item.market, item.ticker);
    setStore((prev) => {
      const items = prev.items.filter((it) => fundKey(it.market, it.ticker) !== key);
      const snapshots = { ...prev.snapshots };
      const prevSnaps = { ...prev.prev };
      delete snapshots[key];
      delete prevSnaps[key];
      return { items, snapshots, prev: prevSnaps };
    });
    setDetailKey((cur) => (cur === key ? null : cur));
  }, []);

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
          { cache: "no-store" },
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

  const detail = funds.find((f) => fundKey(f.market, f.ticker) === detailKey) || funds[0];
  const anyLoading = Object.keys(loadingMap).length > 0;
  const addError = errorMap.add;

  return (
    <section className="panel etf-hold-panel">
      <div className="panel-head">
        <div>
          <h2>편입비 비교 · 추적</h2>
          <p className="kr-note">
            국내·미국 ETF를 최대 {MAX_HOLDINGS_BASKET}개 담아 구성종목 편입비를 비교합니다.
            새로고침하면 직전 조회 대비 변화(pp)를 표시합니다.
          </p>
        </div>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => void refreshAll()}
          disabled={!store.items.length || anyLoading}
        >
          {anyLoading ? "갱신 중…" : "전체 새로고침"}
        </button>
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

      {store.items.length ? (
        <div className="etf-hold-chips">
          {store.items.map((item, idx) => {
            const key = fundKey(item.market, item.ticker);
            const snap = store.snapshots[key];
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
          비교할 ETF를 검색해 추가하세요. 선택 목록은 이 브라우저에 저장되어 다시 열어도
          이어서 추적할 수 있습니다.
        </p>
      )}

      {funds.length ? (
        <>
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
              {funds.length >= 2
                ? ` · 전체 유니온 ${compareRows.length}종`
                : ""}
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
                          <td
                            key={fk}
                            className={isMax ? "etf-hold-max" : undefined}
                          >
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
                      const prev = store.prev[fundKey(detail.market, detail.ticker)];
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
