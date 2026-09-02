"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CartesianGrid,
  Customized,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ComposedChart,
  ReferenceLine,
} from "recharts";

import {
  HORIZON,
  ROUNDS,
  START_EQUITY,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_PRESETS,
  WEIGHT_STEP,
  clampWeight,
  equityFromPicks,
  fmtKrw,
  fmtPct,
  resultTitle,
  scoreRound,
  shareText,
  sideLabel,
  totalPnlPct,
  weightLabel,
  type CandlePoint,
  type ChartTradePayload,
  type ChartTradeRound,
  type TradePick,
} from "@/lib/chartTrade";

type ChartRow = CandlePoint & { phase: "seen" | "next" };

type RankEntry = {
  id: string;
  nickname: string;
  date: string;
  equity: number;
  pnl_pct: number;
  weights: number[];
  created_at: string;
};

type RankPayload = {
  ok: boolean;
  error?: string;
  date?: string;
  today?: RankEntry[];
  all?: RankEntry[];
  rank?: number;
  entry?: RankEntry;
};

const NICK_KEY = "savvy_charttrade_nick";

function buildChartRows(round: ChartTradeRound, revealed: boolean): ChartRow[] {
  const seen: ChartRow[] = round.seen.map((p) => ({ ...p, phase: "seen" }));
  if (!revealed) return seen;
  const future: ChartRow[] = round.next.slice(1).map((p) => ({
    ...p,
    phase: "next",
  }));
  return [...seen, ...future];
}

function makeCandleLayer(rows: ChartRow[]) {
  return function CandleLayer(props: {
    offset?: { top: number; left: number; width: number; height: number };
    yAxisMap?: Record<string, { yAxisId?: string | number; scale?: (v: number) => number }>;
  }) {
    const offset = props.offset;
    if (!offset || !rows.length) return null;
    const axes = Object.values(props.yAxisMap || {});
    const yAxis = axes.find((a) => a.yAxisId === "px") || axes[0];
    const yScale = yAxis?.scale;
    const y = (v: number) =>
      yScale
        ? yScale(v)
        : offset.top +
          (1 - (v - rows[0]!.low) / Math.max(rows[0]!.high - rows[0]!.low, 1e-9)) *
            offset.height;
    const slot = offset.width / rows.length;
    const bodyW = Math.max(1.4, Math.min(8.5, slot * 0.62));
    return (
      <g className="charttrade-candles">
        {rows.map((d, i) => {
          const cx = offset.left + slot * i + slot / 2;
          const up = d.close >= d.open;
          const color = up ? "#3dd68c" : "#f87171";
          const yO = y(d.open);
          const yC = y(d.close);
          const next = d.phase === "next";
          return (
            <g key={`${d.date}-${i}`} opacity={next ? 1 : 0.92}>
              <line
                x1={cx}
                x2={cx}
                y1={y(d.high)}
                y2={y(d.low)}
                stroke={color}
                strokeWidth={next ? 1.35 : 1}
              />
              <rect
                x={cx - bodyW / 2}
                y={Math.min(yO, yC)}
                width={bodyW}
                height={Math.max(Math.abs(yC - yO), 1)}
                fill={up ? color : "#141d2b"}
                stroke={color}
                strokeWidth={1}
              />
            </g>
          );
        })}
      </g>
    );
  };
}

function CandleTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;
  return (
    <div className="charttrade-tip">
      <strong>
        {d.phase === "next" ? "이후 " : ""}
        {d.date.slice(5)}
      </strong>
      <div>시 {d.open.toFixed(1)}</div>
      <div>고 {d.high.toFixed(1)}</div>
      <div>저 {d.low.toFixed(1)}</div>
      <div>종 {d.close.toFixed(1)}</div>
    </div>
  );
}

