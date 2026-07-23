"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import GoogleSignInButton from "@/components/GoogleSignInButton";
import {
  normalizeUsername,
  usernameToEmail,
  validatePassword,
  validateUsername,
} from "@/lib/communityAuth";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function CommunityAuthPanel({
  next = "/community",
}: {
  next?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signup");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const userErr = validateUsername(username);
    if (userErr) {
      setError(userErr);
      return;
    }
    const passErr = validatePassword(password);
    if (passErr) {
      setError(passErr);
      return;
    }
    if (mode === "signup" && password !== password2) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    const uname = normalizeUsername(username);
    const email = usernameToEmail(uname);
    setBusy(true);
    try {
      const supabase = createClient();

      if (mode === "signup") {
        // Soft uniqueness check on display_name / username
        const { data: taken } = await supabase
          .from("profiles")
          .select("id")
          .ilike("display_name", uname)
          .limit(1);
        if (taken?.length) {
          throw new Error("이미 사용 중인 아이디입니다.");
        }

        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: uname,
              name: uname,
              preferred_username: uname,
            },
          },
        });
        if (signUpError) throw signUpError;

        if (!data.session) {
          // Email confirm may still be on — try immediate password sign-in.
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (signInError) {
            throw new Error(
              "가입은 되었지만 세션을 열지 못했습니다. Supabase Authentication → Providers → Email 에서 Confirm email을 끄거나, 로그인 탭에서 다시 시도해 주세요.",
            );
          }
        }

        const {
          data: { user: sessionUser },
        } = await supabase.auth.getUser();
        const userId = sessionUser?.id || data.user?.id;
        if (!userId) {
          throw new Error("가입 후 사용자 정보를 확인하지 못했습니다.");
        }

        const { error: profileError } = await supabase.from("profiles").upsert(
          {
            id: userId,
            display_name: uname,
            avatar_url: null,
          },
          { onConflict: "id" },
        );
        if (profileError) throw profileError;
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) {
          throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
        }
      }

      router.push(next);
      router.refresh();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "인증 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="community-auth-panel">
      <div className="chip-row community-auth-modes" role="tablist">
        <button
          type="button"
          className={`chip ${mode === "signup" ? "active" : ""}`}
          onClick={() => {
            setMode("signup");
            setError(null);
          }}
        >
          익명 아이디 만들기
        </button>
        <button
          type="button"
          className={`chip ${mode === "signin" ? "active" : ""}`}
          onClick={() => {
            setMode("signin");
            setError(null);
          }}
        >
          로그인
        </button>
      </div>

      <form className="community-compose community-auth-form" onSubmit={onSubmit}>
        <label>
          아이디
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="예: savvy_user"
            required
            minLength={3}
            maxLength={24}
          />
        </label>
        <label>
          비밀번호
          <input
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {mode === "signup" ? (
          <label>
            비밀번호 확인
            <input
              name="password2"
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              required
              minLength={8}
            />
          </label>
        ) : null}
        <button type="submit" className="community-submit" disabled={busy}>
          {busy
            ? "처리 중…"
            : mode === "signup"
              ? "아이디 만들고 시작"
              : "로그인"}
        </button>
      </form>

      {error ? <p className="empty warn">{error}</p> : null}

      <p className="meta-soft community-auth-hint">
        이메일 없이 아이디·비밀번호만으로 가입합니다. 비밀번호는 복구할 수 없으니
        따로 기억해 두세요.
      </p>

      <div className="community-auth-divider">
        <span>또는</span>
      </div>
      <GoogleSignInButton next={next} label="Google로 계속하기 (선택)" />
    </div>
  );
}
