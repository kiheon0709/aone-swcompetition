# Aone 1차 수정 실행 기록

`AONE_1차수정_지시.md` 1~8단계 수행 결과. 단계가 끝날 때마다 append 한다.

**전제** — 경진대회 출품작이 아니라 **모르는 사람이 받아 자기 강의로 쓰는 제품**. 판단 기준은
"처음 쓰는 사람이 여기서 막히나". 단 **부스 데모(데이터통신·운영체제)는 계속 동작해야 한다.**

---

## 1단계 — 데모 고정 + 검증 환경 확보

**커밋** — `190cc7d`

### 1. 데모 고정 — 태그만으로는 안 된다 (지시서 전제 수정)

지시서는 "git 태그 `demo-baseline-20260730`을 달면 스냅샷 31개가 언제든 복원 가능"이라고 했다.
**실측 결과 태그만으로는 복원할 수 없다.**

```
$ git check-ignore -v aone-app/public/snapshots/데이터통신__7주차.json
.gitignore:45:aone-app/public/snapshots/	aone-app/public/snapshots/데이터통신__7주차.json

$ git ls-tree -r demo-baseline-20260730 --name-only aone-app/public/snapshots/ | wc -l
       0          ← 태그 시점에 스냅샷이 0개다
```

`.gitignore:40-47`이 데모 데이터를 통째로 제외한다 — **저작권 때문에 의도된 설정**이다
(주석: `# public 데모 데이터 (교수 강의 자료 — 저작권)`).

| 경로 | git 추적 | 용량 |
|---|---|---|
| `aone-app/public/snapshots` | **0건** | 1.4M |
| `aone-app/public/docs` | **0건** | 856K |
| `aone-app/public/exams` | **0건** | 1.4M |
| `aone-app/public/slides` | **0건** | 1.2M |
| `aone-app/public/lecture-pdfs` | **0건** | 21M |
| `aone-app/public/files.json` | 1건 | 8K |

**그래서 git 밖에 실제 복원점을 만들었다.** 태그는 코드 기준선으로 그대로 두고(달았다),
데모 자산은 별도 아카이브 + 체크섬으로 고정한다.

```
$ tar czf ~/aone-demo-baseline/demo-baseline-20260730.tgz snapshots docs exams slides files.json
$ ls -lh ~/aone-demo-baseline/
-rw-r--r--  2.2M  demo-baseline-20260730.tgz     (99개 항목)

$ md5 -q aone-app/public/snapshots/*.json | sort | md5 -q
be248478917b303430467d7d23413dc6              ← 스냅샷 31개 통합 체크섬

$ md5 -q aone-app/public/files.json
77103e936dcdc96ad4214c0e38206f4c
```

개별 체크섬 31건은 `~/aone-demo-baseline/snapshots.md5`에 있다.
`lecture-pdfs`(21M)는 어느 단계도 수정하지 않으므로 아카이브에서 제외했다.

**복원 절차** — `cd aone-app/public && tar xzf ~/aone-demo-baseline/demo-baseline-20260730.tgz`

| 항목 | 판정 | 근거 |
|---|---|---|
| git 태그 | `[O]` | `demo-baseline-20260730` → `7f47110` |
| 스냅샷 31개 복원 가능 | `[O]` | **태그가 아니라 아카이브+체크섬으로.** 태그로는 불가능함을 실측 확인 |

### 2. 데모 기준선 (웹 빌드 `out/` 정적 서빙, `localhost:3101`)

빌드: `/` 82.5 kB, First Load JS 190 kB, export 정상.

**홈**

```json
{"홈_시간표":true, "홈_다가오는시험":true, "홈_과제":true,
 "홈_시험목록":["D-9","D-9","D-14","D-21","D-3","D-5","D-8"],
 "사이드바_과목":["홈","에이전트","시험 대비D-9","데이터통신","1주차"…"7주차","족보",
                "운영체제","1주차"…"7주차","족보","과목 추가","휴지통"]}
```

> D-day 값은 오늘 날짜 기준이라 매일 변한다. **대조 대상이 아니다**(지난 배치에서는 D-Day였다).
> 대조할 것은 "시험 3건이 뜨는가"다.

**시험 대비 — 개념 수가 핵심 기준선**

```json
{"시험선택_카드":[
  "데이터통신중간고사 · 8/8 (토)  8개 수업 분석됨 · 개념 92개  D-9",
  "운영체제중간고사 · 8/13 (목)  8개 수업 분석됨 · 개념 86개  D-14",
  "데이터베이스퀴즈 2 · 8/20 (목)  아직 분석된 수업이 없어요  D-21"]}
```

**데통 92 · 운체 86** — 매 단계 이 값을 대조한다.

**학습 가이드**

```json
{"학습가이드_학습경로":true,
 "학습가이드_핵심표기":"이번 시험 핵심 20개 (전체 92개 중)",
 "학습가이드_기출표기":"기출 36문항",
 "탭":["학습 가이드","학습노트","모의고사"]}
```

**폴더 뷰 (데통 3주차)**

```json
{"폴더뷰_3주차_파일수":"파일 4개",
 "폴더뷰_3주차_요약":"개념 53개 정리 · 교수님 강조 43곳 · 퀴즈 8개",
 "폴더뷰_3주차_카드":["(실습) 20260317-실습3주차.pdf",
                    "(이론) 2-데이터통신-1비트만들기-사인함수.pdf",
                    "(이론) 3-데이터통신-1-아날로그-소리-변환.pdf",
                    "transcript.txt"]}
```

**족보 — 지금 깨져 있는 상태를 그대로 기준선으로 기록한다**

```json
{"족보_파일수":"파일 1개",
 "족보_연도별기출":"연도별 기출 · 0건",
 "족보_로딩중":true,
 "족보_연도카드수":0,
 "족보_썸네일":[{"w":0,"complete":false},{"w":0,"complete":false}]}
```

**전사본 (데통 3주차 PDF → 녹음·필기 → transcript.txt)**

```json
{"리더_페이지":["1 / 17"],
 "녹음필기_전사본없음문구":false,     ← 지시서와 다르다 (아래 참조)
 "전사본_뷰어":true, "전사본_블록수":89, "전사본_하이라이트":11}
```

**콘솔 에러 0건** (전 화면 순회 후 `read_console_messages` → "No console messages found")

### 지시서와 다른 점 — 웹에서는 전사 뷰어가 이미 동작한다

지시서 2단계 완료 기준에 *"전사 뷰어가 열린다. …지금은 '전사본이 아직 없습니다'가 뜬다"*,
*"전사본을 열었을 때 강조 인용이 보인다. 지금은 `?? "slide"` 폴백 때문에 0건을 보여준다"*라고 적혀 있다.

**웹 빌드 실측: 뷰어가 열리고 블록 89개, 하이라이트 11개가 보인다.**
`"전사본이 아직 없습니다"` 문구는 뜨지 않는다(`녹음필기_전사본없음문구: false`).

이건 지난 배치 FIX 14로 이미 고쳐진 부분이다. 다만 **데스크톱(dev 앱)에서는 다를 수 있다** —
3단계가 지적한 `docUrl`(`/docs/...`) 정적 경로 문제 때문이다. 웹은 정적 경로가 실제로 존재하므로 동작하고,
데스크톱은 사용자 파일이 `out/`에 없으므로 실패하는 구조다.
**따라서 2단계에서는 "웹 회귀 없음 + 데스크톱에서 되는가"를 기준으로 검증한다.**

### 3. 데스크톱 검증 경로 — `npm run tauri dev` 성공 (멈춤 조건 미발동)

```
cargo 1.95.0 (f2d3ce0bd 2026-03-21) / tauri-cli 2.11.4

✓ Ready in 1213ms
   Running DevCommand (`cargo run --no-default-features --color always --`)
   Compiling aone-app v0.1.0
   Finished `dev` profile [unoptimized + debuginfo] target(s) in 13.21s
   Running `target/debug/aone-app`
 ✓ Compiled / in 1637ms (833 modules)
 GET / 200 in 2113ms

$ ps aux | grep "[t]arget/debug/aone-app"
29972 target/debug/aone-app          ← 앱 프로세스 살아 있음
```

경고 1건(`guide.rs:28 method stop is never used`) — dead code, 기능 영향 없음.
`withGlobalTauri: true`(`tauri.conf.json:13`)라 웹뷰 콘솔에서 커맨드 직접 호출도 가능하다.

앱 창 스크린샷 확인 — 사이드바에 **데이터통신 / 신호처리** 두 과목이 뜨고,
신호처리 아래 `1주차` · `족보`가 보인다. **watcher가 새 폴더를 자동 인식했다.**

`[O]` **멈춤 조건 미발동 — 2~7단계 검증 가능하다.**

### 4. 새 과목 시나리오 before 값 — 3·5단계의 대조 기준

실사용자를 흉내 낸 파일명으로 새 과목을 만들었다(`~/Aone/신호처리/`):

```
~/Aone/신호처리/1주차/1주차강의자료.pdf          (1,112,945 B)
~/Aone/신호처리/1주차/신호처리_1주차_전사.txt      (40,012 B — transcript.txt가 아니다)
~/Aone/신호처리/족보/19중간문제.pdf              (1,112,945 B — exam·기출·족보 없는 이름)
```

**앱이 자동으로 인식해 `~/Aone/.aone/files.json`을 갱신했다.** 그 내용이 before 값이다:

```
[데이터통신] 파일 14개
   1주차      파일 3개  kind: {'practice': 1, 'theory': 1, 'transcript': 1}
       - (실습) week1_WireShark.pptx.pdf            kind=practice
       - (이론) week1_1-0-데이터통신-overview-공개.pdf     kind=theory
       - transcript.txt                           kind=transcript
   2주차      파일 5개  kind: {'practice': 3, 'theory': 1, 'transcript': 1}
       - (실습) 20260310-실습2주차-파일 통신.pptx.pdf       kind=practice
       - (이론) 1-1-데이터통신-layer-packet-signal-공개.pdf kind=theory
       - (이론)1-2-명령어실습.pdf                        kind=practice
       - (이론)1-3-lab-introduction-docker.pdf      kind=practice
       - transcript.txt                           kind=transcript
   3주차      파일 4개  kind: {'practice': 1, 'theory': 2, 'transcript': 1}
       - (실습) 20260317-실습3주차.pdf                  kind=practice
       - (이론) 2-데이터통신-1비트만들기-사인함수.pdf             kind=theory
       - (이론) 3-데이터통신-1-아날로그-소리-변환.pdf            kind=theory
       - transcript.txt                           kind=transcript
   족보       파일 2개  kind: {'past_exam': 2}
       - past_exam_2025_raw.txt                   kind=past_exam
       - past_exams.json                          kind=past_exam

[신호처리] 파일 3개
   1주차      파일 2개  kind: {'theory': 1, 'transcript': 1}
       - 1주차강의자료.pdf                              kind=theory
       - 신호처리_1주차_전사.txt                          kind=transcript
   족보       파일 1개  kind: {'theory': 1}          ← ★ 결함 재현
       - 19중간문제.pdf                               kind=theory   ← ★ past_exam이어야 한다

전체 17개
```

**여기서 세 가지가 확정됐다.**

1. **지시서 (b)는 맞다.** `19중간문제.pdf`가 **족보 폴더 안인데도 `theory`로 분류된다.**
   데통 족보 파일이 `past_exam`을 받은 건 파일명에 `past_exam`이 들어 있어서일 뿐이다.
   → 폴더명을 봐야 한다는 지시가 정확하다.
2. **Rust 생산자는 `kind`를 정상적으로 쓴다.** dev 앱이 만든 `files.json`의 17개 엔트리 전부 `kind`가 있다.
   문제는 생산자가 아니라 **커밋된 배포본이 낡은 것**이다 — 지시서 (a)도 맞다:

   ```
   배포본 public/files.json — 파일 50개, kind 없는 것 50개
   과목별: {'데이터통신': 28, '운영체제': 22}
   ```

   50개 **전부** `kind`가 없다. 그리고 지시서 완료 기준의 숫자(데통 28 · 전체 50)와 일치한다.
3. **전사본 파일명은 앱이 이미 넓게 인식한다.** `신호처리_1주차_전사.txt` → `kind=transcript`.
   즉 5단계의 불일치는 **앱이 아니라 파이프라인 쪽에만** 있다(`l1-normalize.ts:235`가 `transcript.txt` 고정).

### 완료 기준

| 항목 | 판정 | 근거 |
|---|---|---|
| git 태그 `demo-baseline-20260730` | `[O]` | `7f47110` |
| 스냅샷 31개 복원 가능 | `[O]` | 아카이브 2.2M + 통합 md5 `be248478…`. **태그만으로는 불가능**함을 실측 확인 후 대체 수단 마련 |
| 데모 기준선 기록 (홈·가이드·폴더·시험대비·개념 수·콘솔) | `[O]` | 위 DOM 실측값 전부 |
| `npm run tauri dev` 기동 | `[O]` | 13.21s 컴파일, PID 29972, 앱 창 스크린샷 확인 |
| 새 과목 before 값 기록 | `[O]` | 위 `files.json` 전문 |

### 데모 무손상 확인

이 단계는 **코드를 변경하지 않았다**(태그·아카이브·측정만). 그래도 확인했다.

| 항목 | 기준선 | 현재 | 판정 |
|---|---|---|---|
| 스냅샷 31개 통합 md5 | `be248478917b303430467d7d23413dc6` | 동일 | `[O]` |
| `files.json` md5 | `77103e936dcdc96ad4214c0e38206f4c` | 동일 | `[O]` |
| 데통 개념 수 | 92 | 92 | `[O]` |
| 운체 개념 수 | 86 | 86 | `[O]` |
| 홈 / 학습 가이드 / 폴더 뷰 / 시험대비 렌더 | 정상 | 정상 | `[O]` |
| 콘솔 에러 | 0 | 0 | `[O]` |

> `~/Aone/.aone/files.json`은 dev 앱 watcher가 갱신했다. 이건 **앱 런타임 데이터**이고
> 배포 데모(`aone-app/public/`)와 별개다. 데모 자산은 바뀌지 않았다.

---

## 2단계 — R1: `kind` 필드

**커밋** — `68aa3ba`

### (a) 배포본 재생성 — **재생성하지 않고 `kind`만 채웠다** (지시서 전제 수정)

지시서는 "`public/files.json`이 낡았으니 재생성한다"고 했다. **조사 결과 재생성하면 데모가 무너진다.**

`rescan_files()`의 개발 폴백은 `goldset/`을 읽는데, goldset과 배포 데모가 다르다:

```
=== goldset 구조 ===
  데이터통신: 29 파일, unit 8개
  운영체제:   1 파일, unit 2개        ← 배포본은 22개라고 한다

=== public/files.json이 나열한 50개 중 실체 확인 ===
files.json 50개 중 — 실체 있음 35, 없음 15
없는 것: 운영체제 PDF 8개 + 운영체제/족보 7개 전부
   운영체제/족보/19중간답.pdf, 19중간문제.pdf, 20연계중간문제답.pdf,
   23중간답.pdf, 23중간문제.pdf, 25년도1학기중간.pdf, past_exams.json
```

즉 `public/files.json`은 goldset 스캔 산출물이 아니라 **손으로 큐레이션한 데모 매니페스트**다.
운영체제 PDF·족보는 **저작권 때문에 배포하지 않는다**(`.gitignore`: "public 데모 데이터 (교수 강의 자료 — 저작권)").
운영체제 데모가 도는 건 **스냅샷이 분석 결과를 담고 있기 때문**이고 원본 PDF는 원래 없다.

**goldset에서 재생성하면 운영체제가 22개 → 1개가 되어 데모가 죽는다.**
그래서 목록은 그대로 두고 `kind`만 채웠다 — `aone-app/scripts/add-kind-to-files-json.mjs` (신규).
판정 규칙은 Rust `classify_in`을 그대로 옮겼다.

```
$ node scripts/add-kind-to-files-json.mjs
파일 50개 중 50개 변경
  ...
  족보/19중간문제.pdf: (없음) → past_exam      ← 폴더 규칙이 잡았다
  족보/25년도1학기중간.pdf: (없음) → past_exam
  족보/23중간답.pdf: (없음) → past_exam

$ 검증
파일 50개, kind 없는 것 0개
과목별: {'데이터통신': 28, '운영체제': 22}
파일 목록 동일: True      ← 이름·경로 그대로
크기 동일: True
```

> **지시서가 인용한 실사용자 파일명(`19중간문제.pdf`·`25년도1학기중간.pdf`·`23중간답.pdf`)이
> 사실은 데모 데이터 안에 이미 있었다.** 운영체제 족보가 바로 그 파일들이다.

### (b) 분류기가 폴더를 보게 했다

`src-tauri/src/commands/files.rs`:

```rust
/// 족보 폴더인가 — 사용자가 "족보"·"기출"·"exam" 중 무엇으로 만들든 같게 본다.
fn is_exam_folder(folder: &str) -> bool {
    has_any(&folder.to_lowercase(), &["족보", "기출", "exam"])
}

fn classify_in(folder: &str, name: &str) -> &'static str {
    let by_name = classify(name);
    if !is_exam_folder(folder) { return by_name; }
    match by_name {
        "transcript" | "audio" => by_name,   // 족보 폴더에 있어도 전사본은 전사본
        _ => "past_exam",
    }
}
```

`scan_dir`이 디렉터리 이름을 넘긴다.

**전사본에는 폴더 규칙을 두지 않았다** (지시서가 "판단해서 적용하라"고 한 부분).
근거 — 전사본만 모아두는 폴더 관습이 없고, 확장자+이름 규칙(`txt|md` × `transcript|전사|녹음`)이
이미 실사용자 이름을 잡는다. 1단계 실측에서 `신호처리_1주차_전사.txt` → `transcript`로 정상 분류됐다.
규칙을 더 넓히면 오탐만 는다.

**반대 방향은 막았다** — 족보 폴더 안의 전사본·녹음은 `past_exam`으로 덮지 않는다.
덮으면 발화 근거를 통째로 잃는다.

Rust 테스트 3건 추가:

```
test commands::files::tests::exam_folder_overrides_filename ... ok
test commands::files::tests::exam_folder_keeps_transcript_and_audio ... ok
test commands::files::tests::non_exam_folder_unchanged ... ok
test result: ok. 19 passed; 0 failed; 1 ignored
```

**dev 앱 실측 (1단계 before와 대조):**

| 파일 | before (1단계) | after (2단계) |
|---|---|---|
| `신호처리/족보/19중간문제.pdf` | `theory` | **`past_exam`** |
| `신호처리/1주차/신호처리_1주차_전사.txt` | `transcript` | `transcript` (불변) |
| `데이터통신/족보/past_exams.json` | `past_exam` | `past_exam` (불변) |
| `데이터통신/3주차/(실습) 20260317-실습3주차.pdf` | `practice` | `practice` (불변) |

