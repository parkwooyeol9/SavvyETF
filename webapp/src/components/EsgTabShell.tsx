"use client";

import BriefSlotView from "@/components/BriefSlotView";
import EsgBriefStrip from "@/components/EsgBriefStrip";
import EsgEtfChips from "@/components/EsgEtfChips";
import EsgRiskMap from "@/components/EsgRiskMap";
import { ESG_TAB_BRIEF_SLOTS } from "@/lib/esgShared";
import type { BriefSlot, ShellTabId } from "@/lib/types";

export default function EsgTabShell({
  tab,
  allSlots,
  children,
}: {
  tab: ShellTabId;
  allSlots: BriefSlot[];
  children: React.ReactNode;
}) {
  const slotOrder = ESG_TAB_BRIEF_SLOTS[tab] || [];
  const slotMap = Object.fromEntries(allSlots.map((s) => [s.slot, s]));
  const isFullEsgTab = tab === "esg";

  const filteredSlots: BriefSlot[] = isFullEsgTab
    ? allSlots
    : slotOrder
        .map((key) => slotMap[key])
        .filter((s): s is BriefSlot => Boolean(s));

  const briefSlotsRecord = Object.fromEntries(allSlots.map((s) => [s.slot, s]));

  return (
    <>
      <EsgRiskMap briefSlots={briefSlotsRecord} />
      {children}
      {isFullEsgTab ? (
        <section className="panel kr-briefs">
          <h2 className="kr-briefs-title">ESG 시황 브리프</h2>
          <p className="kr-note">
            브리프 우선순위: 물리적 기후위험 모니터 → 기업 거버넌스 개요 →
            중대재해·안전 공시. 전력·그리드 시그널은 위 레이더 1순위를 보세요. 다른
            ESG 하위 탭에도 관련 브리프가 분산 표시됩니다.
          </p>
          {!allSlots.length ? (
            <p className="empty">
              ESG 브리프 스냅샷이 아직 없습니다. 텔레그램 봇 스케줄 또는 수동 명령 후
              자동으로 채워집니다.
            </p>
          ) : (
            allSlots.map((slot) => <BriefSlotView key={slot.slot} slot={slot} />)
          )}
        </section>
      ) : (
        <EsgBriefStrip tab={tab} slots={filteredSlots} />
      )}
      <EsgEtfChips tab={tab} />
    </>
  );
}
