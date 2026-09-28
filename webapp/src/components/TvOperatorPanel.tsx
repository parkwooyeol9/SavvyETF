"use client";

import { useCallback, useEffect, useState } from "react";

import { useAdminSession } from "@/components/AdminSession";
import type { HeatmapCell } from "@/lib/heatmap";
import type { KosdaqActivePayload } from "@/lib/kosdaqActive";
import type { TvAlertFire, TvAlertSummary, TvWatchlistSummary } from "@/lib/tvMcp/operator";

type Overview = {
  ok: boolean;
  connected?: boolean;
  error?: string;
  watchlists?: TvWatchlistSummary[];
  alerts?: TvAlertSummary[];
  fires?: TvAlertFire[];
  errors?: string[];
};

type SyncResult = {
  ok: boolean;
  error?: string;
  synced?: boolean;
  created?: boolean;
  added?: number;
  removed?: number;
  resolved?: string[];
  unresolved?: string[];
};

type Flash = { kind: "ok" | "warn"; text: string } | null;

const CONDITION_LABELS: Record<string, string> = {
  cross_up: "상향 돌파",
  cross_down: "하향 돌파",
  cross: "돌파(양방향)",
};

function todayLabel(): string {
  return new Date().toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
  }).replace(/\s/g, "");
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

  const [listName, setListName] = useState("");
  const [symbolsText, setSymbolsText] = useState("");
  const [mode, setMode] = useState<"append" | "replace">("replace");

  const [alertSymbol, setAlertSymbol] = useState("");
  const [alertPrice, setAlertPrice] = useState("");
  const [alertCondition, setAlertCondition] = useState("cross_up");

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
      return (await res.json()) as T;
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

  async function connect() {
    setBusy(true);
    try {
      const res = await authFetch<{ ok: boolean; url?: string; error?: string }>(
        "/api/tv/oauth/start",
        { method: "POST" },
      );
      if (!res.ok || !res.url) throw new Error(res.error || "연결을 시작하지 못했습니다.");
      window.location.href = res.url;
    } catch (exc) {
      setFlash({ kind: "warn", text: exc instanceof Error ? exc.message : "연결 실패" });
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await authFetch("/api/tv/disconnect", { method: "POST" });
      setOverview({ ok: true, connected: false });
      setFlash({ kind: "ok", text: "TradingView 연결을 해제했습니다." });
    } finally {
      setBusy(false);
    }
  }

  function applyPreset(label: string, symbols: string[]) {
    setSymbolsText(symbols.join(", "));
    setListName(`Savvy · ${label} ${todayLabel()}`);
    setFlash(null);
  }

  function presetHeatmap(direction: "up" | "down") {
    const sorted = [...heatmapCells].sort((a, b) =>
      direction === "up"
        ? b.daily_return_pct - a.daily_return_pct
        : a.daily_return_pct - b.daily_return_pct,
    );
    const picks = sorted.slice(0, 10).map((c) => c.ticker);
    if (!picks.length) {
      setFlash({ kind: "warn", text: "히트맵 데이터가 아직 없습니다." });
      return;
    }
    applyPreset(`${universeLabel} ${direction === "up" ? "상승" : "하락"} Top10`, picks);
  }

  async function presetKosdaqActive() {
    setBusy(true);
    try {
      const res = await fetch("/api/kosdaq-active");
      const data = (await res.json()) as KosdaqActivePayload;
      const rows = [...(data.consensus || [])].sort(
        (a, b) => b.fund_count - a.fund_count || b.avg_weight - a.avg_weight,
      );
      const picks = rows.slice(0, 15).map((r) => r.code);
      if (!picks.length) throw new Error("코스닥 액티브 공통 편입 데이터가 없습니다.");
      applyPreset("코스닥액티브 공통편입 Top15", picks);
    } catch (exc) {
      setFlash({ kind: "warn", text: exc instanceof Error ? exc.message : "불러오기 실패" });
    } finally {
      setBusy(false);
    }
  }

  async function sync(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      const res = await authFetch<SyncResult>("/api/tv/watchlist-sync", {
        method: "POST",
        body: JSON.stringify({ name: listName, symbols: parseSymbols(symbolsText), mode }),
      });
      if (!res.ok) throw new Error(res.error || "동기화 실패");
      const missed = res.unresolved?.length ? ` · 못 찾은 종목: ${res.unresolved.join(", ")}` : "";
      if (!res.synced) {
        setFlash({ kind: "warn", text: `보낼 수 있는 종목이 없습니다${missed}` });
      } else {
        const verb = res.created ? "새로 만들었습니다" : "업데이트했습니다";
        setFlash({
          kind: res.unresolved?.length ? "warn" : "ok",
          text: `‘${listName}’ 워치리스트를 ${verb} (추가 ${res.added ?? 0} · 제거 ${res.removed ?? 0})${missed}`,
        });
        void loadOverview();
      }
    } catch (exc) {
      setFlash({ kind: "warn", text: exc instanceof Error ? exc.message : "동기화 실패" });
    } finally {
      setBusy(false);
    }
  }

  async function createAlert(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      const res = await authFetch<{ ok: boolean; error?: string; symbol?: string }>("/api/tv/alerts", {
        method: "POST",
        body: JSON.stringify({ symbol: alertSymbol, price: alertPrice, condition: alertCondition }),
      });
      if (!res.ok) throw new Error(res.error || "알림 생성 실패");
      setFlash({
        kind: "ok",
        text: `${res.symbol} ${alertPrice} ${CONDITION_LABELS[alertCondition] || alertCondition} 알림을 만들었습니다.`,
      });
      setAlertPrice("");
      void loadOverview();
    } catch (exc) {
      setFlash({ kind: "warn", text: exc instanceof Error ? exc.message : "알림 생성 실패" });
    } finally {
      setBusy(false);
    }
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
          <form className="tvop-card" onSubmit={(e) => void sync(e)}>
            <h3 className="subhead">봇 픽 → 워치리스트</h3>
            <div className="chip-row">
              <button type="button" className="chip" onClick={() => presetHeatmap("up")}>
                히트맵 상승 Top10
              </button>
              <button type="button" className="chip" onClick={() => presetHeatmap("down")}>
                히트맵 하락 Top10
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => void presetKosdaqActive()}
                disabled={busy}
              >
                코스닥 액티브 공통편입
              </button>
            </div>
            <label className="tvop-field">
              <span>워치리스트 이름</span>
              <input value={listName} onChange={(e) => setListName(e.target.value)} required maxLength={200} />
            </label>
            <label className="tvop-field">
              <span>종목 (쉼표·공백 구분, 최대 30개 · 005930, NVDA, NASDAQ:AAPL)</span>
              <textarea
                value={symbolsText}
                onChange={(e) => setSymbolsText(e.target.value)}
                rows={3}
                required
              />
            </label>
            <div className="tvop-row">
              <select value={mode} onChange={(e) => setMode(e.target.value as "append" | "replace")}>
                <option value="replace">같은 이름이면 교체</option>
                <option value="append">같은 이름이면 추가만</option>
              </select>
              <button type="submit" className="ghost-btn admin-login-btn" disabled={busy}>
                {busy ? "처리 중…" : "TradingView로 보내기"}
              </button>
            </div>
          </form>

          <div className="tvop-card">
            <h3 className="subhead">내 워치리스트</h3>
            <ul className="tvop-list">
              {(overview?.watchlists || []).map((w) => (
                <li key={w.id}>
                  <span>
                    {w.name}
                    {w.active ? <span className="tvop-tag">활성</span> : null}
                  </span>
                  <span className="tvop-muted">{w.count}종목</span>
                </li>
              ))}
              {!overview?.watchlists?.length ? <li className="tvop-muted">워치리스트가 없습니다.</li> : null}
            </ul>
            <button type="button" className="chip" onClick={() => void loadOverview()} disabled={loading}>
              새로고침
            </button>
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
            <h4 className="tvop-sub">활성 알림</h4>
            <ul className="tvop-list">
              {(overview?.alerts || [])
                .filter((a) => a.active)
                .slice(0, 12)
                .map((a) => (
                  <li key={a.id}>
                    <span>{a.symbol}</span>
                    <span className="tvop-muted">
                      {CONDITION_LABELS[a.condition] || a.condition} {a.threshold ?? ""}
                    </span>
                  </li>
                ))}
              {!(overview?.alerts || []).some((a) => a.active) ? (
                <li className="tvop-muted">활성 알림이 없습니다.</li>
              ) : null}
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
            {overview?.errors?.length ? (
              <p className="tvop-muted">{overview.errors.join(" · ")}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
