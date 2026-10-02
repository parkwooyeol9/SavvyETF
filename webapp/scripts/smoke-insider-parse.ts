/**
 * Offline check of the Form 4 parser + summary aggregation (no network).
 * Run: npx tsx scripts/smoke-insider-parse.ts
 */
import { cleanTicker, parseForm4, summarizeInsider } from "../src/lib/insiderServer";
import type { InsiderTx } from "../src/lib/insiderTrading";

function form4({
  ticker,
  owner,
  cik,
  title,
  director = false,
  officer = true,
  aff = "0",
  rows,
  footnote = "",
}: {
  ticker: string;
  owner: string;
  cik: string;
  title: string;
  director?: boolean;
  officer?: boolean;
  aff?: string;
  rows: Array<{ code: string; shares: number; price: number; ad: "A" | "D"; after: number; fn?: boolean }>;
  footnote?: string;
}): string {
  const tx = rows
    .map(
      (r) => `
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-09-28</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>${r.code}</transactionCode><equitySwapInvolved>0</equitySwapInvolved>${r.fn ? '<footnoteId id="F1"/>' : ""}</transactionCoding>
      <transactionAmounts>
        <transactionShares><value>${r.shares}</value></transactionShares>
        <transactionPricePerShare><value>${r.price}</value><footnoteId id="F2"/></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>${r.ad}</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>${r.after}</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>`,
    )
    .join("");
  return `<SEC-DOCUMENT>
<TYPE>4
<XML>
<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0508</schemaVersion>
  <documentType>4</documentType>
  <periodOfReport>2026-09-28</periodOfReport>
  <aff10b5One>${aff}</aff10b5One>
  <issuer><issuerCik>0000111111</issuerCik><issuerName>Acme &amp; Co</issuerName><issuerTradingSymbol>${ticker}</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>${cik}</rptOwnerCik><rptOwnerName>${owner}</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>${director ? 1 : 0}</isDirector><isOfficer>${officer ? 1 : 0}</isOfficer><isTenPercentOwner>0</isTenPercentOwner><officerTitle>${title}</officerTitle></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>${tx}
  </nonDerivativeTable>
  <footnotes>
    <footnote id="F1">${footnote}</footnote>
    <footnote id="F2">Weighted average price.</footnote>
  </footnotes>
</ownershipDocument>
</XML>
</SEC-DOCUMENT>`;
}

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures += 1;
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && detail !== undefined ? ` → ${JSON.stringify(detail)}` : ""}`);
}

const meta = (acc: string, filed = "2026-09-30") => ({ acc, cik: "111111", filed, filed_time: null });

// 1) CEO buy split across two price tiers, exchange-prefixed ticker
const buy = parseForm4(
  form4({
    ticker: "NYSE: ACME",
    owner: "Doe Jane",
    cik: "0000222222",
    title: "President &amp; CEO",
    rows: [
      { code: "P", shares: 1000, price: 10, ad: "A", after: 11000 },
      { code: "P", shares: 1000, price: 12, ad: "A", after: 12000 },
    ],
  }),
  meta("0000222222-26-000001"),
);
check("parses 2 rows", buy.length === 2, buy.length);
check("ticker cleaned", buy[0]?.ticker === "ACME", buy[0]?.ticker);
check("issuer entity decoded", buy[0]?.issuer === "Acme & Co", buy[0]?.issuer);
check("c-suite detected", buy[0]?.c_suite === true);
check("value = shares × price", buy[1]?.value === 12000, buy[1]?.value);
check("own_chg_pct vs pre-trade holding", Math.abs((buy[0]?.own_chg_pct ?? 0) - 10) < 1e-9, buy[0]?.own_chg_pct);
check("no plan flag on buy", buy.every((r) => !r.plan_10b5_1));

// 2) Sale under a 10b5-1 plan, footnote uses an en dash
const sale = parseForm4(
  form4({
    ticker: "ACME",
    owner: "Roe Rick",
    cik: "0000333333",
    title: "EVP, General Counsel",
    rows: [{ code: "S", shares: 500, price: 20, ad: "D", after: 4500, fn: true }],
    footnote: "Sold pursuant to a Rule 10b5–1 trading plan adopted on May 1, 2026.",
  }),
  meta("0000333333-26-000002"),
);
check("10b5-1 via footnote (en dash)", sale[0]?.plan_10b5_1 === true, sale[0]);
check("VP is not c-suite", sale[0]?.c_suite === false);
check("disposed → acquired=false", sale[0]?.acquired === false);

// 3) aff10b5One document flag
const affSale = parseForm4(
  form4({
    ticker: "ACME",
    owner: "Poe Pat",
    cik: "0000444444",
    title: "",
    director: true,
    officer: false,
    aff: "true",
    rows: [{ code: "S", shares: 100, price: 20, ad: "D", after: 0 }],
  }),
  meta("0000444444-26-000003"),
);
check("aff10b5One=true → plan", affSale[0]?.plan_10b5_1 === true);
check("director role", affSale[0]?.role === "Director", affSale[0]?.role);

// 4) Not a Form 4 / no ticker
check("4/A documentType rejected", parseForm4(form4({ ticker: "ACME", owner: "x", cik: "1", title: "", rows: [] }).replace("<documentType>4<", "<documentType>4/A<"), meta("x")).length === 0);
check("ticker NONE rejected", parseForm4(form4({ ticker: "NONE", owner: "x", cik: "1", title: "CEO", rows: [{ code: "P", shares: 1, price: 1, ad: "A", after: 1 }] }), meta("y")).length === 0);

// 5) cleanTicker
check("cleanTicker multi", cleanTicker("googl, goog") === "GOOGL", cleanTicker("googl, goog"));
check("cleanTicker class", cleanTicker("BRK.B") === "BRK.B");

// 6) Summary: a 2-person cluster (CEO + director) on ACME
const dirBuy = parseForm4(
  form4({
    ticker: "ACME",
    owner: "Moe Max",
    cik: "0000555555",
    title: "",
    director: true,
    officer: false,
    rows: [{ code: "P", shares: 2000, price: 11, ad: "A", after: 2000 }],
  }),
  meta("0000555555-26-000004", "2026-10-01"),
);
const rows: InsiderTx[] = [...buy, ...sale, ...affSale, ...dirBuy];
const shards = [
  { day: "2026-10-01", rows: rows.filter((r) => r.filed === "2026-10-01") },
  { day: "2026-09-30", rows: rows.filter((r) => r.filed === "2026-09-30") },
];
const s = summarizeInsider("2026-10-01", shards, 0);
check("one cluster", s.clusters.length === 1, s.clusters.map((c) => c.ticker));
check("cluster has 2 insiders incl. c-suite", s.clusters[0]?.n_insiders === 2 && s.clusters[0]?.has_c_suite === true);
check("split tiers merged per filing", s.latest_buys.length === 2, s.latest_buys.length);
check("cluster total", s.clusters[0]?.total_value === 22000 + 22000, s.clusters[0]?.total_value);
check("ratio 7d = 2 buyers / 2 sellers", s.sentiment.ratio_7d === 1, s.sentiment);
check("discretionary sellers excludes plans", s.sentiment.sellers_discretionary_7d === 0, s.sentiment);
check("net buyer ACME", s.net_buyers[0]?.ticker === "ACME" && s.net_buyers[0]?.net_value === 44000 - 12000, s.net_buyers[0]);
check("dd_52w defaults null", s.clusters[0]?.dd_52w_pct === null);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
