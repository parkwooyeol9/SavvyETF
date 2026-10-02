import { fmt, type AcwiSummary } from "@/lib/acwiAnalyzer";

import { Card } from "./parts";

export default function AcwiData({ A }: { A: AcwiSummary }) {
  const M = A.meta;
  const Q = A.quality as AcwiSummary["quality"] & Record<string, string | number | undefined>;
  const J = Object.entries(Q.jump_stocks ?? {});
  return (
    <div className="aa-view">
      <div className="aa-grid aa-g2">
        <Card title="이번 파일 점검 결과" sub={`${M.source} · 일간 ${Q.ri_first}~${Q.ri_last} · 월간 ${Q.eps_first}~${Q.eps_last}`}>
          <ul className="aa-note">
            <li>
              <b>EPS·BPS·DPS 시트 하단 잔여행 {Q.eps_stale_rows_dropped}행 제거</b> — 37개 월간 행 아래에 Price 시트 값(일간)이 그대로 남아 있었음. 날짜가
              처음 거꾸로 가는 행부터 자동 제거.
            </li>
            <li>
              조회 실패(#ERROR) 시리즈: Price {Q.ri_error_series} · EPS {Q.eps_error_series} · BPS {Q.bps_error_series} · DPS {Q.dps_error_series}{" "}
              (러시아·선물·현금성 등)
            </li>
            <li>RI 0 값 {Q.ri_zero_values}개 → 결측 처리 (BMPS 2023년 구간)</li>
            <li>
              하루 ±40% 이상 급변 {Q.ri_jumps}건 / {Q.ri_jump_stocks}종목.{" "}
              <b>마지막 날 급변: {(Q.last_day_jumps ?? []).join(", ") || "없음"}</b> → 스핀오프·분할 미조정 의심, 밸류·배당 지표 제외 처리
            </li>
            <li>
              거래정지 의심(최근 30일 중 20일 이상 무변동) {(Q.suspended ?? []).length}종목: {(Q.suspended ?? []).join(", ")}. 볼린저 %B는 비워 둠
            </li>
            <li>시계열 시작이 늦은 종목(상장·편입 후 데이터) {Q.ri_late_start}개</li>
            <li>
              <b>변동성</b>: 원자료 SDN#(X,1Y)는 현지 주가 수준의 표준편차라 USD 주가로 나누면 단위가 깨짐. RI 일간수익률로 다시 계산한 값과 순위상관{" "}
              {fmt(Q.vol_proxy_vs_ri_spearman, 2)} → 팩터의 변동성은 RI 기준으로 교체
            </li>
          </ul>
          <h4 className="aa-h4">급변 종목</h4>
          <p className="aa-mono aa-small">{J.map(([c, v]) => `${c} (${v.join(", ")}%)`).join(" · ")}</p>
        </Card>
        <Card title="계산 방법">
          <ul className="aa-note">
            <li>
              <b>기술적</b>: RI(배당 재투자 총수익지수, 현지통화) 일간. 수익률 1W~12M·YTD, 12-1M, 변동성(일간 로그수익률 SD×√252), MDD, 52주 고저,
              MA20/50/200 괴리, 골든/데드크로스(20일 내), RSI14(Wilder), MACD(12,26,9, 가격 대비 %), 볼린저 %B. 베타·상관 = 최근 104주 주간수익률 vs
              벤치마크(현지통화 기준이라 통화 효과 미포함).
            </li>
            <li>
              <b>추세점수 0~6</b>: 종가&gt;MA50, 종가&gt;MA200, MA50&gt;MA200, MACD&gt;시그널, 40≤RSI≤70, 3M 수익률&gt;0. 거래량·고저가가 없어 거래량
              지표는 없음.
            </li>
            <li>
              <b>EPS·BPS·DPS</b>: 12개월 선행(NTM) 월간. 리비전 = 1/3/6/12개월 변화율(양수→양수만). 브레드스 = 상향 비율−하향 비율.
            </li>
            <li>
              <b>근사 PER·PBR·배당 3년 위치</b>: 현재값 × 주가 상대변화 ÷ 추정치 상대변화. 주가 상대변화 = RI 변화 × (1+현재 배당수익률)^경과연수. 주가
              통화와 추정치 통화가 다르면 환율 변동만큼 오차.
            </li>
            <li>
              <b>팩터 모델</b> (v2 기준 + 시계열 반영):{" "}
              {Object.values(M.factors)
                .map((x) => `${x.label}(${x.descriptors.join(", ")})`)
                .join(" · ")}
              . 섹터×지역 중립 Z, 1/99% 윈저, ±3 절단.
            </li>
            <li>
              <b>변경점</b>: 모멘텀 = RI 12-1M을 <b>국가 중앙값 대비</b>로(고인플레 통화 왜곡 제거) + EPS 3M 리비전 추가. 변동성 = RI 일간수익률. 최근 10일
              ±40% 급변 종목은 밸류·배당 제외.
            </li>
            <li>
              <b>MSCI 연동</b>: 2013-08~2026-08 정기리뷰 53회 공개 리스트 → ISIN 기준 매칭. 이벤트 스터디는 시장조정 초과수익(종목−벤치마크). 편출 관찰 =
              국가 내 회사 단위 누적비중 꼬리(비중 동률은 묶음의 가운데 위치).
            </li>
            <li>
              <b>벤치마크</b>: 이 파일 종목의 ACWI 비중 × 현지통화 일간수익률. 통화 효과가 섞인 근사치.
            </li>
          </ul>
          <h4 className="aa-h4">다음 Datastream 요청 권장</h4>
          <ul className="aa-note">
            <li>변동성: SDN#(X,1Y) 대신 RI 시계열로 계산 중이라 열은 없어도 됨</li>
            <li>
              USD 기준 수익률이 필요하면 Price 시트를 <span className="aa-mono">X(RI)~U$</span>로 (현재 현지통화)
            </li>
            <li>MSCI 국가코드 열 추가, 구성종목을 최신 리뷰({M.latest_review}) 기준으로 갱신</li>
            <li>월간 시트는 새 시트에서 DSGRID를 실행해 잔여행이 생기지 않게</li>
          </ul>
        </Card>
      </div>
      <p className="aa-note">
        원자료: Datastream/Refinitiv(내부 리서치용, 공개 저장소·외부 게시 금지), MSCI 공개 편출입 리스트(고지문상 DB 생성 금지 → 내부용). 이 탭은
        관리자 로그인 시에만 보이며 데이터는 암호화된 상태로 저장됩니다.
      </p>
    </div>
  );
}
