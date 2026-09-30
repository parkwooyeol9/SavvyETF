"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CHANGE_LABEL,
  fmtUsdKo,
  quarterLabel,
  type ThirteenFChange,
  type ThirteenFConsensusRow,
  type ThirteenFFundDetail,
  type ThirteenFFundSummary,
  type ThirteenFLookup,
  type ThirteenFOverview,
} from "@/lib/thirteenF";

const CHANGE_ORDER: ThirteenFChange[] = ["new", "added", "trimmed", "held", "exited"];
const DEFAULT_FUND = "berkshire-hathaway";
const PAGE = 40;

type SortKey = "value" | "positions" | "top10" | "filed" | "name";

function label(h: { ticker: string | null; name: string; name_ko: string | null }) {
  if (h.name_ko) return h.name_ko;
  return h.name;
}

function Security({ h }: { h: { ticker: string | null; name: string; name_ko: string | null } }) {
  return (
    <span className="tf-sec">
      <span className="tf-sec-name">{label(h)}</span>
      {h.ticker ? <span className="tf-ticker">{h.ticker}</span> : null}
    </span>
  );
}

function ChangeBadge({ c }: { c: ThirteenFChange }) {
  return <span className={`tf-badge tf-${c}`}>{CHANGE_LABEL[c]}</span>;
}

