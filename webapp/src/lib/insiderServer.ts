/**
 * SEC Form 4 ingest → R2 day shards → precomputed summary for the 내부자 매매 tab.
 *
 * Live: EDGAR "latest filings" Atom feed (newest ~400 entries) every cron run.
 * Backfill: daily form index for the first BACKFILL_DAYS, resumable via offsets.
 * Reconcile: once a live day's daily index is published, that day is queued like
 * a backfill day so filings the Atom feed skipped (bursts > ATOM_PAGES pages
 * between two cron runs) are picked up. `seen` keeps already-parsed filings out.
 * Only open-market buys (P) and sells (S) are kept in shards; ticker lookups
 * fetch the full Form 4 history straight from EDGAR.
 */

import { withServerCache } from "@/lib/apiCache";
import { fetchYahooCandles } from "@/lib/binanceMarketFallback";
import type {
  InsiderCluster,
  InsiderDay,
  InsiderLookup,
  InsiderNetRow,
  InsiderPriced,
  InsiderSummary,
  InsiderTx,
} from "@/lib/insiderTrading";
import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";

const FALLBACK_UA = "SavvyETF contact@savvyetf.com";
const SEC_UA = (process.env.SEC_EDGAR_USER_AGENT || "").trim() || FALLBACK_UA;

const PREFIX = "insider/us/";
const STATE_KEY = `${PREFIX}state.json`;
const SUMMARY_KEY = `${PREFIX}summary.json`;
const dayKey = (day: string) => `${PREFIX}days/${day}.json`;

const BACKFILL_DAYS = 14;
const SUMMARY_DAYS = 30;
const CLUSTER_DAYS = 14;
const SEEN_KEEP_DAYS = 6;
const ATOM_PAGES = 4;
/** Live days are re-checked against the daily index this many days back (< SEEN_KEEP_DAYS). */
const RECONCILE_DAYS = 4;
/** Hard cap on the Yahoo price pass so the cron stays inside maxDuration. */
const PRICE_BUDGET_MS = 25_000;
const PRICE_TICKERS_MAX = 120;

// --- SEC fetch: ≤10 req/s policy → paced starts + small concurrency pool ----

const SEC_GAP_MS = 125;
const SEC_CONCURRENCY = 6;
let secNextAt = 0;
let secActive = 0;
const secQueue: (() => void)[] = [];

async function secSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (secActive >= SEC_CONCURRENCY) {
    await new Promise<void>((resolve) => secQueue.push(resolve));
  }
  secActive += 1;
  try {
    const now = Date.now();
    const at = Math.max(now, secNextAt);
    secNextAt = at + SEC_GAP_MS;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
    return await fn();
  } finally {
    secActive -= 1;
    secQueue.shift()?.();
  }
}

/**
 * Returns null for absent files when `missingOk`. EDGAR answers 403 for absent
 * daily-index files ("index"), but 403 is also its rate-limit reply, so filing
 * fetches pass "404" and a throttle surfaces as an error (→ retried later).
 * An absent archive file is a storage "AccessDenied" XML; the throttle reply is
 * an HTML page, so only the former counts as missing.
 */
