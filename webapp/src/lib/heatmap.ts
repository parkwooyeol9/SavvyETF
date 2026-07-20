/** Curated market heatmaps built from Yahoo daily bars (no Render dependency). */

import { fetchDailyCloses } from "@/lib/simulate";

export type HeatmapUniverse = "etf" | "sp" | "nas";

export type HeatmapCell = {
  ticker: string;
  name: string;
  size: number;
  daily_return_pct: number;
};

export type HeatmapPayload = {
  ok: boolean;
  error?: string;
  source?: "vercel" | "render";
  universe?: HeatmapUniverse;
  label?: string;
  size_label?: string;
  top_n?: number;
  generated_at?: string;
  session_label?: string;
  stats?: {
    avg_return_pct: number;
    best: { ticker: string; daily_return_pct: number };
    worst: { ticker: string; daily_return_pct: number };
    up_count: number;
    down_count: number;
  };
  cells?: HeatmapCell[];
};

type UniverseMember = { ticker: string; name: string; size: number };

const META: Record<
  HeatmapUniverse,
  { label: string; size_label: string; short: string }
> = {
  etf: { label: "US Equity ETF", size_label: "AUM", short: "ETF" },
  sp: { label: "S&P 500", size_label: "Market cap", short: "S&P 500" },
  nas: { label: "NASDAQ 100", size_label: "Market cap", short: "NASDAQ 100" },
};

/** Approximate relative sizes for tile area (billions USD). */
const ETF_UNIVERSE: UniverseMember[] = [
  { ticker: "SPY", name: "S&P 500", size: 580 },
  { ticker: "IVV", name: "iShares Core S&P 500", size: 520 },
  { ticker: "VOO", name: "Vanguard S&P 500", size: 500 },
  { ticker: "VTI", name: "Total Stock Market", size: 420 },
  { ticker: "QQQ", name: "Nasdaq-100", size: 300 },
  { ticker: "VEA", name: "Developed Markets", size: 140 },
  { ticker: "IEFA", name: "Core MSCI EAFE", size: 130 },
  { ticker: "VUG", name: "Growth", size: 125 },
  { ticker: "AGG", name: "US Aggregate Bond", size: 120 },
  { ticker: "BND", name: "Total Bond Market", size: 115 },
  { ticker: "IWF", name: "Russell 1000 Growth", size: 100 },
  { ticker: "VTV", name: "Value", size: 95 },
  { ticker: "VXUS", name: "Total Intl Stock", size: 85 },
  { ticker: "GLD", name: "Gold", size: 80 },
  { ticker: "IEMG", name: "Emerging Markets", size: 75 },
  { ticker: "VGT", name: "Information Technology", size: 70 },
  { ticker: "XLK", name: "Technology", size: 65 },
  { ticker: "IWM", name: "Russell 2000", size: 60 },
  { ticker: "TLT", name: "20+ Year Treasury", size: 55 },
  { ticker: "SCHD", name: "US Dividend Equity", size: 55 },
  { ticker: "XLF", name: "Financials", size: 50 },
  { ticker: "VNQ", name: "Real Estate", size: 40 },
  { ticker: "SMH", name: "Semiconductors", size: 28 },
  { ticker: "XLE", name: "Energy", size: 35 },
  { ticker: "XLV", name: "Health Care", size: 38 },
  { ticker: "ARKK", name: "Innovation", size: 6 },
  { ticker: "EEM", name: "Emerging Markets", size: 18 },
  { ticker: "HYG", name: "High Yield Corp", size: 16 },
  { ticker: "LQD", name: "Investment Grade Corp", size: 30 },
  { ticker: "IAU", name: "Gold Trust", size: 30 },
];

const SP_UNIVERSE: UniverseMember[] = [
  { ticker: "NVDA", name: "NVIDIA", size: 3400 },
  { ticker: "MSFT", name: "Microsoft", size: 3200 },
  { ticker: "AAPL", name: "Apple", size: 3100 },
  { ticker: "AMZN", name: "Amazon", size: 2200 },
  { ticker: "GOOGL", name: "Alphabet", size: 2000 },
  { ticker: "META", name: "Meta", size: 1600 },
  { ticker: "BRK-B", name: "Berkshire", size: 1000 },
  { ticker: "AVGO", name: "Broadcom", size: 1200 },
  { ticker: "TSLA", name: "Tesla", size: 1100 },
  { ticker: "JPM", name: "JPMorgan", size: 700 },
  { ticker: "LLY", name: "Eli Lilly", size: 750 },
  { ticker: "V", name: "Visa", size: 650 },
  { ticker: "XOM", name: "Exxon", size: 500 },
  { ticker: "UNH", name: "UnitedHealth", size: 450 },
  { ticker: "MA", name: "Mastercard", size: 480 },
  { ticker: "COST", name: "Costco", size: 420 },
  { ticker: "PG", name: "Procter & Gamble", size: 400 },
  { ticker: "JNJ", name: "Johnson & Johnson", size: 380 },
  { ticker: "HD", name: "Home Depot", size: 370 },
  { ticker: "ABBV", name: "AbbVie", size: 340 },
  { ticker: "BAC", name: "Bank of America", size: 320 },
  { ticker: "NFLX", name: "Netflix", size: 400 },
  { ticker: "CRM", name: "Salesforce", size: 280 },
  { ticker: "KO", name: "Coca-Cola", size: 280 },
  { ticker: "PEP", name: "PepsiCo", size: 230 },
  { ticker: "MRK", name: "Merck", size: 250 },
  { ticker: "WMT", name: "Walmart", size: 700 },
  { ticker: "ORCL", name: "Oracle", size: 450 },
  { ticker: "CVX", name: "Chevron", size: 280 },
  { ticker: "AMD", name: "AMD", size: 220 },
];