function pct(v: number | null | undefined, d = 1, sign = false) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${sign && v > 0 ? "+" : ""}${v.toFixed(d)}%`;
}

function ChangeBar({ f }: { f: ThirteenFFundSummary }) {
  const total = CHANGE_ORDER.reduce((s, k) => s + f.changes[k], 0) || 1;
  return (
    <div>
      <div className="tf-stack">
        {CHANGE_ORDER.map((k) =>
          f.changes[k] ? (
            <span
              key={k}
              className={`tf-seg tf-${k}`}
              style={{ width: `${(f.changes[k] / total) * 100}%` }}
              title={`${CHANGE_LABEL[k]} ${f.changes[k]}`}
            />
          ) : null,
        )}
      </div>
      <div className="tf-legend">
        {CHANGE_ORDER.map((k) => (
          <span key={k}>
            <i className={`tf-dot tf-${k}`} />
            {CHANGE_LABEL[k]} {f.changes[k]}
          </span>
        ))}
      </div>
    </div>
  );
}

function FundDetail({ d }: { d: ThirteenFFundDetail }) {
  const [showAll, setShowAll] = useState(false);
  const top = d.holdings.slice(0, 8);
  const maxW = Math.max(...top.map((h) => h.weight_pct), 1);
  const rows = showAll ? d.holdings : d.holdings.slice(0, PAGE);
  const qoq =
    d.prev_equity_value_usd && d.prev_equity_value_usd > 0
      ? (d.equity_value_usd / d.prev_equity_value_usd - 1) * 100
      : null;

  return (
    <section className="geo-section" style={{ marginTop: 16 }}>
      <div className="tf-detail-head">
        <div>
          <h3 className="tf-title">
            {d.investor.name_ko} <span className="tf-sub">{d.investor.name_en}</span>
          </h3>
          <p className="meta-soft">
            {d.investor.manager} · {quarterLabel(d.filing.period)} 보유 기준 · {d.filing.filed} 공개
            {d.filing.form === "13F-HR/A" ? " · 정정 공시 반영" : ""} ·{" "}
            <a href={d.filing.url} target="_blank" rel="noreferrer">
              EDGAR 원문
            </a>
          </p>
        </div>
        <div className="tf-tags">
          {d.investor.tags.map((t) => (
            <span key={t} className="tf-tag">
              {t}
            </span>
          ))}
        </div>
      </div>
      {d.stale || d.investor.note ? (
        <p className="tf-note">
          {d.investor.note || `최근 분기 13F가 아직 없어 ${quarterLabel(d.filing.period)} 기준입니다.`}
        </p>
      ) : null}
      <p className="tf-about">{d.investor.about}</p>

      <div className="tf-stats">
        <div>
          <b>{fmtUsdKo(d.equity_value_usd)}</b>
          <span>주식 공시가액{qoq != null ? ` (전분기 ${pct(qoq, 1, true)})` : ""}</span>
        </div>
        <div>
          <b>{d.positions}종목</b>
          <span>주식 보유 종목 수</span>
        </div>
        <div>
          <b>{pct(d.top10_pct)}</b>
          <span>상위 10종목 집중도 · {d.style}</span>
        </div>
        <div>
          <b>{d.option_rows}개</b>
          <span>옵션 공시 항목 · SEC 원문 {d.sec_rows}행</span>
        </div>
      </div>

      <div className="tf-two">
        <div>
          <h4 className="tf-h4">상위 주식 비중</h4>
          <div className="tf-bars">
            {top.map((h) => (
              <div key={h.cusip} className="tf-bar-row">
                <Security h={h} />
                <span className="tf-bar">
                  <span style={{ width: `${(h.weight_pct / maxW) * 100}%` }} />
                </span>
                <b className="num">{pct(h.weight_pct)}</b>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h4 className="tf-h4">
            전분기 대비 변화
            {d.prev_filing ? (
              <span className="tf-sub"> vs {quarterLabel(d.prev_filing.period)}</span>
            ) : null}
          </h4>
          <ChangeBar f={d} />
          {d.value_in_thousands_fixed ? (
            <p className="meta-soft" style={{ marginTop: 10 }}>
              이 기관은 공시가액을 천 달러 단위로 제출해, 달러 단위로 환산해 표시합니다.
            </p>
          ) : null}
        </div>
      </div>

      <h4 className="tf-h4" style={{ marginTop: 18 }}>
        최신 주식 보유
      </h4>
      <div className="table-wrap">
        <table className="data-table tf-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>종목</th>
              <th className="num">주식 내 비중</th>
              <th className="num">공시가액</th>
              <th className="num">전분기 비중</th>
              <th>전분기 대비</th>
              <th className="num">주식수 변화</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h, i) => (
              <tr key={h.cusip}>
                <td className="num tf-rank">{i + 1}</td>
                <td>
                  <Security h={h} />
                  {h.is_debt ? <span className="tf-tag tf-debt">채권</span> : null}
                  {h.cls && !/^com|^ord|^shs|^cl a$|common stock/i.test(h.cls) ? (
                    <span className="tf-cls">{h.cls}</span>
                  ) : null}
                </td>
                <td className="num">{pct(h.weight_pct)}</td>
                <td className="num">{fmtUsdKo(h.value_usd)}</td>
                <td className="num">{pct(h.prev_weight_pct)}</td>
                <td>
                  <ChangeBadge c={h.change} />
                </td>
                <td className={`num ${(h.shares_chg_pct ?? 0) > 0 ? "up" : (h.shares_chg_pct ?? 0) < 0 ? "down" : ""}`}>
                  {h.change === "new" ? "—" : pct(h.shares_chg_pct, 1, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.holdings.length > PAGE ? (
        <button type="button" className="ghost-btn" style={{ marginTop: 8 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "상위만 보기" : `전체 ${d.holdings.length}종목 보기`}
        </button>
      ) : null}

      {d.exited.length ? (
        <>
          <h4 className="tf-h4" style={{ marginTop: 18 }}>
            전량 매도 ({d.exited.length})
          </h4>
          <div className="table-wrap">
            <table className="data-table tf-table">
              <thead>
                <tr>
                  <th>종목</th>
                  <th className="num">전분기 비중</th>
                  <th className="num">전분기 공시가액</th>
                </tr>
              </thead>
              <tbody>
                {d.exited.slice(0, showAll ? undefined : 15).map((h) => (
                  <tr key={h.cusip}>
                    <td>
                      <Security h={h} />
                    </td>
                    <td className="num">{pct(h.prev_weight_pct)}</td>
                    <td className="num">{fmtUsdKo(h.prev_value_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {d.options.length ? (
        <>
          <h4 className="tf-h4" style={{ marginTop: 18 }}>
            옵션 공시 ({d.options.length})
          </h4>
          <p className="meta-soft">
            옵션 공시가액은 기초자산 기준 명목가치로, 실제 투자금(프리미엄)과 다릅니다. 주식 비중 계산에서는 제외합니다.
          </p>
          <div className="table-wrap">
            <table className="data-table tf-table">
              <thead>
                <tr>
                  <th>기초자산</th>
                  <th>구분</th>
                  <th className="num">명목가치</th>
                </tr>
              </thead>
              <tbody>
                {d.options.slice(0, 20).map((o) => (
                  <tr key={`${o.cusip}:${o.put_call}`}>
                    <td>
                      <Security h={{ ticker: o.ticker, name: o.name, name_ko: null }} />
                    </td>
                    <td className={o.put_call === "Put" ? "down" : "up"}>{o.put_call === "Put" ? "풋" : "콜"}</td>
                    <td className="num">{fmtUsdKo(o.value_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <p className="meta-soft" style={{ marginTop: 12 }}>
        13F는 분기말 미국 상장 주식(롱) 보유 현황이며 정확한 매매일·매매가·공매도·현금·해외주식은 알 수 없습니다. 분기
        종료 후 최대 45일 뒤 공개되므로 현재 보유와 다를 수 있습니다. 전환사채 등 13F 대상 채권(&lsquo;채권&rsquo;
        표시)은 비중에 포함하고, 큰손 흐름 집계에서는 제외합니다.
      </p>
    </section>
  );
}

function ConsensusTable({
  rows,
  onPick,
}: {
  rows: ThirteenFConsensusRow[];
  onPick: (id: string) => void;
}) {
  if (!rows.length) return <p className="empty">데이터 없음</p>;
  return (
    <div className="table-wrap">
      <table className="data-table tf-table">
        <thead>
          <tr>
            <th>종목</th>
            <th className="num">기관 수</th>
            <th className="num">평균 비중</th>
            <th>기관 (비중)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <Security h={r} />
              </td>
              <td className="num">{r.holders}</td>
              <td className="num">{pct(r.avg_weight_pct)}</td>
              <td className="tf-chips-cell">
                <div className="tf-chips">
                  {r.investors.slice(0, 8).map((x) => (
                    <button key={x.id} type="button" className="tf-chip" onClick={() => onPick(x.id)}>
                      {x.name_ko} <span>{pct(x.weight_pct)}</span>
                    </button>
                  ))}
                  {r.investors.length > 8 ? (
                    <span className="tf-chip-more" title={r.investors.slice(8).map((x) => x.name_ko).join(", ")}>
                      +{r.investors.length - 8}
                    </span>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ThirteenFTab() {
  const [overview, setOverview] = useState<ThirteenFOverview | null>(null);
  const [ovError, setOvError] = useState<string | null>(null);
  const [fundId, setFundId] = useState(DEFAULT_FUND);
  const [detail, setDetail] = useState<ThirteenFFundDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("value");
  const [flowView, setFlowView] = useState<"consensus" | "bought" | "sold">("consensus");
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<ThirteenFLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/13f")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        return j as ThirteenFOverview;
      })
      .then((j) => alive && setOverview(j))
      .catch((e) => alive && setOvError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setDetailLoading(true);
    setDetailError(null);
    fetch(`/api/13f?fund=${encodeURIComponent(fundId)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        return j as ThirteenFFundDetail;
      })
      .then((j) => alive && setDetail(j))
      .catch((e) => alive && setDetailError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setDetailLoading(false));
    return () => {
      alive = false;
    };
  }, [fundId]);

  const pick = useCallback((id: string) => {
    setFundId(id);
    requestAnimationFrame(() =>
      document.getElementById("tf-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, []);

  const runLookup = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setLookup(null);
      return;
    }
    setLookupLoading(true);
    try {
      const r = await fetch(`/api/13f?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setLookup(j as ThirteenFLookup);
    } catch (e) {
      setLookup({ query: q, rows: [] });
      setOvError(e instanceof Error ? e.message : String(e));
    } finally {
      setLookupLoading(false);
    }
  }, [query]);

  const funds = useMemo(() => {
    const list = [...(overview?.funds || [])];
    const by: Record<SortKey, (a: ThirteenFFundSummary, b: ThirteenFFundSummary) => number> = {
      value: (a, b) => b.equity_value_usd - a.equity_value_usd,
      positions: (a, b) => b.positions - a.positions,
      top10: (a, b) => b.top10_pct - a.top10_pct,
      filed: (a, b) => b.filing.filed.localeCompare(a.filing.filed),
      name: (a, b) => a.investor.name_ko.localeCompare(b.investor.name_ko, "ko"),
    };
    return list.sort(by[sort]);
  }, [overview, sort]);

  const sortTh = (key: SortKey, text: string, num = true) => (
    <th className={num ? "num" : undefined}>
      <button type="button" className={`tf-sort${sort === key ? " on" : ""}`} onClick={() => setSort(key)}>
        {text}
        {sort === key ? " ▾" : ""}
      </button>
    </th>
  );

  return (
    <div className="panel-stack thirteenf">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">13F 스마트머니</h2>
            <p className="kr-hero-sub">
              버크셔 해서웨이 등 유명 투자기관이 SEC에 분기마다 제출하는 13F(미국 주식 보유 보고서)를 직접 읽어,
              보유 종목·비중·전분기 대비 매매를 정리합니다.
            </p>
          </div>
        </div>
        <form
          className="tf-search"
          onSubmit={(e) => {
            e.preventDefault();
            void runLookup();
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="종목 역조회 — 티커 또는 회사명 (예: AAPL, NVDA, 코카콜라)"
            aria-label="종목 역조회"
          />
          <button type="submit" className="ghost-btn" disabled={lookupLoading}>
            {lookupLoading ? "조회 중…" : "어떤 기관이 보유?"}
          </button>
          {lookup ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                setLookup(null);
                setQuery("");
              }}
            >
              닫기
            </button>
          ) : null}
        </form>
        {lookup ? (
          lookup.rows.length ? (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="data-table tf-table">
                <thead>
                  <tr>
                    <th>기관</th>
                    <th>종목</th>
                    <th className="num">비중</th>
                    <th className="num">순위</th>
                    <th className="num">공시가액</th>
                    <th>전분기 대비</th>
                    <th>기준</th>
                  </tr>
                </thead>
                <tbody>
                  {lookup.rows.map((r) => (
                    <tr key={`${r.investor.id}:${r.holding.cusip}`}>
                      <td>
                        <button type="button" className="tf-link" onClick={() => pick(r.investor.id)}>
                          {r.investor.name_ko}
                        </button>
                      </td>
                      <td>
                        <Security h={r.holding} />
                      </td>
                      <td className="num">{pct(r.holding.weight_pct, 2)}</td>
                      <td className="num">{r.rank}</td>
                      <td className="num">{fmtUsdKo(r.holding.value_usd)}</td>
                      <td>
                        <ChangeBadge c={r.holding.change} />
                      </td>
                      <td>{quarterLabel(r.period)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">&lsquo;{lookup.query}&rsquo;을(를) 보유한 추적 기관이 없습니다.</p>
          )
        ) : null}
        {ovError ? <p className="empty">{ovError}</p> : null}
      </section>

      <section className="geo-section" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">추적 기관 {overview ? `· ${overview.funds.length}곳` : ""}</h3>
        <p className="meta-soft">
          {overview?.latest_period ? `최신 ${quarterLabel(overview.latest_period)} 기준 · ` : ""}행을 누르면 아래에
          포트폴리오가 열립니다.
          {overview?.failed.length ? ` 불러오기 실패: ${overview.failed.map((f) => f.name_ko).join(", ")}` : ""}
        </p>
        {!overview && !ovError ? <p className="empty">SEC 공시를 불러오는 중… (첫 조회는 20~40초 걸릴 수 있습니다)</p> : null}
        {funds.length ? (
          <div className="table-wrap">
            <table className="data-table tf-table tf-funds">
              <thead>
                <tr>
                  {sortTh("name", "기관", false)}
                  <th>기준</th>
                  {sortTh("value", "주식 공시가액")}
                  {sortTh("positions", "종목 수")}
                  {sortTh("top10", "상위10 비중")}
                  <th>신규·확대 / 축소·매도</th>
                  <th>상위 종목</th>
                </tr>
              </thead>
              <tbody>
                {funds.map((f) => (
                  <tr
                    key={f.investor.id}
                    className={f.investor.id === fundId ? "tf-selected" : undefined}
                    onClick={() => pick(f.investor.id)}
                  >
                    <td>
                      <b>{f.investor.name_ko}</b>
                      <div className="meta-soft">{f.investor.manager}</div>
                    </td>
                    <td className={f.stale ? "tf-stale" : undefined}>{quarterLabel(f.filing.period)}</td>
                    <td className="num">{fmtUsdKo(f.equity_value_usd)}</td>
                    <td className="num">{f.positions}</td>
                    <td className="num">{pct(f.top10_pct)}</td>
                    <td>
                      <span className="up">
                        {f.changes.new}·{f.changes.added}
                      </span>{" "}
                      /{" "}
                      <span className="down">
                        {f.changes.trimmed}·{f.changes.exited}
                      </span>
                    </td>
                    <td className="tf-top3">
                      {f.top.slice(0, 3).map((h) => h.ticker || label(h)).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <div id="tf-detail" />
      {detailError ? (
        <section className="geo-section" style={{ marginTop: 16 }}>
          <p className="empty">{detailError}</p>
        </section>
      ) : detail && detail.investor.id === fundId ? (
        <FundDetail key={detail.investor.id} d={detail} />
      ) : (
        <section className="geo-section" style={{ marginTop: 16 }}>
          <p className="empty">{detailLoading ? "포트폴리오 불러오는 중…" : "—"}</p>
        </section>
      )}

      {overview ? (
        <section className="geo-section" style={{ marginTop: 16 }}>
          <h3 className="geo-section-title">큰손 흐름 · {quarterLabel(overview.latest_period)}</h3>
          <div className="tf-seg-btns">
            {(
              [
                ["consensus", "공통 보유"],
                ["bought", "많이 산 종목"],
                ["sold", "많이 판 종목"],
              ] as const
            ).map(([k, t]) => (
              <button
                key={k}
                type="button"
                className={`tf-segbtn${flowView === k ? " on" : ""}`}
                onClick={() => setFlowView(k)}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="meta-soft">
            {flowView === "consensus"
              ? "각 기관의 상위 20종목 또는 비중 1% 이상 종목만 '의미 있는 보유'로 보고, 2곳 이상이 겹친 종목을 기관 수 순으로 정렬합니다."
              : flowView === "bought"
                ? "상위 20종목 또는 비중 1% 이상 종목 중 이번 분기 신규 편입·주식수 확대(+1% 초과)한 기관 수 순입니다."
                : "이번 분기 전량 매도(전분기 비중 1% 이상) 또는 주식수 축소(-1% 초과)한 기관 수 순입니다. 전량 매도는 전분기 비중으로 표시합니다."}{" "}
            최신 분기 공시가 없는 기관은 제외합니다.
          </p>
          <ConsensusTable
            rows={
              flowView === "consensus"
                ? overview.consensus
                : flowView === "bought"
                  ? overview.most_bought
                  : overview.most_sold
            }
            onPick={pick}
          />
        </section>
      ) : null}
    </div>
  );
}
