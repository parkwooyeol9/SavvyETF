"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAdminSession } from "@/components/AdminSession";
import type { HeatmapCell } from "@/lib/heatmap";
import type { TvAlertFire, TvAlertSummary, TvWatchlistSummary } from "@/lib/tvMcp/operator";
import { PICK_GROUPS, PICK_SOURCES, type PickItem } from "@/lib/tvPicks";

type Overview = {
  ok: boolean;
  connected?: boolean;
  error?: string;
  watchlists?: TvWatchlistSummary[];
  alerts?: TvAlertSummary[];
  fires?: TvAlertFire[];
  errors?: string[];
  fetchedAt?: string;
};

type SyncResult = {
  ok: boolean;
  error?: string;
  synced?: boolean;
  created?: boolean;
  added?: number;
  removed?: number;
  watchlistId?: string;
  resolved?: string[];
  unresolved?: string[];
  watchlists?: TvWatchlistSummary[];
};

type BulkAlertResult = {
  ok: boolean;
  error?: string;
  created?: Array<{ symbol: string; condition: string; price: number }>;
  unresolved?: string[];
  missing?: string[];
  failed?: string[];
  stopped?: boolean;
};

type SyncMode = "append" | "replace" | "remove";
type Flash = { kind: "ok" | "warn"; text: string } | null;

const MAX_SYMBOLS = 30;
const MAX_BULK_ALERT_SYMBOLS = 10;
const SAVVY_PREFIX = "Savvy ·";

const CONDITION_LABELS: Record<string, string> = {
  cross_up: "상향 돌파",
  cross_down: "하향 돌파",
  cross: "돌파(양방향)",
};

const MODE_VERB: Record<SyncMode, string> = {
  append: "추가",
  replace: "교체",
  remove: "제거",
};

function todayLabel(): string {
  return new Date()
    .toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" })
    .replace(/\s/g, "");
}

