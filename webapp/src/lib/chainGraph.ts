/**
 * Curated supply / customer / peer graph for the Chain + Ripple tabs.
 * Edges are public-knowledge seeds (10-K Item 1A phrasing, well-known
 * customers, KR 사업보고서 매출처 패턴) — not a live EDGAR extractor.
 */

export type ChainRel = "supply" | "peer" | "complement";

export type ChainMarket = "kr" | "us";

export type ChainNode = {
  id: string;
  name: string;
  short: string;
  ticker: string;
  market: ChainMarket;
  role: string;
  aliases: string[];
};

export type ChainEdge = {
  from: string;
  to: string;
  rel: ChainRel;
  note: string;
  source: string;
};

export type ChainCluster = {
  id: string;
  label: string;
  hub: string;
};

export type ChainQuote = {
  price: number | null;
  ret1d: number | null;
  ret5d: number | null;
};

export type ChainNodeView = ChainNode & ChainQuote;

export type ChainPayload = {
  ok: boolean;
  generated_at: string;
  comment: string;
  methodology: string[];
  disclaimer: string;
  clusters: ChainCluster[];
  nodes: ChainNodeView[];
  edges: ChainEdge[];
  errors: string[];
  error?: string;
};

export type LaidNode = ChainNodeView & {
  x: number;
  y: number;
  rank: number;
  hop: number;
};

