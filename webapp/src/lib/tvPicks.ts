import type { HeatmapCell } from "@/lib/heatmap";

export type PickItem = { symbol: string; name: string; note?: string };

export type PickContext = {
  count: number;
  ticker: string;
  heatmap: HeatmapCell[];
  universeLabel: string;
};

export type PickSource = {
  id: string;
  group: string;
  label: string;
  /** Short label used in the default watchlist name. */
  short: (ctx: PickContext) => string;
  defaultCount: number;
  needsTicker?: boolean;
  tickerPlaceholder?: string;
  load: (ctx: PickContext) => Promise<PickItem[]>;
};

type Idea = { symbol: string; name?: string; score?: number; weight_pct?: number };
type Signal = { symbol: string; label?: string; score?: number; signal?: string };
type Fund = { symbol: string; name?: string; name_ko?: string; change_1y_pct?: number | null };
type Holding = { code: string; name?: string; weight_pct?: number | null };
type MatrixRow = { code: string; name: string; fund_count: number; avg_weight: number };
type Overweight = { code: string; name: string; brand?: string; delta_vs_peers: number };
type NewEtf = { code: string; name: string; list_date?: string };
type KosdaqRow = { code: string; name: string; weight_pct?: number; change_pct?: number };
type KospiRow = {
  code: string;
  name: string;
  per?: number | null;
  roe?: number | null;
  dividend_yield?: number | null;
};
type ThemeProduct = { symbol: string; name?: string; name_ko?: string; change_3m_pct?: number | null };
type PoliBasket = { symbol: string; name_ko?: string; name?: string; party?: string; theme?: string };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `${url} 불러오기 실패 (HTTP ${res.status})`);
  }
  return data;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pct(value: unknown, digits = 1): string {
  const n = num(value);
  return n == null ? "" : `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function isKrCode(ticker: string): boolean {
  return /^\d[0-9A-Z]{5}$/.test(ticker.trim().toUpperCase());
}

function heatmapPicks(direction: "up" | "down") {
  return async (ctx: PickContext): Promise<PickItem[]> => {
    if (!ctx.heatmap.length) throw new Error("히트맵 데이터가 아직 없습니다.");
    return [...ctx.heatmap]
      .sort((a, b) =>
        direction === "up"
          ? b.daily_return_pct - a.daily_return_pct
          : a.daily_return_pct - b.daily_return_pct,
      )
      .slice(0, ctx.count)
      .map((c) => ({ symbol: c.ticker, name: c.name, note: pct(c.daily_return_pct, 2) }));
  };
}

export const PICK_SOURCES: PickSource[] = [
  {
    id: "ideas_buy",
    group: "AI·시그널",
    label: "AI 트레이딩 아이디어 · 매수 제안",
    short: () => "AI 매수제안",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ buys?: Idea[] }>("/api/trading-ideas");
      return [...(d.buys || [])]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, count)
        .map((i) => ({
          symbol: i.symbol,
          name: i.name || i.symbol,
          note: `점수 ${i.score ?? "—"}${i.weight_pct ? ` · 비중 ${i.weight_pct}%` : ""}`,
        }));
    },
  },
  {
    id: "ideas_avoid",
    group: "AI·시그널",
    label: "AI 트레이딩 아이디어 · 회피",
    short: () => "AI 회피",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ sells?: Idea[] }>("/api/trading-ideas");
      return [...(d.sells || [])]
        .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
        .slice(0, count)
        .map((i) => ({ symbol: i.symbol, name: i.name || i.symbol, note: `점수 ${i.score ?? "—"}` }));
    },
  },
  {
    id: "signals_buy",
    group: "AI·시그널",
    label: "룰 시그널 Buy (코어·섹터·테마)",
    short: () => "시그널 Buy",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ core?: Signal[]; sectors?: Signal[]; themes?: Signal[] }>(
        "/api/trading-signals",
      );
      return [...(d.core || []), ...(d.sectors || []), ...(d.themes || [])]
        .filter((s) => s.signal === "buy")
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, count)
        .map((s) => ({ symbol: s.symbol, name: s.label || s.symbol, note: `점수 ${s.score ?? "—"}` }));
    },
  },
  {
    id: "ai_etf",
    group: "AI·시그널",
    label: "AI 운용 ETF (프로세스형·테마형)",
    short: () => "AI ETF",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ process?: Fund[]; theme?: Fund[] }>("/api/ai-etf");
      return [...(d.process || []), ...(d.theme || [])].slice(0, count).map((f) => ({
        symbol: f.symbol,
        name: f.name_ko || f.name || f.symbol,
        note: f.change_1y_pct != null ? `1Y ${pct(f.change_1y_pct)}` : undefined,
      }));
    },
  },
  {
    id: "etf_holdings",
    group: "ETF 편입",
    label: "특정 ETF 편입 Top N",
    short: (ctx) => `${ctx.ticker.toUpperCase()} 편입 Top${ctx.count}`,
    defaultCount: 5,
    needsTicker: true,
    tickerPlaceholder: "ETF 티커 (QQQ, SMH, 069500)",
    load: async ({ count, ticker }) => {
      const t = ticker.trim().toUpperCase();
      if (!t) throw new Error("ETF 티커를 입력하세요.");
      const params = new URLSearchParams({
        ticker: t,
        market: isKrCode(t) ? "KR" : "US",
        limit: "80",
      });
      const d = await getJson<{ holdings?: Holding[]; name?: string }>(`/api/etf-holdings?${params}`);
      return [...(d.holdings || [])]
        .filter((h) => h.code)
        .sort((a, b) => (b.weight_pct ?? 0) - (a.weight_pct ?? 0))
        .slice(0, count)
        .map((h) => ({
          symbol: h.code,
          name: h.name || h.code,
          note: h.weight_pct != null ? `${h.weight_pct}%` : undefined,
        }));
    },
  },
  {
    id: "kosdaq_active_consensus",
    group: "ETF 편입",
    label: "코스닥 액티브 ETF 공통 편입",
    short: () => "코스닥액티브 공통편입",
    defaultCount: 15,
    load: async ({ count }) => {
      const d = await getJson<{ consensus?: MatrixRow[] }>("/api/kosdaq-active");
      return [...(d.consensus || [])]
        .sort((a, b) => b.fund_count - a.fund_count || b.avg_weight - a.avg_weight)
        .slice(0, count)
        .map((r) => ({
          symbol: r.code,
          name: r.name,
          note: `${r.fund_count}개 펀드 · 평균 ${r.avg_weight.toFixed(1)}%`,
        }));
    },
  },
  {
    id: "kosdaq_active_overweight",
    group: "ETF 편입",
    label: "코스닥 액티브 운용사 오버웨이트",
    short: () => "코스닥액티브 OW",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ manager_overweights?: Overweight[] }>("/api/kosdaq-active");
      return [...(d.manager_overweights || [])]
        .sort((a, b) => b.delta_vs_peers - a.delta_vs_peers)
        .slice(0, count)
        .map((r) => ({
          symbol: r.code,
          name: r.name,
          note: `${r.brand || ""} +${r.delta_vs_peers.toFixed(1)}%p`.trim(),
        }));
    },
  },
  {
    id: "etf_new_kr",
    group: "ETF 편입",
    label: "국내 신규 상장 ETF",
    short: () => "국내 신규ETF",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ kr_new?: NewEtf[] }>("/api/etf-new");
      return (d.kr_new || []).slice(0, count).map((e) => ({
        symbol: e.code,
        name: e.name,
        note: e.list_date ? `상장 ${e.list_date}` : undefined,
      }));
    },
  },
  {
    id: "etf_new_us",
    group: "ETF 편입",
    label: "미국 신규 상장 ETF",
    short: () => "미국 신규ETF",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ us_new?: NewEtf[] }>("/api/etf-new");
      return (d.us_new || []).slice(0, count).map((e) => ({
        symbol: e.code,
        name: e.name,
        note: e.list_date ? `상장 ${e.list_date}` : undefined,
      }));
    },
  },
  {
    id: "kosdaq100_weight",
    group: "국내",
    label: "코스닥100 시총 비중 Top",
    short: () => "코스닥100 비중",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ rows?: KosdaqRow[] }>("/api/kosdaq100");
      return [...(d.rows || [])]
        .sort((a, b) => (b.weight_pct ?? 0) - (a.weight_pct ?? 0))
        .slice(0, count)
        .map((r) => ({ symbol: r.code, name: r.name, note: `${(r.weight_pct ?? 0).toFixed(1)}%` }));
    },
  },
  {
    id: "kosdaq100_gainers",
    group: "국내",
    label: "코스닥100 당일 상승 Top",
    short: () => "코스닥100 상승",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ rows?: KosdaqRow[] }>("/api/kosdaq100");
      return [...(d.rows || [])]
        .sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0))
        .slice(0, count)
        .map((r) => ({ symbol: r.code, name: r.name, note: pct(r.change_pct) }));
    },
  },
  {
    id: "kospi200_value",
    group: "국내",
    label: "KOSPI200 저PER (ROE 10% 이상)",
    short: () => "K200 저PER",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ rows?: KospiRow[] }>("/api/kospi200-panel");
      return [...(d.rows || [])]
        .filter((r) => (num(r.per) ?? 0) > 0 && (num(r.roe) ?? 0) >= 10)
        .sort((a, b) => (a.per ?? 0) - (b.per ?? 0))
        .slice(0, count)
        .map((r) => ({ symbol: r.code, name: r.name, note: `PER ${r.per} · ROE ${r.roe}%` }));
    },
  },
  {
    id: "kospi200_dividend",
    group: "국내",
    label: "KOSPI200 배당수익률 Top",
    short: () => "K200 고배당",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ rows?: KospiRow[] }>("/api/kospi200-panel");
      return [...(d.rows || [])]
        .filter((r) => (num(r.dividend_yield) ?? 0) > 0)
        .sort((a, b) => (b.dividend_yield ?? 0) - (a.dividend_yield ?? 0))
        .slice(0, count)
        .map((r) => ({ symbol: r.code, name: r.name, note: `배당 ${r.dividend_yield}%` }));
    },
  },
  {
    id: "heatmap_up",
    group: "미국",
    label: "히트맵 상승 Top (현재 유니버스)",
    short: (ctx) => `${ctx.universeLabel} 상승`,
    defaultCount: 10,
    load: heatmapPicks("up"),
  },
  {
    id: "heatmap_down",
    group: "미국",
    label: "히트맵 하락 Top (현재 유니버스)",
    short: (ctx) => `${ctx.universeLabel} 하락`,
    defaultCount: 10,
    load: heatmapPicks("down"),
  },
  {
    id: "theme_etf_3m",
    group: "미국",
    label: "테마 ETF 3개월 수익률 Top",
    short: () => "테마ETF 3M",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ products?: ThemeProduct[] }>("/api/theme-etf");
      return [...(d.products || [])]
        .filter((p) => num(p.change_3m_pct) != null)
        .sort((a, b) => (b.change_3m_pct ?? 0) - (a.change_3m_pct ?? 0))
        .slice(0, count)
        .map((p) => ({ symbol: p.symbol, name: p.name_ko || p.name || p.symbol, note: `3M ${pct(p.change_3m_pct)}` }));
    },
  },
  {
    id: "poli_baskets",
    group: "미국",
    label: "정치 테마 ETF 바스켓",
    short: () => "정치테마",
    defaultCount: 10,
    load: async ({ count }) => {
      const d = await getJson<{ baskets?: PoliBasket[] }>("/api/poli-themes");
      return (d.baskets || []).slice(0, count).map((b) => ({
        symbol: b.symbol,
        name: b.name_ko || b.name || b.symbol,
        note: [b.party, b.theme].filter(Boolean).join(" · ") || undefined,
      }));
    },
  },
];

export const PICK_GROUPS = Array.from(new Set(PICK_SOURCES.map((s) => s.group)));
