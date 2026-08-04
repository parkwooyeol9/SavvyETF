/**
 * KOSDAQ 100 monitor — universe quotes, mcap-proxy weights, quality fundamentals.
 */

import universeJson from "@/data/kosdaq100Universe.json";
import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const R2_KEY = "kosdaq100/latest.json";
const R2_FUND_KEY = "kosdaq100/fundamentals/latest.json";

export type Kosdaq100Constituent = {
  code: string;
  name: string;
  market?: string;
  yahoo?: string;
};

export type Kosdaq100Fundamentals = {
  code: string;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  roe: number | null;
  op_margin: number | null;
  net_margin: number | null;
  debt_ratio: number | null;
  revenue: number | null;
  revenue_prev: number | null;
  revenue_growth: number | null;
  op_income: number | null;
  dividend_yield: number | null;
  fiscal_label: string | null;
  theme: string | null;
  quality_score: number | null;
  quality_label: string | null;
  quality_drivers: string[];
};

export type Kosdaq100Row = Kosdaq100Fundamentals & {
  name: string;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  market_cap: number | null;
  weight_pct: number | null;
  volume: number | null;
  value: number | null;
  market_status?: string | null;
};

export type Kosdaq100Payload = {
  ok: boolean;
  generated_at: string;
  as_of: string | null;
  universe_as_of: string | null;
  universe_count: number;
  universe_source: string;
  weight_note: string;
  disclaimer: string;
  summary: {
    total_mcap: number | null;
    advancers: number;
    decliners: number;
    unchanged: number;
    high_quality: number;
    median_per: number | null;
    median_roe: number | null;
    top_weight: Array<{ code: string; name: string; weight_pct: number }>;
  };
  rows: Kosdaq100Row[];
  error?: string;
  source?: string;
};

type FundCache = {
  generated_at: string;
  by_code: Record<string, Kosdaq100Fundamentals>;
};

const THEME_TAGS: Array<{ theme: string; tokens: string[] }> = [
  {
    theme: "반도체 소부장",
    tokens: [
      "테스",
      "심텍",
      "피에스케이",
      "원익",
      "인텍플러스",
      "제주반도체",
      "주성",
      "티씨케이",
      "리노공업",
      "이오테크닉스",
      "고영",
      "하나마이크론",
      "파크시스템스",
      "유진테크",
      "HPSP",
      "코미코",
      "동진쎄미켐",
      "ISC",
      "테크윙",
      "와이씨",
      "에스앤에스텍",
      "두산테스나",
      "필옵틱스",
      "솔브레인",
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
      "HLB",
      "셀트리온제약",
      "케어젠",
      "메지온",
      "루닛",
      "클래시스",
      "차바이오텍",
      "씨젠",
      "HK이노엔",
      "디앤디파마텍",
      "인벤티지랩",
      "지아이이노베이션",
      "오름테라퓨틱",
      "프로티나",
      "지투지바이오",
      "큐리옥스",
      "에이프릴바이오",
      "엘앤씨바이오",
      "젬백스",
      "큐리언트",
      "앱클론",
    ],
  },
  {
    theme: "2차전지",
    tokens: [
      "에코프로",
      "대주전자재료",
      "서진시스템",
      "엔켐",
      "레이크머티리얼즈",
      "하나머티리얼즈",
      "피엔티",
    ],
  },
  {
    theme: "로봇·AI",
    tokens: ["로보티즈", "레인보우로보틱스", "유일로보틱스", "클로봇", "휴림로봇"],
  },
  {
    theme: "엔터·콘텐츠",
    tokens: ["JYP", "에스엠", "와이지", "스튜디오드래곤", "펄어비스", "카카오게임즈", "CJ ENM"],
  },
];

function themeFor(name: string): string | null {
  for (const { theme, tokens } of THEME_TAGS) {
    if (tokens.some((t) => name.includes(t))) return theme;
  }
  return null;
}

function num(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === "-") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const text = String(raw).replace(/,/g, "").replace(/%/g, "").replace(/배/g, "").replace(/원/g, "").trim();
  if (!text || text === "-") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function parseAnnualValue(
  rowList: Array<Record<string, unknown>>,
  title: string,
  key: string,
): number | null {
  const row = rowList.find((r) => String(r.title || "") === title);
  if (!row) return null;
  const columns = (row.columns || {}) as Record<string, { value?: unknown }>;
  const cell = columns[key];
  if (cell && typeof cell === "object") return num(cell.value);
  return null;
}

function latestActualKey(
  titles: Array<{ key?: string; isConsensus?: string; title?: string }>,
): { key: string; label: string } | null {
  const actuals = titles.filter((t) => t.isConsensus !== "Y" && t.key);
  if (!actuals.length) return null;
  const last = actuals[actuals.length - 1]!;
  return { key: String(last.key), label: String(last.title || last.key) };
}

