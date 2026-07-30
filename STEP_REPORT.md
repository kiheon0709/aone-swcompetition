# Aone 야간 배치 실행 기록

`AONE_야간배치_지시.md` 1~10단계 수행 결과. 단계가 끝날 때마다 append 한다.

---

## 1단계 — 배포

**커밋** — `78d38a0` (선행 정리), 배포는 코드 변경 없음
**배포 URL** — https://aone-five.vercel.app (별칭) / https://aone-1gw49cnbj-ghdrlgjs11-4877s-projects.vercel.app

### projectName 대조 (멈춤 조건)

```
=== aone-app/.vercel/project.json ===
{"projectId":"prj_F5uHTcEzZbHhBTEyyKblmgQa8I0E","orgId":"team_jf23pYFkCedREpl3ym4l7DCW","projectName":"aone"}
=== out/.vercel/project.json ===
{"projectId":"prj_F5uHTcEzZbHhBTEyyKblmgQa8I0E","orgId":"team_jf23pYFkCedREpl3ym4l7DCW","projectName":"aone"}
=== diff ===
IDENTICAL
```

`[O]` **projectName 일치 — 멈춤 조건 미발동**

주의할 점: `out/.vercel/`은 처음에 **없었다.** `npm run build`가 `out/`을 통째로 재생성하면서 지워진다.
이 상태로 `out/`에서 `vercel --prod`를 돌리면 CLI가 디렉터리명(`out`)으로 **새 프로젝트를 만든다.**
지난번에 다른 프로젝트로 올라간 원인이 이것이다. 그래서 배포 직전에 검증된 `aone-app/.vercel`을
`out/`으로 복사해 **우연이 아니라 구조적으로** 같게 만든 뒤 배포했다.

### 빌드

```
✓ Compiled successfully in 4.7s
✓ Generating static pages (6/6)
✓ Exporting (2/2)

Route (app)                                 Size  First Load JS
┌ ○ /                                    81.7 kB         190 kB
├ ○ /_not-found                            993 B         104 kB
├ ○ /debug/figures                       2.85 kB         105 kB
└ ○ /settings/engines                    5.91 kB         114 kB
+ First Load JS shared by all             103 kB
```

`out/` 71MB, 배포 파일 157건. `/debug/figures`가 그대로 export된다 → 2단계 대상.

### 배포 로그

```
Building: Restored build cache from previous deployment (GAKSNeFAr3hg2oXm4sPqDt2wcvwS)
Building: Build Completed in /vercel/output [564ms]
Production: https://aone-1gw49cnbj-ghdrlgjs11-4877s-projects.vercel.app
Aliased: https://aone-five.vercel.app
```

별칭이 `aone-five.vercel.app`로 정상 연결됐다 = 올바른 프로젝트.

### 배포 URL 실측 검증

| 항목 | 판정 | 실측 근거 |
|---|---|---|
| 시험대비 → 개념 카드 → 발화 시각 근거 클릭 → 전사본 뷰어 이동 + 포커스 | `[O]` | `{"blocks":39,"focused":"t-03:38"}` — 근거 `1주차 03:38` 클릭 후 뷰어 39블록 렌더, 해당 블록 `data-focused="1"` |
| 페이지 근거 클릭 → 슬라이드 리더 이동 | `[X]` | **아래 별도 항목 참조 — 클릭 자체가 불가능하다** |
| 슬라이드 리더 렌더 (위 항목의 리더 쪽 절반) | `[O]` | 데통 3주차 `(이론) 3-…-아날로그-소리-변환.pdf` → 슬라이드 설명 탭: `canvas` 18개, 페이지 표시 `1 / 17` |
| 홈 렌더 | `[O]` | 주간 시간표(7/27~7/31 강의 블록), 다가오는 시험 3건(D-Day·D-5·D-12), 이번 주 과제 3건 |
| 학습 가이드 렌더 | `[O]` | "학기 전체" 요약문, 학습 경로 5단계(주파수→대역폭→모스 부호→변조/복조→QAM), `이번 시험 핵심 20개 (전체 92개 중)` |
| 폴더 뷰 렌더 | `[O]` | 데통 3주차: 파일 4개, `개념 53개 정리 · 교수님 강조 43곳 · 퀴즈 8개`, 카드 4장 |
| 콘솔 에러 0건 | `[O]` | 프로덕션 전체 훑은 뒤 `read_console_messages` → **"No console messages found"** (0건) |
| 데통 3주차 `1:08:12` — 블록 이동 O, 하이라이트 X | `[O]` | 아래 별도 항목 |

