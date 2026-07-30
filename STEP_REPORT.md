# Aone 야간 배치 실행 기록

`AONE_야간배치_지시.md` 1~10단계 수행 결과. 단계가 끝날 때마다 append 한다.

---

## 1단계 — 배포

**커밋** — `deeec9b` (이 보고서) / `78d38a0` (선행 정리). 배포 자체는 코드 변경 없음
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

**커밋** — `097984f`

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

## 3단계 — 파이프라인 가중치 단일화

**커밋** — `PENDING3`

### 1. 사본이 어떤 경로로 만들어지는가 — **빌드 스크립트다** (손으로 넣은 게 아니다)

`scripts/stage-sidecar.sh:36`:

```bash
# 2) pipeline (소스+의존성, 데이터·로그 제외)
rsync -a \
  --exclude "aone.db*" --exclude "*.log" --exclude ".DS_Store" \
  --exclude "exports/" --exclude "node_modules/.cache" \
  "$ROOT/pipeline/" "$DEST/pipeline/"
```

`DEST`는 `aone-app/src-tauri/resources`. 즉 `.dmg` 빌드 전에 이 스크립트가
`pipeline/`을 통째로 rsync해서 사본을 만든다. 근거 3가지:

- `.gitignore:17`에 `aone-app/src-tauri/resources/` — **git 추적 대상이 아니다.** `git ls-files`가 0건.
  그래서 `git log --follow`로 사본 이력이 아예 안 나온다(= 손으로 커밋한 파일이 아니다).
- 파일 시각: 사본 `Jul 14 22:36`, 개발본 `Jul 21 21:49`. 포화 수정 커밋 `a92015b`가
  7/21에 개발본에만 들어갔고, **그 뒤로 스테이징을 안 돌렸다.**
- `tauri.conf.json:51`의 `"resources": ["resources"]`가 이 폴더를 번들에 싣고,
  `src-tauri/src/lib.rs:46`이 런타임에 `resources/pipeline`을 찾아 `AONE_PIPELINE_DIR`로 주입한다.

**결론** — 이중화는 설계상 의도된 스테이징이고, 문제는 "구조"가 아니라 **스테이징을 잊은 것**이다.
그래서 큰 구조 변경은 하지 않았다(지시서 3-3의 "최소 침습").

### 어긋난 범위가 가중치보다 넓었다

지시서는 가중치 4개를 지적했지만, 실측하니 **`src` 트리 전체가 1주일 뒤처져 있었다.**

```
Files pipeline/src/adapters/llm.ts and …/resources/pipeline/src/adapters/llm.ts differ
Files pipeline/src/cli.ts and …/resources/pipeline/src/cli.ts differ
Files pipeline/src/config.ts and …/resources/pipeline/src/config.ts differ
Files pipeline/src/db.ts and …/resources/pipeline/src/db.ts differ
Files pipeline/src/layers/l1-normalize.ts and …/resources/pipeline/src/layers/l1-normalize.ts differ
Files pipeline/src/layers/l2-knowledge.ts and …/resources/pipeline/src/layers/l2-knowledge.ts differ
Only in pipeline/src/layers: l3-prereqs.ts
Only in pipeline/src/layers: l3-transcript-match.ts
Files pipeline/src/layers/l4-artifacts.ts and …/resources/pipeline/src/layers/l4-artifacts.ts differ
Files pipeline/src/orchestrator.ts and …/resources/pipeline/src/orchestrator.ts differ
Files pipeline/src/paths.ts and …/resources/pipeline/src/paths.ts differ
```

`.ts` 파일 수 18개 vs 16개 — **L3 레이어 2개(`l3-prereqs.ts`·`l3-transcript-match.ts`)가 사본에 아예 없었다.**
데스크톱 앱은 포화된 점수만 쓴 게 아니라 **선수개념·전사본 매칭 기능이 빠진 파이프라인**을 갖고 있었다.
가중치만 손으로 고치면 이 두 파일은 계속 없는 상태로 남으므로, 스크립트와 같은 방식(rsync)으로 전체를 맞췄다.

### 2. resources 쪽을 개발본 값으로 맞췄다

`stage-sidecar.sh`와 **똑같은 rsync 명령**을 돌렸다(스크립트가 하는 일을 그대로 재현):

```
$ diff pipeline/src/config.ts aone-app/src-tauri/resources/pipeline/src/config.ts
IDENTICAL
$ diff -rq pipeline/src aone-app/src-tauri/resources/pipeline/src
SRC TREE IDENTICAL
```