async function canvasPng(picks: TradePick[], date: string): Promise<Blob> {
  const W = 720;
  const H = 980;
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

  const equity = equityFromPicks(picks);
  const total = totalPnlPct(picks);
  const up = total >= 0;
  ctx.fillStyle = "#8fa3b8";
  ctx.font = "600 13px 'DM Sans', system-ui, sans-serif";
  ctx.fillText("SAVVYETF  모의투자", 56, 72);
  ctx.fillText(date, W - 56 - ctx.measureText(date).width, 72);

  ctx.fillStyle = up ? "#3dd68c" : "#f87171";
  ctx.font = "400 56px 'Instrument Serif', Georgia, serif";
  ctx.fillText(fmtKrw(equity), 56, 150);
  ctx.fillStyle = "#e8eef5";
  ctx.font = "400 22px 'Instrument Serif', Georgia, serif";
  ctx.fillText(`${fmtPct(total)}  ·  ${resultTitle(total)}`, 56, 188);

  ctx.font = "500 13px 'DM Sans', system-ui, sans-serif";
  ctx.fillStyle = "#8fa3b8";
  ctx.fillText(`원금 1억  ·  캔들 ${ROUNDS}판  ·  레버리지 ±200%`, 56, 220);

  picks.forEach((p, i) => {
    const y = 258 + i * 88;
    ctx.fillStyle = "#1a2538";
    roundRect(ctx, 56, y, W - 112, 76, 10);
    ctx.fill();
    ctx.fillStyle =
      p.side === "buy" ? "#3dd68c" : p.side === "sell" ? "#f87171" : "#8fa3b8";
    roundRect(ctx, 72, y + 22, 72, 32, 8);
    ctx.fill();
    ctx.fillStyle = "#0b1018";
    ctx.font = "700 12px 'DM Sans', system-ui, sans-serif";
    ctx.fillText(sideLabel(p.side), 84, y + 43);
    ctx.fillStyle = "#e8eef5";
    ctx.font = "700 20px 'DM Sans', system-ui, sans-serif";
    ctx.fillText(p.ticker, 160, y + 38);
    ctx.fillStyle = "#8fa3b8";
    ctx.font = "400 12px 'DM Sans', system-ui, sans-serif";
    ctx.fillText(`${weightLabel(p.weight_pct)} · ${p.name}`, 160, y + 58);
    ctx.fillStyle = p.pnl_pct >= 0 ? "#3dd68c" : "#f87171";
    ctx.font = "700 22px 'DM Sans', system-ui, sans-serif";
    const pnl = fmtPct(p.pnl_pct);
    ctx.fillText(pnl, W - 72 - ctx.measureText(pnl).width, y + 48);
  });

  ctx.fillStyle = "#8fa3b8";
  ctx.font = "500 13px 'DM Sans', system-ui, sans-serif";
  ctx.fillText("savvyetf.com/play", 56, H - 56);

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

function RankTable({
  title,
  note,
  rows,
  mine,
}: {
  title: string;
  note?: string;
  rows: RankEntry[];
  mine?: string | null;
}) {
  return (
    <div className="charttrade-rank-block">
      <div className="charttrade-rank-head">
        <h3>{title}</h3>
        {note ? <span>{note}</span> : null}
      </div>
      {!rows.length ? (
        <p className="empty">아직 기록이 없습니다. 한 판 돌리고 이름을 남기세요.</p>
      ) : (
        <ol className="charttrade-rank-list">
          {rows.map((row, i) => {
            const you = mine && row.nickname === mine;
            return (
              <li key={row.id} className={you ? "you" : undefined}>
                <em>{i + 1}</em>
                <strong>
                  {row.nickname}
                  {you ? " · 나" : ""}
                </strong>
                <span className={row.pnl_pct >= 0 ? "up" : "down"}>
                  {fmtKrw(row.equity)}
                </span>
                <span className={`charttrade-rank-pct ${row.pnl_pct >= 0 ? "up" : "down"}`}>
                  {fmtPct(row.pnl_pct)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default function ChartTradeTab() {
  const [data, setData] = useState<ChartTradePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [picks, setPicks] = useState<TradePick[]>([]);
  const [weight, setWeight] = useState(100);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [rankToday, setRankToday] = useState<RankEntry[]>([]);
  const [rankAll, setRankAll] = useState<RankEntry[]>([]);
  const [rankNote, setRankNote] = useState<string | null>(null);
  const [rankBusy, setRankBusy] = useState(false);
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const [myRank, setMyRank] = useState<number | null>(null);

  const loadRanks = useCallback(async () => {
    try {
      const res = await fetch("/api/chart-trade/rank", { cache: "no-store" });
      const json = (await res.json()) as RankPayload;
      if (!res.ok || !json.ok) return;
      setRankToday(json.today || []);
      setRankAll(json.all || []);
    } catch {
      /* board is optional */
    }
  }, []);

  useEffect(() => {
    setNickname(window.localStorage.getItem(NICK_KEY) || "");
  }, []);

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
    void loadRanks();
    return () => {
      cancelled = true;
    };
  }, [loadRanks]);

  const round = data?.rounds[step];
  const done = Boolean(data && picks.length >= ROUNDS && step >= ROUNDS);
  const chartRows = useMemo(
    () => (round ? buildChartRows(round, revealed) : []),
    [round, revealed],
  );
  const candleLayer = useMemo(() => makeCandleLayer(chartRows), [chartRows]);
  const yDomain = useMemo(() => {
    if (!chartRows.length) return [90, 110] as [number, number];
    let lo = chartRows[0]!.low;
    let hi = chartRows[0]!.high;
    for (const row of chartRows) {
      if (row.low < lo) lo = row.low;
      if (row.high > hi) hi = row.high;
    }
    const pad = Math.max((hi - lo) * 0.08, 0.4);
    return [lo - pad, hi + pad] as [number, number];
  }, [chartRows]);
  const revealX = revealed ? round?.seen[round.seen.length - 1]?.date : undefined;
  const equity = equityFromPicks(picks);
  const runPct = totalPnlPct(picks);
  const lastPick = picks[picks.length - 1];
  const w = clampWeight(weight);
  const wTone = w > 0 ? "buy" : w < 0 ? "sell" : "flat";

  const commit = useCallback(() => {
    if (!round || revealed) return;
    const pick = scoreRound(round, w);
    setPicks((prev) => [...prev, pick]);
    setRevealed(true);
  }, [round, revealed, w]);

  function next() {
    setRevealed(false);
    setWeight(100);
    setStep((s) => s + 1);
  }

  function replay() {
    setPicks([]);
    setStep(0);
    setRevealed(false);
    setShareNote(null);
    setRankNote(null);
    setSubmittedName(null);
    setMyRank(null);
    setWeight(100);
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

  async function onSubmitRank(e: FormEvent) {
    e.preventDefault();
    if (!data || rankBusy) return;
    const name = nickname.trim();
    if (!name) {
      setRankNote("이름을 입력해 주세요.");
      return;
    }
    setRankBusy(true);
    setRankNote(null);
    try {
      window.localStorage.setItem(NICK_KEY, name);
      const res = await fetch("/api/chart-trade/rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: name,
          date: data.date,
          weights: picks.map((p) => p.weight_pct),
        }),
      });
      const json = (await res.json()) as RankPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "기록 실패");
      }
      setRankToday(json.today || []);
      setRankAll(json.all || []);
      setSubmittedName(json.entry?.nickname || name);
      setMyRank(json.rank ?? null);
      setRankNote(
        json.rank
          ? `오늘 ${json.rank}위로 기록했습니다.`
          : "랭킹에 기록했습니다.",
      );
    } catch (exc) {
      setRankNote(exc instanceof Error ? exc.message : "기록에 실패했습니다.");
    } finally {
      setRankBusy(false);
    }
  }

  const board = (
    <section className="feature-block charttrade-board" aria-label="모의투자 랭킹">
      <div className="feature-head">
        <div>
          <h2 className="feature-title">랭킹</h2>
          <p className="feature-lead">
            원금 1억으로 같은 다섯 장을 돌린 기록입니다. 같은 이름은 더 높은
            평가액만 남습니다.
          </p>
        </div>
      </div>
      <div className="charttrade-rank-grid">
        <RankTable
          title="오늘"
          note={data?.date}
          rows={rankToday}
          mine={submittedName}
        />
        <RankTable title="명예의 전당" note="역대 최고" rows={rankAll} mine={submittedName} />
      </div>
    </section>
  );

  if (loading) {
    return (
      <div className="edu-tab charttrade-tab">
        <section className="feature-block">
          <p className="empty">오늘 캔들 다섯 장을 섞는 중…</p>
        </section>
        {board}
      </div>
    );
  }

  if (error || !data?.ok) {
    return (
      <div className="edu-tab charttrade-tab">
        <section className="feature-block">
          <p className="empty warn">{error || "모의투자를 불러오지 못했습니다."}</p>
        </section>
        {board}
      </div>
    );
  }

  if (done) {
    const up = runPct >= 0;
    return (
      <div className="edu-tab charttrade-tab">
        <section className="feature-block charttrade-sheet">
          <p className="charttrade-kicker">SavvyETF 모의투자 · {data.date}</p>
          <p className={`charttrade-total ${up ? "up" : "down"}`}>{fmtKrw(equity)}</p>
          <h2 className="charttrade-title">
            {fmtPct(runPct)} · {resultTitle(runPct)}
          </h2>
          <p className="feature-lead">
            원금 {fmtKrw(START_EQUITY)} · 이름 없는 캔들 {ROUNDS}판 · 다음 {HORIZON}
            거래일 · 레버리지 −200%~+200%
          </p>
          <ol className="charttrade-legs">
            {picks.map((p) => (
              <li key={p.roundId}>
                <span className={`charttrade-side ${p.side}`}>
                  {sideLabel(p.side)}
                </span>
                <span className="charttrade-leg-name">
                  <strong>
                    {p.ticker} · {fmtPct(p.weight_pct, 0)}
                  </strong>
                  <em>{p.name}</em>
                </span>
                <span className={`charttrade-pnl ${p.pnl_pct >= 0 ? "up" : "down"}`}>
                  {fmtPct(p.pnl_pct)}
                </span>
                <span className="charttrade-tape">실제 {fmtPct(p.fwd_pct)}</span>
              </li>
            ))}
          </ol>
          <form className="charttrade-rank-form" onSubmit={(e) => void onSubmitRank(e)}>
            <label>
              <span>랭킹 이름</span>
              <input
                type="text"
                maxLength={16}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="닉네임"
                autoComplete="nickname"
              />
            </label>
            <button type="submit" className="chip active" disabled={rankBusy}>
              {rankBusy ? "기록 중…" : submittedName ? "더 높은 점수만 갱신" : "랭킹에 남기기"}
            </button>
          </form>
          {myRank ? (
            <p className="charttrade-rank-banner">오늘 {myRank}위 · {submittedName}</p>
          ) : null}
          {rankNote ? <p className="meta-soft">{rankNote}</p> : null}
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
        {board}
      </div>
    );
  }

  if (!round) return null;

  return (
    <div className="edu-tab charttrade-tab">
      <section className="feature-block charttrade-arena">
        <div className="charttrade-hud">
          <div>
            <p className="charttrade-kicker">원금 1억 · 익명 캔들</p>
            <p className={`charttrade-equity ${runPct >= 0 ? "up" : "down"}`}>
              {fmtKrw(equity)}
            </p>
            <p className="charttrade-hud-sub">
              {picks.length ? fmtPct(runPct) : "평가액"} · {step + 1}/{ROUNDS}판 · 다음{" "}
              {HORIZON}거래일
            </p>
          </div>
          <ol className="charttrade-dots" aria-label="진행">
            {data.rounds.map((r, i) => {
              const pick = picks[i];
              const cls = [
                i === step ? "on" : "",
                pick ? (pick.pnl_pct >= 0 ? "win" : "loss") : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <li key={r.id} className={cls}>
                  {pick ? (pick.pnl_pct >= 0 ? "+" : "−") : i + 1}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="charttrade-stage">
          <div className="chart-wrap charttrade-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartRows}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(43,54,72,0.85)" strokeDasharray="3 3" />
                <XAxis dataKey="date" hide />
                <YAxis yAxisId="px" hide domain={yDomain} />
                <Tooltip
                  content={<CandleTip />}
                  cursor={{ stroke: "rgba(143,163,184,0.35)" }}
                />
                {revealX ? (
                  <ReferenceLine
                    yAxisId="px"
                    x={revealX}
                    stroke="#4da3ff"
                    strokeDasharray="4 4"
                  />
                ) : null}
                <Line
                  yAxisId="px"
                  type="monotone"
                  dataKey="close"
                  stroke="transparent"
                  strokeWidth={0}
                  dot={false}
                  isAnimationActive={false}
                />
                <Customized component={candleLayer} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {revealed && lastPick && lastPick.roundId === round.id ? (
          <div className={`charttrade-reveal ${lastPick.pnl_pct >= 0 ? "win" : "loss"}`}>
            <p>
              <strong>{round.ticker}</strong> {round.name} · {weightLabel(lastPick.weight_pct)}
              <br />
              실제 {fmtPct(round.fwd_pct)} · 당신{" "}
              <span className={lastPick.pnl_pct >= 0 ? "up" : "down"}>
                {fmtPct(lastPick.pnl_pct)}
              </span>
              {" · "}
              {fmtKrw(equity)}
            </p>
            <button type="button" className="chip active" onClick={next}>
              {step + 1 < ROUNDS ? "다음 차트" : "결과지 보기"}
            </button>
          </div>
        ) : (
          <div className="charttrade-play">
            <div className={`charttrade-weight ${wTone}`}>
              <p className="charttrade-weight-readout">{weightLabel(w)}</p>
              <p className="charttrade-weight-hint">
                이 구간이 1% 움직이면 계좌는 {fmtPct(w / 100, 1)}
              </p>
              <div className="charttrade-slider-wrap">
                <span>매도 2×</span>
                <input
                  type="range"
                  min={WEIGHT_MIN}
                  max={WEIGHT_MAX}
                  step={WEIGHT_STEP}
                  value={w}
                  aria-label="매수 매도 비중"
                  onChange={(e) => setWeight(Number(e.target.value))}
                />
                <span>매수 2×</span>
              </div>
              <div className="charttrade-presets" role="group" aria-label="빠른 비중">
                {WEIGHT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`chip ${w === preset ? "active" : ""}`}
                    onClick={() => setWeight(preset)}
                  >
                    {preset === 0 ? "현금" : fmtPct(preset, 0)}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className={`charttrade-go ${wTone}`}
              onClick={commit}
            >
              {w === 0 ? "이 차트 건너뛰기" : `${weightLabel(w)} 진입`}
            </button>
          </div>
        )}
      </section>
      {board}
    </div>
  );
}