async function secFetch(url: string, missingOk: boolean | "index" | "404" = false): Promise<string | null> {
  return secSlot(async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": SEC_UA, Accept: "*/*" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return res.text();
    if (missingOk && res.status === 404) return null;
    if ((missingOk === true || missingOk === "index") && res.status === 403) {
      const body = await res.text().catch(() => "");
      if (/<Code>AccessDenied<\/Code>/i.test(body)) return null;
    }
    throw new Error(`SEC ${res.status} ${url.replace(/^https:\/\/[^/]+/, "")}`);
  });
}

// --- Dates (ET) ---------------------------------------------------------------

function etDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function daysBack(day: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftDay(day, -i));
}

// --- Form 4 parsing -------------------------------------------------------------

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function inner(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : "";
}

/** Form 4 wraps most leaves in `<value>`; plain text otherwise. */
function val(block: string, tag: string): string {
  const raw = inner(block, tag);
  const v = raw.match(/<value>([\s\S]*?)<\/value>/i);
  return decodeXml(v ? v[1] : raw.replace(/<[^>]+>/g, ""));
}

function num(s: string): number | null {
  if (!s) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "NYSE: ABC", "GOOGL, GOOG", "abc " → "ABC" / "GOOGL". */
export function cleanTicker(raw: string): string {
  let t = raw.toUpperCase().trim();
  if (t.includes(":")) t = t.slice(t.lastIndexOf(":") + 1);
  t = t.split(/[,;/|]|\s+AND\s+/)[0] || "";
  return t.replace(/\s+/g, "");
}

const PLAN_RE = /10b5[\s\-\u2010-\u2015]?1/i;

function flag(s: string): boolean {
  return /^(1|true)$/i.test(s.trim());
}

const C_SUITE_RE =
  /\b(CEO|CFO|COO|Chief Executive|Chief Financial|Chief Operating|Chair(man|woman|person)?)\b/i;

function isCSuite(title: string): boolean {
  if (C_SUITE_RE.test(title)) return true;
  return /\bPresident\b/i.test(title) && !/vice\s*president|\bV\.?P\b/i.test(title);
}

type FilingMeta = { acc: string; cik: string; filed: string; filed_time: string | null };

function filingUrl(m: FilingMeta): string {
  return `https://www.sec.gov/Archives/edgar/data/${m.cik}/${m.acc.replace(/-/g, "")}/${m.acc}-index.htm`;
}

export function parseForm4(raw: string, meta: FilingMeta): InsiderTx[] {
  const doc = raw.match(/<ownershipDocument>[\s\S]*?<\/ownershipDocument>/i)?.[0];
  if (!doc) return [];
  if (val(doc, "documentType") !== "4") return [];
  const issuer = inner(doc, "issuer");
  const ticker = cleanTicker(val(issuer, "issuerTradingSymbol"));
  if (!ticker || /^(NONE|N\/?A|-+)$/.test(ticker) || ticker.length > 10) return [];

  const owners = [...doc.matchAll(/<reportingOwner>([\s\S]*?)<\/reportingOwner>/gi)].map(
    (m) => {
      const b = m[1];
      return {
        name: val(b, "rptOwnerName"),
        cik: val(b, "rptOwnerCik").replace(/^0+/, ""),
        director: flag(val(b, "isDirector")),
        officer: flag(val(b, "isOfficer")),
        tenPct: flag(val(b, "isTenPercentOwner")),
        title: val(b, "officerTitle"),
      };
    },
  );
  if (!owners.length) return [];
  const first = owners[0];
  const isOfficer = owners.some((o) => o.officer);
  const isDirector = owners.some((o) => o.director);
  const isTenPct = owners.some((o) => o.tenPct);
  const title = owners.find((o) => o.title)?.title || "";
  const role = (
    isOfficer && title
      ? title
      : isDirector
        ? "Director"
        : isTenPct
          ? "10% Owner"
          : isOfficer
            ? "Officer"
            : "Other"
  ).slice(0, 60);
  const ownerName = owners.length > 1 ? `${first.name} 외 ${owners.length - 1}` : first.name;

  const aff = flag(val(doc, "aff10b5One"));
  const footnotes = new Map<string, string>();
  for (const m of doc.matchAll(/<footnote id="(\w+)">([\s\S]*?)<\/footnote>/gi)) {
    footnotes.set(m[1], m[2]);
  }

  const out: InsiderTx[] = [];
  const blocks = [...doc.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)];
  blocks.forEach((m, i) => {
    const b = m[1];
    const code = val(b, "transactionCode").toUpperCase();
    const shares = num(val(b, "transactionShares"));
    if (!code || !shares || shares <= 0) return;
    const price = num(val(b, "transactionPricePerShare"));
    const acquired = val(b, "transactionAcquiredDisposedCode").toUpperCase() !== "D";
    const after = num(val(b, "sharesOwnedFollowingTransaction"));
    const before = after == null ? null : acquired ? after - shares : after + shares;
    const fnIds = [...b.matchAll(/footnoteId id="(\w+)"/gi)].map((f) => f[1]);
    const plan = aff || fnIds.some((id) => PLAN_RE.test(footnotes.get(id) || ""));
    out.push({
      id: `${meta.acc}:${i}`,
      acc: meta.acc,
      filed: meta.filed,
      filed_time: meta.filed_time,
      ticker,
      issuer: val(issuer, "issuerName").slice(0, 80),
      issuer_cik: val(issuer, "issuerCik").replace(/^0+/, ""),
      owner: ownerName.slice(0, 80),
      owner_cik: first.cik,
      role,
      is_director: isDirector,
      is_officer: isOfficer,
      is_ten_pct: isTenPct,
      c_suite: isOfficer && isCSuite(title),
      date: val(b, "transactionDate").slice(0, 10) || meta.filed,
      code,
      acquired,
      shares,
      price: price != null && price > 0 ? price : null,
      value: price != null && price > 0 ? Math.round(shares * price) : 0,
      owned_after: after,
      own_chg_pct: before != null && before > 0 ? (shares / before) * 100 : null,
      direct: val(b, "directOrIndirectOwnership").toUpperCase() !== "I",
      plan_10b5_1: plan,
      url: filingUrl(meta),
    });
  });
  return out;
}

async function fetchFiling(meta: FilingMeta): Promise<InsiderTx[]> {
  const url = `https://www.sec.gov/Archives/edgar/data/${meta.cik}/${meta.acc.replace(/-/g, "")}/${meta.acc}.txt`;
  const raw = await secFetch(url, "404");
  return raw ? parseForm4(raw, meta) : [];
}

// --- Discovery ------------------------------------------------------------------

async function latestFilings(seen: Set<string>): Promise<FilingMeta[]> {
  const out = new Map<string, FilingMeta>();
  for (let page = 0; page < ATOM_PAGES; page += 1) {
    const xml = await secFetch(
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&start=${page * 100}&count=100&output=atom`,
    );
    if (!xml) break;
    let fresh = 0;
    for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
      const e = m[1];
      if (!/^4 - /.test(decodeXml(inner(e, "title")))) continue;
      const link = e.match(/\/data\/(\d+)\/\d+\/(\d{10}-\d{2}-\d{6})-index\.htm/);
      const updated = decodeXml(inner(e, "updated"));
      if (!link || !updated) continue;
      const acc = link[2];
      if (seen.has(acc)) continue;
      fresh += 1;
      if (!out.has(acc)) {
        out.set(acc, {
          acc,
          cik: link[1],
          filed: updated.slice(0, 10),
          filed_time: updated.slice(11, 16) || null,
        });
      }
    }
    if (!fresh) break;
  }
  return [...out.values()];
}

async function dailyIndex(day: string): Promise<FilingMeta[] | null> {
  const [y, m] = day.split("-").map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  const raw = await secFetch(
    `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${q}/form.${day.replace(/-/g, "")}.idx`,
    true,
  );
  if (raw == null) return null;
  const out = new Map<string, FilingMeta>();
  for (const line of raw.split("\n")) {
    const m = line.match(/^4\s{2,}.*\s(\d{8})\s+edgar\/data\/(\d+)\/(\d{10}-\d{2}-\d{6})\.txt\s*$/);
    if (!m || out.has(m[3])) continue;
    out.set(m[3], { acc: m[3], cik: m[2], filed: day, filed_time: null });
  }
  return [...out.values()].sort((a, b) => a.acc.localeCompare(b.acc));
}

// --- R2 state + shards ----------------------------------------------------------

type IngestState = {
  live_since: string | null;
  seen: Record<string, string[]>;
  pending: Array<{ day: string; offset: number }>;
  /** Days whose daily index has been fully swept (backfill or reconcile). */
  done_days?: string[];
  last_run: string | null;
};

async function readJson<T>(key: string): Promise<T | null> {
  const text = await r2GetObjectText(key);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function writeJson(key: string, data: unknown, cache = "public, max-age=60"): Promise<void> {
  await r2PutObject(key, JSON.stringify(data), "application/json; charset=utf-8", cache);
}

async function loadShard(day: string): Promise<InsiderTx[]> {
  return (await readJson<{ rows?: InsiderTx[] }>(dayKey(day)))?.rows || [];
}

async function mergeShards(rows: InsiderTx[]): Promise<void> {
  const byDay = new Map<string, InsiderTx[]>();
  for (const r of rows) {
    const list = byDay.get(r.filed) || [];
    list.push(r);
    byDay.set(r.filed, list);
  }
  for (const [day, add] of byDay) {
    const merged = new Map((await loadShard(day)).map((r) => [r.id, r]));
    for (const r of add) merged.set(r.id, r);
    await writeJson(dayKey(day), { date: day, rows: [...merged.values()] }, "public, max-age=300");
  }
}

const KEEP_CODES = new Set(["P", "S"]);

/** Fetches filings in pool-sized batches until done or the deadline; returns how many ran. */
async function processBatch(
  jobs: FilingMeta[],
  deadline: number,
  sink: InsiderTx[],
): Promise<{ done: number; failed: number; failedAccs: Set<string> }> {
  let done = 0;
  let failed = 0;
  const failedAccs = new Set<string>();
  const step = SEC_CONCURRENCY * 4;
  while (done < jobs.length && Date.now() < deadline) {
    const slice = jobs.slice(done, done + step);
    const results = await Promise.allSettled(slice.map(fetchFiling));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        for (const tx of r.value) if (KEEP_CODES.has(tx.code)) sink.push(tx);
      } else {
        failed += 1;
        failedAccs.add(slice[i].acc);
      }
    });
    done += slice.length;
  }
  return { done, failed, failedAccs };
}

export type IngestStats = {
  ok: boolean;
  live_new: number;
  backfill_done: number;
  failed: number;
  rows_added: number;
  pending_days: number;
  summary_tx: number;
  ms: number;
};

export async function runInsiderIngest(budgetMs = 70_000): Promise<IngestStats> {
  if (!r2Configured()) throw new Error("R2 is not configured");
  const t0 = Date.now();
  const deadline = t0 + budgetMs;
  const today = etDate();
  const state: IngestState = (await readJson<IngestState>(STATE_KEY)) || {
    live_since: null,
    seen: {},
    pending: [],
    last_run: null,
  };
  if (!state.live_since) {
    state.live_since = today;
    state.pending = daysBack(today, BACKFILL_DAYS).map((day) => ({ day, offset: 0 }));
  }
  const doneDays = new Set(state.done_days || []);
  for (let i = 1; i <= RECONCILE_DAYS; i += 1) {
    const day = shiftDay(today, -i);
    if (day < state.live_since || doneDays.has(day)) continue;
    if (!state.pending.some((p) => p.day === day)) state.pending.push({ day, offset: 0 });
  }
  const finishDay = (day: string) => {
    state.pending = state.pending.filter((x) => x.day !== day);
    doneDays.add(day);
  };
  const seen = new Set(Object.values(state.seen).flat());
  const markSeen = (m: FilingMeta) => {
    if (m.filed < shiftDay(today, -SEEN_KEEP_DAYS)) return;
    (state.seen[m.filed] ||= []).push(m.acc);
    seen.add(m.acc);
  };

  const rows: InsiderTx[] = [];
  let failed = 0;

  const live = await latestFilings(seen).catch(() => {
    failed += 1;
    return [] as FilingMeta[];
  });
  const liveRun = await processBatch(live, deadline, rows);
  // Failed (e.g. throttled) filings stay unseen so the reconcile pass retries them.
  live.slice(0, liveRun.done).filter((m) => !liveRun.failedAccs.has(m.acc)).forEach(markSeen);
  failed += liveRun.failed;

  let backfillDone = 0;
  const backfillDeadline = deadline - 15_000;
  const pending = [...state.pending].sort((a, b) => b.day.localeCompare(a.day));
  for (const p of pending) {
    if (Date.now() >= backfillDeadline) break;
    let list: FilingMeta[] | null;
    try {
      list = await dailyIndex(p.day);
    } catch {
      // Throttled (or SEC down): keep every pending day for the next run.
      failed += 1;
      break;
    }
    if (list == null) {
      // Index not published yet (recent) or no filings that day (weekend/holiday).
      if (p.day < shiftDay(today, -RECONCILE_DAYS)) finishDay(p.day);
      continue;
    }
    const todo = list.slice(p.offset).filter((m) => !seen.has(m.acc));
    const run = await processBatch(todo, backfillDeadline, rows);
    todo.slice(0, run.done).filter((m) => !run.failedAccs.has(m.acc)).forEach(markSeen);
    backfillDone += run.done;
    failed += run.failed;
    // Inside the reconcile window `seen` already skips parsed filings, so a day with
    // failures restarts from 0 and the failed ones are retried on the next run.
    const retry = run.failed > 0 && p.day >= shiftDay(today, -RECONCILE_DAYS);
    if (run.done >= todo.length && !retry) {
      finishDay(p.day);
    } else {
      const lastAcc = todo[run.done - 1]?.acc;
      const idx = retry ? 0 : lastAcc ? list.findIndex((m) => m.acc === lastAcc) + 1 : p.offset;
      state.pending = state.pending.map((x) => (x.day === p.day ? { ...x, offset: idx } : x));
    }
  }

  if (rows.length) await mergeShards(rows);

  const cutoff = shiftDay(today, -SEEN_KEEP_DAYS);
  for (const day of Object.keys(state.seen)) if (day < cutoff) delete state.seen[day];
  state.done_days = [...doneDays].sort().slice(-BACKFILL_DAYS - RECONCILE_DAYS);
  state.last_run = new Date().toISOString();
  await writeJson(STATE_KEY, state, "private, max-age=0");

  const summary = await buildSummary(today, state);
  await writeJson(SUMMARY_KEY, summary, "public, max-age=60");

  return {
    ok: true,
    live_new: liveRun.done,
    backfill_done: backfillDone,
    failed,
    rows_added: rows.length,
    pending_days: state.pending.length,
    summary_tx: summary.coverage.tx,
    ms: Date.now() - t0,
  };
}

// --- Summary --------------------------------------------------------------------

/** One Form 4 often splits a single purchase across price tiers — merge per filing. */
function aggregateByFiling(rows: InsiderTx[]): InsiderTx[] {
  const groups = new Map<string, InsiderTx[]>();
  for (const r of rows) {
    const k = `${r.acc}|${r.code}`;
    const g = groups.get(k) || [];
    g.push(r);
    groups.set(k, g);
  }
  const out: InsiderTx[] = [];
  for (const [k, g] of groups) {
    if (g.length === 1) {
      out.push(g[0]);
      continue;
    }
    g.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    const last = g[g.length - 1];
    const shares = g.reduce((s, r) => s + r.shares, 0);
    const value = g.reduce((s, r) => s + r.value, 0);
    const after = last.owned_after;
    const before = after == null ? null : last.acquired ? after - shares : after + shares;
    out.push({
      ...last,
      id: k,
      date: g.reduce((d, r) => (r.date > d ? r.date : d), g[0].date),
      shares,
      value,
      price: value > 0 ? value / shares : null,
      own_chg_pct: before != null && before > 0 ? (shares / before) * 100 : null,
      plan_10b5_1: g.some((r) => r.plan_10b5_1),
    });
  }
  return out;
}

/** Same insider buying the same stock across several filings → one row (weighted avg price). */
function mergeByInsider(rows: InsiderTx[]): InsiderTx[] {
  const groups = new Map<string, InsiderTx[]>();
  for (const r of rows) {
    const k = `${r.owner_cik || r.owner}|${r.ticker}`;
    const g = groups.get(k) || [];
    g.push(r);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    const latest = [...g].sort(byFiledDesc)[0];
    const shares = g.reduce((s, r) => s + r.shares, 0);
    const value = g.reduce((s, r) => s + r.value, 0);
    const after = g.reduce<number | null>(
      (m, r) => (r.owned_after != null && (m == null || r.owned_after > m) ? r.owned_after : m),
      null,
    );
    const before = after == null ? null : after - shares;
    return {
      ...latest,
      id: `${latest.id}+${g.length - 1}`,
      date: g.reduce((d, r) => (r.date > d ? r.date : d), g[0].date),
      shares,
      value,
      price: value > 0 ? value / shares : null,
      owned_after: after,
      own_chg_pct: before != null && before > 0 ? (shares / before) * 100 : null,
    };
  });
}

function byFiledDesc(a: InsiderTx, b: InsiderTx): number {
  return (
    b.filed.localeCompare(a.filed) ||
    (b.filed_time || "").localeCompare(a.filed_time || "") ||
    b.value - a.value
  );
}

function yahooSymbol(ticker: string): string {
  return ticker.replace(/\./g, "-");
}

type PriceStat = { last: number; high52: number | null };

/** Last close + 52-week high per ticker; stops starting new batches after PRICE_BUDGET_MS. */
async function priceStats(tickers: string[]): Promise<Map<string, PriceStat>> {
  const out = new Map<string, PriceStat>();
  const list = [...new Set(tickers)].slice(0, PRICE_TICKERS_MAX);
  const deadline = Date.now() + PRICE_BUDGET_MS;
  for (let i = 0; i < list.length && Date.now() < deadline; i += 10) {
    await Promise.all(
      list.slice(i, i + 10).map(async (t) => {
        const candles = await fetchYahooCandles(yahooSymbol(t), 260);
        const px = candles[candles.length - 1]?.value;
        if (px == null || !(px > 0)) return;
        const high = candles.length >= 120 ? Math.max(...candles.map((c) => c.value)) : null;
        out.set(t, { last: px, high52: high });
      }),
    );
  }
  return out;
}

function retPct(last: number | null, base: number | null): number | null {
  return last != null && base != null && base > 0 ? (last / base - 1) * 100 : null;
}

async function buildSummary(today: string, state: IngestState): Promise<InsiderSummary> {
  const days = daysBack(today, SUMMARY_DAYS);
  const shards = await Promise.all(days.map(async (d) => ({ day: d, rows: await loadShard(d) })));
  const summary = summarizeInsider(today, shards, state.pending.length);
  const prices = await priceStats([
    ...summary.clusters.map((c) => c.ticker),
    ...summary.c_suite_buys.map((r) => r.ticker),
    ...summary.top_buys.map((r) => r.ticker),
  ]);
  const price = <
    T extends { ticker: string; last_price: number | null; ret_pct: number | null; dd_52w_pct: number | null },
  >(
    row: T,
    base: number | null,
  ): T => {
    const st = prices.get(row.ticker);
    const last = st?.last ?? null;
    return {
      ...row,
      last_price: last,
      ret_pct: retPct(last, base),
      dd_52w_pct: st?.high52 ? retPct(st.last, st.high52) : null,
    };
  };
  return {
    ...summary,
    clusters: summary.clusters.map((c) => price(c, c.avg_price)),
    top_buys: summary.top_buys.map((r) => price(r, r.price)),
    c_suite_buys: summary.c_suite_buys.map((r) => price(r, r.price)),
  };
}

/** Pure aggregation over day shards (prices are filled in by `buildSummary`). */
export function summarizeInsider(
  today: string,
  shards: Array<{ day: string; rows: InsiderTx[] }>,
  pendingDays: number,
): InsiderSummary {
  const present = shards.filter((s) => s.rows.length);
  const all = present.flatMap((s) => s.rows);
  const buysRaw = all.filter((r) => r.code === "P");
  const sellsRaw = all.filter((r) => r.code === "S");
  const insiderKey = (r: InsiderTx) => `${r.owner_cik || r.owner}|${r.ticker}`;

  const sentimentDays: InsiderDay[] = present
    .map((s) => {
      const b = s.rows.filter((r) => r.code === "P");
      const sl = s.rows.filter((r) => r.code === "S");
      return {
        date: s.day,
        buyers: new Set(b.map(insiderKey)).size,
        sellers: new Set(sl.map(insiderKey)).size,
        sellers_discretionary: new Set(sl.filter((r) => !r.plan_10b5_1).map(insiderKey)).size,
        buy_value: b.reduce((n, r) => n + r.value, 0),
        sell_value: sl.reduce((n, r) => n + r.value, 0),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const since7 = shiftDay(today, -6);
  const b7 = new Set(buysRaw.filter((r) => r.filed >= since7).map(insiderKey)).size;
  const s7rows = sellsRaw.filter((r) => r.filed >= since7);
  const s7 = new Set(s7rows.map(insiderKey)).size;
  const s7d = new Set(s7rows.filter((r) => !r.plan_10b5_1).map(insiderKey)).size;
  const b30 = new Set(buysRaw.map(insiderKey)).size;
  const s30 = new Set(sellsRaw.map(insiderKey)).size;

  const buys = aggregateByFiling(buysRaw).filter((r) => r.value > 0);
  const sells = aggregateByFiling(sellsRaw).filter((r) => r.value > 0);

  const clusterSince = shiftDay(today, -(CLUSTER_DAYS - 1));
  const byTicker = new Map<string, InsiderTx[]>();
  for (const r of buys) {
    // 10%-only holders are often sister fund vehicles that would inflate the insider count.
    if (r.filed < clusterSince || !(r.is_officer || r.is_director)) continue;
    const g = byTicker.get(r.ticker) || [];
    g.push(r);
    byTicker.set(r.ticker, g);
  }
  const clusters: InsiderCluster[] = [];
  for (const [ticker, g] of byTicker) {
    const people = new Map<string, InsiderCluster["insiders"][number]>();
    for (const r of g) {
      const k = r.owner_cik || r.owner;
      const p = people.get(k);
      if (p) {
        p.value += r.value;
        if (r.date > p.date) p.date = r.date;
      } else {
        people.set(k, { owner: r.owner, role: r.role, value: r.value, date: r.date, c_suite: r.c_suite });
      }
    }
    if (people.size < 2) continue;
    const shares = g.reduce((s, r) => s + r.shares, 0);
    const total = g.reduce((s, r) => s + r.value, 0);
    const dates = g.map((r) => r.date).sort();
    clusters.push({
      ticker,
      issuer: g[0].issuer,
      insiders: [...people.values()].sort((a, b) => b.value - a.value),
      n_insiders: people.size,
      total_value: total,
      shares,
      avg_price: shares > 0 && total > 0 ? total / shares : null,
      first_date: dates[0],
      last_date: dates[dates.length - 1],
      has_c_suite: [...people.values()].some((p) => p.c_suite),
      last_price: null,
      ret_pct: null,
      dd_52w_pct: null,
    });
  }
  clusters.sort((a, b) => b.n_insiders - a.n_insiders || b.total_value - a.total_value);
  const topClusters = clusters.slice(0, 40);

  const topBuys = mergeByInsider(buys.filter((r) => r.filed >= since7))
    .sort((a, b) => b.value - a.value)
    .slice(0, 40);
  const cSuiteBuys = buys
    .filter((r) => r.c_suite)
    .sort(byFiledDesc)
    .slice(0, 40);

  const net = new Map<string, InsiderNetRow & { _b: Set<string>; _s: Set<string> }>();
  for (const r of [...buys, ...sells]) {
    const row =
      net.get(r.ticker) ||
      {
        ticker: r.ticker,
        issuer: r.issuer,
        buy_value: 0,
        sell_value: 0,
        sell_value_discretionary: 0,
        net_value: 0,
        buyers: 0,
        sellers: 0,
        _b: new Set<string>(),
        _s: new Set<string>(),
      };
    if (r.code === "P") {
      row.buy_value += r.value;
      row._b.add(r.owner_cik || r.owner);
    } else {
      row.sell_value += r.value;
      if (!r.plan_10b5_1) row.sell_value_discretionary += r.value;
      row._s.add(r.owner_cik || r.owner);
    }
    net.set(r.ticker, row);
  }
  const netRows: InsiderNetRow[] = [...net.values()].map(({ _b, _s, ...row }) => ({
    ...row,
    net_value: row.buy_value - row.sell_value,
    buyers: _b.size,
    sellers: _s.size,
  }));

  const priced = (r: InsiderTx): InsiderPriced => ({
    ...r,
    last_price: null,
    ret_pct: null,
    dd_52w_pct: null,
  });

  const covered = present.map((s) => s.day).sort();
  return {
    ok: true,
    updated_at: new Date().toISOString(),
    coverage: {
      from: covered[0] || null,
      to: covered[covered.length - 1] || null,
      days: covered.length,
      tx: all.length,
    },
    backfill_pending: pendingDays,
    sentiment: {
      days: sentimentDays,
      buyers_7d: b7,
      sellers_7d: s7,
      sellers_discretionary_7d: s7d,
      ratio_7d: s7 ? b7 / s7 : null,
      ratio_30d: s30 ? b30 / s30 : null,
    },
    clusters: topClusters,
    top_buys: topBuys.map(priced),
    c_suite_buys: cSuiteBuys.map(priced),
    net_buyers: netRows
      .filter((r) => r.net_value > 0 && r.buy_value > 0)
      .sort((a, b) => b.net_value - a.net_value)
      .slice(0, 30),
    net_sellers: netRows
      .filter((r) => r.net_value < 0)
      .sort((a, b) => a.net_value - b.net_value)
      .slice(0, 30),
    latest_buys: [...buys].sort(byFiledDesc).slice(0, 100),
    latest_sells: [...sells].sort(byFiledDesc).slice(0, 100),
  };
}

function emptySummary(note: string): InsiderSummary {
  return {
    ok: true,
    updated_at: null,
    coverage: { from: null, to: null, days: 0, tx: 0 },
    backfill_pending: 0,
    sentiment: {
      days: [],
      buyers_7d: 0,
      sellers_7d: 0,
      sellers_discretionary_7d: 0,
      ratio_7d: null,
      ratio_30d: null,
    },
    clusters: [],
    top_buys: [],
    c_suite_buys: [],
    net_buyers: [],
    net_sellers: [],
    latest_buys: [],
    latest_sells: [],
    note,
  };
}

export async function getInsiderSummary(): Promise<InsiderSummary> {
  if (!r2Configured()) return emptySummary("저장소(R2)가 설정되지 않았습니다.");
  return withServerCache("insider:summary", 60_000, 10 * 60_000, async () => {
    const s = await readJson<InsiderSummary>(SUMMARY_KEY);
    return s || emptySummary("SEC Form 4 수집을 시작했습니다. 첫 집계까지 15분 정도 걸립니다.");
  });
}

// --- Ticker lookup (live EDGAR) -------------------------------------------------

async function tickerMap(): Promise<Map<string, { cik: string; title: string }>> {
  return withServerCache("insider:tickers", 24 * 3_600_000, 72 * 3_600_000, async () => {
    const raw = await secFetch("https://www.sec.gov/files/company_tickers.json");
    const d = JSON.parse(raw || "{}") as Record<string, { cik_str: number; ticker: string; title: string }>;
    const map = new Map<string, { cik: string; title: string }>();
    for (const row of Object.values(d)) {
      map.set(row.ticker.toUpperCase(), { cik: String(row.cik_str), title: row.title });
    }
    return map;
  });
}

const LOOKUP_DAYS = 365;
const LOOKUP_MAX_FILINGS = 60;

export async function lookupInsiderTicker(rawTicker: string): Promise<InsiderLookup> {
  const ticker = rawTicker.toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 10);
  const from = shiftDay(etDate(), -LOOKUP_DAYS);
  const empty = (error: string): InsiderLookup => ({
    ok: false,
    ticker,
    issuer: null,
    cik: null,
    from,
    filings: 0,
    covered_from: null,
    truncated: false,
    failed: 0,
    rows: [],
    totals: { buy_value: 0, sell_value: 0, sell_value_discretionary: 0, buyers: 0, sellers: 0 },
    last_price: null,
    error,
  });
  if (!ticker) return empty("티커를 입력해 주세요.");
  return withServerCache(`insider:lookup:${ticker}`, 6 * 3_600_000, 24 * 3_600_000, async () => {
    const map = await tickerMap();
    const hit = map.get(ticker) || map.get(ticker.replace(/\./g, "-"));
    if (!hit) return empty(`${ticker}: SEC 등록 종목을 찾지 못했습니다.`);
    const subsRaw = await secFetch(
      `https://data.sec.gov/submissions/CIK${hit.cik.padStart(10, "0")}.json`,
    );
    const recent =
      (JSON.parse(subsRaw || "{}") as { filings?: { recent?: Record<string, string[]> } }).filings
        ?.recent || {};
    const metas: FilingMeta[] = [];
    (recent.form || []).forEach((form, i) => {
      if (form !== "4") return;
      const filed = recent.filingDate?.[i] || "";
      if (filed < from) return;
      metas.push({ acc: recent.accessionNumber[i], cik: hit.cik, filed, filed_time: null });
    });
    const picked = metas.slice(0, LOOKUP_MAX_FILINGS);
    const settled = await Promise.allSettled(picked.map(fetchFiling));
    const failed = settled.filter((r) => r.status === "rejected").length;
    const rows = aggregateByFiling(
      settled
        .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
        .filter((r) => r.ticker === ticker || r.issuer_cik === hit.cik),
    ).sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value);
    const buys = rows.filter((r) => r.code === "P");
    const sells = rows.filter((r) => r.code === "S");
    const candles = await fetchYahooCandles(yahooSymbol(ticker), 5);
    return {
      ok: true,
      ticker,
      issuer: hit.title,
      cik: hit.cik,
      from,
      filings: picked.length,
      covered_from: picked.length ? picked[picked.length - 1].filed : null,
      truncated: metas.length > picked.length,
      failed,
      rows,
      totals: {
        buy_value: buys.reduce((n, r) => n + r.value, 0),
        sell_value: sells.reduce((n, r) => n + r.value, 0),
        sell_value_discretionary: sells
          .filter((r) => !r.plan_10b5_1)
          .reduce((n, r) => n + r.value, 0),
        buyers: new Set(buys.map((r) => r.owner_cik || r.owner)).size,
        sellers: new Set(sells.map((r) => r.owner_cik || r.owner)).size,
      },
      last_price: candles[candles.length - 1]?.value ?? null,
    };
  });
}
