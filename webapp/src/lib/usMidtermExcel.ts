/**
 * Excel export for the politics / US midterm tab:
 * screen comments, budget-delay scenarios, chambers, races, ETFs, headlines.
 */

import {
  BUDGET_SCENARIO_TONE_LABEL,
  buildBudgetDelayContext,
} from "@/lib/budgetDelayScenarios";
import { buildMidtermTape } from "@/lib/midtermTape";
import {
  MIDTERM_ELECTION_LABEL,
  RATING_LABEL,
  type MidtermPayload,
} from "@/lib/usMidterm";
import {
  buildXlsx,
  headerRow,
  intval,
  num,
  type CellInput,
  type SheetSpec,
} from "@/lib/xlsxWorkbook";

function pct(v: number | null | undefined): CellInput {
  if (v == null || Number.isNaN(v)) return "";
  return num(Math.round(v * 1000) / 10);
}

function pctPoints(v: number | null | undefined): CellInput {
  if (v == null || Number.isNaN(v)) return "";
  return num(Math.round(v * 10) / 10);
}

function partyKo(p?: string | null): string {
  if (p === "D") return "민주";
  if (p === "R") return "공화";
  return "—";
}

function readmeSheet(payload: MidtermPayload): SheetSpec {
  const budget = buildBudgetDelayContext();
  const tape = buildMidtermTape({
    senate: payload.senate,
    house: payload.house,
    power: payload.power,
  });
  const rows: CellInput[][] = [
    headerRow(["항목", "내용"]),
    ["제목", "2026 미국 중간선거 · 정치분석"],
    ["투표일", MIDTERM_ELECTION_LABEL],
    ["선거까지", `D-${payload.days_to_election}`],
    ["스냅샷", payload.generated_at || ""],
    ["스케줄", payload.schedule_note || ""],
    ["화면 노트", payload.note || ""],
    [],
    ["화면 코멘트 · 한 줄 결론", tape.headline],
    ["화면 코멘트 · 부제", tape.sub],
    ...tape.bullets.map((b, i) => [`화면 코멘트 · 불릿 ${i + 1}`, b] as CellInput[]),
    ["스터디 시나리오", `${tape.scenarioLabel} (${tape.scenario})`],
    [],
    ["예산 헤드라인", budget.headline],
    ["예산 요약", budget.summary],
    ["임시예산 만료", budget.cr_end],
    ["만료까지", `D-${budget.days_to_cliff}`],
    ["예산 노트", budget.note],
    [],
    ["경고", payload.warnings?.join(" · ") || "없음"],
    ["캐시", payload.from_cache ? "예" : "아니오"],
    [],
    ["시트", "README · 화면코멘트 · 예산상황 · 예산시나리오 · 예산역사 · 상원하원 · 전국폴 · 권력균형 · 의석분포 · 상원경합 · 등급보드 · ETF · 헤드라인 · 중간선거역사 · 후보 · 출처"],
  ];
  return { name: "README", rows, widths: [28, 72], freezeRows: 1 };
}

function commentsSheet(payload: MidtermPayload): SheetSpec {
  const budget = buildBudgetDelayContext();
  const tape = buildMidtermTape({
    senate: payload.senate,
    house: payload.house,
    power: payload.power,
  });
  const rows: CellInput[][] = [
    headerRow(["구역", "종류", "내용"]),
    ["헤더", "제목", "2026 미국 중간선거"],
    [
      "헤더",
      "리드",
      `상원·하원 지배권, 제네릭 발롯, 경합 상원, 의석 분포. 투표일 ${MIDTERM_ELECTION_LABEL}.`,
    ],
    ["헤더", "스케줄", payload.schedule_note || ""],
    ["한 줄 결론", "헤드라인", tape.headline],
    ["한 줄 결론", "부제", tape.sub],
    ...tape.bullets.map(
      (b, i) => ["한 줄 결론", `불릿 ${i + 1}`, b] as CellInput[],
    ),
    ["예산안이 밀리면", "헤드라인", budget.headline],
    ["예산안이 밀리면", "요약", budget.summary],
    ...budget.status_bullets.map(
      (b, i) => ["예산안이 밀리면", `현황 ${i + 1}`, b] as CellInput[],
    ),
    ["예산안이 밀리면", "각주", budget.note],
    [
      "시장 함의",
      "코멘트",
      "분열 의회면 대형 입법보다 조사·규제·관세가 변수. 숫자는 일간 가격이지 선거 베팅이 아님.",
    ],
    [
      "경합주 후보",
      "코멘트",
      "일반선거 유력 양 후보의 이력·가치·구호, 그리고 그 후보가 해당 경합주에서 이겼을 때 예상되는 증권시장 반응.",
    ],
    ["하단", "노트", payload.note || ""],
  ];
  for (const w of payload.warnings || []) {
    rows.push(["경고", "경고", w]);
  }
  return { name: "화면코멘트", rows, widths: [18, 14, 80], freezeRows: 1, autoFilter: true };
}