const NAS_UNIVERSE: UniverseMember[] = [
  { ticker: "NVDA", name: "NVIDIA", size: 3400 },
  { ticker: "MSFT", name: "Microsoft", size: 3200 },
  { ticker: "AAPL", name: "Apple", size: 3100 },
  { ticker: "AMZN", name: "Amazon", size: 2200 },
  { ticker: "GOOGL", name: "Alphabet", size: 2000 },
  { ticker: "META", name: "Meta", size: 1600 },
  { ticker: "AVGO", name: "Broadcom", size: 1200 },
  { ticker: "TSLA", name: "Tesla", size: 1100 },
  { ticker: "NFLX", name: "Netflix", size: 400 },
  { ticker: "COST", name: "Costco", size: 420 },
  { ticker: "AMD", name: "AMD", size: 220 },
  { ticker: "ADBE", name: "Adobe", size: 200 },
  { ticker: "PEP", name: "PepsiCo", size: 230 },
  { ticker: "CSCO", name: "Cisco", size: 220 },
  { ticker: "TMUS", name: "T-Mobile", size: 250 },
  { ticker: "LIN", name: "Linde", size: 210 },
  { ticker: "INTU", name: "Intuit", size: 180 },
  { ticker: "AMAT", name: "Applied Materials", size: 160 },
  { ticker: "TXN", name: "Texas Instruments", size: 170 },
  { ticker: "QCOM", name: "Qualcomm", size: 180 },
  { ticker: "ISRG", name: "Intuitive Surgical", size: 170 },
  { ticker: "BKNG", name: "Booking", size: 160 },
  { ticker: "AMGN", name: "Amgen", size: 150 },
  { ticker: "HON", name: "Honeywell", size: 140 },
  { ticker: "SBUX", name: "Starbucks", size: 100 },
  { ticker: "GILD", name: "Gilead", size: 110 },
  { ticker: "MDLZ", name: "Mondelez", size: 95 },
  { ticker: "ADI", name: "Analog Devices", size: 110 },
  { ticker: "PANW", name: "Palo Alto", size: 120 },
  { ticker: "MU", name: "Micron", size: 140 },
];

const UNIVERSES: Record<HeatmapUniverse, UniverseMember[]> = {
  etf: ETF_UNIVERSE,
  sp: SP_UNIVERSE,
  nas: NAS_UNIVERSE,
};

export function isHeatmapUniverse(value: string): value is HeatmapUniverse {
  return value === "etf" || value === "sp" || value === "nas";
}

function endDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function startDate(): string {
  // Look back far enough to cover weekends/holidays.
  return new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
}

async function dailyReturnPct(ticker: string): Promise<number | null> {
  try {
    const points = await fetchDailyCloses(ticker, startDate(), endDate());
    if (points.length < 2) return null;
    const prev = points[points.length - 2].close;
    const last = points[points.length - 1].close;
    if (!prev) return null;
    return ((last / prev - 1) * 100);
  } catch {
    return null;
  }
}

