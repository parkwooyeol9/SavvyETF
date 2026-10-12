"use client";

import { useEffect, useState } from "react";

/**
 * AI Pulse — two static pages (public/ai-pulse/*.html) that load their data from /api/ai-pulse.
 * The pages are self-contained (SVG charts, no deps); this tab only frames them and sizes the iframe.
 */
type View = "pulse" | "economy";

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: "economy", label: "AI 경제 침투", hint: "투자·매출·기업 채택·생산성·로봇·인프라 병목" },
  { id: "pulse", label: "구루·개발자·채용", hint: "AI 구루 발언·SDK 점유·채용·오픈모델·앱 순위" },
];

const STORE_KEY = "aiPulse.view";

/** ?view= if the shell keeps it, else the viewer's last choice (Dashboard normalizes the URL, so this is per-browser). */
function initialView(): View {
  if (typeof window === "undefined") return "economy";
  const q = new URLSearchParams(window.location.search).get("view");
  if (q === "pulse" || q === "economy") return q;
  try {
    return window.localStorage.getItem(STORE_KEY) === "pulse" ? "pulse" : "economy";
  } catch {
    return "economy";
  }
}

export default function AiPulseTab() {
  const [view, setView] = useState<View>("economy");
  const [height, setHeight] = useState(1800);

  useEffect(() => {
    setView(initialView());
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; page?: string; h?: number } | null;
      if (d?.type === "ai-pulse-height" && typeof d.h === "number") {
        setHeight(Math.max(600, Math.ceil(d.h) + 24));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <section className="ap-tab">
      <div className="ap-views" role="tablist" aria-label="AI 시황 보기">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            className={view === v.id ? "ap-view active" : "ap-view"}
            onClick={() => {
              setView(v.id);
              try {
                window.localStorage.setItem(STORE_KEY, v.id);
              } catch {
                /* private mode: just don't remember */
              }
              const url = new URL(window.location.href);
              url.searchParams.set("tab", "aipulse");
              url.searchParams.set("view", v.id);
              window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
            }}
            title={v.hint}
          >
            {v.label}
          </button>
        ))}
      </div>
      <iframe
        key={view}
        src={`/ai-pulse/${view}.html?theme=dark&embed=1`}
        title={view === "economy" ? "AI 경제 침투" : "구루·개발자·채용"}
        className="ap-frame"
        style={{ width: "100%", height, border: 0, display: "block" }}
        loading="lazy"
      />
    </section>
  );
}
