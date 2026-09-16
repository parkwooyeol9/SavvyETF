"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildMidtermTape,
  goMidtermStudy,
  navShellTab,
  type MidtermTape,
} from "@/lib/midtermTape";
import type { PoliThemesPayload } from "@/lib/poliThemes";
import { POLI_RANGES } from "@/lib/poliThemes";
import type { MidtermPayload } from "@/lib/usMidterm";
import { fmtPctPoints } from "@/lib/usMidterm";

function rangeLabelOf(range?: string | null): string {
  return POLI_RANGES.find((r) => r.id === range)?.label || "3개월";
}

export default function MidtermTapeCard({
  midterm,
  poli,
  hidePoliLink = false,
  waitForMidterm = false,
  waitForPoli = false,
}: {
  midterm?: MidtermPayload | null;
  poli?: PoliThemesPayload | null;
  hidePoliLink?: boolean;
  waitForMidterm?: boolean;
  waitForPoli?: boolean;
}) {
  const [fetchedMidterm, setFetchedMidterm] = useState<MidtermPayload | null>(null);
  const [fetchedPoli, setFetchedPoli] = useState<PoliThemesPayload | null>(null);

  useEffect(() => {
    if (midterm || waitForMidterm) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/us-midterm");
        const json = (await res.json()) as MidtermPayload;
        if (!cancelled && json?.ok !== false) setFetchedMidterm(json);
      } catch {
        /* tape still renders from poli / defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [midterm, waitForMidterm]);

  useEffect(() => {
    if (poli || waitForPoli) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/poli-themes?range=3mo");
        const json = (await res.json()) as PoliThemesPayload;
        if (!cancelled && json?.ok !== false) setFetchedPoli(json);
      } catch {
        /* tape still renders from midterm */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poli, waitForPoli]);

  const liveMid = midterm || fetchedMidterm;
  const livePoli = poli || fetchedPoli;

  const tape: MidtermTape | null = useMemo(() => {
    if (!liveMid && !livePoli) return null;
    return buildMidtermTape({
      senate: liveMid?.senate,
      house: liveMid?.house,
      power: liveMid?.power,
      nanc_kruz_spread: livePoli?.nanc_kruz_spread ?? null,
      demz_maga_spread: livePoli?.demz_maga_spread ?? null,
      rangeLabel: rangeLabelOf(livePoli?.range),
    });
  }, [liveMid, livePoli]);

  if (!tape) {
    return (
      <article className="midterm-tape" aria-busy="true">
        <p className="empty">중간선거 한 줄 결론 불러오는 중…</p>
      </article>
    );
  }

  return (
    <article className="midterm-tape" data-diverge={tape.diverge ? "1" : "0"}>
      <div className="midterm-tape-kicker">오늘 읽기 · 2026 중간선거</div>
      <h3>{tape.headline}</h3>
      <p>{tape.sub}</p>
      <ul className="midterm-tape-bullets">
        {tape.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <div className="midterm-tape-metrics">
        <div>
          <span>상원</span>
          <strong data-party={tape.senateLean === "toss" ? undefined : tape.senateLean.toLowerCase()}>
            {tape.senateLean === "D"
              ? `민주 ${fmtPctPoints(liveMid?.senate?.dem_prob, 0)}`
              : tape.senateLean === "R"
                ? `공화 ${fmtPctPoints(liveMid?.senate?.gop_prob, 0)}`
                : "경합"}
          </strong>
        </div>
        <div>
          <span>하원</span>
          <strong data-party={tape.houseLean === "toss" ? undefined : tape.houseLean.toLowerCase()}>
            {tape.houseLean === "D"
              ? `민주 ${fmtPctPoints(liveMid?.house?.dem_prob, 0)}`
              : tape.houseLean === "R"
                ? `공화 ${fmtPctPoints(liveMid?.house?.gop_prob, 0)}`
                : "경합"}
          </strong>
        </div>
        <div>
          <span>스터디</span>
          <strong>{tape.scenarioLabel}</strong>
        </div>
      </div>
      <div className="midterm-tape-actions">
        <button
          type="button"
          className="chip active"
          onClick={() => goMidtermStudy(tape.scenario, tape.grouping)}
        >
          스터디에서 이 시나리오
        </button>
        {hidePoliLink ? null : (
          <button type="button" className="chip" onClick={() => navShellTab("polithemes")}>
            정당 ETF 편입비
          </button>
        )}
      </div>
    </article>
  );
}
