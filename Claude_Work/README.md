# Claude_Work · ETF 리밸런싱 모니터

국내 주식형 ETF의 **정기변경 일정**, **예상 매매 규모**, **충격받는 종목**을 계산하고 한 화면에서 보는 작업 공간입니다.
SavvyETF 본체(봇·웹앱)와 분리돼 있어서, 이 폴더만 커밋해도 기존 배포에 영향이 없습니다.

```
Claude_Work/
├── rebalance/
│   ├── kcal.py      KRX 거래일 · 옵션 만기일 · 정기변경 효력일 · 매매일 계산
│   ├── engine.py    목표비중(고정 비중 · Cap 재배분) → 예상 매매, 종목별 합산 · 충격도
│   ├── fetch.py     보유비중(ETF CHECK → 네이버) · 순자산 · 20일 거래대금(yfinance) 수집
│   └── build.py     위를 묶어 out/rebalance.json + web/data.js 생성 (--publish 로 R2 적재)
├── data/
│   ├── universe.json           ETF 23개(지수 2 포함): 정기변경 월 · 규칙 · Cap · 시나리오
│   ├── holdings/{코드}/{날짜}.json  보유비중 스냅샷 (봇이 거래일마다 갱신)
│   ├── adv.json                종목별 20일 평균 거래대금(억원) — fetch 가 채움
│   └── holidays.json           kr_calendar.py 에 없는 휴장일 보충 (2027-01-01)
├── web/
│   ├── index.html   분석 화면 (브라우저로 바로 열림, 서버 불필요)
│   └── data.js      build 결과 (화면이 읽는 데이터)
└── tests/test_rebalance.py
```

## 실행 (저장소 루트에서, `.venv` 활성화)

```bash
# 1) 보유비중·순자산·거래대금 수집 후 화면 데이터까지 생성
python -m Claude_Work.rebalance.fetch --build

# 2) 데이터만 다시 계산 (네트워크 없음)
python -m Claude_Work.rebalance.build                  # 오늘 기준 4개월
python -m Claude_Work.rebalance.build --as-of 2026-10-01

# 3) 화면 열기
open Claude_Work/web/index.html

# 테스트
python -m unittest discover -s Claude_Work/tests -t .
```

`fetch` 는 저장소 루트의 `etfcheck_client.py`, `dart_etf_memb.py` 를 그대로 씁니다(코스닥 액티브 모니터와 같은 경로).
기본은 규칙이 확인된 ETF(시나리오가 있는 5개)만 수집하고, `--all` 이면 유니버스 전체, `--codes 396500 0167A0` 처럼 지정할 수도 있습니다.

## 화면

| 영역 | 내용 |
|---|---|
| 상단 지표 | 다음 매매일(D-n), 최대 매매일, 선택일 최대 순매매 종목, 계산 커버리지 |
| 매매일 캘린더 | 매매일별 정기변경 ETF 수·순자산 합계, 옵션만기·지수 정기변경 표시 |
| 종목별 예상 순매매 | 선택일 ETF 매매를 종목 단위로 합산, 거래대금 대비 비율(10%↑ 빨강, 3%↑ 노랑) |
| 정기변경 ETF | 선택일 ETF 목록, 규칙·효력일·Cap·계산 상태 |
| ETF별 상세 | 현재 → 목표 비중, 예상 매매. 시나리오가 둘 이상이면 라디오로 전환 |

## 계산 규칙

**일정.** 옵션 만기일은 매월 둘째 목요일(휴장이면 앞당김)입니다. 정기변경 효력일은 규칙 코드로 정합니다.

| 코드 | 효력일 |
|---|---|
| `D` | 만기일 당일 |
| `D+1` | 만기 익영업일 |
| `D+2` | 만기 다음 주 첫 영업일 |
| `S` | 해당 월 첫 영업일 |
| `E` | 해당 월 마지막 영업일 |

매매일은 효력일 직전 영업일 종가로 봅니다. `D+3`, `E+10` 은 정의를 확인하지 못해 일정 계산에서 뺐습니다.

**매매 규모.**
1. `fixed` 종목은 그 비중으로 맞춥니다. 예: SOL AI반도체TOP2플러스의 삼성전자·SK하이닉스 25% (나머지 종목은 `cap` 15%).
2. 현금 비중은 유지합니다.
3. 나머지 종목은 현재 비중에 비례해 나누고, Cap 초과분은 다시 비례 배분합니다.
4. 금액은 순자산 × (목표 − 현재) 비중입니다.

3번은 가정입니다. 실제 지수는 시가총액·스코어로 다시 가중할 수 있고, 종목 편출입은 반영하지 않습니다.

## 새 ETF·규칙 추가

`data/universe.json` 의 `etfs` 에 항목을 넣습니다. 계산하려면 `cap_pct` 와 `scenarios` 가 필요합니다.

```json
{"code": "396500", "months": [4, 10], "rule": "D+2", "cap_pct": 25,
 "scenarios": [{"id": "cap", "label": "Cap 25% 조정", "fixed": {}, "cap": 25}]}
```

## 알려진 한계

- **보유비중 데이터:** 시나리오가 있는 5개 ETF(TIGER 반도체TOP10, SOL AI반도체TOP2플러스, TIGER 코리아휴머노이드로봇산업, TIGER 화장품, SOL AI반도체소부장)의 10/1 보유비중이 들어 있습니다.
- **상위 종목만 수집:** ETF CHECK 는 상위 10종목만 줍니다. 비중 합계가 95% 미만이면(로봇 85%, 화장품 90%, 소부장 74%) 화면에 경고가 뜹니다. 네이버 구성자산 대체 경로는 일부 종목에서 표를 찾지 못합니다.
- **휴장일 목록:** `kr_calendar.py` 에 2027년 휴장일이 없습니다. 새해 KRX 휴장일이 공표되면 `kr_calendar.py` 나 `data/holidays.json` 에 추가해야 합니다.
- **SOL AI반도체TOP2플러스의 10월 일정:** 운용사 표현은 "만기일 이후 2영업일"입니다. 연휴 때문에 이 해석으로는 10/13 효력·10/12 매매가 될 수 있어 확인이 필요합니다.
## 웹앱 연결 (ETF → 리밸런싱 탭)

- **탭:** `webapp/src/components/RebalanceTab.tsx`. `lib/types.ts` 의 `NAV_GROUPS` → `etf` 맨 오른쪽 `rebal` 묶음. `/?tab=rebalance` 로 바로 열 수 있습니다.
- **API:** `webapp/src/app/api/rebalance/route.ts` 가 R2 `rebalance/latest.json` 과 번들 `webapp/src/lib/rebalanceSnapshot.json` 중 `generated_at` 이 새것을 돌려줍니다.
- **번들 스냅샷:** `build` 를 실행할 때마다 `rebalanceSnapshot.json` 도 갱신됩니다. 커밋·배포하면 R2 없이도 화면이 뜹니다.
- **데이터 카탈로그:** `lib/dataCatalog.ts` 에 `rebalance` 등록.

## 남은 일

- **봇 스케줄러:** `rebalance_scheduler.py` 를 만들어 정기변경 월 만기일 D-5부터 매일 `fetch.main(["--build"])` 와 `build --publish` 로 R2 를 갱신합니다. 그 전까지는 로컬에서 `fetch --build` 후 `build --publish` 또는 번들 스냅샷 커밋으로 갱신합니다.