function prevActualKey(
  titles: Array<{ key?: string; isConsensus?: string; title?: string }>,
): string | null {
  const actuals = titles.filter((t) => t.isConsensus !== "Y" && t.key);
  if (actuals.length < 2) return null;
  return String(actuals[actuals.length - 2]!.key);
}

export function qualityScore(input: {
  roe: number | null;
  op_margin: number | null;
  revenue_growth: number | null;
  debt_ratio: number | null;
  per: number | null;
  pbr: number | null;
  eps: number | null;
}): { score: number; label: string; drivers: string[] } {
  let score = 45;
  const drivers: string[] = [];

  if (input.roe != null) {
    if (input.roe >= 20) {
      score += 18;
      drivers.push(`ROE ${input.roe.toFixed(1)}% 우수`);
    } else if (input.roe >= 12) {
      score += 12;
      drivers.push(`ROE ${input.roe.toFixed(1)}% 양호`);
    } else if (input.roe >= 5) {
      score += 5;
    } else if (input.roe < 0) {
      score -= 12;
      drivers.push("ROE 적자");
    }
  }

  if (input.op_margin != null) {
    if (input.op_margin >= 20) {
      score += 12;
      drivers.push(`영업이익률 ${input.op_margin.toFixed(1)}%`);
    } else if (input.op_margin >= 10) {
      score += 8;
    } else if (input.op_margin < 0) {
      score -= 10;
      drivers.push("영업적자");
    }
  }

  if (input.revenue_growth != null) {
    if (input.revenue_growth >= 25) {
      score += 12;
      drivers.push(`매출성장 ${input.revenue_growth.toFixed(0)}%`);
    } else if (input.revenue_growth >= 8) {
      score += 7;
    } else if (input.revenue_growth < -10) {
      score -= 8;
      drivers.push("매출 역성장");
    }
  }

  if (input.debt_ratio != null) {
    if (input.debt_ratio <= 50) score += 6;
    else if (input.debt_ratio <= 100) score += 3;
    else if (input.debt_ratio >= 200) {
      score -= 8;
      drivers.push(`부채비율 ${input.debt_ratio.toFixed(0)}%`);
    }
  }

  if (input.eps != null && input.eps < 0) {
    score -= 8;
  }

  if (input.per != null && input.per > 0) {
    if (input.per <= 15) {
      score += 6;
      drivers.push("PER 상대 저평가");
    } else if (input.per >= 80) {
      score -= 4;
    }
  }

  if (input.pbr != null && input.pbr > 0 && input.pbr <= 1.2) {
    score += 4;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label =
    score >= 75 ? "우량" : score >= 60 ? "양호" : score >= 45 ? "보통" : "주의";
  return { score, label, drivers: drivers.slice(0, 3) };
}

export function loadUniverse(): {
  as_of: string | null;
  source: string;
  count: number;
  constituents: Kosdaq100Constituent[];
} {
  const raw = universeJson as {
    as_of?: string;
    source?: string;
    count?: number;
    constituents?: Kosdaq100Constituent[];
  };
  const constituents = (raw.constituents || []).filter((c) => c.code && c.name);
  return {
    as_of: raw.as_of || null,
    source: raw.source || "kosdaq100 universe",
    count: constituents.length,
    constituents,
  };
}

async function fetchQuotes(
  codes: string[],
): Promise<
  Map<
    string,
    {
      name: string;
      price: number | null;
      change: number | null;
      change_pct: number | null;
      market_cap: number | null;
      volume: number | null;
      value: number | null;
      market_status: string | null;
    }
  >
> {
  const out = new Map();
  for (let i = 0; i < codes.length; i += 40) {
    const chunk = codes.slice(i, i + 40);
    const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${chunk.join(",")}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://finance.naver.com/" },
      cache: "no-store",
    });
    if (!res.ok) continue;
    const payload = (await res.json()) as { datas?: Array<Record<string, unknown>> };
    for (const row of payload.datas || []) {
      const code = String(row.itemCode || "");
      if (!code) continue;
      out.set(code, {
        name: String(row.stockName || code),
        price: num(row.closePriceRaw),
        change: num(row.compareToPreviousClosePriceRaw),
        change_pct: num(row.fluctuationsRatioRaw),
        market_cap: num(row.marketValueFullRaw),
        volume: num(row.accumulatedTradingVolumeRaw),
        value: num(row.accumulatedTradingValueRaw),
        market_status: String(row.marketStatus || "") || null,
      });
    }
  }
  return out;
}