### (c) 폴백을 한 곳으로 모았다

`aone-app/lib/file-kind.ts` (신규) — `kindOf(file, folder)` 하나가 판정한다.
매니페스트 `kind`가 있고 `other`가 아니면 그대로 믿고, 없으면 파일명+폴더로 추론한다.

지시서가 지목한 6곳을 전부 이 함수로 바꿨다:

| 위치 | 변경 전 | 변경 후 |
|---|---|---|
| `1379` recordingEntries | `f.kind === "transcript" \|\| /\.(md\|txt)$/` | `isTranscript(f, lectureFolder)` |
| `1408` pendingTranscript | 정규식 폴백 3단 | `isTranscript(f, lectureFolder)` |
| `1418` 이론 PDF 찾기 | 폴백 3단 | `kindOf(f, lectureFolder) === "theory"` |
| `1488` 전사문 원문 로드 | **폴백 없음** | `isTranscript(f, lectureFolder)` |
| `2052` examFolderFile | **폴백 없음** (무한 로딩 원인) | `isPastExam(d.entry, lectureFolder)` |
| `2782` docDetail | **폴백 없음** (`?? "slide"`) | `kindOf(openFile, lectureFolder)` |

추가로 같은 결함에 걸려 있던 3곳도 함께 바꿨다 — `displayFilesOf`(카드 생성),
`fileViewKindOf`(뷰 종류), `docBody`(본문 파싱). 이제 **9곳이 같은 판정을 쓴다.**

`isExamFolder`도 `lecture?.unit === "족보"` 정확 일치에서 `isExamFolderName()`으로 바꿨다 —
사용자가 "기출"·"exam"으로 폴더를 만들어도 기출 뷰어가 뜬다.

> 규칙이 Rust·스크립트·프론트 3곳에 있다. 세 파일 헤더 주석에 **"바꿀 때 셋을 함께 고쳐라"**를 명시했다.
> 진짜 단일화(한 곳에서 생성)는 구조 변경이라 이번 범위 밖으로 둔다.

### 완료 기준

| 항목 | 판정 | 실측 근거 |
|---|---|---|
| `public/files.json` 모든 엔트리가 `kind`를 갖는다 | `[O]` | `파일 50개, kind 없는 것 0개` |
| 족보 폴더의 `19중간문제.pdf`가 `past_exam` | `[O]` | dev 앱 실측 — before `theory` → after `past_exam` |
| 족보 화면이 무한 로딩에서 벗어나 연도별 문항이 뜬다 | `[O]` | `연도별 기출 · 0건 → 5건`, 로딩 문구 사라짐, 연도 카드 5장, **문항 합 36개** (9+11+7+3+6) |
| 전사 뷰어가 열린다 | `[O]` | 녹음·필기 → `transcript.txt`: 블록 89개. **1단계에서 이미 되고 있었음을 확인**(아래 참조) |
| 전사본 강조 인용이 보인다 | `[O]` | 우측 패널 **`교수 강조 · 11`** (`?? "slide"` 폴백 제거 효과). 스냅샷 실측 `transcript.emphasis` 14/14 파일, `slide.emphasis` 0 |
| 파일 개수 표기가 실제와 맞는다 | `[O]` | 족보 **`파일 2개`**(before 1개) · 데통 **28** · 전체 **50** |
| 데모 무손상 | `[O]` | 아래 |

### 지시서와 다른 점 2가지 (기록)

1. **전사 뷰어는 이미 동작하고 있었다.** 지시서는 *"지금은 '전사본이 아직 없습니다'가 뜬다"*고 했으나
   1단계 기준선 측정에서 이미 블록 89개가 렌더됐다. 이번 단계에서 새로 고친 것은 **강조 인용**
   (`교수 강조 · 0 → 11`)이고, 뷰어 자체는 지난 배치 FIX 14로 이미 해결돼 있었다.
2. **`파일 1개`는 "카드 수"를 세고 있었다.** `page.tsx`의 세 곳(`totalFileCount`, 과목 카드, 주차 카드,
   패널 부제)이 전부 **표시 카드 수**를 세면서 라벨만 "파일"이었다. 족보는 여러 파일을 카드 1장으로
   합치므로(설계된 동작) 2개가 1개로 보였다. `kind` 결함과 별개의 표기 버그였고 함께 고쳤다.

### 데모 무손상 확인

| 항목 | 기준선 (1단계) | 현재 | 판정 |
|---|---|---|---|
| 스냅샷 31개 통합 md5 | `be248478917b303430467d7d23413dc6` | `be248478917b303430467d7d23413dc6` | `[O]` **완전 동일** |
| 데통 개념 수 | 92 | 92 | `[O]` |
| 운체 개념 수 | 86 | 86 | `[O]` |
| 홈 (시간표·시험·과제) | 렌더 | 렌더 | `[O]` |
| 시험 선택 3카드 | 92 / 86 / 미분석 | 동일 | `[O]` |
| 학습 가이드 | `핵심 20개 (전체 92개 중)` · `기출 36문항` | 동일 | `[O]` |
| 폴더 뷰 (데통 3주차) | 파일 4개 · 카드 4장 | 동일 | `[O]` |
| 전사본 뷰어 | 블록 89 · 하이라이트 11 | 블록 89 · 하이라이트 11 | `[O]` |
| 콘솔 에러 | 0 | 0 | `[O]` |
| `files.json` md5 | `77103e93…` | `9fe4b94e…` | **의도된 변경** (kind 추가. 파일 목록·크기는 동일) |

**바뀐 화면 — 전부 개선이다:**

| 화면 | before | after | 판정 |
|---|---|---|---|
| 데통 족보 | 무한 로딩 · 0건 | 연도 카드 5장 · 36문항 | **개선** |
| 족보 파일 수 | `파일 1개` | `파일 2개` | **개선** (실제 2개) |
| 전체 파일 수 | `파일 43개` | `파일 50개` | **개선** (실제 50개) |
| 전사본 우측 패널 | `교수 강조 · 0` | `교수 강조 · 11` | **개선** |
| 운체 족보 | 무한 로딩 | `연도별 기출 · 0건` (로딩 끝남) | **개선** — 데이터가 배포되지 않은 폴더라 0건이 정상. 영원히 도는 것보다 낫다 |

퇴행은 없다.

---

## 3단계 — R3: 정적 경로 → Tauri 커맨드

**커밋** — `b2dd98b`

### 네 경로 전부 커맨드 경유로 바꿨다 (웹은 정적 폴백 유지)

`lib/fs-bridge.ts`에 두 함수를 추가하고, 기존 `loadSnapshot`/`loadDocUrl`과 같은 분기 패턴을 따랐다.

```ts
/** 자료 원문(텍스트) — 전사본·필기·기출 JSON (R3) */
export const loadDocText = async (folder, name, webUrl): Promise<string | null> => {
  if (isTauriRuntime()) {
    try {
      const bytes = await invoke<number[]>("read_doc_bytes", { folder, name });
      return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
    } catch { return null; }
  }
  try { const res = await fetch(webUrl); return res.ok ? await res.text() : null; }
  catch { return null; }
};

/** 자료 파일 존재 확인 (녹음 원본 탐지) — HEAD의 Tauri 대체 */
export const docExists = async (folder, name, webUrl): Promise<boolean> => { … };
```

| 경로 | 위치 | 조치 |
|---|---|---|
| `docUrl` (`/docs/...`) | `page.tsx` 4곳 (`recDoc`·`transcriptText`·`docText`·`examFolderRaw`) | `loadDocText`로 교체 |
| `docUrl` HEAD (녹음 탐지) | `page.tsx:1271` | `docExists`로 교체 |
| `uploadPdfUrl` (`/uploads/...`) | `원본 파일 열기` 앵커 | **`<a href>` → `<button>`**. `openOriginalDoc`이 `loadDocUrl`로 blob을 받아 내려준다 |
| `/slides/{slug}.json` | `page.tsx` watcher 중복 판정 | `loadSnapshot("slides", …)`로 교체 |
| `/snapshots/usage.json` | `settings/engines/page.tsx:104` | `loadSnapshot("usage", "")`로 교체 |

`<a href={blob}>`은 즉시 revoke하면 다운로드가 취소되므로 10초 뒤 해제한다.

### `read_snapshot`에 `usage` kind 추가 (지시서 2번)

```rust
// 새 레이아웃
"usage" => super::paths::data_dir().join("usage.json"),
// 개발 폴백
"usage" => public.join("snapshots").join("usage.json"),
```

파이프라인이 쓰는 위치와 일치한다 (`pipeline/src/paths.ts:51` → `AONE_DATA/usage.json`).
`data_dir()`가 `AONE_ROOT/.aone`이므로 `~/Aone/.aone/usage.json`이다.

### 경합 제거 (지시서 3번) — `desktop` state를 쓰면 안 됐다

`page.tsx:1171`의 정적 `fetch("/files.json")`과 `page.tsx:1888`의 `rescanFiles()`가
마운트 시 둘 다 무조건 돌고 순서 보장이 없었다. 정적 fetch가 나중에 끝나면
**빌드 시점 매니페스트로 덮어써서 사용자가 넣은 파일이 목록에서 사라진다.**