사본의 현재 값 (`resources/pipeline/src/config.ts`):

```
scoreWeights: {
  importancePerWeekSeen: 6,
  importancePerEvidence: 1.2,
  importancePerEmphasis: 4,
  importancePerExamMatch: 2.2,
  examSignalPerEmphasis: 7,
  examSignalPerExamHint: 12,
  examSignalPerExamMatch: 8,
},
proactiveExamSignalThreshold: 55,
```

지시서가 요구한 `6 / 1.2 / 4 / 2.2`, examSignal `7 / 12 / 8`, 임계 `55` 그대로다.

참고 — 이전 사본의 `examSignalPerExamMatch`는 **26**이었다. 지시서 요약(`14 / 3 / 5 / 6`)에는
importance 4개만 적혀 있었는데, examSignal 쪽 격차가 더 컸다(26 → 8, 3배 이상).

### 3. 다시 갈라지지 않게 — 검사 2겹 (이번에 넣었다)

**(a) 테스트** `pipeline/test/config-drift.test.ts` (신규)

두 파일을 문자열 비교해 다르면 실패한다. 사본은 gitignore 대상이라 CI·클론 환경엔 없는 게 정상이므로
**없으면 조용히 통과**시키고, 있는데 다를 때만 실패시킨다.

검사가 실제로 작동하는지 확인 — 일부러 사본만 `importancePerWeekSeen: 14`로 바꿔봤다:

```
=== 일부러 어긋나게 만든 뒤 ===
not ok 1 - 번들 사본 config.ts가 개발본과 같다
# fail 1
=== 복원 후 ===
ok 1 - 번들 사본 config.ts가 개발본과 같다
# pass 1
```

**(b) 스테이징 스크립트** `scripts/stage-sidecar.sh`에 5단계 추가

rsync 직후 `diff -q`로 대조하고 다르면 `exit 1`. 제외 규칙이 늘거나 순서가 바뀌어
조용히 어긋나는 경우를 배포 시점에 막는다.

### 구조 개선 제안 (이번엔 하지 않음 — 지시서 3-3 "큰 구조 변경은 제안만")

지금은 "사본을 만들고 검사한다"이지 "한 곳에만 존재한다"가 아니다. 진짜 단일화는 두 갈래다.

1. **`tauri.conf.json`이 `../pipeline`을 직접 번들한다.** 사본이 사라진다.
   막는 것: Tauri `resources`가 프로젝트 루트 밖 상위 경로를 참조할 때 경로 해석·심볼릭 링크
   처리가 다르고, 지금 `stage-sidecar.sh`가 하는 후처리(npm/npx 래퍼 생성, `.bin/tsx` 링크 교체,
   `node_modules/.cache` 제외)를 대신할 자리가 없다. 검증 없이 바꾸면 `.dmg`가 조용히 깨진다.
2. **가중치만 JSON으로 빼고 양쪽이 같은 파일을 읽는다.** 코드 사본은 남지만 **설정값은 진짜로 한 곳**이 된다.
   `config.ts`가 `scoreWeights`를 `weights.json`에서 읽고, 그 JSON 하나만 번들에 싣는 방식.
   이게 침습이 적고 목표에 더 가깝다. 다음 배치에서 권한다.

### 완료 기준

| 항목 | 판정 | 실측 근거 |
|---|---|---|
| 사본 생성 경로 규명 | `[O]` | `scripts/stage-sidecar.sh:36` rsync. gitignore·mtime·`git ls-files` 0건으로 교차 확인 |
| resources를 `6/1.2/4/2.2`·`7/12/8`·`55`로 맞춤 | `[O]` | 위 config 인용 |
| diff로 같아짐을 보임 | `[O]` | `diff` → 출력 없음, `diff -rq pipeline/src …` → 출력 없음 |
| 어긋나면 실패하는 검사 추가 | `[O]` | 테스트 신규 1건 + 스테이징 스크립트 `exit 1`. 고의 드리프트로 `not ok` 재현 확인 |
| 기존 테스트 회귀 없음 | `[O]` | `npm test` → `# tests 61 / # pass 61 / # fail 0` |
| 스크립트 문법 | `[O]` | `bash -n scripts/stage-sidecar.sh` exit 0 |

부수 사항 — rsync가 `node_modules/.bin/tsx`를 원래 심볼릭 링크로 되돌려놨다.
`stage-sidecar.sh` 3단계가 매 빌드마다 실제 래퍼로 교체하므로 `.dmg` 빌드에는 영향이 없다.

---