export type LaidEdge = ChainEdge & {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type ChainLayout = {
  width: number;
  height: number;
  nodes: LaidNode[];
  edges: LaidEdge[];
};

export type RippleHit = {
  id: string;
  name: string;
  short: string;
  ticker: string;
  via: "mention" | ChainRel;
  note: string;
  ret1d: number | null;
};

export type RippleEvent = {
  id: string;
  date: string;
  title: string;
  source: string;
  url?: string;
  kind: string;
  score: number;
  origin_id: string;
  origin_name: string;
  hits: RippleHit[];
};

export const CHAIN_CLUSTERS: ChainCluster[] = [
  { id: "gpu", label: "GPU", hub: "NVDA" },
  { id: "memory", label: "메모리", hub: "000660" },
  { id: "battery", label: "배터리", hub: "373220" },
  { id: "auto", label: "자동차", hub: "005380" },
  { id: "cloud", label: "클라우드", hub: "MSFT" },
  { id: "krnet", label: "국내 인터넷", hub: "035420" },
  { id: "finance", label: "금융", hub: "JPM" },
];

export const CHAIN_METHODOLOGY: string[] = [
  "간선은 공개 공시·관용 서술로 고정한 시드입니다. 실시간 10-K 추출기가 아닙니다.",
  "supply: 공급 → 고객. peer: 동종. complement: 같은 밸류체인 보완.",
  "노드 색은 Yahoo 1일 등락. 2홉 이웃만 그립니다.",
  "Ripple은 NLP 헤드라인에서 종목명·티커·별칭을 찾고, 없으면 시드 1홉을 붙입니다.",
];

export const CHAIN_DISCLAIMER =
  "교육용 관계 지도입니다. 고객 비중·독점 공급을 보장하지 않으며 투자 자문이 아닙니다.";

const N = (
  id: string,
  name: string,
  short: string,
  ticker: string,
  market: ChainMarket,
  role: string,
  aliases: string[],
): ChainNode => ({ id, name, short, ticker, market, role, aliases });

export const CHAIN_NODES: ChainNode[] = [
  N("NVDA", "NVIDIA", "NVDA", "NVDA", "us", "GPU", ["NVIDIA", "NVDA", "엔비디아"]),
  N("TSM", "TSMC", "TSMC", "TSM", "us", "파운드리", ["TSMC", "TSM", "대만반도체", "Taiwan Semi"]),
  N("ASML", "ASML", "ASML", "ASML", "us", "노광장비", ["ASML"]),
  N("AMD", "AMD", "AMD", "AMD", "us", "GPU·CPU", ["AMD"]),
  N("AVGO", "Broadcom", "AVGO", "AVGO", "us", "커스텀칩", ["Broadcom", "AVGO"]),
  N("AMAT", "Applied Materials", "AMAT", "AMAT", "us", "전공정", ["Applied Materials", "AMAT"]),
  N("MU", "Micron", "MU", "MU", "us", "DRAM", ["Micron", "MU", "마이크론"]),
  N("INTC", "Intel", "INTC", "INTC", "us", "파운드리·CPU", ["Intel", "INTC", "인텔"]),
  N("QCOM", "Qualcomm", "QCOM", "QCOM", "us", "모바일 AP", ["Qualcomm", "QCOM"]),
  N("ARM", "Arm", "ARM", "ARM", "us", "IP", ["Arm", "ARM"]),
  N("MSFT", "Microsoft", "MSFT", "MSFT", "us", "클라우드", ["Microsoft", "MSFT", "마이크로소프트", "Azure"]),
  N("META", "Meta", "META", "META", "us", "클라우드 고객", ["Meta", "META", "Facebook"]),
  N("GOOGL", "Alphabet", "GOOGL", "GOOGL", "us", "클라우드 고객", ["Alphabet", "Google", "GOOGL", "구글"]),
  N("AMZN", "Amazon", "AMZN", "AMZN", "us", "클라우드 고객", ["Amazon", "AMZN", "AWS", "아마존"]),
  N("AAPL", "Apple", "AAPL", "AAPL", "us", "세트", ["Apple", "AAPL", "애플"]),
  N("ORCL", "Oracle", "ORCL", "ORCL", "us", "클라우드", ["Oracle", "ORCL"]),
  N("TSLA", "Tesla", "TSLA", "TSLA", "us", "완성차", ["Tesla", "TSLA", "테슬라"]),
  N("JPM", "JPMorgan", "JPM", "JPM", "us", "은행", ["JPMorgan", "JPM"]),
  N("BAC", "Bank of America", "BAC", "BAC", "us", "은행", ["Bank of America", "BAC"]),
  N("V", "Visa", "V", "V", "us", "결제", ["Visa"]),
  N("MA", "Mastercard", "MA", "MA", "us", "결제", ["Mastercard", "MA"]),
  N("WMT", "Walmart", "WMT", "WMT", "us", "유통", ["Walmart", "WMT"]),
  N("COST", "Costco", "COST", "COST", "us", "유통", ["Costco", "COST"]),
  N("LLY", "Eli Lilly", "LLY", "LLY", "us", "제약", ["Eli Lilly", "Lilly", "LLY"]),
  N("JNJ", "J&J", "JNJ", "JNJ", "us", "헬스케어", ["Johnson", "JNJ"]),
  N("005930", "삼성전자", "삼성전자", "005930.KS", "kr", "메모리·파운드리", ["삼성전자", "Samsung"]),
  N("000660", "SK하이닉스", "하이닉스", "000660.KS", "kr", "HBM", ["SK하이닉스", "하이닉스", "HBM"]),
  N("373220", "LG에너지솔루션", "LG엔솔", "373220.KS", "kr", "배터리", ["LG에너지솔루션", "LG엔솔", "LGES"]),
  N("006400", "삼성SDI", "SDI", "006400.KS", "kr", "배터리", ["삼성SDI", "SDI"]),
  N("003670", "포스코퓨처엠", "퓨처엠", "003670.KS", "kr", "양극재", ["포스코퓨처엠", "퓨처엠"]),
  N("051910", "LG화학", "LG화학", "051910.KS", "kr", "소재", ["LG화학"]),
  N("005490", "POSCO홀딩스", "POSCO", "005490.KS", "kr", "철강·소재", ["POSCO홀딩스", "포스코홀딩스", "포스코"]),
  N("005380", "현대차", "현대차", "005380.KS", "kr", "완성차", ["현대차", "현대자동차"]),
  N("000270", "기아", "기아", "000270.KS", "kr", "완성차", ["기아"]),
  N("012330", "현대모비스", "모비스", "012330.KS", "kr", "부품", ["현대모비스", "모비스"]),
  N("035420", "NAVER", "NAVER", "035420.KS", "kr", "플랫폼", ["NAVER", "네이버"]),
  N("035720", "카카오", "카카오", "035720.KS", "kr", "플랫폼", ["카카오"]),
  N("105560", "KB금융", "KB", "105560.KS", "kr", "은행", ["KB금융", "KB"]),
  N("055550", "신한지주", "신한", "055550.KS", "kr", "은행", ["신한지주", "신한"]),
  N("207940", "삼성바이오로직스", "삼바", "207940.KS", "kr", "바이오", ["삼성바이오로직스", "삼바"]),
  N("068270", "셀트리온", "셀트리온", "068270.KS", "kr", "바이오", ["셀트리온"]),
  N("028260", "삼성물산", "삼성물산", "028260.KS", "kr", "그룹", ["삼성물산"]),
];

const E = (
  from: string,
  to: string,
  rel: ChainRel,
  note: string,
  source: string,
): ChainEdge => ({ from, to, rel, note, source });

export const CHAIN_EDGES: ChainEdge[] = [
  E("ASML", "TSM", "supply", "노광 장비 → 선단 파운드리", "공개 공급 관계"),
  E("ASML", "005930", "supply", "노광 장비 → 삼성 파운드리", "공개 공급 관계"),
  E("AMAT", "TSM", "supply", "전공정 장비 → 파운드리", "공개 공급 관계"),
  E("AMAT", "005930", "supply", "전공정 장비 → 삼성", "공개 공급 관계"),
  E("ARM", "QCOM", "supply", "아키텍처 IP → 모바일 AP", "라이선스 관용 서술"),
  E("ARM", "NVDA", "complement", "CPU IP와 GPU 동반 설계", "공개 파트너십 서술"),
  E("TSM", "NVDA", "supply", "GPU 웨이퍼 위탁생산 (sole-source 서술)", "NVIDIA 10-K Item 1A 관용 문구"),
  E("TSM", "AVGO", "supply", "커스텀 ASIC 파운드리", "공개 고객 서술"),
  E("TSM", "AAPL", "supply", "애플리케이션 프로세서 위탁", "공개 고객 서술"),
  E("TSM", "AMD", "supply", "CPU·GPU 위탁생산", "공개 고객 서술"),
  E("TSM", "QCOM", "supply", "모바일 칩 위탁", "공개 고객 서술"),
  E("000660", "NVDA", "supply", "HBM → 데이터센터 GPU", "실적 콜·고객 공시 관용 서술"),
  E("005930", "NVDA", "supply", "HBM·파운드리 후보 공급", "공개 경쟁·공급 서술"),
  E("MU", "NVDA", "supply", "HBM·DRAM 공급 후보", "공개 공급 서술"),
  E("005930", "AAPL", "supply", "모바일 메모리·AP 공급", "사업보고서 매출처 패턴"),
  E("NVDA", "MSFT", "supply", "GPU → Azure", "클라우드 GPU 수요 서술"),
  E("NVDA", "META", "supply", "GPU → 학습·추천 인프라", "캡엑스 공시 관용 서술"),
  E("NVDA", "GOOGL", "supply", "GPU → GCP·검색 학습", "클라우드 GPU 수요 서술"),
  E("NVDA", "AMZN", "supply", "GPU → AWS", "클라우드 GPU 수요 서술"),
  E("NVDA", "ORCL", "supply", "GPU 클라우드", "공개 클라우드 계약 서술"),
  E("AVGO", "MSFT", "supply", "커스텀 가속기·네트워킹", "공개 고객 서술"),
  E("AVGO", "GOOGL", "supply", "커스텀 실리콘·네트워킹", "공개 고객 서술"),
  E("NVDA", "AMD", "peer", "데이터센터 가속기 경쟁", "동종"),
  E("NVDA", "AVGO", "peer", "커스텀 가속기 경쟁·보완", "동종"),
  E("005930", "000660", "peer", "메모리 경쟁", "동종"),
  E("005930", "TSM", "peer", "파운드리 경쟁", "동종"),
  E("005930", "INTC", "peer", "파운드리·CPU 경쟁", "동종"),
  E("TSM", "INTC", "peer", "파운드리 경쟁", "동종"),
  E("AMD", "INTC", "peer", "CPU 경쟁", "동종"),
  E("MSFT", "GOOGL", "peer", "클라우드 경쟁", "동종"),
  E("MSFT", "AMZN", "peer", "클라우드 경쟁", "동종"),
  E("MSFT", "ORCL", "peer", "클라우드 경쟁", "동종"),
  E("GOOGL", "META", "peer", "광고 플랫폼 경쟁", "동종"),
  E("AAPL", "GOOGL", "peer", "모바일 플랫폼 경쟁", "동종"),
  E("003670", "373220", "supply", "양극재 → 셀", "국내 소재·셀 밸류체인"),
  E("003670", "006400", "supply", "양극재 → 셀", "국내 소재·셀 밸류체인"),
  E("051910", "373220", "supply", "소재·분리막 계열 → 셀", "그룹 밸류체인"),
  E("005490", "003670", "complement", "지주 → 양극재 자회사", "그룹"),
  E("373220", "TSLA", "supply", "전기차 배터리 공급", "공개 고객 서술"),
  E("006400", "005380", "supply", "배터리 → 현대차그룹", "국내 납품 서술"),
  E("373220", "005380", "supply", "배터리 → 현대차그룹", "국내 납품 서술"),
  E("006400", "000270", "supply", "배터리 → 기아", "국내 납품 서술"),
  E("012330", "005380", "supply", "모듈·전장 → 현대차", "그룹 납품"),
  E("012330", "000270", "supply", "모듈·전장 → 기아", "그룹 납품"),
  E("005380", "000270", "peer", "현대차그룹 완성차", "동종"),
  E("373220", "006400", "peer", "국내 배터리 경쟁", "동종"),
  E("035420", "035720", "peer", "국내 인터넷 플랫폼", "동종"),
  E("JPM", "BAC", "peer", "미국 은행", "동종"),
  E("V", "MA", "peer", "카드 네트워크", "동종"),
  E("WMT", "COST", "peer", "미국 유통", "동종"),
  E("LLY", "JNJ", "peer", "헬스케어", "동종"),
  E("207940", "068270", "peer", "국내 바이오", "동종"),
  E("105560", "055550", "peer", "국내 은행지주", "동종"),
  E("028260", "005930", "complement", "삼성 그룹 지주 역할", "그룹"),
];

const NODE_MAP = new Map(CHAIN_NODES.map((n) => [n.id, n]));

export function chainNode(id: string): ChainNode | undefined {
  return NODE_MAP.get(id);
}

export function emptyChainPayload(error?: string): ChainPayload {
  return {
    ok: false,
    generated_at: new Date().toISOString(),
    comment: "",
    methodology: CHAIN_METHODOLOGY,
    disclaimer: CHAIN_DISCLAIMER,
    clusters: CHAIN_CLUSTERS,
    nodes: CHAIN_NODES.map((n) => ({ ...n, price: null, ret1d: null, ret5d: null })),
    edges: CHAIN_EDGES,
    errors: error ? [error] : [],
    error,
  };
}

function directedAdj(relOk: (rel: ChainRel) => boolean): {
  fwd: Map<string, string[]>;
  rev: Map<string, string[]>;
} {
  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const arr = m.get(k) || [];
    if (!arr.includes(v)) arr.push(v);
    m.set(k, arr);
  };
  for (const e of CHAIN_EDGES) {
    if (!relOk(e.rel)) continue;
    push(fwd, e.from, e.to);
    push(rev, e.to, e.from);
  }
  return { fwd, rev };
}

