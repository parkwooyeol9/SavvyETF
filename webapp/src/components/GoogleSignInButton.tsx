"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export default function GoogleSignInButton({
  next = "/community",
  label = "Google로 계속하기",
}: {
  next?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (authError) throw authError;
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "로그인 실패");
      setBusy(false);
    }
  }

  return (
    <div className="community-auth">
      <button
        type="button"
        className="community-google-btn"
        onClick={() => void onClick()}
        disabled={busy}
      >
        {busy ? "이동 중…" : label}
      </button>
      {error ? <p className="empty warn">{error}</p> : null}
    </div>
  );
}
