"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  CriticalListId,
  DualUseRow,
  GreenMineral,
  GreenMineralEvent,
  GreenMineralPayload,
  SupplySecurityDelta,
} from "@/lib/greenMinerals";
import {
  GROUP_LABELS,
  PRESSURE_LABELS,
} from "@/lib/greenMinerals";

function toneClass(n?: number | null): string {
  if (n == null || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

function fmtPct(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtDelta(d: SupplySecurityDelta): string {
  return d > 0 ? `+${d}` : String(d);
}

function TagChips({ tags, dual }: { tags: string[]; dual: boolean }) {
  return (
    <div className="green-min-tags">
      {dual ? <span className="green-min-chip dual">dual_use</span> : null}
      {tags
        .filter((t) => t !== "dual_use")
        .slice(0, 4)
        .map((t) => (
          <span key={t} className="green-min-chip">
            {t}
          </span>
        ))}
    </div>
  );
}

function ListBadges({
  lists,
  labels,
}: {
  lists: CriticalListId[];
  labels: GreenMineralPayload["list_labels"];
}) {
  return (
    <div className="green-min-tags">
      {lists.map((id) => (
        <span key={id} className="green-min-chip list" title={labels[id]?.en}>
          {id}
        </span>
      ))}
    </div>
  );
}

function DualCard({ row }: { row: DualUseRow }) {
  const p = PRESSURE_LABELS[row.pressure];
  return (
    <article className="green-min-card">
      <header>
        <div>
          <h4>
            {row.name_ko}
            <span className="green-min-en"> · {row.name_en}</span>
          </h4>
          <p className="green-min-meta">
            청정 {row.clean_tech_demand} · 방산 {row.defence_demand}
          </p>
        </div>
        <div className={`green-min-pressure ${p.className}`}>{p.ko}</div>
      </header>
      <p className="green-min-body">{row.rationale_ko}</p>
      <p className="green-min-meta">{row.evidence_note}</p>
    </article>
  );
}

function EventCard({ event }: { event: GreenMineralEvent }) {
  return (
    <article className="green-min-card">
      <div className="green-min-event-top">
        <span className="green-min-chip">{event.policy_stage}</span>
        <span className="green-min-chip">{event.event_type}</span>
        <strong className={toneClass(event.security_delta)}>
          {fmtDelta(event.security_delta)}
        </strong>
        <span className="green-min-meta">
          {event.date} · {event.jurisdiction}
        </span>
      </div>
      <h4>
        {event.title_ko}
        <span className="green-min-en"> · {event.title_en}</span>
      </h4>
      <p className="green-min-body">{event.summary_ko}</p>
      <p className="green-min-meta">{event.security_rationale_ko}</p>
      <a className="green-min-link" href={event.source_url} target="_blank" rel="noreferrer">
        {event.source_name}
      </a>
    </article>
  );
}

export default function GreenMineralsTab() {
  const [data, setData] = useState<GreenMineralPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [dualOnly, setDualOnly] = useState(false);
  const [listFilter, setListFilter] = useState<CriticalListId | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/green-minerals", { cache: "no-store" });
      const text = await res.text();
      let json: GreenMineralPayload;
      try {
        json = JSON.parse(text) as GreenMineralPayload;
      } catch {
        throw new Error(
          text.trimStart().startsWith("<")
            ? "서버가 HTML을 반환했습니다. 잠시 후 다시 시도하세요."
            : `응답 파싱 실패 (HTTP ${res.status})`,
        );
      }
      setData(json);
    } catch (exc) {
      setData({
        ok: false,
        generated_at: new Date().toISOString(),
        subtitle_ko: "녹색 전환이 지정학·인권과 충돌하는 지점",
        subtitle_en:
          "Where the Green Transition Collides with Geopolitics and Human Rights",
        note: "",
        minerals: [],
        dual_use: [],
        events: [],
        etfs: [],
        headlines: [],
        deferred: [],
        list_labels: {
          US: { ko: "미국", en: "US" },
          EU: { ko: "EU", en: "EU" },
          CA: { ko: "캐나다", en: "Canada" },
          AU: { ko: "호주", en: "Australia" },
          JP: { ko: "일본", en: "Japan" },
          KR: { ko: "한국", en: "Korea" },
        },
        error: exc instanceof Error ? exc.message : "로드 실패",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const minerals = useMemo(() => {
    const rows = data?.minerals || [];
    return rows.filter((m: GreenMineral) => {
      if (groupFilter !== "all" && m.group !== groupFilter) return false;
      if (dualOnly && !m.dual_use) return false;
      if (listFilter !== "all" && !m.lists.includes(listFilter)) return false;
      return true;
    });
  }, [data?.minerals, groupFilter, dualOnly, listFilter]);

  const labels = data?.list_labels;

  return (
    <section className="panel green-min-panel">
      <div className="panel-head">
        <div>
          <h2>녹색 광물 · Critical Minerals</h2>
          <p className="panel-sub">
            {data?.subtitle_ko || "녹색 전환이 지정학·인권과 충돌하는 지점"}
            <br />
            <span className="green-min-en">
              {data?.subtitle_en ||
                "Where the Green Transition Collides with Geopolitics and Human Rights"}
            </span>
          </p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>
          {loading ? "불러오는 중…" : "새로고침"}
        </button>
      </div>

      {data?.error ? <p className="error-line">{data.error}</p> : null}
      {data?.note ? <p className="kr-note">{data.note}</p> : null}

      <div className="green-min-section">
        <h3>Green–Defence Competition Map</h3>
        <p className="green-min-meta">
          방산과 청정기술이 동시에 수요가 커지는 광물(정성). 무기체계 투입량 미공개 시
          수치를 만들지 않음.
        </p>
        <div className="green-min-grid">
          {(data?.dual_use || []).map((row) => (
            <DualCard key={row.mineral_id} row={row} />
          ))}
        </div>
      </div>

      <div className="green-min-section">
        <h3>관련 ETF 프록시 (Yahoo)</h3>
        <p className="green-min-meta">
          광물 현물가가 아님. 투자 조언 아님 · fetched 시점 기준.
        </p>
        <div className="table-wrap">
          <table className="kr-table">
            <thead>
              <tr>
                <th>ETF</th>
                <th>테마</th>
                <th>가격</th>
                <th>1D</th>
                <th>1M</th>
              </tr>
            </thead>
            <tbody>
              {(data?.etfs || []).map((e) => (
                <tr key={e.id}>
                  <td>
                    <code>{e.symbol}</code>
                  </td>
                  <td>
                    {e.label}
                    <div className="green-min-meta">{e.thesis}</div>
                  </td>
                  <td>{e.price != null ? e.price.toFixed(2) : e.error || "—"}</td>
                  <td className={toneClass(e.change_1d_pct)}>{fmtPct(e.change_1d_pct)}</td>
                  <td className={toneClass(e.change_1m_pct)}>{fmtPct(e.change_1m_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="green-min-section">
        <h3>정책·지정학 이벤트 (큐레이션)</h3>
        <p className="green-min-meta">
          Supply Security delta: 수입국 관점 방향성. MOU/보조금 ≠ 실생산.
        </p>
        <div className="green-min-stack">
          {(data?.events || []).map((ev) => (
            <EventCard key={ev.id} event={ev} />
          ))}
        </div>
      </div>

      <div className="green-min-section">
        <h3>광물 분류체계</h3>
        <div className="esg-reg-filters">
          <label>
            그룹{" "}
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
              <option value="all">전체</option>
              {Object.entries(GROUP_LABELS).map(([id, lab]) => (
                <option key={id} value={id}>
                  {lab.ko}
                </option>
              ))}
            </select>
          </label>
          <label>
            국가목록{" "}
            <select
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value as CriticalListId | "all")}
            >
              <option value="all">전체</option>
              {(["US", "EU", "CA", "AU", "JP", "KR"] as CriticalListId[]).map((id) => (
                <option key={id} value={id}>
                  {labels?.[id]?.ko || id}
                </option>
              ))}
            </select>
          </label>
          <label className="green-min-check">
            <input
              type="checkbox"
              checked={dualOnly}
              onChange={(e) => setDualOnly(e.target.checked)}
            />
            dual_use만
          </label>
        </div>
        <div className="table-wrap">
          <table className="kr-table">
            <thead>
              <tr>
                <th>광물</th>
                <th>그룹</th>
                <th>용도</th>
                <th>태그</th>
                <th>국가목록</th>
              </tr>
            </thead>
            <tbody>
              {minerals.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.name_ko}</strong>
                    <div className="green-min-en">{m.name_en}</div>
                    {m.note_ko ? <div className="green-min-meta">{m.note_ko}</div> : null}
                  </td>
                  <td>{GROUP_LABELS[m.group]?.ko}</td>
                  <td>{m.end_uses_ko}</td>
                  <td>
                    <TagChips tags={m.tags} dual={m.dual_use} />
                  </td>
                  <td>{labels ? <ListBadges lists={m.lists} labels={labels} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="green-min-section">
        <h3>헤드라인 (Google News RSS)</h3>
        <p className="green-min-meta">탐지용. allegation ≠ confirmed.</p>
        <ul className="green-min-news">
          {(data?.headlines || []).length === 0 ? (
            <li className="empty">헤드라인 없음</li>
          ) : (
            (data?.headlines || []).map((h, i) => (
              <li key={`${h.headline}-${i}`}>
                {h.url ? (
                  <a href={h.url} target="_blank" rel="noreferrer">
                    {h.headline}
                  </a>
                ) : (
                  <span>{h.headline}</span>
                )}
                <div className="green-min-meta">
                  {h.source}
                  {h.published ? ` · ${h.published}` : ""}
                </div>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="green-min-section">
        <h3>미구현 (의도적 연기)</h3>
        <div className="table-wrap">
          <table className="kr-table">
            <thead>
              <tr>
                <th>모듈</th>
                <th>연기 사유</th>
                <th>규모</th>
              </tr>
            </thead>
            <tbody>
              {(data?.deferred || []).map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.title_ko}
                    <div className="green-min-en">{d.title_en}</div>
                  </td>
                  <td>{d.reason_ko}</td>
                  <td>
                    <code>{d.effort}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
