/**
 * Stock feature board: admin uploads ≤4 Excel dataframes (ticker + traits),
 * profile columns → sample smartly → Gemini (or rich heuristic) reshape.
 */

import { callGeminiJson, geminiConfigured } from "@/lib/gemini";
import { r2Configured, r2GetObjectText, r2PutObject } from "@/lib/r2";
import {
  parseXlsxBuffer,
  tableToRecords,
  type SheetTable,
} from "@/lib/xlsxRead";
import { siteAdminAuthorized, siteAdminConfigured } from "@/lib/siteAdmin";

export const STOCK_BOARD_R2_KEY = "stock_features/board_latest.json";
export const STOCK_BOARD_MAX_FILES = 4;
export const STOCK_BOARD_MAX_FILE_BYTES = 4 * 1024 * 1024;

export type StockBoardSource = {
  filename: string;
  sheet: string;
  rows: number;
  cols: number;
  headers: string[];
  header_row?: number;
  profile?: ColumnProfile[];
};

export type StockBoardPick = {
  ticker: string;
  name: string;
  why: string;
  score?: number | null;
  tags?: string[];
};

export type StockBoardTheme = {
  name: string;
  summary: string;
  tickers: string[];
};

export type StockBoardTable = {
  title: string;
  columns: string[];
  rows: string[][];
};

export type StockFeatureBoardPayload = {
  ok: boolean;
  generated_at: string;
  title_ko: string;
  headline_ko: string;
  processor: "gemini" | "heuristic";
  sources: StockBoardSource[];
  themes: StockBoardTheme[];
  top_picks: StockBoardPick[];
  watchouts: StockBoardPick[];
  tables: StockBoardTable[];
  notes: string[];
  error?: string;
  cached?: boolean;
};

export type ColumnRole =
  | "ticker"
  | "name"
  | "score"
  | "rank"
  | "theme"
  | "sector"
  | "numeric"
  | "text"
  | "date"
  | "flag";

export type ColumnProfile = {
  name: string;
  role: ColumnRole;
  fill_pct: number;
  unique_n: number;
  numeric_pct: number;
  sample: string[];
  mean?: number | null;
  p10?: number | null;
  p90?: number | null;
};

type ParsedFile = {
  filename: string;
  table: SheetTable;
  profiles: ColumnProfile[];
  tickerCol: string | null;
  nameCol: string | null;
  scoreCols: string[];
  themeCols: string[];
  records: Record<string, string>[];
};

function emptyBoard(error?: string): StockFeatureBoardPayload {
  return {
    ok: false,
    generated_at: new Date().toISOString(),
    title_ko: "종목보드",
    headline_ko: "",
    processor: "heuristic",
    sources: [],
    themes: [],
    top_picks: [],
    watchouts: [],
    tables: [],
    notes: [],
    error,
  };
}