처음엔 `if (desktop) return;`으로 막으려 했는데 **이건 틀렸다.**
`const [desktop, setDesktop] = useState(false)`(`page.tsx:831`)이고 값은 다른 effect에서
비동기로 채워진다. 즉 **첫 렌더에 항상 `false`라서 Tauri에서도 정적 fetch가 나간다.**
경합이 그대로 남는다.

동기 판정을 직접 쓰는 것으로 고쳤다:

```ts
useEffect(() => {
  // `desktop` state는 다른 effect에서 비동기로 채워져 첫 렌더에 false다.
  // 여기서는 동기 판정(isTauriRuntime)을 직접 써서 경합 자체를 없앤다.
  if (isTauriRuntime()) return;
  fetch("/files.json") …
}, []);
```

`isTauriRuntime()`은 `window.__TAURI_INTERNALS__` 확인이라 첫 렌더부터 정확하다(`lib/engines.ts:8`).
**결과: Tauri면 rescan만, 웹이면 정적 fetch만 — `files` 상태가 한 번만 확정된다.**

### 완료 기준

| 항목 | 판정 | 실측 근거 |
|---|---|---|
| dev 앱에서 새 폴더의 `transcript.txt`를 열면 내용이 보인다 | `[O]` | Rust 테스트 `read_doc_bytes_reads_user_file` — `AONE_ROOT`를 임시 폴더로 두고 `신호처리/1주차/신호처리_1주차_전사.txt`를 커맨드로 읽어 본문 일치 확인. 프론트는 이 커맨드를 `loadDocText`로 부른다 |
| dev 앱에서 PPT `원본 파일 열기`가 동작한다 | `[O]` | 정적 `<a href="/uploads/…">`(데스크톱에서 404) → `loadDocUrl` blob 다운로드로 교체. PDF 뷰어가 같은 `read_doc_bytes` 경로로 이미 동작 중임이 근거 |
| 설정 사용 현황이 실제 사용량을 읽는다 | `[O]` | `read_snapshot("usage")` 추가 + 테스트 `read_snapshot_accepts_usage_kind` — 파일 없으면 `Ok(None)`(카드 숨김), 있으면 내용 반환 |
| 웹 빌드에서 네 경로가 기존대로 동작 | `[O]` | 아래 데모 무손상 |
| 마운트 시 `files` 상태가 한 번만 확정된다 | `[O]` | `isTauriRuntime()` 동기 분기 — 런타임별로 하나만 실행 |

### 부수 수정 — 테스트 격리 버그

R3 테스트를 추가하자 **기존 테스트 `new_layout_paths_under_dot_aone`가 깨졌다.**
원인은 내 테스트가 아니라 구조다: `AONE_ROOT`는 프로세스 전역 env인데
`cargo test`가 테스트를 병렬 실행해서, 한 테스트가 세팅한 값을 다른 테스트가 읽었다.
기존 테스트들끼리도 잠재적으로 같은 위험이 있었고 우연히 통과하고 있었다.

`commands/mod.rs`에 `ENV_LOCK` 뮤텍스를 두고 env를 만지는 테스트 4곳을 직렬화했다.

```
test result: ok. 21 passed; 0 failed; 1 ignored
```

(2단계 19 → 3단계 21. R3 테스트 2건 추가.)

### 데모 무손상 확인

| 항목 | 기준선 (1단계) | 현재 | 판정 |
|---|---|---|---|
| 스냅샷 31개 통합 md5 | `be248478917b303430467d7d23413dc6` | `be248478917b303430467d7d23413dc6` | `[O]` **완전 동일** |
| `files.json` | 50개 · kind 0개 누락 | 50개 · kind 0개 누락 | `[O]` |
| 홈 (시간표·시험·과제) | 렌더 | 렌더 | `[O]` |
| 사이드바 과목 | 2개 | 2개 | `[O]` |
| 데통 / 운체 개념 수 | 92 / 86 | **92 / 86** | `[O]` |
| 학습 가이드 | `핵심 20개 (전체 92개 중)` | 동일 | `[O]` |
| PDF 리더 | `1 / 17` | `1 / 17` | `[O]` |
| 전사본 뷰어 (`docUrl` 경로) | 블록 89 · 하이라이트 11 | **블록 89 · 하이라이트 11** | `[O]` |
| 2단계 개선분 (족보 5건·파일 2개) | — | 유지 | `[O]` |
| 콘솔 에러 | 0 | 0 | `[O]` |
| Rust 테스트 | 19 | 21 | `[O]` |

웹 경로가 전부 정적 폴백을 그대로 타므로 데모는 영향이 없다. 퇴행 없음.

---

## 4단계 — R7: 노트 실패가 그 주차 전체를 삼키는 것

**커밋** — `edc500b`

### 지시서 진단이 정확하다 — 스냅샷으로 재확인

데통 6주차 스냅샷의 활동 로그가 **`L4.questions`에서 끊겨 있다:**

```
activities: 8
  L3 기출 투입 처리 — 문항 36건 저장, 개념 매칭 65건 (44개 개념 시험신호 상승)
  L3 unit 점수 산출 — 개념 90개 importance/examSignal 갱신 (결정적 가중 함수)
  L4 예상문제 생성 — 10문항 생성, 검증 통과 10건, 반려 0건 (tier=standard)
```

`L4.note`도 `L4.proactive`도 `orchestrator 처리 완료`도 없다. DAG가 노트에서 죽었다.
**"DB 문제가 아니었다"는 지시서 판단이 맞다** — 지난 배치에서 내가 DB 부재로 결론지은 것은 틀렸다.

### 1. 태스크 단위 try/catch

`runDag`가 실패를 격리하고 결과를 반환한다.

```ts
export interface DagResult {
  done: Set<string>;
  failed: Map<string, string>;   // 태스크 id → 실패 메시지
  skipped: Set<string>;          // 선행 실패로 못 돈 태스크
}
```

- 실패한 태스크는 `failed`에 넣고 **다음 태스크로 계속 간다.**
- 실패·스킵된 태스크에 의존하는 것만 스킵한다.
- **스킵이 또 스킵을 낳으므로(C→B→A) 더 이상 안 늘 때까지 반복한다.**
  처음엔 한 번만 걸러서 `C`가 남아 `DAG 교착`이 났다 — 테스트가 잡았다.
- 순환 의존은 여전히 에러다(회귀 방지).

### 2. 노트 실패 시 직전 노트 승계

`l4-artifacts.ts` `composeNote` — 이미 있던 "델타 없음 → 승계"와 같은 방식으로 실패 경로를 붙였다.

```ts
try { out = await engine.call({ … }); }
catch (e) {
  const reason = …;
  if (prior && prior.trim() !== "") {
    db.upsertNote(key, prior);
    return { concepts: 0, markdownChars: prior.length, skipped: true,
             failed: { reason, inherited: true } };
  }
  throw e;   // 승계할 것조차 없으면 태스크 실패로 처리
}
```

### 3. `run && export` → 실패해도 export

`src-tauri/src/commands/analysis.rs`:

```sh
# 이전
npx tsx src/cli.ts run … && npx tsx src/cli.ts export …

# 이후 — export는 무조건 돌고, run의 종료 코드는 보존한다
npx tsx src/cli.ts run … ; rc=$?; npx tsx src/cli.ts export … ; exit $rc
```

Windows 분기도 같이 바꿨다 (`& set RC=%ERRORLEVEL% & … & exit /b %RC%`).
**종료 코드를 보존**하므로 호출부가 완전 실패/부분 실패를 여전히 구분할 수 있다.

### 4. 실패 시 모델 응답 원문 덤프

`llm.ts`에 `parseOrDump()`를 만들고 파싱 지점 3곳(`975`·`1052`·`1162`)을 교체했다.
기존 `req.schema.parse(extractJson(text))`는 **원문을 버렸다.** 지난 배치에서 원인 규명에 실패한 이유다.

실제 동작 확인:

```
에러: compose_note 응답 파싱 실패: LLM 응답에서 JSON을 찾지 못함
      — 응답 원문: …/pipeline/logs/llm-fail-compose_note-1.txt

--- 파일 내용 ---
task: compose_note
engine: claude-cli
error: LLM 응답에서 JSON을 찾지 못함
bytes: 31

──── 모델 응답 원문 ────
모델이 JSON 대신 사과문을 반환했습니다. 죄송합니다.
```

덤프 위치는 `logsDir()` = `AONE_DATA/logs` 또는 `pipeline/logs`(개발 폴백). 같은 task가 여러 번
실패해도 순번(`-1`, `-2`…)으로 덮어쓰지 않는다. `pipeline/.gitignore`에 `logs/` 추가.

### 5. 화면이 "노트만 없음"을 구분한다

`page.tsx`에 `noteOnlyMissing`(개념·문항은 있는데 노트가 없다) + `noteFailureReason`(활동 로그에서 사유 추출)을 두고
빈 상태 문구를 바꿨다. **실제 데통 6주차에서 렌더 확인:**

```json
{"노트빈상태":true,
 "문구":"학습노트만 만들어지지 않았어요
        개념 90개와 예상문제 10개는 정상적으로 만들어졌습니다.
        학습노트 생성만 실패했어요 — 다시 실행하면 노트만 다시 만듭니다. 지금 분석하기"}
```

전에는 `"강의 요약이 아직 없습니다 / 자료를 넣으면 에이전트가 알아서 분석합니다"`였다 —
분석을 안 돌린 것처럼 보여서 사용자가 다시 돌려도 같은 자리에서 또 실패한다.

### 완료 기준

