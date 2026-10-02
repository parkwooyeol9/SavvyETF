"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  fmtPct,
  fmtPrice,
  fmtShares,
  fmtUsdShort,
  roleKo,
  txLabel,
  type Insider13FMap,
  type InsiderCluster,
  type InsiderLookup,
  type InsiderNetRow,
  type InsiderPriced,
  type InsiderSpotlight,
  type InsiderSpotlightItem,
  type InsiderSummary,
  type InsiderTx,
} from "@/lib/insiderTrading";

type View = "clusters" | "top" | "csuite" | "netbuy" | "netsell" | "buys" | "sells";

const VIEWS: Array<[View, string, string]> = [
  [
    "clusters",
    "클러스터 매수",
    "최근 14일 동안 같은 회사 내부자 2명 이상이 장내에서 자기 돈으로 산 종목입니다. 여러 명이 동시에 사는 건 단독 매수보다 신호가 강하다고 알려져 있습니다.",
  ],
  ["top", "대형 매수", "최근 7일 장내 매수를 금액 순으로 정렬합니다. 한 공시의 분할 체결은 하나로 합쳤습니다."],
  [
    "csuite",
    "CEO·CFO 매수",
    "CEO·CFO·COO·회장·사장의 최근 30일 장내 매수입니다. 회사 사정을 가장 잘 아는 경영진의 매수입니다.",
  ],
  ["netbuy", "순매수 종목", "최근 30일 내부자 장내 매수액에서 매도액을 뺀 값이 큰 종목입니다."],
  [
    "netsell",
    "순매도 종목",
    "최근 30일 순매도가 큰 종목입니다. 매도는 세금·분산 등 이유가 다양해 매수보다 신호가 약하고, 10b5-1 계획 매도는 미리 정해 둔 일정에 따른 매도입니다.",
  ],
  ["buys", "최신 매수", "가장 최근에 공시된 장내 매수 100건입니다."],
  ["sells", "최신 매도", "가장 최근에 공시된 장내 매도 100건입니다."],
];

function retClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return v > 0 ? "up" : v < 0 ? "down" : "";
}

function filedLabel(t: InsiderTx): string {
  return `${t.filed.slice(5)}${t.filed_time ? ` ${t.filed_time}` : ""}`;
}

function OwnChange({ t }: { t: InsiderTx }) {
  if (t.acquired && t.owned_after != null && Math.abs(t.owned_after - t.shares) < 1) {
    return <span className="tf-tag">신규</span>;
  }
  if (t.own_chg_pct == null) return <>—</>;
  return <>{fmtPct(t.acquired ? t.own_chg_pct : -t.own_chg_pct, 0)}</>;
}

/** 13F holders per ticker, filled after the summary loads (badge is omitted until then). */
const Holders13F = createContext<Insider13FMap>({});

function ThirteenFBadge({ ticker }: { ticker: string }) {
  const list = useContext(Holders13F)[ticker];
  if (!list?.length) return null;
  const names = list
    .slice(0, 8)
    .map((h) => `${h.name_ko} ${h.weight_pct.toFixed(1)}%`)
    .join(", ");
  return (
    <span className="tf-tag ins-13f" title={`13F 보유: ${names}${list.length > 8 ? " 외" : ""}`}>
      13F {list.length}
    </span>
  );
}

function Ticker({ t, onPick }: { t: { ticker: string; issuer: string }; onPick: (t: string) => void }) {
  return (
    <span className="tf-sec">
      <span>
        <button type="button" className="tf-link tf-ticker" onClick={() => onPick(t.ticker)}>
          {t.ticker}
        </button>
        <ThirteenFBadge ticker={t.ticker} />
      </span>
      <span className="tf-sec-name ins-issuer">{t.issuer}</span>
    </span>
  );
}

function Dd52({ v }: { v: number | null | undefined }) {
  if (v == null || !Number.isFinite(v)) return <>—</>;
  return <span className={v <= -30 ? "ins-deep" : ""}>{fmtPct(v, 0)}</span>;
}

