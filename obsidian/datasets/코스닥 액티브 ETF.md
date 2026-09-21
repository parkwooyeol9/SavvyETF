---
type: dataset
id: kosdaq_active
aliases: [코스닥액티브]
group: etf
kind: timeseries
volatile: false
retention: 펀드별 스냅샷
view: kosdaqactive
r2: kosdaq_active/
tags: [dataset, etf, timeseries]
---

# 코스닥 액티브 ETF

장마감 PDF 스냅샷으로 액티브 펀드 편입·성과를 비교합니다.

## 보존

`kosdaq_active/{TICKER}/latest.json` · `snapshots/{날짜}.json` · `compare/latest.json` · `universe.json`

## 관련

- [[ETF 편입비]] — 출처가 다름 (PDF vs Filepoint/Yahoo)
- [[코스닥100]] — 지수 모니터 일별 스냅샷, 이 노트는 펀드 시계열

## 대시보드

[코스닥 액티브](https://savvyetf.vercel.app/?tab=kosdaqactive)
