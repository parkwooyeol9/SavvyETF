"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import {
  HORIZON,
  ROUNDS,
  fmtPct,
  resultTitle,
  scoreRound,
  shareText,
  sumPnl,
  type ChartTradePayload,
  type ChartTradeRound,
  type Side,
  type TradePick,
} from "@/lib/chartTrade";

type ChartRow = {
  date: string;
  seen: number | null;
  next: number | null;
};

function buildChartRows(round: ChartTradeRound, revealed: boolean): ChartRow[] {
  const seenRows: ChartRow[] = round.seen.map((p) => ({
    date: p.date,
    seen: p.idx,
    next: null,
  }));
  if (!revealed) return seenRows;
  const lastSeen = round.seen[round.seen.length - 1]?.idx ?? null;
  const future: ChartRow[] = round.next.slice(1).map((p) => ({
    date: p.date,
    seen: null,
    next: p.idx,
  }));
  if (seenRows.length) {
    seenRows[seenRows.length - 1] = {
      ...seenRows[seenRows.length - 1]!,
      next: lastSeen,
    };
  }
  return [...seenRows, ...future];
}

async function canvasPng(picks: TradePick[], date: string): Promise<Blob> {
  const W = 720;
  const H = 960;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.scale(2, 2);

  ctx.fillStyle = "#0b1018";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#141d2b";
  ctx.fillRect(28, 28, W - 56, H - 56);
  ctx.strokeStyle = "#2b3648";
  ctx.lineWidth = 1;
  ctx.strokeRect(28.5, 28.5, W - 57, H - 57);

  const total = sumPnl(picks);
  const up = total >= 0;
  ctx.fillStyle = "#8fa3b8";
  ctx.font = "600 13px 'DM Sans', system-ui, sans-serif";
  ctx.fillText("SAVVYETF  모의투자", 56, 72);
  ctx.fillText(date, W - 56 - ctx.measureText(date).width, 72);

  ctx.fillStyle = up ? "#3dd68c" : "#f87171";
  ctx.font = "400 72px 'Instrument Serif', Georgia, serif";
  const headline = fmtPct(total);
  ctx.fillText(headline, 56, 168);
  ctx.fillStyle = "#e8eef5";
  ctx.font = "400 26px 'Instrument Serif', Georgia, serif";
  ctx.fillText(resultTitle(total), 56, 208);

  ctx.font = "500 13px 'DM Sans', system-ui, sans-serif";
  ctx.fillStyle = "#8fa3b8";
  ctx.fillText(`이름 없는 차트  ${ROUNDS}판  ·  다음 ${HORIZON}거래일`, 56, 242);

  picks.forEach((p, i) => {
    const y = 292 + i * 92;
    ctx.fillStyle = "#1a2538";
    roundRect(ctx, 56, y, W - 112, 80, 10);
    ctx.fill();
    const win = p.pnl_pct >= 0;
    ctx.fillStyle = p.side === "buy" ? "#3dd68c" : "#f87171";
    roundRect(ctx, 72, y + 24, 64, 32, 8);
    ctx.fill();
    ctx.fillStyle = "#0b1018";
    ctx.font = "700 13px 'DM Sans', system-ui, sans-serif";
    ctx.fillText(p.side === "buy" ? "매수" : "매도", 84, y + 45);
    ctx.fillStyle = "#e8eef5";
    ctx.font = "700 22px 'DM Sans', system-ui, sans-serif";
    ctx.fillText(p.ticker, 152, y + 40);
    ctx.fillStyle = "#8fa3b8";
    ctx.font = "400 13px 'DM Sans', system-ui, sans-serif";
    ctx.fillText(p.name, 152, y + 62);
    ctx.fillStyle = win ? "#3dd68c" : "#f87171";
    ctx.font = "700 24px 'DM Sans', system-ui, sans-serif";
    const pnl = fmtPct(p.pnl_pct);
    ctx.fillText(pnl, W - 72 - ctx.measureText(pnl).width, y + 50);
  });

  ctx.fillStyle = "#8fa3b8";
  ctx.font = "500 13px 'DM Sans', system-ui, sans-serif";
  ctx.fillText("savvyetf.com", 56, H - 56);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob"))),
      "image/png",
    );
  });
  return blob;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function shareRun(date: string, picks: TradePick[]) {
  const text = shareText(date, picks);
  const blob = await canvasPng(picks, date);
  const file = new File([blob], `savvyetf-${date}.png`, { type: "image/png" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: "SavvyETF 모의투자",
        text,
        files: [file],
      });
      return "shared";
    }
  } catch (exc) {
    if (exc instanceof Error && exc.name === "AbortError") return "aborted";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}