async function fetchAnnualFundamentals(
  code: string,
  name: string,
): Promise<Kosdaq100Fundamentals> {
  const empty: Kosdaq100Fundamentals = {
    code,
    per: null,
    pbr: null,
    eps: null,
    bps: null,
    roe: null,
    op_margin: null,
    net_margin: null,
    debt_ratio: null,
    revenue: null,
    revenue_prev: null,
    revenue_growth: null,
    op_income: null,
    dividend_yield: null,
    fiscal_label: null,
    theme: themeFor(name),
    quality_score: null,
    quality_label: null,
    quality_drivers: [],
  };

  try {
    const [annRes, intRes] = await Promise.all([
      fetch(`https://m.stock.naver.com/api/stock/${code}/finance/annual`, {
        headers: { "User-Agent": UA, Referer: "https://m.stock.naver.com/" },
        cache: "no-store",
      }),
      fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, {
        headers: { "User-Agent": UA, Referer: "https://m.stock.naver.com/" },
        cache: "no-store",
      }),
    ]);

    let per: number | null = null;
    let pbr: number | null = null;
    let eps: number | null = null;
    let bps: number | null = null;
    let dividend_yield: number | null = null;

    if (intRes.ok) {
      const inte = (await intRes.json()) as {
        totalInfos?: Array<{ code?: string; key?: string; value?: string }>;
      };
      const map = new Map(
        (inte.totalInfos || []).map((t) => [String(t.code || ""), t.value]),
      );
      per = num(map.get("per"));
      pbr = num(map.get("pbr"));
      eps = num(map.get("eps"));
      bps = num(map.get("bps"));
      dividend_yield = num(map.get("dividendYieldRatio"));
    }

    let roe: number | null = null;
    let op_margin: number | null = null;
    let net_margin: number | null = null;
    let debt_ratio: number | null = null;
    let revenue: number | null = null;
    let revenue_prev: number | null = null;
    let revenue_growth: number | null = null;
    let op_income: number | null = null;
    let fiscal_label: string | null = null;

    if (annRes.ok) {
      const ann = (await annRes.json()) as {
        financeInfo?: {
          trTitleList?: Array<{ key?: string; isConsensus?: string; title?: string }>;
          rowList?: Array<Record<string, unknown>>;
        };
      };
      const titles = ann.financeInfo?.trTitleList || [];
      const rows = ann.financeInfo?.rowList || [];
      const latest = latestActualKey(titles);
      const prevKey = prevActualKey(titles);
      if (latest) {
        fiscal_label = latest.label;
        const k = latest.key;
        revenue = parseAnnualValue(rows, "매출액", k);
        op_income = parseAnnualValue(rows, "영업이익", k);
        roe = parseAnnualValue(rows, "ROE", k);
        op_margin = parseAnnualValue(rows, "영업이익률", k);
        net_margin = parseAnnualValue(rows, "순이익률", k);
        debt_ratio = parseAnnualValue(rows, "부채비율", k);
        // Prefer trailing valuation from integration; fall back to annual
        if (per == null) per = parseAnnualValue(rows, "PER", k);
        if (pbr == null) pbr = parseAnnualValue(rows, "PBR", k);
        if (eps == null) eps = parseAnnualValue(rows, "EPS", k);
        if (bps == null) bps = parseAnnualValue(rows, "BPS", k);
        if (prevKey) {
          revenue_prev = parseAnnualValue(rows, "매출액", prevKey);
          if (revenue != null && revenue_prev != null && revenue_prev !== 0) {
            revenue_growth = ((revenue - revenue_prev) / Math.abs(revenue_prev)) * 100;
          }
        }
      }
    }

    const q = qualityScore({
      roe,
      op_margin,
      revenue_growth,
      debt_ratio,
      per,
      pbr,
      eps,
    });

    return {
      code,
      per,
      pbr,
      eps,
      bps,
      roe,
      op_margin,
      net_margin,
      debt_ratio,
      revenue,
      revenue_prev,
      revenue_growth,
      op_income,
      dividend_yield,
      fiscal_label,
      theme: themeFor(name),
      quality_score: q.score,
      quality_label: q.label,
      quality_drivers: q.drivers,
    };
  } catch {
    return empty;
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function loadFundCache(): Promise<FundCache | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(R2_FUND_KEY);
    if (!text) return null;
    return JSON.parse(text) as FundCache;
  } catch {
    return null;
  }
}

async function saveFundCache(cache: FundCache): Promise<void> {
  if (!r2Configured()) return;
  try {
    await r2PutObject(
      R2_FUND_KEY,
      Buffer.from(JSON.stringify(cache), "utf8"),
      "application/json; charset=utf-8",
      "public, max-age=300",
    );
  } catch {
    /* ignore */
  }
}

function fundCacheFresh(cache: FundCache | null, maxAgeMs: number): boolean {
  if (!cache?.generated_at) return false;
  const t = Date.parse(cache.generated_at);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < maxAgeMs;
}