const FLOW = directedAdj((r) => r === "supply");
const PEERS = directedAdj((r) => r === "peer");
const COMPLEMENT = directedAdj((r) => r === "complement");

function bfs(start: string, adj: Map<string, string[]>, hops: number): Map<string, number> {
  const dist = new Map<string, number>([[start, 0]]);
  const q = [start];
  while (q.length) {
    const cur = q.shift()!;
    const d = dist.get(cur) || 0;
    if (d >= hops) continue;
    for (const nxt of adj.get(cur) || []) {
      if (dist.has(nxt)) continue;
      dist.set(nxt, d + 1);
      q.push(nxt);
    }
  }
  return dist;
}

export function neighborhoodIds(focusId: string, hops = 2): Map<string, number> {
  const up = bfs(focusId, FLOW.rev, hops);
  const down = bfs(focusId, FLOW.fwd, hops);
  const hop = new Map<string, number>();
  for (const [id, d] of up) hop.set(id, Math.min(hop.get(id) ?? 99, d));
  for (const [id, d] of down) hop.set(id, Math.min(hop.get(id) ?? 99, d));
  for (const peer of PEERS.fwd.get(focusId) || []) {
    hop.set(peer, Math.min(hop.get(peer) ?? 99, 1));
  }
  for (const peer of PEERS.rev.get(focusId) || []) {
    hop.set(peer, Math.min(hop.get(peer) ?? 99, 1));
  }
  for (const id of COMPLEMENT.fwd.get(focusId) || []) {
    hop.set(id, Math.min(hop.get(id) ?? 99, 1));
  }
  for (const id of COMPLEMENT.rev.get(focusId) || []) {
    hop.set(id, Math.min(hop.get(id) ?? 99, 1));
  }
  hop.set(focusId, 0);
  return hop;
}

