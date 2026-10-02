"use client";

import { useMemo, useState } from "react";

import { ddayFrom, fmt, fmtCap, isNum, type AcwiEventRow, type AcwiStock, type AcwiSummary } from "@/lib/acwiAnalyzer";

import AcwiChart from "./AcwiChart";
import AcwiTable, { type Col } from "./AcwiTable";
import { Card, Legend, nameCol, Sg } from "./parts";

const CS = ["car_pre", "car_ann", "car_run", "car_close", "car_post"] as const;
const CL = ["발표 전", "발표", "진행", "당일", "효력 후"];

type Rec = Record<string, unknown>;
const val = (r: unknown, k: string) => (r as Rec)[k];
const actionKo = (a: unknown) => (a === "ADD" ? "편입" : "편출");
const path = (p: Record<string, (number | null)[] | number>, k: string) => (Array.isArray(p[k]) ? (p[k] as (number | null)[]) : []);
const count = (p: Record<string, (number | null)[] | number>, k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);

type PendRow = AcwiStock & { review: string; effective?: string; name?: string; country?: string };
type EvRow = AcwiEventRow & { c: string; n?: string; ct?: string };

export default function AcwiMsci({ A, onPick }: { A: AcwiSummary; onPick: (code: string) => void }) {
  const E = A.events;
  const M = A.meta;
  const V = M.watch_validation ?? {};
  const nr = (M.next_reviews ?? []).find((r) => r.announce >= M.as_of);
  const x = useMemo(() => Array.from({ length: E.pre + E.post + 1 }, (_, i) => i - E.pre), [E.pre, E.post]);
  const [pend, setPend] = useState<"del" | "add">("del");
  const [ev, setEv] = useState<"" | "ADD" | "DEL">("");

  const byCode = useMemo(() => new Map(A.stocks.map((s) => [s.c, s])), [A.stocks]);
  const pendDel: PendRow[] = useMemo(
    () =>
      A.pending
        .filter((p) => p.action.startsWith("편출"))
        .map((r) => {
          const s = byCode.get(String(r.code ?? ""));
          return { ...(s ?? {}), ...(r as Rec), n: s?.n || String(r.name ?? ""), c: String(r.code ?? "") } as PendRow;
        }),
    [A.pending, byCode],
  );
  const pendAdd = useMemo(() => A.pending.filter((p) => p.action.startsWith("편입")) as unknown as PendRow[], [A.pending]);
  const watch = useMemo(() => A.stocks.filter((s) => isNum(s.wr)).sort((a, b) => (a.wr as number) - (b.wr as number)), [A.stocks]);
  const perRows: EvRow[] = useMemo(() => E.per.map((r) => ({ ...r, c: r.code, n: r.name, ct: r.country })), [E.per]);
  const perShown = useMemo(() => perRows.filter((r) => !ev || r.action === ev), [perRows, ev]);

  const cols = useMemo(() => {
    const carCols = <R,>(suffix = ""): Col<R>[] =>
      CS.map((k, i) => ({ k: k + suffix, h: CL[i], n: true, f: (r: R) => <Sg v={val(r, k + suffix)} d={2} /> }));
    const byReview: Col<Rec>[] = [
      { k: "review", h: "리뷰", f: (r) => String(r.review) },
      { k: "action", h: "구분", f: (r) => actionKo(r.action) },
      { k: "car_pre_count", h: "건수", n: true, f: (r) => String(r.car_pre_count ?? "") },
      ...carCols<Rec>("_mean"),
    ];
    const byRegion: Col<Rec>[] = [
      { k: "action", h: "구분", f: (r) => actionKo(r.action) },
      { k: "region", h: "지역", f: (r) => String(r.region ?? "") },
      ...carCols<Rec>(),
    ];
    const watchCols: Col<AcwiStock>[] = [
      { k: "wr", h: "순위", n: true, f: (s) => s.wr },
      nameCol<AcwiStock>(),
      { k: "tail", h: "국가 내 꼬리", n: true, f: (s) => fmt(s.tail, 2) },
      { k: "w", h: "비중", n: true, f: (s) => fmt((s.w ?? 0) * 100, 4, "%") },
      { k: "r6m", h: "6M", n: true, f: (s) => <Sg v={s.r6m} /> },
      { k: "cap", h: "시총", n: true, f: (s) => fmtCap(s.cap) },
    ];
    const delCols: Col<PendRow>[] = [
      { k: "review", h: "리뷰", f: (r) => r.review },
      nameCol<PendRow>(),
      { k: "effective", h: "효력", f: (r) => r.effective ?? "" },
      { k: "r3m", h: "3M", n: true, f: (r) => <Sg v={r.r3m} /> },
      { k: "rk", h: "팩터순위", n: true, f: (r) => r.rk ?? "–" },
    ];
    const addCols: Col<PendRow>[] = [
      { k: "review", h: "리뷰", f: (r) => r.review },
      { k: "name", h: "MSCI 표기", f: (r) => r.name ?? "" },
      { k: "country", h: "국가", f: (r) => r.country ?? "" },
      { k: "effective", h: "효력", f: (r) => r.effective ?? "" },
    ];
    const perCols: Col<EvRow>[] = [
      { k: "review", h: "리뷰", f: (r) => r.review },
      { k: "action", h: "구분", f: (r) => actionKo(r.action) },
      nameCol<EvRow>(),
      { k: "sector_ko", h: "섹터", f: (r) => r.sector_ko ?? "" },
      ...carCols<EvRow>(),
    ];
    return { byReview, byRegion, watchCols, delCols, addCols, perCols };
  }, []);

  const sumRow = (lab: string, o: Record<string, number | null>) => (
    <tr>
      <td>{lab}</td>
      {CS.map((k) => (
        <td key={k} className="n">
          <Sg v={o[`${k}_mean`]} d={2} />
          <br />
          <span className="meta-soft">{fmt(o[`${k}_median`], 2)}</span>
        </td>
      ))}
    </tr>
  );
  const tick = (v: string | number) => `t${Number(v) > 0 ? "+" : ""}${v}`;

  return (
    <div className="aa-view">
      <div className="aa-grid aa-g3">
        <section className="aa-card">
          <div className="aa-eyebrow">다음 정기 리뷰</div>
          <div className="aa-big">{nr ? nr.review : "–"}</div>
          {nr ? (
            <p>
              발표 <b className="aa-mono">{nr.announce}</b> (D-{ddayFrom(M.as_of, nr.announce)}) · 효력 <b className="aa-mono">{nr.effective}</b>
            </p>
          ) : null}
          <p className="meta-soft aa-mt">반영은 효력일 전 영업일 종가. 발표는 장 마감 후(한국시간 다음날 새벽).</p>
        </section>
        <section className="aa-card">
          <div className="aa-eyebrow">이 파일의 구성 시점</div>
          <div className="aa-big">{M.anchor_review} 반영 직후</div>
          <p>
            이후 {M.latest_review}까지 편출 <b>{pendDel.length}</b>개가 파일에 남아 있고, 편입 <b>{pendAdd.length}</b>개가 없습니다.
          </p>
          <p className="meta-soft aa-mt">스크리너의 &lsquo;MSCI 상태 = 현재 구성&rsquo;은 편출 종목을 뺀 목록입니다.</p>
        </section>
        <section className="aa-card">
          <div className="aa-eyebrow">편출 관찰 리스트 검증</div>
          <div className="aa-big">AUC {fmt(V.auc_score, 2)}</div>
          <p>
            2026-05·08 실제 편출 {V.n_deleted}개 중 관찰 상위 100에 {V.hit_top100}개, 상위 200에 {V.hit_top200}개.
          </p>
          <p className="meta-soft aa-mt">
            점수 = 국가 내 누적비중 위치(회사 단위). 6M 수익률을 섞으면 AUC {fmt(V.auc_mix_70_30, 3)}로 오히려 낮아 제외. 같은 편출 사례로 고르고
            검증한 표본 내 결과입니다.
          </p>
        </section>
      </div>

      <div className="aa-grid aa-g2">
        <Card
          title="발표일 기준 평균 누적초과수익"
          sub={`t=0 = 발표 다음 거래일 · 편입 ${count(E.path_ann, "n_ADD")}건 / 편출 ${count(E.path_ann, "n_DEL")}건 · 시장조정(벤치마크 차감)`}
        >
          <AcwiChart
            x={x}
            series={[
              { y: path(E.path_ann, "ADD"), color: "var(--aa-pos)", name: "편입" },
              { y: path(E.path_ann, "DEL"), color: "var(--aa-neg)", name: "편출" },
            ]}
            yfmt={(v) => fmt(v, 1, "%")}
            xfmt={tick}
            zeroLine
            refs={[{ x: E.pre, label: "발표" }]}
          />
          <Legend
            items={[
              ["var(--aa-pos)", "편입"],
              ["var(--aa-neg)", "편출"],
            ]}
          />
        </Card>
        <Card title="효력일 기준 평균 누적초과수익" sub="t=0 = 효력일(리밸런싱 다음 영업일), t=−1 = 리밸런싱 종가일">
          <AcwiChart
            x={x}
            series={[
              { y: path(E.path_eff, "ADD"), color: "var(--aa-pos)", name: "편입" },
              { y: path(E.path_eff, "DEL"), color: "var(--aa-neg)", name: "편출" },
            ]}
            yfmt={(v) => fmt(v, 1, "%")}
            xfmt={tick}
            zeroLine
            refs={[{ x: E.pre, label: "효력" }]}
          />
          <Legend
            items={[
              ["var(--aa-pos)", "편입"],
              ["var(--aa-neg)", "편출"],
            ]}
          />
        </Card>
      </div>

      <div className="aa-grid aa-g2">
        <Card
          title="구간별 초과수익"
          sub="평균(위) / 중앙값(아래), %. 발표 전 = t−20~−1, 발표 = t0~t1, 진행 = t2~리밸런싱 전일, 당일 = 리밸런싱 종가일, 효력 후 = 20거래일"
        >
          <div className="aa-scroll">
            <table className="aa-tbl">
              <thead>
                <tr>
                  <th />
                  {CL.map((l) => (
                    <th key={l} className="n">
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {E.all.ADD ? sumRow("편입", E.all.ADD) : null}
                {E.all.DEL ? sumRow("편출", E.all.DEL) : null}
              </tbody>
            </table>
          </div>
          <h4 className="aa-h4">리뷰별 (평균, 건수)</h4>
          <div className="aa-scroll aa-short">
            <AcwiTable className="aa-tbl" cols={cols.byReview} rows={E.by_review as Rec[]} limit={50} rowKey={(r) => `${r.review}-${r.action}`} />
          </div>
          <p className="aa-note">
            편입 이벤트는 이후에도 남아 이 파일에 있는 종목만 포함(생존 편향), 편출은 2026-05·08분만 확인 가능. 현지통화 수익률 기준 근사.
          </p>
        </Card>
        <Card title="지역별 평균 (%)" sub="편입·편출 × 지역">
          <div className="aa-scroll aa-short">
            <AcwiTable className="aa-tbl" cols={cols.byRegion} rows={E.by_region as Rec[]} rowKey={(r) => `${r.action}-${r.region}`} />
          </div>
        </Card>
      </div>

      <div className="aa-grid aa-g2">
        <Card
          title={
            <>
              편출 관찰 리스트 <span className="meta-soft">다음 리뷰 후보 (이미 편출된 종목 제외)</span>
            </>
          }
        >
          <div className="aa-scroll aa-short">
            <AcwiTable className="aa-tbl" cols={cols.watchCols} rows={watch} sort="wr" dir="asc" limit={100} rowKey={(s) => s.c} onRow={(s) => onPick(s.c)} />
          </div>
        </Card>
        <Card
          title={
            <>
              미반영 변경 <span className="meta-soft">{M.anchor_review} 이후</span>
            </>
          }
        >
          <div className="aa-seg">
            <button type="button" className={`chip${pend === "del" ? " active" : ""}`} aria-pressed={pend === "del"} onClick={() => setPend("del")}>
              편출 (파일에 남음)
            </button>
            <button type="button" className={`chip${pend === "add" ? " active" : ""}`} aria-pressed={pend === "add"} onClick={() => setPend("add")}>
              편입 (파일에 없음)
            </button>
          </div>
          <div className="aa-scroll aa-short">
            {pend === "del" ? (
              <AcwiTable
                className="aa-tbl"
                cols={cols.delCols}
                rows={pendDel}
                sort="review"
                limit={200}
                rowKey={(r, i) => `${r.c}-${i}`}
                onRow={(r) => byCode.has(r.c) && onPick(r.c)}
              />
            ) : (
              <AcwiTable className="aa-tbl" cols={cols.addCols} rows={pendAdd} sort="review" limit={200} rowKey={(r, i) => `${r.name}-${i}`} />
            )}
          </div>
        </Card>
      </div>

      <Card
        title="이벤트별 상세"
        sub={
          <span className="aa-seg">
            {(
              [
                ["", "전체"],
                ["ADD", "편입"],
                ["DEL", "편출"],
              ] as const
            ).map(([a, l]) => (
              <button key={l} type="button" className={`chip${ev === a ? " active" : ""}`} aria-pressed={ev === a} onClick={() => setEv(a)}>
                {l}
              </button>
            ))}
          </span>
        }
      >
        <div className="aa-scroll">
          <AcwiTable
            className="aa-tbl"
            cols={cols.perCols}
            rows={perShown}
            sort="car_ann"
            limit={150}
            rowKey={(r, i) => `${r.code}-${r.review}-${r.action}-${i}`}
            onRow={(r) => byCode.has(r.c) && onPick(r.c)}
          />
        </div>
      </Card>

      <Card title="재구성 구성종목 수" sub="리뷰 직후 · 상한(편입 후 끝 미상 포함) / 확정">
        <AcwiChart
          x={A.reviews.map((r) => r.review)}
          series={[
            { y: A.reviews.map((r) => (isNum(r.members_after) ? r.members_after : null)), color: "var(--accent)", name: "상한" },
            { y: A.reviews.map((r) => (isNum(r.confirmed_after) ? r.confirmed_after : null)), color: "var(--muted)", name: "확정", dash: "4 3" },
          ]}
          h={200}
          yfmt={(v) => fmt(v, 0)}
        />
        <Legend
          items={[
            ["var(--accent)", "상한"],
            ["var(--muted)", "확정", true],
          ]}
        />
      </Card>
    </div>
  );
}