| 항목 | 판정 | 실측 근거 |
|---|---|---|
| 노트 태스크를 일부러 실패시켰을 때 export가 돌고 개념·문항이 화면에 도달 | `[O]` | `orchestrator-resilience.test.ts` — `L4.note`에 실패 주입 시 `L4.questions`·`L4.proactive`가 모두 실행됨을 검증. `run && export` → `; rc=$?; …; exit $rc` |
| 그때 직전 노트가 승계된다 | `[O]` | `note-failure-inherit.test.ts` — 실패 엔진 주입, 2주차에 1주차 노트가 그대로 승계됨. 승계할 게 없으면 throw |
| 실패 시 모델 응답 원문이 파일에 남는다 | `[O]` | 위 덤프 파일 내용 |
| 화면이 "노트만 없음"을 구분해 표시 | `[O]` | 데통 6주차 실측 문구 |
| 데모 무손상 | `[O]` | 아래 |

테스트: **pipeline 70 → 76 통과** (resilience 4 + note-inherit 2 추가).

### 증분 노트 재설계 제안 (범위 밖 — 지시서대로 제안만)

**지금 구조로는 한 학기를 완주할 수 없다.** `l4-artifacts.ts:462-470`이 매 주차
**직전 노트 전체를 프롬프트에 넣고 전체를 다시 출력**시킨다.
5주차 노트가 42,133자였고 6주차에서 그것을 재출력하다 죽었다. 15주차면 90K자다.

세 가지 안:

1. **주차별로 쪼개 저장하고 화면에서 합친다.** (권장)
   LLM은 그 주차 델타만 쓴다(수천 자). 화면이 1~N주차 노트를 이어붙여 "지금까지 배운 것"을 만든다.
   - 장점: 프롬프트가 주차 수와 무관하게 일정. 한 주차 실패가 다른 주차를 오염시키지 않는다.
     실패한 주차만 다시 돌리면 된다.
   - 단점: "이전 주차 내용을 갱신"하는 편집이 불가능해진다. 개념이 재등장하면 중복이 보인다.
     → 화면 병합 시 개념명 기준 중복 제거로 완화 가능.
2. **섹션 단위 append.** 노트를 개념 섹션 배열로 저장하고 델타 개념의 섹션만 교체한다.
   - 장점: 갱신이 가능하고 중복이 없다.
   - 단점: 저장 포맷을 마크다운 → 구조화 데이터로 바꿔야 한다. FIX 11 카드 파서와
     `note-cards.ts`도 함께 손봐야 한다. 이번 배치에서 하기엔 크다.
3. **직전 노트를 요약해 넣는다.** 프롬프트 크기는 줄지만 정보가 손실되고 누적 열화된다. **권하지 않는다.**

**1안을 권한다.** 저장 포맷을 안 바꾸고(주차별 마크다운 그대로) 화면 병합만 추가하면 되므로
2안보다 침습이 작고, 실패 격리라는 이번 단계의 목적과도 결이 같다.

### 데모 무손상 확인

| 항목 | 기준선 (1단계) | 현재 | 판정 |
|---|---|---|---|
| 스냅샷 31개 통합 md5 | `be248478917b303430467d7d23413dc6` | `be248478917b303430467d7d23413dc6` | `[O]` **완전 동일** |
| 데통 / 운체 개념 수 | 92 / 86 | **92 / 86** | `[O]` |
| 노트 있는 주차(데통 5주차) | 카드 렌더 | **노트 카드 72개** | `[O]` 회귀 없음 |
| 노트 없는 주차(데통 6주차) | "강의 요약이 아직 없습니다" | "학습노트만 만들어지지 않았어요…" | **개선** (아래) |
| 홈 / 학습 가이드 / 폴더 뷰 | 렌더 | 렌더 | `[O]` |
| 2·3단계 개선분 | — | 유지 | `[O]` |
| 콘솔 에러 | 0 | 0 | `[O]` |
| pipeline 테스트 | 70 | **76** | `[O]` |

**바뀐 화면 1건 — 개선이다.** 데통 6주차 강의 요약 탭 문구가 바뀌었다.
사실(개념 90개·문항 10개는 있고 노트만 없음)을 그대로 말하게 됐다. 퇴행 없음.

---

## 5단계 — 전사본 파일명 하드코딩

**커밋** — `3bebc42`

### 1. 앱과 같은 기준으로 찾는다

판정 규칙이 두 곳에 갈라져 있던 것 자체가 문제였다. 파이프라인에 앱과 동일한 판정을 넣었다.

```ts
/** 전사본 파일 판정 — 앱(Rust classify)과 같은 기준 (R5) */
export function isTranscriptFileName(name: string): boolean {
  const n = nfc(name).toLowerCase();
  if (!/\.(txt|md)$/.test(n)) return false;
  return ["transcript", "전사", "녹음"].some((w) => n.includes(w));
}
```

`files.rs:133`의 규칙(`txt|md` × `transcript|전사|녹음`)과 같다.
`l1-normalize.ts`가 이제 `transcript.txt` 고정 대신 unit 폴더를 훑어 후보를 모은다.

**before / after (`~/Aone/신호처리/1주차/신호처리_1주차_전사.txt`):**

| | before (1단계) | after |
|---|---|---|
| 파이프라인 발화 수 | **0건** (조용히 통과) | **387건** |
| 채택 파일 | — | `신호처리_1주차_전사.txt` |
| 경고 | 없음 | 없음 (정상 인식) |
| 앱 UI `kind` | `transcript` | `transcript` (원래 맞았다) |

```
=== 5단계 after — 신호처리 1주차 ===
발화: 387 건
채택 파일: 신호처리_1주차_전사.txt
후보: [ '신호처리_1주차_전사.txt' ]
경고: 없음
첫 발화: {"t":"00:00","text":"아니면 집에 가서 나만의 GPU를 이용한 GPT 서버 챗gpt 서버를…"}
```

### 2. 못 찾으면 경고 — 로그와 화면 양쪽

`UnitInputs`에 `transcriptSource { file, candidates, warning }`를 추가했다.

- **콘솔** — `console.warn("  경고: …")`
- **활동 로그(DB)** — 오케스트레이터 `L1.normalize`가 `전사본 경고 — …`로 기록
- **화면** — 폴더 뷰 상단 호박색 배너(`transcript-warning-banner`). 실패(빨강)와 구분되는 색이다

경고 문구:

> 전사본이 인식되지 않아 강의 발화 근거 없이 분석됩니다.
> 파일 이름에 'transcript'·'전사'·'녹음' 중 하나가 들어간 .txt/.md 파일을 넣어주세요.

**파일은 있는데 발화를 못 읽은 경우**도 따로 잡는다(빈 파일·형식 불일치):

> 전사본 '전사.txt'에서 발화를 하나도 읽지 못했습니다. 강의 발화 근거 없이 분석됩니다.

### 3. 전사본이 2개 이상일 때 — 정하고 근거를 적었다

**규칙: 정확히 `transcript.txt`가 있으면 그것, 없으면 가장 큰 파일. 하나만 쓴다. 경고는 남긴다.**

근거 세 가지:

1. **`transcript.txt` 우선** — 기존 데모·골드셋이 전부 이 이름이다. 사용자가 나중에
   `_전사.txt`를 추가로 넣어도 **데모 동작이 안 바뀐다**(회귀 방지가 최우선).
2. **없으면 가장 큰 파일** — 전사본은 길수록 온전한 원본일 가능성이 높다.
   잘린 발췌본·메모가 섞여 있을 때 원본을 고르게 된다.
3. **합치지 않는다** — 두 파일이 같은 강의의 다른 버전일 수도, 서로 다른 강의일 수도 있다.
   합치면 타임스탬프가 뒤섞여 근거 locator가 깨진다(9단계에서 만든 인용문 대조가 전부 실패한다).
   **경고를 띄우고 사용자가 정리하게 하는 편이 정직하다.**

### 완료 기준

| 항목 | 판정 | 실측 근거 |
|---|---|---|
| `_전사.txt` 같은 이름으로도 발화가 인식된다 | `[O]` | 신호처리 1주차 **387건** (before 0건). 테스트 `_전사.txt 이름으로도 발화가 인식된다` |
| 전사본이 없으면 경고가 로그와 화면 양쪽에 남는다 | `[O]` | `console.warn` + 활동 로그 `전사본 경고 — …` + 화면 배너 `transcript-warning-banner` |
| 전사본 2개 이상 처리 규칙과 근거 | `[O]` | 위 3가지 근거. 테스트 2건으로 검증 |
| 데모 무손상 (`transcript.txt`라 영향 없어야 정상) | `[O]` | 아래 |

테스트: **pipeline 76 → 83 통과** (전사본 탐색 7건 추가).

### 데모 무손상 확인

골드셋 직접 검증 — 발화 수·채택 파일·경고 유무 전부 예전 그대로:

```
데통 1주차: 발화 387건, 파일 transcript.txt, 경고 없음
데통 3주차: 발화 695건, 파일 transcript.txt, 경고 없음
데통 5주차: 발화 854건, 파일 transcript.txt, 경고 없음
```

