"use client";

import { useMemo } from "react";

import { prepareBriefSrcDoc, stripUsSummaryMacroSlot } from "@/lib/briefSrcDoc";
import { briefSlotAgeDays, formatBriefWhen, isBriefSlotStale } from "@/lib/briefUtils";
import { sanitizeBriefHtml } from "@/lib/sanitizeHtml";
import type { BriefSlot } from "@/lib/types";

export default function BriefSlotView({ slot }: { slot: BriefSlot }) {
  const view = useMemo(() => stripUsSummaryMacroSlot(slot), [slot]);
  const srcDoc = useMemo(() => {
    if (!view.html) return null;
    return prepareBriefSrcDoc(view.html);
  }, [view.html]);
  const ageDays = briefSlotAgeDays(view);
  const stale = isBriefSlotStale(view);

  const tall = view.slot === "summary_kor" || view.slot === "summary";

  return (
    <article className={`slot-card${tall ? " slot-card-tall" : ""}`}>
      <div className="slot-head">
        <h3 className="slot-title">
          {view.title}
          <span className="slot-badge">{view.slot}</span>
          {stale ? (
            <span className="slot-badge stale" title="3일 이상 갱신되지 않음">
              오래됨 {Math.floor(ageDays!)}일
            </span>
          ) : null}
        </h3>
        <div className="slot-time">생성 {formatBriefWhen(view.generated_at)}</div>
      </div>

      {srcDoc ? (
        <iframe
          className="html-frame"
          title={view.title}
          srcDoc={srcDoc}
          sandbox=""
        />
      ) : null}

      {(view.images || []).map((image) => {
        const bust = view.received_at || view.generated_at || image.id || "1";
        const sep = image.url.includes("?") ? "&" : "?";
        const src = `${image.url}${sep}t=${encodeURIComponent(bust)}`;
        return (
          <figure className="slot-image" key={`${view.slot}-${image.id}-${bust}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={image.caption || view.title} loading="lazy" />
            {image.caption ? <figcaption>{image.caption}</figcaption> : null}
          </figure>
        );
      })}

      {(view.sections || []).map((section, idx) => (
        <div className="section-block" key={`${view.slot}-${idx}`}>
          {section.heading ? <h4>{section.heading}</h4> : null}
          <div
            className="section-body"
            dangerouslySetInnerHTML={{
              __html: sanitizeBriefHtml(section.html_or_text),
            }}
          />
        </div>
      ))}

      {!srcDoc &&
      !(view.images || []).length &&
      !(view.sections || []).length ? (
        <p className="empty">이 슬롯에 표시할 본문이 없습니다.</p>
      ) : null}
    </article>
  );
}
