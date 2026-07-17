import { head, put } from "@vercel/blob";

import {
  type AllBriefs,
  type BriefSlot,
  type TabBriefs,
  type TabId,
  emptyTab,
  isTabId,
} from "./types";

function blobPath(tab: TabId): string {
  return `briefs/${tab}.json`;
}

async function readTab(tab: TabId): Promise<TabBriefs> {
  try {
    const meta = await head(blobPath(tab));
    if (!meta?.url) return emptyTab(tab);
    const res = await fetch(meta.url, { cache: "no-store" });
    if (!res.ok) return emptyTab(tab);
    const parsed = (await res.json()) as TabBriefs;
    if (!parsed || typeof parsed.slots !== "object") return emptyTab(tab);
    return {
      tab,
      updated_at: parsed.updated_at ?? null,
      slots: parsed.slots ?? {},
    };
  } catch {
    return emptyTab(tab);
  }
}

export async function loadTabBriefs(tab: TabId): Promise<TabBriefs> {
  return readTab(tab);
}

export async function loadAllBriefs(): Promise<AllBriefs> {
  const [kr, us, etf, esg] = await Promise.all([
    readTab("kr"),
    readTab("us"),
    readTab("etf"),
    readTab("esg"),
  ]);
  return { kr, us, etf, esg };
}

export type IngestBody = {
  tab: string;
  slot: string;
  generated_at: string;
  title: string;
  html?: string;
  sections?: BriefSlot["sections"];
  meta?: Record<string, unknown>;
};

export async function upsertBriefSlot(body: IngestBody): Promise<TabBriefs> {
  if (!isTabId(body.tab)) {
    throw new Error(`Invalid tab: ${body.tab}`);
  }
  if (!body.slot?.trim()) {
    throw new Error("Missing slot");
  }
  if (!body.generated_at?.trim() || !body.title?.trim()) {
    throw new Error("Missing generated_at or title");
  }

  const current = await readTab(body.tab);
  const now = new Date().toISOString();
  const slot: BriefSlot = {
    slot: body.slot.trim(),
    generated_at: body.generated_at,
    title: body.title,
    html: body.html,
    sections: body.sections,
    meta: body.meta ?? {},
    received_at: now,
  };

  const next: TabBriefs = {
    tab: body.tab,
    updated_at: now,
    slots: {
      ...current.slots,
      [slot.slot]: slot,
    },
  };

  await put(blobPath(body.tab), JSON.stringify(next, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return next;
}
