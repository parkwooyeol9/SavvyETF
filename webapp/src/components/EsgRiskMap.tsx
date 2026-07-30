"use client";

import { useCallback, useEffect, useState } from "react";

import type { AllBriefs } from "@/lib/types";

type RiskTile = {
  id: string;
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "flat" | "hot" | "caution";
};

type SummaryState = {
  tiles: RiskTile[];
  generated_at: string;
  error?: string;
};

function toneFromScore(score: number): RiskTile["tone"] {
  if (score >= 75) return "hot";
  if (score >= 55) return "caution";
  return "flat";
}

function toneFromStress(v: number): RiskTile["tone"] {
  if (v > 2) return "up";
  if (v < -2) return "down";
  return "flat";
}

function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export default function EsgRiskMap({
  briefSlots,
}: {
  briefSlots?: AllBriefs["esg"]["slots"];
}) {
  const [data, setData] = useState<SummaryState | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [geoRes, infraRes, regRes] = await Promise.all([
        fetch("/api/geo?range=1mo"),
        fetch("/api/ai-infra"),
        fetch("/api/esg-reg"),
      ]);
      const geo = (await geoRes.json()) as {
        ok?: boolean;
        composite?: { score: number; label: string };
      };
      const infra = (await infraRes.json()) as {
        ok?: boolean;
        daily?: { power_stress_proxy?: { value?: number | null } };
      };
      const reg = (await regRes.json()) as {
        ok?: boolean;
        jurisdiction_scores?: Array<{
          jurisdiction: string;
          label_ko: string;
          score: number;
        }>;
      };

      const monitor = briefSlots?.esg_monitor;
      const riskMeta = monitor?.meta?.risk as
        | { score?: number; label?: string }
        | undefined;

      const tiles: RiskTile[] = [];

      if (geo?.composite) {
        tiles.push({
          id: "geo",
          label: "지정학 리스크",
          value: String(geo.composite.score),
          sub: geo.composite.label,
          tone: toneFromScore(geo.composite.score),
        });
      }

      const stress = infra?.daily?.power_stress_proxy?.value;
      if (stress != null && stress === stress) {
        tiles.push({
          id: "power",
          label: "Power Stress",
          value: fmtPct(stress) + "p",
          sub: "전력 ETF vs SPY (1M, 추정)",
          tone: toneFromStress(stress),
        });
      }

      const topReg = (reg?.jurisdiction_scores || [])
        .filter((j) => j.score !== 0)
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
      if (topReg) {
        tiles.push({
          id: "reg",
          label: "규제 모멘텀",
          value: `${topReg.score >= 0 ? "+" : ""}${topReg.score}`,
          sub: `${topReg.label_ko} (900일 합산)`,
          tone: topReg.score > 0 ? "up" : topReg.score < 0 ? "down" : "flat",
        });
      }

      if (riskMeta?.score != null) {
        tiles.push({
          id: "climate",
          label: "기후 모니터",
          value: String(riskMeta.score),
          sub: (riskMeta.label as string) || "esg_monitor",
          tone: toneFromScore(Number(riskMeta.score)),
        });
      } else if (monitor) {
        tiles.push({
          id: "climate",
          label: "기후 모니터",
          value: "—",
          sub: "브리프 메타 없음 · esg_monitor 슬롯 참고",
          tone: "flat",
        });
      }

      setData({
        tiles,
        generated_at: new Date().toISOString(),
        error: undefined,
      });
    } catch (exc) {
      setData({
        tiles: [],
        generated_at: new Date().toISOString(),
        error: exc instanceof Error ? exc.message : "로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, [briefSlots]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!data && loading) {
    return (
      <section className="panel esg-risk-map">
        <p className="empty">오늘의 ESG 리스크 맵 불러오는 중…</p>
      </section>
    );
  }

  if (!data?.tiles.length) return null;

  return (
    <section className="panel esg-risk-map" aria-label="오늘의 ESG 리스크 맵">
      <div className="esg-risk-head">
        <div>
          <h2 className="panel-title">오늘의 ESG 리스크 맵</h2>
          <p className="panel-sub">
            지정학 · 전력(추정) · 규제 모멘텀 · 기후 모니터를 한눈에 봅니다. 하위 탭
            상세와 함께 해석하세요.
          </p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => void load()}>
          {loading ? "…" : "갱신"}
        </button>
      </div>
      {data.error ? <p className="empty warn">{data.error}</p> : null}
      <div className="esg-risk-grid">
        {data.tiles.map((t) => (
          <article key={t.id} className={`esg-risk-tile ${t.tone || "flat"}`}>
            <span className="esg-risk-label">{t.label}</span>
            <strong className="esg-risk-value">{t.value}</strong>
            {t.sub ? <em className="esg-risk-sub">{t.sub}</em> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
