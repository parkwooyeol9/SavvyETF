import { after } from "next/server";

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

/**
 * Last good payload kept in R2 so a cold serverless instance answers from a file instead of
 * re-crawling the upstream on the visitor's click.
 *
 *   fresh  → serve the R2 copy
 *   stale  → serve the R2 copy now, rebuild after the response (next/server `after`)
 *   absent → build while the visitor waits (first ever request), then store
 *
 * Wrap the call in withServerCache so warm instances still answer from memory.
 */

type Stored<T> = { saved_at: string; data: T };

export type R2SnapshotResult<T> = {
  data: T;
  /** "r2" = served from the stored copy, "live" = built during this request. */
  origin: "r2" | "live";
  saved_at: string;
  stale: boolean;
};

const rebuilding = new Set<string>();

async function readStored<T>(key: string): Promise<Stored<T> | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(key);
    if (!text) return null;
    const parsed = JSON.parse(text) as Stored<T>;
    return parsed && typeof parsed.saved_at === "string" && parsed.data != null ? parsed : null;
  } catch (exc) {
    console.warn(`r2 snapshot read failed (${key}):`, exc);
    return null;
  }
}

async function store<T>(key: string, data: T): Promise<string> {
  const saved_at = new Date().toISOString();
  if (!r2Configured()) return saved_at;
  try {
    const body = JSON.stringify({ saved_at, data } satisfies Stored<T>);
    await r2PutObject(key, body, "application/json; charset=utf-8", "private, max-age=0");
  } catch (exc) {
    console.warn(`r2 snapshot write failed (${key}):`, exc);
  }
  return saved_at;
}

export async function withR2Snapshot<T>(opts: {
  key: string;
  /** Age (ms) after which the stored copy is rebuilt in the background. */
  freshMs: number;
  build: () => Promise<T>;
}): Promise<R2SnapshotResult<T>> {
  const { key, freshMs, build } = opts;
  const stored = await readStored<T>(key);
  if (stored) {
    const age = Date.now() - Date.parse(stored.saved_at);
    const stale = !(age >= 0 && age < freshMs);
    if (stale && !rebuilding.has(key)) {
      rebuilding.add(key);
      const rebuild = async () => {
        try {
          await store(key, await build());
        } catch (exc) {
          console.warn(`r2 snapshot rebuild failed (${key}):`, exc);
        } finally {
          rebuilding.delete(key);
        }
      };
      try {
        after(rebuild);
      } catch {
        // Outside a request scope (e.g. withServerCache's background refresh): best effort.
        void rebuild();
      }
    }
    return { data: stored.data, origin: "r2", saved_at: stored.saved_at, stale };
  }
  const data = await build();
  const saved_at = await store(key, data);
  return { data, origin: "live", saved_at, stale: false };
}
