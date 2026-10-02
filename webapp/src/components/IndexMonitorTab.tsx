"use client";

import { useEffect, useMemo, useState } from "react";

import { useAdminSession } from "@/components/AdminSession";
import { adminAuthHeaders } from "@/lib/adminSession";
import {
  HIGHLIGHT_EVENTS,
  INDEX_DATA_SOURCES,
  INDEX_GROUPS,
  INDEX_METHODOLOGY,
  METHODOLOGY_LINKS,
  REBALANCE_CALENDAR,
  SOURCE_TIER_LABEL,
  groupEvents,
  indexGroup,
  indexName,
  isMsciIndex,
  type IndexChangeRow,
  type IndexEvent,
  type IndexGroup,
  type IndexMonitorResponse,
} from "@/lib/indexMonitor";

type View = "overview" | "history" | "method" | "data";

function kstToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** Coarse labels ("2026-11 하순", "2027-06") stay listed until their month ends. */
function calendarSortKey(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : `${date.slice(0, 7)}-31`;
}

function rowMatches(r: IndexChangeRow, q: string): boolean {
  return `${r.security_name} ${r.code} ${r.note}`.toLowerCase().includes(q);
}

function EventCard({ event, query }: { event: IndexEvent; query: string }) {
  const adds = event.rows.filter((r) => r.action === "ADD");
  const dels = event.rows.filter((r) => r.action === "DEL");
  const weights = event.rows.filter((r) => r.action === "WEIGHT");

  const item = (r: IndexChangeRow, i: number) => (
    <li key={`${r.security_name}-${i}`}>
      <span className={query && rowMatches(r, query) ? "im-hit" : undefined}>{r.security_name}</span>
      {r.code ? <span className="im-code">{r.code}</span> : null}
      {r.note ? <span className="im-note">{r.note}</span> : null}
    </li>
  );

  const column = (label: string, cls: string, list: IndexChangeRow[]) => (
    <div className="im-col">
      <span className={`im-pill ${cls}`}>
        {label} {list.length}
      </span>
      {list.length ? <ul>{list.map(item)}</ul> : <p className="meta-soft">없음</p>}
    </div>
  );

  return (
    <article className="im-ev">
      <header>
        <h3>
          {indexName(event.index_id)} <span className="im-review">{event.review}</span>
        </h3>
        <span className="im-meta">
          {event.announce ? `발표 ${event.announce} · ` : ""}반영 {event.effective || "미정"}
        </span>
      </header>
      {weights.length && !adds.length && !dels.length ? (
        <div className="im-cols">
          <div className="im-col im-col-full">
            <span className="im-pill im-p-w">비중 변경 {weights.length}</span>
            <ul>{weights.map(item)}</ul>
          </div>
        </div>
      ) : (
        <div className="im-cols">
          {column("편입", "im-p-add", adds)}
          {column("편출", "im-p-del", dels)}
        </div>
      )}
      <footer>
        <span>
          출처:{" "}
          {event.tiers.map((t, i) => (
            <span key={t} className={t === "secondary" ? "im-tier-warn" : undefined}>
              {i ? " · " : ""}
              {SOURCE_TIER_LABEL[t] ?? t}
            </span>
          ))}
        </span>
        {event.url ? (
          <a href={event.url} target="_blank" rel="noopener noreferrer">
            원문 보기
          </a>
        ) : null}
      </footer>
    </article>
  );
}

const BAR_COUNTRIES: { label: string; ids: string[] }[] = [
  { label: "한국", ids: ["KOSPI200", "KOSDAQ150", "MSCI_KOREA"] },
  { label: "미국", ids: ["SP500", "SP100", "NDX"] },
  { label: "일본", ids: ["NIKKEI225"] },
  { label: "기타 국가", ids: ["MSCI_OTHER"] },
];

