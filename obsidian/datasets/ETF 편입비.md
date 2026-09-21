---
type: dataset
id: etf_weights
aliases: [편입비 모니터]
group: etf
kind: timeseries
volatile: false
retention: 티커별 스냅샷
view: etfweights
r2: etf_weights/
tags: [dataset, etf, timeseries]
---

# ETF 편입비

Roundhill ALL + iShares 상위 펀드의 구성비 모니터.

## 무엇을 담나

티커별 latest와 일자 스냅샷. **수급이 아니라 홀딩 비중.**

## 보존

`etf_weights/{TICKER}/latest.json` · `etf_weights/{TICKER}/snapshots/{날짜}.json` · `etf_weights/universe.json`  
자동 삭제 없음.

## 관련

- [[한국 상장 ETF]] · [[미국 상장 ETF]] 수급과 별개
- [[코스닥 액티브 ETF]] 도 구성 스냅샷이지만 PDF 출처

## 대시보드

[편입비 모니터](https://savvyetf.vercel.app/?tab=etfweights)
