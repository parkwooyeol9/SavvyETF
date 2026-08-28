"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  OVERLAY_ALIKE,
  OVERLAY_ISSUERS,
  OVERLAY_MATCHUPS,
  OVERLAY_NOTE,
  OVERLAY_PRODUCTS,
  OVERLAY_SCORE_AXES,
  OVERLAY_UNLIKE,
  type OverlayIssuer,
  type OverlayIssuerId,
  type OverlayProductQuote,
} from "@/lib/derivOverlay";
import {
  THEME_ISSUERS,
  THEME_KIND_KO,
  THEME_NOTE,
  THEME_PIPELINE,
  THEME_PRODUCTS,
  THEME_RIVALS,
  THEME_SCORE_AXES,
  type ThemeIssuer,
  type ThemeIssuerId,
  type ThemePayload,
  type ThemeProductQuote,
} from "@/lib/themeEtf";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
  fontSize: 11,
};

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtPrice(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 100) return n.toFixed(2);
  return n.toFixed(3);
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

function chartStroke(change?: number | null): string {
  if (change != null && change > 0.05) return "#3dd68c";
  if (change != null && change < -0.05) return "#f87171";
  return "#4da3ff";
}

function ScoreDots({ n }: { n: number }) {
  return (
    <span className="themeetf-dots" aria-label={`${n}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <i key={i} data-on={i < n ? "1" : "0"} />
      ))}
    </span>
  );
}

function LiveChart({
  quote,
}: {
  quote: {
    id: string;
    symbol: string;
    change_3m_pct: number | null;
    series: { date: string; label: string; close: number }[];
  };
}) {
  const data = quote.series || [];
  const stroke = chartStroke(quote.change_3m_pct);
  const gradId = `themeetf-${quote.id}`;
  if (data.length < 2) {
    return <div className="poli-chart-empty">차트 없음</div>;
  }
  return (
    <div className="poli-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#2b3648" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#8b97a8", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={["auto", "auto"]}
            width={42}
            tick={{ fill: "#8b97a8", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => fmtPrice(Number(v))}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [fmtPrice(Number(v)), quote.symbol]}
            labelFormatter={(l) => String(l)}
          />
          <Area
            type="monotone"
            dataKey="close"
            stroke={stroke}
            strokeWidth={1.7}
            fill={`url(#${gradId})`}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProductCard({ quote }: { quote: ThemeProductQuote }) {
  return (
    <article className="poli-etf-card">
      <header>
        <div>
          <em>
            {quote.theme} · {THEME_KIND_KO[quote.kind]}
          </em>
          <h4>{quote.name_ko}</h4>
          <span>{quote.name}</span>
        </div>
        <code>{quote.symbol}</code>
      </header>
      <div className="poli-etf-px">
        <strong>{fmtPrice(quote.price)}</strong>
        <span className={retClass(quote.change_1d_pct)}>
          1일 {fmtPct(quote.change_1d_pct)}
        </span>
        <span className={retClass(quote.change_3m_pct)}>
          3개월 {fmtPct(quote.change_3m_pct)}
        </span>
      </div>
      <LiveChart quote={quote} />
      <p>{quote.blurb}</p>
      {quote.expense ? <small>보수 {quote.expense}</small> : null}
    </article>
  );
}

function OverlayCard({ quote }: { quote: OverlayProductQuote }) {
  return (
    <article className="poli-etf-card">
      <header>
        <div>
          <em>
            {quote.sleeve} · {quote.family === "buffer" ? "버퍼" : "커버드콜"}
          </em>
          <h4>{quote.name_ko}</h4>
          <span>{quote.name}</span>
        </div>
        <code>{quote.symbol}</code>
      </header>
      <div className="poli-etf-px">
        <strong>{fmtPrice(quote.price)}</strong>
        <span className={retClass(quote.change_1d_pct)}>
          1일 {fmtPct(quote.change_1d_pct)}
        </span>
        <span className={retClass(quote.change_3m_pct)}>
          3개월 {fmtPct(quote.change_3m_pct)}
        </span>
      </div>
      <LiveChart quote={quote} />
      <p>{quote.blurb}</p>
      {quote.expense ? <small>보수 {quote.expense}</small> : null}
    </article>
  );
}

function emptyQuotes(): ThemeProductQuote[] {
  return THEME_PRODUCTS.map((spec) => ({
    ...spec,
    price: null,
    change_1d_pct: null,
    change_3m_pct: null,
    series: [],
  }));
}

function emptyOverlayQuotes(): OverlayProductQuote[] {
  return OVERLAY_PRODUCTS.map((spec) => ({
    ...spec,
    price: null,
    change_1d_pct: null,
    change_3m_pct: null,
    series: [],
  }));
}

const CATALOG_SEED: ThemePayload = {
  ok: true,
  generated_at: "",
  note: THEME_NOTE,
  issuers: THEME_ISSUERS,
  products: emptyQuotes(),
  pipeline: THEME_PIPELINE,
  rivals: THEME_RIVALS,
  overlay_issuers: OVERLAY_ISSUERS,
  overlay_products: emptyOverlayQuotes(),
  overlay_matchups: OVERLAY_MATCHUPS,
};

export default function ThemeEtfTab() {
  const [issuerId, setIssuerId] = useState<ThemeIssuerId>("corgi");
  const [overlayId, setOverlayId] = useState<OverlayIssuerId>("neos");
  const [pipeFilter, setPipeFilter] = useState<"all" | "issuer">("all");
  const [data, setData] = useState<ThemePayload>(CATALOG_SEED);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/theme-etf", { cache: "no-store" });
      const json = (await res.json()) as ThemePayload;
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData({
        ...json,
        issuers: json.issuers?.length ? json.issuers : THEME_ISSUERS,
        products: json.products?.length ? json.products : emptyQuotes(),
        pipeline: json.pipeline?.length ? json.pipeline : THEME_PIPELINE,
        rivals: json.rivals?.length ? json.rivals : THEME_RIVALS,
        overlay_issuers: json.overlay_issuers?.length ? json.overlay_issuers : OVERLAY_ISSUERS,
        overlay_products: json.overlay_products?.length
          ? json.overlay_products
          : emptyOverlayQuotes(),
        overlay_matchups: json.overlay_matchups?.length
          ? json.overlay_matchups
          : OVERLAY_MATCHUPS,
        note: json.note || THEME_NOTE,
      });
      setError(json.ok === false ? json.error || "시세 일부 실패" : null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 180_000);
    return () => window.clearInterval(id);
  }, [load]);

  const issuers = data.issuers;
  const issuer: ThemeIssuer | undefined =
    issuers.find((i) => i.id === issuerId) || issuers[0];
  const products = useMemo(
    () => data.products.filter((p) => p.issuer === (issuer?.id || issuerId)),
    [data.products, issuer?.id, issuerId],
  );
  const quoteBySymbol = useMemo(() => {
    const map = new Map<string, ThemeProductQuote>();
    for (const p of data.products) map.set(p.symbol, p);
    return map;
  }, [data.products]);
  const pipeline = data.pipeline.filter(
    (row) => pipeFilter === "all" || row.issuer === (issuer?.id || issuerId),
  );
  const rivals = data.rivals;
  const overlayIssuers = data.overlay_issuers || OVERLAY_ISSUERS;
  const overlayHouse: OverlayIssuer | undefined =
    overlayIssuers.find((i) => i.id === overlayId) || overlayIssuers[0];
  const overlayProducts = useMemo(
    () =>
      data.overlay_products.filter(
        (p) => p.issuer === (overlayHouse?.id || overlayId),
      ),
    [data.overlay_products, overlayHouse?.id, overlayId],
  );
  const overlayQuoteBySymbol = useMemo(() => {
    const map = new Map<string, OverlayProductQuote>();
    for (const p of data.overlay_products) map.set(p.symbol, p);
    return map;
  }, [data.overlay_products]);

  return (
    <div className="themeetf-tab poli-tab">
      <section className="feature-block">
        <div className="feature-head">
          <div>
            <h2 className="feature-title">테마 ETF</h2>
            <p className="feature-lead">
              미국 부티크 운용사 중 Corgi처럼 재미있는 슬라이스·인컴·2x를 찍어내는
              하우스를 모았습니다. 블랙록·밴가드 같은 대형 패시브는 빼 두었습니다.
              정치 바스켓(NANC·KRUZ)은 정치테마상품 탭을 보세요.
            </p>
          </div>
        </div>
        <p className="themeetf-note">{data.note}</p>
        {error ? <p className="empty warn">{error}</p> : null}
        {loading ? <p className="empty">시세 불러오는 중…</p> : null}

        <div className="chip-row themeetf-issuer-chips" role="tablist" aria-label="운용사">
          {issuers.map((row) => (
            <button
              key={row.id}
              type="button"
              role="tab"
              aria-selected={row.id === issuer?.id}
              className={`chip ${row.id === issuer?.id ? "active" : ""}`}
              onClick={() => setIssuerId(row.id)}
            >
              {row.name_ko}
              <em>{row.name}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="feature-block">
        <h3 className="feature-title">운용사 비교</h3>
        <p className="feature-lead">
          점수는 5점 상대 평가입니다. 저보수·라인업 폭이 높을수록 코기형, 인컴·레버리지가
          높을수록 디파이언스·일드맥스형입니다.
        </p>
        <div className="poli-pipe-table-wrap">
          <table className="poli-pipe-table themeetf-compare">
            <thead>
              <tr>
                <th>운용사</th>
                <th>설립</th>
                <th>플레이북</th>
                <th>보수대</th>
                <th>대표작</th>
                {THEME_SCORE_AXES.map((axis) => (
                  <th key={axis.key}>{axis.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {issuers.map((row) => (
                <tr
                  key={row.id}
                  data-active={row.id === issuer?.id ? "1" : "0"}
                  onClick={() => setIssuerId(row.id)}
                >
                  <td>
                    <strong>{row.name_ko}</strong>
                    <div className="themeetf-sub">{row.name}</div>
                  </td>
                  <td>
                    {row.founded}
                    <div className="themeetf-sub">{row.hq}</div>
                  </td>
                  <td className="themeetf-play">{row.playbook_ko}</td>
                  <td>{row.fee_band}</td>
                  <td>{row.signature}</td>
                  {THEME_SCORE_AXES.map((axis) => (
                    <td key={axis.key}>
                      <ScoreDots n={row.scores[axis.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="feature-block">
        <h3 className="feature-title">같은 테마, 다른 하우스</h3>
        <p className="feature-lead">
          히트 슬라이스는 바로 복제됩니다. 상장 상품과 DTCC 예약·S-1을 한 칸에 뒀습니다.
        </p>
        <div className="themeetf-rival-grid">
          {(rivals || []).map((rival) => (
            <article key={rival.id} className="themeetf-rival">
              <header>
                <em>{rival.theme}</em>
                <h4>{rival.theme_ko}</h4>
              </header>
              <ul>
                {rival.seats.map((seat) => {
                  const q = seat.symbol ? quoteBySymbol.get(seat.symbol) : undefined;
                  const house = issuers.find((i) => i.id === seat.issuer);
                  return (
                    <li key={`${seat.issuer}-${seat.symbol || seat.note}`}>
                      <button type="button" onClick={() => setIssuerId(seat.issuer)}>
                        <strong>{house?.name_ko || seat.issuer}</strong>
                        <code>{seat.symbol || "—"}</code>
                        {seat.listed ? (
                          <span className={retClass(q?.change_3m_pct)}>
                            3m {fmtPct(q?.change_3m_pct)}
                          </span>
                        ) : (
                          <span className="themeetf-pipe-tag">미상장</span>
                        )}
                      </button>
                      <p>{seat.note}</p>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {issuer ? (
        <section className="feature-block">
          <div className="feature-head">
            <div>
              <h3 className="feature-title">
                {issuer.name_ko} · {issuer.name}
              </h3>
              <p className="feature-lead">{issuer.playbook_ko}</p>
            </div>
          </div>
          <div className="themeetf-issuer-meta">
            <span>설립 {issuer.founded}</span>
            <span>{issuer.hq}</span>
            <span>{issuer.products_note}</span>
            <span>보수 {issuer.fee_band}</span>
            <span>대표 {issuer.signature}</span>
          </div>
          <p className="themeetf-risk">{issuer.risk_ko}</p>
          <div className="themeetf-product-grid">
            {products.map((quote) => (
              <ProductCard key={quote.id} quote={quote} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="feature-block">
        <div className="feature-head geo-head-row">
          <div>
            <h3 className="feature-title">상장 예정 · 파이프라인</h3>
            <p className="feature-lead">
              DTCC 예약 심볼(아직 미거래)과 SEC S-1/N-1A. 티커는 바뀌거나 철회될 수
              있습니다. 예약 심볼 중 VM·CO·NLP처럼 기존 종목 티커와 겹치는 것은 시세를
              붙이지 않았습니다.
            </p>
          </div>
          <div className="chip-row" role="group" aria-label="파이프라인 필터">
            <button
              type="button"
              className={`chip ${pipeFilter === "all" ? "active" : ""}`}
              onClick={() => setPipeFilter("all")}
            >
              전체
            </button>
            <button
              type="button"
              className={`chip ${pipeFilter === "issuer" ? "active" : ""}`}
              onClick={() => setPipeFilter("issuer")}
            >
              {issuer?.name_ko || "선택 운용사"}만
            </button>
          </div>
        </div>
        <div className="poli-pipe-table-wrap">
          <table className="poli-pipe-table">
            <thead>
              <tr>
                <th>운용사</th>
                <th>티커</th>
                <th>상품</th>
                <th>테마</th>
                <th>상태</th>
                <th>메모</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.map((row) => {
                const house = issuers.find((i) => i.id === row.issuer);
                return (
                  <tr key={row.id} data-active={row.issuer === issuer?.id ? "1" : "0"}>
                    <td>
                      <button type="button" className="themeetf-link" onClick={() => setIssuerId(row.issuer)}>
                        {house?.name_ko || row.issuer}
                      </button>
                    </td>
                    <td>
                      <code>{row.ticker || "—"}</code>
                    </td>
                    <td>
                      <strong>{row.name_ko}</strong>
                      <div className="themeetf-sub">{row.name}</div>
                    </td>
                    <td>{row.theme}</td>
                    <td>
                      <em className="poli-status status-sec-review">{row.status_ko}</em>
                      <div className="themeetf-sub">{row.source}</div>
                    </td>
                    <td>{row.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="feature-block">
        <div className="feature-head">
          <div>
            <h3 className="feature-title">파생상품 ETF · 버퍼 vs 커버드콜</h3>
            <p className="feature-lead">
              미국 옵션 오버레이의 두 갈래입니다. 커버드콜(NEOS·JEPI·QYLD)은 콜을 팔아
              월분배를 만들고, 버퍼(이노베이터·FT 베스트)는 그 프리미엄으로 풋을 사서
              1년 하락을 깎습니다. 둘 다 상승을 담보로 잡습니다.
            </p>
          </div>
        </div>
        <p className="themeetf-note">{OVERLAY_NOTE}</p>

        <div className="chip-row themeetf-issuer-chips" role="tablist" aria-label="파생 ETF 운용사">
          {overlayIssuers.map((row) => (
            <button
              key={row.id}
              type="button"
              role="tab"
              aria-selected={row.id === overlayHouse?.id}
              className={`chip ${row.id === overlayHouse?.id ? "active" : ""}`}
              onClick={() => setOverlayId(row.id)}
            >
              {row.name_ko}
              <em>{row.family === "buffer" ? "버퍼" : "커버드콜"}</em>
            </button>
          ))}
        </div>

        <div className="poli-pipe-table-wrap">
          <table className="poli-pipe-table themeetf-compare">
            <thead>
              <tr>
                <th>운용사</th>
                <th>유형</th>
                <th>플레이북</th>
                <th>어떻게</th>
                <th>세금</th>
                <th>보수</th>
                {OVERLAY_SCORE_AXES.map((axis) => (
                  <th key={axis.key}>{axis.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overlayIssuers.map((row) => (
                <tr
                  key={row.id}
                  data-active={row.id === overlayHouse?.id ? "1" : "0"}
                  onClick={() => setOverlayId(row.id)}
                >
                  <td>
                    <strong>{row.name_ko}</strong>
                    <div className="themeetf-sub">
                      {row.name} · {row.founded}
                    </div>
                  </td>
                  <td>{row.family === "buffer" ? "버퍼" : "커버드콜"}</td>
                  <td className="themeetf-play">{row.playbook_ko}</td>
                  <td className="themeetf-play">{row.mechanic_ko}</td>
                  <td className="themeetf-play">{row.tax_ko}</td>
                  <td>{row.fee_band}</td>
                  {OVERLAY_SCORE_AXES.map((axis) => (
                    <td key={axis.key}>
                      <ScoreDots n={row.scores[axis.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="feature-block">
        <h3 className="feature-title">비슷한 점 · 다른 점</h3>
        <p className="feature-lead">
          옵션을 판다는 점은 같고, 그 돈을 주머니에 넣느냐 보험으로 쓰느냐가 갈립니다.
        </p>
        <div className="themeetf-split">
          <article>
            <h4>비슷한 점</h4>
            <ul>
              {OVERLAY_ALIKE.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </article>
          <article>
            <h4>다른 점</h4>
            <ul>
              {OVERLAY_UNLIKE.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <section className="feature-block">
        <h3 className="feature-title">같은 슬리브, 다른 하우스</h3>
        <p className="feature-lead">
          S&P 인컴·나스닥 인컴·버퍼 10%는 티커만 다른 복제 전장입니다. 보호 깊이는
          같은 이노베이터 안에서도 갈립니다.
        </p>
        <div className="themeetf-rival-grid">
          {(data.overlay_matchups || []).map((rival) => (
            <article key={rival.id} className="themeetf-rival">
              <header>
                <em>{rival.theme}</em>
                <h4>{rival.theme_ko}</h4>
              </header>
              <p className="themeetf-match-alike">{rival.alike}</p>
              <p className="themeetf-match-unlike">{rival.unlike}</p>
              <ul>
                {rival.seats.map((seat) => {
                  const q = overlayQuoteBySymbol.get(seat.symbol);
                  const house = overlayIssuers.find((i) => i.id === seat.issuer);
                  return (
                    <li key={`${seat.issuer}-${seat.symbol}`}>
                      <button type="button" onClick={() => setOverlayId(seat.issuer)}>
                        <strong>{house?.name_ko || seat.issuer}</strong>
                        <code>{seat.symbol}</code>
                        <span className={retClass(q?.change_3m_pct)}>
                          3m {fmtPct(q?.change_3m_pct)}
                        </span>
                      </button>
                      <p>{seat.note}</p>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {overlayHouse ? (
        <section className="feature-block">
          <div className="feature-head">
            <div>
              <h3 className="feature-title">
                {overlayHouse.name_ko} · {overlayHouse.name}
              </h3>
              <p className="feature-lead">{overlayHouse.playbook_ko}</p>
            </div>
          </div>
          <div className="themeetf-issuer-meta">
            <span>{overlayHouse.family === "buffer" ? "버퍼" : "커버드콜"}</span>
            <span>설립 {overlayHouse.founded}</span>
            <span>{overlayHouse.hq}</span>
            <span>보수 {overlayHouse.fee_band}</span>
            <span>대표 {overlayHouse.signature}</span>
          </div>
          <p className="themeetf-risk">{overlayHouse.risk_ko}</p>
          <div className="themeetf-product-grid">
            {overlayProducts.map((quote) => (
              <OverlayCard key={quote.id} quote={quote} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
