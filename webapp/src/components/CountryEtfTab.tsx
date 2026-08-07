"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  COUNTRY_ETF_UNIVERSE,
  regionsFromUniverse,
  type CountryEtfFund,
  type CountryEtfPayload,
  type HoldingRow,
  type WeightRow,
} from "@/lib/countryEtf";

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtPp(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n) || Math.abs(n) < 0.005) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}pp`;
}

function tone(n?: number | null): string {
  if (n == null || Math.abs(n) < 0.005) return "";
  return n > 0 ? "up" : "down";
}

function WeightBar({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="ka-weight-cell">
      <span>{pct.toFixed(2)}</span>
      <span className="ka-weight-bar" style={{ width: `${Math.min(100, w * 2.2)}%` }} />
    </div>
  );
}

function emptyFund(ticker: string): CountryEtfFund {
  const meta = COUNTRY_ETF_UNIVERSE.find((u) => u.ticker === ticker)!;
  return {
    ticker: meta.ticker,
    name: meta.name,
    name_ko: meta.name_ko,
    region: meta.region,
    kind: meta.kind,
    as_of: null,
    holdings: [],
    sectors: [],
    countries: [],
    source: "",
  };
}

export default function CountryEtfTab() {
  const [fundsByTicker, setFundsByTicker] = useState<Record<string, CountryEtfFund>>(() => {
    const init: Record<string, CountryEtfFund> = {};
    for (const u of COUNTRY_ETF_UNIVERSE) init[u.ticker] = emptyFund(u.ticker);
    return init;
  });
  const [loading, setLoading] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState("전체");
  const [kind, setKind] = useState<"all" | "country" | "broad">("all");
  const [active, setActive] = useState("IEMG");
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [source, setSource] = useState("");

  const mergeFunds = useCallback((incoming: CountryEtfFund[]) => {
    setFundsByTicker((prev) => {
      const next = { ...prev };
      for (const f of incoming) next[f.ticker] = f;
      return next;
    });
    setLoadedCount((c) => c + incoming.filter((f) => f.holdings.length || f.error).length);
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      setLoadedCount(0);
      try {
        // Prefer selected ticker first for fast detail pane
        const ordered = [
          active,
          ...COUNTRY_ETF_UNIVERSE.map((u) => u.ticker).filter((t) => t !== active),
        ];
        const chunkSize = 4;
        for (let i = 0; i < ordered.length; i += chunkSize) {
          const chunk = ordered.slice(i, i + chunkSize);
          const results = await Promise.all(
            chunk.map(async (ticker) => {
              const res = await fetch(
                `/api/country-etf?ticker=${encodeURIComponent(ticker)}${
                  refresh ? "&refresh=1" : ""
                }`,
                { cache: "no-store" },
              );
              const json = (await res.json()) as CountryEtfPayload;
              return json.funds?.[0] || {
                ...emptyFund(ticker),
                error: json.error || "실패",
              };
            }),
          );
          mergeFunds(results);
          if (results[0]?.source) setSource(results[0].source);
          setGeneratedAt(new Date().toISOString());
        }
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : String(exc));
      } finally {
        setLoading(false);
      }
    },
    [active, mergeFunds],
  );

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const regions = useMemo(() => regionsFromUniverse(), []);

  const filtered = useMemo(() => {
    return COUNTRY_ETF_UNIVERSE.map((u) => fundsByTicker[u.ticker] || emptyFund(u.ticker)).filter(
      (f) => {
        if (region !== "전체" && f.region !== region) return false;
        if (kind !== "all" && f.kind !== kind) return false;
        return true;
      },
    );
  }, [fundsByTicker, region, kind]);

  const fund = fundsByTicker[active] || emptyFund(active);

  return (
    <div className="panel-stack country-etf">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">국가 ETF</h2>
            <p className="kr-hero-sub">
              미국 상장 국가·브로드마켓 ETF Top10 편입 · 편입비 변화 · GICS 업종비 ·
              브로드마켓은 국가별 편입비 포함
            </p>
          </div>
          <div className="kr-hero-actions">
            <button
              type="button"
              className="ghost-btn"
              disabled={loading}
              onClick={() => void load(true)}
            >
              {loading ? "불러오는 중…" : "새로고침"}
            </button>
          </div>
        </div>
        <p className="meta-soft">
          유니버스 {COUNTRY_ETF_UNIVERSE.length}종
          {loading ? ` · 로딩 ${loadedCount}/${COUNTRY_ETF_UNIVERSE.length}` : ""}
          {source ? ` · ${source}` : ""}
          {generatedAt
            ? ` · ${new Date(generatedAt).toLocaleString("ko-KR", { hour12: false })}`
            : ""}
        </p>
      </section>

      <section className="geo-section" style={{ marginTop: 12 }}>
        <div className="country-etf-filters">
          <div className="country-etf-chips">
            {regions.map((r) => (
              <button
                key={r}
                type="button"
                className={region === r ? "us-pf-chip us-pf-chip-active" : "us-pf-chip"}
                onClick={() => setRegion(r)}
              >
                <strong>{r}</strong>
              </button>
            ))}
          </div>
          <div className="country-etf-chips">
            {(
              [
                ["all", "전체 유형"],
                ["country", "국가"],
                ["broad", "브로드마켓"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={kind === k ? "us-pf-chip us-pf-chip-active" : "us-pf-chip"}
                onClick={() => setKind(k)}
              >
                <strong>{label}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="ka-fund-grid" style={{ marginTop: 12 }}>
          {filtered.map((f) => (
            <button
              key={f.ticker}
              type="button"
              className={
                active === f.ticker
                  ? "ka-fund-card country-etf-card country-etf-card-active"
                  : "ka-fund-card country-etf-card"
              }
              onClick={() => setActive(f.ticker)}
            >
              <header>
                <strong>{f.ticker}</strong>
                <span className="meta-soft">{f.kind === "broad" ? "브로드" : "국가"}</span>
              </header>
              <p className="ka-fund-name">{f.name_ko}</p>
              <p className="meta-soft">{f.region}</p>
              {f.holdings[0] ? (
                <p className="ka-fund-top">
                  Top1 <strong>{f.holdings[0].name}</strong>{" "}
                  {fmtPct(f.holdings[0].weight_pct)}
                </p>
              ) : (
                <p className="empty">{f.error || (loading ? "…" : "데이터 없음")}</p>
              )}
            </button>
          ))}
        </div>
        {error ? <p className="empty">{error}</p> : null}
      </section>

      <section className="geo-section geo-featured" style={{ marginTop: 16 }}>
        <h3 className="geo-section-title">
          {fund.ticker} · {fund.name_ko}
        </h3>
        <p className="meta-soft">
          {fund.name}
          {fund.as_of ? ` · 기준 ${fund.as_of}` : ""}
          {fund.source ? ` · ${fund.source}` : ""}
        </p>

        <div
          className={
            fund.kind === "broad"
              ? "country-etf-split-3"
              : "us-pf-split"
          }
          style={{ marginTop: 12 }}
        >
          <div>
            <h4 className="geo-section-title">Top10 편입종목</h4>
            <HoldingsTable rows={fund.holdings} />
          </div>
          <div>
            <h4 className="geo-section-title">GICS 업종비</h4>
            <WeightsTable rows={fund.sectors} empty="업종 데이터 없음" />
          </div>
          {fund.kind === "broad" ? (
            <div>
              <h4 className="geo-section-title">국가별 편입비</h4>
              <WeightsTable
                rows={fund.countries}
                empty="국가비중은 iShares 지리 분류가 있는 브로드 ETF에서 제공됩니다."
              />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function HoldingsTable({ rows }: { rows: HoldingRow[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>종목</th>
            <th className="num">비중</th>
            <th className="num">Δ</th>
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr>
              <td colSpan={4} className="empty">
                —
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={`${r.symbol}-${i}`}>
                <td>{i + 1}</td>
                <td>
                  <strong>{r.symbol || "—"}</strong>
                  <div className="meta-soft">{r.name}</div>
                </td>
                <td className="num">
                  <WeightBar pct={r.weight_pct} />
                </td>
                <td className={`num ${tone(r.delta_pp)}`}>{fmtPp(r.delta_pp)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function WeightsTable({
  rows,
  empty,
}: {
  rows: WeightRow[];
  empty: string;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>항목</th>
            <th className="num">비중</th>
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr>
              <td colSpan={2} className="empty">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="num">
                  <WeightBar pct={r.weight_pct} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
