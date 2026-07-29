import { del, head, list, put } from "@vercel/blob";

import { botBaseUrl, fetchBotJson } from "./bot";
import {
  gcSlotImageOrphans,
  publicUrlForKey,
  r2Configured,
  r2DeleteKeys,
  r2GetObjectText,
  r2ListKeys,
  r2PutObject,
} from "./r2";
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

/** Legacy monolith — read/migrate only. */
function legacyStorePath(tab: TabId): string {
  return `briefs/${tab}.json`;
}

function slotStorePath(tab: TabId, slot: string): string {
  return `briefs/${tab}/slots/${safeKeyPart(slot, "slot")}.json`;
}

function slotsPrefix(tab: TabId): string {
  return `briefs/${tab}/slots/`;
}

function historyStorePath(tab: TabId, slot: string, ts: string): string {
  return `briefs/${tab}/history/${safeKeyPart(slot, "slot")}/${safeKeyPart(ts, "t")}.json`;
}

function historyPrefix(tab: TabId, slot: string): string {
  return `briefs/${tab}/history/${safeKeyPart(slot, "slot")}/`;
}

const HISTORY_KEEP = 5;

function safeKeyPart(value: string, fallback: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return cleaned.slice(0, 64) || fallback;
}

/** Stable PNG key — overwrite in place; orphans GC'd separately. */
function imageStorePath(tab: TabId, slot: string, id: string): string {
  const safeSlot = safeKeyPart(slot, "slot");
  const safeId = safeKeyPart(id, "chart");
  return `briefs/images/${tab}/${safeSlot}/${safeId}.png`;
}

function slotImagePrefix(tab: TabId, slot: string): string {
  return `briefs/images/${tab}/${safeKeyPart(slot, "slot")}/`;
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

function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function remoteStoreConfigured(): boolean {
  return r2Configured() || blobConfigured();
}

async function readTabFromR2(tab: TabId): Promise<TabReadResult> {
  try {
    const slots: Record<string, BriefSlot> = {};
    let updatedAt: string | null = null;
    const bumpUpdated = (ts?: string | null) => {
      if (!ts) return;
      if (!updatedAt || ts > updatedAt) updatedAt = ts;
    };

    const keys = await r2ListKeys(slotsPrefix(tab));
    await Promise.all(
      keys
        .filter((key) => key.endsWith(".json"))
        .map(async (key) => {
          const name = key.split("/").pop()?.replace(/\.json$/, "") || "";
          if (!name) return;
          try {
            const text = await r2GetObjectText(key);
            if (!text) return;
            const parsed = JSON.parse(text) as BriefSlot;
            if (!parsed?.title || !parsed?.generated_at) return;
            const slotKey = safeKeyPart(String(parsed.slot || name), name);
            slots[slotKey] = { ...parsed, slot: slotKey };
            bumpUpdated(parsed.received_at);
          } catch (exc) {
            console.warn(`r2 skip corrupt slot ${key}:`, exc);
          }
        }),
    );

    // Legacy monolith fills only missing slots (per-slot wins).
    try {
      const legacyText = await r2GetObjectText(legacyStorePath(tab));
      if (legacyText) {
        const parsed = JSON.parse(legacyText) as TabBriefs;
        if (parsed && typeof parsed.slots === "object") {
          for (const [key, raw] of Object.entries(parsed.slots || {})) {
            const slotKey = safeKeyPart(String(raw?.slot || key), key);
            if (slots[slotKey] || !raw?.title || !raw?.generated_at) continue;
            slots[slotKey] = { ...raw, slot: slotKey };
          }
          bumpUpdated(parsed.updated_at);
        }
      }
    } catch (exc) {
      console.warn(`r2 legacy read warning (${tab}):`, exc);
    }

    return { tab: { tab, updated_at: updatedAt, slots } };
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc);
    return { tab: emptyTab(tab), error: `r2: ${message}` };
  }
}

