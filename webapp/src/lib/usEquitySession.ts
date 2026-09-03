/** US equity session calendar — aligned with market_data_freshness.py / us_calendar.py. */

const ET = "America/New_York";
const REGULAR_CLOSE_MINUTES = 16 * 60;

function etParts(at: Date): { ymd: string; weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const wd: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return {
    ymd: `${bag.year}-${bag.month}-${bag.day}`,
    weekday: wd[bag.weekday] ?? 0,
    minutes: Number(bag.hour) * 60 + Number(bag.minute),
  };
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function addDays(ymd: string, days: number): string {
  const dt = parseYmd(ymd);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  let d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCDay() !== (weekday + 1) % 7) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  d.setUTCDate(d.getUTCDate() + (n - 1) * 7);
  return d.toISOString().slice(0, 10);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const d = month === 12 ? new Date(Date.UTC(year + 1, 0, 0)) : new Date(Date.UTC(year, month, 0));
  const jsWeekday = (weekday + 1) % 7;
  while (d.getUTCDay() !== jsWeekday) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}

function observed(ymd: string): string {
  const js = parseYmd(ymd).getUTCDay();
  if (js === 6) return addDays(ymd, -1);
  if (js === 0) return addDays(ymd, 1);
  return ymd;
}

function easterFriday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const el = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * el) / 451);
  const month = Math.floor((h + el - 7 * m + 114) / 31);
  const day = ((h + el - 7 * m + 114) % 31) + 1;
  return addDays(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    -2,
  );
}

function nyseHolidays(year: number): Set<string> {
  return new Set([
    observed(`${year}-01-01`),
    nthWeekday(year, 1, 0, 3),
    nthWeekday(year, 2, 0, 3),
    lastWeekday(year, 5, 0),
    observed(`${year}-06-19`),
    observed(`${year}-07-04`),
    nthWeekday(year, 9, 0, 1),
    nthWeekday(year, 11, 3, 4),
    observed(`${year}-12-25`),
    easterFriday(year),
  ]);
}

export function etYmd(at: Date = new Date()): string {
  return etParts(at).ymd;
}

export function unixToEtYmd(unixSec: number): string {
  return etYmd(new Date(unixSec * 1000));
}

export function isUsEquityTradingDay(ymd: string): boolean {
  const js = parseYmd(ymd).getUTCDay();
  if (js === 0 || js === 6) return false;
  const year = Number(ymd.slice(0, 4));
  return !nyseHolidays(year).has(ymd);
}

export function previousUsTradingDay(ymd: string): string {
  let prev = addDays(ymd, -1);
  while (!isUsEquityTradingDay(prev)) prev = addDays(prev, -1);
  return prev;
}

/** Latest regular-session date that should already have a daily close. */
export function expectedLatestUsDailyDate(at: Date = new Date()): string | null {
  const { ymd, weekday, minutes } = etParts(at);
  if (weekday === 5) return previousUsTradingDay(ymd);
  if (weekday === 6) return previousUsTradingDay(addDays(ymd, -1));
  if (!isUsEquityTradingDay(ymd) || minutes < REGULAR_CLOSE_MINUTES) {
    return previousUsTradingDay(ymd);
  }
  return ymd;
}

export function isUsListedSymbol(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  if (!s) return false;
  if (s.endsWith(".KS") || s.endsWith(".KQ")) return false;
  if (s.startsWith("^KS") || s.startsWith("^KQ")) return false;
  if (s.includes("=X") || s.endsWith("-USD") || s.endsWith("=F")) return false;
  return true;
}