export function layoutNeighborhood(
  focusId: string,
  nodes: ChainNodeView[],
  hops = 2,
): ChainLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hopsMap = neighborhoodIds(focusId, hops);
  const ids = [...hopsMap.keys()].filter((id) => byId.has(id));
  const up = bfs(focusId, FLOW.rev, hops);
  const down = bfs(focusId, FLOW.fwd, hops);

  const rankOf = (id: string): number => {
    if (id === focusId) return 0;
    const u = up.get(id);
    const d = down.get(id);
    if (u && (!d || u <= d)) return -u;
    if (d) return d;
    return 0;
  };

  const grouped = new Map<number, string[]>();
  for (const id of ids) {
    const r = rankOf(id);
    const arr = grouped.get(r) || [];
    arr.push(id);
    grouped.set(r, arr);
  }
  const ranks = [...grouped.keys()].sort((a, b) => a - b);
  const nodeW = 128;
  const nodeH = 52;
  const rankGap = 168;
  const rowGap = 14;
  const padX = 28;
  const padY = 20;

  const maxRows = Math.max(1, ...ranks.map((r) => grouped.get(r)!.length));
  const height = padY * 2 + maxRows * nodeH + (maxRows - 1) * rowGap;
  const width = padX * 2 + Math.max(1, ranks.length) * nodeW + Math.max(0, ranks.length - 1) * (rankGap - nodeW);

  const placed: LaidNode[] = [];
  ranks.forEach((rank, col) => {
    const colIds = grouped.get(rank)!.slice().sort((a, b) => {
      if (a === focusId) return -1;
      if (b === focusId) return 1;
      return (byId.get(a)?.short || a).localeCompare(byId.get(b)?.short || b, "ko");
    });
    const colH = colIds.length * nodeH + (colIds.length - 1) * rowGap;
    const y0 = padY + (height - padY * 2 - colH) / 2;
    colIds.forEach((id, i) => {
      const n = byId.get(id)!;
      placed.push({
        ...n,
        x: padX + col * rankGap,
        y: y0 + i * (nodeH + rowGap),
        rank,
        hop: hopsMap.get(id) ?? 0,
      });
    });
  });

  const pos = new Map(placed.map((n) => [n.id, n]));
  const links: LaidEdge[] = [];
  const idSet = new Set(ids);
  for (const e of CHAIN_EDGES) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    links.push({
      ...e,
      x1: a.x + nodeW,
      y1: a.y + nodeH / 2,
      x2: b.x,
      y2: b.y + nodeH / 2,
    });
  }

  return { width: Math.max(width, 320), height: Math.max(height, 200), nodes: placed, edges: links };
}

