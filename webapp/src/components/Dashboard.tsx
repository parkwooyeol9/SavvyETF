"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import MainTab from "@/components/MainTab";
import EducationTab from "@/components/EducationTab";
import KrMarketTab from "@/components/KrMarketTab";
import SimulateTab from "@/components/SimulateTab";
import {
  type AllBriefs,
  type BriefSlot,
  type ShellTabId,
  SHELL_TAB_IDS,
  SHELL_TAB_LABELS,
  TAB_LABELS,
  TAB_SLOT_ORDER,
  emptyAllBriefs,
  isBriefTabId,
  type TabId,
} from "@/lib/types";

type BriefsResponse = {
  ok: boolean;
  configured?: boolean;
  briefs?: AllBriefs;
  error?: string;
};

function orderedSlots(tab: TabId, slots: Record<string, BriefSlot>): BriefSlot[] {
  const order = TAB_SLOT_ORDER[tab];
  const seen = new Set<string>();
  const out: BriefSlot[] = [];
  for (const key of order) {
    if (slots[key]) {
      out.push(slots[key]);
      seen.add(key);
    }
  }
  const rest = Object.keys(slots)
    .filter((k) => !seen.has(k))
    .sort()
    .map((k) => slots[k]);
  return [...out, ...rest];
}

function formatWhen(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ko-KR", { hour12: false });
}

function SlotView({ slot }: { slot: BriefSlot }) {
  const srcDoc = useMemo(() => {
    if (!slot.html) return null;
    const trimmed = slot.html.trim();
    if (/^<!DOCTYPE|^<html/i.test(trimmed)) return trimmed;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{margin:12px;font-family:system-ui,sans-serif;background:#0a0f16;color:#e8eef5;line-height:1.5}a{color:#4da3ff}</style></head><body>${trimmed}</body></html>`;
  }, [slot.html]);

  return (
    <article className="slot-card">
      <div className="slot-head">
        <h3 className="slot-title">
          {slot.title}
          <span className="slot-badge">{slot.slot}</span>
        </h3>
        <div className="slot-time">생성 {formatWhen(slot.generated_at)}</div>
      </div>

      {srcDoc ? (
        <iframe
          className="html-frame"
          title={slot.title}
          srcDoc={srcDoc}
          sandbox=""
        />
      ) : null}

      {(slot.images || []).map((image) => {
        const bust =
          slot.received_at || slot.generated_at || image.id || "1";
        const sep = image.url.includes("?") ? "&" : "?";
        const src = `${image.url}${sep}t=${encodeURIComponent(bust)}`;
        return (
          <figure
            className="slot-image"
            key={`${slot.slot}-${image.id}-${bust}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={image.caption || slot.title} loading="lazy" />
            {image.caption ? <figcaption>{image.caption}</figcaption> : null}
          </figure>
        );
      })}

      {(slot.sections || []).map((section, idx) => (
        <div className="section-block" key={`${slot.slot}-${idx}`}>
          {section.heading ? <h4>{section.heading}</h4> : null}
          <div
            className="section-body"
            dangerouslySetInnerHTML={{ __html: section.html_or_text }}
          />
        </div>
      ))}

      {!srcDoc &&
      !(slot.images || []).length &&
      !(slot.sections || []).length ? (
        <p className="empty">이 슬롯에 표시할 본문이 없습니다.</p>
      ) : null}
    </article>
  );
}

export default function Dashboard() {
  const [tab, setTab] = useState<ShellTabId>("main");
  const [briefs, setBriefs] = useState<AllBriefs>(emptyAllBriefs());
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/briefs", { cache: "no-store" });
      const data = (await res.json()) as BriefsResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setBriefs(data.briefs || emptyAllBriefs());
      setConfigured(Boolean(data.configured));
      setError(null);
      setFetchedAt(new Date().toISOString());
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const briefTab = isBriefTabId(tab) ? tab : null;
  const current = briefTab ? briefs[briefTab] : null;
  const slots = briefTab ? orderedSlots(briefTab, current?.slots || {}) : [];

  const metaText = (() => {
    if (tab === "main" || tab === "simulate" || tab === "education") {
      return error
        ? `시황 동기화 참고: ${error}`
        : `시황 갱신 ${formatWhen(fetchedAt)}`;
    }
    if (error) return `동기화 오류: ${error}`;
    if (configured === false) {
      return "Blob 미설정 — 봇 publish 후 데이터가 표시됩니다";
    }
    return `갱신 ${formatWhen(fetchedAt)} · 탭 ${formatWhen(current?.updated_at)}`;
  })();

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-dot" aria-hidden />
          SavvyETF
        </a>
        <div className="meta-line">
          <span
            className={`status-dot ${error ? "err" : configured ? "ok" : ""}`}
            aria-hidden
          />
          {metaText}
        </div>
      </header>

      <nav className="tabs" aria-label="대시보드 탭">
        {SHELL_TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`tab-btn ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {SHELL_TAB_LABELS[id]}
          </button>
        ))}
      </nav>

      {tab === "main" ? (
        <MainTab />
      ) : tab === "simulate" ? (
        <SimulateTab />
      ) : tab === "education" ? (
        <EducationTab />
      ) : tab === "kr" ? (
        <>
          <KrMarketTab />
          <section className="panel kr-briefs">
            <h2 className="kr-briefs-title">시황 브리프</h2>
            {!slots.length ? (
              <p className="empty">
                국내 브리프 스냅샷이 아직 없습니다. 텔레그램 봇 스케줄 또는 수동
                명령 후 자동으로 채워집니다.
              </p>
            ) : (
              slots.map((slot) => <SlotView key={slot.slot} slot={slot} />)
            )}
          </section>
        </>
      ) : (
        <section className="panel">
          {!slots.length ? (
            <p className="empty">
              {TAB_LABELS[briefTab!]} 스냅샷이 아직 없습니다. 텔레그램 봇 스케줄 또는
              수동 명령 후 자동으로 채워집니다.
            </p>
          ) : (
            slots.map((slot) => <SlotView key={slot.slot} slot={slot} />)
          )}
        </section>
      )}
    </div>
  );
}
