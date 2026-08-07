/**
 * KOSDAQ Active ETF (6 funds) comparison helpers.
 * Live PDF ranks via ETF CHECK; day-over-day via R2 snapshots when present.
 */

import { fetchKrPdfWeights } from "@/lib/etfCheck";
import {
  r2Configured,
  r2GetObjectText,
  r2ListKeys,
  r2PutObject,
} from "@/lib/r2";

export const KOSDAQ_ACTIVE_UNIVERSE = [
  {
    ticker: "0163Y0",
    name: "KoAct 코스닥액티브",
    brand: "KoAct",
    issuer: "삼성액티브자산운용",
  },
  {
    ticker: "0162Y0",
    name: "TIME 코스닥액티브",
    brand: "TIME",
    issuer: "타임폴리오자산운용",
  },
  {
    ticker: "0166N0",
    name: "PLUS 코스닥150액티브",
    brand: "PLUS",
    issuer: "한화자산운용",
  },
  {
    ticker: "0204S0",
    name: "TIGER 코스닥액티브",
    brand: "TIGER",
    issuer: "미래에셋자산운용",
  },
  {
    ticker: "0191B0",
    name: "MIDAS 코스닥액티브",
    brand: "MIDAS",
    issuer: "마이다스에셋자산운용",
  },
  {
    ticker: "0220B0",
    name: "DS 코스닥액티브",
    brand: "DS",
    issuer: "DS자산운용",
  },
] as const;

const R2_PREFIX = "kosdaq_active";

const THEME_TAGS: Array<{ theme: string; tokens: string[] }> = [
  {
    theme: "반도체 소부장",
    tokens: [
      "테스",
      "심텍",
      "피에스케이",
      "원익",
      "브이엠",
      "인텍플러스",
      "제주반도체",
      "주성엔지니어링",
      "티에스이",
      "리노공업",
      "티엘비",
      "성호전자",
      "이오테크닉스",
      "고영",
      "하나마이크론",
      "네패스",
      "파크시스템스",
      "유진테크",
      "케이씨텍",
      "HPSP",
    ],
  },
  {
    theme: "바이오·헬스",
    tokens: [
      "알테오젠",
      "파마리서치",
      "삼천당",
      "펩트론",
      "에이비엘",
      "올릭스",
      "보로노이",
      "리가켐",
      "휴젤",
      "씨어스",
      "에스티팜",
      "오스코텍",
    ],
  },
  {
    theme: "2차전지",
    tokens: ["에코프로", "엘앤에프", "포스코퓨처엠", "더블유씨피", "서진시스템"],
  },
  {
    theme: "로봇·AI하드웨어",
    tokens: ["로보티즈", "레인보우로보틱스"],
  },
];

export type Holding = {
  code: string;
  name: string;
  weight_pct: number | null;
  price?: number | null;
  change_pct?: number | null;
  theme?: string | null;
};

export type FlowItem = {
  code: string;
  name?: string | null;
  weight_pct?: number | null;
  before?: number;
  after?: number;
  delta?: number;
  theme?: string | null;
};

export type FundFlow = {
  has_previous: boolean;
  previous_as_of?: string | null;
  added: FlowItem[];
  removed: FlowItem[];
  increased: FlowItem[];
  decreased: FlowItem[];
  note?: string | null;
};

export type FundSnapshot = {
  ok: boolean;
  ticker: string;
  name: string;
  brand: string;
  issuer: string;
  as_of: string | null;
  aum_krw_eok?: number | null;
  source?: string;
  source_note?: string;
  generated_at?: string;
  count?: number;
  holdings: Holding[];
  top?: Holding[];
  flow?: FundFlow;
  error?: string;
};

export type MatrixRow = {
  code: string;
  name: string;
  theme?: string | null;
  weights: Record<string, number>;
  fund_count: number;
  avg_weight: number;
  max_weight: number;
  median_weight: number | null;
};

export type ManagerOverweight = {
  ticker: string;
  brand?: string;
  issuer?: string;
  fund_name?: string;
  code: string;
  name: string;
  theme?: string | null;
  weight_pct: number;
  peer_median: number;
  delta_vs_peers: number;
  fund_count: number;
  rationale: string;
};

