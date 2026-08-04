"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Kosdaq100Payload, Kosdaq100Row } from "@/lib/kosdaq100";

type SortKey =
  | "weight_pct"
  | "change_pct"
  | "price"
  | "market_cap"
  | "per"
  | "pbr"
  | "roe"
  | "op_margin"
  | "revenue_growth"
  | "debt_ratio"
  | "quality_score"
  | "name";

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtNum(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtPrice(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("ko-KR");
}

function fmtMcap(n?: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  const eok = n / 1e8;
  if (eok >= 10_000) return `${(eok / 10_000).toFixed(2)}조`;
  return `${eok.toFixed(0)}억`;
}

function toneClass(n?: number | null): string {
  if (n == null || Number.isNaN(n) || n === 0) return "";
  return n > 0 ? "tone-up" : "tone-down";
}

function qualityClass(label?: string | null): string {
  if (label === "우량") return "kq-badge kq-badge-good";
  if (label === "양호") return "kq-badge kq-badge-ok";
  if (label === "주의") return "kq-badge kq-badge-warn";
  return "kq-badge";
}

export default function Kosdaq100Tab() {
  const [data, setData] = useState<Kosdaq100Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [qualityOnly, setQualityOnly] = useState(false);
  const [theme, setTheme] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("weight_pct");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        refresh ? "/api/kosdaq100?refresh=1" : "/api/kosdaq100",
        { cache: "no-store" },
      );
      const json = (await res.json()) as Kosdaq100Payload;
      if (!json.ok) setError(json.error || "불러오기 실패");
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

  const themes = useMemo(() => {
    const set = new Set<string>();
    for (const r of data?.rows || []) {
      if (r.theme) set.add(r.theme);
    }
    return ["all", ...[...set].sort()];
  }, [data]);

  const rows = useMemo(() => {
    let list = [...(data?.rows || [])];
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.code.includes(q) ||
          (r.theme || "").toLowerCase().includes(q),
      );
    }
    if (qualityOnly) {
      list = list.filter((r) => (r.quality_score || 0) >= 75);
    }
    if (theme !== "all") {
      list = list.filter((r) => r.theme === theme);
    }
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
      const av = a[sortKey];
      const bv = b[sortKey];
      const an = typeof av === "number" ? av : null;
      const bn = typeof bv === "number" ? bv : null;
      if (an == null && bn == null) return 0;
      if (an == null) return 1;
      if (bn == null) return -1;
      return (an - bn) * dir;
    });
    return list;
  }, [data, query, qualityOnly, theme, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  function SortTh({
    label,
    k,
  }: {
    label: string;
    k: SortKey;
  }) {
    const active = sortKey === k;
    return (
      <th>
        <button type="button" className="kq-sort" onClick={() => toggleSort(k)}>
          {label}
          {active ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
        </button>
      </th>
    );
  }

  const summary = data?.summary;

  return (
    <div className="panel-stack">
      <section className="geo-section geo-featured">
        <div className="kq-hero">
          <div>
            <h2 className="geo-section-title">코스닥100</h2>
            <p className="geo-thesis">
              코스닥100 유니버스 {data?.universe_count ?? "—"}종목 · 시총 근사
              편입비 · 우량 펀더멘털 한눈에
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
          {data?.as_of ? `기준 ${data.as_of}` : ""}
          {data?.generated_at
            ? ` · 조회 ${new Date(data.generated_at).toLocaleString("ko-KR", {
                hour12: false,
              })}`
            : ""}
          {data?.universe_as_of ? ` · 유니버스 ${data.universe_as_of}` : ""}
        </p>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      {summary ? (
        <section className="geo-section" style={{ marginTop: 12 }}>
          <div className="kq-summary-grid">
            <div className="kq-stat">
              <span className="meta-soft">시총 합계</span>
              <strong>{fmtMcap(summary.total_mcap)}</strong>
            </div>
            <div className="kq-stat">
              <span className="meta-soft">상승/하락</span>
              <strong>
                <span className="tone-up">{summary.advancers}</span>
                {" / "}
                <span className="tone-down">{summary.decliners}</span>
              </strong>
            </div>
            <div className="kq-stat">
              <span className="meta-soft">우량(≥75)</span>
              <strong>{summary.high_quality}종</strong>
            </div>
            <div className="kq-stat">
              <span className="meta-soft">중앙 PER / ROE</span>
              <strong>
                {fmtNum(summary.median_per, 1)} / {fmtPct(summary.median_roe, 1)}
              </strong>
            </div>
          </div>
          {summary.top_weight?.length ? (
            <p className="meta-soft" style={{ marginTop: 10 }}>
              시총 상위:{" "}
              {summary.top_weight
                .map((t) => `${t.name} ${t.weight_pct.toFixed(1)}%`)
                .join(" · ")}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <div className="kq-filters">
          <input
            className="kq-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="종목명·코드·테마 검색"
          />
          <select
            className="kq-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            {themes.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "전체 테마" : t}
              </option>
            ))}
          </select>
          <label className="kq-check">
            <input
              type="checkbox"
              checked={qualityOnly}
              onChange={(e) => setQualityOnly(e.target.checked)}
            />
            우량만
          </label>
          <span className="meta-soft">{rows.length}종 표시</span>
        </div>

        {loading && !data ? (
          <p className="empty">코스닥100 모니터 불러오는 중…</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table kq-table">
              <thead>
                <tr>
                  <th>#</th>
                  <SortTh label="종목" k="name" />
                  <th>테마</th>
                  <SortTh label="편입비*" k="weight_pct" />
                  <SortTh label="현재가" k="price" />
                  <SortTh label="등락" k="change_pct" />
                  <SortTh label="시총" k="market_cap" />
                  <SortTh label="PER" k="per" />
                  <SortTh label="PBR" k="pbr" />
                  <SortTh label="ROE" k="roe" />
                  <SortTh label="영업이익률" k="op_margin" />
                  <SortTh label="매출YoY" k="revenue_growth" />
                  <SortTh label="부채비율" k="debt_ratio" />
                  <SortTh label="우량" k="quality_score" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <Row key={r.code} row={r} rank={i + 1} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="meta-soft" style={{ marginTop: 10 }}>
          {data?.weight_note}
        </p>
        <p className="meta-soft">{data?.disclaimer}</p>
      </section>
    </div>
  );
}

function Row({ row, rank }: { row: Kosdaq100Row; rank: number }) {
  return (
    <tr>
      <td className="meta-soft">{rank}</td>
      <td>
        <strong>{row.name}</strong>
        <div className="meta-soft">{row.code}</div>
      </td>
      <td>{row.theme || "—"}</td>
      <td>{fmtPct(row.weight_pct, 2)}</td>
      <td>{fmtPrice(row.price)}</td>
      <td className={toneClass(row.change_pct)}>{fmtPct(row.change_pct, 2)}</td>
      <td>{fmtMcap(row.market_cap)}</td>
      <td>{fmtNum(row.per, 1)}</td>
      <td>{fmtNum(row.pbr, 2)}</td>
      <td>{fmtPct(row.roe, 1)}</td>
      <td>{fmtPct(row.op_margin, 1)}</td>
      <td className={toneClass(row.revenue_growth)}>
        {fmtPct(row.revenue_growth, 1)}
      </td>
      <td>{fmtPct(row.debt_ratio, 0)}</td>
      <td>
        <span className={qualityClass(row.quality_label)}>
          {row.quality_label || "—"}
          {row.quality_score != null ? ` ${row.quality_score}` : ""}
        </span>
        {row.quality_drivers?.length ? (
          <div className="meta-soft kq-drivers">
            {row.quality_drivers.join(" · ")}
          </div>
        ) : null}
      </td>
    </tr>
  );
}
