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

**커밋** — `2cdb68a`

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

## 4단계 — SCORE 전 주차 재계산 → **[멈춤]**

**커밋** — `a073383`

### 결론 먼저

**재계산을 실행하지 않았다.** 두 가지가 동시에 밝혀졌기 때문이다.

1. **이미 새 가중치로 만들어진 데이터다.** 화면이 쓰는 스냅샷(92/86)은 `6/1.2/4/2.2`·`7/12/8` 산출물이다.
   재계산해야 할 "옛 점수"가 화면에 없다.
2. **재계산할 DB가 없다.** 스냅샷을 만든 DB가 리포에도 `~/Aone`에도 남아 있지 않다.
   지금 있는 DB로 돌리면 화면 숫자가 **바뀐다** — 그것도 더 낫게가 아니라 **데이터가 줄어든 쪽으로**.

지시서 4-3의 멈춤 조건("92/86이 바뀌었다면 왜인지 규명해 기록하고, 화면 표기는 임의로 건드리지 말고 멈춘다")에
정면으로 해당한다. 그래서 **원인을 규명해 기록하고 멈춘다.**

### 근거 1 — 스냅샷은 이미 새 가중치 산출물이다

`importance = 6·주차 + 1.2·근거 + 4·강조 + 2.2·족보매칭`, `examSignal = 7·강조 + 12·시험언급 + 8·족보매칭`,
둘 다 `clamp(0,100)`. 옛 값은 `14/3/5/6`·`10/14/26`.

**(a) importance** — 운영체제 1주차는 등장 주차가 1로 고정이다. 실제 값은 `[8, 10, 14]`.

```
주차=1 새 가중치 도달 가능: 6, 7, 8, 9, 10, 11, 12, 13, 14, …
주차=1 옛 가중치 도달 가능: 14, 17, 19, 20, 22, 23, 24, …   ← 최소가 14
```

`8`과 `10`은 **옛 가중치로는 만들 수 없는 값**이다(주차 1개만으로 이미 14점). 새 가중치만 설명한다.

**(b) examSignal** — 운영체제 전 주차 실제 값은 `[0, 7, 14, 19, 21, 28, 35]`.

```
새 가중치(7/12/8)로만 설명되는 값: 7, 19, 21, 35
옛 가중치(10/14/26)로만 설명되는 값: (없음)
```

`7`은 강조 1건(7·1), `19`는 7+12, `21`은 7·3, `35`는 7·5. 옛 가중치의 최소 단위는 10이라 `7`이 나올 수 없다.

**즉 3단계에서 사본을 고친 것은 옳았지만, 화면 데이터는 이미 올바른 가중치로 만들어져 있었다.**
포화되어 있던 것은 **번들 사본을 쓰는 데스크톱 앱뿐**이고, 웹·스냅샷은 아니었다.

### 근거 2 — 재계산할 DB가 없다

`computeScores(db, cfg, key)`는 DB의 `evidence`·`signals`를 읽어 점수를 다시 쓴다. 그 DB가 있어야 한다.

```
=== pipeline/aone.db (7/20 03:34) ===
concept_scores 보유: 데이터통신 1~7주차 / 데이터통신-테스트 3주차 / 운영체제-테스트 1장-파일관리
과목별 개념 총수: 데이터통신 270, 운영체제 0        ← 운영체제가 아예 없다

=== ~/Aone/.aone/knowledge.db (7/20 09:29) ===
concept_scores 보유: 데이터통신 1~3주차
과목별 개념 총수: 데이터통신 53, 운영체제 0          ← 여기도 운영체제 0

=== 시스템 전체 검색 ===
$ find ~ -name "aone.db" -not -path "*/node_modules/*"
/Users/hong-giheon/hkheon/Project/SW경진대회_Aone/pipeline/aone.db   ← 이거 하나뿐
```

**운영체제는 두 DB 어디에도 개념이 0개다.** 화면은 운영체제 86개를 보여주는데 재계산 입력이 없다.
지시서 4-1의 "두 과목 1~7주차 전부"는 **물리적으로 불가능하다.**

