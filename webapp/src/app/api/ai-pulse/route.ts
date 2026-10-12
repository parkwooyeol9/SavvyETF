import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { r2GetObjectText } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Written daily by Claude_DB/ai_pulse/4_코드/export_web.py --upload (r2_data.put_json_daily). */
const KEYS = {
  pulse: "ai_pulse/pulse/latest.json",
  economy: "ai_pulse/economy/latest.json",
} as const;

type Page = keyof typeof KEYS;

function isPage(v: string): v is Page {
  return Object.prototype.hasOwnProperty.call(KEYS, v);
}

/** Sibling SavvyDB checkout, used only when R2 is empty and this is a local dev server. */
function siblingDataDirs(): string[] {
  const roots = [process.cwd(), path.resolve(process.cwd(), "..")];
  const rels = [
    "../SavvyDB/ai_pulse/2_결과물/web/data",
    "../../SavvyDB/ai_pulse/2_결과물/web/data",
    "../SavvyDB/ai_pulse/savvyetf_export/sample_data",
    "../../SavvyDB/ai_pulse/savvyetf_export/sample_data",
  ];
  return roots.flatMap((root) => rels.map((rel) => path.resolve(root, rel)));
}

/** Dev only: read the exporter's local output so the tab works before R2 is wired. */
async function localFallback(page: Page): Promise<string | null> {
  if (process.env.NODE_ENV === "production") return null;
  const dirs = [process.env.AI_PULSE_LOCAL_DIR, ...siblingDataDirs()].filter(
    (dir): dir is string => Boolean(dir),
  );
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    try {
      return await readFile(path.join(dir, `${page}.json`), "utf-8");
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("page") ?? "pulse";
  if (!isPage(raw)) {
    return NextResponse.json({ ok: false, error: "unknown page" }, { status: 400 });
  }
  try {
    const text = (await r2GetObjectText(KEYS[raw])) ?? (await localFallback(raw));
    if (!text) {
      return NextResponse.json(
        { ok: false, error: "AI Pulse 데이터가 아직 올라오지 않았습니다." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    // Public data, refreshed once a day — let the CDN hold it.
    return new NextResponse(text, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
      },
    });
  } catch (exc) {
    return NextResponse.json(
      { ok: false, error: exc instanceof Error ? exc.message : "AI Pulse load failed" },
      { status: 500 },
    );
  }
}