function parseNumber(raw: string): number | null {
  if (!raw) return null;
  let s = raw.replace(/,/g, "").replace(/%/g, "").trim();
  if (!s || s === "-" || s === "—") return null;
  // Parentheses negative
  if (/^\(\s*[\d.]+\s*\)$/.test(s)) s = `-${s.replace(/[()]/g, "")}`;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function looksTickerHeader(h: string): boolean {
  const t = h.trim();
  return (
    /^(ticker|symbol|code|종목코드|티커|코드|심볼|isin)$/i.test(t) ||
    /ticker|symbol|종목코드|티커|종목\s*코드/i.test(t)
  );
}

function looksNameHeader(h: string): boolean {
  const t = h.trim();
  return (
    /^(name|종목명|회사명|기업명|종목|security|corp)$/i.test(t) ||
    /종목명|회사명|company|security\s*name|기업명/i.test(t)
  );
}

function looksScoreHeader(h: string): boolean {
  return /score|점수|종합|총점|z[_-]?score|모멘텀|밸류|퀄리티|팩터|alpha|signal|composite|rating|등급|선호도|매력/i.test(
    h,
  );
}

function looksRankHeader(h: string): boolean {
  return /^(rank|순위|등수)$/i.test(h.trim()) || /\brank\b|순위/i.test(h);
}

function looksThemeHeader(h: string): boolean {
  return /theme|테마|섹터|industry|업종|산업|category|분류|cluster|그룹|스타일|factor/i.test(
    h,
  );
}

function looksDateHeader(h: string): boolean {
  return /date|날짜|일자|as[_ ]?of|기준일/i.test(h);
}

function looksFlagHeader(h: string): boolean {
  return /flag|여부|y\/n|포함|제외|buy|sell|신호/i.test(h);
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = Math.max(0, Math.min(1, q)) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const w = pos - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function profileColumns(table: SheetTable): ColumnProfile[] {
  const n = table.rows.length || 1;
  return table.headers.map((name, colIdx) => {
    const values = table.rows.map((r) => r[colIdx] || "").filter(Boolean);
    const uniq = new Set(values.map((v) => v.toLowerCase()));
    let numericHits = 0;
    const nums: number[] = [];
    for (const v of values) {
      const num = parseNumber(v);
      if (num != null) {
        numericHits += 1;
        nums.push(num);
      }
    }
    const fill_pct = Number(((values.length / n) * 100).toFixed(1));
    const numeric_pct = values.length
      ? Number(((numericHits / values.length) * 100).toFixed(1))
      : 0;
    const sample = [...uniq].slice(0, 5);

    let role: ColumnRole = "text";
    if (looksTickerHeader(name)) role = "ticker";
    else if (looksNameHeader(name)) role = "name";
    else if (looksRankHeader(name)) role = "rank";
    else if (looksScoreHeader(name)) role = "score";
    else if (looksThemeHeader(name) && numeric_pct < 40) role = "theme";
    else if (looksThemeHeader(name) && uniq.size <= Math.max(30, n * 0.35))
      role = "sector";
    else if (looksDateHeader(name)) role = "date";
    else if (looksFlagHeader(name) && uniq.size <= 8) role = "flag";
    else if (numeric_pct >= 70) role = "numeric";
    else if (uniq.size <= Math.max(12, n * 0.2) && numeric_pct < 40)
      role = "theme";

    // Content-based ticker detection: majority look like tickers.
    if (role === "text" || role === "theme") {
      const tickerish = values.filter((v) =>
        /^[A-Z]{1,5}$|^\d{6}$|^[A-Z0-9.]{1,12}$/i.test(v),
      ).length;
      if (values.length && tickerish / values.length >= 0.7 && uniq.size > 5) {
        role = "ticker";
      }
    }

    nums.sort((a, b) => a - b);
    return {
      name,
      role,
      fill_pct,
      unique_n: uniq.size,
      numeric_pct,
      sample,
      mean: nums.length
        ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4))
        : null,
      p10: quantile(nums, 0.1) != null
        ? Number(quantile(nums, 0.1)!.toFixed(4))
        : null,
      p90: quantile(nums, 0.9) != null
        ? Number(quantile(nums, 0.9)!.toFixed(4))
        : null,
    };
  });
}

function pickRoleCol(
  profiles: ColumnProfile[],
  role: ColumnRole,
): string | null {
  return profiles.find((p) => p.role === role)?.name || null;
}

function pickScoreCols(profiles: ColumnProfile[]): string[] {
  const scored = profiles.filter(
    (p) => p.role === "score" || (p.role === "numeric" && looksScoreHeader(p.name)),
  );
  if (scored.length) return scored.map((p) => p.name);
  // Fallback: widest-range numeric columns (exclude ranks that are dense integers 1..n)
  return profiles
    .filter((p) => p.role === "numeric" && p.p10 != null && p.p90 != null)
    .filter((p) => Math.abs((p.p90 || 0) - (p.p10 || 0)) > 1e-6)
    .slice(0, 3)
    .map((p) => p.name);
}

function rowScore(
  rec: Record<string, string>,
  scoreCols: string[],
  rankCol: string | null,
): number | null {
  const vals: number[] = [];
  for (const c of scoreCols) {
    const n = parseNumber(rec[c] || "");
    if (n != null) vals.push(n);
  }
  if (vals.length) return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (rankCol) {
    const r = parseNumber(rec[rankCol] || "");
    // Lower rank is better → invert for sorting
    if (r != null) return -r;
  }
  return null;
}

