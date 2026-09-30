import cusipSeed from "@/data/cusipTickers.json";
import { withServerCache } from "@/lib/apiCache";
import {
  THIRTEENF_INVESTORS,
  TICKER_NAME_KO,
  displayTicker,
  findInvestor,
  type ThirteenFChange,
  type ThirteenFChangeCounts,
  type ThirteenFConsensusRow,
  type ThirteenFFilingRef,
  type ThirteenFFundDetail,
  type ThirteenFFundSummary,
  type ThirteenFHolding,
  type ThirteenFInvestor,
  type ThirteenFLookup,
  type ThirteenFOption,
  type ThirteenFOverview,
} from "@/lib/thirteenF";

const FALLBACK_UA = "SavvyETF contact@savvyetf.com";
const SEC_UA = (process.env.SEC_EDGAR_USER_AGENT || "").trim() || FALLBACK_UA;
const HOUR = 3_600_000;
const FUND_TTL = 6 * HOUR;
const FUND_STALE = 72 * HOUR;
/** Share changes within ±1% are reported as "held" (rounding, fractional adjustments). */
const HELD_BAND = 0.01;
/** A filing whose quarter ended this long ago is flagged as no longer current. */
const STALE_DAYS = 165;
/** Consensus counts only conviction positions: top-N rank or weight ≥ threshold. */
const CONVICTION_TOP = 20;
const CONVICTION_WEIGHT = 1;

type SeedEntry = [string, string, string] | null;
const SEED = cusipSeed as unknown as Record<string, SeedEntry>;
const figiCache = new Map<string, SeedEntry>();
let figiBlockedUntil = 0;

// --- SEC fetch (≤10 req/s policy → small concurrency pool) ------------------

let secActive = 0;
const secQueue: (() => void)[] = [];
const SEC_CONCURRENCY = 6;

async function secSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (secActive >= SEC_CONCURRENCY) {
    await new Promise<void>((resolve) => secQueue.push(resolve));
  }
  secActive += 1;
  try {
    return await fn();
  } finally {
    secActive -= 1;
    secQueue.shift()?.();
  }
}

async function secFetch(url: string, revalidate: number): Promise<string> {
  return secSlot(async () => {
    let lastStatus = 0;
    for (const ua of SEC_UA === FALLBACK_UA ? [SEC_UA] : [SEC_UA, FALLBACK_UA]) {
      const res = await fetch(url, {
        headers: { "User-Agent": ua, Accept: "application/json, application/xml, text/xml, */*" },
        next: { revalidate },
        signal: AbortSignal.timeout(25_000),
      });
      if (res.ok) return res.text();
      lastStatus = res.status;
      if (res.status !== 403) break;
    }
    throw new Error(`SEC ${lastStatus} ${url.replace(/^https:\/\/[^/]+/, "")}`);
  });
}

// --- Filing discovery -------------------------------------------------------

type FilingMeta = { form: string; accession: string; filed: string; period: string };

async function listFilings(cik: number): Promise<FilingMeta[]> {
  const raw = await secFetch(
    `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`,
    6 * 3600,
  );
  const d = JSON.parse(raw) as {
    filings?: { recent?: Record<string, string[]> };
  };
  const r = d.filings?.recent || {};
  const out: FilingMeta[] = [];
  (r.form || []).forEach((form, i) => {
    if (form !== "13F-HR" && form !== "13F-HR/A") return;
    const period = r.reportDate?.[i];
    if (!period) return;
    out.push({ form, accession: r.accessionNumber[i], filed: r.filingDate[i], period });
  });
  return out;
}