async function readTabFromBlob(tab: TabId): Promise<TabReadResult> {
  if (!blobConfigured()) {
    return { tab: emptyTab(tab) };
  }
  try {
    const meta = await head(legacyStorePath(tab));
    if (!meta?.url) return { tab: emptyTab(tab) };
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
    if (!parsed || typeof parsed !== "object" || typeof parsed.slots !== "object") {
      return {
        tab: emptyTab(tab),
        error: `blob: corrupt briefs/${tab}.json (missing slots object)`,
      };
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

async function readTab(tab: TabId): Promise<TabReadResult> {
  if (r2Configured()) {
    const fromR2 = await readTabFromR2(tab);
    if (Object.keys(fromR2.tab.slots).length || !fromR2.error) {
      // Prefer R2 even when empty (authoritative) unless hard error and Blob exists
      if (!fromR2.error || Object.keys(fromR2.tab.slots).length) {
        return fromR2;
      }
    }
    if (fromR2.error && blobConfigured()) {
      return readTabFromBlob(tab);
    }
    return fromR2;
  }
  return readTabFromBlob(tab);
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
  source: "r2" | "blob" | "render" | "render-fallback" | "empty";
  warning?: string;
};

export async function loadTabBriefs(tab: TabId): Promise<TabBriefs> {
  if (r2Configured() || blobConfigured()) {
    const remote = await readTab(tab);
    if (Object.keys(remote.tab.slots).length) return remote.tab;
  }
  const fromRender = await loadBriefsFromRender();
  return fromRender.briefs[tab] || emptyTab(tab);
}

export async function loadAllBriefs(): Promise<BriefsLoadResult> {
  // Prefer R2 when configured
  if (r2Configured()) {
    const results = await Promise.all(TAB_IDS.map((id) => readTabFromR2(id)));
    const r2Briefs: AllBriefs = {
      kr: results[0].tab,
      us: results[1].tab,
      etf: results[2].tab,
      esg: results[3].tab,
    };
    const r2Errors = results.map((r) => r.error).filter(Boolean) as string[];
    if (slotCount(r2Briefs) > 0) {
      return { briefs: r2Briefs, source: "r2" };
    }
    // Empty R2 → try Render, then legacy Blob
    const fromRender = await loadBriefsFromRender();
    if (slotCount(fromRender.briefs) > 0) {
      return {
        briefs: fromRender.briefs,
        source: "render-fallback",
        warning: r2Errors[0] || undefined,
      };
    }
    if (blobConfigured()) {
      const blobResult = await loadAllFromBlob();
      if (slotCount(blobResult.briefs) > 0) return blobResult;
    }
    return {
      briefs: emptyAllBriefs(),
      source: "empty",
      warning:
        r2Errors[0] ||
        fromRender.error ||
        "시황 스냅샷이 아직 없습니다. 텔레그램 스케줄 후 자동으로 채워집니다.",
    };
  }

  if (!blobConfigured()) {
    const fromRender = await loadBriefsFromRender();
    if (slotCount(fromRender.briefs) > 0) {
      return { briefs: fromRender.briefs, source: "render" };
    }
    return {
      briefs: emptyAllBriefs(),
      source: "empty",
      warning:
        fromRender.error ||
        "시황 스냅샷이 아직 없습니다. 텔레그램 스케줄 후 자동으로 채워집니다.",
    };
  }

  return loadAllFromBlob();
}

async function loadAllFromBlob(): Promise<BriefsLoadResult> {
  const results = await Promise.all(TAB_IDS.map((id) => readTabFromBlob(id)));
  const blobBriefs: AllBriefs = {
    kr: results[0].tab,
    us: results[1].tab,
    etf: results[2].tab,
    esg: results[3].tab,
  };
  const blobErrors = results.map((r) => r.error).filter(Boolean) as string[];
  const blobBlocked = blobErrors.some((e) =>
    /store is blocked|blob 403|no token found/i.test(e),
  );

  if (slotCount(blobBriefs) > 0 && !blobBlocked) {
    return { briefs: blobBriefs, source: "blob" };
  }

  const fallback = await loadBriefsFromRender();
  if (slotCount(fallback.briefs) > 0) {
    if (blobBlocked || /no token found/i.test(blobErrors[0] || "")) {
      return { briefs: fallback.briefs, source: "render" };
    }
    const warning = blobErrors[0]
      ? `Blob read failed — showing Render copy`
      : undefined;
    return {
      briefs: fallback.briefs,
      source: "render-fallback",
      warning,
    };
  }

  const warning = blobBlocked
    ? "Blob unavailable and Render has no snapshots yet."
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

async function uploadImagesToR2(
  tab: TabId,
  slot: string,
  images: IngestImage[] | undefined,
): Promise<BriefImage[] | undefined> {
  if (!images?.length) return undefined;

  const out: BriefImage[] = [];
  const keepNames = new Set<string>();
  const version = Date.now();

  for (const image of images) {
    const id = safeKeyPart(image.id || "chart", "chart");
    let buf: Buffer;
    try {
      buf = Buffer.from(image.png_base64 || "", "base64");
    } catch {
      console.warn(`ingest skip image id=${id}: invalid base64`);
      continue;
    }
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
    const key = imageStorePath(tab, slot, id);
    await r2PutObject(key, buf, "image/png", "public, max-age=60");
    keepNames.add(`${id}.png`);
    out.push({
      id,
      url: publicUrlForKey(key, version),
      caption: image.caption,
    });
  }

  try {
    const removed = await gcSlotImageOrphans(slotImagePrefix(tab, slot), keepNames);
    if (removed) {
      console.info(`r2 GC removed ${removed} orphan PNG(s) under ${tab}/${slot}`);
    }
  } catch (exc) {
    console.warn(`r2 GC warning (${tab}/${slot}):`, exc);
  }

  return out.length ? out : undefined;
}

/** Legacy Blob upload with stable keys + orphan GC (versioned *-N.png). */
async function uploadImagesToBlob(
  tab: TabId,
  slot: string,
  images: IngestImage[] | undefined,
): Promise<BriefImage[] | undefined> {
  if (!images?.length) return undefined;

  const out: BriefImage[] = [];
  const keepPaths = new Set<string>();
  const version = Date.now();

  for (const image of images) {
    const id = safeKeyPart(image.id || "chart", "chart");
    let buf: Buffer;
    try {
      buf = Buffer.from(image.png_base64 || "", "base64");
    } catch {
      console.warn(`ingest skip image id=${id}: invalid base64`);
      continue;
    }
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
    const path = imageStorePath(tab, slot, id);
    const result = await put(path, buf, {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
    keepPaths.add(path);
    const sep = result.url.includes("?") ? "&" : "?";
    out.push({
      id,
      url: `${result.url}${sep}v=${version}`,
      caption: image.caption,
    });
  }

  // GC versioned orphans left by older ingest code
  try {
    const prefix = slotImagePrefix(tab, slot);
    const listed = await list({ prefix, limit: 1000 });
    const doomed = (listed.blobs || [])
      .map((b) => b.pathname)
      .filter((p) => p && !keepPaths.has(p));
    if (doomed.length) {
      await del(doomed);
      console.info(`blob GC removed ${doomed.length} orphan PNG(s) under ${prefix}`);
    }
  } catch (exc) {
    console.warn(`blob GC warning (${tab}/${slot}):`, exc);
  }

  return out.length ? out : undefined;
}

async function uploadImages(
  tab: TabId,
  slot: string,
  images: IngestImage[] | undefined,
): Promise<BriefImage[] | undefined> {
  if (r2Configured()) {
    return uploadImagesToR2(tab, slot, images);
  }
  return uploadImagesToBlob(tab, slot, images);
}

export async function upsertBriefSlot(body: IngestBody): Promise<TabBriefs> {
  if (!isTabId(body.tab)) {
    throw new Error(`Invalid tab: ${body.tab}`);
  }
  if (!r2Configured() && !blobConfigured()) {
    throw new Error("No remote store configured (set R2_* or BLOB_READ_WRITE_TOKEN)");
  }
  const slotKey = safeKeyPart(body.slot || "", "");
  if (!slotKey) {
    throw new Error("Missing slot");
  }
  if (!body.generated_at?.trim() || !body.title?.trim()) {
    throw new Error("Missing generated_at or title");
  }

  const uploadedImages = await uploadImages(body.tab, slotKey, body.images);
  const sections = (body.sections || []).map((section) => ({
    ...section,
    html_or_text: sanitizeBriefHtml(section.html_or_text || ""),
  }));
  const now = new Date().toISOString();
  const slot: BriefSlot = {
    slot: slotKey,
    generated_at: body.generated_at,
    title: body.title.slice(0, 200),
    html: body.html ? sanitizeDocumentHtml(body.html) : body.html,
    sections: sections.length ? sections : undefined,
    images: uploadedImages,
    meta: body.meta ?? {},
    received_at: now,
  };
  const payload = JSON.stringify(slot, null, 2);

  if (r2Configured()) {
    // One object per slot — siblings are never rewritten.
    await r2PutObject(
      slotStorePath(body.tab, slotKey),
      payload,
      "application/json",
      "public, max-age=30",
    );

    // Best-effort history + GC.
    try {
      const ts = now.replace(/[:.]/g, "").replace(/\+00:00$/, "Z");
      await r2PutObject(
        historyStorePath(body.tab, slotKey, ts),
        payload,
        "application/json",
        "private, max-age=0",
      );
      const histKeys = (await r2ListKeys(historyPrefix(body.tab, slotKey)))
        .filter((k) => k.endsWith(".json"))
        .sort();
      if (histKeys.length > HISTORY_KEEP) {
        await r2DeleteKeys(histKeys.slice(0, histKeys.length - HISTORY_KEEP));
      }
    } catch (exc) {
      console.warn(`r2 history warning (${body.tab}/${slotKey}):`, exc);
    }

    // Lazy-migrate any remaining legacy slots so reads stay complete.
    try {
      const legacyText = await r2GetObjectText(legacyStorePath(body.tab));
      if (legacyText) {
        const legacy = JSON.parse(legacyText) as TabBriefs;
        for (const [key, raw] of Object.entries(legacy.slots || {})) {
          const sk = safeKeyPart(String(raw?.slot || key), key);
          if (!sk || sk === slotKey) continue;
          const dest = slotStorePath(body.tab, sk);
          const existing = await r2GetObjectText(dest);
          if (existing || !raw?.title || !raw?.generated_at) continue;
          await r2PutObject(
            dest,
            JSON.stringify({ ...raw, slot: sk }, null, 2),
            "application/json",
            "public, max-age=30",
          );
        }
      }
    } catch (exc) {
      console.warn(`r2 legacy migrate warning (${body.tab}):`, exc);
    }

    const assembled = await readTabFromR2(body.tab);
    if (assembled.error) {
      // Slot write succeeded; return at least this slot.
      return { tab: body.tab, updated_at: now, slots: { [slotKey]: slot } };
    }
    return assembled.tab;
  }

  // Legacy Blob: still monolithic (rarely used). Fail closed on read errors.
  const read = await readTabFromBlob(body.tab);
  if (read.error) {
    throw new Error(
      `Refusing upsert for ${body.tab}/${slotKey}: cannot read existing briefs (${read.error})`,
    );
  }
  const next: TabBriefs = {
    tab: body.tab,
    updated_at: now,
    slots: { ...read.tab.slots, [slotKey]: slot },
  };
  await put(legacyStorePath(body.tab), JSON.stringify(next, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  return next;
}