export async function buildKosdaq100Payload(
  options?: { refreshFundamentals?: boolean },
): Promise<Kosdaq100Payload> {
  const universe = loadUniverse();
  const codes = universe.constituents.map((c) => c.code);
  const nameByCode = new Map(universe.constituents.map((c) => [c.code, c.name]));

  const quotes = await fetchQuotes(codes);

  let fundCache = await loadFundCache();
  const needRefresh =
    options?.refreshFundamentals ||
    !fundCacheFresh(fundCache, 12 * 60 * 60 * 1000) ||
    codes.some((c) => !fundCache?.by_code?.[c]);

  if (needRefresh) {
    const funds = await mapPool(universe.constituents, 12, (c) =>
      fetchAnnualFundamentals(c.code, c.name),
    );
    const by_code: Record<string, Kosdaq100Fundamentals> = {};
    for (const f of funds) by_code[f.code] = f;
    fundCache = { generated_at: new Date().toISOString(), by_code };
    await saveFundCache(fundCache);
  }

  const totalMcap = [...quotes.values()].reduce(
    (s, q) => s + (q.market_cap || 0),
    0,
  );

  const rows: Kosdaq100Row[] = universe.constituents.map((c) => {
    const q = quotes.get(c.code);
    const f = fundCache?.by_code?.[c.code];
    const market_cap = q?.market_cap ?? null;
    const weight_pct =
      market_cap != null && totalMcap > 0 ? (market_cap / totalMcap) * 100 : null;
    return {
      code: c.code,
      name: q?.name || nameByCode.get(c.code) || c.name,
      price: q?.price ?? null,
      change: q?.change ?? null,
      change_pct: q?.change_pct ?? null,
      market_cap,
      weight_pct,
      volume: q?.volume ?? null,
      value: q?.value ?? null,
      market_status: q?.market_status ?? null,
      per: f?.per ?? null,
      pbr: f?.pbr ?? null,
      eps: f?.eps ?? null,
      bps: f?.bps ?? null,
      roe: f?.roe ?? null,
      op_margin: f?.op_margin ?? null,
      net_margin: f?.net_margin ?? null,
      debt_ratio: f?.debt_ratio ?? null,
      revenue: f?.revenue ?? null,
      revenue_prev: f?.revenue_prev ?? null,
      revenue_growth: f?.revenue_growth ?? null,
      op_income: f?.op_income ?? null,
      dividend_yield: f?.dividend_yield ?? null,
      fiscal_label: f?.fiscal_label ?? null,
      theme: f?.theme ?? themeFor(c.name),
      quality_score: f?.quality_score ?? null,
      quality_label: f?.quality_label ?? null,
      quality_drivers: f?.quality_drivers ?? [],
    };
  });

  rows.sort(
    (a, b) => (b.weight_pct || 0) - (a.weight_pct || 0) || a.code.localeCompare(b.code),
  );

  let advancers = 0;
  let decliners = 0;
  let unchanged = 0;
  for (const r of rows) {
    if (r.change_pct == null) continue;
    if (r.change_pct > 0) advancers += 1;
    else if (r.change_pct < 0) decliners += 1;
    else unchanged += 1;
  }

  const todayKst = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Seoul",
  });

  const payload: Kosdaq100Payload = {
    ok: rows.some((r) => r.price != null),
    generated_at: new Date().toISOString(),
    as_of: todayKst,
    universe_as_of: universe.as_of,
    universe_count: rows.length,
    universe_source: universe.source,
    weight_note:
      "편입비는 코스닥100 유니버스 내 시가총액 비중 근사치입니다(공식 유동주식수 가중과 다를 수 있음).",
    disclaimer:
      "우량 점수는 ROE·영업이익률·매출성장·부채비율·밸류에이션 휴리스틱입니다. 투자 권유가 아닙니다.",
    summary: {
      total_mcap: totalMcap || null,
      advancers,
      decliners,
      unchanged,
      high_quality: rows.filter((r) => (r.quality_score || 0) >= 75).length,
      median_per: median(
        rows.map((r) => r.per).filter((v): v is number => v != null && v > 0),
      ),
      median_roe: median(
        rows.map((r) => r.roe).filter((v): v is number => v != null),
      ),
      top_weight: rows.slice(0, 5).map((r) => ({
        code: r.code,
        name: r.name,
        weight_pct: r.weight_pct || 0,
      })),
    },
    rows,
    source: "naver+universe",
  };

  if (r2Configured()) {
    try {
      await r2PutObject(
        R2_KEY,
        Buffer.from(JSON.stringify(payload), "utf8"),
        "application/json; charset=utf-8",
        "public, max-age=60",
      );
    } catch {
      /* ignore */
    }
  }

  return payload;
}
