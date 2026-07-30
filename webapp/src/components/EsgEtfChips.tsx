"use client";

import { ESG_TAB_ETF_CHIPS } from "@/lib/esgShared";
import type { ShellTabId } from "@/lib/types";

export default function EsgEtfChips({ tab }: { tab: ShellTabId }) {
  const chips = ESG_TAB_ETF_CHIPS[tab];
  if (!chips?.length) return null;

  return (
    <section className="panel esg-etf-panel" aria-label="관련 ETF 프록시">
      <h3 className="panel-title">투자 액션 · 관련 ETF 프록시</h3>
      <p className="panel-sub">
        시그널 해석용 시장 프록시입니다. 투자 권유가 아니며, 개별 종목·ETF 리스크를
        별도로 확인하세요.
      </p>
      <div className="esg-etf-row">
        {chips.map((c) => (
          <div key={c.symbol} className="esg-etf-chip">
            <strong>{c.symbol}</strong>
            <span className="esg-etf-chip-label">{c.label}</span>
            <em>{c.thesis}</em>
          </div>
        ))}
      </div>
    </section>
  );
}