/** Stratified sample: top/bottom by score + middle slice + theme coverage. */
function smartSampleRecords(
  records: Record<string, string>[],
  scoreCols: string[],
  rankCol: string | null,
  themeCol: string | null,
  budget: number,
): Record<string, string>[] {
  if (records.length <= budget) return records;
  const scored = records.map((r, i) => ({
    i,
    r,
    s: rowScore(r, scoreCols, rankCol),
  }));
  const withScore = scored.filter((x) => x.s != null) as Array<{
    i: number;
    r: Record<string, string>;
    s: number;
  }>;
  withScore.sort((a, b) => b.s - a.s);

  const picked = new Set<number>();
  const topN = Math.min(Math.ceil(budget * 0.35), withScore.length);
  const botN = Math.min(Math.ceil(budget * 0.2), withScore.length);
  for (let k = 0; k < topN; k++) picked.add(withScore[k]!.i);
  for (let k = 0; k < botN; k++) {
    picked.add(withScore[withScore.length - 1 - k]!.i);
  }

  if (themeCol) {
    const byTheme = new Map<string, number[]>();
    for (const x of scored) {
      const t = (x.r[themeCol] || "").trim() || "(없음)";
      const arr = byTheme.get(t) || [];
      arr.push(x.i);
      byTheme.set(t, arr);
    }
    for (const idxs of byTheme.values()) {
      if (picked.size >= budget) break;
      const mid = idxs[Math.floor(idxs.length / 2)];
      if (mid != null) picked.add(mid);
    }
  }

  const step = Math.max(1, Math.floor(records.length / budget));
  for (let i = 0; i < records.length && picked.size < budget; i += step) {
    picked.add(i);
  }
  for (let i = 0; i < records.length && picked.size < budget; i++) {
    picked.add(i);
  }

  return [...picked]
    .sort((a, b) => a - b)
    .slice(0, budget)
    .map((i) => records[i]!);
}

function featureWhy(
  rec: Record<string, string>,
  profiles: ColumnProfile[],
  tickerCol: string | null,
  nameCol: string | null,
): string {
  const bits: string[] = [];
  for (const p of profiles) {
    if (p.name === tickerCol || p.name === nameCol) continue;
    if (p.role === "date") continue;
    const v = rec[p.name];
    if (!v) continue;
    if (p.role === "score" || p.role === "numeric" || p.role === "rank") {
      bits.push(`${p.name} ${v}`);
    } else if (p.role === "theme" || p.role === "sector" || p.role === "flag") {
      bits.push(`${p.name}=${v}`);
    }
    if (bits.length >= 5) break;
  }
  return bits.join(" · ") || "특성 행";
}

