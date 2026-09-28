"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAdminSession } from "@/components/AdminSession";

export type MpSaveState = "idle" | "saving" | "saved" | "error";

type Options<T> = {
  kind: "mp" | "etf";
  normalize: (raw: unknown) => T | null;
  fallback: () => T;
  loadLocal: () => T | null;
  saveLocal: (p: T) => void;
};

const SAVE_DEBOUNCE_MS = 700;

/** Server-shared MP portfolio: everyone reads it, only the site admin can edit. */
export function useSharedMpPortfolio<T>(options: Options<T>) {
  const { secret, unlocked, ready } = useAdminSession();
  const opts = useRef(options);
  opts.current = options;
  const [pf, setPf] = useState<T | null>(null);
  const [saveState, setSaveState] = useState<MpSaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<T | null>(null);
  const secretRef = useRef(secret);
  secretRef.current = secret;

  const push = useCallback(async (p: T) => {
    const { kind } = opts.current;
    setSaveState("saving");
    try {
      const r = await fetch(`/api/mp/portfolio?kind=${kind}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secretRef.current}` },
        body: JSON.stringify({ portfolio: p }),
        keepalive: true,
      });
      const json = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !json.ok) throw new Error(json.error || `저장 실패 (${r.status})`);
      setSaveState("saved");
      setSaveError(null);
    } catch (exc) {
      setSaveState("error");
      setSaveError(exc instanceof Error ? exc.message : String(exc));
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void (async () => {
      const { kind, normalize, fallback, loadLocal } = opts.current;
      let remote: T | null = null;
      let remoteOk = false;
      try {
        const r = await fetch(`/api/mp/portfolio?kind=${kind}`, { cache: "no-store" });
        const json = (await r.json()) as { ok?: boolean; portfolio?: unknown };
        remoteOk = r.ok && Boolean(json.ok);
        remote = normalize(json.portfolio);
      } catch {
        /* fall through to default */
      }
      if (!alive) return;
      if (remote) {
        setPf(remote);
        return;
      }
      const local = unlocked ? loadLocal() : null;
      setPf(local ?? fallback());
      if (local && remoteOk) void push(local);
    })();
    return () => {
      alive = false;
    };
    // Load once the admin session is resolved; later login/logout only toggles edit rights.
  }, [ready]);

  useEffect(
    () => () => {
      if (timer.current && pending.current) {
        clearTimeout(timer.current);
        void push(pending.current);
      }
    },
    [push],
  );

  const update = useCallback(
    (next: T): boolean => {
      if (!unlocked) return false;
      setPf(next);
      opts.current.saveLocal(next);
      pending.current = next;
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        pending.current = null;
        void push(next);
      }, SAVE_DEBOUNCE_MS);
      return true;
    },
    [unlocked, push],
  );

  return { pf, update, canEdit: unlocked, saveState, saveError };
}
