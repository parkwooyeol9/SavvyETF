/**
 * Daily NLP pulse — lexicon sentiment over news + DART/SEC events
 * for KOSPI 200 and S&P 500 leaders (not the full index membership).
 */

export type NlpMarket = "kospi200" | "sp500";

export type NlpTone = "bull" | "bear" | "flat";

export type NlpName = {
  id: string;
  market: NlpMarket;
  name: string;
  name_en?: string;
  ticker: string;
  stock_code?: string;
  news_query: string;
};

export type NlpHeadline = {
  id: string;
  name_id: string;
  market: NlpMarket;
  ticker: string;
  name: string;
  date: string;
  title: string;
  source: string;
  url?: string;
  score: number;
  matched: string[];
  kind: "news" | "dart" | "sec" | "call";
};

export type NlpNameCard = {
  id: string;
  market: NlpMarket;
  name: string;
  ticker: string;
  score: number;
  tone: NlpTone;
  news_n: number;
  event_n: number;
  call_n: number;
  top_title: string;
  top_url?: string;
};

export type NlpMarketPulse = {
  market: NlpMarket;
  label: string;
  score: number;
  tone: NlpTone;
  news_n: number;
  event_n: number;
  bull_n: number;
  bear_n: number;
  names: NlpNameCard[];
};

export type NlpPulsePayload = {
  ok: boolean;
  generated_at: string;
  lookback_days: number;
  kospi: NlpMarketPulse;
  spx: NlpMarketPulse;
  events: NlpHeadline[];
  calls: NlpHeadline[];
  feed: NlpHeadline[];
  sources: string[];
  note: string;
  methodology: string[];
  disclaimer: string;
  error?: string;
};

export const NLP_LOOKBACK_DAYS = 2;

export const NLP_SCHEDULE_NOTE =
  "일간 모니터 · KOSPI200·S&P500 대표주 뉴스 텍스트 + DART·SEC 이벤트 공시 · 컨콜/실적 캘린더";

export const NLP_DISCLAIMER =
  "사전 기반 텍스트 극성입니다. 투자 자문·실적 가이던스 해석이 아니며, 헤드라인 노이즈가 포함될 수 있습니다.";

export const NLP_METHODOLOGY: string[] = [
  "유니버스: KOSPI200·S&P500 시총·뉴스 유동성 상위 대표주 (전 구성종목 전수 아님)",
  "뉴스: Google News RSS 최근 2일, 종목명 쿼리",
  "국내 공시: Open DART 주요 이벤트(실적·배당·계약·지배구조·이슈)",
  "미국 공시: SEC EDGAR 8-K (실적 Item 2.02, 기타 중요 이벤트)",
  "컨콜: Finnhub 실적 캘린더 + 콜/가이던스 키워드 헤드라인",
  "점수: 호재−악재 키워드 순점수 (−100~+100), 건수 가중 시장 합성",
];

