"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  FolderCheck,
  ImagePlus,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import TimetableGrid from "./TimetableGrid";
import ExamsPanel from "./ExamsPanel";
import AssignmentsPanel from "./AssignmentsPanel";
import {
  buildLectures,
  matchRecognizedTimetable,
  type RawLecture,
} from "./recognizedTimetables";
import {
  apiKeyStatus,
  isTauriRuntime,
  pickTimetableImage,
  recognizeTimetableImage,
} from "@/lib/engines";
import { createSubjectFolders } from "@/lib/fs-bridge";
import { getUserName } from "@/lib/user";
import {
  loadAssignments,
  loadExams,
  loadTimetable,
  loadUntimedSubjects,
  newId,
  saveAssignments,
  saveExams,
  saveTimetable,
  saveUntimedSubjects,
  WEEKDAYS,
  type Assignment,
  type Exam,
  type Lecture,
  type Weekday,
} from "./homeData";

const greetingOf = (hour: number): string => {
  if (hour >= 5 && hour < 11) return "좋은 아침이에요";
  if (hour >= 11 && hour < 18) return "좋은 오후예요";
  if (hour >= 18 && hour < 23) return "좋은 저녁이에요";
  return "늦은 밤까지 수고가 많아요";
};

const KO_WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/** 홈 화면이 부모(page.tsx)에 노출하는 명령 — 창 드롭으로 들어온 이미지 처리 */
export interface HomeViewHandle {
  /**
   * 시간표 인식 플로우 시작 (업로드 CTA와 동일 경로).
   * filePath(절대 경로)가 있으면 데모 매칭 실패 시 실인식(recognize_timetable)으로 넘어간다.
   */
  recognizeTimetable: (
    fileName: string,
    fileSize: number,
    filePath?: string
  ) => void;
}

interface Props {
  handleRef?: React.Ref<HomeViewHandle>;
  /** 시험·과제 폼의 과목 선택지 — 매니페스트(files.json) subjects */
  subjects: string[];
  /** 과목 폴더 생성 후 매니페스트 재스캔 — 부모(page.tsx)의 rescanFiles + setFiles */
  refreshManifest?: () => Promise<void>;
}