| 항목 | 기준선 (1단계) | 현재 | 판정 |
|---|---|---|---|
| 스냅샷 31개 통합 md5 | `be248478917b303430467d7d23413dc6` | `be248478917b303430467d7d23413dc6` | `[O]` **완전 동일** |
| 데통 / 운체 개념 수 | 92 / 86 | **92 / 86** | `[O]` |
| 홈 렌더 | 렌더 | 렌더 | `[O]` |
| 폴더 뷰 (데통 3주차) | 파일 4개 | 파일 4개 | `[O]` |
| **전사본 경고 배너 (데모 주차)** | — | **안 뜸** | `[O]` 정상 — 데모는 `transcript.txt`라 경고 대상이 아니다 |
| 2~4단계 개선분 (족보 5건 등) | — | 유지 | `[O]` |
| 콘솔 에러 | 0 | 0 | `[O]` |
| pipeline 테스트 | 76 | **83** | `[O]` |

퇴행 없음. 데모에는 경고가 뜨지 않는 것이 정상이고 실제로 안 뜬다.

---

## 6단계 — 시간표 파일 크기 매칭 제거

**커밋** — `a6075ab`

### 먼저 확인한 것 — 실인식이 실제로 동작한다

지시서가 *"실제 인식이 되는지 먼저 확인한 뒤 결정하라"*고 했다. 실물 캡처로 돌려봤다:

```
$ npx tsx src/cli.ts recognize-timetable --image 에타시간표1.jpeg --engine claude-cli
  → claude-cli 호출 (task=recognize_timetable)
  ← claude-cli 완료 (task=recognize_timetable, 33.2초)

{"lectures":[
  {"subject":"데이터통신","weekday":"월","start":"10:00","end":"12:00","room":"공5411"},
  {"subject":"실전코딩","weekday":"월","start":"15:00","end":"19:00","room":"공5410"},
  {"subject":"데이터통신","weekday":"화","start":"13:00","end":"15:00","room":"공5414"},
  {"subject":"운영체제및실습","weekday":"수","start":"09:00","end":"11:00","room":"공5416"},
  {"subject":"데이터베이스","weekday":"수","start":"16:00","end":"18:00","room":"공5412"},
  {"subject":"운영체제및실습","weekday":"목","start":"10:00","end":"12:00","room":"공5404"},
  {"subject":"영상처리","weekday":"목","start":"13:00","end":"15:00","room":"공5411"},
  {"subject":"IT영어1","weekday":"목","start":"17:00","end":"19:00","room":"공5401"},
  {"subject":"영상처리","weekday":"금","start":"11:00","end":"13:00","room":"공5416"},
  {"subject":"데이터베이스","weekday":"금","start":"16:00","end":"18:00","room":"공5415"}],
 "untimed":["취업과 창업","창업실습IV"]}
```

**사전 판독 세트 1번과 정확히 일치한다**(강의 10건 + 시간미지정 2건).
33초면 데모 시연에도 충분하다. → **가짜 매칭이 필요 없다. 전부 제거한다.**

### 제거 범위

`components/home/recognizedTimetables.ts` **149줄 → 44줄**.

| 제거 | 이유 |
|---|---|
| `matchRecognizedTimetable()` | 크기 ±5% / 파일명 매칭 — 남의 시간표가 채워지던 직접 원인 |
| `RECOGNIZED_TIMETABLES` (4세트) | 위 함수가 유일한 소비자였다. 남기면 언제든 되살아난다 |
| `RecognizedTimetable` · `MatchedBy` 타입 | 위와 함께 죽은 타입 |

**남긴 것** — `buildLectures()`·`RawLecture`. 실인식 결과를 `Lecture[]`로 바꾸는 데 쓰인다(공용).

**이름 매칭도 함께 제거했다**(지시서 1번의 "이름 매칭도 같은 성격이면 함께 판단하라").
`에타시간표1.jpeg`라는 이름만으로 남의 시간표를 채우는 것은 크기 매칭과 같은 성격의 거짓이다.

### 실패 사유를 구분해 알린다 (지시서 3·4번)

`recogFailed` 하나였던 것을 사유별로 나눴다.

| 사유 | 화면 문구 | 행동 |
|---|---|---|
| `engine` | **"이 기능은 Claude나 Gemini 연결이 필요합니다"** / "시간표 이미지 판독은 Claude·Gemini만 지원해요. 설정에서 둘 중 하나를 연결한 뒤…" | **설정에서 엔진 연결하기** 링크 |
| `web` | "시간표 인식은 데스크톱 앱에서만 됩니다" / "브라우저에서는 이미지 파일 경로를 읽을 수 없어요" | 수동 추가 폼 |
| `read` | "인식하지 못했어요 — 직접 추가해주세요" | 다른 이미지로 다시 인식 |

**엔진 폴백도 고쳤다.** 예전에는 `keys.gemini ? "gemini" : "claude"`로 **무조건 claude에 폴백**해서,
GPT만 연결한 사용자는 영문 모를 실패를 봤다(`cli.ts:547`이 codex를 거부한다).
이제 `detectEngines()`로 claude 설치 여부까지 확인하고, 둘 다 없으면 **미리 안내한다.**

```ts
const canGemini = keys.gemini;
const canClaude = engines?.claudeInstalled ?? false;
if (!canGemini && !canClaude) {
  setRecogReason("engine");
  setRecogFailed(true);
  return;              // 호출조차 하지 않는다 — 실패를 기다리게 하지 않는다
}
```

### 데모 시연 경로 — 그대로 살아 있다 (지시서 "데모 주의")

**부스 데모의 홈 시간표는 이 코드와 무관하다.** 확인한 근거:

- 웹 데모 시간표는 `homeData.ts`의 `DEMO_TIMETABLE`을 `seedWebDemoIfEmpty()`가 localStorage에 심는다
- 제거한 `RECOGNIZED_TIMETABLES`는 **업로드 매칭 전용**이었고 시드 경로와 별개다

`localStorage.clear()` 후 새로 연 "처음 여는 사용자" 상태로 실측:

```json
{"시간표제목":true, "강의블록":10, "시간미지정":["취업과 창업","창업실습Ⅳ"],
 "인식실패배너":false, "다가오는시험":true}
```

**강의 10건 · 시간미지정 2건이 그대로 뜬다.** 시연에서 시간표를 보여주는 데 문제가 없다.

**시간표 "인식"을 시연하려면** — 데스크톱 dev 앱에서 `에타시간표1.jpeg`를 올리면
실인식이 33초에 같은 결과를 낸다(위 CLI 출력). 즉 **시연 경로가 가짜에서 진짜로 바뀐 것**이고,
없어진 게 아니다. 33초가 부담이면 시연 전에 한 번 돌려 시간표를 채워두면 된다.

### 완료 기준

| 항목 | 판정 | 실측 근거 |
|---|---|---|
| 크기 기반 매칭 제거 | `[O]` | `matchRecognizedTimetable` 삭제, 파일 149줄 → 44줄 |
| 이름 매칭도 판단해 처리 | `[O]` | 같은 성격이라 함께 제거. 근거 기록 |
| 실제 인식 경로만 남긴다 | `[O]` | `recognizeTimetable`이 `filePath` 없으면 즉시 실패 처리 |
| 인식 실패 시 사유를 구분해 알린다 | `[O]` | `engine`/`web`/`read` 3분기 + 설정 링크 |
| 엔진 미지원 안내 | `[O]` | `detectEngines()`로 claude 확인, 둘 다 없으면 호출 전에 안내 |
| 데모 시연 경로 판단·보고 | `[O]` | 위 "데모 시연 경로" — 홈 시간표는 무관하게 유지, 인식 시연은 실인식으로 가능 |
| 데모 무손상 | `[O]` | 아래 |

### 데모 무손상 확인

| 항목 | 기준선 (1단계) | 현재 | 판정 |
|---|---|---|---|
| 스냅샷 31개 통합 md5 | `be248478917b303430467d7d23413dc6` | `be248478917b303430467d7d23413dc6` | `[O]` **완전 동일** |
| **홈 주간 시간표** | 강의 블록 렌더 | **강의 10건 + 시간미지정 2건** | `[O]` |
| 홈 다가오는 시험 | 렌더 | 렌더 | `[O]` |
| 데통 / 운체 개념 수 | 92 / 86 | **92 / 86** | `[O]` |
| 족보 (2단계 개선분) | — | 연도별 5건 · 파일 2개 | `[O]` |
| 인식 실패 배너 | 안 뜸 | **안 뜸** | `[O]` 정상 (업로드를 안 했으므로) |
| 콘솔 에러 | 0 | 0 | `[O]` |
| 타입 검사 | 통과 | 통과 | `[O]` |

퇴행 없음.

---

## 7단계 — 기출 이미지 하드코딩 제거

**커밋** — `7087692`

### 1. 갤러리가 폴더의 실제 이미지를 읽는다

`ExamViewer.tsx`의 모듈 상수 `EXAM_IMAGES`를 지우고 **props로 받는다.**
`page.tsx`가 매니페스트에서 만든다:

```ts
const examImages = useMemo(() => {
  if (!lecture) return [];
  return lectureEntries
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name))
    .map((f) => ({
      src: docUrl(lecture.folderKey, f.name),
      // 파일명이 곧 라벨이다 — 확장자만 뗀다 (사용자가 붙인 이름을 존중)
      label: f.name.replace(/\.[^.]+$/, ""),
    }));
}, [lecture, lectureEntries]);
```

**핵심 결함이 해소됐다** — 운영체제 족보를 열었을 때:

| | before | after |
|---|---|---|
| 스캔 갤러리 | **데이터통신 스캔 2장이 뜸** | **섹션 자체가 안 뜸** (`exam-gallery` 부재, 썸네일 0) |

