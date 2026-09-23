---
type: dataset
id: etf_db
aliases: [한국 ETF DB, KR ETF, etfdb]
group: etf
kind: timeseries
volatile: false
retention: 90일 핫 + archive
view: etfdb
r2: etf_db/
tags: [dataset, etf, timeseries]
---

# 한국 상장 ETF

Naver 상장 ETF 전 종목의 유형·국가·업종·지수 분류와 AUM, **NAV×Δ설정좌수** 추정 수급.

## 무엇을 담나

일별 스냅샷. 코드, 이름, NAV, 설정좌수, AUM(억원), 당일 추정 수급.

차원: `type` · `country` · `sector` · `index` (+ `index_style` 일반/레버/인버스)

## 스키마 (행)

`code` `name` `type` `country` `sector` `index` `index_style` `benchmark` `price` `nav` `aum_eok` `units` `flow_eok`

수급 단위는 억원. **공시 자금이 아님.**

## 보존

- 핫: `etf_db/latest.json` · `etf_db/snapshots/{날짜}.json` (90일)
- 아카이브: `etf_db/archive/{날짜}.json`
- 스케줄: 평일 18:20 KST

## 관련

- 같은 수급 공식: [[미국 상장 ETF]]
- 합산 금지: [[글로벌 자금 흐름]] · [[CFTC 포지션]]
- 구성비는 별 테이블: [[ETF 편입비]]

## 대시보드

[한국 상장 ETF](https://savvyetf.vercel.app/?tab=etfdb)