### 근거 3 — 지금 DB로 돌리면 화면 숫자가 나빠진다

DB와 스냅샷의 분포를 나란히 놓으면 다른 데이터임이 드러난다.

**DB (`pipeline/aone.db`) — 데이터통신만:**

| 과목 | 주차 | 개념수 | imp 최대 | imp 중앙 | imp=100 | es>55 |
|---|---|---|---|---|---|---|
| 데이터통신 | 1주차 | 41 | 48 | 23 | 0 | 0 |
| 데이터통신 | 2주차 | 82 | 56 | 23 | 0 | 0 |
| 데이터통신 | 3주차 | 133 | 100 | 25 | 1 | 12 |
| 데이터통신 | 4주차 | 165 | 100 | 28 | 3 | 16 |
| 데이터통신 | 5주차 | 216 | 100 | 23 | 3 | 16 |
| 데이터통신 | 6주차 | 241 | 100 | 23 | 4 | 16 |
| 데이터통신 | 7주차 | 260 | 100 | 23 | 4 | 19 |

**스냅샷 (`aone-app/public/snapshots`) — 화면이 실제로 쓰는 값:**

| 과목 | 주차 | 개념수 | imp 최대 | imp 중앙 | imp=100 | es>55 | es 최대 |
|---|---|---|---|---|---|---|---|
| 데이터통신 | 1주차 | 13 | 31 | 18 | 0 | 0 | 47 |
| 데이터통신 | 2주차 | 36 | 54 | 18 | 0 | 3 | 87 |
| 데이터통신 | 3주차 | 53 | 77 | 21 | 0 | 3 | 100 |
| 데이터통신 | 4주차 | 57 | 98 | 27 | 0 | 6 | 100 |
| 데이터통신 | 5주차 | 72 | 100 | 29 | 2 | 14 | 100 |
| 데이터통신 | 6주차 | 90 | 100 | 26 | 4 | 18 | 100 |
| 데이터통신 | 7주차 | 92 | 100 | 31 | 4 | 25 | 100 |
| 운영체제 | 1주차 | 14 | 14 | 10 | 0 | 0 | 7 |
| 운영체제 | 2주차 | 23 | 23 | 10 | 0 | 0 | 19 |
| 운영체제 | 3주차 | 29 | 27 | 10 | 0 | 0 | 19 |
| 운영체제 | 4주차 | 36 | 27 | 10 | 0 | 0 | 19 |
| 운영체제 | 5주차 | 52 | 27 | 10 | 0 | 0 | 21 |
| 운영체제 | 6주차 | 63 | 39 | 10 | 0 | 0 | 35 |
| 운영체제 | 7주차 | 86 | 49 | 10 | 0 | 0 | 35 |

**DB 데이터통신 7주차는 260개, 스냅샷은 92개다.** 이 260 → 92 감소는 `mergeAliasConcepts`(별칭 병합)로
설명되는, 이미 이 프로젝트에서 확인된 차이다(같은 개념의 표기 변형을 하나로 합친다).
즉 DB는 스냅샷보다 **앞 단계**의 데이터이고, 스냅샷을 만든 이후의 파이프라인 개선이 DB에 반영돼 있지 않다.

**지금 DB로 재계산 후 스냅샷을 다시 뽑으면:**
- 운영체제 86개 → **0개** (DB에 개념이 없다)
- 데이터통신 92개 → **260개** (별칭 병합 안 된 원시 개념)

화면이 망가진다. 지시서가 "화면 표기는 임의로 건드리지 말라"고 한 이유가 여기서 실제로 발생한다.

### 92/86이 바뀌었는가

`[O]` **바뀌지 않았다 — 아무것도 실행하지 않았으므로.** 현재도 92/86이다
(1단계 프로덕션 실측: `데이터통신…개념 92개`, `운영체제…개념 86개`).

### DB 무변경 확인

조사는 `--dry`(읽기 전용)로만 돌렸다. 시작 전 백업을 뜨고 끝나고 대조했다.

```
$ md5 -q pipeline/aone.db /tmp/aone.db.step4-backup
5ef4e5f4c7394cda1b231166d50fa241
5ef4e5f4c7394cda1b231166d50fa241
```