export async function buildLocalHeatmap(
  universe: HeatmapUniverse,
  topN = 30,
): Promise<HeatmapPayload> {
  const meta = META[universe];
  const members = UNIVERSES[universe]
    .slice()
    .sort((a, b) => b.size - a.size)
    .slice(0, Math.max(5, Math.min(50, topN)));

  const settled = await Promise.all(
    members.map(async (m) => {
      const ret = await dailyReturnPct(m.ticker);
      return ret == null ? null : { ...m, daily_return_pct: round(ret, 3) };
    }),
  );

  const cells = settled.filter((c): c is HeatmapCell => c != null);
  if (cells.length < 5) {
    return {
      ok: false,
      universe,
      label: meta.label,
      size_label: meta.size_label,
      error: "Could not load enough Yahoo price bars for the heatmap.",
      source: "vercel",
    };
  }

  const returns = cells.map((c) => c.daily_return_pct);
  const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
  const best = cells.reduce((a, b) => (b.daily_return_pct > a.daily_return_pct ? b : a));
  const worst = cells.reduce((a, b) => (b.daily_return_pct < a.daily_return_pct ? b : a));

  return {
    ok: true,
    source: "vercel",
    universe,
    label: meta.label,
    size_label: meta.size_label,
    top_n: cells.length,
    generated_at: new Date().toISOString(),
    session_label: `${meta.short} · Yahoo daily · tile size ≈ ${meta.size_label}`,
    stats: {
      avg_return_pct: round(avg, 3),
      best: { ticker: best.ticker, daily_return_pct: best.daily_return_pct },
      worst: { ticker: worst.ticker, daily_return_pct: worst.daily_return_pct },
      up_count: returns.filter((r) => r > 0).length,
      down_count: returns.filter((r) => r < 0).length,
    },
    cells,
  };
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** Simple squarify layout → normalized rectangles in [0,100]×[0,100]. */
export type TreemapRect = {
  ticker: string;
  name: string;
  daily_return_pct: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export function layoutTreemap(cells: HeatmapCell[]): TreemapRect[] {
  if (!cells.length) return [];
  const items = cells
    .map((c) => ({ ...c, size: Math.max(c.size, 0.01) }))
    .sort((a, b) => b.size - a.size);

  type Node = { ticker: string; name: string; daily_return_pct: number; size: number };
  const nodes: Node[] = items;

  const rects: TreemapRect[] = [];

  function worst(row: Node[], length: number): number {
    const s = row.reduce((a, b) => a + b.size, 0);
    let maxR = 0;
    for (const n of row) {
      const r = Math.max((length * length * n.size) / (s * s), s * s / (length * length * n.size));
      if (r > maxR) maxR = r;
    }
    return maxR;
  }

  function layoutRow(row: Node[], x: number, y: number, w: number, h: number, horizontal: boolean) {
    const total = row.reduce((a, b) => a + b.size, 0);
    let offset = 0;
    for (const n of row) {
      const frac = n.size / total;
      if (horizontal) {
        const hh = h * frac;
        rects.push({
          ticker: n.ticker,
          name: n.name,
          daily_return_pct: n.daily_return_pct,
          x,
          y: y + offset,
          w,
          h: hh,
        });
        offset += hh;
      } else {
        const ww = w * frac;
        rects.push({
          ticker: n.ticker,
          name: n.name,
          daily_return_pct: n.daily_return_pct,
          x: x + offset,
          y,
          w: ww,
          h,
        });
        offset += ww;
      }
    }
  }

  function squarify(children: Node[], x: number, y: number, w: number, h: number) {
    if (!children.length || w <= 0 || h <= 0) return;
    if (children.length === 1) {
      const n = children[0];
      rects.push({
        ticker: n.ticker,
        name: n.name,
        daily_return_pct: n.daily_return_pct,
        x,
        y,
        w,
        h,
      });
      return;
    }

    const total = children.reduce((a, b) => a + b.size, 0);
    const scaled = children.map((c) => ({ ...c, size: (c.size / total) * w * h }));
    const horizontal = w >= h;
    const length = horizontal ? h : w;

    let row: Node[] = [];
    let rest = scaled.slice();
    while (rest.length) {
      const next = rest[0];
      if (!row.length) {
        row = [next];
        rest = rest.slice(1);
        continue;
      }
      if (worst([...row, next], length) <= worst(row, length)) {
        row = [...row, next];
        rest = rest.slice(1);
      } else {
        break;
      }
    }

    const rowArea = row.reduce((a, b) => a + b.size, 0);
    if (horizontal) {
      const rowWidth = rowArea / h;
      layoutRow(row, x, y, rowWidth, h, true);
      squarify(rest, x + rowWidth, y, w - rowWidth, h);
    } else {
      const rowHeight = rowArea / w;
      layoutRow(row, x, y, w, rowHeight, false);
      squarify(rest, x, y + rowHeight, w, h - rowHeight);
    }
  }

  squarify(nodes, 0, 0, 100, 100);
  return rects;
}

export function finvizColor(changePct: number, capPct = 3): string {
  const t = Math.max(-1, Math.min(1, changePct / capPct));
  const eased = Math.sign(t) * Math.abs(t) ** 0.85;
  const neutral = [62, 68, 82];
  const red = [228, 60, 60];
  const green = [33, 191, 94];
  const end = eased < 0 ? red : green;
  const a = Math.abs(eased);
  const rgb = neutral.map((c, i) => Math.round(c + (end[i] - c) * a));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