function heuristicFromParsed(files: ParsedFile[]): StockFeatureBoardPayload {
  const sources: StockBoardSource[] = files.map((f) => ({
    filename: f.filename,
    sheet: f.table.sheet,
    rows: f.table.rows.length,
    cols: f.table.headers.length,
    headers: f.table.headers.slice(0, 30),
    header_row: f.table.header_row,
    profile: f.profiles,
  }));

  const top_picks: StockBoardPick[] = [];
  const watchouts: StockBoardPick[] = [];
  const themes: StockBoardTheme[] = [];
  const tables: StockBoardTable[] = [];

  for (const f of files) {
    const rankCol = pickRoleCol(f.profiles, "rank");
    const scored = f.records
      .map((r) => ({
        r,
        s: rowScore(r, f.scoreCols, rankCol),
      }))
      .filter((x) => x.s != null) as Array<{
      r: Record<string, string>;
      s: number;
    }>;
    scored.sort((a, b) => b.s - a.s);

    const toPick = (
      r: Record<string, string>,
      s: number | null,
      tag: string,
    ): StockBoardPick => ({
      ticker: f.tickerCol ? r[f.tickerCol] || "" : Object.values(r)[0] || "",
      name: f.nameCol ? r[f.nameCol] || "" : "",
      why: featureWhy(r, f.profiles, f.tickerCol, f.nameCol),
      score: s != null ? Number(s.toFixed(4)) : null,
      tags: [tag, f.filename.replace(/\.xlsx$/i, "")].filter(Boolean),
    });

    for (const x of scored.slice(0, 6)) {
      const p = toPick(x.r, x.s, "상위");
      if (p.ticker) top_picks.push(p);
    }
    for (const x of scored.slice(-4).reverse()) {
      const p = toPick(x.r, x.s, "하위");
      if (p.ticker) watchouts.push(p);
    }

    const themeCol = f.themeCols[0] || null;
    if (themeCol) {
      const buckets = new Map<string, { n: number; tickers: string[]; sum: number }>();
      for (const r of f.records) {
        const key = (r[themeCol] || "").trim();
        if (!key) continue;
        const b = buckets.get(key) || { n: 0, tickers: [], sum: 0 };
        b.n += 1;
        const t = f.tickerCol ? r[f.tickerCol] || "" : "";
        if (t && b.tickers.length < 6) b.tickers.push(t);
        const s = rowScore(r, f.scoreCols, rankCol);
        if (s != null) b.sum += s;
        buckets.set(key, b);
      }
      const ranked = [...buckets.entries()]
        .map(([name, b]) => ({
          name,
          n: b.n,
          tickers: b.tickers,
          avg: b.n ? b.sum / b.n : null,
        }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 6);
      for (const g of ranked) {
        themes.push({
          name: g.name,
          summary: `${f.filename.replace(/\.xlsx$/i, "")} · n=${g.n}${
            g.avg != null ? ` · 평균점수 ${g.avg.toFixed(2)}` : ""
          }`,
          tickers: g.tickers,
        });
      }
    } else {
      themes.push({
        name: f.filename.replace(/\.xlsx$/i, ""),
        summary: `${f.table.rows.length}종목 · 점수열 ${
          f.scoreCols.join(", ") || "없음"
        }`,
        tickers: top_picks
          .filter((p) => p.tags?.includes(f.filename.replace(/\.xlsx$/i, "")))
          .slice(0, 8)
          .map((p) => p.ticker),
      });
    }

    // Curated table: identity + top score/theme cols, sorted by score
    const showCols = [
      f.tickerCol,
      f.nameCol,
      ...f.scoreCols.slice(0, 2),
      ...f.themeCols.slice(0, 1),
      ...f.profiles
        .filter((p) => p.role === "numeric" && !f.scoreCols.includes(p.name))
        .slice(0, 2)
        .map((p) => p.name),
    ].filter(Boolean) as string[];
    const uniqCols = [...new Set(showCols)].slice(0, 8);
    const ordered = scored.length
      ? scored.map((x) => x.r)
      : f.records;
    tables.push({
      title: `${f.filename} · 핵심열`,
      columns: uniqCols,
      rows: ordered.slice(0, 20).map((r) => uniqCols.map((c) => r[c] || "")),
    });
  }

  const geminiNote = geminiConfigured()
    ? "Gemini 재가공을 시도합니다."
    : "GEMINI_API_KEY가 없어 휴리스틱 보드만 표시됩니다. Vercel 환경변수에 키를 넣으면 테마·요약을 AI가 재작성합니다.";

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    title_ko: "종목보드",
    headline_ko: files
      .map((f) => {
        const roles = f.profiles
          .filter((p) =>
            ["ticker", "name", "score", "theme", "sector"].includes(p.role),
          )
          .map((p) => `${p.name}(${p.role})`)
          .slice(0, 6)
          .join(", ");
        return `${f.filename}: ${f.table.rows.length}행 · ${roles || "열 프로파일 중"}`;
      })
      .join(" / "),
    processor: "heuristic",
    sources,
    themes: themes.slice(0, 10),
    top_picks: top_picks.slice(0, 14),
    watchouts: watchouts.slice(0, 10),
    tables,
    notes: [
      geminiNote,
      "헤더 행 자동 탐지 · 열 역할(티커/점수/테마) 추론 · 상·하위 표본으로 후보를 뽑습니다.",
    ],
  };
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function asStringArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(asString).filter(Boolean);
}