/** 홈 화면 — 인사말 + 주간 시간표(데모 OCR) + 시험/과제 패널 (무스크롤 1화면) */
export default function HomeView({ handleRef, subjects, refreshManifest }: Props) {
  const [ready, setReady] = useState(false);
  const [userName, setUserName] = useState("사용자");
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [untimed, setUntimed] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [recognizing, setRecognizing] = useState(false);
  /** 실인식 실패 — "인식하지 못했어요" 안내 + 수동 추가 폼 유도 */
  const [recogFailed, setRecogFailed] = useState(false);
  /** 인식 성공 팝업 — 과목 폴더를 만든 뒤 보여줄 과목명 목록 (null이면 닫힘) */
  const [recogSubjects, setRecogSubjects] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLectures(loadTimetable());
    setUntimed(loadUntimedSubjects());
    setAssignments(loadAssignments());
    setExams(loadExams());
    setUserName(getUserName());
    setReady(true);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const applyTimetable = useCallback((next: Lecture[], nextUntimed: string[]) => {
    setLectures(next);
    saveTimetable(next);
    setUntimed(nextUntimed);
    saveUntimedSubjects(nextUntimed);
  }, []);

  /**
   * 인식 성공 공통 후처리 (fast-path·실인식) — 시간표 적용 후
   * 고유 과목명(시간 있는 강의 + 시간 미지정, NFC)으로 goldset 과목 폴더를 만들고
   * 매니페스트를 재스캔한 뒤 성공 팝업을 띄운다.
   * 브라우저 모드에서는 폴더 생성 없이 시간표만 적용 (팝업 생략).
   */
  const finishRecognition = useCallback(
    (next: Lecture[], nextUntimed: string[]) => {
      applyTimetable(next, nextUntimed);
      if (!isTauriRuntime()) return;
      const seen = new Set<string>();
      const names: string[] = [];
      for (const raw of [...next.map((l) => l.subject), ...nextUntimed]) {
        const name = raw.trim().normalize("NFC");
        if (name !== "" && !seen.has(name)) {
          seen.add(name);
          names.push(name);
        }
      }
      if (names.length === 0) return;
      // 과목마다 '족보' 폴더도 함께 생성 — 기출 빈출 분석의 전제 (강제 배치)
      const folders = names.flatMap((n) => [n, `${n}/족보`]);
      void (async () => {
        try {
          await createSubjectFolders(folders);
          await refreshManifest?.();
          setRecogSubjects(names);
        } catch {
          // 폴더 생성 실패 — 시간표 적용은 유지, 팝업만 생략
        }
      })();
    },
    [applyTimetable, refreshManifest]
  );

  // ── 시간표 인식 플로우 — 내장 데모 4장은 fast-path, 그 외는 실인식(A2) ──
  // 업로드 CTA(파일 선택)와 창 드래그&드롭이 공유하는 단일 경로.
  const recognizeTimetable = useCallback(
    (fileName: string, fileSize: number, filePath?: string) => {
      setRecogFailed(false);
      const matched = matchRecognizedTimetable(fileName, fileSize);
      if (matched) {
        // fast-path — 내장 데모 캡처 (파일명·크기 매칭)
        setRecognizing(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          finishRecognition(matched.set.lectures, matched.set.untimed);
          setRecognizing(false);
        }, 2500);
        return;
      }
      // 실인식 — 절대 경로가 있어야 파이프라인이 이미지를 읽을 수 있다
      if (!filePath || !isTauriRuntime()) {
        setRecogFailed(true);
        return;
      }
      setRecognizing(true);
      void (async () => {
        try {
          // Gemini 키가 있으면 gemini, 아니면 claude — codex는 백엔드가 거부
          const keys = await apiKeyStatus().catch(() => ({ gemini: false }));
          const result = await recognizeTimetableImage(
            filePath,
            keys.gemini ? "gemini" : "claude"
          );
          const raws: RawLecture[] = [];
          const extraUntimed: string[] = [];
          for (const l of result.lectures) {
            if ((WEEKDAYS as string[]).includes(l.weekday)) {
              raws.push({ ...l, weekday: l.weekday as Weekday });
            } else if (!extraUntimed.includes(l.subject)) {
              extraUntimed.push(l.subject);
            }
          }
          const nextUntimed = [
            ...result.untimed,
            ...extraUntimed.filter((s) => !result.untimed.includes(s)),
          ];
          if (raws.length === 0 && nextUntimed.length === 0) {
            setRecogFailed(true);
          } else {
            finishRecognition(buildLectures("ai", raws), nextUntimed);
          }
        } catch {
          setRecogFailed(true);
        } finally {
          setRecognizing(false);
        }
      })();
    },
    [finishRecognition]
  );

  /** 이미지 선택 — Tauri면 네이티브 다이얼로그(절대 경로 확보 → 실인식 가능), 브라우저면 file input */
  const pickImage = useCallback(() => {
    if (!isTauriRuntime()) {
      fileRef.current?.click();
      return;
    }
    void (async () => {
      try {
        const path = await pickTimetableImage();
        if (!path) return;
        const name = path.split("/").pop() ?? path;
        let size = 0;
        try {
          const res = await fetch(`file://${path}`, { method: "HEAD" });
          size = Number(res.headers.get("content-length") ?? 0);
        } catch {
          // 크기 조회 실패 시 0 — fast-path 크기 매칭만 건너뛴다
        }
        recognizeTimetable(name, size, path);
      } catch {
        setRecogFailed(true);
      }
    })();
  }, [recognizeTimetable]);

  useImperativeHandle(handleRef, () => ({ recognizeTimetable }), [
    recognizeTimetable,
  ]);

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    recognizeTimetable(file.name, file.size);
  };

  const resetTimetable = () => {
    setLectures([]);
    saveTimetable([]);
    setUntimed([]);
    saveUntimedSubjects([]);
    setRecogFailed(false);
  };

  /** 수동 추가 (인식 실패 시 폴백 폼) — 기존 시간표에 한 칸 추가 */
  const addManualLecture = (raw: RawLecture) => {
    const next = [
      ...lectures,
      ...buildLectures(newId("manual"), [raw]),
    ];
    setLectures(next);
    saveTimetable(next);
    setRecogFailed(false);
  };

  // ── 과제 · 시험 CRUD ──────────────────────────────────────
  const addExam = (exam: Omit<Exam, "id">) => {
    const next = [...exams, { ...exam, id: newId("exam") }];
    setExams(next);
    saveExams(next);
  };

  const removeExam = (id: string) => {
    const next = exams.filter((e) => e.id !== id);
    setExams(next);
    saveExams(next);
  };

  const addAssignment = (assignment: Omit<Assignment, "id">) => {
    const next = [...assignments, { ...assignment, id: newId("asgn") }];
    setAssignments(next);
    saveAssignments(next);
  };

  const removeAssignment = (id: string) => {
    const next = assignments.filter((a) => a.id !== id);
    setAssignments(next);
    saveAssignments(next);
  };

  if (!ready) return <div className="min-h-0 flex-1 p-6" />;

  const now = new Date();
  const dateLine = `${now.getMonth() + 1}월 ${now.getDate()}일 (${KO_WEEKDAY[now.getDay()]})`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-5 lg:p-6">
      {/* 인사말 — 컴팩트 한 줄 */}
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1
          className="text-xl font-bold tracking-tight text-gray-900"
          data-testid="home-greeting"
        >
          {greetingOf(now.getHours())}, {userName}님
        </h1>
        <p className="text-[13px] font-medium text-gray-400">
          {dateLine} · 이번 주 일정을 한눈에 확인하세요
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* 좌: 주간 시간표 — 가용 높이에 맞춰 그리드 자동 축소 */}
        <section className="glass-card flex min-h-0 flex-col rounded-2xl p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-gray-900">
              <CalendarDays className="h-4 w-4 text-primary" aria-hidden />
              주간 시간표
            </h2>
            {lectures.length > 0 && !recognizing && (
              <button
                onClick={resetTimetable}
                className="press-scale flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-gray-400 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-700"
                title="시간표를 비우고 다시 인식"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                다시 인식
              </button>
            )}
          </div>

          <div className="relative min-h-0 flex-1">
            <TimetableGrid lectures={lectures} />

            {/* 빈 시간표 CTA / 인식 중 오버레이 */}
            {(lectures.length === 0 || recognizing) && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-white/70 backdrop-blur-[2px]">
                {recognizing ? (
                  <div
                    className="flex flex-col items-center text-center"
                    data-testid="timetable-recognizing"
                  >
                    <span
                      className="spinner spinner-dark mb-4 !h-7 !w-7"
                      aria-hidden
                    />
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                      <Sparkles className="h-4 w-4 text-purple-500" aria-hidden />
                      AI가 시간표를 인식하는 중…
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      과목 · 시간 · 강의실 정보를 추출하고 있어요
                    </p>
                  </div>
                ) : recogFailed ? (
                  /* 실인식 실패 — 가짜 데모 시간표 대신 안내 + 수동 추가 폼 */
                  <div
                    className="flex w-full max-w-sm flex-col items-center rounded-2xl border-2 border-dashed border-black/10 bg-white/85 px-6 py-6 text-center"
                    data-testid="timetable-recognize-failed"
                  >
                    <span className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10">
                      <AlertTriangle
                        className="h-5 w-5 text-amber-500"
                        aria-hidden
                      />
                    </span>
                    <p className="text-sm font-semibold text-gray-800">
                      인식하지 못했어요 — 직접 추가해주세요
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-400">
                      아래에서 과목을 직접 추가하거나, 다른 캡처 이미지로 다시
                      시도할 수 있어요.
                    </p>
                    <ManualLectureForm onAdd={addManualLecture} />
                    <button
                      onClick={pickImage}
                      className="press-scale mt-3 text-xs font-medium text-primary underline-offset-2 hover:underline"
                    >
                      다른 이미지로 다시 인식
                    </button>
                  </div>
                ) : (
                  <div className="flex w-full max-w-sm flex-col items-center rounded-2xl border-2 border-dashed border-black/10 bg-white/80 px-8 py-8 text-center">
                    <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                      <ImagePlus className="h-6 w-6 text-primary" aria-hidden />
                    </span>
                    <p className="text-sm font-semibold text-gray-800">
                      에브리타임 시간표 캡처 업로드
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-400">
                      캡처 이미지를 올리면 AI가 과목과 시간을
                      <br />
                      인식해 시간표를 자동으로 채워드려요
                    </p>
                    <button
                      onClick={pickImage}
                      className="press-scale mt-4 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      이미지 선택
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 시간 미지정 과목 (온라인 강의 등) */}
          {untimed.length > 0 && !recognizing && lectures.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-black/5 pt-2.5">
              <span className="text-[11px] font-medium text-gray-400">
                시간 미지정
              </span>
              {untimed.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] font-medium text-gray-600"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* 우: 시험 · 과제 — 각 패널 내부 스크롤 */}
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          <ExamsPanel
            exams={exams}
            subjects={subjects}
            onAdd={addExam}
            onRemove={removeExam}
          />
          <AssignmentsPanel
            assignments={assignments}
            subjects={subjects}
            onAdd={addAssignment}
            onRemove={removeAssignment}
          />
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelected}
        className="hidden"
        aria-label="시간표 캡처 이미지 선택"
      />

      {/* 인식 성공 팝업 — 과목 폴더 생성 안내 */}
      {recogSubjects && (
        <SubjectFoldersModal
          subjects={recogSubjects}
          onClose={() => setRecogSubjects(null)}
        />
      )}
    </div>
  );
}

