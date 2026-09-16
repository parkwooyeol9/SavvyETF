"use client";

import { useEffect, useMemo, useState } from "react";

import {
  fundConcentration,
  holdingKey,
  pairOverlap,
  type FundSnapshot,
  type HoldingSnap,
} from "@/lib/etfHoldingsBasket";
import { PARTISAN_HOLDING_FUNDS } from "@/lib/midtermTape";

const HOLDINGS_LIMIT = 40;
const SHOW_TOP = 6;
const HOLDINGS_CACHE_KEY = "savvyetf:partisan-holdings:v2";
const HOLDINGS_TTL_MS = 10 * 60_000;

function loadCachedSnaps(): Record<string, FundSnapshot> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(HOLDINGS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; snaps?: Record<string, FundSnapshot> };
    if (!parsed.at || Date.now() - parsed.at > HOLDINGS_TTL_MS) return null;
    if (!parsed.snaps || typeof parsed.snaps !== "object") return null;
    return parsed.snaps;
  } catch {
    return null;
  }
}

function saveCachedSnaps(snaps: Record<string, FundSnapshot>) {
  try {
    window.sessionStorage.setItem(
      HOLDINGS_CACHE_KEY,
      JSON.stringify({ at: Date.now(), snaps }),
    );
  } catch {
    /* quota */
  }
}

type HoldingsPayload = {
  ok: boolean;
  ticker?: string;
  market?: FundSnapshot["market"];
  name?: string;
  type?: string | null;
  region?: string | null;
  as_of?: string | null;
  aum_label?: string | null;
  source?: string;
  source_note?: string;
  holdings?: HoldingSnap[];
  stats?: FundSnapshot["stats"];
  error?: string;
};

function snapshotFromLookup(json: HoldingsPayload): FundSnapshot | null {
  if (!json.ok || !json.ticker || !json.market) return null;
  return {
    ticker: json.ticker,
    market: json.market,
    name: json.name || json.ticker,
    type: json.type,
    region: json.region,
    as_of: json.as_of,
    aum_label: json.aum_label,
    source: json.source,
    source_note: json.source_note,
    fetched_at: new Date().toISOString(),
    holdings: (json.holdings || []).map((h) => ({
      code: h.code || "",
      name: h.name || h.code || "",
      weight_pct: h.weight_pct ?? null,
      change_pct: h.change_pct,
    })),
    stats: json.stats,
  };
}