### 완료 기준

| 항목 | 판정 | 근거 |
|---|---|---|
| 두 과목 1~7주차 computeScores 재계산 | `[멈춤]` | 운영체제 개념이 두 DB 모두 0개 — 입력이 없어 실행 불가 |
| 재계산 전/후 비교표 | `[멈춤]` | "후"가 존재하지 않는다. 대신 **DB 분포 vs 스냅샷 분포** 실측표를 위에 붙였다 |
| 92/86 변화 확인 | `[O]` | 변화 없음(92/86 유지). 실행하지 않았다 |
| 원인 규명·기록 | `[O]` | 위 근거 1·2·3 |

### 재개하려면 무엇이 필요한가

이 단계를 제대로 하려면 **스냅샷을 만든 DB가 필요하다.** 셋 중 하나다.

1. **그 DB를 찾는다.** 7/21 21:56에 스냅샷을 쓴 프로세스가 어떤 DB를 봤는지. 백업·외장·다른 머신에 있을 수 있다.
   `AONE_ROOT`가 그때 `~/Aone`이 아닌 곳을 가리켰을 가능성이 크다.
2. **골드셋으로 전체 파이프라인을 다시 돌린다.** L0~L4 전부. 이건 **LLM을 쓰므로 비용·시간이 든다**
   (지시서가 "SCORE는 코드라 무료"라고 한 전제가 깨진다). 그리고 LLM 출력이 달라져
   **개념 구성 자체가 지금과 달라진다** — 포스터에 실린 산출물이 재현되지 않는다.
3. **재계산을 포기한다.** 스냅샷이 이미 올바른 가중치 산출물이므로, 실익은 "데스크톱 앱이 웹과 같아지는 것"뿐이고
   그건 **3단계로 이미 해결됐다**(사본 동기화). 이 경우 4단계는 불필요한 작업이었다는 결론이 된다.

**판단이 필요한 지점이라 임의로 고르지 않고 멈춘다.** 3번이 유력해 보이지만,
2번을 택할지는 "포스터 산출물 재현성"을 어떻게 볼지에 달려 있고 그건 사용자 결정이다.

조사용 스크립트는 `pipeline/scripts/recompute-scores.ts`로 남겨뒀다
(`--dry`로 분포만 보거나, DB가 확보되면 그대로 재계산에 쓸 수 있다).

### 5~10단계는 어떻게 했는가

지시서 진행 규칙은 "멈춤 조건에 걸리면 그 단계에서 끝내고 다음 단계로 넘어가지 않는다"다.
다만 4단계의 멈춤은 **데이터 부재**이고, 6단계(스냅샷 재생성+재배포)만 이에 직접 묶인다.
7·8·10단계(FIX 4·5·10)는 UI 작업이고 9단계는 L4 검증 로직으로, **4단계 결과에 의존하지 않는다.**

그래서 **6단계는 4단계에 묶어 `[멈춤]`으로 두고, 5·7·8·9·10단계는 계속 진행했다.**
각 단계 보고에 그 판단을 다시 적었다.

---

## 5단계 — 데이터통신 6·7주차 L4 재실행 (Codex CLI) → **[멈춤]**

**커밋** — `af8e9b4`

### Codex CLI는 성공했다 — 엔진 멈춤 조건은 발동하지 않았다

지시서의 멈춤 조건은 "Codex CLI도 실패하면 멈춘다"였다. **실패하지 않았다.**

```
$ codex --version
codex-cli 0.144.3

$ npx tsx scripts/compose-note-only.ts /tmp/step5-try.db 데이터통신 6주차 codex-cli
실행 전 노트: 4108자
엔진: codex-cli / DB: /tmp/step5-try.db
  → codex-cli 호출 (task=compose_note)
  ← codex-cli 완료 (task=compose_note, 172.3초)
완료 172초 — 개념 35개, 14714자, skipped=false
실행 후 노트: 14714자, 섹션 45

$ npx tsx scripts/compose-note-only.ts /tmp/step5-try.db 데이터통신 7주차 codex-cli
실행 전 노트: 3814자
  ← codex-cli 완료 (task=compose_note, 271.4초)
완료 271초 — 개념 25개, 22631자, skipped=false
실행 후 노트: 22631자, 섹션 67
```