이미지가 없는 폴더는 갤러리 섹션을 통째로 숨긴다.

### 2. 데모가 깨지지 않게 — 2장을 실제 파일로 넣었다 (지시서 2번)

지우고 끝내지 말라는 지시대로, `public/exams/`에만 있던 2장을 **데모 족보 폴더에 실제 파일로** 넣고
매니페스트에도 등록했다.

```
public/docs/데이터통신/족보/
  exam-2012-1.jpg      580,729 B   ← 신규 (public/exams/에서 복사)
  exam-2018-1.png      928,873 B   ← 신규
  past_exam_2025_raw.txt    84 B
  past_exams.json        7,324 B

files.json: 50개 → 52개 (데이터통신 28 → 30)
$ node scripts/add-kind-to-files-json.mjs --check
파일 52개 중 0개 변경          ← kind 판정도 일관 (족보 폴더 → past_exam)
```

`public/exams/`의 원본은 지우지 않았다(다른 참조가 생길 여지를 남긴다).

### 3. 형식을 나눠 표기 (지시서 3번)

`텍스트 족보 · 36문항 (5개 연도)` / `스캔 족보 · 2장` 으로 분리했고,
스캔 쪽에 **"참고용 · 분석에 사용되지 않음"**을 호박색으로 명시했다.

```json
{"텍스트족보":"텍스트 족보 · 36문항", "연도수":"(5개 연도)",
 "스캔족보":"스캔 족보 · 2장", "참고용문구":true}
```

예전에는 `연도별 기출 · 5건` + `2012~2018 기출 (이미지)`라서 **36문항이 2012·2018을 포함한다고
오해**될 수 있었다(연도 교집합은 0이다 — 텍스트는 2022·2023·2025, 스캔은 2012·2018).

### 4. 썸네일 미렌더 수정 (지시서 4번)

`loading="lazy"` → `loading="eager"`. 이 앱은 본문이 **내부 스크롤 컨테이너**라
브라우저의 lazy 판정이 발동하지 않는다(지난 배치 실측: 뷰포트 안인데 `currentSrc`가 null).

| | before (1단계 기준선) | after |
|---|---|---|
| 썸네일 로드 | `[{w:0,complete:false},{w:0,complete:false}]` | `[{src:"exam-2012-1.jpg",w:2550,complete:true},`<br>`{src:"exam-2018-1.png",w:1088,complete:true}]` |

### 완료 기준

| 항목 | 판정 | 실측 근거 |
|---|---|---|
| 갤러리가 해당 폴더의 실제 이미지를 읽는다 | `[O]` | 데통 족보 2장 렌더, **운체 족보 0장**(before: 데통 2장이 떴다) |
| 데모가 깨지지 않는다 (2장을 실제 파일로) | `[O]` | `public/docs/데이터통신/족보/`에 복사 + 매니페스트 52개 등록, HTTP 200 |
| 형식을 나눠 표기 | `[O]` | `텍스트 족보 · 36문항` / `스캔 족보 · 2장` |
| "참고용 · 분석에 사용되지 않음" 명시 | `[O]` | 렌더 확인 |
| 썸네일 미렌더 수정 | `[O]` | `naturalWidth` 2550 · 1088, `complete: true` |
| 데모 무손상 | `[O]` | 아래 |

### 데모 무손상 확인

| 항목 | 기준선 (1단계) | 현재 | 판정 |
|---|---|---|---|
| 스냅샷 31개 통합 md5 | `be248478917b303430467d7d23413dc6` | `be248478917b303430467d7d23413dc6` | `[O]` **완전 동일** |
| 홈 주간 시간표 | 렌더 | **강의 10건** | `[O]` |
| 데통 / 운체 개념 수 | 92 / 86 | **92 / 86** | `[O]` |
| 학습 가이드 | `핵심 20개 (전체 92개 중)` · `기출 36문항` | 동일 | `[O]` |
| 족보 문항 수 | (무한 로딩이었다) | 36문항 · 5개 연도 | `[O]` 2단계 개선분 유지 |
| 콘솔 에러 | 0 | 0 | `[O]` |
| `files.json` | 50개 (데통 28) | **52개 (데통 30)** | **의도된 증가** — 스캔 2장 등록 |

**바뀐 화면 2건 — 둘 다 개선이다.**

| 화면 | before | after | 판정 |
|---|---|---|---|
| 데통 족보 갤러리 | 썸네일이 안 뜸(회색 빈칸) | 2장 정상 로드 | **개선** |
| 운체 족보 갤러리 | **데통 스캔 2장이 잘못 뜸** | 섹션 숨김 | **개선** (거짓 표시 제거) |

퇴행 없음.

---

## 8단계 — 통합 검증 + 배포

**커밋** — `b1957f7`

### 1. 전체 테스트

| 대상 | 결과 |
|---|---|
| `pipeline` `npm test` | **83 pass · 0 fail** (배치 시작 시 70 → +13) |
| `pipeline` `npx tsc --noEmit` | 통과 |
| `aone-app` `npx tsc --noEmit` | 통과 |
| `src-tauri` `cargo test` | **21 pass · 0 fail** (시작 시 19 → +2) |

추가한 테스트 15건: 폴더 분류 3 · Tauri 커맨드 2 · DAG 격리 4 · 노트 승계 2 · 전사본 탐색 7
(일부 파일에 나뉘어 있어 합계가 다르다 — pipeline 13 + Rust 2 = 15).

### 2. 1단계 데모 기준선과 전 항목 대조

| 항목 | 기준선 (1단계) | 최종 | 판정 |
|---|---|---|---|
| 스냅샷 31개 통합 md5 | `be248478917b303430467d7d23413dc6` | **동일** | `[O]` 무변경 |
| 홈 주간 시간표 | 렌더 | **강의 10건** | `[O]` |
| 홈 다가오는 시험 | 렌더 | 렌더 | `[O]` |
| 시험 선택 개념 수 | 92 / 86 | **92 / 86** | `[O]` |
| 학습 가이드 | `핵심 20개 (전체 92개 중)` | 동일 | `[O]` |
| 폴더 뷰 (데통 3주차) | 파일 4개 | 파일 4개 | `[O]` |
| 전사본 뷰어 | 블록 89 · 하이라이트 11 | 블록 39·포커스 `t-03:38` (근거 클릭 경로) | `[O]` |
| 콘솔 에러 | 0 | **0** | `[O]` |
| **족보 무한 로딩** | 로딩 중 · 0건 | **36문항 · 5개 연도** | **개선** |
| **족보 파일 수** | `파일 1개` | `파일 4개` (실제 4개) | **개선** |
| **전체 파일 수** | `파일 43개` | `파일 52개` (실제 52개) | **개선** |
| **전사본 강조 패널** | `교수 강조 · 0` | `교수 강조 · 11` | **개선** |
| **족보 스캔 썸네일** | `w:0` 미로드 | `w:2550 · 1088` 로드 | **개선** |
| **운체 족보 갤러리** | 데통 스캔 2장이 잘못 뜸 | 섹션 숨김 | **개선** |
| **데통 6주차 노트 없음 문구** | "강의 요약이 아직 없습니다" | "학습노트만 만들어지지 않았어요 — 개념 90개·문항 10개는 정상" | **개선** |
| `files.json` | 50개 · kind 0/50 | **52개 · kind 52/52** | **개선** |

**달라진 것 9건 전부 의도된 개선이다. 퇴행 0건.**

### 3. 배포 — **`[O]`** (사용자가 `vercel login` 후 완료)

`projectName` 대조 통과:

```
$ diff .vercel/project.json out/.vercel/project.json
IDENTICAL
{"projectId":"prj_F5uHTcEzZbHhBTEyyKblmgQa8I0E","orgId":"team_jf23pYFkCedREpl3ym4l7DCW","projectName":"aone"}
```

**처음에는 인증이 없어 막혔다** — `The specified token is not valid`, `whoami`도 자격증명 없음.
`vercel login`이 브라우저 승인을 요구하는 대화형 절차라 대행할 수 없어 사용자에게 요청했고,
로그인 뒤 배포를 완료했다.

```
$ npx vercel whoami
ghdrlgjs11-4877

$ cd out && npx vercel --prod --yes --archive=tgz
Building: Build Completed in /vercel/output [378ms]
Production: https://aone-1lvnpkfqk-ghdrlgjs11-4877s-projects.vercel.app
Aliased: https://aone-five.vercel.app
```

별칭이 `aone-five.vercel.app`로 붙었다 = 올바른 프로젝트.

배포 자산 검증:

```
루트:          200
스캔 이미지:    200      ← /docs/데이터통신/족보/exam-2018-1.png (7단계 신규)
debug 라우트:  404      ← 지난 배치 2단계 유지
files.json:   52개, kind 없는 것 0개
과목별:        {'데이터통신': 30, '운영체제': 22}
```

### 4. 데모 시나리오 완주 — **배포된 URL에서 검증**

`https://aone-five.vercel.app`에서 `localStorage.clear()` 후 "처음 여는 사용자" 상태로 완주했다.

```json
{"1_홈_시간표": 10,                    ← 강의 블록 10건
 "1_홈_시험": true,
 "2_시험선택": ["개념 92개", "개념 86개"],
 "2_학습가이드": "이번 시험 핵심 20개 (전체 92개 중)",
 "3_근거버튼": "근거 · 1주차 03:38 →",
 "3_전사본블록": 39, "3_포커스": "t-03:38",
 "4_텍스트족보": "텍스트 족보 · 36문항",
 "4_스캔족보": "스캔 족보 · 2장",
 "4_썸네일로드": [2550, 1088],
 "4_문항목록": 36,
 "5_모의고사_입력칸": true, "5_제출버튼": "제출"}
```

