import { NextResponse } from "next/server";

import { simulateAllocation } from "@/lib/simulate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NARRATIVE = [
  {
    heading: "왜 ETF인가",
    body: "ETF는 한 장의 증권으로 수십~수백 종목을 담아, 개별 종목 리스크를 나누고 거래비용·운용보수를 낮게 유지할 수 있는 도구입니다. 장기 자산 배분의 기본 블록으로 쓰기 좋습니다.",
  },
  {
    heading: "분산의 힘",
    body: "동일 자본을 한 종목에 넣는 것과 시장 ETF에 넣는 것은 평균 수익률뿐 아니라 변동성과 최대낙폭에서 차이가 납니다. 아래 차트는 최근 5년 실데이터를 기준으로 그 차이를 보여줍니다.",
  },
  {
    heading: "배분이 성과를 만든다",
    body: "같은 ETF라도 비중을 어떻게 나누느냐에 따라 최종 자산과 낙폭이 달라집니다. 시뮬레이션 탭에서 시작일과 비중을 바꿔 직접 확인해 보세요.",
  },
];

const PRESETS = [
  {
    id: "diversify",
    title: "한 종목 vs 시장 ETF",
    blurb: "개별 주식 변동성에 비해 S&P 500 ETF(SPY)는 더 안정적인 장기 경로를 보여줍니다.",
    tickers: ["AAPL"],
    weights: [1],
    benchmark: "SPY",
  },
];

export async function GET() {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 365 * 5 * 86_400_000).toISOString().slice(0, 10);

  try {
    const presets = await Promise.all(
      PRESETS.map(async (preset) => {
        const simulation = await simulateAllocation({
          tickers: preset.tickers,
          weights: preset.weights,
          start_date: start,
          end_date: end,
          initial_capital: 10_000,
          benchmark: preset.benchmark,
        });
        return { ...preset, simulation };
      }),
    );

    return NextResponse.json({
      ok: true,
      start_date: start,
      end_date: end,
      narrative: NARRATIVE,
      presets,
    });
  } catch (exc) {
    return NextResponse.json(
      {
        ok: false,
        error: exc instanceof Error ? exc.message : "Failed to build insights",
        narrative: NARRATIVE,
        presets: [],
      },
      { status: 500 },
    );
  }
}
