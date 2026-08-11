/**
 * Crypto / 가상자산 dashboard — free public APIs only.
 * CoinGecko (prices, dominance), Upbit (KRW), Yahoo KRW=X (FX),
 * alternative.me Fear&Greed, OKX (BTC funding / OI snippet).
 */

export const CRYPTO_SCHEDULE_NOTE =
  "CoinGecko·Upbit·OKX·Yahoo 공개 API · 약 1–2분 캐시 · 투자 권유 아님";

const UA =
  "Mozilla/5.0 (compatible; SavvyETF/1.0; +https://github.com/parkwooyeol9/SavvyETF)";

const COIN_IDS = [
  "bitcoin",
  "ethereum",
  "solana",
  "ripple",
  "binancecoin",
  "dogecoin",
  "cardano",
  "avalanche-2",
  "chainlink",
  "polkadot",
] as const;

/** Upbit KRW markets used for kimchi premium */
const UPBIT_MARKETS = ["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-SOL"] as const;

export type CryptoAssetRow = {
  id: string;
  symbol: string;
  name: string;
  price_usd: number | null;
  change_24h_pct: number | null;
  change_7d_pct: number | null;
  market_cap: number | null;
  volume_24h: number | null;
  sparkline_7d: number[];
};

export type KimchiRow = {
  symbol: string;
  upbit_krw: number | null;
  fair_krw: number | null;
  usd: number | null;
  premium_pct: number | null;
};

export type CryptoIndicator = {
  id: string;
  label: string;
  value: number | null;
  display: string;
  note?: string;
  tone?: "up" | "down" | "flat";
};

export type FearGreedPoint = {
  date: string;
  value: number;
  classification: string;
};

export type CryptoAssetsPayload = {
  ok: boolean;
  generated_at: string;
  generated_at_display: string;
  source: string;
  schedule_note: string;
  note: string;
  usdkrw: number | null;
  assets: CryptoAssetRow[];
  kimchi: KimchiRow[];
  indicators: CryptoIndicator[];
  fear_greed: FearGreedPoint[];
  interpretations: string[];
  error?: string;
};

type CgMarket = {
  id: string;
  symbol: string;
  name: string;
  current_price?: number;
  price_change_percentage_24h?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  market_cap?: number;
  total_volume?: number;
  sparkline_in_7d?: { price?: number[] };
};

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

