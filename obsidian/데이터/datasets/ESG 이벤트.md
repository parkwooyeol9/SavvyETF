---
type: dataset
id: esg_events
aliases: [ESG 모니터]
group: monitor
kind: timeseries
volatile: false
retention: latest + 일별 스냅샷
view: esg
r2: esg_events/
tags: [dataset, monitor, timeseries]
---

# ESG 이벤트

공시·사고 모니터 번들. [[시황 브리프]] ESG 슬롯과 **다른 R2 키**입니다.

`esg_events/latest.json` + `snapshots/{YYYY-MM-DD}.json`.

## 대시보드

[ESG 시황](https://savvyetf.vercel.app/?tab=esg)
