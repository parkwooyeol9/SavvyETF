import { buildKosdaq100Payload } from "../src/lib/kosdaq100";

async function main() {
  const p = await buildKosdaq100Payload({ refreshFundamentals: true });
  console.log(
    JSON.stringify(
      {
        ok: p.ok,
        n: p.rows.length,
        top: p.rows.slice(0, 5).map((r) => ({
          name: r.name,
          w: r.weight_pct,
          roe: r.roe,
          op: r.op_margin,
          rg: r.revenue_growth,
          q: r.quality_label,
          score: r.quality_score,
        })),
        summary: p.summary,
        error: p.error,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