export const NLP_UNIVERSE: NlpName[] = [
  { id: "005930", market: "kospi200", name: "삼성전자", ticker: "005930.KS", stock_code: "005930", news_query: "삼성전자" },
  { id: "000660", market: "kospi200", name: "SK하이닉스", ticker: "000660.KS", stock_code: "000660", news_query: "SK하이닉스" },
  { id: "373220", market: "kospi200", name: "LG에너지솔루션", ticker: "373220.KS", stock_code: "373220", news_query: "LG에너지솔루션" },
  { id: "005380", market: "kospi200", name: "현대차", ticker: "005380.KS", stock_code: "005380", news_query: "현대차" },
  { id: "000270", market: "kospi200", name: "기아", ticker: "000270.KS", stock_code: "000270", news_query: "기아 자동차" },
  { id: "207940", market: "kospi200", name: "삼성바이오로직스", ticker: "207940.KS", stock_code: "207940", news_query: "삼성바이오로직스" },
  { id: "068270", market: "kospi200", name: "셀트리온", ticker: "068270.KS", stock_code: "068270", news_query: "셀트리온" },
  { id: "105560", market: "kospi200", name: "KB금융", ticker: "105560.KS", stock_code: "105560", news_query: "KB금융" },
  { id: "055550", market: "kospi200", name: "신한지주", ticker: "055550.KS", stock_code: "055550", news_query: "신한지주" },
  { id: "035420", market: "kospi200", name: "NAVER", ticker: "035420.KS", stock_code: "035420", news_query: "네이버" },
  { id: "035720", market: "kospi200", name: "카카오", ticker: "035720.KS", stock_code: "035720", news_query: "카카오" },
  { id: "005490", market: "kospi200", name: "POSCO홀딩스", ticker: "005490.KS", stock_code: "005490", news_query: "포스코홀딩스" },
  { id: "006400", market: "kospi200", name: "삼성SDI", ticker: "006400.KS", stock_code: "006400", news_query: "삼성SDI" },
  { id: "012450", market: "kospi200", name: "한화에어로스페이스", ticker: "012450.KS", stock_code: "012450", news_query: "한화에어로스페이스" },
  { id: "009540", market: "kospi200", name: "HD한국조선해양", ticker: "009540.KS", stock_code: "009540", news_query: "HD한국조선해양" },
  { id: "015760", market: "kospi200", name: "한국전력", ticker: "015760.KS", stock_code: "015760", news_query: "한국전력" },
  { id: "051910", market: "kospi200", name: "LG화학", ticker: "051910.KS", stock_code: "051910", news_query: "LG화학" },
  { id: "028260", market: "kospi200", name: "삼성물산", ticker: "028260.KS", stock_code: "028260", news_query: "삼성물산" },
  { id: "012330", market: "kospi200", name: "현대모비스", ticker: "012330.KS", stock_code: "012330", news_query: "현대모비스" },
  { id: "003670", market: "kospi200", name: "포스코퓨처엠", ticker: "003670.KS", stock_code: "003670", news_query: "포스코퓨처엠" },
  { id: "AAPL", market: "sp500", name: "Apple", name_en: "Apple", ticker: "AAPL", news_query: "Apple AAPL stock" },
  { id: "MSFT", market: "sp500", name: "Microsoft", ticker: "MSFT", news_query: "Microsoft MSFT stock" },
  { id: "NVDA", market: "sp500", name: "NVIDIA", ticker: "NVDA", news_query: "NVIDIA NVDA stock" },
  { id: "AMZN", market: "sp500", name: "Amazon", ticker: "AMZN", news_query: "Amazon AMZN stock" },
  { id: "META", market: "sp500", name: "Meta", ticker: "META", news_query: "Meta META stock" },
  { id: "GOOGL", market: "sp500", name: "Alphabet", ticker: "GOOGL", news_query: "Alphabet Google GOOGL stock" },
  { id: "AVGO", market: "sp500", name: "Broadcom", ticker: "AVGO", news_query: "Broadcom AVGO stock" },
  { id: "TSLA", market: "sp500", name: "Tesla", ticker: "TSLA", news_query: "Tesla TSLA stock" },
  { id: "BRK.B", market: "sp500", name: "Berkshire", ticker: "BRK.B", news_query: "Berkshire Hathaway stock" },
  { id: "JPM", market: "sp500", name: "JPMorgan", ticker: "JPM", news_query: "JPMorgan JPM stock" },
  { id: "LLY", market: "sp500", name: "Eli Lilly", ticker: "LLY", news_query: "Eli Lilly LLY stock" },
  { id: "UNH", market: "sp500", name: "UnitedHealth", ticker: "UNH", news_query: "UnitedHealth UNH stock" },
  { id: "XOM", market: "sp500", name: "Exxon", ticker: "XOM", news_query: "Exxon XOM stock" },
  { id: "V", market: "sp500", name: "Visa", ticker: "V", news_query: "Visa V stock earnings" },
  { id: "JNJ", market: "sp500", name: "J&J", ticker: "JNJ", news_query: "Johnson Johnson JNJ stock" },
  { id: "WMT", market: "sp500", name: "Walmart", ticker: "WMT", news_query: "Walmart WMT stock" },
  { id: "MA", market: "sp500", name: "Mastercard", ticker: "MA", news_query: "Mastercard MA stock" },
  { id: "PG", market: "sp500", name: "P&G", ticker: "PG", news_query: "Procter Gamble PG stock" },
  { id: "HD", market: "sp500", name: "Home Depot", ticker: "HD", news_query: "Home Depot HD stock" },
  { id: "COST", market: "sp500", name: "Costco", ticker: "COST", news_query: "Costco COST stock" },
  { id: "NFLX", market: "sp500", name: "Netflix", ticker: "NFLX", news_query: "Netflix NFLX stock" },
  { id: "ORCL", market: "sp500", name: "Oracle", ticker: "ORCL", news_query: "Oracle ORCL stock" },
  { id: "BAC", market: "sp500", name: "Bank of America", ticker: "BAC", news_query: "Bank of America BAC stock" },
];

