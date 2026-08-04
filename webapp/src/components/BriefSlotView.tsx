"use client";

import { useMemo } from "react";

import { prepareBriefSrcDoc } from "@/lib/briefSrcDoc";
import { briefSlotAgeDays, formatBriefWhen, isBriefSlotStale } from "@/lib/briefUtils";
import { sanitizeBriefHtml } from "@/lib/sanitizeHtml";
import type { BriefSlot } from "@/lib/types";

export default function BriefSlotView({ slot }: { slot: BriefSlot }) {
  const srcDoc = useMemo(() => {
    if (!slot.html) return null;
    return prepareBriefSrcDoc(slot.html);
  }, [slot.html]);
  const ageDays = briefSlotAgeDays(slot);
  const stale = isBriefSlotStale(slot);

  const tall = slot.slot === "summary_kor";

  return (
    <article className={`slot-card${tall ? " slot-card-tall" : ""}`}>
      <div className="slot-head">
        <h3 className="slot-title">
          {slot.title}
          <span className="slot-badge">{slot.slot}</span>
          {stale ? (
            <span className="slot-badge stale" title="3일 이상 갱신되지 않음">
              오래됨 {Math.floor(ageDays!)}일
            </span>
          ) : null}
        </h3>
        <div className="slot-time">생성 {formatBriefWhen(slot.generated_at)}</div>
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
        const bust = slot.received_at || slot.generated_at || image.id || "1";
        const sep = image.url.includes("?") ? "&" : "?";
        const src = `${image.url}${sep}t=${encodeURIComponent(bust)}`;
        return (
          <figure className="slot-image" key={`${slot.slot}-${image.id}-${bust}`}>
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
            dangerouslySetInnerHTML={{
              __html: sanitizeBriefHtml(section.html_or_text),
            }}
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
