import { randomUUID } from "crypto";

import {
  getR2Config,
  r2Configured,
  r2DeleteKeys,
  r2GetObjectText,
  r2PutObject,
} from "@/lib/r2";
import { bearerToken, secretsEqual } from "@/lib/secretsEqual";

export const CARDNEWS_INDEX_KEY = "cardnews/index.json";
export const CARDNEWS_IMAGE_PREFIX = "cardnews/images/";

const MAX_ITEMS = 800;
const MAX_PER_DAY = 12;
const MAX_CAPTION = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type CardNewsItem = {
  id: string;
  date: string;
  order: number;
  caption: string;
  key: string;
  contentType: string;
  uploaded_at: string;
};

export type CardNewsStore = {
  updated_at: string;
  items: CardNewsItem[];
};

export type CardNewsDay = {
  date: string;
  items: CardNewsItem[];
};

export type PublicCardNewsItem = CardNewsItem & { url: string };

function emptyStore(): CardNewsStore {
  return { updated_at: new Date().toISOString(), items: [] };
}

export function cardNewsAdminSecret(): string {
  return (
    process.env.CARDNEWS_ADMIN_SECRET?.trim() ||
    process.env.COMMUNITY_ADMIN_SECRET?.trim() ||
    ""
  );
}

export function cardNewsAdminConfigured(): boolean {
  return cardNewsAdminSecret().length > 0;
}

export function cardNewsAuthorized(request: Request): boolean {
  const secret = cardNewsAdminSecret();
  if (!secret) return false;
  const token = bearerToken(request);
  return Boolean(token && secretsEqual(token, secret));
}

export function cardNewsSecretMatches(candidate: string): boolean {
  const secret = cardNewsAdminSecret();
  if (!secret || !candidate) return false;
  return secretsEqual(candidate, secret);
}

export function isCardNewsDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return "image/gif";
  }
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function extForType(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "jpg";
}

function parseStore(raw: string | null): CardNewsStore {
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as CardNewsStore;
    if (!parsed || !Array.isArray(parsed.items)) return emptyStore();
    return {
      updated_at: parsed.updated_at || new Date().toISOString(),
      items: parsed.items.filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          isCardNewsDate(item.date) &&
          typeof item.key === "string" &&
          item.key.startsWith(CARDNEWS_IMAGE_PREFIX),
      ),
    };
  } catch {
    return emptyStore();
  }
}

export async function loadCardNews(): Promise<CardNewsStore> {
  if (!r2Configured()) return emptyStore();
  return parseStore(await r2GetObjectText(CARDNEWS_INDEX_KEY));
}

async function saveCardNews(store: CardNewsStore): Promise<void> {
  store.updated_at = new Date().toISOString();
  store.items = store.items
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      if (a.order !== b.order) return a.order - b.order;
      return a.uploaded_at.localeCompare(b.uploaded_at);
    })
    .slice(0, MAX_ITEMS);
  await r2PutObject(
    CARDNEWS_INDEX_KEY,
    JSON.stringify(store),
    "application/json",
    "public, max-age=30",
  );
}

export function cardNewsImageUrl(item: CardNewsItem): string {
  const version = Date.parse(item.uploaded_at) || Date.now();
  const cfg = getR2Config();
  if (cfg?.publicBaseUrl) {
    return `${cfg.publicBaseUrl}/${item.key}?v=${encodeURIComponent(String(version))}`;
  }
  return `/api/cardnews/media/${item.key}?v=${encodeURIComponent(String(version))}`;
}

export function groupCardNewsDays(
  items: CardNewsItem[],
): Array<{ date: string; items: PublicCardNewsItem[] }> {
  const byDate = new Map<string, PublicCardNewsItem[]>();
  for (const item of items) {
    const row: PublicCardNewsItem = { ...item, url: cardNewsImageUrl(item) };
    const list = byDate.get(item.date) || [];
    list.push(row);
    byDate.set(item.date, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, dayItems]) => ({
      date,
      items: dayItems.slice().sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.uploaded_at.localeCompare(b.uploaded_at);
      }),
    }));
}

export async function addCardNewsImage(input: {
  date: string;
  caption?: string;
  bytes: Buffer;
}): Promise<CardNewsItem> {
  if (!r2Configured()) {
    throw new Error("저장소(R2)가 설정되지 않았습니다.");
  }
  const date = input.date.trim();
  if (!isCardNewsDate(date)) {
    throw new Error("날짜 형식이 올바르지 않습니다.");
  }
  const contentType = sniffImageType(input.bytes);
  if (!contentType) {
    throw new Error("JPEG, PNG, WebP, GIF만 올릴 수 있습니다.");
  }
  const caption = (input.caption || "").trim().slice(0, MAX_CAPTION);
  const store = await loadCardNews();
  const sameDay = store.items.filter((item) => item.date === date);
  if (sameDay.length >= MAX_PER_DAY) {
    throw new Error(`하루에 최대 ${MAX_PER_DAY}장까지 올릴 수 있습니다.`);
  }
  const id = randomUUID();
  const key = `${CARDNEWS_IMAGE_PREFIX}${date}/${id}.${extForType(contentType)}`;
  const order =
    sameDay.reduce((max, item) => Math.max(max, item.order), 0) + 1;
  await r2PutObject(key, input.bytes, contentType, "public, max-age=31536000");
  const item: CardNewsItem = {
    id,
    date,
    order,
    caption,
    key,
    contentType,
    uploaded_at: new Date().toISOString(),
  };
  store.items.unshift(item);
  await saveCardNews(store);
  return item;
}

export async function deleteCardNewsImage(id: string): Promise<void> {
  if (!r2Configured()) {
    throw new Error("저장소(R2)가 설정되지 않았습니다.");
  }
  const store = await loadCardNews();
  const item = store.items.find((row) => row.id === id);
  if (!item) throw new Error("카드를 찾을 수 없습니다.");
  store.items = store.items.filter((row) => row.id !== id);
  await saveCardNews(store);
  await r2DeleteKeys([item.key]);
}
