---
type: dataset
id: cftc
aliases: [CFTC]
group: monitor
kind: timeseries
volatile: false
retention: latest + 일별 스냅샷
view: cftc
r2: cftc/
tags: [dataset, monitor, timeseries]
---

# CFTC 포지션

선물 managed money net 등. Position 패밀리. `cftc/latest_v2.json` + `cftc/snapshots/{날짜}.json`.

## 관련

- [[글로벌 자금 흐름]] — 같은 Position 가족, 합산은 각각의 정의로만
- [[한국 상장 ETF]] 수급과 금지

## 대시보드

[CFTC](https://savvyetf.vercel.app/?tab=cftc)