const POS_KO = [
  "호실적", "급등", "수주", "배당", "상향", "흑자", "확대", "신고가", "매수", "회복",
  "최대실적", "깜짝실적", "공급계약", "독점", "자사주", "상승", "반등", "호조", "개선",
];
const NEG_KO = [
  "적자", "급락", "하향", "리콜", "횡령", "적발", "감산", "하회", "매도", "손실",
  "적자전환", "영업정지", "과징금", "하락", "우려", "부진", "축소", "파업", "리콜",
];
const POS_EN = [
  "beat", "surge", "upgrade", "buy", "record", "raises", "guidance up", "outperform",
  "rally", "dividend", "buyback", "growth", "strong", "profit",
];
const NEG_EN = [
  "miss", "plunge", "downgrade", "sell", "cut", "guidance down", "underperform",
  "lawsuit", "probe", "layoff", "loss", "weak", "fraud", "recall",
];
const CALL_KEYS = [
  "컨퍼런스콜", "컨콜", "실적발표", "가이던스", "earnings call", "conference call",
  "guidance", "transcript", "analyst day",
];
const DART_EVENT_KEYS = [
  "실적", "배당", "유상증자", "자기주식", "최대주주", "합병", "영업정지", "횡령",
  "조회공시", "공급계약", "단일판매", "투자판단", "소송", "배임", "감사보고서",
];

