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
          <dt>트리거</dt>
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
        <span>관찰</span>
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

  const scenarioTickers = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of ctx.scenarios) {
      for (const t of s.tickers) {
        const u = t.toUpperCase();
        if (!seen.has(u)) {
          seen.add(u);
          out.push(u);
        }
      }
    }
    return out;
  }, [ctx.scenarios]);

  return (
    <section className="budget-delay-panel" aria-labelledby="budget-delay-title">
      <div className="budget-delay-head">
        <div>
          <div className="budget-delay-kicker">FY2027 · Appropriations</div>
          <h3 id="budget-delay-title" className="geo-section-title">
            예산안 지연 시나리오
          </h3>
          <p className="meta-soft">{ctx.headline}</p>
        </div>
        <div className="budget-delay-countdown" aria-label="CR 만료까지">
          <span>D-{ctx.days_to_cliff}</span>
          <em>CR ~12/11</em>
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
            CR {ctx.cr_start} → {ctx.cr_end} · 서명 {ctx.signed}
          </span>
          <span>다음 클리프 {ctx.cliff_label}</span>
        </div>
      </article>

      <div className="budget-scenario-grid">
        {ctx.scenarios.map((s) => (
          <ScenarioCard key={s.id} scenario={s} />
        ))}
      </div>

      <div className="budget-delay-lower">
        <article className="budget-history">
          <h4>과거 셧다운·채무한도와 시장</h4>
          <div className="deriv-table-wrap">
            <table className="deriv-table budget-history-table">
              <thead>
                <tr>
                  <th>사례</th>
                  <th>일수</th>
                  <th>SPX</th>
                  <th>채권</th>
                  <th>금</th>
                  <th>시사점</th>
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

        {scenarioTickers.length ? (
          <article className="budget-ticker-strip">
            <h4>시나리오 관련 티커 (5D)</h4>
            <div className="budget-ticker-grid">
              {scenarioTickers.map((sym) => {
                const q = etfBySymbol.get(sym);
                return (
                  <div key={sym} className="budget-ticker-chip">
                    <code>{sym}</code>
                    <strong>{q?.price != null ? q.price.toFixed(2) : "—"}</strong>
                    <span className={retClass(q?.change_5d_pct)}>
                      5D {fmtPct(q?.change_5d_pct)}
                    </span>
                    {q?.label ? <em>{q.label}</em> : null}
                  </div>
                );
              })}
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