function toneFrom(n: number | null | undefined): "up" | "down" | "flat" {
  if (n == null || !Number.isFinite(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${n.toPrecision(4)}`;
}

function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchUsdKrw(): Promise<number | null> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - 5 * 86400;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/KRW=X` +
    `?period1=${period1}&period2=${period2}&interval=1d`;
  const json = await fetchJson<{
    chart?: {
      result?: Array<{ meta?: { regularMarketPrice?: number } }>;
    };
  }>(url);
  const px = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return px != null && px > 0 ? px : null;
}

function interpret(input: {
  btcDom: number | null;
  ethDom: number | null;
  usdtDom: number | null;
  kimchiBtc: number | null;
  fear: number | null;
  fundingPct: number | null;
}): string[] {
  const lines: string[] = [];
  const { btcDom, ethDom, usdtDom, kimchiBtc, fear, fundingPct } = input;

  if (usdtDom != null) {
    if (usdtDom >= 8.5) {
      lines.push(
        `USDT.D ${usdtDom.toFixed(2)}% — 테더 비중 높음. 대기 자금·위험회피 성격이 강할 수 있습니다.`,
      );
    } else if (usdtDom <= 5.5) {
      lines.push(
        `USDT.D ${usdtDom.toFixed(2)}% — 테더 비중 낮음. 리스크 자산으로 자금이 이미 이동한 상태일 수 있습니다.`,
      );
    } else {
      lines.push(`USDT.D ${usdtDom.toFixed(2)}% — 스테이블 비중은 중간 수준입니다.`);
    }
  }

  if (btcDom != null) {
    if (btcDom >= 55) {
      lines.push(
        `BTC.D ${btcDom.toFixed(1)}% — 비트코인 편중. 알트 대비 BTC 선호·안전자산 성격이 강한 구간일 수 있습니다.`,
      );
    } else if (btcDom <= 45) {
      lines.push(
        `BTC.D ${btcDom.toFixed(1)}% — 도미넌스 낮음. 알트 확산·리스크온 가능성을 시사할 수 있습니다.`,
      );
    } else if (ethDom != null) {
      lines.push(
        `BTC.D ${btcDom.toFixed(1)}% / ETH.D ${ethDom.toFixed(1)}% — 대형주(BTC·ETH) 중심 구도입니다.`,
      );
    }
  }

  if (kimchiBtc != null) {
    if (kimchiBtc >= 2) {
      lines.push(
        `김치 프리미엄(BTC) +${kimchiBtc.toFixed(2)}% — 국내가 할증. 유입·과열 신호를 같이 봅니다.`,
      );
    } else if (kimchiBtc <= -1.5) {
      lines.push(
        `김치 프리미엄(BTC) ${kimchiBtc.toFixed(2)}% — 국내가 할인(역프리미엄). 차익·수급 왜곡을 점검합니다.`,
      );
    } else {
      lines.push(
        `김치 프리미엄(BTC) ${kimchiBtc >= 0 ? "+" : ""}${kimchiBtc.toFixed(2)}% — 해외 대비 괴리가 크지 않습니다.`,
      );
    }
  }

  if (fear != null) {
    if (fear <= 25) {
      lines.push(`Fear & Greed ${fear} — Extreme/Fear 구간. 과매도 심리일 수 있으나 추세와 함께 봅니다.`);
    } else if (fear >= 75) {
      lines.push(`Fear & Greed ${fear} — Greed 구간. 과열·추격 매수 리스크를 염두에 둡니다.`);
    } else {
      lines.push(`Fear & Greed ${fear} — 중립~약공포/약탐욕 구간입니다.`);
    }
  }

  if (fundingPct != null) {
    if (fundingPct >= 0.03) {
      lines.push(
        `BTC 펀딩 ${fundingPct.toFixed(4)}% — 롱 비용 부담. 과열 시 청산 압력에 유의합니다.`,
      );
    } else if (fundingPct <= -0.01) {
      lines.push(
        `BTC 펀딩 ${fundingPct.toFixed(4)}% — 음수(숏 비용). 숏 스퀴즈 여지를 같이 봅니다.`,
      );
    }
  }

  if (!lines.length) {
    lines.push("일부 보조지표가 비어 있습니다. 잠시 후 새로고침해 주세요.");
  }
  return lines.slice(0, 8);
}

export async function buildCryptoAssetsPayload(): Promise<CryptoAssetsPayload> {
  const ids = COIN_IDS.join(",");
  const marketsUrl =
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd` +
    `&ids=${encodeURIComponent(ids)}&order=market_cap_desc&sparkline=true` +
    `&price_change_percentage=24h%2C7d`;

  const [
    markets,
    global,
    upbit,
    usdkrw,
    fng,
    funding,
    oi,
  ] = await Promise.all([
    fetchJson<CgMarket[]>(marketsUrl),
    fetchJson<{
      data?: {
        market_cap_percentage?: Record<string, number>;
        total_market_cap?: { usd?: number };
        total_volume?: { usd?: number };
      };
    }>("https://api.coingecko.com/api/v3/global"),
    fetchJson<Array<{ market: string; trade_price: number }>>(
      `https://api.upbit.com/v1/ticker?markets=${UPBIT_MARKETS.join(",")}`,
    ),
    fetchUsdKrw(),
    fetchJson<{
      data?: Array<{
        value: string;
        value_classification: string;
        timestamp: string;
      }>;
    }>("https://api.alternative.me/fng/?limit=30"),
    fetchJson<{ data?: Array<{ fundingRate?: string }> }>(
      "https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP",
    ),
    fetchJson<{ data?: Array<{ oiUsd?: string }> }>(
      "https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP",
    ),
  ]);

  const assets: CryptoAssetRow[] = (markets || []).map((c) => ({
    id: c.id,
    symbol: (c.symbol || "").toUpperCase(),
    name: c.name,
    price_usd: c.current_price ?? null,
    change_24h_pct: c.price_change_percentage_24h ?? null,
    change_7d_pct: c.price_change_percentage_7d_in_currency ?? null,
    market_cap: c.market_cap ?? null,
    volume_24h: c.total_volume ?? null,
    sparkline_7d: (c.sparkline_in_7d?.price || []).slice(-48),
  }));

  const usdBySym = new Map(
    assets.map((a) => [a.symbol, a.price_usd] as const),
  );
  const kimchi: KimchiRow[] = (upbit || []).map((u) => {
    const symbol = u.market.split("-")[1] || "";
    const usd = usdBySym.get(symbol) ?? null;
    const fair =
      usd != null && usdkrw != null && usdkrw > 0 ? usd * usdkrw : null;
    const premium =
      fair != null && fair > 0
        ? ((u.trade_price / fair) - 1) * 100
        : null;
    return {
      symbol,
      upbit_krw: u.trade_price,
      fair_krw: fair,
      usd,
      premium_pct: premium,
    };
  });

  const mcapPct = global?.data?.market_cap_percentage || {};
  const btcDom = mcapPct.btc ?? null;
  const ethDom = mcapPct.eth ?? null;
  const usdtDom = mcapPct.usdt ?? null;
  const totalMcap = global?.data?.total_market_cap?.usd ?? null;
  const totalVol = global?.data?.total_volume?.usd ?? null;
  const liquidity =
    totalMcap && totalVol && totalMcap > 0 ? (totalVol / totalMcap) * 100 : null;

  const fundingRate = Number(funding?.data?.[0]?.fundingRate);
  const fundingPct = Number.isFinite(fundingRate) ? fundingRate * 100 : null;
  const oiUsd = Number(oi?.data?.[0]?.oiUsd);

  const fear_greed: FearGreedPoint[] = (fng?.data || [])
    .map((row) => ({
      date: new Date(Number(row.timestamp) * 1000).toISOString().slice(0, 10),
      value: Number(row.value),
      classification: row.value_classification,
    }))
    .filter((p) => Number.isFinite(p.value))
    .reverse();

  const fearLatest = fear_greed.at(-1)?.value ?? null;
  const kimchiBtc =
    kimchi.find((k) => k.symbol === "BTC")?.premium_pct ?? null;

  const indicators: CryptoIndicator[] = [
    {
      id: "btc_dom",
      label: "BTC Dominance",
      value: btcDom,
      display: btcDom != null ? `${btcDom.toFixed(2)}%` : "—",
      note: "CoinGecko · 알트 대비 BTC 시총 비중",
      tone: "flat",
    },
    {
      id: "eth_dom",
      label: "ETH Dominance",
      value: ethDom,
      display: ethDom != null ? `${ethDom.toFixed(2)}%` : "—",
      note: "CoinGecko",
      tone: "flat",
    },
    {
      id: "usdt_dom",
      label: "USDT Dominance",
      value: usdtDom,
      display: usdtDom != null ? `${usdtDom.toFixed(2)}%` : "—",
      note: "테더 비중↑ = 대기자금·위험회피 성격",
      tone: "flat",
    },
    {
      id: "kimchi_btc",
      label: "김치 프리미엄 (BTC)",
      value: kimchiBtc,
      display: fmtPct(kimchiBtc),
      note: "Upbit KRW ÷ (CoinGecko USD × Yahoo KRW=X)",
      tone: toneFrom(kimchiBtc),
    },
    {
      id: "fear_greed",
      label: "Fear & Greed",
      value: fearLatest,
      display:
        fearLatest != null
          ? `${fearLatest} · ${fear_greed.at(-1)?.classification || ""}`
          : "—",
      note: "alternative.me",
      tone:
        fearLatest == null
          ? "flat"
          : fearLatest >= 60
            ? "up"
            : fearLatest <= 40
              ? "down"
              : "flat",
    },
    {
      id: "funding",
      label: "BTC Funding",
      value: fundingPct,
      display: fundingPct != null ? `${fundingPct.toFixed(4)}%` : "—",
      note: "OKX BTC-USDT-SWAP",
      tone: toneFrom(fundingPct),
    },
    {
      id: "oi",
      label: "BTC Perp OI",
      value: Number.isFinite(oiUsd) ? oiUsd : null,
      display: fmtUsd(Number.isFinite(oiUsd) ? oiUsd : null),
      note: "OKX 미결제약정 (USD)",
      tone: "flat",
    },
    {
      id: "liquidity",
      label: "Crypto Liquidity",
      value: liquidity,
      display: liquidity != null ? `${liquidity.toFixed(2)}%` : "—",
      note: "글로벌 24h Vol / Mcap",
      tone: "flat",
    },
    {
      id: "total_mcap",
      label: "Total Crypto Mcap",
      value: totalMcap ?? null,
      display: fmtUsd(totalMcap ?? null),
      note: "CoinGecko global",
      tone: "flat",
    },
    {
      id: "usdkrw",
      label: "USD/KRW",
      value: usdkrw,
      display: usdkrw != null ? usdkrw.toFixed(2) : "—",
      note: "Yahoo KRW=X · 김치 산출용",
      tone: "flat",
    },
  ];

  const ok = assets.length > 0;
  return {
    ok,
    generated_at: new Date().toISOString(),
    generated_at_display: displayNow(),
    source: `CoinGecko · Upbit · OKX · Yahoo · alternative.me · ${assets.length} assets`,
    schedule_note: CRYPTO_SCHEDULE_NOTE,
    note:
      "주요 코인 시세·시총과 함께 BTC/ETH/USDT 도미넌스, 김치 프리미엄(Upbit vs 해외), " +
      "Fear&Greed, BTC 펀딩·OI를 한 화면에 모았습니다.",
    usdkrw,
    assets,
    kimchi,
    indicators,
    fear_greed,
    interpretations: interpret({
      btcDom,
      ethDom,
      usdtDom,
      kimchiBtc,
      fear: fearLatest,
      fundingPct,
    }),
    error: ok ? undefined : "가상자산 데이터 로드 실패",
  };
}
