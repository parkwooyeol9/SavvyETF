"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ETF_DIM_LABEL,
  STOCK_COUNTRIES,
  type AiPick,
  type AiPickPayload,
  type EtfDim,
  type EtfPickMarket,
  type StockCountry,
} from "@/lib/aiPick";

const DIMS: EtfDim[] = ["country", "sector", "theme"];

export default function AiPickTab() {
  const [data, setData] = useState<AiPickPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<EtfPickMarket>("kr");
  const [dim, setDim] = useState<EtfDim>("country");
  const [country, setCountry] = useState<StockCountry>("한국");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai-pick", { cache: "no-store" });
      const json = (await res.json()) as AiPickPayload;
      if (!json.ok) setError(json.error || "AI Pick 데이터를 불러오지 못했습니다.");
      setData(json.etf ? json : null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const etfMarket = data?.etf.markets.find((m) => m.market === market) ?? data?.etf.markets[0];
  const etfDim = etfMarket?.dims[dim];
  const stock = data?.stocks.countries.find((c) => c.country === country);

  return (
    <div className="panel-stack aipick">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">AI Pick</h2>
            <p className="kr-hero-sub">
              저장소와 R2에 이미 쌓인 ETF 유니버스·일간 수익률·주간 Flow, ACWI 종목 추세·일봉, 뉴스 NLP만으로 고른 매수/매도 후보입니다.
            </p>
          </div>
          <div className="kr-hero-actions">
            <button type="button" className="ghost-btn" disabled={loading} onClick={() => void load()}>
              {loading ? "계산 중…" : "새로고침"}
            </button>
            <button
              type="button"
              className="tab-btn"
              onClick={() => window.dispatchEvent(new CustomEvent("savvyetf-nav-tab", { detail: "weightopt" }))}
            >
              비중 최적화
            </button>
          </div>
        </div>
        {data?.sources?.length ? (
          <ul className="aipick-sources">
            {data.sources.map((s) => (
              <li key={s.label} className={s.ok ? "" : "missing"} title={s.note}>
                <span>{s.label}</span>
                <strong>{s.ok ? s.as_of || "—" : s.note || "없음"}</strong>
              </li>
            ))}
          </ul>
        ) : null}
        {error ? <p className="empty">{error}</p> : null}
        {!data && loading ? <p className="meta-soft">불러오는 중…</p> : null}
      </section>

      {data ? (
        <>
          <section className="geo-section" style={{ marginTop: 16 }}>
            <div className="aipick-head">
              <h3 className="geo-section-title">① ETF · 국가 / 업종 / 테마</h3>
              <div className="aipick-toggles">
                <div className="seg" role="tablist" aria-label="상장시장">
                  {data.etf.markets.map((m) => (
                    <button
                      key={m.market}
                      type="button"
                      className={m.market === etfMarket?.market ? "active" : ""}
                      onClick={() => setMarket(m.market)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="seg" role="tablist" aria-label="구분">
                  {DIMS.map((d) => (
                    <button key={d} type="button" className={d === dim ? "active" : ""} onClick={() => setDim(d)}>
                      {ETF_DIM_LABEL[d]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="meta-soft">
              {etfMarket
                ? `${etfMarket.label} · ${ETF_DIM_LABEL[dim]} ${etfDim?.groups ?? 0}개 그룹 비교 · 수익률 기준 ${
                    etfMarket.returns_as_of ?? etfMarket.snapshot_as_of ?? "—"
                  }${data.etf.flow_as_of ? ` · Flow 주간 ~${data.etf.flow_as_of}` : ""}`
                : "ETF 유니버스를 불러오지 못했습니다."}
            </p>
            {etfDim ? <PickColumns buys={etfDim.buys} sells={etfDim.sells} /> : null}
          </section>

          <section className="geo-section" style={{ marginTop: 16 }}>
            <div className="aipick-head">
              <h3 className="geo-section-title">② 주목할 만한 종목 · 한국 / 미국 / 일본</h3>
              <div className="aipick-toggles">
                <div className="seg" role="tablist" aria-label="국가">
                  {STOCK_COUNTRIES.map((c) => (
                    <button key={c} type="button" className={c === country ? "active" : ""} onClick={() => setCountry(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <p className="meta-soft">
              {stock
                ? `ACWI ${country} ${stock.universe}종목 · 추세·밸류 ${data.stocks.facts_as_of ?? "—"} · 일봉 ${
                    stock.with_px ? `${stock.with_px}종목 ${data.stocks.px_as_of ?? ""}` : "없음"
                  }${country === "한국" ? ` · 뉴스 ${stock.with_nlp ? `${stock.with_nlp}종목 ${data.stocks.nlp_as_of ?? ""}` : "없음"}` : ""}`
                : "—"}
            </p>
            {stock ? <PickColumns buys={stock.buys} sells={stock.sells} /> : null}
          </section>

          <section className="geo-section" style={{ marginTop: 16 }}>
            <details className="aipick-method">
              <summary>신호 규칙</summary>
              <h4>ETF</h4>
              <ul>
                {data.methodology.etf.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <h4>종목</h4>
              <ul>
                {data.methodology.stock.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </details>
            <p className="meta-soft" style={{ marginTop: 8 }}>
              {data.disclaimer}
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}

function PickColumns({ buys, sells }: { buys: AiPick[]; sells: AiPick[] }) {
  return (
    <div className="aipick-cols">
      <PickList title="매수 Pick" tone="buy" rows={buys} />
      <PickList title="매도 Pick" tone="sell" rows={sells} />
    </div>
  );
}

function PickList({ title, tone, rows }: { title: string; tone: "buy" | "sell"; rows: AiPick[] }) {
  return (
    <div className={`aipick-col ${tone}`}>
      <h4>
        {title} <span>{rows.length}</span>
      </h4>
      {rows.length ? (
        <ol>
          {rows.map((p) => (
            <PickCard key={p.key} pick={p} />
          ))}
        </ol>
      ) : (
        <p className="aipick-empty">조건을 충족한 후보가 없습니다.</p>
      )}
    </div>
  );
}

function PickCard({ pick }: { pick: AiPick }) {
  return (
    <li className="aipick-card">
      <div className="aipick-card-top">
        <div>
          <strong>{pick.title}</strong>
          <div className="meta-soft">{pick.sub}</div>
        </div>
        <span className={`aipick-score ${pick.action}`} title="0~100 규칙 점수">
          {pick.score}
        </span>
      </div>
      <div className="aipick-chips">
        {pick.chips.map((c) => (
          <span key={c.label} className={`aipick-chip ${c.tone}`} title={c.title}>
            {c.label}
          </span>
        ))}
      </div>
      <div className="aipick-foot">
        <span>{pick.note}</span>
        <span>기준일 {pick.as_of ?? "—"}</span>
      </div>
    </li>
  );
}