function normalizeAiBoard(
  raw: unknown,
  sources: StockBoardSource[],
  fallback: StockFeatureBoardPayload,
): StockFeatureBoardPayload {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const themesRaw = Array.isArray(o.themes) ? o.themes : [];
  const themes: StockBoardTheme[] = themesRaw
    .map((t) => {
      const x = (t || {}) as Record<string, unknown>;
      return {
        name: asString(x.name) || "테마",
        summary: asString(x.summary),
        tickers: asStringArr(x.tickers).slice(0, 20),
      };
    })
    .filter((t) => t.name);

  const mapPick = (p: unknown): StockBoardPick | null => {
    const x = (p || {}) as Record<string, unknown>;
    const ticker = asString(x.ticker);
    if (!ticker) return null;
    const scoreRaw = x.score;
    const score =
      typeof scoreRaw === "number" && Number.isFinite(scoreRaw)
        ? scoreRaw
        : Number.isFinite(Number(scoreRaw))
          ? Number(scoreRaw)
          : null;
    return {
      ticker,
      name: asString(x.name) || ticker,
      why: asString(x.why) || asString(x.reason),
      score,
      tags: asStringArr(x.tags).slice(0, 6),
    };
  };

  const top = (Array.isArray(o.top_picks) ? o.top_picks : [])
    .map(mapPick)
    .filter(Boolean) as StockBoardPick[];
  const watch = (Array.isArray(o.watchouts) ? o.watchouts : [])
    .map(mapPick)
    .filter(Boolean) as StockBoardPick[];

  const tablesRaw = Array.isArray(o.tables) ? o.tables : [];
  const tables: StockBoardTable[] = tablesRaw
    .map((t) => {
      const x = (t || {}) as Record<string, unknown>;
      const columns = asStringArr(x.columns);
      const rows = Array.isArray(x.rows)
        ? x.rows
            .slice(0, 40)
            .map((r) =>
              Array.isArray(r)
                ? r.map((c) => asString(c)).slice(0, columns.length || 12)
                : [],
            )
            .filter((r) => r.some(Boolean))
        : [];
      return {
        title: asString(x.title) || "표",
        columns: columns.length ? columns : ["col"],
        rows,
      };
    })
    .filter((t) => t.rows.length);

  const notes = asStringArr(o.notes).slice(0, 10);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    title_ko: asString(o.title_ko) || fallback.title_ko || "종목보드",
    headline_ko:
      asString(o.headline_ko) ||
      "업로드한 종목·특성 엑셀을 AI가 테마·후보·표로 재구성했습니다.",
    processor: "gemini",
    sources,
    themes: themes.length ? themes.slice(0, 10) : fallback.themes,
    top_picks: top.length ? top.slice(0, 16) : fallback.top_picks,
    watchouts: watch.length ? watch.slice(0, 12) : fallback.watchouts,
    tables: tables.length ? tables.slice(0, 6) : fallback.tables,
    notes: notes.length ? notes : fallback.notes,
  };
}

async function reshapeWithGemini(
  files: ParsedFile[],
  fallback: StockFeatureBoardPayload,
): Promise<StockFeatureBoardPayload> {
  if (!geminiConfigured()) return fallback;

  const packs = files.map((f) => {
    const rankCol = pickRoleCol(f.profiles, "rank");
    const sample = smartSampleRecords(
      f.records,
      f.scoreCols,
      rankCol,
      f.themeCols[0] || null,
      55,
    );
    return {
      filename: f.filename,
      sheet: f.table.sheet,
      n_rows: f.table.rows.length,
      header_row: f.table.header_row,
      columns: f.profiles.map((p) => ({
        name: p.name,
        role: p.role,
        fill_pct: p.fill_pct,
        unique_n: p.unique_n,
        mean: p.mean,
        p10: p.p10,
        p90: p.p90,
        sample: p.sample,
      })),
      ticker_col: f.tickerCol,
      name_col: f.nameCol,
      score_cols: f.scoreCols,
      theme_cols: f.themeCols,
      sample_rows: sample,
    };
  });

  const prompt = `당신은 퀀트/주식 리서치 에디터입니다. 관리자가 올린 종목×특성 엑셀(최대 4개)을 홈페이지용 '종목보드'로 재편집하세요.

입력은 이미 파싱·열역할 추론·표본추출된 JSON입니다. 원본에 없는 종목·수치를 만들지 마세요.

반드시 JSON만:
{
  "title_ko": "보드 제목 (파일 공통 주제 한 줄)",
  "headline_ko": "3~5문장: 데이터가 말하는 핵심 스토리, 파일 간 관계, 투자자가 볼 포인트",
  "themes": [{"name":"테마/섹터/클러스터","summary":"왜 묶였는지 + 평균적 특성","tickers":["..."]}],
  "top_picks": [{"ticker":"","name":"","why":"어떤 특성(열=값) 때문에 주목인지 구체적으로","score":null,"tags":["파일명또는테마"]}],
  "watchouts": [{"ticker":"","name":"","why":"하위/리스크 근거(열=값)","score":null,"tags":[]}],
  "tables": [{"title":"사람이 읽을 요약표 제목","columns":["종목","이름", "...핵심특성"],"rows":[["..."]]}],
  "notes": ["데이터 한계·해석 주의"]
}

편집 규칙:
1) 열 role을 존중하세요 (ticker/name/score/theme/sector/numeric).
2) top_picks는 점수·순위·플래그가 좋은 쪽, watchouts는 반대쪽. why에 실제 열이름을 넣으세요.
3) 파일이 여러 개면 교차 인사이트(같은 종목이 여러 파일에 나오는지, 테마 불일치 등)를 headline/notes에.
4) tables는 원본 전체를 복사하지 말고, 읽기 좋은 요약표 1~3개(행≤15).
5) 한국어. themes≤8, top_picks≤12, watchouts≤8.
6) sample_rows만 근거로 쓰되, columns 통계(mean/p10/p90)로 맥락을 보강하세요.

=== 파싱 결과 ===
${JSON.stringify(packs).slice(0, 52000)}
`;

  try {
    const raw = await callGeminiJson(prompt, {
      temperature: 0.2,
      timeoutMs: 110_000,
    });
    return normalizeAiBoard(raw, fallback.sources, fallback);
  } catch (exc) {
    return {
      ...fallback,
      notes: [
        ...fallback.notes,
        `Gemini 재가공 실패 → 휴리스틱 유지: ${
          exc instanceof Error ? exc.message : String(exc)
        }`,
      ],
    };
  }
}