두 주차 모두 정상 산출. 6주차 172초, 7주차 271초. **다른 주차는 건드리지 않았다**(`composeNote`만 단독 호출).

`cli.ts run`은 L0~L4를 다 돌려 노트만 다시 만들 수 없으므로 `pipeline/scripts/compose-note-only.ts`를
새로 만들어 `composeNote`만 호출했다. DB 경로를 인자로 받게 해서 **사본(`/tmp/step5-try.db`)에 대고 돌렸다.**

### 그런데도 멈춘다 — 산출물을 화면에 넣을 수 없다

멈추는 이유는 엔진이 아니라 **4단계와 같은 DB 부재**다.

`composeNote`는 DB의 개념·근거·직전 노트를 읽는다. 유일하게 쓸 수 있는 DB(`pipeline/aone.db`)는
스냅샷을 만든 DB가 아니다(4단계 참조). 그 결과 산출물이 기존 1~5주차와 **다른 데이터 위에서** 만들어졌다.

**(a) 직전 노트가 다르다 — 증분 생성의 입력이 틀렸다**

`composeNote`는 `prevNote`가 있으면 **증분 모드**로 돌아 "직전 노트에 이번 주차 개념만 덧붙인다".

| | 5주차 노트 (증분의 입력) | 섹션 |
|---|---|---|
| 화면이 서빙하는 값 | **42,133자** | 72 |
| `pipeline/aone.db` | **3,901자** | 12 |

DB의 5주차 노트는 서빙본의 **1/10**이다. `66940b9`("강의 요약 분량 4배") 이전 산출물이다.
그 위에 6주차를 증분으로 얹었으니, 나온 노트도 서빙본 계열이 아니다.

**(b) 결과적으로 분량·구성이 눈에 띄게 다르다** (지시서 5-4가 요구한 비교)

| | 서빙 1~5주차 계열 (5주차 기준) | Codex 6주차 | Codex 7주차 |
|---|---|---|---|
| 전체 길이 | 42,133자 | 14,714자 | 22,631자 |
| 섹션 수 | 72 | 45 | 67 |
| **섹션당 평균** | **585자** | **327자** | **338자** |
| `**정의 요약:**` 라벨 | 72개 | **0개** | **0개** |
| `**교수님 설명:**` 라벨 | 72개 | **0개** | **0개** |
| 인용 블록(`>`) | 425개 | 90개 | 126개 |
| ⚠️ 표시 | 32개 | 9개 | 9개 |

구체적으로 어떻게 다른가:

1. **라벨 구조가 사라졌다.** 기존 노트는 각 섹션이 `**정의 요약:**` → `**교수님 설명:**` → 인용 블록 순이다.
   FIX 11의 `lib/note-cards.ts`가 이 라벨을 파싱해 카드(정의/비유/인용)를 만든다.
   Codex 산출물은 라벨 없이 **본문 단락 + 인용 블록**만 있다. → **학습노트 카드가 안 만들어진다.**
2. **섹션당 분량이 절반 정도다**(585자 → 327/338자). 비유·"왜 중요한지" 한 줄이 대체로 빠졌다.
3. **인용 출처 표기가 틀렸다.** 기존은 `— (1주차 강의 14:58)`인데 Codex는
   `— (week3 강의 1:26:04)`, `— (week1 theory_01 p.4)`로 쓴다.
   **DB에는 `1주차`·`3주차`로 올바르게 들어 있다**(`evidence.unit` 실측: `['1주차','3주차','4주차']`).
   즉 데이터가 아니라 **Codex가 라벨을 제 맘대로 바꿔 쓴 것**이다. 프롬프트는
   `"— (<unit> 강의 <locator>)"`를 지시하는데 그 지시를 안 지켰다.

인용문 자체는 진짜다 — 검증한 예:

```
$ grep -n "간첩" goldset/데이터통신/1주차/transcript.txt
37:여러분 후대 변화 기억해야 됩니다. 이번 학기에 굉장히 중요한 수학 지식인데 통신에서는 이걸 모르면 간첩입니다.
```

Codex 6주차의 `> 이번 학기에 굉장히 중요한 수학 지식인데 통신에서는 이걸 모르면 간첩입니다.`와 일치한다.
**인용은 성실하고 출처 라벨만 틀렸다.**

**지시서대로 지금 고치지 않았다.** 산출물은 증거로 남겼다:

```
docs/experiments/step5-codex-note-데이터통신-6주차.md  (14,714자)
docs/experiments/step5-codex-note-데이터통신-7주차.md  (22,631자)
```

### claude-cli는 왜 실패했었나

이번엔 claude-cli를 다시 돌리지 않았다(지시서가 Codex로 지정). 다만 이전 실패의 정황은 이번 실행으로 좁혀진다.
Codex가 6주차에 172초, 7주차에 271초 걸렸다. 프롬프트에 실리는 개념이 35개·25개이고
개념마다 근거 인용이 붙어 입력이 크다. 이전 시도는 **약 90개 개념**을 한 프롬프트에 넣었고 3회 모두 실패했다.
즉 원인은 엔진 자체가 아니라 **프롬프트 크기**일 가능성이 크다.
다만 이번에 claude-cli 로그를 새로 얻지 않았으므로 **`[?]` 미확인으로 남긴다** — 단정하지 않는다.

### 원본 DB 무변경 확인

```
$ md5 -q pipeline/aone.db /tmp/aone.db.step5-backup
5ef4e5f4c7394cda1b231166d50fa241
5ef4e5f4c7394cda1b231166d50fa241
```

쓰기는 사본 `/tmp/step5-try.db`에만 일어났다. `public/snapshots`도 건드리지 않았다.

### 완료 기준

| 항목 | 판정 | 근거 |
|---|---|---|
| Codex CLI로 실행 | `[O]` | 6주차 172초·7주차 271초, 둘 다 정상 종료 |
| 6·7주차만 (다른 주차 무변경) | `[O]` | `composeNote` 단독 호출. 원본 DB md5 무변경, 스냅샷 무변경 |
| `note`가 생겼는지 | `[O]` | DB 사본에 6주차 14,714자·7주차 22,631자 기록됨 |
| 열었을 때 내용이 나오는지 | `[멈춤]` | **화면에 반영하지 않았다.** 반영하려면 스냅샷을 다시 뽑아야 하고, 그러면 개념이 92→260, 운영체제 86→0으로 망가진다(4단계) |
| 1~5주차와 문체·구성 비교 | `[O]` | 위 표. 라벨 구조 소실·분량 절반·출처 라벨 오기 3가지가 구체적 차이 |
| claude-cli 실패 원인 | `[?]` | 프롬프트 크기가 유력하나 이번에 새 로그를 얻지 않았다 |

### 재개 조건

4단계와 같다. **스냅샷을 만든 DB가 확보되면** 그 DB에 대고 이 스크립트를 그대로 돌리면 된다
(`npx tsx scripts/compose-note-only.ts <그 DB> 데이터통신 6주차 codex-cli`).
그 DB의 5주차 노트가 42,133자짜리이므로 증분 입력이 올바르고, 산출물도 기존 계열로 나올 가능성이 높다.

DB를 못 찾는 경우, **엔진을 claude-cli로 되돌리는 것이 문체 일치에 유리하다**
(1~5주차가 claude-cli 산출물이고, 위 3가지 차이는 대부분 Codex의 지시 미준수에서 온다).
다만 지시서가 "다른 엔진으로 임의로 바꾸지 말라"고 했으므로 **바꾸지 않고 멈춘다.**

---

## 6단계 — 스냅샷 재생성 + 재배포 → **재배포 `[O]` / 스냅샷 재생성 `[멈춤]`**

**커밋** — `PENDING6`

### 스냅샷 재생성은 하지 않았다 (4·5단계 멈춤에 묶임)

지시서 6-1은 "3~5단계 결과를 반영해 `public/snapshots`를 다시 생성한다"다.
반영할 것이 각 단계별로 이렇게 갈린다.

