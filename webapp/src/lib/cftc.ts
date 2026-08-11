/**
 * CFTC Commitments of Traders — Legacy Futures Only (non-commercial = 투기적).
 * Source: https://publicreporting.cftc.gov/resource/6dca-aqww.json
 * Weekly Friday release of Tuesday positions; we refresh snapshot daily 09:00 KST.
 */

import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

export const CFTC_R2_LATEST_KEY = "cftc/latest.json";
export const CFTC_SCHEDULE_NOTE =
  "매일 오전 9시(KST) 스냅샷 갱신 · CFTC는 화요일 포지션을 금요일에 공시(시차 있음)";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const CFTC_URL = "https://publicreporting.cftc.gov/resource/6dca-aqww.json";
const HISTORY_LIMIT = 160; // ~3y weekly

export type CftcMarketId =
  | "gold"
  | "silver"
  | "wti"
  | "brent"
  | "natgas"
  | "copper"
  | "platinum"
  | "corn"
  | "soybeans"
  | "wheat";

export type CftcMarketSpec = {
  id: CftcMarketId;
  label: string;
  group: "금속" | "에너지" | "농산물";
  /** Exact market_and_exchange_names in Legacy Futures Only */
  market_name: string;
  watch?: boolean;
};

/** Major liquid markets — exact CFTC names verified against SODA. */
export const CFTC_MARKET_SPECS: CftcMarketSpec[] = [
  {
    id: "gold",
    label: "금 (Gold)",
    group: "금속",
    market_name: "GOLD - COMMODITY EXCHANGE INC.",
    watch: true,
  },
  {
    id: "silver",
    label: "은 (Silver)",
    group: "금속",
    market_name: "SILVER - COMMODITY EXCHANGE INC.",
    watch: true,
  },
  {
    id: "copper",
    label: "구리 (Copper)",
    group: "금속",
    market_name: "COPPER- #1 - COMMODITY EXCHANGE INC.",
  },
  {
    id: "platinum",
    label: "백금 (Platinum)",
    group: "금속",
    market_name: "PLATINUM - NEW YORK MERCANTILE EXCHANGE",
  },
  {
    id: "wti",
    label: "원유 WTI",
    group: "에너지",
    market_name: "WTI-PHYSICAL - NEW YORK MERCANTILE EXCHANGE",
    watch: true,
  },
  {
    id: "brent",
    label: "원유 Brent",
    group: "에너지",
    market_name: "BRENT LAST DAY - NEW YORK MERCANTILE EXCHANGE",
    watch: true,
  },
  {
    id: "natgas",
    label: "천연가스",
    group: "에너지",
    market_name: "NATURAL GAS - NEW YORK MERCANTILE EXCHANGE",
  },
  {
    id: "corn",
    label: "옥수수",
    group: "농산물",
    market_name: "CORN - CHICAGO BOARD OF TRADE",
  },
  {
    id: "soybeans",
    label: "대두",
    group: "농산물",
    market_name: "SOYBEANS - CHICAGO BOARD OF TRADE",
  },
  {
    id: "wheat",
    label: "소맥 (SRW)",
    group: "농산물",
    market_name: "WHEAT-SRW - CHICAGO BOARD OF TRADE",
  },
];

export type CftcPoint = {
  date: string;
  long: number;
  short: number;
  /** Non-commercial net = long − short (투기적 순매수) */
  net_noncomm: number;
  open_interest: number;
  /** WoW change in net when previous week exists */
  net_chg: number | null;
};

export type CftcMarketSeries = {
  id: CftcMarketId;
  label: string;
  group: CftcMarketSpec["group"];
  market_name: string;
  watch: boolean;
  latest: CftcPoint | null;
  series: CftcPoint[];
};

export type CftcPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  as_of: string | null;
  source: string;
  schedule_note: string;
  note: string;
  from_cache: boolean;
  markets: CftcMarketSeries[];
  error?: string;
};

type CftcRow = {
  market_and_exchange_names?: string;
  report_date_as_yyyy_mm_dd?: string;
  noncomm_positions_long_all?: string | number;
  noncomm_positions_short_all?: string | number;
  open_interest_all?: string | number;
};

