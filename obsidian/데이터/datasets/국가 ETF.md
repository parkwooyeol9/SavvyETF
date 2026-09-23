---
type: dataset
id: country_etf
aliases: [국가ETF]
group: etf
kind: timeseries
volatile: false
retention: 티커별 스냅샷
view: countryetf
r2: country_etf/
tags: [dataset, etf, timeseries]
---

# 국가 ETF

국가·지역 ETF 노출. [[한국 상장 ETF]] 의 `country` 차원과 **별 시계열**입니다.

## 보존

`country_etf/{TICKER}/latest.json` · `snapshots/{날짜}.json`

## 관련

- [[한국 상장 ETF]] — 국내 상장 상품의 국가 분류
- [[미국 상장 ETF]] — `region` 차원

## 대시보드

[국가 ETF](https://savvyetf.vercel.app/?tab=countryetf)
