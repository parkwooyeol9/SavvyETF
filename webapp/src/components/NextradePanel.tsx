"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { NextradeBoardPayload } from "@/lib/nextradeBoard";

const tip = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
  fontSize: 11,
};

function fmtEokFromWon(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const eok = n / 1e8;
  if (Math.abs(eok) >= 10000) return `${(eok / 10000).toFixed(2)}조`;
  return `${eok.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}억`;
}

function fmtPct(n?: number | null, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(d)}%`;
}

function tone(n?: number | null): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

export default function NextradePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<NextradeBoardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/nextrade");
      const json = (await res.json()) as NextradeBoardPayload;
      setData(json);
      if (!json.ok) setError(json.error || "로드 실패");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const shareChart = useMemo(
    () =>
      (data?.daily_share || []).map((d) => ({
        t: d.date.slice(5),
        점유율: d.mkt_share_pct,
        대금억: d.value != null ? Number((d.value / 1e8).toFixed(0)) : null,
      })),
    [data],
  );

  const invShareChart = useMemo(
    () =>
      (data?.investors || []).slice(-30).map((d) => ({
        t: d.date.slice(5),
        개인: d.individual_share_pct,
        기관: d.institution_share_pct,
        외국인: d.foreign_share_pct,
      })),
    [data],
  );

  const invNetChart = useMemo(
    () =>
      (data?.investors || []).slice(-20).map((d) => ({
        t: d.date.slice(5),
        개인: d.individual_net_eok,
        기관: d.institution_net_eok,
        외국인: d.foreign_net_eok,
      })),
    [data],
  );

  async function downloadExcel() {
    setExcelBusy(true);
    try {
      const res = await fetch("/api/nextrade/excel");
      if (!res.ok) throw new Error(`엑셀 실패 (${res.status})`);
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(cd);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = match?.[1] || "savvyetf-nextrade.xlsx";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "엑셀 다운로드 실패");
    } finally {
      setExcelBusy(false);
    }
  }

  if (!open) return null;

  return (
    <section className="nxt-panel geo-section">
      <div className="feature-head geo-head-row">
        <div>
          <h3 className="geo-section-title">넥스트레이드 (장외 ATS)</h3>
          <p className="macro-subhead">
            KRX와 병행하는 NXT 대체거래소 · {data?.sessions_note || "세션 정보 로딩…"}
          </p>
        </div>
        <div className="kr-hero-actions">
          <button
            type="button"
            className="ghost-btn"
            disabled={excelBusy || loading}
            onClick={() => void downloadExcel()}
          >
            {excelBusy ? "엑셀 만드는 중…" : "엑셀 내려받기"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? "갱신 중…" : "새로고침"}
          </button>
          <button type="button" className="ghost-btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>

      {error ? <p className="empty warn">{error}</p> : null}
      {loading && !data ? <p className="empty">넥스트레이드 불러오는 중…</p> : null}

      {data?.ok ? (
        <>
          <p className="meta-soft" style={{ marginBottom: 12 }}>
            {data.headline_ko}
            {data.generated_at
              ? ` · ${new Date(data.generated_at).toLocaleString("ko-KR")}`
              : ""}
          </p>

          <div className="nxt-stat-grid">
            <div className="geo-featured">
              <div className="meta-soft">당일 점유율</div>
              <strong className="nxt-stat-val">
                {fmtPct(data.today_share_pct, 2).replace("+", "")}
              </strong>
            </div>
            <div className="geo-featured">
              <div className="meta-soft">당월 평균점유</div>
              <strong className="nxt-stat-val">
                {fmtPct(data.month_avg_share_pct, 2).replace("+", "")}
              </strong>
            </div>
            <div className="geo-featured">
              <div className="meta-soft">당일 대금</div>
              <strong className="nxt-stat-val">
                {fmtEokFromWon(data.today_value)}
              </strong>
            </div>
            <div className="geo-featured">
              <div className="meta-soft">세션일</div>
              <strong className="nxt-stat-val">{data.session_day}</strong>
            </div>
          </div>

          <div className="nxt-focus-grid">
            {data.focus.map((f) => (
              <article key={f.code} className="geo-featured nxt-focus-card">
                <header className="stockboard-card-head">
                  <strong>{f.name}</strong>
                  <span className="meta-soft">{f.code}</span>
                </header>
                <div className="nxt-focus-cols">
                  <div>
                    <div className="meta-soft">KRX</div>
                    <div className={tone(f.krx_change_pct)}>
                      {f.krx_price?.toLocaleString("ko-KR") ?? "—"}{" "}
                      <span>{fmtPct(f.krx_change_pct, 2)}</span>
                    </div>
                    <div className="meta-soft">
                      {fmtEokFromWon(f.krx_value)}
                    </div>
                  </div>
                  <div>
                    <div className="meta-soft">NXT</div>
                    {f.nxt_available ? (
                      <>
                        <div className={tone(f.nxt_change_pct)}>
                          {f.nxt_price?.toLocaleString("ko-KR") ?? "—"}{" "}
                          <span>{fmtPct(f.nxt_change_pct, 2)}</span>
                        </div>
                        <div className="meta-soft">
                          {fmtEokFromWon(f.nxt_value)}
                          {f.nxt_share_vs_krx_pct != null
                            ? ` · NXT비중 ${f.nxt_share_vs_krx_pct}%`
                            : ""}
                        </div>
                      </>
                    ) : (
                      <div className="meta-soft">장외 체결 없음</div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="nxt-chart-grid">
            <div>
              <p className="meta-soft" style={{ marginBottom: 4 }}>
                NXT 일별 거래량 점유율 · 대금
              </p>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <ComposedChart data={shareChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2b3648" />
                    <XAxis
                      dataKey="t"
                      tick={{ fill: "#8b9bb4", fontSize: 10 }}
                      minTickGap={24}
                    />
                    <YAxis
                      yAxisId="l"
                      tick={{ fill: "#8b9bb4", fontSize: 10 }}
                      width={40}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <YAxis
                      yAxisId="r"
                      orientation="right"
                      tick={{ fill: "#8b9bb4", fontSize: 10 }}
                      width={44}
                      tickFormatter={(v: number) =>
                        v >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${v}`
                      }
                    />
                    <Tooltip contentStyle={tip} />
                    <Legend />
                    <Area
                      yAxisId="r"
                      type="monotone"
                      dataKey="대금억"
                      name="대금(억)"
                      stroke="#5b9fd4"
                      fill="rgba(91,159,212,0.15)"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      yAxisId="l"
                      type="monotone"
                      dataKey="점유율"
                      name="점유율%"
                      stroke="#e8c547"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <p className="meta-soft" style={{ marginBottom: 4 }}>
                투자자별 대금 거래비중 %
              </p>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <ComposedChart data={invShareChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2b3648" />
                    <XAxis
                      dataKey="t"
                      tick={{ fill: "#8b9bb4", fontSize: 10 }}
                      minTickGap={20}
                    />
                    <YAxis
                      tick={{ fill: "#8b9bb4", fontSize: 10 }}
                      width={36}
                      domain={[0, 100]}
                    />
                    <Tooltip contentStyle={tip} />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="개인"
                      stackId="1"
                      stroke="#5b9fd4"
                      fill="rgba(91,159,212,0.45)"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="기관"
                      stackId="1"
                      stroke="#e8c547"
                      fill="rgba(232,197,71,0.4)"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="외국인"
                      stackId="1"
                      stroke="#c97b84"
                      fill="rgba(201,123,132,0.4)"
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <p className="meta-soft" style={{ marginBottom: 4 }}>
            투자자별 순매수 (억원)
          </p>
          <div style={{ width: "100%", height: 200, marginBottom: 14 }}>
            <ResponsiveContainer>
              <BarChart data={invNetChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2b3648" />
                <XAxis
                  dataKey="t"
                  tick={{ fill: "#8b9bb4", fontSize: 10 }}
                  minTickGap={18}
                />
                <YAxis tick={{ fill: "#8b9bb4", fontSize: 10 }} width={44} />
                <Tooltip contentStyle={tip} />
                <Legend />
                <Bar dataKey="개인" fill="#5b9fd4" isAnimationActive={false} />
                <Bar dataKey="기관" fill="#e8c547" isAnimationActive={false} />
                <Bar dataKey="외국인" fill="#c97b84" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>종목</th>
                  <th>시장</th>
                  <th>가격</th>
                  <th>등락</th>
                  <th>NXT 대금</th>
                  <th>거래량</th>
                </tr>
              </thead>
              <tbody>
                {data.top_value.map((r) => (
                  <tr key={r.code}>
                    <td>{r.rank}</td>
                    <td>
                      <strong>{r.name}</strong>{" "}
                      <span className="meta-soft">{r.code}</span>
                    </td>
                    <td>{r.market || "—"}</td>
                    <td>{r.price?.toLocaleString("ko-KR") ?? "—"}</td>
                    <td className={tone(r.change_pct)}>
                      {fmtPct(r.change_pct, 2)}
                    </td>
                    <td>{fmtEokFromWon(r.value)}</td>
                    <td>
                      {r.volume != null
                        ? r.volume.toLocaleString("ko-KR")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="meta-soft" style={{ paddingLeft: 18, marginTop: 10 }}>
            {data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