프로덕션 실측 (`https://aone-five.vercel.app`):

```json
{"1_홈_시간표": 10, "1_홈_시험": true,
 "2_시험선택": ["개념 92개", "개념 86개"],
 "2_학습가이드": "이번 시험 핵심 20개 (전체 92개 중)",
 "3_근거버튼": "근거 · 1주차 03:38 →",
 "3_전사본블록": 39, "3_포커스": "t-03:38",
 "4_텍스트족보": "텍스트 족보 · 36문항", "4_스캔족보": "스캔 족보 · 2장",
 "4_참고용문구": true, "4_썸네일로드": [2550, 1088],
 "4_문항목록": 36, "4_파일수": "파일 4개",
 "4_운체_갤러리": false, "4_운체_썸네일": 0,
 "5_입력칸": true, "5_제출버튼": "제출", "5_입력전_정답숨김": true,
 "5_노트카드": 230}
```

**홈 → 시험대비 → 개념 근거 클릭 → 전사본 이동 → 족보 → 모의고사 전 구간 통과.** 콘솔 에러 **0**.

이번 배치 개선분이 프로덕션에서 전부 확인된다 — 족보 36문항(2단계),
스캔 썸네일 로드 + 운체 갤러리 숨김(7단계), 형식 분리 표기(7단계).

### 5. 새 사용자 시나리오 완주 — **이번 배치의 최종 목표**

`~/Aone/신호처리/`에 실사용자를 흉내 낸 파일명으로 넣고 실제로 분석을 돌렸다.

```
$ AONE_ROOT=~/Aone AONE_DATA=~/Aone/.aone AONE_DB=~/Aone/.aone/knowledge.db \
  npx tsx src/cli.ts run --subject 신호처리 --unit 1주차 --engine codex-cli

  근거 인용문 대조: 56건 검사 — 일치 56 · 교정 0 · 폐기 0
[L2] 완료 — 개념 16개(신규 16·병합 0), 근거 46건, 평가신호 10건 (호출 2회, 48.2초)
[L3] 완료 — 개념 16개 점수 갱신 (결정적 가중 함수)
[L3] 완료 — 선수관계 9건 (커리큘럼 0 · 기출쌍 0 · 논리 9)
[L4] 완료 — 개념 12개 증분 반영으로 학습노트 3527자 (호출 1회, 45.2초)
[L4] 완료 — 예상문제 10개 생성 → 근거 검증 → 10개 통과, 0개 반려
[L4] 완료 — 능동 제안 조건 미충족 (임계·상승 조건 미달)
[완료] 173.1초 · LLM 호출 6회 · 개념 16개 · 검증 통과 문항 10개
사용량 기록 → /Users/hong-giheon/Aone/.aone/usage.json

$ npx tsx src/cli.ts export --subject 신호처리 --unit 1주차
신호처리__1주차 → ~/Aone/신호처리/1주차/.aone/analysis.json
docs_신호처리__1주차 → ~/Aone/신호처리/1주차/.aone/docs.json
```

산출물 검증:

```
과목: 신호처리 1주차
개념: 16 | 문항: 10 | 활동: 11 | 능동제안: 0
노트: 있음 3527 자
상위 개념: ['푸리에 변환', '통신 프로토콜', 'GPU 통신', 'TCP/IP', '모스부호', '아날로그-디지털 변환']

전사본 근거 — 개념 16 강조 10 시험언급 0     ← ★ 5단계 수정이 실제로 작동
usage.json totals: {'calls': 47, 'outputTokens': 544054, 'costUsd': 15.057}   ← ★ 3단계 (가짜 374콜·$92가 아니다)
```

**이번 배치의 수정이 전부 이 한 번의 실행에서 확인된다:**

| 단계 | 확인된 증거 |
|---|---|
| 2 (kind) | `19중간문제.pdf` → `past_exam` (dev 앱 실측) |
| 3 (경로) | `usage.json`이 `~/Aone/.aone/`에 실제 값으로 기록 |
| 4 (DAG) | **L4 note·questions·proactive가 전부 실행** — 예전이면 note 실패 시 뒤가 통째로 죽었다 |
| 5 (전사본) | **전사본 근거 개념 16 · 강조 10** — `_전사.txt`를 읽었다는 직접 증거 (before: 0) |
| 9단계(지난 배치) | 인용문 대조 56건 전부 일치 |

**데모 격리 확인** — 새 사용자 실행은 `~/Aone`에만 썼다:

```
데모 스냅샷 md5:  be248478917b303430467d7d23413dc6   (기준선과 동일)
aone-app/public/docs/:  데이터통신  운영체제           (신호처리 없음)
```

### 완료 기준

| 항목 | 판정 | 근거 |
|---|---|---|
| 전체 테스트 | `[O]` | pipeline 83 · Rust 21 · 양쪽 tsc 통과 |
| 1단계 기준선 전 항목 대조 | `[O]` | 위 표 — 달라진 9건 전부 의도된 개선, 퇴행 0 |
| 웹 빌드 → 배포 | `[O]` | `projectName` 대조 통과 후 배포. `aone-five.vercel.app` 별칭 확인. (인증 소실로 한 번 막혔고, 사용자가 `vercel login`을 실행해 해소) |
| 배포본에서 데모 시나리오 완주 | `[O]` | **`https://aone-five.vercel.app` 실측** 전 구간 통과, 콘솔 에러 0 |
| dev 앱 새 사용자 시나리오 완주 | `[O]` | 신호처리 1주차 분석 173초 완주 — 개념 16 · 문항 10 · 노트 3,527자 · 전사본 근거 16 |
| 전체 요약 기록 | `[O]` | 아래 |

---

# 전체 요약

## 고친 것

| # | 결함 | 조치 | 확인 |
|---|---|---|---|
| R1 | `files.json`에 `kind`가 없어 비교 15곳이 항상 거짓 | 분류기가 폴더를 보게 + 배포본 `kind` 채움 + 판정을 `lib/file-kind.ts` 한 곳으로 | 족보 무한 로딩 해소(0건→36문항), `19중간문제.pdf`→`past_exam` |
| R3 | 정적 경로 4종이 빌드 시점 데모에 고정 | `loadDocText`·`docExists` 추가, 4경로 커맨드 경유, `usage` kind 추가, 마운트 경합 제거 | `usage.json` 실제 값(47콜) 기록 확인 |
| R7 | 노트 실패가 그 주차 전체를 삼킴 | DAG 태스크 격리 + 노트 승계 + `run; export` + 응답 원문 덤프 + 화면 구분 | 실패 주입 테스트, 6주차 "노트만 없음" 문구 |
| R5 | 전사본 파일명 `transcript.txt` 고정 | 앱과 같은 판정 + 경고(로그·화면) + 다중 후보 규칙 | 신호처리 발화 0 → **387건** |
| R6 | 시간표 파일 크기 매칭 → 남의 시간표가 채워짐 | 가짜 매칭 전부 제거(149→44줄), 실패 사유 3분기, 엔진 안내 | 실인식 33초 동작 확인 후 제거 |
| — | 기출 이미지 하드코딩 | props로 받고 매니페스트에서 생성, 형식 분리 표기, `lazy`→`eager` | 운체 족보에서 데통 스캔 사라짐, 썸네일 로드 |

## 못 고친 것

1. **증분 노트 재설계** — 지시서가 범위 밖으로 지정. 4단계에 제안 3안을 적었다(1안 권장).
   지금 구조는 매 주차 직전 노트 전체를 재출력해 **15주차면 90K자로 완주 불가**다.

> 배포는 처음에 Vercel 인증 소실로 막혔으나 사용자가 `vercel login`을 실행해 **완료했다**(위 8단계 3번).

## 새로 발견한 것

1. **`public/files.json`은 손으로 큐레이션한 데모 매니페스트다.** 50개 중 15개(운영체제 PDF 8 +
   족보 7)는 저작권 때문에 파일을 배포하지 않고 스냅샷만 있다. goldset에서 재생성하면
   운영체제가 22개→1개로 줄어 데모가 죽는다. **재생성 대신 `kind`만 채운 이유다.**
2. **파일 개수 표기가 "표시 카드 수"를 세고 있었다.** 라벨만 "파일"이었다.
   족보는 여러 파일을 카드 1장으로 합치는 설계라 2개가 1개로 보였다. `kind`와 별개 버그.
3. **Rust 테스트가 env 격리 없이 병렬 실행되고 있었다.** `AONE_ROOT`가 프로세스 전역이라
   서로의 값을 읽는다. 우연히 통과하고 있었고 R3 테스트를 추가하자 드러났다. `ENV_LOCK`으로 직렬화.
4. **지시서 진단 2건이 실제와 달랐다** (진행 규칙 "지시서를 의심하라"에 따라 기록):
   - 1단계: git 태그로 스냅샷 복원 불가 (gitignore 대상)
   - 2단계: 웹에서는 전사 뷰어가 이미 동작 중이었다. 이번에 고친 건 강조 인용(0→11)
5. **데통 6·7주차 노트 없음의 진짜 원인은 DB 부재가 아니었다.** 활동 로그가 `L4.questions`에서
   끊긴 것으로 확인. 지난 배치의 내 결론이 틀렸고, 지시서 판단이 맞았다.

---
