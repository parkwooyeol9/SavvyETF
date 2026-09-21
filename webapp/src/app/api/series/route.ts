import { NextResponse } from "next/server";

import { cdnCacheHeader, withServerCache } from "@/lib/apiCache";
import {
  catalogSpec,
  keyBelongsToSpec,
  listSeriesIndex,
  loadSeriesObject,
  pickSeriesKey,
} from "@/lib/series";
import { r2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dataset = (url.searchParams.get("dataset") || "").trim();
  const spec = catalogSpec(dataset);
  if (!spec) {
    return NextResponse.json(
      { ok: false, error: "unknown dataset" },
      { status: 400 },
    );
  }

  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const date = url.searchParams.get("date") || undefined;
  const key = url.searchParams.get("key") || undefined;
  if (from && !YMD.test(from)) {
    return NextResponse.json({ ok: false, error: "invalid from" }, { status: 400 });
  }
  if (to && !YMD.test(to)) {
    return NextResponse.json({ ok: false, error: "invalid to" }, { status: 400 });
  }
  if (date && !YMD.test(date)) {
    return NextResponse.json({ ok: false, error: "invalid date" }, { status: 400 });
  }

  try {
    const index = await withServerCache(
      `series-index:v1:${spec.id}:${from || ""}:${to || ""}`,
      60_000,
      300_000,
      () => listSeriesIndex(spec, { from, to }),
    );

    if (!date && !key) {
      return NextResponse.json(index, {
        headers: { "Cache-Control": cdnCacheHeader("yahooSlow") },
      });
    }

    let picked = pickSeriesKey(index, { date, key });
    if (key && !picked) {
      if (!keyBelongsToSpec(key, spec)) {
        return NextResponse.json(
          { ok: false, error: "key is outside this dataset" },
          { status: 400 },
        );
      }
      picked = { key, size: 0 };
    }
    if (!picked) {
      return NextResponse.json(
        {
          ok: false,
          r2: r2Configured(),
          dataset: spec.id,
          date: date || null,
          key: key || "",
          size: 0,
          truncated: false,
          json: null,
          error: "no object for that date",
        },
        { status: 404 },
      );
    }

    const obj = await loadSeriesObject(spec, picked.key, date || ymdLoose(picked.key));
    return NextResponse.json(obj, {
      headers: { "Cache-Control": cdnCacheHeader("yahoo") },
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        r2: r2Configured(),
        dataset: spec.id,
        error: exc instanceof Error ? exc.message : "series failed",
      },
      { status: 500 },
    );
  }
}

function ymdLoose(key: string): string | null {
  const m = key.match(/(20\d{2}-\d{2}-\d{2})/);
  return m?.[1] ?? null;
}