### `[X]` 페이지 근거 클릭 → 슬라이드 리더 : 그 경로가 존재하지 않는다

지시서에 적힌 동작인데, 실측 결과 **페이지 근거는 클릭 가능한 요소가 아니다.**

데통 시험대비 전체 범위에서 개념 카드 20개를 모두 펼쳐 근거를 전수 수집한 결과 (19종):

```
버튼(클릭 가능, 발화 시각/줄번호) 18건:
  근거 · 1주차 03:38 →      근거 · 1주차 14:58 →     근거 · 2주차 03:20 →
  근거 · 3주차 31:34 →      근거 · 3주차 54:47 →     근거 · 4주차 48:40 →
  근거 · 2주차 21:25 →      근거 · 2주차 29:39 →     근거 · 3주차 1:18:57 →
  근거 · 2주차 11:38 →      근거 · 3주차 53:32 →     근거 · 1주차 08:04 →
  근거 · 1주차 40:23 →      근거 · 4주차 17:54 →     근거 · 5주차 #L529 →
  근거 · 1주차 02:21 →      근거 · 7주차 #L1 →       (외 1건)

일반 텍스트(클릭 불가, 페이지) 2건:
  근거 · 2주차 (이론) 1-1-데이터통신-layer-packet-signal-공개 p.6
  근거 · 1주차 (실습) week1_WireShark.pptx p.7
```

원인은 버그가 아니라 **FIX 14의 설계**다. `ExamPrep.tsx`가 `parseConceptSource`로
locator를 해석해 성공하면 `<button>`, 실패하면 기존 회색 텍스트를 그대로 둔다.
`lib/transcript.ts:70`의 `parseConceptSource`는 `locatorToAnchor`가 받는
시각(`02:21`·`1:20:06`)과 줄번호(`#L75`)만 앵커로 바꾸고, `p.6` 같은 페이지 locator는 `null`을 반환한다.
즉 FIX 14는 **전사본 연결만** 구현했고 페이지→슬라이드 연결은 범위에 없었다.

슬라이드 리더를 여는 코드 경로는 따로 있다 — `page.tsx:1703 openDocReader` → `setPendingDocOpen`.
호출자는 `page.tsx:1703` 주석대로 **"토스트 클릭 네비"**(분석 완료 토스트 → 문서 리더)이고,
개념 근거에서 이 함수를 부르는 곳은 없다.

**임의로 만들지 않고 사실만 기록한다.** 슬라이드 리더 자체는 정상 동작하므로(위 표 3행)
"근거를 눌러 슬라이드로 간다"만 미구현이다. 10단계(FIX 10)에서 리더가 탭 전환에도 살아남게 되면
같은 화면에서 전사본·슬라이드를 나란히 볼 수 있으니, 그때 페이지 근거를 버튼으로 승격하는 것이 자연스럽다.
지금 단계에서 손대면 10단계와 충돌하므로 **10단계에서 함께 처리한다.**

### `1:08:12` 귀속 오류 — 의도된 동작 눈으로 확인 (고치지 않음)

먼저 이 근거가 어디에 있는지: 개념 카드 evidence가 아니라
`docs_데이터통신__3주차.json` → `bySource.transcript.emphasis[8]`에 있다.

```json
{"quote": "그 알 수 있게 해주는 수학적인 도구가 프레이 변화는 이게 왜 중요하냐 사실 모든 통신이 다 써요.",
 "locator": "1:08:12", "concept": "푸리에 변환"}
```

전사본 원문(`goldset/데이터통신/3주차/transcript.txt`) 실측:

```
QUOTE at line 532
HEADER 1:06:54 at line 527
HEADER 1:08:12 at line 534
```

인용문은 532줄 = `1:06:54` 블록(528~533줄) 안에 있는데 저장된 locator는 다음 헤더 `1:08:12`(534줄)을 가리킨다.

배포 URL 실측 (데통 3주차 → PDF 열기 → **녹음·필기** 탭 → `transcript.txt`):

```json
{"viewer":true,"blocks":89,
 "t10812":{"exists":true,"emphasized":true,"marks":0,
           "text":"1:08:12참석자 1교수님 강조이 소설에 그냥 재미삼아 쓴 게 아니고 여러분이 쓰고 있는 지금 와이파이…"},
 "t10654":{"exists":true,"emphasized":false,"marks":0,"hasQuote":true},
 "totalMarks":11}
```