function parseSymbols(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function TvOperatorPanel({
  heatmapCells,
  universeLabel,
}: {
  heatmapCells: HeatmapCell[];
  universeLabel: string;
}) {
  const { secret, unlocked } = useAdminSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const [open, setOpen] = useState(true);

  const [sourceId, setSourceId] = useState(PICK_SOURCES[0].id);
  const [pickTicker, setPickTicker] = useState("");
  const [pickCount, setPickCount] = useState(PICK_SOURCES[0].defaultCount);
  const [preview, setPreview] = useState<PickItem[]>([]);

  const [targetId, setTargetId] = useState("");
  const [newListName, setNewListName] = useState("");
  const [symbolsText, setSymbolsText] = useState("");
  const [expandedList, setExpandedList] = useState<string | null>(null);
  const [selectedLists, setSelectedLists] = useState<Set<string>>(new Set());
  const [pickLabel, setPickLabel] = useState("");

  const [bulkPct, setBulkPct] = useState("5");
  const [bulkDirection, setBulkDirection] = useState<"both" | "up" | "down">("both");

  const [alertSymbol, setAlertSymbol] = useState("");
  const [alertPrice, setAlertPrice] = useState("");
  const [alertCondition, setAlertCondition] = useState("cross_up");

  const source = useMemo(
    () => PICK_SOURCES.find((s) => s.id === sourceId) || PICK_SOURCES[0],
    [sourceId],
  );

  const authFetch = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const res = await fetch(path, {
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${secret}`,
        },
        credentials: "same-origin",
      });
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        return { ok: false, error: `서버 응답 오류 (HTTP ${res.status})` } as T;
      }
    },
    [secret],
  );

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await authFetch<Overview>("/api/tv/overview"));
    } catch (exc) {
      setOverview({ ok: false, error: exc instanceof Error ? exc.message : "불러오기 실패" });
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!unlocked || !secret) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tv") === "connected") {
      setFlash({ kind: "ok", text: "TradingView 계정이 연결되었습니다." });
    } else if (params.get("tv_error")) {
      setFlash({ kind: "warn", text: `연결 실패: ${params.get("tv_error")}` });
    }
    if (params.has("tv") || params.has("tv_error")) {
      params.delete("tv");
      params.delete("tv_error");
      const qs = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }
    void loadOverview();
  }, [unlocked, secret, loadOverview]);

  if (!unlocked) return null;

  const connected = Boolean(overview?.connected);
  const watchlists = overview?.watchlists || [];
  const target = targetId ? watchlists.find((w) => w.id === targetId) : undefined;
  const targetExists = Boolean(target);
  const listName = target?.name ?? newListName.trim();

  function applyWatchlists(next: TvWatchlistSummary[] | undefined) {
    if (!next) {
      void loadOverview();
      return;
    }
    setOverview((prev) => ({
      ...(prev || { ok: true, connected: true }),
      watchlists: next,
      fetchedAt: new Date().toISOString(),
    }));
    if (targetId && !next.some((w) => w.id === targetId)) setTargetId("");
  }

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setFlash(null);
    try {
      return await fn();
    } catch (exc) {
      setFlash({ kind: "warn", text: exc instanceof Error ? exc.message : "요청 실패" });
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    const res = await run(() =>
      authFetch<{ ok: boolean; url?: string; error?: string }>("/api/tv/oauth/start", {
        method: "POST",
      }),
    );
    if (!res) return;
    if (!res.ok || !res.url) {
      setFlash({ kind: "warn", text: res.error || "연결을 시작하지 못했습니다." });
      return;
    }
    window.location.href = res.url;
  }

  async function disconnect() {
    await run(() => authFetch("/api/tv/disconnect", { method: "POST" }));
    setOverview({ ok: true, connected: false });
    setFlash({ kind: "ok", text: "TradingView 연결을 해제했습니다." });
  }

  function selectSource(id: string) {
    const next = PICK_SOURCES.find((s) => s.id === id) || PICK_SOURCES[0];
    setSourceId(next.id);
    setPickCount(next.defaultCount);
    setPreview([]);
  }

  async function loadPicks() {
    const ctx = {
      count: Math.max(1, Math.min(MAX_SYMBOLS, pickCount || source.defaultCount)),
      ticker: pickTicker,
      heatmap: heatmapCells,
      universeLabel,
    };
    const items = await run(() => source.load(ctx));
    if (!items) return;
    if (!items.length) {
      setFlash({ kind: "warn", text: "조건에 맞는 종목이 없습니다." });
      return;
    }
    setPreview(items);
    setSymbolsText(items.map((i) => i.symbol).join(", "));
    setPickLabel(source.short(ctx));
    if (!targetExists) setNewListName(`${SAVVY_PREFIX} ${source.short(ctx)} ${todayLabel()}`);
  }

  async function createBulkAlerts() {
    const symbols = parseSymbols(symbolsText);
    if (!symbols.length) {
      setFlash({ kind: "warn", text: "대상 종목이 없습니다." });
      return;
    }
    if (symbols.length > MAX_BULK_ALERT_SYMBOLS) {
      setFlash({
        kind: "warn",
        text: `일괄 알림은 최대 ${MAX_BULK_ALERT_SYMBOLS}종목까지입니다. 종목 칸을 줄이거나 개수를 낮춰 다시 불러오세요.`,
      });
      return;
    }
    const legs = bulkDirection === "both" ? 2 : 1;
    const dirText = bulkDirection === "both" ? "±" : bulkDirection === "up" ? "+" : "-";
    if (!window.confirm(`${symbols.length}종목에 ${dirText}${bulkPct}% 알림 ${symbols.length * legs}개를 만들까요?`)) {
      return;
    }
    const res = await run(() =>
      authFetch<BulkAlertResult>("/api/tv/alerts/bulk", {
        method: "POST",
        body: JSON.stringify({ symbols, pct: bulkPct, direction: bulkDirection, label: pickLabel }),
      }),
    );
    if (!res) return;
    if (!res.ok) {
      setFlash({ kind: "warn", text: res.error || "일괄 알림 생성 실패" });
      return;
    }
    const notes = [
      res.unresolved?.length ? `못 찾은 종목: ${res.unresolved.join(", ")}` : "",
      res.missing?.length ? `시세 없음: ${res.missing.join(", ")}` : "",
      res.failed?.length ? `실패 ${res.failed.length}건` : "",
      res.stopped ? "요청 한도로 중단됨" : "",
    ].filter(Boolean);
    setFlash({
      kind: notes.length ? "warn" : "ok",
      text: `알림 ${res.created?.length ?? 0}개 생성 (1회 발동 후 자동 비활성)${notes.length ? ` · ${notes.join(" · ")}` : ""}`,
    });
    void loadOverview();
  }

  async function sync(mode: SyncMode, symbols: string[], name: string, id?: string) {
    const res = await run(() =>
      authFetch<SyncResult>("/api/tv/watchlist-sync", {
        method: "POST",
        body: JSON.stringify({ name, id, symbols, mode }),
      }),
    );
    if (!res) return;
    if (!res.ok) {
      setFlash({ kind: "warn", text: res.error || `${MODE_VERB[mode]} 실패` });
      return;
    }
    const missed = res.unresolved?.length ? ` · 못 찾은 종목: ${res.unresolved.join(", ")}` : "";
    if (!res.synced) {
      setFlash({ kind: "warn", text: `처리할 수 있는 종목이 없습니다${missed}` });
      return;
    }
    const head =
      mode === "remove"
        ? `‘${name}’에서 ${res.removed ?? 0}개 제거`
        : `‘${name}’ ${res.created ? "생성" : "업데이트"} (추가 ${res.added ?? 0} · 제거 ${res.removed ?? 0})`;
    setFlash({ kind: res.unresolved?.length ? "warn" : "ok", text: `${head}${missed}` });
    applyWatchlists(res.watchlists);
    if (res.watchlistId && res.watchlists?.some((w) => w.id === res.watchlistId)) {
      setTargetId(res.watchlistId);
      setExpandedList(res.watchlistId);
    }
  }

  function submitSync(mode: SyncMode) {
    const symbols = parseSymbols(symbolsText);
    if (!listName) {
      setFlash({ kind: "warn", text: "워치리스트 이름을 입력하거나 선택하세요." });
      return;
    }
    if (!symbols.length) {
      setFlash({ kind: "warn", text: "대상 종목이 없습니다." });
      return;
    }
    if (symbols.length > MAX_SYMBOLS) {
      setFlash({ kind: "warn", text: `한 번에 최대 ${MAX_SYMBOLS}개까지 처리할 수 있습니다.` });
      return;
    }
    if (mode === "replace" && targetExists) {
      const ok = window.confirm(`‘${listName}’의 기존 종목을 이 목록으로 교체할까요?`);
      if (!ok) return;
    }
    void sync(mode, symbols, listName, target?.id);
  }

  async function deleteLists(lists: TvWatchlistSummary[]) {
    if (!lists.length) return;
    const question =
      lists.length === 1
        ? `‘${lists[0].name}’ 워치리스트(${lists[0].count}종목)를 TradingView에서 삭제할까요?`
        : `워치리스트 ${lists.length}개를 TradingView에서 삭제할까요?\n\n${lists.map((w) => `· ${w.name}`).join("\n")}`;
    if (!window.confirm(question)) return;
    const res = await run(() =>
      authFetch<{
        ok: boolean;
        error?: string;
        deleted?: string[];
        failed?: string[];
        watchlists?: TvWatchlistSummary[];
      }>(
        "/api/tv/watchlist-delete",
        { method: "POST", body: JSON.stringify({ ids: lists.map((w) => w.id) }) },
      ),
    );
    if (!res) return;
    if (!res.ok) {
      setFlash({ kind: "warn", text: res.error || "삭제 실패" });
      return;
    }
    const deleted = new Set(res.deleted || []);
    const failedText = res.failed?.length ? ` · 실패 ${res.failed.length}개 (활성 목록은 삭제되지 않을 수 있음)` : "";
    setFlash({
      kind: res.failed?.length ? "warn" : "ok",
      text:
        lists.length === 1 && deleted.size === 1
          ? `‘${lists[0].name}’ 워치리스트를 삭제했습니다.`
          : `워치리스트 ${deleted.size}개를 삭제했습니다${failedText}`,
    });
    if (expandedList && deleted.has(expandedList)) setExpandedList(null);
    setSelectedLists(new Set());
    applyWatchlists(res.watchlists);
  }

  function toggleSelected(id: string) {
    setSelectedLists((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectSavvyLists() {
    setSelectedLists(
      new Set(watchlists.filter((w) => w.name.startsWith(SAVVY_PREFIX) && !w.active).map((w) => w.id)),
    );
  }

  async function setAlertActive(a: TvAlertSummary, active: boolean) {
    const res = await run(() =>
      authFetch<{ ok: boolean; error?: string }>("/api/tv/alerts", {
        method: "PATCH",
        body: JSON.stringify({ ids: [a.id], active }),
      }),
    );
    if (!res) return;
    if (!res.ok) {
      setFlash({ kind: "warn", text: res.error || "알림 상태 변경 실패" });
      return;
    }
    setFlash({ kind: "ok", text: `${a.symbol} 알림을 ${active ? "재개" : "일시정지"}했습니다.` });
    void loadOverview();
  }

  async function createAlert(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(() =>
      authFetch<{ ok: boolean; error?: string; symbol?: string }>("/api/tv/alerts", {
        method: "POST",
        body: JSON.stringify({ symbol: alertSymbol, price: alertPrice, condition: alertCondition }),
      }),
    );
    if (!res) return;
    if (!res.ok) {
      setFlash({ kind: "warn", text: res.error || "알림 생성 실패" });
      return;
    }
    setFlash({
      kind: "ok",
      text: `${res.symbol} ${alertPrice} ${CONDITION_LABELS[alertCondition] || alertCondition} 알림을 만들었습니다.`,
    });
    setAlertPrice("");
    void loadOverview();
  }

  async function deleteAlert(a: TvAlertSummary) {
    if (!window.confirm(`${a.symbol} 알림을 삭제할까요? (발동 기록도 함께 삭제됩니다)`)) return;
    const res = await run(() =>
      authFetch<{ ok: boolean; error?: string }>("/api/tv/alerts", {
        method: "DELETE",
        body: JSON.stringify({ ids: [a.id] }),
      }),
    );
    if (!res) return;
    if (!res.ok) {
      setFlash({ kind: "warn", text: res.error || "알림 삭제 실패" });
      return;
    }
    setFlash({ kind: "ok", text: `${a.symbol} 알림을 삭제했습니다.` });
    void loadOverview();
  }

  return (
    <section className="feature-block tvop" aria-labelledby="tvop-title">
      <div className="tvop-head">
        <div>
          <h2 className="feature-title tvop-title" id="tvop-title">
            운영자 워크플로 · TradingView
          </h2>
          <p className="tvop-note">
            운영자 본인 계정 전용입니다. 여기서 보는 TradingView 데이터는 공개 화면·채널에 쓰지 않습니다.
          </p>
        </div>
        <div className="tvop-head-actions">
          <span className={`tvop-badge ${connected ? "on" : ""}`}>
            {loading ? "확인 중…" : connected ? "연결됨" : "미연결"}
          </span>
          {connected ? (
            <button type="button" className="ghost-btn" onClick={() => void disconnect()} disabled={busy}>
              연결 해제
            </button>
          ) : (
            <button
              type="button"
              className="ghost-btn admin-login-btn"
              onClick={() => void connect()}
              disabled={busy || loading}
            >
              TradingView 연결
            </button>
          )}
          <button type="button" className="ghost-btn" onClick={() => setOpen((v) => !v)}>
            {open ? "접기" : "펼치기"}
          </button>
        </div>
      </div>

      {flash ? <p className={`tvop-flash ${flash.kind}`}>{flash.text}</p> : null}
      {overview && !overview.ok && overview.error ? (
        <p className="tvop-flash warn">{overview.error}</p>
      ) : null}

      {open && connected ? (
        <div className="tvop-grid">
          <div className="tvop-card">
            <h3 className="subhead">봇 픽 → 워치리스트</h3>
            <div className="tvop-row">
              <select
                className="tvop-source"
                value={sourceId}
                onChange={(e) => selectSource(e.target.value)}
                aria-label="픽 유형"
              >
                {PICK_GROUPS.map((group) => (
                  <optgroup key={group} label={group}>
                    {PICK_SOURCES.filter((s) => s.group === group).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {source.needsTicker ? (
                <input
                  className="tvop-ticker"
                  placeholder={source.tickerPlaceholder}
                  value={pickTicker}
                  onChange={(e) => setPickTicker(e.target.value)}
                />
              ) : null}
              <input
                className="tvop-count"
                type="number"
                min={1}
                max={MAX_SYMBOLS}
                value={pickCount}
                onChange={(e) => setPickCount(Number(e.target.value))}
                aria-label="개수"
              />
              <button type="button" className="chip" onClick={() => void loadPicks()} disabled={busy}>
                불러오기
              </button>
            </div>

            {preview.length ? (
              <ul className="tvop-preview">
                {preview.map((p) => (
                  <li key={p.symbol}>
                    <strong>{p.symbol}</strong>
                    <span className="tvop-muted"> {p.name}</span>
                    {p.note ? <span className="tvop-note-inline"> {p.note}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}

            <label className="tvop-field">
              <span>대상 워치리스트 (TradingView 목록 {watchlists.length}개)</span>
              <select value={target ? target.id : ""} onChange={(e) => setTargetId(e.target.value)}>
                <option value="">+ 새 워치리스트 만들기</option>
                {watchlists.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {w.count}종목{w.active ? " (활성)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {!target ? (
              <label className="tvop-field">
                <span>새 워치리스트 이름</span>
                <input value={newListName} onChange={(e) => setNewListName(e.target.value)} maxLength={200} />
              </label>
            ) : null}
            <label className="tvop-field">
              <span>종목 (쉼표·공백 구분, 최대 {MAX_SYMBOLS}개 · 005930, NVDA, NASDAQ:AAPL)</span>
              <textarea value={symbolsText} onChange={(e) => setSymbolsText(e.target.value)} rows={3} />
            </label>
            <div className="tvop-row">
              <button
                type="button"
                className="ghost-btn admin-login-btn"
                onClick={() => submitSync("append")}
                disabled={busy}
              >
                {targetExists ? "추가" : "새로 만들기"}
              </button>
              <button type="button" className="ghost-btn" onClick={() => submitSync("replace")} disabled={busy}>
                교체
              </button>
              <button
                type="button"
                className="ghost-btn tvop-danger"
                onClick={() => submitSync("remove")}
                disabled={busy || !targetExists}
                title={targetExists ? "" : "기존 워치리스트를 선택하면 사용할 수 있습니다"}
              >
                이 종목들 제거
              </button>
            </div>

            <h4 className="tvop-sub">이 종목들에 가격 알림 (최대 {MAX_BULK_ALERT_SYMBOLS}종목 · 현재가 기준)</h4>
            <div className="tvop-row">
              <select
                value={bulkDirection}
                onChange={(e) => setBulkDirection(e.target.value as "both" | "up" | "down")}
                aria-label="알림 방향"
              >
                <option value="both">± 양방향</option>
                <option value="up">+ 상승만</option>
                <option value="down">− 하락만</option>
              </select>
              <input
                className="tvop-count"
                inputMode="decimal"
                value={bulkPct}
                onChange={(e) => setBulkPct(e.target.value)}
                aria-label="변동폭 %"
              />
              <span className="tvop-muted">%</span>
              <button type="button" className="ghost-btn" onClick={() => void createBulkAlerts()} disabled={busy}>
                일괄 알림 만들기
              </button>
            </div>
          </div>

          <div className="tvop-card">
            <h3 className="subhead">내 워치리스트</h3>
            <p className="tvop-muted tvop-status">
              {loading
                ? "TradingView에서 불러오는 중…"
                : `TradingView 목록 ${watchlists.length}개${
                    overview?.fetchedAt
                      ? ` · ${new Date(overview.fetchedAt).toLocaleTimeString("ko-KR", { hour12: false, timeZone: "Asia/Seoul" })} 갱신`
                      : ""
                  }`}
            </p>
            <ul className="tvop-list">
              {watchlists.map((w) => (
                <li key={w.id} className="tvop-wl">
                  <div className="tvop-wl-row">
                    <input
                      type="checkbox"
                      className="tvop-check"
                      checked={selectedLists.has(w.id)}
                      onChange={() => toggleSelected(w.id)}
                      aria-label={`${w.name} 선택`}
                    />
                    <button
                      type="button"
                      className="tvop-link"
                      onClick={() => setExpandedList(expandedList === w.id ? null : w.id)}
                    >
                      {w.name}
                      {w.active ? <span className="tvop-tag">활성</span> : null}
                      <span className="tvop-muted"> · {w.count}종목</span>
                    </button>
                    <span className="tvop-wl-actions">
                      <button type="button" className="tvop-mini" onClick={() => setTargetId(w.id)}>
                        대상 지정
                      </button>
                      <button
                        type="button"
                        className="tvop-mini tvop-danger"
                        onClick={() => void deleteLists([w])}
                        disabled={busy}
                      >
                        삭제
                      </button>
                    </span>
                  </div>
                  {expandedList === w.id ? (
                    <div className="tvop-chips">
                      {w.symbols.map((s) => (
                        <span key={s} className="tvop-chip">
                          {s}
                          <button
                            type="button"
                            aria-label={`${s} 제거`}
                            onClick={() => void sync("remove", [s], w.name, w.id)}
                            disabled={busy}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {!w.symbols.length ? <span className="tvop-muted">비어 있습니다.</span> : null}
                    </div>
                  ) : null}
                </li>
              ))}
              {!watchlists.length ? <li className="tvop-muted">워치리스트가 없습니다.</li> : null}
            </ul>
            <div className="tvop-row">
              <button type="button" className="chip" onClick={() => void loadOverview()} disabled={loading}>
                새로고침
              </button>
              <button type="button" className="chip" onClick={selectSavvyLists} disabled={busy}>
                Savvy 목록 모두 선택
              </button>
              {selectedLists.size ? (
                <>
                  <button
                    type="button"
                    className="ghost-btn tvop-danger"
                    onClick={() => void deleteLists(watchlists.filter((w) => selectedLists.has(w.id)))}
                    disabled={busy}
                  >
                    선택 삭제 ({selectedLists.size})
                  </button>
                  <button type="button" className="tvop-mini" onClick={() => setSelectedLists(new Set())}>
                    선택 해제
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div className="tvop-card">
            <h3 className="subhead">가격 알림</h3>
            <form className="tvop-row" onSubmit={(e) => void createAlert(e)}>
              <input
                placeholder="종목 (005930, NVDA)"
                value={alertSymbol}
                onChange={(e) => setAlertSymbol(e.target.value)}
                required
              />
              <input
                placeholder="가격"
                inputMode="decimal"
                value={alertPrice}
                onChange={(e) => setAlertPrice(e.target.value)}
                required
              />
              <select value={alertCondition} onChange={(e) => setAlertCondition(e.target.value)}>
                {Object.entries(CONDITION_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <button type="submit" className="ghost-btn" disabled={busy}>
                알림 만들기
              </button>
            </form>
            <h4 className="tvop-sub">
              내 알림 (활성 {(overview?.alerts || []).filter((a) => a.active).length} · 전체{" "}
              {(overview?.alerts || []).length})
            </h4>
            <ul className="tvop-list tvop-scroll">
              {[...(overview?.alerts || [])]
                .sort((a, b) => Number(b.active) - Number(a.active))
                .slice(0, 30)
                .map((a) => (
                  <li key={a.id} className={a.active ? "" : "tvop-off"}>
                    <span>{a.symbol}</span>
                    <span className="tvop-wl-actions">
                      <span className="tvop-muted">
                        {CONDITION_LABELS[a.condition] || a.condition} {a.threshold ?? ""}
                        {a.active ? "" : " · 정지"}
                      </span>
                      <button
                        type="button"
                        className="tvop-mini"
                        onClick={() => void setAlertActive(a, !a.active)}
                        disabled={busy}
                      >
                        {a.active ? "정지" : "재개"}
                      </button>
                      <button
                        type="button"
                        className="tvop-mini tvop-danger"
                        onClick={() => void deleteAlert(a)}
                        disabled={busy}
                      >
                        삭제
                      </button>
                    </span>
                  </li>
                ))}
              {!overview?.alerts?.length ? <li className="tvop-muted">알림이 없습니다.</li> : null}
            </ul>
            <h4 className="tvop-sub">최근 7일 발동</h4>
            <ul className="tvop-list">
              {(overview?.fires || []).slice(0, 10).map((f, i) => (
                <li key={`${f.symbol}-${f.firedAt}-${i}`}>
                  <span>{f.symbol || f.name}</span>
                  <span className="tvop-muted">
                    {f.firedAt
                      ? new Date(f.firedAt).toLocaleString("ko-KR", { hour12: false, timeZone: "Asia/Seoul" })
                      : ""}
                  </span>
                </li>
              ))}
              {!overview?.fires?.length ? <li className="tvop-muted">발동 기록이 없습니다.</li> : null}
            </ul>
            {overview?.errors?.length ? <p className="tvop-muted">{overview.errors.join(" · ")}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
