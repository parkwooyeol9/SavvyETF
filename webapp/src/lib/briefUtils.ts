import type { BriefSlot } from "@/lib/types";

export function formatBriefWhen(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ko-KR", { hour12: false });
}

export function briefSlotAgeDays(slot: BriefSlot): number | null {
  const raw = slot.received_at || slot.generated_at;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

export function isBriefSlotStale(slot: BriefSlot, thresholdDays = 3): boolean {
  const age = briefSlotAgeDays(slot);
  return age != null && age >= thresholdDays;
}