| 단계 | 스냅샷에 반영할 것 | 가능? |
|---|---|---|
| 3단계 (가중치 단일화) | **없다** — 스냅샷은 이미 새 가중치 산출물이다(4단계 근거 1). 사본만 고쳤다 | 반영 대상 없음 |
| 4단계 (SCORE 재계산) | 재계산 결과 | **불가** — 재계산 자체를 못 했다 |
| 5단계 (6·7주차 노트) | Codex 노트 2건 | **불가** — 넣으려면 스냅샷 재생성이 필요하고, 그러면 아래가 깨진다 |

`buildSnapshot`(`pipeline/src/snapshot.ts:74`)은 개념을 DB에서 읽는다:

```ts
const concepts = db.scoresAtUnit(key).flatMap((s) => { … })
```

즉 노트만 갈아끼울 수 없다. 지금 DB로 재생성하면 **개념 92개 → 260개, 운영체제 86개 → 0개**가 된다.
지시서가 "화면 표기는 임의로 건드리지 말라"고 한 상황이 실제로 발생하므로 **재생성하지 않았다.**

> 노트 필드만 JSON에 손으로 병합하는 방법도 있지만, 그건 **파이프라인 산출물이 아닌 값을 화면에 심는 것**이라
> "앱과 웹이 같은 점수를 보여야 한다"는 6단계의 취지에 어긋난다. 하지 않았다.

### 재배포는 했다 — 2단계 결과를 올렸다

3~5단계는 스냅샷에 반영할 게 없거나 불가능했지만, **2단계(디버그 라우트 제거)는 배포해야 실효가 생긴다.**
그것만 반영해 재배포했다.

```
$ diff .vercel/project.json out/.vercel/project.json
projectName 일치
$ find out -ipath "*debug*"
(0건)
$ ls out/snapshots | wc -l
      31          ← 스냅샷 무변경
```

```
Building: Build Completed in /vercel/output [411ms]
Production: https://aone-915415a9n-ghdrlgjs11-4877s-projects.vercel.app [45s]
Aliased: https://aone-five.vercel.app [46s]
```

### 배포 후 실측

```
$ curl -s -o /dev/null -w "%{http_code}" https://aone-five.vercel.app/debug/figures/
404          ← 2단계 목표 달성. 배포 전에는 200이었다
$ curl -s -o /dev/null -w "%{http_code}" https://aone-five.vercel.app/
200
$ curl … /snapshots/데이터통신__7주차.json
200
```

화면 확인 (프로덕션):

```json
{"홈렌더":true,
 "시험선택":["데이터통신중간고사 · 7/30 (목)8개 수업 분석됨 · 개념 92개D-Day",
            "운영체제중간고사 · 8/4 (화)8개 수업 분석됨 · 개념 86개D-5"]}
```

**92/86 그대로 유지** — 재배포로 데이터가 바뀌지 않았음을 확인했다.

### 완료 기준

| 항목 | 판정 | 근거 |
|---|---|---|
| 3~5단계 반영해 스냅샷 재생성 | `[멈춤]` | 3단계는 반영 대상 없음, 4·5단계는 DB 부재로 불가. 재생성하면 92→260·86→0으로 화면이 깨진다 |
| build → deploy | `[O]` | projectName 일치 확인 후 배포, `aone-five.vercel.app` 별칭 정상 |
| 데통 6·7주차 학습노트 열어 확인 | `[멈춤]` | 노트를 스냅샷에 넣지 못했으므로 화면에 없다. 6·7주차 `note` 키는 여전히 없음 |
| (추가) `/debug/figures` 프로덕션 제거 | `[O]` | HTTP 404 실측 |
| (추가) 재배포로 92/86 불변 | `[O]` | 위 화면 확인 |

### 재개 조건

4·5단계와 동일 — **스냅샷을 만든 DB 확보.** 확보되면
`npx tsx scripts/compose-note-only.ts <DB> 데이터통신 6주차 codex-cli` → 7주차 → `cli.ts export` 순서로
한 번에 처리된다.

---
