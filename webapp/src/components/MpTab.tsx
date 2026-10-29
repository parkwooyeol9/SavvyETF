"use client";

import dynamic from "next/dynamic";

const loading = () => <p className="empty">불러오는 중…</p>;
const PortfolioSimTab = dynamic(() => import("@/components/PortfolioSimTab"), { loading });

/**
 * 포트폴리오 › MP. 2026-10-30부터 ETF 배분 시뮬레이터 하나만 보여 준다.
 * 예전 하위 화면(MP-글로벌주식·MP-ETF배분·시뮬레이션·시뮬레이션-ETF)과 /api/mp/*·/api/us-portfolio·/api/simulate 는
 * 삭제했다(Claude_DB/docs/28). `?tab=simulate` 옛 링크도 Dashboard 가 이 탭으로 보낸다(props 는 그 호환용으로만 유지).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function MpTab(_props: { etf?: boolean; onEtfChange?: (etf: boolean) => void }) {
  return <PortfolioSimTab />;
}
