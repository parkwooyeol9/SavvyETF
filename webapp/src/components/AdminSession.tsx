"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  clearAdminSecret,
  loadAdminSecret,
  saveAdminSecret,
} from "@/lib/adminSession";

type AdminSessionValue = {
  secret: string;
  unlocked: boolean;
  ready: boolean;
  login: (password: string) => Promise<void>;
  logout: () => void;
};

const AdminSessionContext = createContext<AdminSessionValue | null>(null);

async function verifyAdminSecret(secret: string): Promise<boolean> {
  try {
    const res = await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    const json = (await res.json()) as { ok?: boolean };
    return res.ok && Boolean(json.ok);
  } catch {
    return false;
  }
}

export function AdminSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = loadAdminSecret();
    if (!stored) {
      setReady(true);
      return;
    }
    void (async () => {
      const ok = await verifyAdminSecret(stored);
      if (ok) {
        setSecret(stored);
        setUnlocked(true);
      } else {
        clearAdminSecret();
      }
      setReady(true);
    })();
  }, []);

  const login = useCallback(async (password: string) => {
    const next = password.trim();
    const res = await fetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: next }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      throw new Error(json.error || "비밀번호가 올바르지 않습니다.");
    }
    saveAdminSecret(next);
    setSecret(next);
    setUnlocked(true);
  }, []);

  const logout = useCallback(() => {
    clearAdminSecret();
    setSecret("");
    setUnlocked(false);
  }, []);

  const value = useMemo(
    () => ({ secret, unlocked, ready, login, logout }),
    [secret, unlocked, ready, login, logout],
  );

  return (
    <AdminSessionContext.Provider value={value}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession(): AdminSessionValue {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) {
    return {
      secret: "",
      unlocked: false,
      ready: false,
      login: async () => {
        throw new Error("관리자 세션이 없습니다. 페이지를 새로고침해 주세요.");
      },
      logout: () => {},
    };
  }
  return ctx;
}

export function AdminLoginControl() {
  const { unlocked, login, logout } = useAdminSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
      setPassword("");
      setOpen(false);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "인증 실패");
    } finally {
      setBusy(false);
    }
  }

  if (unlocked) {
    return (
      <div className="admin-login admin-login-on">
        <span className="admin-login-badge">관리자</span>
        <button type="button" className="ghost-btn" onClick={logout}>
          관리 종료
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="admin-login">
        <button
          type="button"
          className="ghost-btn admin-login-btn"
          onClick={() => setOpen(true)}
        >
          관리자 로그인
        </button>
      </div>
    );
  }

  return (
    <div className="admin-login">
      <form className="admin-login-form" onSubmit={(e) => void onSubmit(e)}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="비밀번호"
          aria-label="관리자 비밀번호"
          required
        />
        <button type="submit" className="ghost-btn" disabled={busy}>
          {busy ? "확인…" : "로그인"}
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            setOpen(false);
            setError(null);
            setPassword("");
          }}
        >
          닫기
        </button>
      </form>
      {error ? <p className="admin-login-error">{error}</p> : null}
    </div>
  );
}
