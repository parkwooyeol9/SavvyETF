"use client";

import { useEffect, useState } from "react";

import ExcelButton from "@/components/ExcelButton";
import AcwiBacktest from "@/components/acwi/AcwiBacktest";
import { Card } from "@/components/acwi/parts";
import { ddayFrom, type AcwiApiResponse, type AcwiPublic as AcwiPublicData } from "@/lib/acwiAnalyzer";
import { downloadAcwiBacktestExcel } from "@/lib/acwiExcel";

/** 비로그인 ACWI 탭: 집계 백테스트와 MSCI 리뷰 일정만. */
export default function AcwiPublic() {
  const [P, setP] = useState<AcwiPublicData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/acwi-analyzer?part=public")
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as AcwiApiResponse<AcwiPublicData>;
        if (!res.ok || !json.ok || !json.data) throw new Error(json.error || `HTTP ${res.status}`);
        if (live) setP(json.data);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "불러오기 실패"));
    return () => {
      live = false;
    };
  }, []);

  const B = P?.backtest;
  const nPit = B?.results.pit?.["전체"]?.n ?? [];
  const upcoming = P ? P.next_reviews.filter((r) => r.effective >= P.as_of) : [];

  return (
    <div className="panel-stack acwi">
      <section className="geo-section">
        <header className="aa-head">
          <div>
            <p className="aa-eyebrow">포트폴리오 · 글로벌 팩터 리서치</p>
            <h2 className="aa-title">ACWI 팩터 백테스트</h2>
            <p className="meta-soft">
              MSCI ACWI 구성종목을 매월 가치·사이즈·배당·성장·모멘텀·퀄리티 점수로 5분위로 나눠 10년간 성과를 검증했습니다.
              공개 화면에는 분위·롱숏 집계 결과만 싣고, 종목별 점수·지표와 편출입 종목은 제공하지 않습니다.
            </p>
          </div>
          {B ? <ExcelButton onClick={() => downloadAcwiBacktestExcel(B)} /> : null}
        </header>
        {error ? <p className="empty">{error}</p> : null}
        {!P && !error ? <p className="empty">불러오는 중…</p> : null}
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
              <b>
                {nPit.length ? `${nPit[0].toLocaleString()} → ${nPit[nPit.length - 1].toLocaleString()}` : "–"}
              </b>
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
                      {upcoming[0].announce >= P.as_of ? ` (D-${ddayFrom(P.as_of, upcoming[0].announce)})` : ""}
                    </small>
                  </>
                ) : (
                  "–"
                )}
              </b>
            </div>
          </div>
        ) : null}
      </section>
      {B ? <AcwiBacktest B={B} /> : null}
      {upcoming.length ? (
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