function parseOneFile(filename: string, buffer: Buffer): ParsedFile | { error: string } {
  let sheets: SheetTable[];
  try {
    sheets = parseXlsxBuffer(buffer, { maxSheets: 3, maxRows: 1_500 });
  } catch (exc) {
    return {
      error: `${filename} 파싱 실패: ${
        exc instanceof Error ? exc.message : String(exc)
      }`,
    };
  }
  if (!sheets.length) return { error: `${filename}: 시트가 비어 있습니다.` };

  // Prefer the sheet with the most rows × cols that looks like a dataframe.
  const table = [...sheets].sort(
    (a, b) => b.rows.length * b.headers.length - a.rows.length * a.headers.length,
  )[0]!;
  const profiles = profileColumns(table);
  let tickerCol = pickRoleCol(profiles, "ticker");
  let nameCol = pickRoleCol(profiles, "name");
  if (!tickerCol) {
    // First column often ticker when headers are opaque.
    const first = profiles[0];
    if (first && first.unique_n > 5) tickerCol = first.name;
  }
  const scoreCols = pickScoreCols(profiles);
  const themeCols = profiles
    .filter((p) => p.role === "theme" || p.role === "sector")
    .map((p) => p.name);
  const records = tableToRecords(table, 1_200);

  return {
    filename,
    table,
    profiles,
    tickerCol,
    nameCol,
    scoreCols,
    themeCols,
    records,
  };
}

export async function loadStockFeatureBoard(): Promise<StockFeatureBoardPayload | null> {
  if (!r2Configured()) return null;
  try {
    const text = await r2GetObjectText(STOCK_BOARD_R2_KEY);
    if (!text) return null;
    const json = JSON.parse(text) as StockFeatureBoardPayload;
    if (!json || typeof json !== "object") return null;
    return { ...json, cached: true };
  } catch {
    return null;
  }
}

export async function saveStockFeatureBoard(
  payload: StockFeatureBoardPayload,
): Promise<void> {
  if (!r2Configured()) throw new Error("R2 not configured");
  const { cached: _c, ...rest } = payload;
  await r2PutObject(
    STOCK_BOARD_R2_KEY,
    Buffer.from(JSON.stringify(rest), "utf8"),
    "application/json; charset=utf-8",
    "private, max-age=0",
  );
}

export type UploadedWorkbook = {
  filename: string;
  buffer: Buffer;
};

export async function processStockFeatureUploads(
  files: UploadedWorkbook[],
): Promise<StockFeatureBoardPayload> {
  if (!files.length) return emptyBoard("엑셀 파일이 없습니다.");
  if (files.length > STOCK_BOARD_MAX_FILES) {
    return emptyBoard(`파일은 최대 ${STOCK_BOARD_MAX_FILES}개까지입니다.`);
  }

  const parsed: ParsedFile[] = [];
  for (const f of files) {
    const name = f.filename || "upload.xlsx";
    if (f.buffer.byteLength > STOCK_BOARD_MAX_FILE_BYTES) {
      return emptyBoard(`${name}: 파일당 최대 4MB입니다.`);
    }
    const one = parseOneFile(name, f.buffer);
    if ("error" in one) return emptyBoard(one.error);
    parsed.push(one);
  }

  const heuristic = heuristicFromParsed(parsed);
  const board = await reshapeWithGemini(parsed, heuristic);
  board.ok = true;
  await saveStockFeatureBoard(board);
  return board;
}

export function stockBoardAdminOk(request: Request): boolean {
  return siteAdminConfigured() && siteAdminAuthorized(request);
}

export { emptyBoard as emptyStockFeatureBoard };
