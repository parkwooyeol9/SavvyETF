/**
 * Session regimes for crypto 24/7 series vs traditional cash hours.
 * Shared by 단기예측 sizing and 레짐 연구.
 */

export type SessionRegimeId = "asia" | "us" | "weekend" | "other";

export const SESSION_REGIME_LABEL: Record<SessionRegimeId, string> = {
  asia: "아시아장",
  us: "미국장",
  weekend: "주말(정규장 휴장)",
  other: "평일 기타시간",
};

export const SESSION_REGIME_NOTE: Record<SessionRegimeId, string> = {
  asia: "평일 UTC 00:00–08:00",
  us: "평일 UTC 13:30–20:00 (NYSE RTH 근사)",
  weekend: "토·일 UTC",
  other: "유럽 단독 등 a/b/c 외 구간",
};

/** ~90 days of 5m bars. */
export const ARCHIVE_MAX_BARS = 26_000;
/** Live pull target per update (~45–50 days if archive empty). */
export const LIVE_FETCH_TARGET_BARS = 12_000;
export const LIVE_FETCH_MAX_PAGES = 45;

export function classifySessionRegime(tsMs: number): SessionRegimeId {
  const d = new Date(tsMs);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return "weekend";
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (minutes >= 0 && minutes < 8 * 60) return "asia";
  if (minutes >= 13 * 60 + 30 && minutes < 20 * 60) return "us";
  return "other";
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export type RegimeVolSnapshot = {
  asia: number;
  us: number;
  weekend: number;
  other: number;
  /** Bars used for vol estimate. */
  n: { asia: number; us: number; weekend: number; other: number };
};

/** 5m log-return σ (%) by session regime. */
export function regimeVolSnapshot(
  bars: Array<{ ts: number; close: number }>,
): RegimeVolSnapshot {
  const buckets: Record<SessionRegimeId, number[]> = {
    asia: [],
    us: [],
    weekend: [],
    other: [],
  };
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.close;
    const cur = bars[i]!.close;
    if (!(prev > 0 && cur > 0)) continue;
    const reg = classifySessionRegime(bars[i]!.ts);
    buckets[reg].push(Math.log(cur / prev) * 100);
  }
  return {
    asia: std(buckets.asia),
    us: std(buckets.us),
    weekend: std(buckets.weekend),
    other: std(buckets.other),
    n: {
      asia: buckets.asia.length,
      us: buckets.us.length,
      weekend: buckets.weekend.length,
      other: buckets.other.length,
    },
  };
}

export type RegimeSizing = {
  regime: SessionRegimeId;
  regime_label_ko: string;
  regime_vol_pct: number;
  peer_median_vol_pct: number;
  /** 1 = full size; &lt;1 shrink in high-vol regimes. */
  size_mult: number;
  note_ko: string;
};

/**
 * Inverse-vol sizing vs median of asia/us/weekend.
 * High-vol US session → smaller size / stricter signal thresholds.
 */
export function sizeFromRegimeVol(
  tsMs: number,
  vols: RegimeVolSnapshot,
): RegimeSizing {
  const regime = classifySessionRegime(tsMs);
  const peers = [vols.asia, vols.us, vols.weekend].filter((v) => v > 0);
  const peerMed =
    peers.length === 0
      ? 0
      : [...peers].sort((a, b) => a - b)[Math.floor((peers.length - 1) / 2)]!;
  const cur =
    regime === "asia"
      ? vols.asia
      : regime === "us"
        ? vols.us
        : regime === "weekend"
          ? vols.weekend
          : vols.other || peerMed;
  let size = 1;
  if (peerMed > 0 && cur > 0) {
    size = Math.max(0.35, Math.min(1.25, peerMed / cur));
  } else if (regime === "other") {
    size = 0.75;
  }
  const note =
    peerMed > 0
      ? `현재 ${SESSION_REGIME_LABEL[regime]} σ=${cur.toFixed(3)}% · 레짐중앙 σ=${peerMed.toFixed(3)}% → 사이즈×${size.toFixed(2)}`
      : `현재 ${SESSION_REGIME_LABEL[regime]} · 레짐 σ 표본 부족 → 사이즈×${size.toFixed(2)}`;
  return {
    regime,
    regime_label_ko: SESSION_REGIME_LABEL[regime],
    regime_vol_pct: Number(cur.toFixed(5)),
    peer_median_vol_pct: Number(peerMed.toFixed(5)),
    size_mult: Number(size.toFixed(3)),
    note_ko: note,
  };
}