function fmtW(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function sharedNames(a?: FundSnapshot, b?: FundSnapshot, limit = 6): HoldingSnap[] {
  if (!a || !b) return [];
  const bMap = new Map(b.holdings.map((h) => [holdingKey(h), h]));
  const out: Array<HoldingSnap & { minW: number }> = [];
  for (const h of a.holdings) {
    const k = holdingKey(h);
    const other = k ? bMap.get(k) : undefined;
    if (!other) continue;
    const minW = Math.min(h.weight_pct ?? 0, other.weight_pct ?? 0);
    out.push({
      code: h.code || other.code,
      name: h.name || other.name,
      weight_pct: minW,
      minW,
    });
  }
  return out.sort((x, y) => y.minW - x.minW).slice(0, limit);
}

function FundCol({ fund, snap }: { fund: (typeof PARTISAN_HOLDING_FUNDS)[number]; snap?: FundSnapshot }) {
  const conc = snap ? fundConcentration(snap) : null;
  const rows = (snap?.holdings || []).slice(0, SHOW_TOP);
  return (
    <article className="poli-hold-card" data-party={fund.party.toLowerCase()}>
      <header>
        <div>
          <em>{fund.name_ko}</em>
          <h4>
            <code>{fund.symbol}</code>
            {snap?.aum_label ? <span>AUM {snap.aum_label}</span> : null}
          </h4>
        </div>
        {conc ? (
          <small>
            {conc.label} · 상위5 {fmtW(conc.top5)}
          </small>
        ) : null}
      </header>
      {!snap ? <p className="empty">편입비 없음</p> : null}
      {rows.length ? (
        <ol>
          {rows.map((h) => (
            <li key={`${h.code}-${h.name}`}>
              <span>{h.name || h.code}</span>
              <strong>{fmtW(h.weight_pct)}</strong>
            </li>
          ))}
        </ol>
      ) : null}
      {snap?.as_of ? <small className="meta-soft">{snap.as_of}</small> : null}
    </article>
  );
}

export default function PartisanHoldingsPeek() {
  const [snaps, setSnaps] = useState<Record<string, FundSnapshot>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const cached = loadCachedSnaps();
    if (cached && Object.keys(cached).length) {
      setSnaps(cached);
      setLoading(false);
      return;
    }
    void (async () => {
      setLoading(true);
      try {
        const results = await Promise.all(
          PARTISAN_HOLDING_FUNDS.map(async (f) => {
            const qs = new URLSearchParams({
              ticker: f.symbol,
              market: "US",
              limit: String(HOLDINGS_LIMIT),
            });
            const res = await fetch(`/api/etf-holdings?${qs}`);
            const json = (await res.json()) as HoldingsPayload;
            return snapshotFromLookup(json);
          }),
        );
        if (cancelled) return;
        const next: Record<string, FundSnapshot> = {};
        for (const snap of results) {
          if (snap) next[snap.ticker] = snap;
        }
        setSnaps(next);
        if (Object.keys(next).length) saveCachedSnaps(next);
        setError(Object.keys(next).length ? null : "편입비를 불러오지 못했습니다.");
      } catch (exc) {
        if (!cancelled) setError(exc instanceof Error ? exc.message : "편입비 로드 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nanc = snaps.NANC;
  const gop = snaps.GOP;
  const demz = snaps.DEMZ;
  const maga = snaps.MAGA;
  const stockOverlap = useMemo(() => (nanc && gop ? pairOverlap(nanc, gop) : null), [nanc, gop]);
  const pacOverlap = useMemo(() => (demz && maga ? pairOverlap(demz, maga) : null), [demz, maga]);
  const stockShared = useMemo(() => sharedNames(nanc, gop), [nanc, gop]);
  const pacShared = useMemo(() => sharedNames(demz, maga), [demz, maga]);

  return (
    <section className="geo-section poli-hold-peek">
      <h3 className="geo-section-title">정당 바스켓 편입비</h3>
      <p className="meta-soft">
        NANC·GOP(구 KRUZ)는 STOCK Act 공시 복제, DEMZ·MAGA는 PAC 기부 지수. 겹치는 대형주가 있으면
        스프레드가 정당 베팅이 아니라 공통 팩터일 수 있습니다.
      </p>
      {loading ? <p className="empty">편입비 불러오는 중…</p> : null}
      {error ? <p className="empty warn">{error}</p> : null}
      <div className="poli-hold-grid">
        {PARTISAN_HOLDING_FUNDS.map((f) => (
          <FundCol key={f.symbol} fund={f} snap={snaps[f.symbol]} />
        ))}
      </div>
      <div className="poli-hold-overlap">
        {stockOverlap ? (
          <article>
            <span>NANC ∩ GOP</span>
            <strong>겹침 {stockOverlap.overlapPct.toFixed(1)}%</strong>
            <em>
              공통 {stockOverlap.commonN}종
              {stockShared.length
                ? ` · ${stockShared.map((h) => h.name || h.code).join(", ")}`
                : ""}
            </em>
          </article>
        ) : null}
        {pacOverlap ? (
          <article>
            <span>DEMZ ∩ MAGA</span>
            <strong>겹침 {pacOverlap.overlapPct.toFixed(1)}%</strong>
            <em>
              공통 {pacOverlap.commonN}종
              {pacShared.length ? ` · ${pacShared.map((h) => h.name || h.code).join(", ")}` : ""}
            </em>
          </article>
        ) : null}
      </div>
    </section>
  );
}
