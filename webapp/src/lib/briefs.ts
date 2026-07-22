import { head, put } from "@vercel/blob";

import {
  type AllBriefs,
  type BriefImage,
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
    // Prefer downloadUrl / cache-bust — public blob URLs are CDN-cached and
    // can serve stale JSON right after overwrite.
    const uploadedMs = meta.uploadedAt
      ? new Date(meta.uploadedAt).getTime()
      : Date.now();
    const baseUrl = meta.downloadUrl || meta.url;
    const sep = baseUrl.includes("?") ? "&" : "?";
    const res = await fetch(`${baseUrl}${sep}v=${uploadedMs}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
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

export type IngestImage = {
  id: string;
  caption?: string;
  png_base64: string;
};

export type IngestBody = {
  tab: string;
  slot: string;
  generated_at: string;
  title: string;
  html?: string;
  sections?: BriefSlot["sections"];
  images?: IngestImage[];
  meta?: Record<string, unknown>;
};

function imageBlobPath(tab: TabId, slot: string, id: string, version: number): string {
  // Versioned pathname so overwrites never reuse a CDN-cached URL
  // (public Blob URLs default to max-age ≈ 30 days).
  return `briefs/images/${tab}/${slot}/${id}-${version}.png`;
}

async function uploadImages(
  tab: TabId,
  slot: string,
  images: IngestImage[] | undefined,
): Promise<BriefImage[] | undefined> {
  if (!images?.length) return undefined;

  const out: BriefImage[] = [];
  for (const image of images) {
    const id = image.id?.trim() || "chart";
    const buf = Buffer.from(image.png_base64, "base64");
    const version = Date.now();
    const result = await put(imageBlobPath(tab, slot, id, version), buf, {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
      // Minimum allowed by @vercel/blob; still far better than 30-day default.
      cacheControlMaxAge: 60,
    });
    // Extra query bust for any intermediary that keys only on pathname.
    const sep = result.url.includes("?") ? "&" : "?";
    out.push({
      id,
      url: `${result.url}${sep}v=${version}`,
      caption: image.caption,
    });
  }
  return out;
}

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
  const slotKey = body.slot.trim();
  const uploadedImages = await uploadImages(body.tab, slotKey, body.images);
  const slot: BriefSlot = {
    slot: slotKey,
    generated_at: body.generated_at,
    title: body.title,
    html: body.html,
    sections: body.sections,
    images: uploadedImages,
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
