"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  FundSnapshot,
  KosdaqActivePayload,
  ManagerOverweight,
  MatrixRow,
} from "@/lib/kosdaqActive";
import { KOSDAQ_ACTIVE_UNIVERSE } from "@/lib/kosdaqActive";

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtPp(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n) || Math.abs(n) < 0.005) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}pp`;
}

function fmtAum(n?: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(2)}조`;
  return `${n.toFixed(0)}억`;
}

function WeightCell({ pct }: { pct?: number | null }) {
  if (pct == null) return <span className="meta-soft">—</span>;
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="ka-weight-cell">
      <span>{pct.toFixed(2)}</span>
      <span className="ka-weight-bar" style={{ width: `${w * 4}%` }} aria-hidden />
    </div>
  );
}

function FundCard({ fund }: { fund: FundSnapshot }) {
  const top = fund.holdings?.[0];
  return (
    <article className="ka-fund-card">
      <header>
        <strong>{fund.brand}</strong>
        <span className="meta-soft">{fund.ticker}</span>
      </header>
      <p className="ka-fund-name">{fund.name}</p>
      <p className="meta-soft">{fund.issuer}</p>
      <dl className="ka-fund-meta">
        <div>
          <dt>AUM</dt>
          <dd>{fmtAum(fund.aum_krw_eok)}</dd>
        </div>
        <div>
          <dt>기준</dt>
          <dd>{fund.as_of || "—"}</dd>
        </div>
      </dl>
      {top ? (
        <p className="ka-fund-top">
          Top1 <strong>{top.name}</strong> {fmtPct(top.weight_pct)}
        </p>
      ) : (
        <p className="empty">{fund.error || "편입 데이터 없음"}</p>
      )}
    </article>
  );
}

function FlowBlock({ fund }: { fund: FundSnapshot }) {
  const flow = fund.flow;
  if (!flow) return null;
  const has =
    (flow.added?.length || 0) +
      (flow.removed?.length || 0) +
      (flow.increased?.length || 0) +
      (flow.decreased?.length || 0) >
    0;
  return (
    <div className="ka-flow-block">
      <h4>
        {fund.brand}{" "}
        <span className="meta-soft">
          {flow.previous_as_of
            ? `${flow.previous_as_of} → ${fund.as_of}`
            : fund.as_of}
        </span>
      </h4>
      {!flow.has_previous || !has ? (
        <p className="meta-soft">{flow.note || "전일 대비 변동 없음(상위 랭킹 기준)"}</p>
      ) : (
        <div className="ka-flow-grid">
          <FlowList title="편입·상위 신규" items={flow.added} kind="add" />
          <FlowList title="편출·상위 이탈" items={flow.removed} kind="remove" />
          <FlowList title="비중확대" items={flow.increased} kind="up" />
          <FlowList title="비중축소" items={flow.decreased} kind="down" />
        </div>
      )}
    </div>
  );
}

