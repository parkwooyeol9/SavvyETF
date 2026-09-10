import { randomUUID } from "crypto";

import {
  r2Configured,
  r2DeleteKeys,
  r2GetObjectText,
  r2PutObject,
} from "@/lib/r2";
import {
  isResearchCategory,
  isResearchDate,
  researchCategoryList,
  type ResearchCategory,
} from "@/lib/researchMeta";
import { bearerToken, secretsEqual } from "@/lib/secretsEqual";

export {
  DEFAULT_RESEARCH_YEAR,
  RESEARCH_CATEGORIES,
  RESEARCH_CATEGORY_LABELS,
  RESEARCH_CATEGORY_OPTIONS,
  RESEARCH_YEAR_OPTIONS,
  composeResearchDate,
  formatResearchDate,
  isResearchCategory,
  isResearchDate,
  researchYear,
  type ResearchCategory,
} from "@/lib/researchMeta";

export const RESEARCH_INDEX_KEY = "research/index.json";
export const RESEARCH_FILE_PREFIX = "research/files/";

const MAX_ITEMS = 2000;
const MAX_TITLE = 200;
const MAX_SUMMARY = 2000;
const MAX_FILENAME = 180;

export type ResearchPaper = {
  id: string;
  title: string;
  category: ResearchCategory;
  published_at: string;
  summary: string;
  filename: string;
  key: string;
  contentType: string;
  size: number;
  uploaded_at: string;
};

export type ResearchStore = {
  updated_at: string;
  items: ResearchPaper[];
};

export type PublicResearchPaper = ResearchPaper & { url: string };

function emptyStore(): ResearchStore {
  return { updated_at: new Date().toISOString(), items: [] };
}

export function researchAdminSecret(): string {
  return (
    process.env.RESEARCH_ADMIN_SECRET?.trim() ||
    process.env.CARDNEWS_ADMIN_SECRET?.trim() ||
    process.env.COMMUNITY_ADMIN_SECRET?.trim() ||
    ""
  );
}

export function researchAdminConfigured(): boolean {
  return researchAdminSecret().length > 0;
}

export function researchAuthorized(request: Request): boolean {
  const secret = researchAdminSecret();
  if (!secret) return false;
  const token = bearerToken(request);
  return Boolean(token && secretsEqual(token, secret));
}

export function researchSecretMatches(candidate: string): boolean {
  const secret = researchAdminSecret();
  if (!secret || !candidate) return false;
  return secretsEqual(candidate, secret);
}

export function sniffPdf(buf: Buffer): boolean {
  if (buf.length < 5) return false;
  return buf.subarray(0, 4).toString("ascii") === "%PDF";
}

export function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() || "paper.pdf";
  const cleaned = base
    .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FILENAME);
  const withExt = /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned || "paper"}.pdf`;
  return withExt || "paper.pdf";
}

function parseStore(raw: string | null): ResearchStore {
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as ResearchStore;
    if (!parsed || !Array.isArray(parsed.items)) return emptyStore();
    return {
      updated_at: parsed.updated_at || new Date().toISOString(),
      items: parsed.items.filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          isResearchCategory(item.category) &&
          isResearchDate(item.published_at) &&
          typeof item.key === "string" &&
          item.key.startsWith(RESEARCH_FILE_PREFIX),
      ),
    };
  } catch {
    return emptyStore();
  }
}

function sortPapers(items: ResearchPaper[]): ResearchPaper[] {
  return items.slice().sort((a, b) => {
    if (a.published_at !== b.published_at) {
      return b.published_at.localeCompare(a.published_at);
    }
    return b.uploaded_at.localeCompare(a.uploaded_at);
  });
}

export async function loadResearch(): Promise<ResearchStore> {
  if (!r2Configured()) return emptyStore();
  return parseStore(await r2GetObjectText(RESEARCH_INDEX_KEY));
}

async function saveResearch(store: ResearchStore): Promise<void> {
  store.updated_at = new Date().toISOString();
  store.items = sortPapers(store.items).slice(0, MAX_ITEMS);
  await r2PutObject(
    RESEARCH_INDEX_KEY,
    JSON.stringify(store),
    "application/json",
    "public, max-age=30",
  );
}

export function researchPaperUrl(item: ResearchPaper): string {
  const version = Date.parse(item.uploaded_at) || Date.now();
  return `/api/research/media/${item.key}?v=${encodeURIComponent(String(version))}`;
}

export function publicResearchPapers(items: ResearchPaper[]): PublicResearchPaper[] {
  return sortPapers(items).map((item) => ({
    ...item,
    url: researchPaperUrl(item),
  }));
}

export async function addResearchPaper(input: {
  title: string;
  category: string;
  published_at: string;
  summary?: string;
  filename?: string;
  bytes: Buffer;
}): Promise<ResearchPaper> {
  if (!r2Configured()) {
    throw new Error("저장소(R2)가 설정되지 않았습니다.");
  }
  const title = input.title.trim().slice(0, MAX_TITLE);
  if (!title) {
    throw new Error("제목을 입력해 주세요.");
  }
  if (!isResearchCategory(input.category)) {
    throw new Error(`유형은 ${researchCategoryList()} 중 하나여야 합니다.`);
  }
  const publishedAt = input.published_at.trim();
  if (!isResearchDate(publishedAt)) {
    throw new Error("발간 일자가 올바르지 않습니다.");
  }
  if (!sniffPdf(input.bytes)) {
    throw new Error("PDF 파일만 올릴 수 있습니다.");
  }
  const summary = (input.summary || "").trim().slice(0, MAX_SUMMARY);
  const filename = sanitizeFilename(input.filename || `${title}.pdf`);
  const id = randomUUID();
  const key = `${RESEARCH_FILE_PREFIX}${publishedAt}/${id}.pdf`;
  await r2PutObject(key, input.bytes, "application/pdf", "public, max-age=31536000");
  const item: ResearchPaper = {
    id,
    title,
    category: input.category,
    published_at: publishedAt,
    summary,
    filename,
    key,
    contentType: "application/pdf",
    size: input.bytes.length,
    uploaded_at: new Date().toISOString(),
  };
  const store = await loadResearch();
  store.items.unshift(item);
  await saveResearch(store);
  return item;
}

export async function deleteResearchPaper(id: string): Promise<void> {
  if (!r2Configured()) {
    throw new Error("저장소(R2)가 설정되지 않았습니다.");
  }
  const store = await loadResearch();
  const item = store.items.find((row) => row.id === id);
  if (!item) throw new Error("리서치를 찾을 수 없습니다.");
  store.items = store.items.filter((row) => row.id !== id);
  await saveResearch(store);
  await r2DeleteKeys([item.key]);
}
