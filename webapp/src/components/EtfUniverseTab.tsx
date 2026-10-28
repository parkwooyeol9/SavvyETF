"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import {
  DIM_LABEL,
  ETF_UNIVERSE_MARKETS,
  MARKET_LABEL,
  decodeRows,
  dimValue,
  fmtAum,
  fmtPct,
  groupRows,
  isEtfUniverseMarket,
  type EtfUniverseFile,
  type EtfUniverseIndexEntry,
  type EtfUniverseMarket,
  type EtfUniverseRow,
  type UniverseDim,
} from "@/lib/etfUniverse";

/**
 * ETF·DB — listing-market universes (한국·미국·유럽·일본·홍콩·중국) from the SavvyDB Refinitiv
 * snapshots. Replaces the live Naver/Yahoo crawl as the default view; the old live flow screens
 * for 한국/미국 stay one click away and load only when asked for.
 */

const liveLoading = () => <p className="empty">실시간 화면을 불러오는 중…</p>;
const EtfDbTab = dynamic(() => import("@/components/EtfDbTab"), { loading: liveLoading });
const EtfDbUsTab = dynamic(() => import("@/components/EtfDbUsTab"), { loading: liveLoading });

type Preset = "all" | "passive" | "overseas" | "active";
type SortKey = "aum" | "r1y" | "r3m" | "ter" | "name";

const PRESET_LABEL: Record<Preset, string> = {
  all: "전체",
  passive: "패시브(일반형)",
  overseas: "해외 패시브",
  active: "액티브",
};

const STORE_KEY = "etfUniverse.market";

function dimsFor(market: EtfUniverseMarket): UniverseDim[] {
  const base: UniverseDim[] = ["ac", "reg", "sec", "st", "iss", "lev", "act"];
  if (market === "kr") return ["scope", ...base];
  if (market === "eu") return [...base, "dom", "ex"];
  if (market === "us" || market === "cn") return [...base, "ex"];
  return base;
}

function signedClass(n?: number | null): string {
  if (n == null || n === 0) return "";
  return n > 0 ? "up" : "down";
}