function CountBars({ rows }: { rows: IndexChangeRow[] }) {
  const bars = useMemo(() => {
    const otherMsci = new Set<string>();
    const agg = new Map<string, { ADD: number; DEL: number; WEIGHT: number }>();
    for (const r of rows) {
      const other = isMsciIndex(r.index_id) && r.index_id !== "MSCI_KOREA";
      if (other) otherMsci.add(r.index_id);
      const g = other ? "MSCI_OTHER" : r.index_id;
      const v = agg.get(g) ?? { ADD: 0, DEL: 0, WEIGHT: 0 };
      v[r.action] += 1;
      agg.set(g, v);
    }
    const bar = (g: string) => {
      const v = agg.get(g)!;
      return {
        g,
        label: g === "MSCI_OTHER" ? `MSCI ${otherMsci.size}개국` : indexName(g),
        v,
        total: v.ADD + v.DEL + v.WEIGHT,
      };
    };
    const known = new Set(BAR_COUNTRIES.flatMap((c) => c.ids));
    const unlisted = [...agg.keys()].filter((g) => !known.has(g));
    const countries = [
      ...BAR_COUNTRIES.map((c) => ({ label: c.label, bars: c.ids.filter((g) => agg.has(g)).map(bar) })),
      { label: "기타 지수", bars: unlisted.map(bar) },
    ].filter((c) => c.bars.length);
    const max = Math.max(1, ...countries.flatMap((c) => c.bars.map((b) => b.total)));
    return { countries, max };
  }, [rows]);

  return (
    <div className="im-bars">
      {bars.countries.map((c) => (
        <div key={c.label} className="im-bar-group">
          <span className="im-bar-country">{c.label}</span>
          {c.bars.map(({ g, label, v }) => (
            <div key={g} className="im-bar">
              <span>{label}</span>
              <span className="im-track" title={`편입 ${v.ADD} · 편출 ${v.DEL}`}>
                <i className="im-a" style={{ width: `${(v.ADD / bars.max) * 100}%` }} />
                <i className="im-x" style={{ width: `${(v.DEL / bars.max) * 100}%` }} />
                <i className="im-w" style={{ width: `${(v.WEIGHT / bars.max) * 100}%` }} />
              </span>
              <span className="im-num">
                {v.ADD}/{v.DEL}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function IndexMonitorTab() {
  const { secret, unlocked, ready } = useAdminSession();
  const [data, setData] = useState<IndexMonitorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [group, setGroup] = useState<IndexGroup>("ALL");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const admin = unlocked && Boolean(secret);
    fetch(admin ? "/api/index-monitor?scope=admin" : "/api/index-monitor", {
      headers: admin ? adminAuthHeaders(secret) : {},
    })
      .then(async (res) => {
        const json = (await res.json()) as IndexMonitorResponse;
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "불러오기 실패");
      });
    return () => {
      cancelled = true;
    };
  }, [ready, unlocked, secret]);

  useEffect(() => {
    if (!unlocked && view === "data") setView("overview");
  }, [unlocked, view]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const events = useMemo(() => groupEvents(rows), [rows]);
  const hasMsci = useMemo(() => rows.some((r) => isMsciIndex(r.index_id)), [rows]);

  const highlights = useMemo(() => {
    const byKey = new Map(events.map((e) => [e.key, e]));
    return HIGHLIGHT_EVENTS.map((k) => byKey.get(k)).filter((e): e is IndexEvent => Boolean(e));
  }, [events]);

  const upcoming = useMemo(() => {
    const today = kstToday();
    return REBALANCE_CALENDAR.filter((c) => calendarSortKey(c.date) >= today);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      events.filter(
        (e) =>
          (group === "ALL" || indexGroup(e.index_id) === group) &&
          (!q || e.rows.some((r) => rowMatches(r, q))),
      ),
    [events, group, q],
  );

  const groups = INDEX_GROUPS.filter((g) => g.id !== "MSCI" || hasMsci);
  const views: { id: View; label: string }[] = [
    { id: "overview", label: "개요 · 일정" },
    { id: "history", label: "편출입 히스토리" },
    { id: "method", label: "지수 · 방법론" },
    ...(unlocked ? [{ id: "data" as View, label: "데이터 적재" }] : []),
  ];

  return (
    <div className="panel-stack index-monitor">
      <section className="geo-section geo-featured">
        <div className="kr-hero">
          <div>
            <h2 className="kr-hero-title">Index Monitor</h2>
            <p className="kr-hero-sub">
              주요 주가지수의 방법론, 2025–26년 편출입, 다가오는 리밸런싱 일정을 한 곳에 모았습니다. 확정 일정은 지수사업자
              공지, 예상 일정은 규칙상 날짜로 계산한 값입니다.
            </p>
          </div>
        </div>
        <p className="meta-soft">
          {data ? `기준일 ${data.asOf} · 이벤트 ${events.length}건 · 변경 ${rows.length}행` : ""}
          {unlocked && hasMsci ? " · 관리자: MSCI 포함" : ""}
        </p>
        {error ? <p className="empty">{error}</p> : null}
        {!data && !error ? <p className="empty">불러오는 중…</p> : null}
        <div className="chip-row im-views" role="tablist">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              className={`chip${view === v.id ? " active" : ""}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </section>

      {view === "overview" ? (
        <>
          <div className="im-grid2">
            <section className="geo-section panel">
              <h3 className="im-h">다가오는 리밸런싱</h3>
              <p className="meta-soft">확정은 지수사업자가 공지한 일정, 예상은 규칙상 날짜로 계산한 값입니다.</p>
              {upcoming.length ? (
                <ul className="im-cal">
                  {upcoming.map((c) => (
                    <li key={`${c.date}-${c.title}`}>
                      <span className="im-d">{c.date}</span>
                      <span>
                        <b>{c.title}</b>
                        <br />
                        <span className="meta-soft">{c.sub}</span>
                      </span>
                      <span className={`im-pill ${c.confirmed ? "im-p-fix" : "im-p-est"}`}>
                        {c.confirmed ? "확정" : "예상"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">등록된 향후 일정이 없습니다. 일정 표를 갱신해야 합니다.</p>
              )}
            </section>
            <section className="geo-section panel">
              <h3 className="im-h">지수별 수집 변경 건수</h3>
              <p className="meta-soft">
                2025-12 ~ 2026-09 공지 기준. <span className="im-k-add">■ 편입</span>{" "}
                <span className="im-k-del">■ 편출</span> <span className="im-k-w">■ 비중변경</span>
              </p>
              <CountBars rows={rows} />
            </section>
          </div>
          <section className="geo-section panel">
            <h3 className="im-h">최근 주요 이벤트</h3>
            <p className="meta-soft">국내 투자자 관점에서 영향이 큰 이벤트만 골랐습니다. 전체는 편출입 히스토리에 있습니다.</p>
            <div className="im-events">
              {highlights.map((e) => (
                <EventCard key={e.key} event={e} query="" />
              ))}
            </div>
          </section>
        </>
      ) : null}

      {view === "history" ? (
        <section className="geo-section panel">
          <div className="im-filters">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`chip${group === g.id ? " active" : ""}`}
                aria-pressed={group === g.id}
                onClick={() => setGroup(g.id)}
              >
                {g.label}
              </button>
            ))}
            <input
              type="search"
              className="im-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="종목명·코드 검색 (예: LG이노텍, SNDK)"
              aria-label="종목 검색"
            />
            <span className="im-num">{filtered.length}건</span>
          </div>
          <div className="im-events">
            {filtered.length ? (
              filtered.map((e) => <EventCard key={e.key} event={e} query={q} />)
            ) : (
              <p className="empty">검색 결과가 없습니다. 다른 이름이나 6자리 코드로 찾아보세요.</p>
            )}
          </div>
        </section>
      ) : null}

      {view === "method" ? (
        <>
          <section className="geo-section panel">
            <h3 className="im-h">주요 주가지수와 방법론 요약</h3>
            <p className="meta-soft">
              추종 자금 규모와 국내 수급 영향 기준으로 12개를 골랐습니다. 2026년에 규칙이 바뀐 지수는 마지막 열에 적었습니다.
            </p>
            <div className="im-tbl">
              <table>
                <thead>
                  <tr>
                    <th>지수</th>
                    <th>구성·유니버스</th>
                    <th>선정 방식</th>
                    <th>가중</th>
                    <th>정기변경</th>
                    <th>2026 변경점 · 메모</th>
                  </tr>
                </thead>
                <tbody>
                  {INDEX_METHODOLOGY.map((m) => (
                    <tr key={m.name}>
                      <td className="im-idx">
                        {m.name}
                        <span className="im-sub">{m.provider}</span>
                      </td>
                      <td>{m.universe}</td>
                      <td>{m.selection}</td>
                      <td>{m.weighting}</td>
                      <td>{m.schedule}</td>
                      <td>{m.memo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="im-grid2">
            <section className="geo-section panel">
              <h3 className="im-h">국내 수급 관점의 핵심 차이</h3>
              <ul className="im-list">
                <li>
                  <b>MSCI Korea</b>는 전체 시총과 유동 시총 두 기준을 모두 넘어야 편입됩니다. 가격 기준일이 직전 월말 10영업일 중
                  임의일이라 사전 예측에 불확실성이 큽니다.
                </li>
                <li>
                  <b>코스피200</b>은 산업군별 누적 시총과 유동성으로 뽑고 기존 종목에 버퍼를 줍니다. 대형 신규상장은 특례로 수시
                  편입됩니다.
                </li>
                <li>
                  <b>FTSE</b>는 한국을 선진시장으로, <b>MSCI</b>는 신흥시장으로 분류합니다. MSCI는 2026년 6월 리뷰에서도
                  관찰대상국 등재를 보류했습니다.
                </li>
                <li>
                  <b>Nasdaq-100</b>은 2026년 5월부터 3·6·9월에도 순위 심사로 종목을 교체하고, 초대형 신규상장은 15거래일 만에
                  편입합니다.
                </li>
              </ul>
            </section>
            <section className="geo-section panel">
              <h3 className="im-h">방법론 원문</h3>
              <ul className="im-list">
                {METHODOLOGY_LINKS.map((l) => (
                  <li key={l.label}>
                    {l.href ? (
                      <a href={l.href} target="_blank" rel="noopener noreferrer">
                        {l.label}
                      </a>
                    ) : (
                      l.label
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      ) : null}

      {view === "data" && unlocked ? (
        <>
          <section className="geo-section panel">
            <h3 className="im-h">과거 리밸런싱 이력, 적재할 수 있나</h3>
            <p className="meta-soft">
              관리자 전용. 공지(이벤트) 이력은 무료 공개 자료로 대부분 모을 수 있고, 시점별 구성종목·비중은 Datastream이나
              ETF 보유종목 스냅샷으로 채우는 구조가 현실적입니다.
            </p>
            <p className="im-ok">
              <b>실제 검증:</b> MSCI 2026년 8월 공개 리스트를 파서로 읽어 23개국 147행을 만들었고, 국가별 편입·편출 수가 MSCI
              요약표와 모두 일치했습니다(합계 편입 55 · 편출 92 = 보도자료 ACWI 수치).
            </p>
            <div className="im-tbl">
              <table>
                <thead>
                  <tr>
                    <th>소스</th>
                    <th>제공 내용</th>
                    <th>형식 · 접근</th>
                    <th>이력 깊이</th>
                    <th>자동화</th>
                    <th>권리 리스크</th>
                    <th>판단</th>
                  </tr>
                </thead>
                <tbody>
                  {INDEX_DATA_SOURCES.map((s) => (
                    <tr key={s.name}>
                      <td className="im-idx">{s.name}</td>
                      <td>{s.content}</td>
                      <td>{s.access}</td>
                      <td>{s.depth}</td>
                      <td className="im-dots" aria-label={`자동화 ${s.automation}/3`}>
                        <b>{"●".repeat(s.automation)}</b>
                        <s>{"●".repeat(3 - s.automation)}</s>
                      </td>
                      <td>{s.risk}</td>
                      <td>
                        <span className={`im-verdict im-v-${s.verdict}`}>{s.verdictLabel}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="im-warn">
              <b>주의할 점 두 가지.</b> MSCI 공개 PDF 고지문은 그 정보로 데이터베이스나 분석 도구를 만드는 것을 금지합니다. 그래서
              이 탭은 MSCI 국가별 편출입을 관리자에게만 보여 줍니다. KRX 정보데이터시스템은 2025년 12월 27일부터 로그인이 필수가
              됐고, 2026년 9월 17일 이후 일부 오픈소스 수집기에서 로그인 실패가 보고됐습니다.
            </p>
          </section>
          <section className="geo-section panel">
            <h3 className="im-h">적재 단계</h3>
            <div className="im-steps">
              <div className="im-step">
                <span className="meta-soft">P0 · 지금</span>
                <h4>시드 이력</h4>
                <p>공식 공지·보도 기반 2025-12~2026-09 이벤트, 변경 {rows.length}행. 출처 등급을 행마다 기록.</p>
              </div>
              <div className="im-step">
                <span className="meta-soft">P1 · 2–3주</span>
                <h4>공지 수집기</h4>
                <p>S&amp;P·Nasdaq 보도자료, FTSE Russell 공지, MSCI 공개 PDF, Wikipedia 변경표를 주기적으로 읽어 추가.</p>
              </div>
              <div className="im-step">
                <span className="meta-soft">P2 · 백필</span>
                <h4>스냅샷 diff</h4>
                <p>Datastream 과거 구성종목과 ETF 보유종목을 리밸런싱일 기준으로 쌓고, 전후 차이로 누락과 실제 반영일을 검증.</p>
              </div>
              <div className="im-step">
                <span className="meta-soft">P3 · 분석</span>
                <h4>이벤트 스터디</h4>
                <p>발표일·반영일 전후 초과수익과 거래대금, 추정 패시브 수급을 계산해 리밸런싱 분석과 주보·월보에 연결.</p>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
