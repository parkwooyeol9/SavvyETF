"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Listing = {
  market: "KR" | "US";
  code: string;
  name: string;
  list_date?: string;
  change_pct?: number | null;
  price?: number | null;
  equity_eligible?: boolean;
};

type Holding = {
  code?: string;
  name?: string;
  weight_pct?: number | null;
  change_pct?: number | null;
};

type Analysis = {
  market: "KR" | "US";
  code: string;
  name?: string;
  list_date?: string;
  ok: boolean;
  error?: string;
  source?: string;
  as_of?: string;
  note?: string;
  stats?: {
    holding_count?: number;
    top5_weight_pct?: number | null;
    top10_weight_pct?: number | null;
    max_weight_pct?: number | null;
    hhi?: number | null;
    coverage_weight_pct?: number | null;
  };
  holdings?: Holding[];
};

type ApiPayload = {
  ok: boolean;
  error?: string;
  generated_at_display?: string;
  source?: string;
  kr_new?: Listing[];
  us_new?: Listing[];
  analyses?: Analysis[];
  notes?: string[];
};

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function toneClass(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

function ListingTable({
  title,
  rows,
  selected,
  onSelect,
}: {
  title: string;
  rows: Listing[];
  selected?: string;
  onSelect: (code: string) => void;
}) {
  return (
    <div className="etf-new-block">
      <h3>{title}</h3>
      {!rows.length ? (
        <p className="empty">조회 결과 없음</p>
      ) : (
        <div className="table-wrap">
          <table className="kr-table">
            <thead>
              <tr>
                <th>상장일</th>
                <th>코드</th>
                <th>이름</th>
                <th>등락</th>
                <th>유형</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.market}-${row.code}`}
                  className={selected === row.code ? "selected" : ""}
                  onClick={() => onSelect(row.code)}
                  style={{ cursor: "pointer" }}
                >
                  <td>{row.list_date || "—"}</td>
                  <td>
                    <code>{row.code}</code>
                  </td>
                  <td>{row.name}</td>
                  <td className={toneClass(row.change_pct)}>
                    {fmtPct(row.change_pct)}
                  </td>
                  <td>
                    <span
                      className={`kr-chip ${row.equity_eligible ? "lev" : "muted"}`}
                    >
                      {row.equity_eligible ? "주식형" : "기타"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function EtfNewTab() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/etf-new", { cache: "no-store" });
      const json = (await res.json()) as ApiPayload;
      setData(json);
      setSelected((prev) => {
        if (prev) return prev;
        const firstOk = (json.analyses || []).find((a) => a.ok)?.code;
        return firstOk || json.kr_new?.[0]?.code || json.us_new?.[0]?.code || "";
      });
    } catch (exc) {
      setData({
        ok: false,
        error: exc instanceof Error ? exc.message : "로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const analyses = data?.analyses || [];
  const active = useMemo(
    () => analyses.find((a) => a.code === selected) || analyses[0] || null,
    [analyses, selected],
  );

  return (
    <section className="panel etf-new-panel">
      <div className="panel-head">
        <div>
          <h2>신규 상장 ETF</h2>
          <p className="kr-note">
            ETF CHECK 한국·미국 신규상장 + 주식형 구성종목 분석
            {data?.generated_at_display ? ` · ${data.generated_at_display}` : ""}
          </p>
        </div>
        <button type="button" className="chip" onClick={() => void load()} disabled={loading}>
          {loading ? "로딩…" : "새로고침"}
        </button>
      </div>

      {!data?.ok ? (
        <p className="empty">{data?.error || (loading ? "불러오는 중…" : "데이터 없음")}</p>
      ) : (
        <>
          <div className="etf-new-grid">
            <ListingTable
              title="🇰🇷 한국 신규상장"
              rows={data.kr_new || []}
              selected={selected}
              onSelect={setSelected}
            />
            <ListingTable
              title="🇺🇸 미국 신규상장"
              rows={data.us_new || []}
              selected={selected}
              onSelect={setSelected}
            />
          </div>

          <div className="etf-new-block">
            <h3>주식형 구성종목 분석</h3>
            {!analyses.length ? (
              <p className="empty">분석 가능한 주식형 신규상장이 없습니다.</p>
            ) : (
              <>
                <div className="chip-row">
                  {analyses.map((a) => (
                    <button
                      key={`${a.market}-${a.code}`}
                      type="button"
                      className={`chip ${active?.code === a.code ? "active" : ""}`}
                      onClick={() => setSelected(a.code)}
                    >
                      {a.market} {a.code}
                    </button>
                  ))}
                </div>

                {active ? (
                  <div className="etf-new-analysis">
                    <div className="etf-new-meta">
                      <strong>
                        {active.code} · {active.name || "—"}
                      </strong>
                      <span>
                        상장 {active.list_date || "—"}
                        {active.as_of ? ` · 비중기준 ${active.as_of}` : ""}
                        {active.source ? ` · ${active.source}` : ""}
                      </span>
                    </div>
                    {!active.ok ? (
                      <p className="empty">{active.error || "구성종목 조회 실패"}</p>
                    ) : (
                      <>
                        <div className="etf-new-stats">
                          <div>
                            <em>Top5</em>
                            <strong>{fmtPct(active.stats?.top5_weight_pct)}</strong>
                          </div>
                          <div>
                            <em>Top10</em>
                            <strong>{fmtPct(active.stats?.top10_weight_pct)}</strong>
                          </div>
                          <div>
                            <em>최대비중</em>
                            <strong>{fmtPct(active.stats?.max_weight_pct)}</strong>
                          </div>
                          <div>
                            <em>HHI</em>
                            <strong>
                              {active.stats?.hhi != null ? active.stats.hhi.toFixed(4) : "—"}
                            </strong>
                          </div>
                        </div>
                        {active.note ? <p className="kr-note">{active.note}</p> : null}
                        <div className="table-wrap">
                          <table className="kr-table">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>코드</th>
                                <th>종목</th>
                                <th>비중</th>
                                <th>등락</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(active.holdings || []).map((h, idx) => (
                                <tr key={`${h.code}-${idx}`}>
                                  <td>{idx + 1}</td>
                                  <td>
                                    <code>{h.code || "—"}</code>
                                  </td>
                                  <td>{h.name || "—"}</td>
                                  <td>{fmtPct(h.weight_pct)}</td>
                                  <td className={toneClass(h.change_pct)}>
                                    {fmtPct(h.change_pct)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {data.notes?.length ? (
            <ul className="kr-note etf-new-notes">
              {data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