export function chainComment(nodes: ChainNodeView[]): string {
  const ranked = nodes
    .filter((n) => n.ret1d != null)
    .slice()
    .sort((a, b) => Math.abs(b.ret1d || 0) - Math.abs(a.ret1d || 0));
  const top = ranked[0];
  if (!top || top.ret1d == null) {
    return "시세가 비어 관계 지도만 표시합니다. 노드는 클릭하면 상·하류가 바뀝니다.";
  }
  const sign = top.ret1d > 0 ? "+" : "";
  return `오늘 시드 그래프에서 1일 등락이 가장 큰 노드는 ${top.name} ${sign}${top.ret1d.toFixed(1)}%입니다. 포커스를 옮기면 공급·고객 2홉이 다시 그려집니다.`;
}

export function matchChainMentions(text: string): ChainNode[] {
  const hits: ChainNode[] = [];
  const upper = text.toUpperCase();
  for (const node of CHAIN_NODES) {
    let ok = false;
    for (const alias of node.aliases) {
      if (alias.length >= 2 && text.includes(alias)) {
        ok = true;
        break;
      }
      if (alias.length >= 2 && alias === alias.toUpperCase() && new RegExp(`\\b${alias}\\b`, "i").test(upper)) {
        ok = true;
        break;
      }
    }
    const t = node.ticker.replace(".KS", "");
    if (!ok && t.length >= 2 && new RegExp(`\\b${t.replace(".", "\\.")}\\b`, "i").test(upper)) ok = true;
    if (ok) hits.push(node);
  }
  return hits;
}

function edgeBetween(a: string, b: string): ChainEdge | undefined {
  return CHAIN_EDGES.find(
    (e) => (e.from === a && e.to === b) || (e.from === b && e.to === a),
  );
}

export function rippleHitsFor(
  originId: string,
  title: string,
  quotes: Map<string, ChainQuote>,
  limit = 7,
): RippleHit[] {
  const seen = new Set<string>();
  const out: RippleHit[] = [];
  const push = (node: ChainNode, via: RippleHit["via"], note: string) => {
    if (node.id === originId || seen.has(node.id)) return;
    seen.add(node.id);
    const q = quotes.get(node.id);
    out.push({
      id: node.id,
      name: node.name,
      short: node.short,
      ticker: node.ticker,
      via,
      note,
      ret1d: q?.ret1d ?? null,
    });
  };

  for (const node of matchChainMentions(title)) push(node, "mention", "헤드라인에 이름이 나옴");

  const hop1 = neighborhoodIds(originId, 1);
  for (const id of hop1.keys()) {
    if (out.length >= limit) break;
    const node = NODE_MAP.get(id);
    if (!node) continue;
    const e = edgeBetween(originId, id);
    push(node, e?.rel || "peer", e?.note || "시드 1홉");
  }

  return out.slice(0, limit);
}

export function retTone(n: number | null | undefined): "up" | "down" | "flat" {
  if (n == null || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}