function clip(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function nlpTone(score: number): NlpTone {
  if (score >= 12) return "bull";
  if (score <= -12) return "bear";
  return "flat";
}

export function scoreText(text: string): { score: number; matched: string[] } {
  const raw = text.toLowerCase();
  const matched: string[] = [];
  let pos = 0;
  let neg = 0;
  for (const w of POS_KO) {
    if (text.includes(w)) {
      pos += 1;
      matched.push(w);
    }
  }
  for (const w of NEG_KO) {
    if (text.includes(w)) {
      neg += 1;
      matched.push(w);
    }
  }
  for (const w of POS_EN) {
    if (raw.includes(w)) {
      pos += 1;
      matched.push(w);
    }
  }
  for (const w of NEG_EN) {
    if (raw.includes(w)) {
      neg += 1;
      matched.push(w);
    }
  }
  const denom = pos + neg;
  const score = denom ? clip(((pos - neg) / denom) * 100, -100, 100) : 0;
  return { score, matched: [...new Set(matched)].slice(0, 6) };
}

export function isCallHeadline(text: string): boolean {
  const raw = text.toLowerCase();
  return CALL_KEYS.some((k) => text.includes(k) || raw.includes(k.toLowerCase()));
}

export function isDartEvent(reportNm: string): string[] {
  return DART_EVENT_KEYS.filter((k) => reportNm.includes(k));
}

export function matchUniverse(text: string, extra?: { stock_code?: string; ticker?: string }): NlpName[] {
  const hits: NlpName[] = [];
  const upper = text.toUpperCase();
  for (const name of NLP_UNIVERSE) {
    if (name.stock_code && extra?.stock_code && extra.stock_code === name.stock_code) {
      hits.push(name);
      continue;
    }
    if (extra?.ticker && extra.ticker.toUpperCase() === name.ticker.toUpperCase()) {
      hits.push(name);
      continue;
    }
    if (text.includes(name.name) || (name.name_en && text.includes(name.name_en))) {
      hits.push(name);
      continue;
    }
    const t = name.ticker.replace(".KS", "");
    if (t.length >= 2 && new RegExp(`\\b${t.replace(".", "\\.")}\\b`, "i").test(upper)) {
      hits.push(name);
    }
  }
  return hits;
}

export function emptyMarket(market: NlpMarket): NlpMarketPulse {
  return {
    market,
    label: market === "kospi200" ? "KOSPI 200" : "S&P 500",
    score: 0,
    tone: "flat",
    news_n: 0,
    event_n: 0,
    bull_n: 0,
    bear_n: 0,
    names: [],
  };
}

export function buildMarketPulse(
  market: NlpMarket,
  cards: NlpNameCard[],
  headlines: NlpHeadline[],
): NlpMarketPulse {
  const mine = cards.filter((c) => c.market === market);
  const news = headlines.filter((h) => h.market === market && h.kind === "news");
  const events = headlines.filter(
    (h) => h.market === market && (h.kind === "dart" || h.kind === "sec"),
  );
  let wsum = 0;
  let w = 0;
  for (const c of mine) {
    const wt = 1 + Math.log1p(c.news_n);
    wsum += c.score * wt;
    w += wt;
  }
  const score = w ? clip(wsum / w, -100, 100) : 0;
  return {
    market,
    label: market === "kospi200" ? "KOSPI 200" : "S&P 500",
    score,
    tone: nlpTone(score),
    news_n: news.length,
    event_n: events.length,
    bull_n: mine.filter((c) => c.tone === "bull").length,
    bear_n: mine.filter((c) => c.tone === "bear").length,
    names: [...mine].sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || b.news_n - a.news_n),
  };
}

export function assembleNameCards(
  headlines: NlpHeadline[],
): NlpNameCard[] {
  const byId = new Map<string, NlpHeadline[]>();
  for (const h of headlines) {
    const list = byId.get(h.name_id) || [];
    list.push(h);
    byId.set(h.name_id, list);
  }
  const cards: NlpNameCard[] = [];
  for (const spec of NLP_UNIVERSE) {
    const rows = byId.get(spec.id) || [];
    const news = rows.filter((r) => r.kind === "news");
    const events = rows.filter((r) => r.kind === "dart" || r.kind === "sec");
    const calls = rows.filter((r) => r.kind === "call");
    let wsum = 0;
    let w = 0;
    for (const r of news) {
      wsum += r.score;
      w += 1;
    }
    const score = w ? clip(wsum / w, -100, 100) : 0;
    const top = [...rows].sort(
      (a, b) => Math.abs(b.score) - Math.abs(a.score) || b.date.localeCompare(a.date),
    )[0];
    cards.push({
      id: spec.id,
      market: spec.market,
      name: spec.name,
      ticker: spec.ticker,
      score,
      tone: nlpTone(score),
      news_n: news.length,
      event_n: events.length,
      call_n: calls.length,
      top_title: top?.title || "최근 헤드라인 없음",
      top_url: top?.url,
    });
  }
  return cards;
}

export function emptyNlpPayload(error?: string): NlpPulsePayload {
  return {
    ok: !error,
    generated_at: new Date().toISOString(),
    lookback_days: NLP_LOOKBACK_DAYS,
    kospi: emptyMarket("kospi200"),
    spx: emptyMarket("sp500"),
    events: [],
    calls: [],
    feed: [],
    sources: [],
    note: NLP_SCHEDULE_NOTE,
    methodology: NLP_METHODOLOGY,
    disclaimer: NLP_DISCLAIMER,
    error,
  };
}
