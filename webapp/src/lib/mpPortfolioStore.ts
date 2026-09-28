/**
 * Shared MP portfolios (R2). Everyone reads the same copy; only the site admin writes.
 */

import { normalizeEtfPortfolio } from "@/lib/mpEtfPortfolio";
import { normalizeMpPortfolio } from "@/lib/mpPortfolio";
import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

export type MpPortfolioKind = "mp" | "etf";

const R2_KEYS: Record<MpPortfolioKind, string> = {
  mp: "mp/portfolio/mp_v1.json",
  etf: "mp/portfolio/etf_v1.json",
};

const MAX_BYTES = 256 * 1024;
const MAX_VERSIONS = 200;
const MAX_HOLDINGS = 200;

export function isMpPortfolioKind(v: unknown): v is MpPortfolioKind {
  return v === "mp" || v === "etf";
}

export function mpStoreConfigured(): boolean {
  return r2Configured();
}

function normalize(kind: MpPortfolioKind, raw: unknown) {
  return kind === "mp" ? normalizeMpPortfolio(raw) : normalizeEtfPortfolio(raw);
}

export async function loadSharedMpPortfolio(kind: MpPortfolioKind): Promise<unknown | null> {
  const text = await r2GetObjectText(R2_KEYS[kind]);
  if (!text) return null;
  try {
    return normalize(kind, JSON.parse(text));
  } catch {
    return null;
  }
}

export function validateMpPortfolio(kind: MpPortfolioKind, raw: unknown): { ok: true; value: object } | { ok: false; error: string } {
  const p = normalize(kind, raw);
  if (!p) return { ok: false, error: "편입 이력이 비어 있거나 형식이 올바르지 않습니다." };
  if (p.versions.length > MAX_VERSIONS) return { ok: false, error: `리밸런싱 이력은 최대 ${MAX_VERSIONS}개입니다.` };
  for (const v of p.versions) {
    if (!v || typeof v.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || !Array.isArray(v.holdings)) {
      return { ok: false, error: "편입일 또는 편입 목록 형식이 올바르지 않습니다." };
    }
    if (v.holdings.length > MAX_HOLDINGS) return { ok: false, error: `편입 종목은 버전당 최대 ${MAX_HOLDINGS}개입니다.` };
  }
  if (JSON.stringify(p).length > MAX_BYTES) return { ok: false, error: "포트폴리오 데이터가 너무 큽니다." };
  return { ok: true, value: p };
}

export async function saveSharedMpPortfolio(kind: MpPortfolioKind, value: object): Promise<void> {
  await r2PutObject(R2_KEYS[kind], JSON.stringify(value), "application/json; charset=utf-8", "no-store");
}
