"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { DailyRoundPayload, DailyRoundQuestion } from "@/lib/dailyRound";
import type { ShellTabId } from "@/lib/types";

type Step = number; // 0..questions.length (last = summary)

function goTab(tab: ShellTabId) {
  window.dispatchEvent(
    new CustomEvent("savvyetf-nav-tab", { detail: tab }),
  );
}

function storageKey(date: string) {
  return `savvy_round_${date}`;
}

type Stored = {
  picks: Record<string, string>;
  firstScore: number | null;
};

function loadStored(date: string): Stored {
  try {
    const raw = localStorage.getItem(storageKey(date));
    if (!raw) return { picks: {}, firstScore: null };
    const parsed = JSON.parse(raw) as Stored;
    return {
      picks: parsed.picks || {},
      firstScore:
        typeof parsed.firstScore === "number" ? parsed.firstScore : null,
    };
  } catch {
    return { picks: {}, firstScore: null };
  }
}

function saveStored(date: string, data: Stored) {
  try {
    localStorage.setItem(storageKey(date), JSON.stringify(data));
  } catch {
    // ignore quota
  }
}

export default function DailyRoundTab() {
  const [data, setData] = useState<DailyRoundPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>(0);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState(false);
  const [firstScore, setFirstScore] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/daily-round");
        const json = (await res.json()) as DailyRoundPayload;
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        if (cancelled) return;
        setData(json);
        const stored = loadStored(json.date);
        setPicks(stored.picks);
        setFirstScore(stored.firstScore);
        setError(null);
      } catch (exc) {
        if (!cancelled) {
          setError(exc instanceof Error ? exc.message : "로드 실패");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const questions = data?.questions || [];
  const q: DailyRoundQuestion | undefined = questions[step];
  const total = questions.length;
  const pick = q ? picks[q.id] : undefined;

  useEffect(() => {
    setRevealed(Boolean(q && picks[q.id]));
  }, [q, picks]);

  const score = useMemo(() => {
    if (!questions.length) return 0;
    return questions.filter((item) => picks[item.id] === item.answerId).length;
  }, [questions, picks]);

  const commitPick = useCallback(
    (question: DailyRoundQuestion, choiceId: string) => {
      if (!data || picks[question.id]) return;
      const nextPicks = { ...picks, [question.id]: choiceId };
      setPicks(nextPicks);
      setRevealed(true);
      const answered = questions.filter((item) => nextPicks[item.id]).length;
      let nextFirst = firstScore;
      if (firstScore == null && answered === questions.length) {
        nextFirst = questions.filter(
          (item) => nextPicks[item.id] === item.answerId,
        ).length;
        setFirstScore(nextFirst);
      }
      saveStored(data.date, { picks: nextPicks, firstScore: nextFirst });
    },
    [data, picks, questions, firstScore],
  );

  function next() {
    setRevealed(false);
    setStep((s) => Math.min(s + 1, total));
  }

  if (loading) {
    return (
      <div className="edu-tab round-tab">
        <section className="feature-block">
          <p className="empty">오늘의 라운드 준비 중…</p>
        </section>
      </div>
    );
  }

  if (error || !data?.ok) {
    return (
      <div className="edu-tab round-tab">
        <section className="feature-block">
          <p className="empty warn">{error || "라운드를 불러오지 못했습니다."}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="edu-tab round-tab">
      <section className="feature-block">
        <div className="feature-head">
          <h2 className="feature-title">오늘의 라운드</h2>
          <p className="feature-lead">
            {data.date} · 히트맵·시황·사건·세금을 4문제로 잇습니다. 점수는 첫
            시도만 남기고, 해설은 해당 탭으로 이어집니다.
          </p>
        </div>
        <ol className="round-progress" aria-label="진행">
          {questions.map((item, i) => {
            const done = Boolean(picks[item.id]);
            const active = i === step;
            return (
              <li
                key={item.id}
                className={`round-dot ${active ? "active" : ""} ${done ? "done" : ""}`}
              >
                {i + 1}
              </li>
            );
          })}
          <li className={`round-dot ${step >= total ? "active" : ""}`}>끝</li>
        </ol>
      </section>

      {q ? (
        <section className="feature-block">
          <p className="round-kicker">{q.kicker}</p>
          <h3 className="round-prompt">{q.prompt}</h3>
          {q.detail ? <p className="round-detail">{q.detail}</p> : null}
          <div className="round-choices">
            {q.choices.map((c) => {
              const selected = pick === c.id;
              const correct = revealed && c.id === q.answerId;
              const wrong = revealed && selected && c.id !== q.answerId;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`round-choice ${selected ? "selected" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}
                  disabled={Boolean(pick)}
                  onClick={() => commitPick(q, c.id)}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          {revealed || pick ? (
            <div className="round-explain">
              <p>
                {pick === q.answerId ? "맞았습니다. " : "아닙니다. "}
                {q.explain}
              </p>
              <div className="round-actions">
                <button
                  type="button"
                  className="chip"
                  onClick={() => goTab(q.moreTab)}
                >
                  {q.moreLabel} →
                </button>
                <button type="button" className="chip active" onClick={next}>
                  {step + 1 < total ? "다음" : "오늘 정리"}
                </button>
              </div>
            </div>
          ) : (
            <p className="meta-soft">보기 하나를 고르면 해설이 열립니다.</p>
          )}
        </section>
      ) : (
        <section className="feature-block">
          <h3 className="round-prompt">오늘 배운 것</h3>
          <p className="feature-lead">
            {firstScore != null
              ? `첫 시도 ${firstScore}/${total}. `
              : null}
            다시 풀어도 첫 점수는 바뀌지 않습니다.
          </p>
          <ul className="edu-list">
            {questions.map((item) => {
              const ok = picks[item.id] === item.answerId;
              return (
                <li key={item.id}>
                  {ok ? "맞힘" : "다시 보기"} · {item.kicker.replace(/^\d+\.\s*/, "")}{" "}
                  — {item.explain}
                </li>
              );
            })}
          </ul>
          <div className="round-actions">
            <button type="button" className="chip" onClick={() => goTab("main")}>
              메인 히트맵
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => goTab("eventstudy")}
            >
              이벤트 스터디
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => goTab("education")}
            >
              환율·세금
            </button>
            <button
              type="button"
              className="chip active"
              onClick={() => {
                setStep(0);
                setRevealed(Boolean(picks[questions[0]?.id || ""]));
              }}
            >
              처음부터 다시
            </button>
          </div>
          <p className="edu-disclaimer">
            교육용입니다. 투자 권유·세무 자문이 아닙니다. 현재 세션 {score}/{total}.
          </p>
        </section>
      )}
    </div>
  );
}
