"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DATA_CATALOG_GROUPS,
  fmtBytes,
  type CatalogDatasetRow,
  type DataCatalogPayload,
  type DatasetGroup,
} from "@/lib/dataCatalog";

const GROUP_ORDER: DatasetGroup[] = ["etf", "news", "briefs", "monitor", "ops"];

function kindLabel(kind: CatalogDatasetRow["kind"]): string {
  if (kind === "timeseries") return "시계열";
  if (kind === "rolling") return "롤링+아카이브";
  return "latest";
}

function statusOf(row: CatalogDatasetRow): { label: string; className: string } {
  if (row.volatile) return { label: "휘발 위험", className: "data-cat-badge warn" };
  if (row.kind === "timeseries" || row.kind === "rolling") {
    return { label: "보존", className: "data-cat-badge ok" };
  }
  return { label: "운영", className: "data-cat-badge" };
}

export default function DataCatalogTab() {
  const [data, setData] = useState<DataCatalogPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>("etf_db");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/data-catalog");
      const json = (await res.json()) as DataCatalogPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setError(json.error || null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const rows = data?.datasets || [];
    return GROUP_ORDER.map((group) => ({
      group,
      label: DATA_CATALOG_GROUPS[group],
      rows: rows.filter((r) => r.group === group),
    })).filter((g) => g.rows.length);
  }, [data]);

  return (
    <div className="geo-tab data-cat-tab">
      <header className="kr-hero">
        <div>
          <h2 className="kr-hero-title">적재 현황</h2>
          <p className="kr-hero-sub">
            R2에 쌓인 raw JSON의 위치·보존 정책·객체 수입니다. 이후 검증·가공·인사이트는 이
            목록의 시계열부터 시작합니다.
          </p>
        </div>
        <div className="kr-hero-actions">
          <button type="button" className="ghost-btn" onClick={() => void load()} disabled={loading}>
            {loading ? "집계 중…" : "다시 집계"}
          </button>
        </div>
      </header>

      {error ? <p className="kr-note">{error}</p> : null}

      <div className="data-cat-summary">
        <article>
          <span>객체</span>
          <strong>{(data?.totals.objects ?? 0).toLocaleString()}</strong>
        </article>
        <article>
          <span>용량</span>
          <strong>{fmtBytes(data?.totals.bytes ?? 0)}</strong>
        </article>
        <article>
          <span>휘발 세트</span>
          <strong>{data?.totals.volatile ?? 0}</strong>
        </article>
        <article>
          <span>버킷</span>
          <strong>{data?.bucket || (data?.r2 ? "R2" : "미연결")}</strong>
        </article>
      </div>

      {grouped.map((block) => (
        <section key={block.group} className="geo-section">
          <h3 className="geo-section-title">{block.label}</h3>
          <div className="data-cat-list">
            {block.rows.map((row) => {
              const open = openId === row.id;
              const status = statusOf(row);
              return (
                <article key={row.id} className={`data-cat-card ${open ? "open" : ""}`}>
                  <button
                    type="button"
                    className="data-cat-head"
                    onClick={() => setOpenId(open ? null : row.id)}
                    aria-expanded={open}
                  >
                    <div>
                      <strong>{row.label}</strong>
                      <p>
                        {kindLabel(row.kind)} · {row.live.objects.toLocaleString()} objects ·{" "}
                        {fmtBytes(row.live.bytes)}
                        {row.live.firstDay && row.live.lastDay
                          ? ` · ${row.live.firstDay} → ${row.live.lastDay}`
                          : ""}
                      </p>
                    </div>
                    <em className={status.className}>{status.label}</em>
                  </button>
                  {open ? (
                    <div className="data-cat-body">
                      <p>{row.insight}</p>
                      <dl>
                        <div>
                          <dt>핫 윈도</dt>
                          <dd>{row.hotWindow}</dd>
                        </div>
                        <div>
                          <dt>아카이브</dt>
                          <dd>{row.archive}</dd>
                        </div>
                        <div>
                          <dt>prefix</dt>
                          <dd>
                            {row.prefixes.map((p) => (
                              <code key={p}>{p}</code>
                            ))}
                          </dd>
                        </div>
                      </dl>
                      {row.live.samples.length ? (
                        <ul>
                          {row.live.samples.map((key) => (
                            <li key={key}>
                              <code>{key}</code>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="meta-soft">아직 객체가 없거나 R2 목록을 못 읽었습니다.</p>
                      )}
                      {row.viewTab ? (
                        <a className="data-cat-link" href={`/?tab=${row.viewTab}`}>
                          가공 화면 열기
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
