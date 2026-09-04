"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Holding = {
  code?: string;
  name?: string;
  weight_pct?: number | null;
};

type Kor15Row = {
  symbol: string;
  resolved_symbol?: string | null;
  alias_note?: string | null;
  ok: boolean;
  error?: string | null;
  name?: string;
  aum_usd_bn?: number | null;
  adv_m_shares?: number | null;
  top3?: Holding[];
  samsung_weight_pct?: number | null;
  hynix_weight_pct?: number | null;
  samsung_value_usd_bn?: number | null;
  hynix_value_usd_bn?: number | null;
};

type ApiPayload = {
  ok: boolean;
  error?: string;
  generated_at_display?: string;
  ok_count?: number;
  rows?: Kor15Row[];
  notes?: string[];
};

type ChartMode = "weight" | "value";

function fmtPct(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtBn(n?: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(digits);
}

function fmtTop3(top3?: Holding[]): string {
  if (!top3?.length) return "—";
  return top3
    .map((h) => {
      const name = (h.name || h.code || "?").slice(0, 16);
      return `${name} ${fmtPct(h.weight_pct)}`;
    })
    .join(" · ");
}

export default function EtfKor15Tab({
  initialDelayMs = 0,
}: {
  initialDelayMs?: number;
}) {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ChartMode>("weight");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/etf-kor15");
      const text = await res.text();
      let json: ApiPayload;
      try {
        json = JSON.parse(text) as ApiPayload;
      } catch {
        throw new Error(
          text.trimStart().startsWith("<")
            ? "서버가 HTML을 반환했습니다(봇 과부하/타임아웃). 잠시 후 다시 시도하세요."
            : `응답 파싱 실패 (HTTP ${res.status})`,
        );
      }
      setData(json);
    } catch (exc) {
      setData({
        ok: false,
        error: exc instanceof Error ? exc.message : "로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), initialDelayMs);
    const id = window.setInterval(() => void load(), 10 * 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(id);
    };
  }, [load, initialDelayMs]);

  const rows = data?.rows || [];

  const chartData = useMemo(() => {
    return rows.map((row) => {
      if (mode === "value") {
        return {
          symbol: row.symbol,
          samsung: row.samsung_value_usd_bn ?? 0,
          hynix: row.hynix_value_usd_bn ?? 0,
          ok: row.ok,
        };
      }
      return {
        symbol: row.symbol,
        samsung: row.samsung_weight_pct ?? 0,
        hynix: row.hynix_weight_pct ?? 0,
        ok: row.ok,
      };
    });
  }, [rows, mode]);

  return (
    <section className="panel etf-kor15-panel">
      <div className="panel-head">
        <div>
          <h2>ETF KOR15 — 한국 노출 미국 ETF</h2>
          <p className="kr-note">
            삼성전자·SK하이닉스 편입
            {data?.generated_at_display ? ` · ${data.generated_at_display}` : ""}
            {data?.ok_count != null ? ` · ${data.ok_count}/${rows.length || 15}` : ""}
          </p>
        </div>
        <div className="chip-row">
          <button
            type="button"
            className={`chip ${mode === "weight" ? "active" : ""}`}
            onClick={() => setMode("weight")}
          >
            편입비 %
          </button>
          <button
            type="button"
            className={`chip ${mode === "value" ? "active" : ""}`}
            onClick={() => setMode("value")}
          >
            편입액 $B
          </button>
          <button type="button" className="chip" onClick={() => void load()} disabled={loading}>
            {loading ? "로딩…" : "새로고침"}
          </button>
        </div>
      </div>

      {!data?.ok ? (
        <p className="empty">{data?.error || (loading ? "불러오는 중…" : "데이터 없음")}</p>
      ) : (
        <>
          <div className="etf-kor15-chart">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="symbol" tick={{ fill: "#93a4c3", fontSize: 11 }} />
                <YAxis
                  tick={{ fill: "#93a4c3", fontSize: 11 }}
                  label={{
                    value: mode === "weight" ? "Weight %" : "Value $B",
                    angle: -90,
                    position: "insideLeft",
                    fill: "#93a4c3",
                    fontSize: 11,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    background: "#121b2d",
                    border: "1px solid #243049",
                    borderRadius: 8,
                  }}
                  formatter={(value: number | string, name: string) => {
                    const n = typeof value === "number" ? value : Number(value);
                    const label = name === "samsung" ? "삼성전자" : "SK하이닉스";
                    if (!Number.isFinite(n)) return ["—", label];
                    return [
                      mode === "weight" ? `${n.toFixed(2)}%` : `$${n.toFixed(3)}B`,
                      label,
                    ];
                  }}
                />
                <Legend
                  formatter={(value) => (value === "samsung" ? "삼성전자" : "SK하이닉스")}
                />
                <Bar dataKey="samsung" fill="#60a5fa" radius={[3, 3, 0, 0]} />
                <Bar dataKey="hynix" fill="#f472b6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="kr-note">
              {mode === "weight"
                ? "편입비(%) — Top3 밖 종목도 포함"
                : "편입액($B) = AUM($B) × 편입비(%) / 100"}
            </p>
          </div>

          <div className="table-wrap">
            <table className="kr-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>ETF</th>
                  <th>AUM($B)</th>
                  <th>ADV(M)</th>
                  <th>Top3</th>
                  <th>{mode === "weight" ? "삼성%" : "삼성$B"}</th>
                  <th>{mode === "weight" ? "하이닉스%" : "하이닉스$B"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.symbol} className={row.ok ? "" : "muted-row"}>
                    <td>
                      <code>{row.symbol}</code>
                      {row.resolved_symbol && row.resolved_symbol !== row.symbol ? (
                        <div className="kr-note">→ {row.resolved_symbol}</div>
                      ) : null}
                    </td>
                    <td>
                      {row.name || "—"}
                      {row.alias_note ? <div className="kr-note">{row.alias_note}</div> : null}
                      {!row.ok ? <div className="kr-note">{row.error || "조회 실패"}</div> : null}
                    </td>
                    <td className="num">{fmtBn(row.aum_usd_bn)}</td>
                    <td className="num">{fmtBn(row.adv_m_shares)}</td>
                    <td>{fmtTop3(row.top3)}</td>
                    <td className="num">
                      {mode === "weight"
                        ? fmtPct(row.samsung_weight_pct)
                        : fmtBn(row.samsung_value_usd_bn, 3)}
                    </td>
                    <td className="num">
                      {mode === "weight"
                        ? fmtPct(row.hynix_weight_pct)
                        : fmtBn(row.hynix_value_usd_bn, 3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
