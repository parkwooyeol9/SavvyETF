"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DATA_CATALOG_GROUPS,
  fmtBytes,
  type CatalogDatasetRow,
  type DataCatalogPayload,
  type DatasetGroup,
} from "@/lib/dataCatalog";
import type { SeriesIndex, SeriesObject } from "@/lib/dataCatalog";

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

function CatalogPreview({ datasetId }: { datasetId: string }) {
  const [index, setIndex] = useState<SeriesIndex | null>(null);
  const [date, setDate] = useState("");
  const [key, setKey] = useState("");
  const [preview, setPreview] = useState<SeriesObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setError(null);
    void fetch(`/api/series?dataset=${encodeURIComponent(datasetId)}`)
      .then(async (res) => {
        const json = (await res.json()) as SeriesIndex;
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setIndex(json);
        const nextDate = json.days[0]?.date || "";
        const nextKey = json.days[0]?.keys[0]?.key || json.undated[0]?.key || "";
        setDate(nextDate);
        setKey(nextKey);
        if (nextKey) {
          const qs = new URLSearchParams({ dataset: datasetId, key: nextKey });
          if (nextDate) qs.set("date", nextDate);
          const objRes = await fetch(`/api/series?${qs.toString()}`);
          const obj = (await objRes.json()) as SeriesObject;
          if (!cancelled && objRes.ok && obj.ok) setPreview(obj);
        }
      })
      .catch((exc) => {
        if (!cancelled) setError(exc instanceof Error ? exc.message : "목록 실패");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  const keysForDate = useMemo(() => {
    if (!index) return [];
    if (date) return index.days.find((d) => d.date === date)?.keys || [];
    return index.undated;
  }, [index, date]);

  const open = useCallback(async () => {
    if (!key) return;
    setOpening(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ dataset: datasetId, key });
      if (date) qs.set("date", date);
      const res = await fetch(`/api/series?${qs.toString()}`);
      const json = (await res.json()) as SeriesObject;
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setPreview(json);
    } catch (exc) {
      setPreview(null);
      setError(exc instanceof Error ? exc.message : "미리보기 실패");
    } finally {
      setOpening(false);
    }
  }, [datasetId, date, key]);

  useEffect(() => {
    if (keysForDate.length && !keysForDate.some((k) => k.key === key)) {
      setKey(keysForDate[0].key);
    }
  }, [keysForDate, key]);

  if (loading) return <p className="meta-soft">날짜 목록 불러오는 중…</p>;

  const noDays = !index?.days.length && !index?.undated.length;

  return (
    <div className="data-cat-preview">
      <p className="data-cat-preview-label">날짜별 raw</p>
      {error ? <p className="kr-note">{error}</p> : null}
      {noDays ? (
        <p className="meta-soft">아직 날짜 파일이 없습니다. 다음 적재부터 쌓입니다.</p>
      ) : (
        <div className="data-cat-preview-bar">
          {index?.days.length ? (
            <label>
              날짜
              <select value={date} onChange={(e) => setDate(e.target.value)}>
                {index.days.map((d) => (
                  <option key={d.date} value={d.date}>
                    {d.date}
                    {d.keys[0] ? ` · ${fmtBytes(d.keys[0].size)}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {index?.undated.length && !index.days.length ? (
            <label>
              객체
              <select value={key} onChange={(e) => setKey(e.target.value)}>
                {index.undated.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.key} · {fmtBytes(k.size)}
                  </option>
                ))}
              </select>
            </label>
          ) : keysForDate.length > 1 ? (
            <label>
              키
              <select value={key} onChange={(e) => setKey(e.target.value)}>
                {keysForDate.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.key} · {fmtBytes(k.size)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void open()}
            disabled={opening || !key}
          >
            {opening ? "여는 중…" : "미리보기"}
          </button>
        </div>
      )}
      {preview?.ok ? (
        <div className="data-cat-preview-out">
          <code>{preview.key}</code>
          {preview.truncated ? <span className="meta-soft">잘린 미리보기</span> : null}
          <pre>{JSON.stringify(preview.json, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
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
            R2 raw JSON의 위치·보존 정책·객체 수입니다. 세트를 열고 날짜를 고르면 그날
            파일을 그대로 볼 수 있습니다.
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
                          {row.live.samples.map((k) => (
                            <li key={k}>
                              <code>{k}</code>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="meta-soft">아직 객체가 없거나 R2 목록을 못 읽었습니다.</p>
                      )}
                      <CatalogPreview datasetId={row.id} />
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
