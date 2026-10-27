# 19. Cursor 인수인계 — AI 시황 탭 첫 화면에 Anthropic S-1 분석 추가 (2026-10-27)

- 작성: 2026-10-27 (Claude) · 받는 쪽: Cursor
- 대상 저장소: `/Users/wooyeol/GitHub/SavvyETF` (origin `parkwooyeol9/SavvyETF`, 브랜치 `main`)
- 기준 커밋: `a5a33bf`
- **Claude는 git을 쓰지 않았습니다.** 아래 파일은 작업 트리에 추가·수정만 된 상태입니다. 빌드 확인·커밋·푸시는 Cursor 몫입니다.

---

## 1. 무엇을 했나
AI 시황 탭(`?tab=aipulse`)의 하위 보기 맨 앞에 **"Anthropic S-1"** 을 넣고 기본 보기로 정했다.
페이지는 Anthropic이 2026-10-26 SEC에 낸 S-1을 원문 대조로 분석한 대시보드다. 탭은 성장·수익성·고객·컴퓨트·자금·지분·지배구조·리스크·언론 보도·원문 DB 8개이고, 차트는 ECharts다.

기존 보기(`economy`, `pulse`)와 같은 방식이다. 정적 HTML을 iframe으로 띄우고, 페이지가 `postMessage({type:"ai-pulse-height"})`로 높이를 알려 준다.

| 항목 | 내용 |
|---|---|
| 데이터 | 페이지 안에 JSON으로 들어 있음(고정 스냅샷, 약 190KB). `/api/ai-pulse`·R2·봇 스케줄러와 무관 |
| 테마 | `?theme=dark&embed=1`에서 사이트 다크 색(파랑 `#3987e5`·회색·주황)으로 그림. 배경 투명, 헤더·여백 축소, 탭 메뉴 sticky 해제 |
| 외부 요청 | 없음. 사이트 CSP(`script-src 'self'`)가 CDN을 막아 ECharts 5.5.1을 `public/ai-pulse/vendor/`에 두고 같은 출처로 불러옴 |
| 출처 원본 | `~/GitHub/SavvyDB/Anthropic_S1/` (git 밖). DB `2_결과물/anthropic_s1.db`, 빌드 `4_코드/04_build_html.py` |

## 2. 커밋 대상 파일
| 파일 | 변경 |
|---|---|
| `webapp/public/ai-pulse/anthropic-s1.html` | **신규.** S-1 분석 페이지(사이트용 빌드) |
| `webapp/public/ai-pulse/vendor/echarts-5.5.1.min.js` | **신규.** ECharts 5.5.1 (jsdelivr `echarts@5.5.1/dist` 원본 그대로, Apache-2.0, 1.0MB, sha256 앞 16자리 `e84270bd0cd5bdf6`) |
| `webapp/src/components/AiPulseTab.tsx` | 보기 `anthropic-s1` 추가(맨 앞) · 기본값을 `anthropic-s1`로 · `isView()`로 `?view=`·저장값 검사 · iframe `title`을 VIEWS 라벨에서 가져옴 · 저장 키를 `aiPulse.view` → `aiPulse.view.v2`로 바꿈(예전에 `economy`를 고른 브라우저도 처음 한 번은 S-1이 먼저 보이게) |
| `Claude_DB/docs/19_Cursor_인수인계_AI시황_AnthropicS1.md` | 이 문서 |

`globals.css`·`types.ts`·`Dashboard.tsx`·middleware는 건드리지 않았다. 버튼은 기존 `.ap-view` 스타일 그대로다.

## 3. 검증한 것
- `webapp`에서 `npx tsc --noEmit -p .` → 오류 0
- iframe 테스트(같은 출처 정적 서버, 부모 창이 사이트와 같은 `ai-pulse-height` 리스너):
  - `?theme=dark&embed=1`로 열림, 차트 SVG 렌더, 콘솔 오류 없음
  - 높이 메시지 수신: 첫 화면 2,315px → '언론 보도' 탭 전환 시 3,988px로 iframe 높이가 따라 바뀜
- 페이지 안 스크립트는 인라인·같은 출처뿐 → 현 CSP(`'self' 'unsafe-inline'`)와 `X-Frame-Options: SAMEORIGIN`에서 그대로 동작할 것으로 봄