function FlowList({
  title,
  items,
  kind,
}: {
  title: string;
  items: Array<{
    code: string;
    name?: string | null;
    weight_pct?: number | null;
    before?: number;
    after?: number;
    delta?: number;
  }>;
  kind: "add" | "remove" | "up" | "down";
}) {
  if (!items?.length) {
    return (
      <div>
        <p className="ka-flow-label">{title}</p>
        <p className="meta-soft">—</p>
      </div>
    );
  }
  return (
    <div>
      <p className="ka-flow-label">{title}</p>
      <ul className="panel-sub">
        {items.slice(0, 6).map((item) => (
          <li key={`${kind}-${item.code}`}>
            <strong>{item.name || item.code}</strong>{" "}
            {kind === "up" || kind === "down" ? (
              <span className={kind === "up" ? "tone-up" : "tone-down"}>
                {fmtPct(item.before)}→{fmtPct(item.after)} ({fmtPp(item.delta)})
              </span>
            ) : (
              <span>{fmtPct(item.weight_pct)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OverweightTable({ rows }: { rows: ManagerOverweight[] }) {
  if (!rows.length) return <p className="empty">특화 오버웨이트 없음</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>운용사</th>
            <th>종목</th>
            <th>테마</th>
            <th>비중</th>
            <th>vs 피어</th>
            <th>해석</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.ticker}-${r.code}`}>
              <td>
                <strong>{r.brand}</strong>
                <div className="meta-soft">{r.issuer}</div>
              </td>
              <td>
                {r.name}
                <div className="meta-soft">{r.code}</div>
              </td>
              <td>{r.theme || "—"}</td>
              <td>{fmtPct(r.weight_pct)}</td>
              <td className="tone-up">{fmtPp(r.delta_vs_peers)}</td>
              <td className="ka-rationale">{r.rationale}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixTable({
  rows,
  tickers,
}: {
  rows: MatrixRow[];
  tickers: string[];
}) {
  const brandOf = useMemo(() => {
    const m = new Map<string, string>(
      KOSDAQ_ACTIVE_UNIVERSE.map((u) => [u.ticker, u.brand]),
    );
    return (t: string) => m.get(t) || t;
  }, []);

  if (!rows.length) return <p className="empty">비교 매트릭스 없음</p>;
  return (
    <div className="table-wrap">
      <table className="data-table ka-matrix">
        <thead>
          <tr>
            <th>종목</th>
            <th>테마</th>
            <th>보유</th>
            {tickers.map((t) => (
              <th key={t}>{brandOf(t)}</th>
            ))}
            <th>평균</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td>
                <strong>{r.name}</strong>
                <div className="meta-soft">{r.code}</div>
              </td>
              <td>{r.theme || "—"}</td>
              <td>{r.fund_count}/6</td>
              {tickers.map((t) => (
                <td key={t}>
                  <WeightCell pct={r.weights[t]} />
                </td>
              ))}
              <td>{fmtPct(r.avg_weight)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function KosdaqActiveTab() {
  const [data, setData] = useState<KosdaqActivePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        refresh ? "/api/kosdaq-active?refresh=1" : "/api/kosdaq-active",
        { cache: "no-store" },
      );
      const json = (await res.json()) as KosdaqActivePayload;
      if (!json.ok) {
        setError(json.error || "불러오기 실패");
      }
      setData(json);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const tickers = useMemo(
    () => (data?.funds || []).map((f) => f.ticker),
    [data],
  );

  return (
    <div className="panel-stack">
      <section className="geo-section geo-featured">
        <div className="ka-hero">
          <div>
            <h2 className="geo-section-title">코스닥액티브 ETF</h2>
            <p className="geo-thesis">
              KoAct · TIME · PLUS · TIGER · MIDAS · DS 6종 상위 편입비 비교 ·
              편출입 · 운용사 특화 오버웨이트
            </p>
          </div>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void load(true)}
            disabled={loading}
          >
            {loading ? "불러오는 중…" : "새로고침"}
          </button>
        </div>
        <p className="meta-soft">
          {data?.schedule_note || "매일 15:50 KST 장마감 후 갱신"}
          {data?.as_of ? ` · 기준일 ${data.as_of}` : ""}
          {data?.generated_at
            ? ` · 조회 ${new Date(data.generated_at).toLocaleString("ko-KR", {
                hour12: false,
              })}`
            : ""}
        </p>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {loading && !data ? (
        <p className="empty">코스닥액티브 편입비 불러오는 중…</p>
      ) : null}

      {data?.ok ? (
        <>
          <section className="geo-section" style={{ marginTop: 12 }}>
            <div className="ka-fund-grid">
              {(data.funds || []).map((fund) => (
                <FundCard key={fund.ticker} fund={fund} />
              ))}
            </div>
          </section>

          <section className="geo-section geo-featured" style={{ marginTop: 18 }}>
            <h3 className="geo-section-title">오늘 해석</h3>
            <p className="geo-thesis">
              공통 편입 · 테마 쏠림 · 운용사별 특화 · 전일 대비 비중확대
            </p>
            <ul className="panel-sub">
              {(data.insights || []).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="meta-soft" style={{ marginTop: 8 }}>
              {data.disclaimer}
            </p>
          </section>

          <section className="geo-section geo-featured" style={{ marginTop: 18 }}>
            <h3 className="geo-section-title">운용사 특화 오버웨이트</h3>
            <p className="geo-thesis">
              같은 종목을 담은 피어 중앙값 대비 +0.8pp 이상 높은 상위 편입
            </p>
            <OverweightTable rows={data.manager_overweights || []} />
          </section>

          <section className="geo-section geo-featured" style={{ marginTop: 18 }}>
            <h3 className="geo-section-title">전일 대비 편출입·비중 변화</h3>
            <p className="geo-thesis">
              상위 랭킹 기준 신규 편입/이탈 · 비중↑↓ (스냅샷이 쌓인 뒤부터 풍부)
            </p>
            <div className="ka-flow-stack">
              {(data.funds || []).map((fund) => (
                <FlowBlock key={`flow-${fund.ticker}`} fund={fund} />
              ))}
            </div>
          </section>

          <section className="geo-section geo-featured" style={{ marginTop: 18 }}>
            <h3 className="geo-section-title">공통·비교 매트릭스</h3>
            <p className="geo-thesis">
              3개 이상 ETF 상위권 공통 종목 우선 · 숫자는 편입비중(%)
            </p>
            <MatrixTable
              rows={(data.consensus?.length ? data.consensus : data.matrix) || []}
              tickers={tickers}
            />
          </section>

          <p className="meta-soft" style={{ marginTop: 14 }}>
            {data.source_note}
            {data.source ? ` · source=${data.source}` : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}
