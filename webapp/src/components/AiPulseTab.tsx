"use client";

import { useEffect, useState } from "react";

/**
 * AI Pulse — static pages (public/ai-pulse/*.html) framed in an iframe that reports its own height.
 * economy/pulse load their data from /api/ai-pulse (SVG charts, no deps).
 * anthropic-s1 is a fixed snapshot of Anthropic's S-1 (2026-10-26) with its data inlined; it loads
 * ECharts from public/ai-pulse/vendor (the site CSP blocks CDN scripts).
 */
type View = "anthropic-s1" | "pulse" | "economy";

const DEFAULT_VIEW: View = "anthropic-s1";

const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: "anthropic-s1", label: "Anthropic S-1", hint: "S-1 원문 분석: 매출·수익성·고객·컴퓨트 약정·지배구조·리스크·언론 보도 대조" },
  { id: "economy", label: "AI 경제 침투", hint: "투자·매출·기업 채택·생산성·로봇·인프라 병목" },
  { id: "pulse", label: "구루·개발자·채용", hint: "AI 구루 발언·SDK 점유·채용·오픈모델·앱 순위" },
];

/** v2: the S-1 page became the first view (2026-10-27); a fresh key so earlier saved choices don't hide it. */
const STORE_KEY = "aiPulse.view.v2";

function isView(v: string | null): v is View {
  return VIEWS.some((x) => x.id === v);
}

/** ?view= if the shell keeps it, else the viewer's last choice (Dashboard normalizes the URL, so this is per-browser). */
function initialView(): View {
  if (typeof window === "undefined") return DEFAULT_VIEW;
  const q = new URLSearchParams(window.location.search).get("view");
  if (isView(q)) return q;
  try {
    const saved = window.localStorage.getItem(STORE_KEY);
    return isView(saved) ? saved : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

export default function AiPulseTab() {
  const [view, setView] = useState<View>(DEFAULT_VIEW);
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
        title={VIEWS.find((v) => v.id === view)?.label ?? "AI 시황"}
        className="ap-frame"
        style={{ width: "100%", height, border: 0, display: "block" }}
        loading="lazy"
      />
    </section>
  );
}