## 4. 검증하지 못한 것 / 확인 요청
1. **`npm run build`와 `next lint` 미실행.** `npx eslint`는 설정 마이그레이션 안내만 내고 끝났다. 빌드·린트를 Cursor에서 돌려 줄 것.
2. **실제 Next 개발 서버 안에서의 확인.** `npm run dev` → `http://localhost:3000/?tab=aipulse`에서 아래를 본다.
   - 버튼 순서: Anthropic S-1 · AI 경제 침투 · 구루·개발자·채용
   - 첫 진입 시 S-1이 열림
   - 다른 보기로 갔다가 새로고침하면 마지막 선택이 유지됨
   - `?tab=aipulse&view=economy` 직접 링크가 그대로 동작함
   - S-1 페이지 내부 탭을 전환할 때 iframe 높이가 따라옴(잘리거나 큰 빈칸이 생기지 않음)
   - 모바일 폭(375px)에서 가로 스크롤이 생기지 않음
3. **CopyGuard.** 부모 창의 `user-select:none`은 iframe 안에 적용되지 않는다(기존 `economy`·`pulse`와 같음). 막아야 한다면 별도 작업으로 할 것.
4. **번들 크기.** `vendor/echarts-5.5.1.min.js`(1.0MB)는 S-1 보기를 열 때만 내려받는다. 정적 파일이라 Vercel CDN 캐시가 적용된다. 첫 화면이 S-1이므로 AI 시황 탭 첫 진입이 조금 무거워진다.

## 5. 커밋·배포 방법

```bash
cd /Users/wooyeol/GitHub/SavvyETF/webapp
npm run build          # 통과 확인
npm run dev            # 4-2 항목 눈으로 확인 후 종료

cd /Users/wooyeol/GitHub/SavvyETF
git add webapp/public/ai-pulse/anthropic-s1.html \
        webapp/public/ai-pulse/vendor/echarts-5.5.1.min.js \
        webapp/src/components/AiPulseTab.tsx \
        "Claude_DB/docs/19_Cursor_인수인계_AI시황_AnthropicS1.md"
git commit -m "feat(ai-pulse): add the Anthropic S-1 analysis as the first AI 시황 view"
git push origin main   # Vercel 자동 배포
```

이번 범위 밖(건드리지 말 것): `Claude_DB/docs/08_…`(수정 상태), `11_…`·`12_…` 인수인계서, `research/*`(ai_report·anthropic_ipo·intro_deck·rebalance_whitepaper), `.next/`, `00_exports/`, `11_받은자료/`.

## 6. 배포 후 확인 (완료 기준)
- `https://savvyetf.com/ai-pulse/anthropic-s1.html?theme=dark&embed=1`가 200으로 열리고, 개발자도구 콘솔에 CSP 위반이 없음
- `https://savvyetf.com/ai-pulse/vendor/echarts-5.5.1.min.js`가 200
- `https://savvyetf.com/?tab=aipulse`에서 첫 보기가 Anthropic S-1이고, 8개 내부 탭이 모두 그려짐

## 7. 나중에 내용을 고칠 때
페이지는 SavvyDB에서 만든다. HTML을 직접 고치지 말고, 원본을 고친 뒤 다시 빌드한 결과를 커밋한다.

```bash
cd ~/GitHub/SavvyDB/Anthropic_S1
./run.sh                                   # DB·로컬 대시보드 재생성 (수치: 4_코드/s1_data.py, press_data.py)
python3 -I 4_코드/04_build_html.py . --site ~/GitHub/SavvyETF/webapp/public/ai-pulse
```

`--site`는 `anthropic-s1.html`과 `vendor/echarts-5.5.1.min.js`를 다시 쓴다. 수정 S-1(S-1/A)이 나오면 `s1_data.py`의 값과 인용문을 바꾸고 위 두 줄을 실행한다.

## 8. Cursor 검토 (2026-10-27)
`Dashboard.tsx`가 `?view=`를 `pulse`·`economy`만 남기고 있어서 `view=anthropic-s1`은 새로고침 때 주소에서 빠졌다. 허용 목록에 `anthropic-s1`을 넣었다. `npm run build`는 통과했고, 로컬에서 8개 내부 탭 차트·보기 전환·375px 가로 넘침 없음을 확인했다.
