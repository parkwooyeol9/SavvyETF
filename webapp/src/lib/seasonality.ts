/** Monthly return seasonality analysis (Event Study tab, 종목 계절성 mode). */

export const DEFAULT_FOCUS_MONTHS = [6, 7, 8, 9] as const;
export const LOOKBACK_YEARS = 10;

export type MonthStat = {
  month: number;
  label_ko: string;
  mean_pct: number;
  median_pct: number;
  std_pct: number;
  win_rate_pct: number;
  n: number;
  in_focus: boolean;
};

export type SeasonalityVerdict = {
  label: string;
  label_en: string;
  tone: "positive" | "negative" | "neutral" | "caution" | "muted";
  significant: boolean;
  summary_ko: string;
};

export type YearlyFocusReturn = {
  year: number;
  return_pct: number;
};

export type SeasonalityPayload = {
  ok: boolean;
  error?: string;
  query?: string;
  symbol?: string;
  yahoo_symbol?: string;
  display?: string;
  market?: string;
  currency?: string;
  lookback_years?: number;
  focus_months?: number[];
  focus_label_ko?: string;
  focus_mean_pct?: number;
  other_mean_pct?: number;
  diff_focus_minus_other_pct?: number;
  ttest_t?: number;
  ttest_p?: number;
  focus_n?: number;
  other_n?: number;
  verdict?: SeasonalityVerdict;
  monthly_stats?: MonthStat[];
  yearly_focus?: YearlyFocusReturn[];
  years_covered?: number[];
  n_months?: number;
  start_date?: string;
  end_date?: string;
  source?: string;
};

export const MONTH_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "1월" },
  { value: 2, label: "2월" },
  { value: 3, label: "3월" },
  { value: 4, label: "4월" },
  { value: 5, label: "5월" },
  { value: 6, label: "6월" },
  { value: 7, label: "7월" },
  { value: 8, label: "8월" },
  { value: 9, label: "9월" },
  { value: 10, label: "10월" },
  { value: 11, label: "11월" },
  { value: 12, label: "12월" },
];

export const EXAMPLE_TICKERS = [
  { ticker: "005180", label: "빙그레 (빙과류)" },
  { ticker: "CARR", label: "Carrier (에어컨)" },
  { ticker: "JCI", label: "Johnson Controls (HVAC)" },
];
