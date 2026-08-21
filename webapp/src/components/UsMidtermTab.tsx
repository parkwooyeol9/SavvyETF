"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  MIDTERM_ELECTION_LABEL,
  MIDTERM_SCHEDULE_NOTE,
  RATING_LABEL,
  RATING_ORDER,
  fmtPctPoints,
  fmtSignedPct,
  formatKstStamp,
  ratingTone,
  type CandidateProfile,
  type ChamberMarket,
  type MidtermPayload,
  type RaceRating,
  type SenateRace,
} from "@/lib/usMidterm";

const tooltipStyle = {
  background: "#141d2b",
  border: "1px solid #2b3648",
  borderRadius: 8,
  color: "#e8eef5",
};

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

function favorite(dem?: number | null, gop?: number | null): "D" | "R" | "toss" {
  if (dem == null || gop == null) return "toss";
  if (Math.abs(dem - gop) < 0.03) return "toss";
  return dem > gop ? "D" : "R";
}

function ChamberCard({
  title,
  subtitle,
  market,
  current,
  need,
}: {
  title: string;
  subtitle: string;
  market: ChamberMarket | null;
  current: string;
  need: string;
}) {
  const dem = market?.dem_prob ?? null;
  const gop = market?.gop_prob ?? null;
  const sum = (dem ?? 0) + (gop ?? 0);
  const demW = sum > 0 && dem != null ? (dem / sum) * 100 : 50;
  const gopW = 100 - demW;
  const fav = favorite(dem, gop);
  const lead =
    fav === "toss"
      ? "사실상 동률"
      : fav === "D"
        ? "민주당 우세"
        : "공화당 우세";

  return (
    <article className="midterm-chamber">
      <div className="midterm-chamber-kicker">{title}</div>
      <h3>{lead}</h3>
      <p className="midterm-chamber-sub">{subtitle}</p>
      <div className="midterm-prob-nums">
        <div data-party="d">
          <span>민주당</span>
          <strong>{fmtPctPoints(dem, 0)}</strong>
        </div>
        <div data-party="r">
          <span>공화당</span>
          <strong>{fmtPctPoints(gop, 0)}</strong>
        </div>
      </div>
      <div className="midterm-split-bar" aria-hidden>
        <span style={{ width: `${demW}%` }} data-party="d" />
        <span style={{ width: `${gopW}%` }} data-party="r" />
      </div>
      <div className="midterm-chamber-meta">
        <span>현재 {current}</span>
        <span>{need}</span>
        {market?.change_1w_dem != null ? (
          <span>
            민주 1주 {fmtSignedPct(market.change_1w_dem)}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function CandidateColumn({ profile }: { profile: CandidateProfile }) {
  return (
    <article className="midterm-cand" data-party={profile.party.toLowerCase()}>
      <header>
        <div className="midterm-face">
          {profile.photo_url ? (
            <img
              src={profile.photo_url}
              alt={`${profile.name} 초상`}
              width={96}
              height={120}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span aria-hidden>{initials(profile.name)}</span>
          )}
        </div>
        <div>
          <em>{profile.party === "D" ? "민주" : "공화"}</em>
          <h4>{profile.name}</h4>
          <span>{profile.role}</span>
        </div>
      </header>
      <dl>
        <div>
          <dt>이력</dt>
          <dd>{profile.bio}</dd>
        </div>
        <div>
          <dt>표방하는 가치</dt>
          <dd>{profile.values}</dd>
        </div>
        <div>
          <dt>주요 구호</dt>
          <dd>{profile.slogan}</dd>
        </div>
        <div>
          <dt>이 후보가 이기면</dt>
          <dd>{profile.market_if_wins}</dd>
        </div>
      </dl>
    </article>
  );
}

function RaceRow({ race }: { race: SenateRace }) {
  const tone = ratingTone(race.rating);
  const dem = race.dem_prob;
  const gop = race.gop_prob;
  const sum = (dem ?? 0) + (gop ?? 0);
  const demW = sum > 0 && dem != null ? (dem / sum) * 100 : null;

  return (
    <tr>
      <td>
        <strong>
          {race.state_ko} {race.state}
        </strong>
        {race.special ? <em className="midterm-tag">보궐</em> : null}
        {race.open ? <em className="midterm-tag">공석</em> : null}
        <div className="midterm-race-note">{race.note}</div>
      </td>
      <td>
        <span className={`midterm-rating tone-${tone}`}>{RATING_LABEL[race.rating]}</span>
      </td>
      <td>
        <span data-party="d">{race.dem}</span>
        <span className="midterm-vs"> vs </span>
        <span data-party="r">{race.gop}</span>
      </td>
      <td className="num">
        {demW != null ? (
          <div className="midterm-mini-bar">
            <span style={{ width: `${demW}%` }} data-party="d" />
            <span style={{ width: `${100 - demW}%` }} data-party="r" />
          </div>
        ) : (
          <span className="muted">시장 없음</span>
        )}
        <div className="midterm-mini-nums">
          D {fmtPctPoints(dem, 0)} · R {fmtPctPoints(gop, 0)}
        </div>
      </td>
    </tr>
  );
}

export default function UsMidtermTab() {
  const [data, setData] = useState<MidtermPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/us-midterm", { cache: "no-store" });
      const json = (await res.json()) as MidtermPayload;
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setError(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const hist = useMemo(() => {
    return (data?.seat_histogram || []).map((b) => ({
      ...b,
      pct: b.probability != null ? Math.round(b.probability * 1000) / 10 : 0,
      control: b.seats_high <= 49 ? "d" : b.seats_low >= 51 ? "r" : "tie",
    }));
  }, [data?.seat_histogram]);

  const mapByRating = useMemo(() => {
    const groups: Record<RaceRating, string[]> = {
      "safe-d": [],
      "likely-d": [],
      "lean-d": [],
      "toss-up": [],
      "lean-r": [],
      "likely-r": [],
      "safe-r": [],
    };
    for (const chip of data?.map || []) {
      const label = chip.special ? `${chip.state}*` : chip.state;
      groups[chip.rating].push(label);
    }
    return groups;
  }, [data?.map]);

  const c = data?.composition;
  const n = data?.national;
  const gbLead = n ? n.generic_ballot_d - n.generic_ballot_r : null;
  const lvLead = n ? n.generic_ballot_lv_d - n.generic_ballot_lv_r : null;
  const netApp = n ? n.trump_approve - n.trump_disapprove : null;

  return (
    <div className="midterm-tab">
      <section className="feature-block">
        <div className="feature-head geo-head-row">
          <div>
            <h2 className="feature-title">2026 미국 중간선거</h2>
            <p className="feature-lead">
              상원·하원 지배권, 제네릭 발롯, 경합 상원, 의석 분포. 투표일{" "}
              {MIDTERM_ELECTION_LABEL}.
            </p>
            <p className="meta-soft">
              {data?.schedule_note || MIDTERM_SCHEDULE_NOTE}
              {data?.generated_at
                ? ` · 이번 스냅샷 ${formatKstStamp(data.generated_at)} KST`
                : ""}
            </p>
          </div>
          <div className="midterm-countdown">
            <span>D-{data?.days_to_election ?? "—"}</span>
            <em>11월 3일</em>
          </div>
        </div>

        {loading && !data ? <p className="empty">예보·시장 불러오는 중…</p> : null}
        {error ? <p className="empty warn">{error}</p> : null}
        {data?.warnings?.map((w) => (
          <p key={w} className="empty warn">
            {w}
          </p>
        ))}

        {data ? (
          <>
            <div className="midterm-chamber-grid">
              <ChamberCard
                title="Who will control the Senate?"
                subtitle="공화 53–민주 47. 부통령(밴스)이 가부동수 캐스팅보트 → 민주당은 순증 +4 필요."
                market={data.senate}
                current="53 R · 47 D"
                need="과반 51 (또는 50+VP)"
              />
              <ChamberCard
                title="Who will control the House?"
                subtitle="공화 218–민주 212 (공석 4). 역사적으로 대통령 정당이 하원을 잃는 사이클."
                market={data.house}
                current="218 R · 212 D"
                need="과반 218석"
              />
            </div>

            <div className="midterm-national-grid">
              <article className="midterm-stat">
                <h3>제네릭 하원 발롯</h3>
                <p className="midterm-stat-big" data-party="d">
                  D +{gbLead != null ? gbLead.toFixed(1) : "—"}
                </p>
                <p>
                  등록유권자 {n?.generic_ballot_d.toFixed(1)}–{n?.generic_ballot_r.toFixed(1)}
                  {lvLead != null ? ` · 유력유권자 D+${lvLead.toFixed(1)}` : null}
                </p>
                <p className="meta-soft">
                  {n?.source} · {n?.as_of}
                </p>
              </article>
              <article className="midterm-stat">
                <h3>트럼프 지지율</h3>
                <p className="midterm-stat-big" data-party="r">
                  {n?.trump_approve.toFixed(1)}%
                </p>
                <p>
                  반대 {n?.trump_disapprove.toFixed(1)}% · 넷{" "}
                  {netApp != null ? `${netApp.toFixed(1)}pp` : "—"}
                </p>
                <p className="meta-soft">중간선거 레퍼렌덤의 핵심 펀더멘털</p>
              </article>
              <article className="midterm-stat">
                <h3>상원 탈환 경로</h3>
                <p className="midterm-stat-big">{c?.senate_to_flip}석</p>
                <p>
                  35석 중 공화 방어가 더 많음. 메인·텍사스·오하이오·아이오와·알래스카가 스윙.
                </p>
                <p className="meta-soft">하원은 예측시장이 민주 우세를 강하게 반영</p>
              </article>
            </div>
          </>
        ) : null}
      </section>

      {data?.power?.length ? (
        <section className="geo-section">
          <h3 className="geo-section-title">Balance of power</h3>
          <p className="meta-soft">상원×하원 조합. 분할정부 vs 싹쓸이 시나리오.</p>
          <div className="midterm-power-grid">
            {data.power.map((p) => (
              <article key={p.id} className="midterm-power-card">
                <span>{p.label_ko}</span>
                <strong>{fmtPctPoints(p.probability, 0)}</strong>
                {p.change_1m != null ? (
                  <em>{fmtSignedPct(p.change_1m)} 1개월</em>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {hist.length ? (
        <section className="geo-section">
          <h3 className="geo-section-title">공화당 상원 의석 분포</h3>
          <p className="meta-soft">
            예측시장 버킷. ≤49면 민주 과반, 50은 부통령 캐스팅보트(공화), 51+는 공화 과반.
          </p>
          <div className="geo-chart-wrap" style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hist} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#243049" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "#8fa3b8", fontSize: 11 }} />
                <YAxis
                  tick={{ fill: "#8fa3b8", fontSize: 11 }}
                  tickFormatter={(v: number) => `${v}%`}
                  width={36}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value) => [`${Number(value)}%`, "확률"]}
                />
                <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                  {hist.map((b) => (
                    <Cell
                      key={b.id}
                      fill={
                        b.control === "d"
                          ? "#3b82f6"
                          : b.control === "r"
                            ? "#ef4444"
                            : "#a78bfa"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {data ? (
        <section className="geo-section">
          <h3 className="geo-section-title">상원 등급 보드</h3>
          <p className="meta-soft">
            Cook · 270toWin · Decision Desk HQ 합의 (2026-08-20). * 보궐.
          </p>
          <div className="midterm-board">
            {RATING_ORDER.map((rating) => (
              <div key={rating} className={`midterm-board-col tone-${ratingTone(rating)}`}>
                <header>
                  {RATING_LABEL[rating]}
                  <em>{mapByRating[rating].length}</em>
                </header>
                <div className="midterm-chips">
                  {mapByRating[rating].map((st) => (
                    <span key={st}>{st}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {data?.races?.length ? (
        <section className="geo-section">
          <h3 className="geo-section-title">핵심 상원 경합</h3>
          <div className="deriv-table-wrap">
            <table className="deriv-table midterm-table">
              <thead>
                <tr>
                  <th>주</th>
                  <th>등급</th>
                  <th>매치업</th>
                  <th>예측시장</th>
                </tr>
              </thead>
              <tbody>
                {data.races.map((r) => (
                  <RaceRow key={r.id} race={r} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="midterm-policy-grid">
            {data.races.map((r) => (
              <article key={`${r.id}-policy`} className="midterm-policy-card">
                <header>
                  <strong>
                    {r.state_ko} {r.state}
                  </strong>
                  <span>{r.policy_issue}</span>
                </header>
                <p>
                  <em data-party="d">{r.dem}</em> {r.policy_d}
                </p>
                <p>
                  <em data-party="r">{r.gop}</em> {r.policy_r}
                </p>
                <p className="midterm-policy-mkt">{r.market_implication}</p>
                {r.related_tickers?.length ? (
                  <div className="midterm-policy-tickers">
                    {r.related_tickers.map((t) => (
                      <code key={t}>{t}</code>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {data ? (
        <section className="geo-section">
          <h3 className="geo-section-title">시장 함의 · 관련 ETF</h3>
          <p className="meta-soft">
            분열 의회(유력: 민주 하원 + 공화 상원)면 대형 입법보다 조사·규제·관세가
            변수. 숫자는 일간 가격이지 선거 베팅이 아닙니다.
          </p>
          <div className="geo-signal-grid">
            {data.etfs.map((e) => (
              <article key={e.id} className="geo-signal-card">
                <div className="geo-signal-top">
                  <strong>{e.label}</strong>
                  <code>{e.symbol}</code>
                </div>
                <div className="geo-signal-price">
                  {e.price != null ? e.price.toFixed(2) : "—"}
                </div>
                <div className="geo-signal-chgs">
                  <span className={retClass(e.change_1d_pct)}>
                    1D {fmtPct(e.change_1d_pct)}
                  </span>
                  <span className={retClass(e.change_5d_pct)}>
                    5D {fmtPct(e.change_5d_pct)}
                  </span>
                </div>
                <p className="geo-thesis">{e.angle}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {data?.history?.length ? (
        <section className="geo-section">
          <h3 className="geo-section-title">중간선거 역사 — 대통령 정당 의석 변동</h3>
          <div className="midterm-hist">
            {data.history.map((h) => (
              <article key={h.year}>
                <strong>{h.year}</strong>
                <span data-party={h.president_party.toLowerCase()}>
                  {h.president_party === "D" ? "민주 대통령" : "공화 대통령"}
                </span>
                <em className={h.house_net >= 0 ? "up" : "down"}>
                  하원 {h.house_net > 0 ? "+" : ""}
                  {h.house_net}
                </em>
                <em className={h.senate_net >= 0 ? "up" : "down"}>
                  상원 {h.senate_net > 0 ? "+" : ""}
                  {h.senate_net}
                </em>
                <span>{h.note}</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {data?.headlines?.length ? (
        <section className="geo-section">
          <h3 className="geo-section-title">헤드라인</h3>
          <ul className="geo-headlines">
            {data.headlines.map((h) => (
              <li key={`${h.title}-${h.published || ""}`}>
                {h.link ? (
                  <a href={h.link} target="_blank" rel="noopener noreferrer">
                    {h.title}
                  </a>
                ) : (
                  <span>{h.title}</span>
                )}
                <em>
                  {h.source}
                  {h.published
                    ? ` · ${new Date(h.published).toLocaleDateString("ko-KR")}`
                    : ""}
                </em>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data?.races?.some((r) => r.dem_profile && r.gop_profile) ? (
        <section className="geo-section">
          <h3 className="geo-section-title">경합주 유력 후보 비교</h3>
          <p className="meta-soft">
            일반선거 유력 양 후보의 이력·가치·구호, 그리고 그 후보가 해당 경합주에서
            이겼을 때 예상되는 증권시장 반응. 초상은 Wikimedia Commons 공식·공개 사진.
          </p>
          <div className="midterm-matchups">
            {data.races
              .filter(
                (
                  r,
                ): r is SenateRace & {
                  dem_profile: CandidateProfile;
                  gop_profile: CandidateProfile;
                } => Boolean(r.dem_profile && r.gop_profile),
              )
              .map((race) => (
                <article key={race.id} className="midterm-matchup">
                  <header>
                    <h4>
                      {race.state_ko} {race.state}
                    </h4>
                    <span className={`midterm-rating tone-${ratingTone(race.rating)}`}>
                      {RATING_LABEL[race.rating]}
                    </span>
                    {race.special ? <em className="midterm-tag">보궐</em> : null}
                    {race.open ? <em className="midterm-tag">공석</em> : null}
                  </header>
                  <div className="midterm-matchup-grid">
                    <CandidateColumn profile={race.dem_profile} />
                    <CandidateColumn profile={race.gop_profile} />
                  </div>
                </article>
              ))}
          </div>
        </section>
      ) : null}

      {data ? (
        <p className="meta-soft midterm-footnote">
          갱신{" "}
          {new Date(data.generated_at).toLocaleString("ko-KR", {
            timeZone: "Asia/Seoul",
            hour12: false,
          })}{" "}
          KST · {data.schedule_note || MIDTERM_SCHEDULE_NOTE} · {data.note} 출처:{" "}
          {data.sources.map((s, i) => (
            <span key={s.url}>
              {i ? " · " : null}
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.name}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