function budgetStatusSheet(): SheetSpec {
  const b = buildBudgetDelayContext();
  const rows: CellInput[][] = [
    headerRow(["항목", "내용"]),
    ["법안", b.bill],
    ["서명", b.signed],
    ["임시예산 시작", b.cr_start],
    ["임시예산 만료", b.cr_end],
    ["만료까지(일)", intval(b.days_to_cliff)],
    ["다음 고비", b.cliff_label],
    ["헤드라인", b.headline],
    ["요약", b.summary],
    ["노트", b.note],
    [],
    headerRow(["순번", "현황"]),
    ...b.status_bullets.map((line, i) => [intval(i + 1), line] as CellInput[]),
  ];
  return { name: "예산상황", rows, widths: [22, 80], freezeRows: 1 };
}

function budgetScenariosSheet(): SheetSpec {
  const b = buildBudgetDelayContext();
  const rows: CellInput[][] = [
    headerRow([
      "ID",
      "라벨",
      "톤",
      "가능성",
      "전개",
      "정치",
      "시장",
      "관심티커",
    ]),
    ...b.scenarios.map((s) => [
      s.id,
      s.label,
      BUDGET_SCENARIO_TONE_LABEL[s.tone],
      s.probability_ko,
      s.trigger,
      s.politics,
      s.market,
      s.watch.join(", "),
    ]),
  ];
  return {
    name: "예산시나리오",
    rows,
    widths: [18, 20, 8, 12, 36, 42, 42, 22],
    freezeRows: 1,
    autoFilter: true,
  };
}

function budgetHistorySheet(): SheetSpec {
  const b = buildBudgetDelayContext();
  const rows: CellInput[][] = [
    headerRow(["때", "일수", "S&P", "채권", "금", "한 줄"]),
    ...b.history.map((h) => [
      h.year,
      h.days > 0 ? intval(h.days) : "",
      h.spx_note,
      h.tlt_note,
      h.gold_note,
      h.lesson,
    ]),
  ];
  return { name: "예산역사", rows, widths: [14, 8, 16, 18, 12, 48], freezeRows: 1 };
}

function chambersSheet(payload: MidtermPayload): SheetSpec {
  const c = payload.composition;
  const rows: CellInput[][] = [
    headerRow([
      "원",
      "현재구성",
      "과반",
      "민주확률%",
      "공화확률%",
      "민주1주",
      "민주1개월",
      "거래량",
    ]),
    [
      "상원",
      `${c.senate_r} R · ${c.senate_d} D (탈환 ${c.senate_to_flip})`,
      "51 또는 50+VP",
      pct(payload.senate?.dem_prob),
      pct(payload.senate?.gop_prob),
      pctPoints(payload.senate?.change_1w_dem),
      pctPoints(payload.senate?.change_1m_dem),
      payload.senate?.volume ?? "",
    ],
    [
      "하원",
      `${c.house_r} R · ${c.house_d} D (공석 ${c.house_vacant})`,
      String(c.house_majority),
      pct(payload.house?.dem_prob),
      pct(payload.house?.gop_prob),
      pctPoints(payload.house?.change_1w_dem),
      pctPoints(payload.house?.change_1m_dem),
      payload.house?.volume ?? "",
    ],
  ];
  return { name: "상원하원", rows, widths: [8, 28, 14, 12, 12, 10, 10, 12], freezeRows: 1 };
}