/**
 * 시간표 인식 성공 팝업 — 만들어둔 과목 폴더 안내.
 * 온보딩 모달과 같은 디자인 언어 (글래스 카드 · 파란 CTA).
 */
function SubjectFoldersModal({
  subjects,
  onClose,
}: {
  subjects: string[];
  onClose: () => void;
}) {

  const confirm = () => {
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="subject-folders-modal"
    >
      <div className="glass-panel w-full max-w-md rounded-[28px] p-8 text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <FolderCheck className="h-6 w-6 text-primary" aria-hidden />
        </span>
        <h2 className="text-lg font-bold tracking-tight text-gray-900">
          시간표에서 과목 {subjects.length}개를 인식했어요
        </h2>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          {subjects.map((s) => (
            <span
              key={s}
              className="rounded-full bg-black/[0.04] px-2.5 py-1 text-xs font-medium text-gray-700"
            >
              {s}
            </span>
          ))}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-gray-500">
          과목 폴더를 만들어뒀어요 — 이제 강의 자료를 넣기만 하면 됩니다
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={confirm}
            data-testid="subject-folders-confirm"
            className="press-scale rounded-xl bg-primary px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

/** 인식 실패 폴백 — 과목 한 칸 수동 추가 폼 */
function ManualLectureForm({ onAdd }: { onAdd: (raw: RawLecture) => void }) {
  const [subject, setSubject] = useState("");
  const [weekday, setWeekday] = useState<Weekday>("월");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [room, setRoom] = useState("");

  const canAdd = subject.trim() !== "" && start < end;

  const submit = () => {
    if (!canAdd) return;
    onAdd({ subject: subject.trim(), weekday, start, end, room: room.trim() });
    setSubject("");
    setRoom("");
  };

  const inputCls =
    "rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs text-gray-800 focus:border-primary focus:outline-none";

  return (
    <div
      className="mt-3 w-full space-y-2 text-left"
      data-testid="timetable-manual-form"
    >
      <div className="grid grid-cols-[1fr_72px] gap-2">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="과목명"
          className={inputCls}
          aria-label="과목명"
        />
        <select
          value={weekday}
          onChange={(e) => setWeekday(e.target.value as Weekday)}
          className={inputCls}
          aria-label="요일"
        >
          {WEEKDAYS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
        <input
          type="time"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className={inputCls}
          aria-label="시작 시간"
        />
        <input
          type="time"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className={inputCls}
          aria-label="종료 시간"
        />
        <input
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          placeholder="강의실"
          className={inputCls}
          aria-label="강의실"
        />
      </div>
      <button
        onClick={submit}
        disabled={!canAdd}
        className="press-scale flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        시간표에 추가
      </button>
    </div>
  );
}