function archiveBase(cik: number, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}`;
}

function filingRef(cik: number, f: FilingMeta, form = f.form): ThirteenFFilingRef {
  return {
    period: f.period,
    filed: f.filed,
    accession: f.accession,
    form,
    url: `${archiveBase(cik, f.accession)}/${f.accession}-index.htm`,
  };
}

type RawRow = {
  name: string;
  cls: string;
  cusip: string;
  value: number;
  shares: number;
  shType: string;
  putCall: string;
};

function tagValue(block: string, tag: string): string {
  const m = block.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function decodeXml(s: string): string {
  return s
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .trim()
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'");
}

function parseInfoTable(xml: string): RawRow[] {
  const rows: RawRow[] = [];
  const re = /<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const b = m[1];
    rows.push({
      name: decodeXml(tagValue(b, "nameOfIssuer")),
      cls: decodeXml(tagValue(b, "titleOfClass")),
      cusip: tagValue(b, "cusip").toUpperCase(),
      value: Number(tagValue(b, "value").replace(/,/g, "")) || 0,
      shares: Number(tagValue(b, "sshPrnamt").replace(/,/g, "")) || 0,
      shType: tagValue(b, "sshPrnamtType").toUpperCase(),
      putCall: tagValue(b, "putCall"),
    });
  }
  return rows;
}

async function filingRows(cik: number, accession: string): Promise<RawRow[]> {
  const base = archiveBase(cik, accession);
  const idx = JSON.parse(await secFetch(`${base}/index.json`, 30 * 86400)) as {
    directory?: { item?: { name: string; size?: string }[] };
  };
  const xmls = (idx.directory?.item || [])
    .filter((it) => /\.xml$/i.test(it.name) && it.name.toLowerCase() !== "primary_doc.xml")
    .sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
  if (!xmls.length) return [];
  return parseInfoTable(await secFetch(`${base}/${xmls[0].name}`, 30 * 86400));
}

async function amendmentType(cik: number, accession: string): Promise<string> {
  try {
    const xml = await secFetch(`${archiveBase(cik, accession)}/primary_doc.xml`, 30 * 86400);
    return tagValue(xml, "amendmentType").toUpperCase();
  } catch {
    return "";
  }
}

const sumValue = (rows: RawRow[]) => rows.reduce((s, r) => s + r.value, 0);

/**
 * Holdings for one report period: original 13F-HR, then amendments in filing
 * order. Some filers tag full re-filings as "NEW HOLDINGS", so an amendment
 * worth ≥50% of the base is treated as a restatement.
 */
async function periodRows(
  cik: number,
  filings: FilingMeta[],
  period: string,
): Promise<{ rows: RawRow[]; ref: ThirteenFFilingRef } | null> {
  const same = filings
    .filter((f) => f.period === period)
    .sort((a, b) => a.filed.localeCompare(b.filed) || a.accession.localeCompare(b.accession));
  const base = same.find((f) => f.form === "13F-HR");
  if (!base) return null;
  let rows = await filingRows(cik, base.accession);
  let last = base;
  let amended = false;
  for (const a of same.filter((f) => f.form === "13F-HR/A" && f !== base)) {
    if (a.filed < base.filed) continue;
    const [type, aRows] = await Promise.all([
      amendmentType(cik, a.accession),
      filingRows(cik, a.accession),
    ]);
    if (!aRows.length) continue;
    if (type === "RESTATEMENT" || sumValue(aRows) >= 0.5 * sumValue(rows)) rows = aRows;
    else rows = rows.concat(aRows);
    last = a;
    amended = true;
  }
  return { rows, ref: filingRef(cik, last, amended ? "13F-HR/A" : "13F-HR") };
}

/** Pre-2023 convention (and a few filers since): <value> in $ thousands. */
function fixThousands(rows: RawRow[]): boolean {
  const px = rows
    .filter((r) => !r.putCall && r.shType !== "PRN" && r.shares > 0 && r.value > 0)
    .map((r) => r.value / r.shares)
    .sort((a, b) => a - b);
  if (px.length < 3) return false;
  const median = px[Math.floor(px.length / 2)];
  if (median >= 1) return false;
  for (const r of rows) r.value *= 1000;
  return true;
}

// --- Ticker mapping ---------------------------------------------------------

function seedLookup(cusip: string): SeedEntry | undefined {
  if (figiCache.has(cusip)) return figiCache.get(cusip);
  if (cusip in SEED) return SEED[cusip];
  return undefined;
}

const FIGI_PREF = ["Common Stock", "ADR", "REIT", "ETP", "Closed-End Fund", "Mutual Fund", "Preference", "MLP"];

async function resolveMissing(cusips: string[]): Promise<void> {
  const todo = cusips.filter((c) => seedLookup(c) === undefined);
  if (!todo.length || Date.now() < figiBlockedUntil) return;
  const key = (process.env.OPENFIGI_API_KEY || "").trim();
  const batch = key ? 100 : 10;
  const maxReq = key ? 5 : 3;
  for (let i = 0, n = 0; i < todo.length && n < maxReq; i += batch, n += 1) {
    const chunk = todo.slice(i, i + batch);
    try {
      const res = await fetch("https://api.openfigi.com/v3/mapping", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "X-OPENFIGI-APIKEY": key } : {}),
        },
        body: JSON.stringify(chunk.map((c) => ({ idType: "ID_CUSIP", idValue: c, exchCode: "US" }))),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (res.status === 429) {
        figiBlockedUntil = Date.now() + 60_000;
        return;
      }
      if (!res.ok) return;
      const out = (await res.json()) as {
        data?: { ticker?: string; name?: string; securityType?: string }[];
      }[];
      chunk.forEach((c, j) => {
        const data = out[j]?.data || [];
        if (!data.length) {
          figiCache.set(c, null);
          return;
        }
        const rank = (t?: string) => {
          const k = FIGI_PREF.indexOf(t || "");
          return k < 0 ? 99 : k;
        };
        const best = [...data].sort((a, b) => rank(a.securityType) - rank(b.securityType))[0];
        figiCache.set(c, [best.ticker || "", best.name || "", best.securityType || ""]);
      });
    } catch {
      return;
    }
  }
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (/\d|&/.test(w) || w.length <= 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

function identity(cusip: string, issuer: string) {
  const hit = seedLookup(cusip);
  const ticker = displayTicker(hit?.[0]);
  return {
    ticker,
    name: titleCase(hit?.[1] || issuer),
    name_ko: ticker ? TICKER_NAME_KO[ticker] || null : null,
  };
}

// --- Aggregation ------------------------------------------------------------

type Agg = { cusip: string; name: string; cls: string; value: number; shares: number; debt: boolean };

const isDebtRow = (r: RawRow) => r.shType === "PRN" || /\b(NOTE|NOTES|BOND|DEBT|DEBENTURE)\b/i.test(r.cls);

function aggregate(rows: RawRow[]) {
  const eq = new Map<string, Agg>();
  const opt = new Map<string, { cusip: string; name: string; putCall: "Put" | "Call"; value: number }>();
  for (const r of rows) {
    if (!r.cusip) continue;
    if (r.putCall) {
      const pc = /^put$/i.test(r.putCall) ? "Put" : "Call";
      const k = `${r.cusip}:${pc}`;
      const o = opt.get(k) || { cusip: r.cusip, name: r.name, putCall: pc, value: 0 };
      o.value += r.value;
      opt.set(k, o);
      continue;
    }
    const a =
      eq.get(r.cusip) || { cusip: r.cusip, name: r.name, cls: r.cls, value: 0, shares: 0, debt: false };
    a.value += r.value;
    a.shares += r.shares;
    a.debt = a.debt || isDebtRow(r);
    eq.set(r.cusip, a);
  }
  return { eq, opt };
}

function classify(shares: number, prev: number | null): { change: ThirteenFChange; pct: number | null } {
  if (prev == null || prev <= 0) return { change: "new", pct: null };
  const pct = (shares - prev) / prev;
  if (Math.abs(pct) < HELD_BAND) return { change: "held", pct: pct * 100 };
  return { change: pct > 0 ? "added" : "trimmed", pct: pct * 100 };
}

const round = (v: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

async function buildFund(inv: ThirteenFInvestor): Promise<ThirteenFFundDetail> {
  const filings = await listFilings(inv.cik);
  const periods = [...new Set(filings.map((f) => f.period))].sort().reverse();
  let cur: Awaited<ReturnType<typeof periodRows>> = null;
  let pi = 0;
  for (; pi < periods.length && !cur; pi += 1) cur = await periodRows(inv.cik, filings, periods[pi]);
  if (!cur) throw new Error("13F-HR 공시 없음");
  let prev: Awaited<ReturnType<typeof periodRows>> = null;
  for (; pi < periods.length && !prev; pi += 1) prev = await periodRows(inv.cik, filings, periods[pi]);

  const fixed = fixThousands(cur.rows);
  if (prev) fixThousands(prev.rows);

  const now = aggregate(cur.rows);
  const before = prev ? aggregate(prev.rows) : null;

  const ranked = (m: Map<string, Agg>) => [...m.values()].sort((a, b) => b.value - a.value);
  const nowList = ranked(now.eq);
  const prevList = before ? ranked(before.eq) : [];
  await resolveMissing(
    [...nowList.slice(0, 60), ...prevList.slice(0, 30)]
      .map((a) => a.cusip)
      .concat([...now.opt.values()].map((o) => o.cusip)),
  );

  const total = nowList.reduce((s, a) => s + a.value, 0);
  const prevTotal = prevList.reduce((s, a) => s + a.value, 0);

  // Pair CUSIP changes (reorgs, re-domiciles) via ticker so they don't show as new + exited.
  const prevByCusip = new Map(prevList.map((a) => [a.cusip, a]));
  const prevByTicker = new Map<string, Agg>();
  for (const a of prevList) {
    const t = identity(a.cusip, a.name).ticker;
    if (t && !now.eq.has(a.cusip)) prevByTicker.set(t, a);
  }
  const consumed = new Set<string>();

  const holdings: ThirteenFHolding[] = nowList.map((a) => {
    const id = identity(a.cusip, a.name);
    let p = prevByCusip.get(a.cusip) || null;
    if (!p && id.ticker && prevByTicker.has(id.ticker)) p = prevByTicker.get(id.ticker) || null;
    if (p) consumed.add(p.cusip);
    const c = before ? classify(a.shares, p ? p.shares : null) : { change: "held" as const, pct: null };
    return {
      cusip: a.cusip,
      ...id,
      cls: a.cls,
      is_debt: a.debt,
      value_usd: a.value,
      shares: a.shares,
      weight_pct: total > 0 ? round((a.value / total) * 100, 3) : 0,
      prev_shares: p ? p.shares : null,
      prev_value_usd: p ? p.value : null,
      prev_weight_pct: p && prevTotal > 0 ? round((p.value / prevTotal) * 100, 3) : null,
      shares_chg_pct: c.pct == null ? null : round(c.pct, 1),
      change: c.change,
    };
  });

  const exited: ThirteenFHolding[] = prevList
    .filter((p) => !consumed.has(p.cusip))
    .map((p) => ({
      cusip: p.cusip,
      ...identity(p.cusip, p.name),
      cls: p.cls,
      is_debt: p.debt,
      value_usd: 0,
      shares: 0,
      weight_pct: 0,
      prev_shares: p.shares,
      prev_value_usd: p.value,
      prev_weight_pct: prevTotal > 0 ? round((p.value / prevTotal) * 100, 3) : null,
      shares_chg_pct: -100,
      change: "exited" as const,
    }));

  const options: ThirteenFOption[] = [...now.opt.values()]
    .sort((a, b) => b.value - a.value)
    .map((o) => {
      const id = identity(o.cusip, o.name);
      return { cusip: o.cusip, ticker: id.ticker, name: id.name, put_call: o.putCall, value_usd: o.value };
    });

  const changes: ThirteenFChangeCounts = { new: 0, added: 0, trimmed: 0, held: 0, exited: exited.length };
  if (before) for (const h of holdings) changes[h.change] += 1;
  else changes.held = holdings.length;

  const top10 = holdings.slice(0, 10).reduce((s, h) => s + h.weight_pct, 0);
  const ageDays = (Date.now() - Date.parse(`${cur.ref.period}T00:00:00Z`)) / 86_400_000;

  return {
    investor: inv,
    filing: cur.ref,
    prev_filing: prev ? prev.ref : null,
    stale: ageDays > STALE_DAYS,
    equity_value_usd: total,
    prev_equity_value_usd: prev ? prevTotal : null,
    positions: holdings.length,
    option_rows: options.length,
    sec_rows: cur.rows.length,
    top10_pct: round(top10, 1),
    style: top10 >= 70 ? "집중형" : top10 >= 40 ? "균형형" : "분산형",
    changes,
    value_in_thousands_fixed: fixed,
    top: holdings.slice(0, 10),
    holdings,
    exited,
    options,
  };
}

export async function getFundDetail(id: string): Promise<ThirteenFFundDetail> {
  const inv = findInvestor(id);
  if (!inv) throw new Error(`unknown investor: ${id}`);
  return withServerCache(`13f:fund:v2:${inv.id}`, FUND_TTL, FUND_STALE, () => buildFund(inv));
}

function summarize(d: ThirteenFFundDetail): ThirteenFFundSummary {
  const { holdings: _h, exited: _e, options: _o, ...rest } = d;
  void _h;
  void _e;
  void _o;
  return rest;
}

async function allFunds() {
  const out: { inv: ThirteenFInvestor; detail?: ThirteenFFundDetail; error?: string }[] = [];
  const queue = [...THIRTEENF_INVESTORS];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let inv = queue.shift(); inv; inv = queue.shift()) {
        try {
          out.push({ inv, detail: await getFundDetail(inv.id) });
        } catch (exc) {
          out.push({ inv, error: exc instanceof Error ? exc.message : String(exc) });
        }
      }
    }),
  );
  const order = new Map(THIRTEENF_INVESTORS.map((x, i) => [x.id, i]));
  return out.sort((a, b) => (order.get(a.inv.id) ?? 0) - (order.get(b.inv.id) ?? 0));
}

const holdKey = (h: ThirteenFHolding) => h.ticker || h.cusip;

function consensusRows(
  funds: ThirteenFFundDetail[],
  pick: (d: ThirteenFFundDetail) => { h: ThirteenFHolding; weight: number }[],
): ThirteenFConsensusRow[] {
  const m = new Map<string, ThirteenFConsensusRow>();
  for (const d of funds) {
    const seen = new Set<string>();
    for (const { h, weight } of pick(d)) {
      const k = holdKey(h);
      if (seen.has(k)) continue;
      seen.add(k);
      const row =
        m.get(k) ||
        ({
          key: k,
          ticker: h.ticker,
          name: h.name,
          name_ko: h.name_ko,
          holders: 0,
          value_usd: 0,
          avg_weight_pct: 0,
          investors: [],
        } as ThirteenFConsensusRow);
      row.holders += 1;
      row.value_usd += h.value_usd || h.prev_value_usd || 0;
      row.investors.push({ id: d.investor.id, name_ko: d.investor.name_ko, weight_pct: weight, change: h.change });
      m.set(k, row);
    }
  }
  const rows = [...m.values()];
  for (const r of rows) {
    r.avg_weight_pct = round(r.investors.reduce((s, x) => s + x.weight_pct, 0) / r.investors.length, 2);
    r.investors.sort((a, b) => b.weight_pct - a.weight_pct);
  }
  return rows
    .filter((r) => r.holders >= 2)
    .sort((a, b) => b.holders - a.holders || b.value_usd - a.value_usd)
    .slice(0, 25);
}

const isConviction = (h: ThirteenFHolding, rank: number) =>
  !h.is_debt && (rank < CONVICTION_TOP || h.weight_pct >= CONVICTION_WEIGHT);

export async function getOverview(): Promise<ThirteenFOverview> {
  return withServerCache("13f:overview:v2", FUND_TTL, FUND_STALE, async () => {
    const all = await allFunds();
    const ok = all.flatMap((x) => (x.detail ? [x.detail] : []));
    const current = ok.filter((d) => !d.stale);
    const latest = current.map((d) => d.filing.period).sort().pop() || null;

    const consensus = consensusRows(current, (d) =>
      d.holdings.filter(isConviction).map((h) => ({ h, weight: h.weight_pct })),
    );
    const mostBought = consensusRows(current, (d) =>
      d.holdings
        .filter((h, i) => isConviction(h, i) && (h.change === "new" || h.change === "added"))
        .map((h) => ({ h, weight: h.weight_pct })),
    );
    const mostSold = consensusRows(current, (d) => {
      const trimmed = d.holdings
        .filter((h, i) => isConviction(h, i) && h.change === "trimmed")
        .map((h) => ({ h, weight: h.weight_pct }));
      const exited = d.exited
        .filter((h) => !h.is_debt && (h.prev_weight_pct ?? 0) >= CONVICTION_WEIGHT)
        .map((h) => ({ h, weight: h.prev_weight_pct ?? 0 }));
      return [...exited, ...trimmed];
    });

    return {
      generated_at: new Date().toISOString(),
      latest_period: latest,
      funds: ok.map(summarize),
      failed: all
        .filter((x) => x.error)
        .map((x) => ({ id: x.inv.id, name_ko: x.inv.name_ko, error: x.error || "" })),
      consensus,
      most_bought: mostBought.slice(0, 15),
      most_sold: mostSold.slice(0, 15),
    };
  });
}

export async function lookupHolders(query: string): Promise<ThirteenFLookup> {
  const q = query.trim().toUpperCase();
  const all = await allFunds();
  const rows: ThirteenFLookup["rows"] = [];
  for (const x of all) {
    const d = x.detail;
    if (!d) continue;
    d.holdings.forEach((h, i) => {
      const hit =
        h.ticker === q ||
        h.cusip === q ||
        (q.length >= 3 && (h.name.toUpperCase().includes(q) || (h.name_ko || "").includes(query.trim())));
      if (hit) rows.push({ investor: d.investor, period: d.filing.period, holding: h, rank: i + 1 });
    });
  }
  rows.sort((a, b) => b.holding.weight_pct - a.holding.weight_pct);
  return { query: query.trim(), rows: rows.slice(0, 80) };
}