function nationalSheet(payload: MidtermPayload): SheetSpec {
  const n = payload.national;
  const rows: CellInput[][] = [
    headerRow(["지표", "값", "비고"]),
    ["제네릭 민주(등록)", num(n.generic_ballot_d), n.source],
    ["제네릭 공화(등록)", num(n.generic_ballot_r), n.as_of],
    ["제네릭 민주(유력)", num(n.generic_ballot_lv_d), ""],
    ["제네릭 공화(유력)", num(n.generic_ballot_lv_r), ""],
    ["리드 D−R (등록)", num(n.generic_ballot_d - n.generic_ballot_r), "pp"],
    ["리드 D−R (유력)", num(n.generic_ballot_lv_d - n.generic_ballot_lv_r), "pp"],
    ["트럼프 지지", num(n.trump_approve), "%"],
    ["트럼프 반대", num(n.trump_disapprove), "%"],
    ["넷 지지", num(n.trump_approve - n.trump_disapprove), "pp"],
    ["출처 URL", n.source_url, ""],
  ];
  return { name: "전국폴", rows, widths: [22, 14, 48], freezeRows: 1 };
}

function powerSheet(payload: MidtermPayload): SheetSpec {
  const rows: CellInput[][] = [
    headerRow(["ID", "라벨", "한글", "확률%", "1개월변화"]),
    ...payload.power.map((p) => [
      p.id,
      p.label,
      p.label_ko,
      pct(p.probability),
      pctPoints(p.change_1m),
    ]),
  ];
  return { name: "권력균형", rows, widths: [16, 22, 20, 10, 12], freezeRows: 1, autoFilter: true };
}

function seatsSheet(payload: MidtermPayload): SheetSpec {
  const rows: CellInput[][] = [
    headerRow(["버킷", "하한", "상한", "확률%", "1주변화"]),
    ...payload.seat_histogram.map((b) => [
      b.label,
      intval(b.seats_low),
      intval(b.seats_high),
      pct(b.probability),
      pctPoints(b.change_1w),
    ]),
  ];
  return { name: "의석분포", rows, widths: [12, 8, 8, 10, 10], freezeRows: 1, autoFilter: true };
}

function racesSheet(payload: MidtermPayload): SheetSpec {
  const rows: CellInput[][] = [
    headerRow([
      "주",
      "한글",
      "등급",
      "현보유",
      "보궐",
      "공석",
      "민주후보",
      "공화후보",
      "민주%",
      "공화%",
      "노트",
      "쟁점",
      "민주정책",
      "공화정책",
      "시장함의",
      "관련티커",
    ]),
    ...payload.races.map((r) => [
      r.state,
      r.state_ko,
      RATING_LABEL[r.rating],
      partyKo(r.held_by),
      r.special ? "Y" : "",
      r.open ? "Y" : "",
      r.dem,
      r.gop,
      pct(r.dem_prob ?? null),
      pct(r.gop_prob ?? null),
      r.note,
      r.policy_issue,
      r.policy_d,
      r.policy_r,
      r.market_implication,
      (r.related_tickers || []).join(", "),
    ]),
  ];
  return {
    name: "상원경합",
    rows,
    widths: [6, 10, 10, 8, 6, 6, 16, 16, 8, 8, 28, 22, 36, 36, 40, 16],
    freezeRows: 1,
    autoFilter: true,
  };
}

function ratingsSheet(payload: MidtermPayload): SheetSpec {
  const rows: CellInput[][] = [
    headerRow(["주", "등급", "보궐"]),
    ...payload.map.map((m) => [m.state, RATING_LABEL[m.rating], m.special ? "Y" : ""]),
  ];
  return { name: "등급보드", rows, widths: [8, 12, 8], freezeRows: 1, autoFilter: true };
}