export default function EtfUniverseTab({ initialMarket = "kr" }: { initialMarket?: EtfUniverseMarket }) {
  const [market, setMarket] = useState<EtfUniverseMarket>(initialMarket);
  const [index, setIndex] = useState<EtfUniverseIndexEntry[]>([]);
  const [file, setFile] = useState<EtfUniverseFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<Preset>("all");
  const [dim, setDim] = useState<UniverseDim>("ac");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("aum");
  const [limit, setLimit] = useState(200);
  const [live, setLive] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORE_KEY);
      if (initialMarket === "kr" && isEtfUniverseMarket(saved)) setMarket(saved);
    } catch {
      /* storage blocked — keep default */
    }
    fetch("/api/etf-universe")
      .then((r) => r.json())
      .then((j: { markets?: EtfUniverseIndexEntry[] }) => setIndex(j.markets || []))
      .catch(() => setIndex([]));
  }, [initialMarket]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/etf-universe?market=${market}`)
      .then(async (r) => {
        const j = (await r.json()) as EtfUniverseFile;
        if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (alive) setFile(j);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "로드 실패"))
      .finally(() => alive && setLoading(false));
    try {
      window.localStorage.setItem(STORE_KEY, market);
    } catch {
      /* ignore */
    }
    setSelected(null);
    setPreset("all");
    setLive(false);
    if (!dimsFor(market).includes(dim)) setDim("ac");
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market]);

  useEffect(() => {
    setSelected(null);
    setLimit(200);
  }, [dim, preset]);

  const rows = useMemo(() => (file && file.market === market ? decodeRows(file) : []), [file, market]);
  const unit = file?.unit || (market === "kr" ? "억원" : "$M");

  const presetRows = useMemo(() => {
    switch (preset) {
      case "passive":
        return rows.filter((r) => !r.act && (r.lev || "일반") === "일반");
      case "overseas":
        return rows.filter((r) => !r.act && r.scope === "해외");
      case "active":
        return rows.filter((r) => r.act);
      default:
        return rows;
    }
  }, [rows, preset]);

  const dimRows = useMemo(
    () => (dim === "sec" ? presetRows.filter((r) => r.ac === "주식" || r.ac === "리츠·부동산") : presetRows),
    [presetRows, dim],
  );
  const groups = useMemo(() => groupRows(dimRows, dim), [dimRows, dim]);
  const maxAum = groups[0]?.aum || 1;
  const dimTotal = useMemo(() => dimRows.reduce((s, r) => s + (r.aum || 0), 0), [dimRows]);

  const tableRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = selected ? dimRows.filter((r) => dimValue(r, dim) === selected) : dimRows;
    if (q) {
      out = out.filter(
        (r) =>
          r.n.toLowerCase().includes(q) ||
          r.t.toLowerCase().includes(q) ||
          (r.bm || "").toLowerCase().includes(q) ||
          (r.iss || "").toLowerCase().includes(q),
      );
    }
    const val = (r: EtfUniverseRow): number => {
      if (sort === "ter") return r.ter == null ? Number.POSITIVE_INFINITY : r.ter;
      const v = sort === "aum" ? r.aum : sort === "r1y" ? r.r1y : r.r3m;
      return v == null ? Number.NEGATIVE_INFINITY : v;
    };
    return [...out].sort((a, b) =>
      sort === "name" ? a.n.localeCompare(b.n) : sort === "ter" ? val(a) - val(b) : val(b) - val(a),
    );
  }, [dimRows, selected, dim, query, sort]);

  const passiveAum = rows.filter((r) => !r.act).reduce((s, r) => s + (r.aum || 0), 0);
  const totalAum = file?.total_aum || 0;
  const presets: Preset[] = market === "kr" ? ["all", "passive", "overseas", "active"] : ["all", "passive", "active"];
  const shownAum = tableRows.reduce((s, r) => s + (r.aum || 0), 0);
  const hasR1w = rows.some((r) => r.r1w != null);

  return (
    <section className="panel etfdb-panel">
      <div className="etfdb-hero">
        <div>
          <h2 className="kr-hero-title">ETF 유니버스 · 상장 시장별</h2>
          <p className="kr-note">
            한국·미국·유럽(UCITS)·일본·홍콩·중국 상장 ETF 전수 · 자산군 / 투자지역 / GICS 업종 / 전략·테마 /
            운용사 / 레버리지 / 패시브·액티브 · Refinitiv 스냅샷(SavvyDB) 기준
          </p>
        </div>
        {market === "kr" || market === "us" ? (
          <div className="etfdb-hero-actions">
            <button type="button" className={`tab-btn sub ${live ? "active" : ""}`} onClick={() => setLive((v) => !v)}>
              {live ? "스냅샷으로 돌아가기" : `${MARKET_LABEL[market]} 실시간 수급 보기`}
            </button>
          </div>
        ) : null}
      </div>

      <div className="tabs etfu-markets" role="tablist" aria-label="상장 시장">
        {ETF_UNIVERSE_MARKETS.map((m) => {
          const meta = index.find((x) => x.market === m);
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={market === m}
              className={`tab-btn etfu-market ${market === m ? "active" : ""}`}
              onClick={() => setMarket(m)}
            >
              <strong>{MARKET_LABEL[m]}</strong>
              {meta ? (
                <span className="meta-soft">
                  {meta.count.toLocaleString("ko-KR")}종 · {fmtAum(meta.total_aum, meta.unit)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {live ? (
        market === "kr" ? <EtfDbTab /> : <EtfDbUsTab />
      ) : (
        <>
          {loading && (!file || file.market !== market) ? <p className="empty">ETF 유니버스를 불러오는 중…</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {file && file.market === market ? (
            <>
              <div className="etfdb-stats etfu-stats">
                <div>
                  <div className="etfdb-stat-k">상품 수</div>
                  <div className="etfdb-stat-v">{file.count.toLocaleString("ko-KR")}종</div>
                </div>
                <div>
                  <div className="etfdb-stat-k">순자산 합계</div>
                  <div className="etfdb-stat-v">{fmtAum(totalAum, unit)}</div>
                </div>
                <div>
                  <div className="etfdb-stat-k">패시브 비중(순자산)</div>
                  <div className="etfdb-stat-v">{totalAum ? fmtPct((100 * passiveAum) / totalAum, 1, false) : "—"}</div>
                </div>
                <div>
                  <div className="etfdb-stat-k">기준</div>
                  <div className="etfdb-stat-v etfu-asof">{file.as_of}</div>
                  {file.returns_as_of ? (
                    <div className="meta-soft">수익률 {file.returns_as_of}</div>
                  ) : null}
                </div>
              </div>

              <div className="etfdb-style-filters" role="tablist" aria-label="범위">
                {presets.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`tab-btn sub ${preset === p ? "active" : ""}`}
                    onClick={() => setPreset(p)}
                  >
                    {PRESET_LABEL[p]}
                  </button>
                ))}
              </div>

              <div className="tabs etfdb-dim-tabs" role="tablist" aria-label="분류">
                {dimsFor(market).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`tab-btn ${dim === d ? "active" : ""}`}
                    onClick={() => setDim(d)}
                  >
                    {DIM_LABEL[d]}
                  </button>
                ))}
              </div>

              <div className="etfdb-layout">
                <aside className="etfdb-cats etfu-cats">
                  <button
                    type="button"
                    className={`etfdb-cat ${selected == null ? "active" : ""}`}
                    onClick={() => setSelected(null)}
                  >
                    <span className="etfdb-cat-name">
                      전체{dim === "sec" ? " (주식형)" : ""}
                    </span>
                    <span className="etfdb-cat-sub">
                      <span>{dimRows.length.toLocaleString("ko-KR")}종</span>
                      <span>{fmtAum(dimTotal, unit)}</span>
                    </span>
                  </button>
                  {groups.map((g) => (
                    <button
                      key={g.label}
                      type="button"
                      className={`etfdb-cat ${selected === g.label ? "active" : ""}`}
                      onClick={() => setSelected(g.label)}
                      title={`평균 총보수 ${g.ter == null ? "—" : g.ter.toFixed(2) + "%"} · 1Y(AUM가중) ${fmtPct(g.r1y)}`}
                    >
                      <span className="etfdb-cat-name">{g.label}</span>
                      <span className="etfdb-cat-sub">
                        <span>
                          {g.count.toLocaleString("ko-KR")}종 · {g.share.toFixed(1)}%
                        </span>
                        <span>{fmtAum(g.aum, unit)}</span>
                      </span>
                      <span className="etfdb-bar">
                        <i style={{ width: `${(100 * g.aum) / maxAum}%` }} />
                      </span>
                    </button>
                  ))}
                </aside>

                <div className="etfdb-main">
                  <div className="etfdb-toolbar">
                    <h3 className="etfdb-detail-title">
                      {selected || "전체"} · {tableRows.length.toLocaleString("ko-KR")}종 · {fmtAum(shownAum, unit)}
                    </h3>
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="종목명·티커·기초지수·운용사"
                      className="etfdb-search"
                    />
                    <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="etfdb-search">
                      <option value="aum">순자산 큰순</option>
                      <option value="r1y">1Y 수익률순</option>
                      <option value="r3m">3M 수익률순</option>
                      <option value="ter">총보수 낮은순</option>
                      <option value="name">이름순</option>
                    </select>
                  </div>

                  <div className="etfdb-table-wrap etfu-table-wrap">
                    <table className="etfdb-table etfu-table">
                      <thead>
                        <tr>
                          <th>티커</th>
                          <th>종목</th>
                          <th>운용사</th>
                          <th>투자지역</th>
                          <th>전략/테마</th>
                          <th className="num">총보수</th>
                          <th className="num">순자산</th>
                          {hasR1w ? <th className="num">1W</th> : null}
                          <th className="num">1M</th>
                          <th className="num">3M</th>
                          <th className="num">1Y</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.slice(0, limit).map((r) => (
                          <tr key={`${r.t}-${r.n}-${r.ex || ""}-${r.dom || ""}`}>
                            <td>
                              <code>{r.t}</code>
                            </td>
                            <td title={r.bm ? `BM: ${r.bm}` : undefined}>
                              {r.n}
                              {r.lev && r.lev !== "일반" ? <span className="etfu-tag warn">{r.lev}</span> : null}
                              {r.act ? <span className="etfu-tag">액티브</span> : null}
                              {r.hd ? <span className="etfu-tag">H</span> : null}
                            </td>
                            <td className="meta-soft">{r.iss || "—"}</td>
                            <td>{r.reg || "—"}</td>
                            <td className="meta-soft">{r.st || r.ac || "—"}</td>
                            <td className="num">{r.ter == null ? "—" : `${r.ter.toFixed(2)}%`}</td>
                            <td className="num">{fmtAum(r.aum, unit)}</td>
                            {hasR1w ? <td className={`num ${signedClass(r.r1w)}`}>{fmtPct(r.r1w)}</td> : null}
                            <td className={`num ${signedClass(r.r1m)}`}>{fmtPct(r.r1m)}</td>
                            <td className={`num ${signedClass(r.r3m)}`}>{fmtPct(r.r3m)}</td>
                            <td className={`num ${signedClass(r.r1y)}`}>{fmtPct(r.r1y)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {tableRows.length > limit ? (
                    <button type="button" className="tab-btn sub etfu-more" onClick={() => setLimit((n) => n + 300)}>
                      {Math.min(300, tableRows.length - limit).toLocaleString("ko-KR")}종 더 보기 (
                      {(tableRows.length - limit).toLocaleString("ko-KR")}종 남음)
                    </button>
                  ) : null}
                </div>
              </div>

              <details className="etfu-notes">
                <summary>기준·분류 방법</summary>
                <ul>
                  {file.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <p className="meta-soft">
                  원본 {file.source} · 수익률은 가격수익률(분배금 제외)
                  {file.returns_source ? ` · ${file.returns_source}` : ""} · 순자산 단위 {unit}
                  {file.adv_unit !== unit ? ` · 거래대금 ${file.adv_unit}` : ""}
                </p>
              </details>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
