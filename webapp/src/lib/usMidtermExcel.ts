/**
 * US midterm politics tab → one cohesive research-report workbook
 * (not a pile of raw data sheets).
 */

import {
  BUDGET_SCENARIO_TONE_LABEL,
  buildBudgetDelayContext,
  type BudgetDelayContext,
} from "@/lib/budgetDelayScenarios";
import { buildMidtermTape, type MidtermTape } from "@/lib/midtermTape";
import {
  MIDTERM_ELECTION_LABEL,
  RATING_LABEL,
  formatKstStamp,
  type MidtermPayload,
} from "@/lib/usMidterm";
import {
  buildXlsx,
  headerRow,
  type CellInput,
  type SheetSpec,
} from "@/lib/xlsxWorkbook";

const W = [14, 22, 18, 18, 18, 18, 42];

function blank(): CellInput[] {
  return [];
}

function title(text: string): CellInput[] {
  return [{ v: text, t: "header" }];
}

function section(text: string): CellInput[] {
  return headerRow([text]);
}

function line(...cells: CellInput[]): CellInput[] {
  return cells;
}

function para(text: string): CellInput[] {
  return [text];
}

function kv(label: string, value: CellInput): CellInput[] {
  return [label, value];
}

function pctTxt(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function signedPp(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(digits)}pp`;
}

function partyKo(p?: string | null): string {
  if (p === "D") return "민주";
  if (p === "R") return "공화";
  return "—";
}

function fmtPx(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

function fmtRet(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function leanChamber(
  dem?: number | null,
  gop?: number | null,
): string {
  if (dem == null || gop == null) return "데이터 없음";
  if (Math.abs(dem - gop) < 0.03) return "사실상 동률";
  return dem > gop ? `민주 우세 (${pctTxt(dem, 0)})` : `공화 우세 (${pctTxt(gop, 0)})`;
}

function coverBlock(payload: MidtermPayload): CellInput[][] {
  const stamp = payload.generated_at
    ? `${formatKstStamp(payload.generated_at)} KST`
    : "";
  return [
    title("SavvyETF 리서치 노트"),
    title("2026 미국 중간선거 · 정치·예산 시나리오"),
    blank(),
    kv("투표일", MIDTERM_ELECTION_LABEL),
    kv("선거까지", `D-${payload.days_to_election}`),
    kv("스냅샷", stamp || payload.generated_at || "—"),
    kv("갱신", payload.schedule_note || ""),
    blank(),
    para(
      "이 파일은 대시보드 ‘정치분석 · 미 중간선거’ 화면을 하나의 리포트로 정리한 것임. 표는 본문 흐름 안에 끼워 두었고, 원자료 덤프가 아님.",
    ),
  ];
}

function execSummary(
  payload: MidtermPayload,
  tape: MidtermTape,
  budget: BudgetDelayContext,
): CellInput[][] {
  const n = payload.national;
  const top = [...payload.power]
    .filter((p) => p.probability != null)
    .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))[0];

  const rows: CellInput[][] = [
    section("1. 한눈에 보기"),
    blank(),
    para(`■ 중간선거 읽기`),
    para(tape.headline),
    para(tape.sub),
    ...tape.bullets.map((b) => para(`· ${b}`)),
    blank(),
    para(`■ 예산 고비`),
    para(budget.headline),
    para(budget.summary),
    blank(),
    para(`■ 숫자로 본 현재`),
    kv(
      "상원 예측시장",
      `${leanChamber(payload.senate?.dem_prob, payload.senate?.gop_prob)} · 현재 ${payload.composition.senate_r}R / ${payload.composition.senate_d}D`,
    ),
    kv(
      "하원 예측시장",
      `${leanChamber(payload.house?.dem_prob, payload.house?.gop_prob)} · 현재 ${payload.composition.house_r}R / ${payload.composition.house_d}D (공석 ${payload.composition.house_vacant})`,
    ),
    kv(
      "제네릭 발롯",
      `등록 D+${(n.generic_ballot_d - n.generic_ballot_r).toFixed(1)} · 유력 D+${(n.generic_ballot_lv_d - n.generic_ballot_lv_r).toFixed(1)} (${n.source}, ${n.as_of})`,
    ),
    kv(
      "트럼프 지지",
      `찬성 ${n.trump_approve.toFixed(1)}% · 반대 ${n.trump_disapprove.toFixed(1)}% · 넷 ${(n.trump_approve - n.trump_disapprove).toFixed(1)}pp`,
    ),
    kv(
      "권력 조합 1순위",
      top
        ? `${top.label_ko} ${pctTxt(top.probability, 0)}${top.change_1m != null ? ` · 1개월 ${signedPp(top.change_1m)}` : ""}`
        : "—",
    ),
    kv("스터디 대응 시나리오", `${tape.scenarioLabel} — ${tape.scenarioSub}`),
    kv("임시예산 만료", `${budget.cr_end} (D-${budget.days_to_cliff})`),
  ];

  if (payload.warnings?.length) {
    rows.push(blank(), para("■ 데이터 주의"));
    for (const w of payload.warnings) rows.push(para(`· ${w}`));
  }
  return rows;
}

function budgetChapter(budget: BudgetDelayContext): CellInput[][] {
  const rows: CellInput[][] = [
    blank(),
    section("2. 예산안이 밀리면"),
    blank(),
    para(
      `${budget.bill}. ${budget.signed} 서명. 적용 구간 ${budget.cr_start} → ${budget.cr_end}. 다음 고비 ${budget.cliff_label}.`,
    ),
    para(budget.headline),
    para(budget.summary),
    blank(),
    para("■ 현황"),
    ...budget.status_bullets.map((b) => para(`· ${b}`)),
    blank(),
    para("■ 시나리오 네 갈래"),
    para(
      "기본안은 12월 임시예산 재연장임. 선거 직후 단기 셧다운, 일부 본예산 타결, 채무한도까지 겹치는 최악은 가능성 순으로 아래에 정리했음.",
    ),
    blank(),
    headerRow(["시나리오", "성격", "가능성", "전개", "정치", "시장", "관심"]),
  ];

  for (const s of budget.scenarios) {
    rows.push([
      s.label,
      BUDGET_SCENARIO_TONE_LABEL[s.tone],
      s.probability_ko,
      s.trigger,
      s.politics,
      s.market,
      s.watch.join(", "),
    ]);
  }

  rows.push(
    blank(),
    para("■ 과거엔 어땠나"),
    headerRow(["때", "일수", "S&P", "채권", "금", "한 줄"]),
  );
  for (const h of budget.history) {
    rows.push([
      h.year,
      h.days > 0 ? `${h.days}일` : "—",
      h.spx_note,
      h.tlt_note,
      h.gold_note,
      h.lesson,
    ]);
  }
  rows.push(blank(), para(budget.note));
  return rows;
}

function chamberChapter(payload: MidtermPayload, tape: MidtermTape): CellInput[][] {
  const c = payload.composition;
  const rows: CellInput[][] = [
    blank(),
    section("3. 상원·하원 지배권"),
    blank(),
    para(
      `예측시장 기준 상원은 ${leanChamber(payload.senate?.dem_prob, payload.senate?.gop_prob)}, 하원은 ${leanChamber(payload.house?.dem_prob, payload.house?.gop_prob)}임. 공화 대통령 사이클에서 스터디가 가리키는 역사 대응은 「${tape.scenarioLabel}」임.`,
    ),
    blank(),
    headerRow([
      "원",
      "현재",
      "과반",
      "민주",
      "공화",
      "민주 1주",
      "민주 1개월",
    ]),
    [
      "상원",
      `${c.senate_r}R · ${c.senate_d}D (탈환 ${c.senate_to_flip})`,
      "51 / 50+VP",
      pctTxt(payload.senate?.dem_prob, 0),
      pctTxt(payload.senate?.gop_prob, 0),
      signedPp(payload.senate?.change_1w_dem),
      signedPp(payload.senate?.change_1m_dem),
    ],
    [
      "하원",
      `${c.house_r}R · ${c.house_d}D (공석 ${c.house_vacant})`,
      String(c.house_majority),
      pctTxt(payload.house?.dem_prob, 0),
      pctTxt(payload.house?.gop_prob, 0),
      signedPp(payload.house?.change_1w_dem),
      signedPp(payload.house?.change_1m_dem),
    ],
  ];

  if (payload.power.length) {
    rows.push(
      blank(),
      para("■ 상원×하원 조합 확률"),
      headerRow(["조합", "확률", "1개월"]),
    );
    for (const p of [...payload.power].sort(
      (a, b) => (b.probability ?? 0) - (a.probability ?? 0),
    )) {
      rows.push([p.label_ko, pctTxt(p.probability, 0), signedPp(p.change_1m)]);
    }
  }

  if (payload.seat_histogram.length) {
    rows.push(
      blank(),
      para("■ 공화당 상원 의석 분포 (예측시장 버킷)"),
      para("≤49면 민주 과반, 50은 부통령 캐스팅보트(공화), 51+는 공화 과반."),
      headerRow(["버킷", "확률", "1주"]),
    );
    for (const b of payload.seat_histogram) {
      rows.push([b.label, pctTxt(b.probability, 1), signedPp(b.change_1w)]);
    }
  }
  return rows;
}

function nationalChapter(payload: MidtermPayload): CellInput[][] {
  const n = payload.national;
  return [
    blank(),
    section("4. 전국 펀더멘털"),
    blank(),
    para(
      `제네릭 하원 발롯은 등록 기준 민주 ${n.generic_ballot_d.toFixed(1)}–공화 ${n.generic_ballot_r.toFixed(1)} (D+${(n.generic_ballot_d - n.generic_ballot_r).toFixed(1)}), 유력유권자는 D+${(n.generic_ballot_lv_d - n.generic_ballot_lv_r).toFixed(1)}임. 출처 ${n.source} (${n.as_of}).`,
    ),
    para(
      `트럼프 지지율은 찬성 ${n.trump_approve.toFixed(1)}% · 반대 ${n.trump_disapprove.toFixed(1)}%로 넷 ${(n.trump_approve - n.trump_disapprove).toFixed(1)}pp. 중간선거 레퍼렌덤의 핵심 펀더멘털임.`,
    ),
    para(
      `상원 탈환에 민주당이 필요한 순증은 ${payload.composition.senate_to_flip}석. 35석 중 공화 방어가 더 많고, 메인·텍사스·오하이오·아이오와·알래스카가 스윙 축임.`,
    ),
  ];
}

function raceChapter(payload: MidtermPayload): CellInput[][] {
  const rows: CellInput[][] = [
    blank(),
    section("5. 핵심 상원 경합과 시장 함의"),
    blank(),
    para(
      "등급은 Cook · 270toWin · Decision Desk HQ 합의. 아래는 경합·관심 주의 매치업과, 누가 이기면 시장이 무엇을 가격할지 정리한 것임.",
    ),
    blank(),
    headerRow(["주", "등급", "매치업", "예측시장", "쟁점", "시장 함의", "티커"]),
  ];

  for (const r of payload.races) {
    const tags = [r.special ? "보궐" : "", r.open ? "공석" : ""].filter(Boolean).join("·");
    rows.push([
      `${r.state_ko} ${r.state}${tags ? ` (${tags})` : ""}`,
      RATING_LABEL[r.rating],
      `${r.dem} vs ${r.gop}`,
      `D ${pctTxt(r.dem_prob ?? null, 0)} · R ${pctTxt(r.gop_prob ?? null, 0)}`,
      r.policy_issue,
      r.market_implication,
      (r.related_tickers || []).join(", "),
    ]);
  }

  const withProfiles = payload.races.filter((r) => r.dem_profile && r.gop_profile);
  if (withProfiles.length) {
    rows.push(
      blank(),
      para("■ 유력 후보 — 이기면 시장"),
    );
    for (const r of withProfiles) {
      rows.push(blank(), para(`【${r.state_ko} ${r.state} · ${RATING_LABEL[r.rating]}】`));
      for (const profile of [r.dem_profile!, r.gop_profile!]) {
        rows.push(
          para(
            `${partyKo(profile.party)} ${profile.name} (${profile.role}) — ${profile.slogan}`,
          ),
          para(`이력: ${profile.bio}`),
          para(`가치: ${profile.values}`),
          para(`이기면: ${profile.market_if_wins}`),
        );
      }
    }
  }

  // Rating board as compact prose
  const byRating = new Map<string, string[]>();
  for (const m of payload.map) {
    const label = RATING_LABEL[m.rating];
    const list = byRating.get(label) || [];
    list.push(m.special ? `${m.state}*` : m.state);
    byRating.set(label, list);
  }
  rows.push(blank(), para("■ 상원 등급 보드 (* 보궐)"));
  for (const [label, states] of byRating) {
    rows.push(kv(label, states.join(" · ")));
  }

  return rows;
}

function marketChapter(payload: MidtermPayload): CellInput[][] {
  const rows: CellInput[][] = [
    blank(),
    section("6. 시장 함의 · 관련 ETF"),
    blank(),
    para(
      "분열 의회(유력: 민주 하원 + 공화 상원)면 대형 입법보다 조사·규제·관세가 변수임. 아래 숫자는 일간 가격이지 선거 베팅이 아님.",
    ),
    blank(),
    headerRow(["심볼", "테마", "각도", "가격", "1일", "5일"]),
  ];
  for (const e of payload.etfs) {
    rows.push([
      e.symbol,
      e.label,
      e.angle,
      fmtPx(e.price),
      fmtRet(e.change_1d_pct),
      fmtRet(e.change_5d_pct),
    ]);
  }
  return rows;
}

function historyChapter(payload: MidtermPayload): CellInput[][] {
  const rows: CellInput[][] = [
    blank(),
    section("7. 중간선거 역사 — 대통령 정당 의석"),
    blank(),
    para("대통령 소속 정당의 하원·상원 순증감. 음수는 여당 손실."),
    blank(),
    headerRow(["연도", "대통령", "하원", "상원", "노트"]),
  ];
  for (const h of payload.history) {
    rows.push([
      String(h.year),
      partyKo(h.president_party),
      `${h.house_net > 0 ? "+" : ""}${h.house_net}`,
      `${h.senate_net > 0 ? "+" : ""}${h.senate_net}`,
      h.note,
    ]);
  }
  return rows;
}

function headlinesChapter(payload: MidtermPayload): CellInput[][] {
  if (!payload.headlines?.length) return [];
  const rows: CellInput[][] = [
    blank(),
    section("8. 최근 헤드라인"),
    blank(),
  ];
  for (const h of payload.headlines) {
    const when = h.published
      ? new Date(h.published).toLocaleDateString("ko-KR")
      : "";
    rows.push(para(`· [${h.source}${when ? ` · ${when}` : ""}] ${h.title}`));
    if (h.link) rows.push(line("", h.link));
  }
  return rows;
}

function closingChapter(
  payload: MidtermPayload,
  budget: BudgetDelayContext,
): CellInput[][] {
  const rows: CellInput[][] = [
    blank(),
    section("9. 출처 · 면책"),
    blank(),
    para(payload.note || ""),
    para(budget.note),
    blank(),
    para("■ 중간선거"),
  ];
  for (const s of payload.sources) {
    rows.push(para(`· ${s.name} — ${s.role}`), line("", s.url));
  }
  rows.push(blank(), para("■ 예산"));
  for (const s of budget.sources) {
    rows.push(para(`· ${s.name}`), line("", s.url));
  }
  rows.push(
    blank(),
    para(
      "SavvyETF · 교육·리서치 참고용. 투자·선거·법률 자문이 아님.",
    ),
  );
  return rows;
}

function reportSheet(payload: MidtermPayload): SheetSpec {
  const budget = buildBudgetDelayContext();
  const tape = buildMidtermTape({
    senate: payload.senate,
    house: payload.house,
    power: payload.power,
  });

  const rows: CellInput[][] = [
    ...coverBlock(payload),
    blank(),
    ...execSummary(payload, tape, budget),
    ...budgetChapter(budget),
    ...chamberChapter(payload, tape),
    ...nationalChapter(payload),
    ...raceChapter(payload),
    ...marketChapter(payload),
    ...historyChapter(payload),
    ...headlinesChapter(payload),
    ...closingChapter(payload, budget),
  ];

  return {
    name: "리서치노트",
    rows,
    widths: W,
    freezeRows: 2,
  };
}

export function usMidtermExcelFilename(generatedAt?: string): string {
  const stamp = (generatedAt || new Date().toISOString()).slice(0, 10);
  return `savvyetf-us-midterm-report-${stamp}.xlsx`;
}

export function buildUsMidtermExcel(payload: MidtermPayload): Buffer {
  return buildXlsx([reportSheet(payload)], {
    title: "SavvyETF — 2026 US Midterm Research Note",
    creator: "SavvyETF",
  });
}
