"use client";

import BriefSlotView from "@/components/BriefSlotView";
import { ESG_TAB_BRIEF_NOTES } from "@/lib/esgShared";
import type { BriefSlot, ShellTabId } from "@/lib/types";

export default function EsgBriefStrip({
  tab,
  slots,
}: {
  tab: ShellTabId;
  slots: BriefSlot[];
}) {
  const note = ESG_TAB_BRIEF_NOTES[tab];
  const missingAibrief = tab === "aigov" && !slots.some((s) => s.slot === "esg_ai_gov_brief");

  return (
    <section className="panel kr-briefs esg-brief-strip">
      <h2 className="kr-briefs-title">관련 ESG 브리프</h2>
      {note ? <p className="kr-note">{note}</p> : null}
      {missingAibrief ? (
        <p className="kr-note warn">
          <code>esg_ai_gov_brief</code> 슬롯이 비어 있습니다. 텔레그램{" "}
          <code>/esg aibrief</code> 또는 스케줄{" "}
          <code>ESG_AIBRIEF_SCHEDULE_ENABLED=true</code>로 채울 수 있습니다.
        </p>
      ) : null}
      {!slots.length ? (
        <p className="empty">
          이 탭에 연결된 브리프 스냅샷이 아직 없습니다. 텔레그램 봇 스케줄 또는 수동
          명령 후 자동으로 채워집니다.
        </p>
      ) : (
        slots.map((slot) => <BriefSlotView key={slot.slot} slot={slot} />)
      )}
    </section>
  );
}