function TxTable({
  rows,
  onPick,
  showReturn,
  showFiled = true,
}: {
  rows: Array<InsiderTx | InsiderPriced>;
  onPick: (t: string) => void;
  showReturn?: boolean;
  showFiled?: boolean;
}) {
  if (!rows.length) return <p className="empty">해당 거래가 없습니다.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table tf-table ins-table">
        <thead>
          <tr>
            {showFiled ? <th>공시(ET)</th> : null}
            <th>종목</th>
            <th>내부자</th>
            <th>거래일</th>
            <th>구분</th>
            <th className="num">단가</th>
            <th className="num">수량</th>
            <th className="num">금액</th>
            <th className="num" title="거래 전 보유 주식 대비 이번 거래 주식 수">
              지분 변화
            </th>
            {showReturn ? <th className="num">현재가 · 수익률</th> : null}
            {showReturn ? (
              <th className="num" title="현재가가 52주 최고가보다 몇 % 아래인지">
                52주 고점 대비
              </th>
            ) : null}
            <th>원문</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const priced = t as InsiderPriced;
            return (
              <tr key={t.id}>
                {showFiled ? <td className="meta-soft">{filedLabel(t)}</td> : null}
                <td>
                  <Ticker t={t} onPick={onPick} />
                </td>
                <td>
                  <b>{t.owner}</b>
                  <div className="meta-soft">
                    {roleKo(t)}
                    {t.c_suite ? <span className="tf-tag ins-csuite">경영진</span> : null}
                    {!t.direct ? <span className="tf-tag">간접</span> : null}
                  </div>
                </td>
                <td>{t.date.slice(5)}</td>
                <td>
                  <span className={t.code === "P" ? "up" : t.code === "S" ? "down" : ""}>
                    {txLabel(t.code)}
                  </span>
                  {t.plan_10b5_1 ? <span className="tf-tag">10b5-1</span> : null}
                </td>
                <td className="num">{fmtPrice(t.price)}</td>
                <td className="num">{fmtShares(t.shares)}</td>
                <td className="num">
                  <b>{fmtUsdShort(t.value)}</b>
                </td>
                <td className="num">
                  <OwnChange t={t} />
                </td>
                {showReturn ? (
                  <td className={`num ${retClass(priced.ret_pct)}`}>
                    {fmtPrice(priced.last_price)} · {fmtPct(priced.ret_pct)}
                  </td>
                ) : null}
                {showReturn ? (
                  <td className="num">
                    <Dd52 v={priced.dd_52w_pct} />
                  </td>
                ) : null}
                <td>
                  <a href={t.url} target="_blank" rel="noreferrer">
                    SEC
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClusterTable({ rows, onPick }: { rows: InsiderCluster[]; onPick: (t: string) => void }) {
  if (!rows.length) return <p className="empty">최근 14일 클러스터 매수가 아직 없습니다.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table tf-table ins-table">
        <thead>
          <tr>
            <th>종목</th>
            <th className="num">내부자</th>
            <th className="num">매수 총액</th>
            <th className="num">평균 매수가</th>
            <th className="num">현재가 · 수익률</th>
            <th className="num" title="현재가가 52주 최고가보다 몇 % 아래인지">
              52주 고점 대비
            </th>
            <th>거래일</th>
            <th>참여 내부자</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.ticker}>
              <td>
                <Ticker t={c} onPick={onPick} />
              </td>
              <td className="num">
                <b>{c.n_insiders}명</b>
                {c.has_c_suite ? <div className="tf-tag ins-csuite">경영진 포함</div> : null}
              </td>
              <td className="num">
                <b>{fmtUsdShort(c.total_value)}</b>
              </td>
              <td className="num">{fmtPrice(c.avg_price)}</td>
              <td className={`num ${retClass(c.ret_pct)}`}>
                {fmtPrice(c.last_price)} · {fmtPct(c.ret_pct)}
              </td>
              <td className="num">
                <Dd52 v={c.dd_52w_pct} />
              </td>
              <td>
                {c.first_date.slice(5)}
                {c.last_date !== c.first_date ? ` ~ ${c.last_date.slice(5)}` : ""}
              </td>
              <td className="ins-people">
                {c.insiders.slice(0, 4).map((p) => (
                  <div key={`${p.owner}-${p.date}`}>
                    {p.owner} <span className="meta-soft">· {p.role} · {fmtUsdShort(p.value)}</span>
                  </div>
                ))}
                {c.insiders.length > 4 ? (
                  <div className="meta-soft">외 {c.insiders.length - 4}명</div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NetTable({
  rows,
  onPick,
  sell,
}: {
  rows: InsiderNetRow[];
  onPick: (t: string) => void;
  sell?: boolean;
}) {
  if (!rows.length) return <p className="empty">해당 종목이 없습니다.</p>;
  return (
    <div className="table-wrap">
      <table className="data-table tf-table ins-table">
        <thead>
          <tr>
            <th>종목</th>
            <th className="num">{sell ? "순매도액" : "순매수액"}</th>
            <th className="num">매수액 (매수자)</th>
            <th className="num">매도액 (매도자)</th>
            <th className="num" title="10b5-1 계획 매도를 뺀 매도액">
              재량 매도액
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ticker}>
              <td>
                <Ticker t={r} onPick={onPick} />
              </td>
              <td className={`num ${sell ? "down" : "up"}`}>
                <b>{fmtUsdShort(Math.abs(r.net_value))}</b>
              </td>
              <td className="num">
                {fmtUsdShort(r.buy_value)} ({r.buyers})
              </td>
              <td className="num">
                {fmtUsdShort(r.sell_value)} ({r.sellers})
              </td>
              <td className="num">{fmtUsdShort(r.sell_value_discretionary)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SentimentChart({ days }: { days: InsiderSummary["sentiment"]["days"] }) {
  const max = Math.max(1, ...days.map((d) => Math.max(d.buyers, d.sellers)));
  if (!days.length) return null;
  return (
    <div className="ins-chart" role="img" aria-label="일별 매수·매도 내부자 수">
      {days.map((d) => (
        <div
          key={d.date}
          className="ins-chart-col"
          title={`${d.date} · 매수 ${d.buyers}명 · 매도 ${d.sellers}명 (재량 ${d.sellers_discretionary}명)`}
        >
          <span className="ins-bar ins-buy" style={{ height: `${(d.buyers / max) * 100}%` }} />
          <span className="ins-bar ins-sell" style={{ height: `${(d.sellers / max) * 100}%` }} />
          <em>{d.date.slice(8)}</em>
        </div>
      ))}
    </div>
  );
}

const SIDE_LABEL: Record<InsiderSpotlightItem["side"], string> = {
  buy: "매수",
  sell: "매도",
  mixed: "매수·매도",
};

function newsDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

function SpotlightPanel({
  data,
  error,
  active,
  onPick,
}: {
  data: InsiderSpotlight | null;
  error: string | null;
  active: string | null;
  onPick: (t: string) => void;
}) {
  const current = data?.items.find((it) => it.ticker === active) || null;
  return (
    <section className="geo-section" style={{ marginTop: 16 }}>
      <h3 className="geo-section-title">최근 뉴스로 본 주목할 내부자 거래</h3>
      <p className="meta-soft">
        최근 7일 Google News 헤드라인
        {data?.headlines ? ` ${data.headlines.toLocaleString()}건` : ""}에서 내부자 거래 종목을 뽑아, 최근 14일 SEC
        Form 4 공시가 실제로 있는 종목만 남겼습니다. 매수·경영진·금액·여러 명 동시 매수에 가중치를 둡니다. 카드를
        누르면 그 종목의 1년 Form 4 이력을 아래에 띄웁니다.
      </p>
      {error ? <p className="empty">{error}</p> : null}
      {!data && !error ? <p className="empty">뉴스에서 주목 종목을 찾는 중…</p> : null}
      {data && !data.items.length ? (
        <p className="empty">{data.error || "최근 7일 뉴스에서 확인된 내부자 거래 종목이 없습니다."}</p>
      ) : null}
      {data?.items.length ? (
        <div className="ins-spot-grid">
          {data.items.map((it) => (
            <button
              key={it.ticker}
              type="button"
              className={`ins-spot${it.ticker === active ? " on" : ""}`}
              onClick={() => onPick(it.ticker)}
            >
              <span className="ins-spot-head">
                <b>{it.ticker}</b>
                <span className={`tf-tag ins-side-${it.side}`}>{SIDE_LABEL[it.side]}</span>
                <ThirteenFBadge ticker={it.ticker} />
              </span>
              <span className="ins-spot-issuer">{it.issuer}</span>
              <span className="ins-spot-title">{it.news[0]?.title}</span>
              <span className="ins-spot-tags">
                {it.c_suite ? <span className="tf-tag ins-csuite">경영진</span> : null}
                {it.multi_insider || (it.in_cluster ?? 0) >= 2 ? (
                  <span className="tf-tag">{it.in_cluster ? `클러스터 ${it.in_cluster}명` : "여러 명"}</span>
                ) : null}
                {it.max_amount && it.max_amount >= 10_000 ? (
                  <span className="tf-tag">{fmtUsdShort(it.max_amount)}</span>
                ) : null}
              </span>
              <span className="ins-spot-meta">
                {it.news[0]?.source} · {newsDate(it.news[0]?.published ?? null)} · 기사 {it.news_count}건 · Form 4{" "}
                {it.form4_14d}건
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {current ? (
        <div className="ins-spot-news">
          <b>{current.ticker} 관련 뉴스</b>
          <ul>
            {current.news.map((n) => (
              <li key={n.url || n.title}>
                <a href={n.url} target="_blank" rel="noreferrer">
                  {n.title}
                </a>{" "}
                <span className="meta-soft">
                  — {n.source} · {newsDate(n.published)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function LookupPanel({
  data,
  onPick,
  onClose,
}: {
  data: InsiderLookup;
  onPick: (t: string) => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState(false);
  const rows = all ? data.rows : data.rows.filter((r) => r.code === "P" || r.code === "S");
  return (
    <section className="geo-section" style={{ marginTop: 16 }}>
      <div className="tf-detail-head">
        <div>
          <h3 className="tf-title">
            {data.ticker} <span className="tf-sub">{data.issuer}</span>
          </h3>
          <p className="meta-soft">
            {data.truncated && data.covered_from
              ? `최근 Form 4 ${data.filings}건 (${data.covered_from} 이후 — 공시가 많아 최근 ${data.filings}건만 읽음)`
              : `${data.from} 이후 Form 4 ${data.filings}건`}
            {data.failed ? ` · 읽기 실패 ${data.failed}건` : ""} · 현재가 {fmtPrice(data.last_price)}
          </p>
        </div>
        <button type="button" className="ghost-btn" onClick={onClose}>
          닫기
        </button>
      </div>
      <div className="tf-stats">
        <div>
          <b className="up">{fmtUsdShort(data.totals.buy_value)}</b>
          <span>장내 매수 · {data.totals.buyers}명</span>
        </div>
        <div>
          <b className="down">{fmtUsdShort(data.totals.sell_value)}</b>
          <span>장내 매도 · {data.totals.sellers}명</span>
        </div>
        <div>
          <b>{fmtUsdShort(data.totals.sell_value_discretionary)}</b>
          <span>재량 매도 (10b5-1 제외)</span>
        </div>
      </div>
      <div className="tf-seg-btns">
        <button type="button" className={`tf-segbtn${all ? "" : " on"}`} onClick={() => setAll(false)}>
          장내 매수·매도
        </button>
        <button type="button" className={`tf-segbtn${all ? " on" : ""}`} onClick={() => setAll(true)}>
          보상·옵션 행사 등 전체
        </button>
      </div>
      <TxTable rows={rows} onPick={onPick} showFiled={false} />
    </section>
  );
}

const IDEAS: Array<[string, string]> = [
  [
    "클러스터 매수",
    "같은 회사 임원·이사 여럿이 비슷한 시기에 장내 매수하면 단독 매수보다 이후 수익률이 높다는 연구가 많습니다. 내부자 수, 총액, 경영진 포함 여부로 순위를 매깁니다.",
  ],
  [
    "규칙적 vs 기회주의적 내부자",
    "매년 같은 달에 사고파는 '규칙적' 내부자의 거래는 정보가 거의 없고, 평소 거래하지 않던 내부자의 이례적 매수가 의미 있습니다 (Cohen·Malloy·Pomorski 2012). 데이터가 쌓이면 '수년 만의 첫 매수' 필터로 확장할 수 있습니다.",
  ],
  [
    "보유 지분 대비 매수 규모",
    "금액보다 기존 보유 대비 몇 %를 늘렸는지가 확신의 크기를 보여 줍니다. 지분 변화 +50% 이상 매수는 따로 볼 만합니다.",
  ],
  [
    "급락 후 매수",
    "주가가 52주 고점에서 크게 빠졌거나 실적 쇼크 직후 경영진이 사면, 시장의 과잉 반응에 대한 반론으로 읽을 수 있습니다. '52주 고점 대비' 열에서 −30% 이하는 따로 표시하고, 수익률 열로 사후 성과를 같이 확인합니다.",
  ],
  [
    "매도는 걸러서 보기",
    "매도는 세금·분산·주택 구입 등 이유가 다양합니다. 10b5-1 계획 매도를 빼고, 여러 명이 동시에 재량 매도하거나 CEO가 보유분 대부분을 팔 때만 경고 신호로 봅니다.",
  ],
  [
    "시장 전체 매수/매도 비율",
    "내부자 매수자 수 / 매도자 수 비율은 시장 타이밍 지표로 쓰입니다. 2020년 3월 같은 급락기에 내부자 매수가 크게 늘었습니다. 위 차트의 7일·30일 비율을 추적합니다.",
  ],
  [
    "13F와 교차 확인",
    "티커 옆 '13F n' 배지는 13F 탭에서 추적하는 기관 n곳이 최근 분기에 보유한 종목이라는 뜻입니다(마우스를 올리면 기관명·비중). 내부자 매수와 기관 보유가 겹치면 정보 우위와 수급이 함께 붙는 경우입니다.",
  ],
  [
    "한국 시장 확장",
    "DART '임원·주요주주 특정증권등 소유상황보고서'로 국내 임원 장내매수도 같은 방식으로 볼 수 있습니다. 자사주 매입 공시와 함께 보면 국내판 내부자 신호가 됩니다.",
  ],
];

const SOURCES: Array<[string, string, string]> = [
  ["Finviz Insider", "https://finviz.com/insidertrading", "최신 Form 4 목록, 매수/매도 필터"],
  ["OpenInsider", "http://openinsider.com/", "클러스터 매수, 지분 변화(ΔOwn), 다양한 스크리너"],
  ["SEC EDGAR Form 4", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4", "원본 공시 (이 탭의 데이터 출처)"],
  ["secform4.com", "https://www.secform4.com/", "종목·내부자별 이력, 실시간 공시"],
  ["Quiver Quantitative", "https://www.quiverquant.com/insiders/", "내부자 + 미 의회 의원 매매"],
  ["Insider Screener", "https://www.insiderscreener.com/", "미국 외 유럽·아시아 내부자 거래"],
  ["DART 지분공시", "https://dart.fss.or.kr/", "국내 임원·주요주주 소유상황보고서"],
];

export default function InsiderTradingTab() {
  const [summary, setSummary] = useState<InsiderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("clusters");
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<InsiderLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [holders, setHolders] = useState<Insider13FMap>({});
  const [cluster3, setCluster3] = useState(false);
  const [hidePlan, setHidePlan] = useState(true);
  const [spotlight, setSpotlight] = useState<InsiderSpotlight | null>(null);
  const [spotlightError, setSpotlightError] = useState<string | null>(null);
  const [lookupTicker, setLookupTicker] = useState<string | null>(null);
  const userPicked = useRef(false);
  const lookupSeq = useRef(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/insider");
        const j = (await r.json()) as InsiderSummary & { error?: string };
        if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (alive) setSummary(j);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!summary && !spotlight) return;
    const tickers = [
      ...new Set([
        ...(spotlight?.items.map((it) => it.ticker) || []),
        ...(summary?.clusters.map((c) => c.ticker) || []),
        ...(summary?.c_suite_buys.map((r) => r.ticker) || []),
        ...(summary?.top_buys.map((r) => r.ticker) || []),
        ...(summary?.net_buyers.map((r) => r.ticker) || []),
        ...(summary?.latest_buys.map((r) => r.ticker) || []),
      ]),
    ].slice(0, 150);
    if (!tickers.length) return;
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/13f?tickers=${encodeURIComponent(tickers.join(","))}`);
        if (!r.ok) return;
        const j = (await r.json()) as { holders?: Insider13FMap };
        if (alive && j.holders) setHolders(j.holders);
      } catch {
        /* badge is optional */
      }
    })();
    return () => {
      alive = false;
    };
  }, [summary, spotlight]);

  const runLookup = useCallback(async (raw: string, auto = false) => {
    const t = raw.trim().toUpperCase();
    if (!t) return;
    if (!auto) userPicked.current = true;
    const seq = ++lookupSeq.current;
    setQuery(t);
    setLookupTicker(t);
    setLookupLoading(true);
    setLookupError(null);
    try {
      const r = await fetch(`/api/insider?ticker=${encodeURIComponent(t)}`);
      const j = (await r.json()) as InsiderLookup;
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (seq !== lookupSeq.current) return;
      setLookup(j);
      if (!auto) {
        requestAnimationFrame(() =>
          document.getElementById("ins-lookup")?.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
      }
    } catch (e) {
      if (seq !== lookupSeq.current) return;
      setLookup(null);
      setLookupError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === lookupSeq.current) setLookupLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/insider?spotlight=1");
        const j = (await r.json()) as InsiderSpotlight;
        if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (!alive) return;
        setSpotlight(j);
        const first = j.items[0]?.ticker;
        if (first && !userPicked.current) void runLookup(first, true);
      } catch (e) {
        if (alive) setSpotlightError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [runLookup]);

  const s = summary?.sentiment;
  const viewMeta = VIEWS.find((v) => v[0] === view)!;
  const coverage = useMemo(() => {
    if (!summary?.coverage.from) return null;
    const c = summary.coverage;
    return `${c.from} ~ ${c.to} 공시 ${c.days}일 · 장내 거래 ${c.tx.toLocaleString()}건`;
  }, [summary]);

  return (
    <Holders13F.Provider value={holders}>
    <div className="panel-stack thirteenf insider">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">내부자 매매</h2>
            <p className="kr-hero-sub">
              미국 상장사 임원·이사·10% 대주주가 SEC에 2영업일 안에 내야 하는 Form 4를 직접 읽어, 자기 돈으로
              장내에서 사고판 거래만 추립니다. 주식 보상·옵션 행사는 기본 목록에서 뺐습니다.
            </p>
          </div>
        </div>
        <form
          className="tf-search"
          onSubmit={(e) => {
            e.preventDefault();
            void runLookup(query);
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="종목별 1년 내부자 거래 — 티커 (예: NVDA, TSLA, BRK.B)"
            aria-label="종목별 내부자 거래 조회"
          />
          <button type="submit" className="ghost-btn" disabled={lookupLoading}>
            {lookupLoading ? "SEC 조회 중…" : "조회"}
          </button>
        </form>
        {lookupError ? <p className="empty">{lookupError}</p> : null}
        <p className="meta-soft" style={{ marginTop: 8 }}>
          {coverage ? `${coverage} · ` : ""}
          {summary?.updated_at
            ? `집계 ${new Date(summary.updated_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}`
            : ""}
          {summary?.backfill_pending ? ` · 과거 ${summary.backfill_pending}일치 수집 중` : ""}
        </p>
        {summary?.note ? <p className="tf-note">{summary.note}</p> : null}
        <p className="meta-soft">
          교육·모니터링 목적의 정리이며 투자 권유가 아닙니다. 공시는 거래 후 최대 2영업일 뒤에 나오므로 실시간
          매매 정보가 아닙니다.
        </p>
        {error ? <p className="empty">{error}</p> : null}
        {!summary && !error ? <p className="empty">불러오는 중…</p> : null}
      </section>

      <SpotlightPanel
        data={spotlight}
        error={spotlightError}
        active={lookupTicker}
        onPick={(t) => void runLookup(t)}
      />

      <div id="ins-lookup" />
      {lookupLoading && lookupTicker && lookup?.ticker !== lookupTicker ? (
        <section className="geo-section" style={{ marginTop: 16 }}>
          <p className="empty">{lookupTicker} 내부자 거래를 SEC에서 불러오는 중…</p>
        </section>
      ) : null}
      {lookup ? (
        <LookupPanel
          data={lookup}
          onPick={(t) => void runLookup(t)}
          onClose={() => {
            setLookup(null);
            setLookupTicker(null);
          }}
        />
      ) : null}

      {s && s.days.length ? (
        <section className="geo-section" style={{ marginTop: 16 }}>
          <h3 className="geo-section-title">시장 전체 내부자 심리</h3>
          <div className="tf-stats">
            <div>
              <b className="up">{s.buyers_7d}명</b>
              <span>최근 7일 장내 매수 내부자</span>
            </div>
            <div>
              <b className="down">{s.sellers_7d}명</b>
              <span>최근 7일 장내 매도 내부자 (재량 {s.sellers_discretionary_7d}명)</span>
            </div>
            <div>
              <b>{s.ratio_7d != null ? s.ratio_7d.toFixed(2) : "—"}</b>
              <span>매수/매도 비율 7일 · 30일 {s.ratio_30d != null ? s.ratio_30d.toFixed(2) : "—"}</span>
            </div>
          </div>
          <SentimentChart days={s.days} />
          <p className="meta-soft">
            초록은 매수, 빨강은 매도 내부자 수(공시일 기준)입니다. 평소에는 매도자가 훨씬 많고, 급락장에서
            매수자가 늘어 비율이 뛰는 경향이 있습니다.
          </p>
        </section>
      ) : null}

      {summary ? (
        <section className="geo-section" style={{ marginTop: 16 }}>
          <div className="tf-seg-btns">
            {VIEWS.map(([k, t]) => (
              <button
                key={k}
                type="button"
                className={`tf-segbtn${view === k ? " on" : ""}`}
                onClick={() => setView(k)}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="meta-soft">{viewMeta[2]} 종목 티커를 누르면 1년 이력을 조회합니다.</p>
          {view === "clusters" ? (
            <label className="ins-filter">
              <input type="checkbox" checked={cluster3} onChange={(e) => setCluster3(e.target.checked)} /> 3명
              이상만
            </label>
          ) : view === "sells" ? (
            <label className="ins-filter">
              <input type="checkbox" checked={hidePlan} onChange={(e) => setHidePlan(e.target.checked)} />{" "}
              10b5-1 계획 매도 제외
            </label>
          ) : null}
          {view === "clusters" ? (
            <ClusterTable
              rows={cluster3 ? summary.clusters.filter((c) => c.n_insiders >= 3) : summary.clusters}
              onPick={(t) => void runLookup(t)}
            />
          ) : view === "top" ? (
            <TxTable rows={summary.top_buys} onPick={(t) => void runLookup(t)} showReturn />
          ) : view === "csuite" ? (
            <TxTable rows={summary.c_suite_buys} onPick={(t) => void runLookup(t)} showReturn />
          ) : view === "netbuy" ? (
            <NetTable rows={summary.net_buyers} onPick={(t) => void runLookup(t)} />
          ) : view === "netsell" ? (
            <NetTable rows={summary.net_sellers} onPick={(t) => void runLookup(t)} sell />
          ) : view === "buys" ? (
            <TxTable rows={summary.latest_buys} onPick={(t) => void runLookup(t)} />
          ) : (
            <TxTable
              rows={hidePlan ? summary.latest_sells.filter((r) => !r.plan_10b5_1) : summary.latest_sells}
              onPick={(t) => void runLookup(t)}
            />
          )}
        </section>
      ) : null}

      <section className="geo-section" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">내부자 매매로 얻을 수 있는 아이디어</h3>
        <div className="ins-ideas">
          {IDEAS.map(([title, body]) => (
            <div key={title} className="ins-idea">
              <b>{title}</b>
              <p>{body}</p>
            </div>
          ))}
        </div>
        <h4 className="tf-h4" style={{ marginTop: 16 }}>
          참고 사이트
        </h4>
        <ul className="ins-sources">
          {SOURCES.map(([name, url, desc]) => (
            <li key={name}>
              <a href={url} target="_blank" rel="noreferrer">
                {name}
              </a>{" "}
              <span className="meta-soft">— {desc}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
    </Holders13F.Provider>
  );
}
