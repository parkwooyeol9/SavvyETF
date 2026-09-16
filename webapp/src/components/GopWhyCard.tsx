"use client";

import { useEffect, useState } from "react";

import type { GopWhyPayload } from "@/lib/gopWhy";
import type { PoliRange } from "@/lib/poliThemes";

function fmtPct(n?: number | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function retClass(n?: number | null): string {
  if (n == null) return "flat";
  if (n > 0.05) return "up";
  if (n < -0.05) return "down";
  return "flat";
}

export default function GopWhyCard({ range, rangeLabel }: { range: PoliRange; rangeLabel: string }) {
  const [data, setData] = useState<GopWhyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/gop-why?range=${range}`);
        const json = (await res.json()) as GopWhyPayload;
        if (cancelled) return;
        setData(json);
        setError(json.ok === false ? json.error || json.headline : null);
      } catch (exc) {
        if (!cancelled) setError(exc instanceof Error ? exc.message : "분석 실패");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  if (!data && !error) {
    return <p className="empty">GOP 성과 분해 불러오는 중…</p>;
  }

  const maxAbs = Math.max(
    0.01,
    ...(data?.sectors || []).map((s) => Math.abs(s.contrib_pct || 0)),
  );

  return (
    <section className="geo-section gop-why">
      <h3 className="geo-section-title">GOP가 강한 이유</h3>
      <p className="meta-soft">
        공화 의원 STOCK Act 바스켓. 2025년 3월 21일 티커가 KRUZ에서 GOP로 바뀌었습니다.{" "}
        {rangeLabel} 수익률을 최근 편입 비중으로 분해합니다.
      </p>
      {error && !data?.headline ? <p className="empty warn">{error}</p> : null}
      {data ? (
        <>
          <p className="gop-why-headline" data-mode={data.mode}>
            {data.headline}
          </p>
          <ul className="gop-why-bullets">
            {data.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <div className="gop-why-grid">
            <article>
              <h4>종목 기여 (비중 × 수익률)</h4>
              {data.drivers.length ? (
                <table className="gop-why-table">
                  <thead>
                    <tr>
                      <th>종목</th>
                      <th>업종</th>
                      <th>비중</th>
                      <th>수익률</th>
                      <th>기여</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.drivers.map((d) => (
                      <tr key={d.ticker}>
                        <td>
                          <code>{d.ticker}</code>
                          <span>{d.name}</span>
                        </td>
                        <td>{d.sector_ko}</td>
                        <td>{fmtPct(d.weight_pct, 1).replace("+", "")}</td>
                        <td className={retClass(d.return_pct)}>{fmtPct(d.return_pct)}</td>
                        <td className={retClass(d.contribution_pct)}>
                          {d.contribution_pct == null ? "—" : `${fmtPct(d.contribution_pct)}p`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="empty">편입비를 읽지 못해 종목 기여를 계산하지 못했습니다.</p>
              )}
            </article>
            <article>
              <h4>업종 기여</h4>
              {data.sectors.length ? (
                <ol className="gop-why-sectors">
                  {data.sectors.map((s) => (
                    <li key={s.id}>
                      <div>
                        <span>{s.label}</span>
                        <strong className={retClass(s.contrib_pct)}>
                          {s.contrib_pct == null ? "—" : `${fmtPct(s.contrib_pct)}p`}
                        </strong>
                      </div>
                      <em>비중 {fmtPct(s.weight_pct, 1).replace("+", "")}</em>
                      <i
                        style={{
                          width: `${Math.min(100, (Math.abs(s.contrib_pct || 0) / maxAbs) * 100)}%`,
                        }}
                        data-sign={(s.contrib_pct || 0) >= 0 ? "up" : "down"}
                      />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty">업종 롤업 없음</p>
              )}
              <p className="meta-soft">
                벤치: SPY {fmtPct(data.spy_return_pct)} · XLE {fmtPct(data.xle_return_pct)} · XLF{" "}
                {fmtPct(data.xlf_return_pct)} · ITA {fmtPct(data.ita_return_pct)}
              </p>
            </article>
          </div>
          <p className="meta-soft">
            {data.note}
            {data.as_of ? ` · 편입비 ${data.as_of}` : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
