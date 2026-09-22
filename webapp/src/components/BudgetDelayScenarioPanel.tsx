"use client";

import { useMemo } from "react";

import {
  BUDGET_SCENARIO_TONE_LABEL,
  buildBudgetDelayContext,
  type BudgetScenario,
} from "@/lib/budgetDelayScenarios";
import type { MidtermEtf } from "@/lib/usMidterm";

function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

function ScenarioCard({ scenario }: { scenario: BudgetScenario }) {
  return (
    <article className="budget-scenario-card" data-tone={scenario.tone}>
      <header>
        <span className="budget-scenario-tone">{BUDGET_SCENARIO_TONE_LABEL[scenario.tone]}</span>
        <h4>{scenario.label}</h4>
        <em>{scenario.probability_ko}</em>
      </header>
      <dl className="budget-scenario-dl">
        <div>
          <dt>전개</dt>
          <dd>{scenario.trigger}</dd>
        </div>
        <div>
          <dt>정치</dt>
          <dd>{scenario.politics}</dd>
        </div>
        <div>
          <dt>시장</dt>
          <dd>{scenario.market}</dd>
        </div>
      </dl>
      <div className="budget-scenario-watch">
        <span>관심</span>
        {scenario.watch.map((t) => (
          <code key={t}>{t}</code>
        ))}
      </div>
    </article>
  );
}

export default function BudgetDelayScenarioPanel({ etfs }: { etfs?: MidtermEtf[] }) {
  const ctx = useMemo(() => buildBudgetDelayContext(), []);

  const etfBySymbol = useMemo(() => {
    const map = new Map<string, MidtermEtf>();
    for (const e of etfs || []) map.set(e.symbol.toUpperCase(), e);
    return map;
  }, [etfs]);

  const quoteStrip = useMemo(() => {
    const seen = new Set<string>();
    const ordered: MidtermEtf[] = [];
    for (const s of ctx.scenarios) {
      for (const t of s.tickers) {
        const u = t.toUpperCase();
        if (seen.has(u)) continue;
        seen.add(u);
        const q = etfBySymbol.get(u);
        if (q) ordered.push(q);
      }
    }
    return ordered;
  }, [ctx.scenarios, etfBySymbol]);

  return (
    <section className="budget-delay-panel" aria-labelledby="budget-delay-title">
      <div className="budget-delay-head">
        <div>
          <div className="budget-delay-kicker">2027 회계연도 · 임시예산</div>
          <h3 id="budget-delay-title" className="geo-section-title">
            예산안이 밀리면
          </h3>
          <p className="meta-soft">{ctx.headline}</p>
        </div>
        <div className="budget-delay-countdown" aria-label="임시예산 만료까지">
          <span>D-{ctx.days_to_cliff}</span>
          <em>만료 12/11</em>
        </div>
      </div>

      <article className="budget-delay-status">
        <p>{ctx.summary}</p>
        <ul className="budget-delay-bullets">
          {ctx.status_bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <div className="budget-delay-meta">
          <span>{ctx.bill}</span>
          <span>
            {ctx.cr_start} → {ctx.cr_end} · 서명 {ctx.signed}
          </span>
          <span>고비 {ctx.cliff_label}</span>
        </div>
      </article>

      <div className="budget-scenario-grid">
        {ctx.scenarios.map((s) => (
          <ScenarioCard key={s.id} scenario={s} />
        ))}
      </div>

      <div className="budget-delay-lower">
        <article className="budget-history">
          <h4>과거엔</h4>
          <div className="deriv-table-wrap">
            <table className="deriv-table budget-history-table">
              <thead>
                <tr>
                  <th>때</th>
                  <th>일수</th>
                  <th>S&P</th>
                  <th>채권</th>
                  <th>금</th>
                  <th>한 줄</th>
                </tr>
              </thead>
              <tbody>
                {ctx.history.map((h) => (
                  <tr key={h.year}>
                    <td>{h.year}</td>
                    <td className="num">{h.days > 0 ? `${h.days}일` : "—"}</td>
                    <td>{h.spx_note}</td>
                    <td>{h.tlt_note}</td>
                    <td>{h.gold_note}</td>
                    <td>{h.lesson}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        {quoteStrip.length ? (
          <article className="budget-ticker-strip">
            <h4>관심 종목 · 최근 5일</h4>
            <div className="budget-ticker-grid">
              {quoteStrip.map((q) => (
                <div key={q.symbol} className="budget-ticker-chip">
                  <code>{q.symbol}</code>
                  <strong>{q.price != null ? q.price.toFixed(2) : "—"}</strong>
                  <span className={retClass(q.change_5d_pct)}>
                    5일 {fmtPct(q.change_5d_pct)}
                  </span>
                  {q.label ? <em>{q.label}</em> : null}
                </div>
              ))}
            </div>
          </article>
        ) : null}
      </div>

      <p className="meta-soft budget-delay-foot">
        {ctx.note} 출처:{" "}
        {ctx.sources.map((s, i) => (
          <span key={s.url}>
            {i ? " · " : null}
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.name}
            </a>
          </span>
        ))}
      </p>
    </section>
  );
}
