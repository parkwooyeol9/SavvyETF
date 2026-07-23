import { head, put } from "@vercel/blob";

import { botBaseUrl, fetchBotJson } from "./bot";
import {
  type AllBriefs,
  type BriefImage,
  type BriefSlot,
  type TabBriefs,
  type TabId,
  emptyAllBriefs,
  emptyTab,
  isTabId,
  TAB_IDS,
} from "./types";
import { sanitizeBriefHtml, sanitizeDocumentHtml } from "./sanitizeHtml";

function blobPath(tab: TabId): string {
  return `briefs/${tab}.json`;
}

function safeKeyPart(value: string, fallback: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return cleaned.slice(0, 64) || fallback;
}

type TabReadResult = {
  tab: TabBriefs;
  error?: string;
};

function slotCount(briefs: AllBriefs): number {
  return TAB_IDS.reduce(
    (sum, id) => sum + Object.keys(briefs[id]?.slots || {}).length,
    0,
  );
}

async function readTab(tab: TabId): Promise<TabReadResult> {
  try {
    const meta = await head(blobPath(tab));
    if (!meta?.url) return { tab: emptyTab(tab) };
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
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const detail = body.slice(0, 120) || res.statusText;
      return {
        tab: emptyTab(tab),
        error: `blob ${res.status}: ${detail}`,
      };
    }
    const parsed = (await res.json()) as TabBriefs;
    if (!parsed || typeof parsed.slots !== "object") {
      return { tab: emptyTab(tab) };
    }
    return {
      tab: {
        tab,
        updated_at: parsed.updated_at ?? null,
        slots: parsed.slots ?? {},
      },
    };
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return { tab: emptyTab(tab), error: message };
  }
}

async function loadBriefsFromRender(): Promise<{
  briefs: AllBriefs;
  error?: string;
}> {
  try {
    const data = await fetchBotJson<{
      ok?: boolean;
      briefs?: AllBriefs;
      error?: string;
    }>("/api/web-briefs", { timeoutMs: 20_000 });
    if (!data?.ok || !data.briefs) {
      return {
        briefs: emptyAllBriefs(),
        error: data?.error || "Render briefs unavailable",
      };
    }
    const briefs = emptyAllBriefs();
    for (const id of TAB_IDS) {
      const tab = data.briefs[id];
      if (tab && typeof tab.slots === "object") {
        briefs[id] = {
          tab: id,
          updated_at: tab.updated_at ?? null,
          slots: tab.slots ?? {},
        };
      }
    }
    return { briefs };
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return { briefs: emptyAllBriefs(), error: message };
  }
}

export type BriefsLoadResult = {
  briefs: AllBriefs;
  source: "blob" | "render-fallback" | "empty";
  warning?: string;
};

export async function loadTabBriefs(tab: TabId): Promise<TabBriefs> {
  const fromBlob = await readTab(tab);
  if (Object.keys(fromBlob.tab.slots).length) return fromBlob.tab;
  const fromRender = await loadBriefsFromRender();
  return fromRender.briefs[tab] || emptyTab(tab);
}

export async function loadAllBriefs(): Promise<BriefsLoadResult> {
  const results = await Promise.all(TAB_IDS.map((id) => readTab(id)));
  const blobBriefs: AllBriefs = {
    kr: results[0].tab,
    us: results[1].tab,
    etf: results[2].tab,
    esg: results[3].tab,
  };
  const blobErrors = results.map((r) => r.error).filter(Boolean) as string[];
  const blobBlocked = blobErrors.some((e) =>
    /store is blocked|blob 403/i.test(e),
  );

  if (slotCount(blobBriefs) > 0 && !blobBlocked) {
    return { briefs: blobBriefs, source: "blob" };
  }

  const fallback = await loadBriefsFromRender();
  if (slotCount(fallback.briefs) > 0) {
    const warning = blobBlocked
      ? "Vercel Blob store is blocked — showing Render fallback"
      : blobErrors[0]
        ? `Blob read failed (${blobErrors[0]}) — showing Render fallback`
        : "Blob empty — showing Render fallback";
    return {
      briefs: fallback.briefs,
      source: "render-fallback",
      warning,
    };
  }

  const warning = blobBlocked
    ? "Vercel Blob store is blocked. Create/unblock a Blob store and update BLOB_READ_WRITE_TOKEN."
    : fallback.error || blobErrors[0] || "No brief snapshots yet";
  return {
    briefs: emptyAllBriefs(),
    source: "empty",
    warning,
  };
}

/** @deprecated kept for callers that only need the map */
export async function loadAllBriefsMap(): Promise<AllBriefs> {
  const result = await loadAllBriefs();
  return result.briefs;
}

/** Public bot base — used for CSP / diagnostics. */
export function briefsFallbackOrigin(): string {
  return botBaseUrl();
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
  const safeSlot = safeKeyPart(slot, "slot");
  const safeId = safeKeyPart(id, "chart");
  return `briefs/images/${tab}/${safeSlot}/${safeId}-${version}.png`;
}

async function uploadImages(
  tab: TabId,
  slot: string,
  images: IngestImage[] | undefined,
): Promise<BriefImage[] | undefined> {
  if (!images?.length) return undefined;

  const out: BriefImage[] = [];
  for (const image of images) {
    const id = safeKeyPart(image.id || "chart", "chart");
    let buf: Buffer;
    try {
      buf = Buffer.from(image.png_base64 || "", "base64");
    } catch {
      console.warn(`ingest skip image id=${id}: invalid base64`);
      continue;
    }
    // PNG magic bytes — skip bad images, do not fail the whole brief
    if (
      buf.length < 8 ||
      buf[0] !== 0x89 ||
      buf[1] !== 0x50 ||
      buf[2] !== 0x4e ||
      buf[3] !== 0x47
    ) {
      console.warn(`ingest skip image id=${id}: not a PNG`);
      continue;
    }
    const version = Date.now();
    const result = await put(imageBlobPath(tab, slot, id, version), buf, {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
    });
    const sep = result.url.includes("?") ? "&" : "?";
    out.push({
      id,
      url: `${result.url}${sep}v=${version}`,
      caption: image.caption,
    });
  }
  return out.length ? out : undefined;
}

export async function upsertBriefSlot(body: IngestBody): Promise<TabBriefs> {
  if (!isTabId(body.tab)) {
    throw new Error(`Invalid tab: ${body.tab}`);
  }
  const slotKey = safeKeyPart(body.slot || "", "");
  if (!slotKey) {
    throw new Error("Missing slot");
  }
  if (!body.generated_at?.trim() || !body.title?.trim()) {
    throw new Error("Missing generated_at or title");
  }

  const current = (await readTab(body.tab)).tab;
  const now = new Date().toISOString();
  const uploadedImages = await uploadImages(body.tab, slotKey, body.images);
  const sections = (body.sections || []).map((section) => ({
    ...section,
    html_or_text: sanitizeBriefHtml(section.html_or_text || ""),
  }));
  const slot: BriefSlot = {
    slot: slotKey,
    generated_at: body.generated_at,
    title: body.title.slice(0, 200),
    // Full pages: document sanitizer only (iframe sandbox)
    html: body.html ? sanitizeDocumentHtml(body.html) : body.html,
    sections: sections.length ? sections : undefined,
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