function kstNowParts(): { ymd: string; hour: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

function displayNow(): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

async function fetchMarketSeries(spec: CftcMarketSpec): Promise<CftcMarketSeries> {
  const url =
    `${CFTC_URL}?` +
    new URLSearchParams({
      $where: `market_and_exchange_names='${spec.market_name.replace(/'/g, "''")}'`,
      $order: "report_date_as_yyyy_mm_dd DESC",
      $limit: String(HISTORY_LIMIT),
    }).toString();

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    return {
      id: spec.id,
      label: spec.label,
      group: spec.group,
      market_name: spec.market_name,
      watch: !!spec.watch,
      latest: null,
      series: [],
    };
  }

  const rows = (await res.json()) as CftcRow[];
  const chronological: CftcPoint[] = [];
  for (const row of [...rows].reverse()) {
    const date = (row.report_date_as_yyyy_mm_dd || "").slice(0, 10);
    const long = Number(row.noncomm_positions_long_all);
    const short = Number(row.noncomm_positions_short_all);
    const oi = Number(row.open_interest_all);
    if (!date || !Number.isFinite(long) || !Number.isFinite(short)) continue;
    const net = long - short;
    const prev = chronological[chronological.length - 1];
    chronological.push({
      date,
      long,
      short,
      net_noncomm: net,
      open_interest: Number.isFinite(oi) ? oi : 0,
      net_chg: prev ? net - prev.net_noncomm : null,
    });
  }

  return {
    id: spec.id,
    label: spec.label,
    group: spec.group,
    market_name: spec.market_name,
    watch: !!spec.watch,
    latest: chronological.length ? chronological[chronological.length - 1]! : null,
    series: chronological,
  };
}

export async function buildCftcPayload(): Promise<CftcPayload> {
  const markets = await Promise.all(
    CFTC_MARKET_SPECS.map((spec) => fetchMarketSeries(spec)),
  );
  const withData = markets.filter((m) => m.series.length > 0);
  const as_of = withData
    .map((m) => m.latest?.date || "")
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  return {
    ok: withData.length > 0,
    generated_at: new Date().toISOString(),
    generated_at_display: displayNow(),
    as_of,
    source: `CFTC Legacy Futures Only · ${withData.length}/${markets.length} markets`,
    schedule_note: CFTC_SCHEDULE_NOTE,
    note:
      "투기적 순매수 = Non-Commercial Long − Short (Legacy Futures Only). " +
      "금·은·원유(WTI/Brent)·천연가스·구리·백금·옥수수·대두·소맥 포함.",
    from_cache: false,
    markets,
    error: withData.length ? undefined : "CFTC 응답 없음",
  };
}

export async function loadCachedCftc(): Promise<CftcPayload | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(CFTC_R2_LATEST_KEY);
    if (!text) return null;
    const data = JSON.parse(text) as CftcPayload;
    if (!data?.ok || !Array.isArray(data.markets)) return null;
    return { ...data, from_cache: true };
  } catch {
    return null;
  }
}

export async function persistCftcPayload(payload: CftcPayload): Promise<void> {
  if (!r2Configured() || !payload.ok) return;
  try {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    await r2PutObject(
      CFTC_R2_LATEST_KEY,
      body,
      "application/json; charset=utf-8",
      "public, max-age=300",
    );
    const day = payload.as_of || payload.generated_at.slice(0, 10);
    await r2PutObject(
      `cftc/snapshots/${day}.json`,
      body,
      "application/json; charset=utf-8",
      "public, max-age=86400",
    );
  } catch {
    /* ignore persist errors */
  }
}

/**
 * Serve cached snapshot if refreshed today (KST) after the 09:00 window,
 * otherwise rebuild + persist. `force` always rebuilds (cron / ?refresh=1).
 */
export async function getCftcPayload(opts?: {
  force?: boolean;
}): Promise<CftcPayload> {
  const force = !!opts?.force;
  const { ymd, hour } = kstNowParts();

  if (!force) {
    const cached = await loadCachedCftc();
    if (cached?.ok) {
      const genKst = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(cached.generated_at));
      // Before 09:00 KST keep last snapshot; after 09:00 require today's refresh.
      if (hour < 9 || genKst === ymd) return cached;
    }
  }

  const fresh = await buildCftcPayload();
  if (fresh.ok) await persistCftcPayload(fresh);
  else {
    const cached = await loadCachedCftc();
    if (cached?.ok) {
      return {
        ...cached,
        note: `${cached.note} · 라이브 갱신 실패 → 캐시`,
      };
    }
  }
  return fresh;
}
