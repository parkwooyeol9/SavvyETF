---
type: dataset
id: etf_db_us
aliases: [미국 ETF DB, US ETF, etfdbus]
group: etf
kind: timeseries
volatile: false
retention: 스냅샷 전량
view: etfdbus
r2: etf_db_us/
tags: [dataset, etf, timeseries]
---

# 미국 상장 ETF

분류된 미국 상장 ETF 유니버스 + Yahoo 지표. [[한국 상장 ETF]] 와 차원을 맞춰 두었습니다.

## 무엇을 담나

AUM($M), 거래대금, **NAV×Δshares** 추정 수급.

차원: `type` · `region` · `sector` · `theme`

카테고리 장기 차트 일부는 스냅샷이 아니라 Yahoo 가격으로 재구성합니다.

## 스키마 (행)

`symbol` `name` `type` `region` `sector` `theme` `price` `nav` `aum_mn` `units` `volume` `turnover_mn` `flow_mn`

## 보존

`etf_db_us/latest.json` · `etf_db_us/snapshots/{날짜}.json`  
자동 prune 없음. 스냅샷 prefix가 곧 보존본.

## 관련

- [[한국 상장 ETF]]
- 거래대금·수급을 [[글로벌 자금 흐름]] 과 더하지 말 것

## 대시보드

[미국 상장 ETF](https://savvyetf.vercel.app/?tab=etfdbus)
