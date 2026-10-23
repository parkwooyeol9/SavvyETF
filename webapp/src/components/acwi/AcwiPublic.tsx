"use client";

import { useEffect, useState } from "react";

import ExcelButton from "@/components/ExcelButton";
import AcwiBacktest from "@/components/acwi/AcwiBacktest";
import AcwiMarket from "@/components/acwi/AcwiMarket";
import { Card, Sg } from "@/components/acwi/parts";
import {
  ddayFrom,
  fmt,
  type AcwiApiResponse,
  type AcwiMarketView,
  type AcwiPublic as AcwiPublicData,
} from "@/lib/acwiAnalyzer";
import { downloadAcwiBacktestExcel } from "@/lib/acwiExcel";

type PubView = "market" | "backtest";

/** 비로그인 ACWI: 시장 개요(집계·상위 리스트)와 팩터 백테스트. 종목 원장은 없다. */
export default function AcwiPublic() {
  const [view, setView] = useState<PubView>("market");
  const [market, setMarket] = useState<AcwiMarketView | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [P, setP] = useState<AcwiPublicData | null>(null);
  const [btError, setBtError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/acwi-analyzer?part=market")
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as AcwiApiResponse<AcwiMarketView>;
        if (!res.ok || !json.ok || !json.data) throw new Error(json.error || `HTTP ${res.status}`);
        if (live) setMarket(json.data);
      })
      .catch((e: unknown) => live && setMarketError(e instanceof Error ? e.message : "불러오기 실패"));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (view !== "backtest" || P || btError) return;
    let live = true;
    fetch("/api/acwi-analyzer?part=public")
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as AcwiApiResponse<AcwiPublicData>;
        if (!res.ok || !json.ok || !json.data) throw new Error(json.error || `HTTP ${res.status}`);
        if (live) setP(json.data);
      })
      .catch((e: unknown) => live && setBtError(e instanceof Error ? e.message : "불러오기 실패"));
    return () => {
      live = false;
    };
  }, [view, P, btError]);

  const B = P?.backtest;
  const nPit = B?.results.pit?.["전체"]?.n ?? [];
  const asOf = view === "market" ? market?.meta.as_of : P?.as_of;
  const reviews = view === "market" ? market?.meta.next_reviews : P?.next_reviews;
  const upcoming = asOf && reviews ? reviews.filter((r) => r.effective >= asOf) : [];
  const next = market ? market.meta.next_reviews.find((r) => r.announce >= market.meta.as_of) : undefined;

  return (
    <div className="panel-stack acwi">
      <section className="geo-section">
        <header className="aa-head">
          <div>
            <p className="aa-eyebrow">포트폴리오 · 글로벌</p>
            <h2 className="aa-title">{view === "market" ? "ACWI 시장 개요" : "ACWI 팩터 백테스트"}</h2>
            <p className="meta-soft">
              {view === "market" ? (
                <>
                  유니버스 비중으로 만든 벤치마크, 지역·섹터·국가 브레드스, 조건에 걸린 상위 종목만 보여 줍니다.
                  전체 종목 지표·시계열·편출입 명단은 포함하지 않습니다.
                  {market ? ` 기준일 ${market.meta.ri_last}` : ""}
                </>
              ) : (
                <>
                  MSCI ACWI 구성종목을 매월 가치·사이즈·배당·성장·모멘텀·퀄리티 점수로 5분위로 나눠 10년간 성과를 검증했습니다.
                  분위·롱숏 집계만 싣고, 종목별 점수와 편출입 종목은 제공하지 않습니다.
                </>
              )}
            </p>
          </div>
          {view === "backtest" && B ? <ExcelButton onClick={() => downloadAcwiBacktestExcel(B)} /> : null}
        </header>
        <nav className="aa-tabs" role="tablist" aria-label="ACWI 공개 보기">
          {(
            [
              ["market", "시장 개요"],
              ["backtest", "팩터 백테스트"],
            ] as [PubView, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              className={`chip${view === id ? " active" : ""}`}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {view === "market" ? (
          <>
            {marketError ? <p className="empty">{marketError}</p> : null}
            {!market && !marketError ? <p className="empty">불러오는 중…</p> : null}
            {market ? (
              <div className="aa-facts">
                <div className="aa-fact">
                  <span>기준일</span>
                  <b>{market.meta.ri_last}</b>
                </div>
                <div className="aa-fact">
                  <span>종목</span>
                  <b>
                    {market.meta.n_stocks.toLocaleString()}{" "}
                    <small className="meta-soft">(점수 {market.meta.n_scored.toLocaleString()})</small>
                  </b>
                </div>
                <div className="aa-fact">
                  <span>벤치마크 3M / 12M</span>
                  <b>
                    <Sg v={market.meta.bench_r3m} /> / <Sg v={market.meta.bench_r12m} />
                  </b>
                </div>
                <div className="aa-fact">
                  <span>MA200 위 비율</span>
                  <b>{fmt(market.meta.above_ma200, 0, "%")}</b>
                </div>
                <div className="aa-fact">
                  <span>EPS 리비전 브레드스(3M)</span>
                  <b>
                    <Sg v={market.meta.rev_breadth_3m} d={0} suf="%p" />
                  </b>
                </div>
                <div className="aa-fact">
                  <span>다음 MSCI 리뷰</span>
                  <b>
                    {next ? (
                      <>
                        {next.review}{" "}
                        <small className="meta-soft">
                          발표 {next.announce.slice(5)} (D-{ddayFrom(market.meta.as_of, next.announce)})
                        </small>
                      </>
                    ) : (
                      "–"
                    )}
                  </b>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {btError ? <p className="empty">{btError}</p> : null}
            {!P && !btError ? <p className="empty">불러오는 중…</p> : null}
            {P && B ? (
              <div className="aa-facts">
                <div className="aa-fact">
                  <span>검증 기간</span>
                  <b>
                    {B.meta.start.slice(0, 7)} ~ {B.meta.end.slice(0, 7)} <small className="meta-soft">({B.meta.n_months}개월)</small>
                  </b>
                </div>
                <div className="aa-fact">
                  <span>유니버스(PIT) 종목 수</span>
                  <b>{nPit.length ? `${nPit[0].toLocaleString()} → ${nPit[nPit.length - 1].toLocaleString()}` : "–"}</b>
                </div>
                <div className="aa-fact">
                  <span>리밸런싱</span>
                  <b>{B.meta.rebalance}</b>
                </div>
                <div className="aa-fact">
                  <span>신호</span>
                  <b>{B.signals.length}개</b>
                </div>
                <div className="aa-fact">
                  <span>다음 MSCI 리뷰</span>
                  <b>
                    {upcoming[0] ? (
                      <>
                        {upcoming[0].review}{" "}
                        <small className="meta-soft">
                          발표 {upcoming[0].announce.slice(5)}
                          {P && upcoming[0].announce >= P.as_of ? ` (D-${ddayFrom(P.as_of, upcoming[0].announce)})` : ""}
                        </small>
                      </>
                    ) : (
                      "–"
                    )}
                  </b>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>
      {view === "market" && market ? <AcwiMarket M={market} /> : null}
      {view === "backtest" && B ? <AcwiBacktest B={B} /> : null}
      {view === "backtest" && upcoming.length ? (
        <Card title="MSCI 정기 리뷰 일정" sub="MSCI 공지 기준">
          <div className="aa-scroll">
            <table className="aa-tbl aa-mini">
              <thead>
                <tr>
                  <th>리뷰</th>
                  <th>발표</th>
                  <th>효력</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((r) => (
                  <tr key={r.review}>
                    <td>{r.review}</td>
                    <td className="n">{r.announce}</td>
                    <td className="n">{r.effective}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