function etfsSheet(payload: MidtermPayload): SheetSpec {
  const rows: CellInput[][] = [
    headerRow(["심볼", "라벨", "각도", "가격", "1일%", "5일%", "오류"]),
    ...payload.etfs.map((e) => [
      e.symbol,
      e.label,
      e.angle,
      e.price != null ? num(e.price) : "",
      e.change_1d_pct != null ? num(e.change_1d_pct) : "",
      e.change_5d_pct != null ? num(e.change_5d_pct) : "",
      e.error || "",
    ]),
  ];
  return { name: "ETF", rows, widths: [10, 14, 28, 10, 10, 10, 24], freezeRows: 1, autoFilter: true };
}

function headlinesSheet(payload: MidtermPayload): SheetSpec {
  const rows: CellInput[][] = [
    headerRow(["제목", "출처", "게시", "링크"]),
    ...payload.headlines.map((h) => [h.title, h.source, h.published || "", h.link || ""]),
  ];
  return { name: "헤드라인", rows, widths: [56, 16, 22, 40], freezeRows: 1, autoFilter: true };
}

function midtermHistorySheet(payload: MidtermPayload): SheetSpec {
  const rows: CellInput[][] = [
    headerRow(["연도", "대통령정당", "하원순증감", "상원순증감", "노트"]),
    ...payload.history.map((h) => [
      intval(h.year),
      partyKo(h.president_party),
      intval(h.house_net),
      intval(h.senate_net),
      h.note,
    ]),
  ];
  return { name: "중간선거역사", rows, widths: [8, 12, 12, 12, 28], freezeRows: 1 };
}

function candidatesSheet(payload: MidtermPayload): SheetSpec {
  const rows: CellInput[][] = [
    headerRow([
      "주",
      "정당",
      "이름",
      "역할",
      "이력",
      "가치",
      "구호",
      "이기면시장",
      "위키",
    ]),
  ];
  for (const r of payload.races) {
    for (const profile of [r.dem_profile, r.gop_profile]) {
      if (!profile) continue;
      rows.push([
        `${r.state_ko} ${r.state}`,
        partyKo(profile.party),
        profile.name,
        profile.role,
        profile.bio,
        profile.values,
        profile.slogan,
        profile.market_if_wins,
        profile.wiki,
      ]);
    }
  }
  return {
    name: "후보",
    rows,
    widths: [14, 8, 18, 22, 48, 36, 28, 40, 20],
    freezeRows: 1,
    autoFilter: true,
  };
}

function sourcesSheet(payload: MidtermPayload): SheetSpec {
  const budget = buildBudgetDelayContext();
  const rows: CellInput[][] = [
    headerRow(["구분", "이름", "역할/URL"]),
    ...payload.sources.map((s) => ["중간선거", s.name, `${s.role} · ${s.url}`]),
    ...budget.sources.map((s) => ["예산", s.name, s.url]),
  ];
  return { name: "출처", rows, widths: [12, 28, 64], freezeRows: 1 };
}

export function usMidtermExcelFilename(generatedAt?: string): string {
  const stamp = (generatedAt || new Date().toISOString()).slice(0, 10);
  return `savvyetf-us-midterm-${stamp}.xlsx`;
}

export function buildUsMidtermExcel(payload: MidtermPayload): Buffer {
  const sheets: SheetSpec[] = [
    readmeSheet(payload),
    commentsSheet(payload),
    budgetStatusSheet(),
    budgetScenariosSheet(),
    budgetHistorySheet(),
    chambersSheet(payload),
    nationalSheet(payload),
    powerSheet(payload),
    seatsSheet(payload),
    racesSheet(payload),
    ratingsSheet(payload),
    etfsSheet(payload),
    headlinesSheet(payload),
    midtermHistorySheet(payload),
    candidatesSheet(payload),
    sourcesSheet(payload),
  ];
  return buildXlsx(sheets, {
    title: "SavvyETF 2026 US Midterm · Politics",
    creator: "SavvyETF",
  });
}
