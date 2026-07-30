# Aone 1차 수정 실행 기록

`AONE_1차수정_지시.md` 1~8단계 수행 결과. 단계가 끝날 때마다 append 한다.

**전제** — 경진대회 출품작이 아니라 **모르는 사람이 받아 자기 강의로 쓰는 제품**. 판단 기준은
"처음 쓰는 사람이 여기서 막히나". 단 **부스 데모(데이터통신·운영체제)는 계속 동작해야 한다.**

---

## 1단계 — 데모 고정 + 검증 환경 확보

**커밋** — `PENDING1`

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
