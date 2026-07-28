import { del, head, list, put } from "@vercel/blob";

import { botBaseUrl, fetchBotJson } from "./bot";
import {
  gcSlotImageOrphans,
  publicUrlForKey,
  r2Configured,
  r2GetObjectText,
  r2GetObjectTextWithMeta,
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

function storePath(tab: TabId): string {
  return `briefs/${tab}.json`;
}

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
    const text = await r2GetObjectText(storePath(tab));
    if (!text) return { tab: emptyTab(tab) };
    const parsed = JSON.parse(text) as TabBriefs;
    if (!parsed || typeof parsed !== "object" || typeof parsed.slots !== "object") {
      // Object exists but is unusable — fail closed so upsert cannot wipe siblings.
      return {
        tab: emptyTab(tab),
        error: `r2: corrupt briefs/${tab}.json (missing slots object)`,
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
    return { tab: emptyTab(tab), error: `r2: ${message}` };
  }
}

async function readTabFromBlob(tab: TabId): Promise<TabReadResult> {
  if (!blobConfigured()) {
    return { tab: emptyTab(tab) };
  }
  try {
    const meta = await head(storePath(tab));
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

  // Upload images once; JSON merge retries must not re-upload.
  const uploadedImages = await uploadImages(body.tab, slotKey, body.images);
  const sections = (body.sections || []).map((section) => ({
    ...section,
    html_or_text: sanitizeBriefHtml(section.html_or_text || ""),
  }));

  const buildSlot = (now: string): BriefSlot => ({
    slot: slotKey,
    generated_at: body.generated_at,
    title: body.title.slice(0, 200),
    html: body.html ? sanitizeDocumentHtml(body.html) : body.html,
    sections: sections.length ? sections : undefined,
    images: uploadedImages,
    meta: body.meta ?? {},
    received_at: now,
  });

  if (!r2Configured()) {
    const read = await readTab(body.tab);
    if (read.error) {
      throw new Error(
        `Refusing upsert for ${body.tab}/${slotKey}: cannot read existing briefs (${read.error})`,
      );
    }
    const now = new Date().toISOString();
    const next: TabBriefs = {
      tab: body.tab,
      updated_at: now,
      slots: { ...read.tab.slots, [slotKey]: buildSlot(now) },
    };
    await put(storePath(body.tab), JSON.stringify(next, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return next;
  }

  const key = storePath(body.tab);
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let text: string | null;
    let etag: string | null;
    try {
      ({ text, etag } = await r2GetObjectTextWithMeta(key));
    } catch (exc) {
      throw new Error(
        `Refusing upsert for ${body.tab}/${slotKey}: cannot read existing briefs (${
          exc instanceof Error ? exc.message : String(exc)
        })`,
      );
    }

    let currentSlots: TabBriefs["slots"] = {};
    if (text) {
      let parsed: TabBriefs;
      try {
        parsed = JSON.parse(text) as TabBriefs;
      } catch (exc) {
        throw new Error(
          `Refusing upsert for ${body.tab}/${slotKey}: corrupt JSON (${
            exc instanceof Error ? exc.message : String(exc)
          })`,
        );
      }
      if (!parsed || typeof parsed !== "object" || typeof parsed.slots !== "object") {
        throw new Error(
          `Refusing upsert for ${body.tab}/${slotKey}: corrupt briefs (missing slots object)`,
        );
      }
      currentSlots = parsed.slots ?? {};
    }
    const priorKeys = new Set(Object.keys(currentSlots));
    const now = new Date().toISOString();
    const next: TabBriefs = {
      tab: body.tab,
      updated_at: now,
      slots: { ...currentSlots, [slotKey]: buildSlot(now) },
    };
    const payload = JSON.stringify(next, null, 2);

    try {
      if (etag) {
        await r2PutObject(key, payload, "application/json", "public, max-age=30", {
          ifMatch: etag,
        });
      } else {
        await r2PutObject(key, payload, "application/json", "public, max-age=30", {
          ifNoneMatch: "*",
        });
      }
    } catch (exc) {
      const msg = exc instanceof Error ? exc.message : String(exc);
      const name = exc instanceof Error ? exc.name : "";
      if (
        name === "PreconditionFailed" ||
        /PreconditionFailed|412|IfMatch|IfNoneMatch|ConditionalRequestConflict/i.test(
          msg,
        )
      ) {
        lastError = exc;
        continue;
      }
      if (/InvalidArgument|NotImplemented/i.test(msg)) {
        await r2PutObject(key, payload, "application/json", "public, max-age=30");
      } else {
        throw exc;
      }
    }

    const verify = await r2GetObjectTextWithMeta(key);
    if (!verify.text) {
      lastError = new Error("post-write verify missing object");
      continue;
    }
    try {
      const verified = JSON.parse(verify.text) as TabBriefs;
      const vslots = verified?.slots || {};
      if (!vslots[slotKey]) {
        lastError = new Error("post-write verify missing own slot");
        continue;
      }
      const lost = [...priorKeys].filter((k) => !(k in vslots));
      if (lost.length) {
        lastError = new Error(`post-write verify lost siblings ${lost.join(",")}`);
        continue;
      }
      return {
        tab: body.tab,
        updated_at: verified.updated_at ?? now,
        slots: vslots,
      };
    } catch (exc) {
      lastError = exc;
    }
  }

  throw new Error(
    `R2 upsert conflict for ${body.tab}/${slotKey} after retries${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }`,
  );
}