export default function ChartTradeTab() {
  const [data, setData] = useState<ChartTradePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [picks, setPicks] = useState<TradePick[]>([]);
  const [shareNote, setShareNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/chart-trade");
        const json = (await res.json()) as ChartTradePayload;
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        if (!cancelled) {
          setData(json);
          setError(null);
        }
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

  const round = data?.rounds[step];
  const done = Boolean(data && picks.length >= ROUNDS && step >= ROUNDS);
  const chartRows = useMemo(
    () => (round ? buildChartRows(round, revealed) : []),
    [round, revealed],
  );

  const commit = useCallback(
    (side: Side) => {
      if (!round || revealed) return;
      const pick = scoreRound(round, side);
      setPicks((prev) => [...prev, pick]);
      setRevealed(true);
    },
    [round, revealed],
  );

  function next() {
    setRevealed(false);
    setStep((s) => s + 1);
  }

  function replay() {
    setPicks([]);
    setStep(0);
    setRevealed(false);
    setShareNote(null);
  }

  async function onShare() {
    if (!data) return;
    try {
      const how = await shareRun(data.date, picks);
      if (how === "shared") setShareNote("공유 창을 열었습니다.");
      else if (how === "downloaded") setShareNote("결과 이미지를 저장했습니다.");
    } catch {
      setShareNote("공유에 실패했습니다. 한 줄 복사를 써 보세요.");
    }
  }

  async function onCopy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(shareText(data.date, picks));
      setShareNote("결과 문구를 복사했습니다.");
    } catch {
      setShareNote("복사에 실패했습니다.");
    }
  }

  if (loading) {
    return (
      <div className="edu-tab charttrade-tab">
        <section className="feature-block">
          <p className="empty">오늘 차트 다섯 장을 섞는 중…</p>
        </section>
      </div>
    );
  }

  if (error || !data?.ok) {
    return (
      <div className="edu-tab charttrade-tab">
        <section className="feature-block">
          <p className="empty warn">{error || "모의투자를 불러오지 못했습니다."}</p>
        </section>
      </div>
    );
  }

  if (done) {
    const total = sumPnl(picks);
    const up = total >= 0;
    return (
      <div className="edu-tab charttrade-tab">
        <section className="feature-block charttrade-sheet">
          <p className="charttrade-kicker">SavvyETF 모의투자 · {data.date}</p>
          <p className={`charttrade-total ${up ? "up" : "down"}`}>{fmtPct(total)}</p>
          <h2 className="charttrade-title">{resultTitle(total)}</h2>
          <p className="feature-lead">
            이름 없는 차트 {ROUNDS}판 · 다음 {HORIZON}거래일 · 합산 수익률
          </p>
          <ol className="charttrade-legs">
            {picks.map((p) => (
              <li key={p.roundId}>
                <span className={`charttrade-side ${p.side}`}>
                  {p.side === "buy" ? "매수" : "매도"}
                </span>
                <span className="charttrade-leg-name">
                  <strong>{p.ticker}</strong>
                  <em>{p.name}</em>
                </span>
                <span className={`charttrade-pnl ${p.pnl_pct >= 0 ? "up" : "down"}`}>
                  {fmtPct(p.pnl_pct)}
                </span>
                <span className="charttrade-tape">
                  실제 {fmtPct(p.fwd_pct)}
                </span>
              </li>
            ))}
          </ol>
          <div className="charttrade-share-row">
            <button type="button" className="chip active" onClick={() => void onShare()}>
              결과지 공유
            </button>
            <button type="button" className="chip" onClick={() => void onCopy()}>
              한 줄 복사
            </button>
            <button type="button" className="chip" onClick={replay}>
              같은 차트 다시
            </button>
          </div>
          {shareNote ? <p className="meta-soft">{shareNote}</p> : null}
        </section>
      </div>
    );
  }

  if (!round) return null;
  const lastPick = picks[picks.length - 1];

  return (
    <div className="edu-tab charttrade-tab">
      <section className="feature-block">
        <div className="feature-head charttrade-head">
          <div>
            <h2 className="feature-title">모의투자</h2>
            <p className="feature-lead">
              {data.date} · 이름 없는 차트입니다. 앞으로 {HORIZON}거래일을 사고
              팔지 고르세요. {step + 1}/{ROUNDS}
            </p>
          </div>
          <ol className="charttrade-dots" aria-label="진행">
            {data.rounds.map((r, i) => (
              <li
                key={r.id}
                className={`${i === step ? "on" : ""} ${i < picks.length ? "done" : ""}`}
              >
                {i + 1}
              </li>
            ))}
          </ol>
        </div>

        <div className="charttrade-stage">
          <div className="chart-wrap charttrade-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartRows}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                <XAxis dataKey="date" hide />
                <YAxis hide domain={["auto", "auto"]} />
                {revealed ? (
                  <ReferenceLine
                    x={round.seen[round.seen.length - 1]?.date}
                    stroke="#4da3ff"
                    strokeDasharray="4 4"
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="seen"
                  name="차트"
                  stroke="#e8eef5"
                  strokeWidth={2.2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="next"
                  name="이후"
                  stroke={
                    lastPick && lastPick.roundId === round.id
                      ? lastPick.pnl_pct >= 0
                        ? "#3dd68c"
                        : "#f87171"
                      : "#3dd68c"
                  }
                  strokeWidth={2.4}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {revealed && lastPick && lastPick.roundId === round.id ? (
          <div className="charttrade-reveal">
            <p>
              <strong>{round.ticker}</strong> {round.name} · 실제{" "}
              {fmtPct(round.fwd_pct)} · 당신{" "}
              <span className={lastPick.pnl_pct >= 0 ? "up" : "down"}>
                {fmtPct(lastPick.pnl_pct)}
              </span>
            </p>
            <button type="button" className="chip active" onClick={next}>
              {step + 1 < ROUNDS ? "다음 차트" : "결과지 보기"}
            </button>
          </div>
        ) : (
          <div className="charttrade-actions">
            <button
              type="button"
              className="charttrade-btn buy"
              onClick={() => commit("buy")}
            >
              매수
            </button>
            <button
              type="button"
              className="charttrade-btn sell"
              onClick={() => commit("sell")}
            >
              매도
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
