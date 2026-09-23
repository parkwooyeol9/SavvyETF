import * as XLSX from "xlsx";

export type SheetTable = {
  sheet: string;
  headers: string[];
  rows: string[][];
  /** 0-based index of the header row in the raw sheet matrix. */
  header_row: number;
};

function cellToString(v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) {
    // Avoid scientific noise; keep meaningful decimals.
    if (Number.isInteger(v)) return String(v);
    const abs = Math.abs(v);
    if (abs >= 100) return v.toFixed(2).replace(/\.?0+$/, "");
    if (abs >= 1) return v.toFixed(4).replace(/\.?0+$/, "");
    return v.toPrecision(4).replace(/\.?0+$/, "");
  }
  return String(v).trim();
}

function nonemptyCount(row: unknown[]): number {
  return row.filter((c) => cellToString(c) !== "").length;
}

/**
 * Pick the most likely header row in the first ~25 rows.
 * Prefers a row with many unique non-empty string-ish labels and few pure numbers.
 */
function findHeaderRowIndex(matrix: unknown[][]): number {
  const limit = Math.min(matrix.length, 25);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < limit; i++) {
    const row = matrix[i] || [];
    const n = nonemptyCount(row);
    if (n < 2) continue;
    const labels = row.map(cellToString).filter(Boolean);
    const uniq = new Set(labels.map((s) => s.toLowerCase()));
    let numericish = 0;
    let textish = 0;
    for (const s of labels) {
      if (/^[-+]?\d+(\.\d+)?%?$/.test(s.replace(/,/g, ""))) numericish += 1;
      else textish += 1;
    }
    // Header rows: high uniqueness, mostly text labels, not mostly numbers.
    const score =
      uniq.size * 3 +
      textish * 2 -
      numericish * 2 +
      (uniq.size === labels.length ? 4 : 0) +
      Math.min(n, 12);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Parse .xlsx buffer into string tables (header auto-detect). */
export function parseXlsxBuffer(
  buf: ArrayBuffer | Buffer,
  opts?: { maxSheets?: number; maxRows?: number },
): SheetTable[] {
  const maxSheets = opts?.maxSheets ?? 4;
  const maxRows = opts?.maxRows ?? 1_500;
  const wb = XLSX.read(buf, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });
  const out: SheetTable[] = [];
  for (const name of wb.SheetNames) {
    if (out.length >= maxSheets) break;
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    }) as unknown[][];
    if (!matrix.length) continue;

    const headerIdx = findHeaderRowIndex(matrix);
    const headerRow = (matrix[headerIdx] || []).map(cellToString);
    // Drop trailing empty header cells.
    let last = headerRow.length - 1;
    while (last >= 0 && !headerRow[last]) last -= 1;
    if (last < 0) continue;
    const headers = headerRow.slice(0, last + 1).map((h, i) => h || `col_${i + 1}`);

    // Dedupe duplicate headers.
    const seen = new Map<string, number>();
    const uniqueHeaders = headers.map((h) => {
      const key = h.toLowerCase();
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      return n === 1 ? h : `${h}_${n}`;
    });

    const rows: string[][] = [];
    for (let i = headerIdx + 1; i < matrix.length && rows.length < maxRows; i++) {
      const raw = matrix[i] || [];
      const cells = uniqueHeaders.map((_, j) => cellToString(raw[j]));
      if (!cells.some((c) => c)) continue;
      // Skip rows that look like repeated headers / section titles (all text matching headers).
      const asHeader = cells.every(
        (c, j) => !c || c.toLowerCase() === uniqueHeaders[j]!.toLowerCase(),
      );
      if (asHeader) continue;
      rows.push(cells);
    }
    if (!rows.length) continue;
    out.push({
      sheet: name,
      headers: uniqueHeaders,
      rows,
      header_row: headerIdx,
    });
  }
  return out;
}

export function tableToCsvPreview(table: SheetTable, maxRows = 80): string {
  const lines = [table.headers.join("\t")];
  for (const row of table.rows.slice(0, maxRows)) {
    lines.push(row.join("\t"));
  }
  if (table.rows.length > maxRows) {
    lines.push(`… (+${table.rows.length - maxRows} rows)`);
  }
  return lines.join("\n");
}

export function tableToRecords(
  table: SheetTable,
  maxRows = 400,
): Record<string, string>[] {
  return table.rows.slice(0, maxRows).map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < table.headers.length; i++) {
      const h = table.headers[i]!;
      const v = row[i] || "";
      if (v) obj[h] = v;
    }
    return obj;
  });
}
