"use client";

import { useEffect, useMemo, useState } from "react";

import { useAdminSession } from "@/components/AdminSession";
import AcwiGroups from "@/components/acwi/AcwiGroups";
import {
  isNum,
  type AcwiApiResponse,
  type AcwiStock,
  type EtfValuation,
  type EtfValuationStocks,
} from "@/lib/acwiAnalyzer";
import { adminAuthHeaders } from "@/lib/adminSession";

/**
 * 포트폴리오 › 밸류에이션 — 주요 ETF 의 10년 PER·PBR·PSR·배당·ROE·성장률·리비전.
 * 데이터: Claude_DB/factor/etf_valuation.py (ACWI 시계열 × ETF 보유종목, 없으면 ACWI 근사) → /api/etf-valuation.
 * 예전 엑셀 수기 업로드(savvyDB)를 대체한다.
 */
export default function ValuationTab() {
  const { secret, unlocked, ready } = useAdminSession();
  const [V, setV] = useState<EtfValuation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stk, setStk] = useState<EtfValuationStocks | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/etf-valuation?part=public")
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as AcwiApiResponse<EtfValuation>;
        if (!res.ok || !json.ok || !json.data) throw new Error(json.error || `HTTP ${res.status}`);
        if (live) setV(json.data);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "불러오기 실패"));
    return () => {
      live = false;
    };
  }, []);

  // 관리자: 구성종목별 PER·PBR·리비전 등 (공개 화면에는 이름·비중만)
  useEffect(() => {
    if (!ready || !unlocked || !secret) {
      setStk(null);
      return;
    }
    let live = true;
    fetch("/api/etf-valuation?part=stocks", { cache: "no-store", headers: adminAuthHeaders(secret) })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as AcwiApiResponse<EtfValuationStocks>;
        if (live && res.ok && json.ok && json.data) setStk(json.data);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ready, unlocked, secret]);

  const stocks = useMemo(() => {
    if (!V) return undefined;
    const m = new Map<string, AcwiStock>();
    for (const [c, s] of Object.entries(V.stocks)) {
      const x = stk?.[c];
      m.set(c, { c, n: s.n ?? x?.n, ct: s.ct ?? x?.ct, ...(x ?? {}), ...(isNum(x?.w) ? { w: x?.w } : {}) } as AcwiStock);
    }
    return m;
  }, [V, stk]);

  if (error) return <p className="empty">{error}</p>;
  if (!V) return <p className="empty">ETF 밸류에이션 불러오는 중…</p>;
  const M = V.meta;
  const q = M.quality;
  const un = q.unavailable ?? [];

  return (
    <div className="panel-stack acwi">
      <AcwiGroups
        G={V}
        stocks={stocks}
        title="ETF 밸류에이션"
        csvPrefix="ETF밸류에이션"
        intro={`주요 국가·지역·섹터·테마 ETF ${M.n_etfs}개의 10년(${M.months[0]} ~ ${M.months[M.months.length - 1]}) 월간 Fwd PER·PBR·PSR·배당·ROE·EPS/매출 성장·리비전. ETF 보유종목(또는 같은 성격의 종목 묶음)을 MSCI ACWI 종목 시계열에 붙여 지수 방식으로 합산합니다. 행을 누르면 차트에 추가되고 아래에 구성 종목이 나옵니다.`}
        notes={
          <ul className="aa-note">
            <li>
              <b>보유종목</b> ({q.n_holdings_based ?? "–"}개): iShares·SPDR 이 공시한 보유종목·비중을 MSCI ACWI 종목에 붙여 합산. ACWI 에 없는 소형주·현금은 빼고 나머지로 다시 나눕니다 (커버리지 열).
              과거 값은 <b>현재 보유종목·비중을 고정</b>하고 되돌린 것이라 실제 ETF 의 과거 구성과 다릅니다.
            </li>
            <li>
              <b>ACWI 근사</b> ({q.n_proxy ?? "–"}개): 보유종목을 받을 수 없는 운용사(Global X·VanEck·Invesco·First Trust 등)와 일본 업종 ETF 는 같은 성격의 ACWI 종목 묶음(국가·GICS·테마,
              유동시총 가중, 테마는 한 종목 8% 상한)으로 대신합니다. 실제 지수 규칙·비중과 달라 방향·추세 비교용으로 보세요.
            </li>
            <li>
              <b>PER 계산</b>: Σ시가총액 ÷ Σ12개월 선행 순이익 (MSCI·S&amp;P 지수 방식, 가중 조화평균, 적자 포함). 종목 PER 을 비중대로 단순 평균하면 고PER 종목에 끌려 더 높게 나옵니다
              (예: SOXX 보유종목 기준 산술평균 30.1 vs 지수 방식 19.3).
            </li>
            <li>
              <b>성장률(YoY)</b>은 같은 종목 묶음의 12개월 선행 순이익·매출 합의 전년 대비(현지통화), <b>PEG</b> = PER ÷ 컨센서스 EPS 성장률(CY27/CY26).
              비교 점선 = 대응하는 MSCI ACWI 국가·섹터·테마 집계.
            </li>
            {un.length ? (
              <li>
                <b>제외</b>: {un.map((u) => `${u.ticker}(${u.label}: ${u.reason})`).join(" · ")}
              </li>
            ) : null}
            <li>
              빌드 {M.built_at.replace("T", " ")} · {M.source} · 추정치는 월초 기준(월간 갱신), 보유종목은 ETF 설명의 기준일
            </li>
          </ul>
        }
      />
    </div>
  );
}