export type KosdaqActivePayload = {
  ok: boolean;
  generated_at: string;
  as_of: string | null;
  as_of_list?: string[];
  schedule_note: string;
  disclaimer: string;
  source_note: string;
  universe_count: number;
  funds: FundSnapshot[];
  matrix: MatrixRow[];
  consensus: MatrixRow[];
  manager_overweights: ManagerOverweight[];
  insights: string[];
  errors?: Array<{ ticker: string; error: string }>;
  error?: string;
  source?: string;
};

function themeFor(name: string): string | null {
  for (const { theme, tokens } of THEME_TAGS) {
    if (tokens.some((t) => name.includes(t))) return theme;
  }
  return null;
}

function isCash(code: string, name: string, etfTicker: string): boolean {
  const n = name.trim();
  const c = code.trim().toUpperCase();
  if (n.includes("현금") || n === "예탁금" || n === "기타") return true;
  if (c === "CASH" || c === "KRW" || c === "KRD010010001") return true;
  if (c === etfTicker.toUpperCase() && (n.includes("현금") || !n)) return true;
  return false;
}

function median(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function parseAumEok(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return raw < 1_000_000 ? raw : raw / 1e8;
  const text = String(raw).replace(/,/g, "").replace(/억/g, "").trim();
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

async function fetchNaverMeta(ticker: string): Promise<{
  name?: string;
  issuer?: string;
  aum_krw_eok?: number | null;
}> {
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/stock/${ticker}/integration`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Referer: "https://m.stock.naver.com/",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return {};
    const data = (await res.json()) as {
      stockName?: string;
      etfKeyIndicator?: {
        issuerName?: string;
        marketValue?: unknown;
        totalNav?: unknown;
        marketValueRaw?: unknown;
      };
    };
    const ind = data.etfKeyIndicator || {};
    // Prefer 순자산(totalNav) for AUM; 시가총액(marketValue) is a fallback only.
    const aum =
      parseAumEok(ind.totalNav) ??
      (ind.marketValueRaw != null
        ? parseAumEok(
            typeof ind.marketValueRaw === "number"
              ? ind.marketValueRaw
              : Number(String(ind.marketValueRaw).replace(/,/g, "")),
          )
        : null) ??
      parseAumEok(ind.marketValue);
    return {
      name: data.stockName,
      issuer: ind.issuerName,
      aum_krw_eok: aum,
    };
  } catch {
    return {};
  }
}

export function compareHoldings(
  current: Holding[],
  previous: Holding[] | null | undefined,
  previousAsOf?: string | null,
): FundFlow {
  if (!previous?.length) {
    return {
      has_previous: false,
      previous_as_of: null,
      added: [],
      removed: [],
      increased: [],
      decreased: [],
      note: "직전 스냅샷이 없어 편출입 비교는 다음 갱신부터 표시됩니다.",
    };
  }
  const prevMap = new Map(previous.map((r) => [r.code, r]));
  const currMap = new Map(current.map((r) => [r.code, r]));
  const added: FlowItem[] = [];
  const removed: FlowItem[] = [];
  const increased: FlowItem[] = [];
  const decreased: FlowItem[] = [];

  for (const [code, row] of currMap) {
    if (!prevMap.has(code)) {
      added.push({
        code,
        name: row.name,
        weight_pct: row.weight_pct,
        theme: row.theme,
      });
    }
  }
  for (const [code, row] of prevMap) {
    if (!currMap.has(code)) {
      removed.push({
        code,
        name: row.name,
        weight_pct: row.weight_pct,
        theme: row.theme,
      });
    }
  }
  for (const [code, row] of currMap) {
    const before = prevMap.get(code)?.weight_pct;
    const after = row.weight_pct;
    if (before == null || after == null) continue;
    const delta = after - before;
    if (Math.abs(delta) < 0.05) continue;
    const item: FlowItem = {
      code,
      name: row.name,
      before,
      after,
      delta,
      theme: row.theme,
    };
    if (delta > 0) increased.push(item);
    else decreased.push(item);
  }
  increased.sort((a, b) => (b.delta || 0) - (a.delta || 0));
  decreased.sort((a, b) => (a.delta || 0) - (b.delta || 0));
  added.sort((a, b) => (b.weight_pct || 0) - (a.weight_pct || 0));
  removed.sort((a, b) => (b.weight_pct || 0) - (a.weight_pct || 0));
  return {
    has_previous: true,
    previous_as_of: previousAsOf || null,
    added,
    removed,
    increased,
    decreased,
    note: null,
  };
}

function buildMatrix(funds: FundSnapshot[]): MatrixRow[] {
  const map = new Map<string, MatrixRow>();
  for (const fund of funds) {
    for (const row of fund.holdings || []) {
      if (!row.code || row.weight_pct == null) continue;
      let entry = map.get(row.code);
      if (!entry) {
        entry = {
          code: row.code,
          name: row.name,
          theme: row.theme,
          weights: {},
          fund_count: 0,
          avg_weight: 0,
          max_weight: 0,
          median_weight: null,
        };
        map.set(row.code, entry);
      }
      entry.weights[fund.ticker] = row.weight_pct;
      if (!entry.theme && row.theme) entry.theme = row.theme;
      if (row.name) entry.name = row.name;
    }
  }
  const rows: MatrixRow[] = [];
  for (const entry of map.values()) {
    const vals = Object.values(entry.weights);
    if (!vals.length) continue;
    entry.fund_count = vals.length;
    entry.avg_weight = vals.reduce((a, b) => a + b, 0) / vals.length;
    entry.max_weight = Math.max(...vals);
    entry.median_weight = median(vals);
    rows.push(entry);
  }
  rows.sort(
    (a, b) =>
      b.fund_count - a.fund_count || b.avg_weight - a.avg_weight || a.code.localeCompare(b.code),
  );
  return rows;
}

function rationaleOverweight(
  brand: string,
  name: string,
  weight: number,
  peerMed: number,
  theme: string | null | undefined,
  fundCount: number,
): string {
  const themeBit = theme ? `${theme} 테마 내에서 ` : "";
    if (fundCount <= 1) {
    return `${brand}만 상위 랭킹에 ${name} ${weight.toFixed(2)}% 편입 — ${themeBit}운용사 고유 아이디어(피어 상위권 미편입).`;
  }
  if (peerMed <= 0.05) {
    return `${brand}이(가) ${name} ${weight.toFixed(2)}%로 가져가 피어 대비 뚜렷한 오버웨이트입니다.`;
  }
  return `${brand} ${name} ${weight.toFixed(2)}% vs 피어 중앙값 ${peerMed.toFixed(2)}% (+${(weight - peerMed).toFixed(2)}pp) — ${themeBit}상대적 비중확대.`;
}

function managerOverweights(
  funds: FundSnapshot[],
  matrix: MatrixRow[],
): ManagerOverweight[] {
  const byTicker = new Map(funds.map((f) => [f.ticker, f]));
  const out: ManagerOverweight[] = [];
  for (const row of matrix) {
    const weights = row.weights;
    for (const [ticker, w] of Object.entries(weights)) {
      const others = Object.entries(weights)
        .filter(([t]) => t !== ticker)
        .map(([, v]) => v);
      const base = others.length ? median(others) : 0;
      const delta = w - base;
      if (delta < 0.8) continue;
      const fund = byTicker.get(ticker);
      out.push({
        ticker,
        brand: fund?.brand,
        issuer: fund?.issuer,
        fund_name: fund?.name,
        code: row.code,
        name: row.name,
        theme: row.theme,
        weight_pct: w,
        peer_median: base,
        delta_vs_peers: delta,
        fund_count: row.fund_count,
        rationale: rationaleOverweight(
          fund?.brand || ticker,
          row.name,
          w,
          base,
          row.theme,
          row.fund_count,
        ),
      });
    }
  }
  out.sort((a, b) => b.delta_vs_peers - a.delta_vs_peers);
  return out.slice(0, 25);
}

function buildInsights(
  funds: FundSnapshot[],
  matrix: MatrixRow[],
  overweights: ManagerOverweight[],
): string[] {
  const lines: string[] = [];
  const consensus = matrix.filter((r) => r.fund_count >= 4).slice(0, 5);
  if (consensus.length) {
    lines.push(
      `다수 운용사 공통 상위 편입: ${consensus
        .map((r) => `${r.name}(${r.fund_count}/6)`)
        .join(", ")}`,
    );
  }
  const themeHits = new Map<string, number>();
  for (const r of matrix) {
    if (r.fund_count >= 3 && r.theme) {
      themeHits.set(r.theme, (themeHits.get(r.theme) || 0) + 1);
    }
  }
  if (themeHits.size) {
    const top = [...themeHits.entries()].sort((a, b) => b[1] - a[1])[0]!;
    lines.push(
      `공통 상위권 테마 집중: ${top[0]} (${top[1]}개 종목이 3개 이상 ETF 상위권)`,
    );
  }
  for (const ow of overweights.slice(0, 3)) lines.push(ow.rationale);

  const bumps: Array<{ brand: string; item: FlowItem; kind: "add" | "up" }> =
    [];
  for (const fund of funds) {
    const brand = fund.brand || fund.ticker;
    for (const item of (fund.flow?.increased || []).slice(0, 2)) {
      bumps.push({ brand, item, kind: "up" });
    }
    for (const item of (fund.flow?.added || []).slice(0, 1)) {
      bumps.push({ brand, item, kind: "add" });
    }
  }
  bumps.sort(
    (a, b) =>
      Math.abs(b.item.delta ?? b.item.weight_pct ?? 0) -
      Math.abs(a.item.delta ?? a.item.weight_pct ?? 0),
  );
  for (const { brand, item, kind } of bumps.slice(0, 4)) {
    if (kind === "add") {
      lines.push(
        `${brand} 신규 상위 편입: ${item.name} ${(item.weight_pct || 0).toFixed(2)}%`,
      );
    } else if (item.delta != null) {
      lines.push(
        `${brand} 비중확대: ${item.name} ${(item.before || 0).toFixed(2)}%→${(item.after || 0).toFixed(2)}% (${item.delta >= 0 ? "+" : ""}${item.delta.toFixed(2)}pp)`,
      );
    }
  }
  if (!lines.length) {
    lines.push(
      "해석 포인트가 충분하지 않습니다. 스냅샷이 쌓이면 편출입 비교가 풍부해집니다.",
    );
  }
  return lines.slice(0, 10);
}

async function loadPrevFromR2(
  ticker: string,
  asOf: string,
): Promise<{ snap: FundSnapshot; as_of: string } | null> {
  if (!r2Configured()) return null;
  try {
    const keys = (await r2ListKeys(`${R2_PREFIX}/${ticker}/snapshots/`))
      .filter((k) => k.endsWith(".json"))
      .map((k) => k.split("/").pop()?.replace(/\.json$/, "") || "")
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < asOf)
      .sort();
    if (!keys.length) return null;
    const day = keys[keys.length - 1]!;
    const text = await r2GetObjectText(
      `${R2_PREFIX}/${ticker}/snapshots/${day}.json`,
    );
    if (!text) return null;
    return { snap: JSON.parse(text) as FundSnapshot, as_of: day };
  } catch {
    return null;
  }
}

async function persistFundToR2(snap: FundSnapshot): Promise<void> {
  if (!r2Configured() || !snap.as_of) return;
  const body = Buffer.from(JSON.stringify(snap), "utf8");
  await r2PutObject(
    `${R2_PREFIX}/${snap.ticker}/snapshots/${snap.as_of}.json`,
    body,
    "application/json; charset=utf-8",
    "public, max-age=120",
  );
  await r2PutObject(
    `${R2_PREFIX}/${snap.ticker}/latest.json`,
    body,
    "application/json; charset=utf-8",
    "public, max-age=120",
  );
}

export async function fetchFundLive(
  meta: (typeof KOSDAQ_ACTIVE_UNIVERSE)[number],
): Promise<FundSnapshot> {
  const rows = await fetchKrPdfWeights(meta.ticker, 30);
  let asOf: string | null = null;
  const holdings: Holding[] = [];
  for (const row of rows) {
    if (isCash(row.code, row.name, meta.ticker)) continue;
    asOf = asOf || row.as_of;
    holdings.push({
      code: row.code,
      name: row.name,
      weight_pct: row.weight_pct,
      price: row.price,
      change_pct: row.change_pct,
      theme: themeFor(row.name),
    });
  }
  const naver = await fetchNaverMeta(meta.ticker);
  asOf =
    asOf ||
    new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

  const snap: FundSnapshot = {
    ok: true,
    ticker: meta.ticker,
    name: naver.name || meta.name,
    brand: meta.brand,
    issuer: naver.issuer || meta.issuer,
    as_of: asOf,
    aum_krw_eok: naver.aum_krw_eok ?? null,
    source: "etfcheck",
    source_note:
      "ETF CHECK 일별 PDF 상위 편입비중 (공개 랭킹 · 전 종목 CU 아님)",
    generated_at: new Date().toISOString(),
    count: holdings.length,
    holdings,
    top: holdings.slice(0, 10),
  };

  const prev = asOf ? await loadPrevFromR2(meta.ticker, asOf) : null;
  const usePrev =
    prev && prev.as_of && asOf && prev.as_of < asOf ? prev : null;
  snap.flow = compareHoldings(
    holdings,
    usePrev?.snap.holdings,
    usePrev?.as_of,
  );

  try {
    await persistFundToR2(snap);
  } catch {
    /* non-fatal */
  }

  return snap;
}

export function buildComparePayload(
  funds: FundSnapshot[],
  extra?: Partial<KosdaqActivePayload>,
): KosdaqActivePayload {
  const matrix = buildMatrix(funds);
  const overweights = managerOverweights(funds, matrix);
  const insights = buildInsights(funds, matrix, overweights);
  const asOfList = [
    ...new Set(funds.map((f) => f.as_of).filter(Boolean) as string[]),
  ].sort();
  return {
    ok: funds.some((f) => (f.holdings || []).length > 0),
    generated_at: new Date().toISOString(),
    as_of: asOfList[asOfList.length - 1] || null,
    as_of_list: asOfList,
    schedule_note:
      "매일 15:50 KST 장마감 후 스냅샷 · 웹은 장중에도 ETF CHECK 최신 공개 랭킹을 불러옵니다",
    disclaimer:
      "운용사 공식 코멘트가 아닌 PDF 상위 랭킹·피어 대비 휴리스틱 해석입니다. 투자 권유가 아닙니다.",
    source_note:
      "ETF CHECK 일별 PDF 상위 편입비중(보통 Top10 내외, 현금 제외) · Naver 메타(AUM/운용사)",
    universe_count: funds.length,
    funds,
    matrix: matrix.slice(0, 60),
    consensus: matrix.filter((r) => r.fund_count >= 3).slice(0, 25),
    manager_overweights: overweights,
    insights,
    ...extra,
  };
}

export async function collectKosdaqActiveLive(): Promise<KosdaqActivePayload> {
  const errors: Array<{ ticker: string; error: string }> = [];
  const funds: FundSnapshot[] = [];
  for (const meta of KOSDAQ_ACTIVE_UNIVERSE) {
    try {
      funds.push(await fetchFundLive(meta));
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : String(exc);
      errors.push({ ticker: meta.ticker, error: message });
      funds.push({
        ok: false,
        ticker: meta.ticker,
        name: meta.name,
        brand: meta.brand,
        issuer: meta.issuer,
        as_of: null,
        holdings: [],
        flow: {
          has_previous: false,
          added: [],
          removed: [],
          increased: [],
          decreased: [],
          note: message,
        },
        error: message,
      });
    }
  }
  const payload = buildComparePayload(funds, { errors, source: "live" });
  if (r2Configured()) {
    try {
      await r2PutObject(
        `${R2_PREFIX}/compare/latest.json`,
        Buffer.from(JSON.stringify(payload), "utf8"),
        "application/json; charset=utf-8",
        "public, max-age=120",
      );
    } catch {
      /* ignore */
    }
  }
  return payload;
}

export async function loadCompareFromR2(): Promise<KosdaqActivePayload | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(`${R2_PREFIX}/compare/latest.json`);
    if (!text) return null;
    const parsed = JSON.parse(text) as KosdaqActivePayload;
    return { ...parsed, source: parsed.source || "r2" };
  } catch {
    return null;
  }
}