- `t-1:08:12` — 블록 존재, 강조 배경(`bg-amber-50/80`) + "교수님 강조" 라벨 붙음, **`<mark>` 0개**
- `t-1:06:54` — **인용문을 실제로 갖고 있다**(`hasQuote: true`)는데 하이라이트는 안 붙음
- 같은 전사본의 나머지 강조 11건은 정상 하이라이트

`[O]` **블록 이동은 되고 하이라이트는 붙지 않는다 — 지시대로 고치지 않았다.** 9단계에서 L4 층에서 잡는다.

### 부수 발견 (기록만, 이번 단계에서 손대지 않음)

1. **전사본 렌더 경로가 두 개다.** 폴더 뷰 **자료** 탭에서 `transcript.txt`를 열면
   `page.tsx:5085` `docBody.kind === "plain"` 경로를 타서 **블록 없는 원문 한 덩어리**로 나온다
   (`<p>` 1개, 33,614자, 우측 패널 "교수 강조 · 0 / 강조 인용이 없습니다").
   블록 뷰어(`TranscriptViewer`, `page.tsx:5701`)는 **녹음·필기** 탭에서만 뜬다.
   같은 파일인데 들어온 문(門)에 따라 화면이 다르다. 헤더 89개가 정상 매칭되므로 파서 문제는 아니다.

2. **dev 서버에서만 나는 React 경고** — `useEffect` 의존성 배열 크기가 렌더 간 변한다
   (`[…6개] → […2개]`). 프로덕션 콘솔은 0건이었지만 원인은 실제 코드에 있다. 6단계 재배포 때 다시 본다.

3. `d35e907`에서 스냅샷 백업 폴더 **삭제 31건이 스테이징되지 않았다**(`.gitignore`만 커밋됨).
   `78d38a0`으로 실제 반영했다.

---

## 2단계 — `/debug/figures` 배포 제외

**커밋** — `PENDING`

### 사전 확인 — 정말 미참조인가

```
=== who references slide-figures ===
app/debug/figures/page.tsx:11:import { extractFigures, type SlideFigure } from "@/lib/slide-figures";
=== who references debug/figures ===
(none)
```

`lib/slide-figures.ts`를 쓰는 곳은 이 디버그 페이지 하나뿐이고, 이 페이지를 링크하는 곳은 없다.
지시서의 "코드 어디서도 참조되지 않는다"가 실측으로 맞다.

### 택한 방법과 이유

`app/debug/figures/page.tsx` → **`app/_debug/figures-page.tsx`로 이동**했다.

Next App Router는 **밑줄로 시작하는 폴더(`_debug`)를 private folder로 보고 라우트로 잡지 않는다.**
그래서 `next build`가 아예 export하지 않는다. 고른 이유:

- **"페이지만 제거"보다 나은 점** — 파일을 지우면 FIX 12를 이어서 할 때 디버그 화면을 다시 짜야 한다.
  이동은 코드를 100% 보존하면서 라우트만 없앤다.
- **"개발 환경에서만 열리게"보다 나은 점** — `output: "export"`는 정적 산출물이라 런타임 환경 분기가 없다.
  `process.env.NODE_ENV`로 가려도 **HTML은 그대로 export되어 URL이 살아 있다.**
  즉 "가리는 방식"이라 외부 노출이 실제로 안 없어진다. 반면 private folder는 산출물 자체가 안 생긴다.
- 되돌리는 방법을 파일 헤더 주석에 적어뒀다 (`app/debug/figures/page.tsx`로 되돌리면 `/debug/figures` 부활).

**그림 추출 로직은 손대지 않았다** — `lib/slide-figures.ts` 242줄 그대로.

### 완료 기준

| 항목 | 판정 | 실측 근거 |
|---|---|---|
| 라우트 목록에서 사라짐 | `[O]` | 빌드 로그 라우트가 4개→3개. `Generating static pages (6/6)` → `(5/5)`. `/debug/figures` 줄 없음 |
| `out/`에 debug 경로 없음 | `[O]` | `ls out/debug` → `No such file or directory`. `find out -ipath "*debug*"` → **0건** |
| 추출 로직 보존 | `[O]` | `wc -l lib/slide-figures.ts` → `242` |
| 타입 검사 통과 | `[O]` | `npx tsc --noEmit` exit 0 |

빌드 로그:

```
✓ Generating static pages (5/5)
✓ Exporting (2/2)

Route (app)                                 Size  First Load JS
┌ ○ /                                    81.7 kB         190 kB
├ ○ /_not-found                            993 B         104 kB
└ ○ /settings/engines                    5.91 kB         114 kB
```

배포는 6단계에서 3~5단계 결과와 함께 한 번에 한다 (지시서 6단계가 재배포를 담당).

---
