// 홈 화면 데이터 모델 · 데모 시간표 · localStorage 헬퍼

export type Weekday = "월" | "화" | "수" | "목" | "금";

export const WEEKDAYS: Weekday[] = ["월", "화", "수", "목", "금"];

export type LectureColor = "blue" | "emerald" | "violet" | "amber" | "rose";

export interface Lecture {
  id: string;
  subject: string;
  weekday: Weekday;
  start: string; // "10:00"
  end: string; // "12:00"
  room: string;
  color: LectureColor;
}

export interface Assignment {
  id: string;
  subject: string;
  title: string;
  due: string; // "YYYY-MM-DD"
}

export interface Exam {
  id: string;
  subject: string;
  title: string; // "중간고사" 등
  date: string; // "YYYY-MM-DD"
}

/** 시간표 블록 파스텔 컬러 */
export const LECTURE_COLOR_CLASSES: Record<
  LectureColor,
  { block: string; title: string; sub: string }
> = {
  blue: {
    block: "border-blue-200 bg-blue-50",
    title: "text-blue-900",
    sub: "text-blue-500",
  },
  emerald: {
    block: "border-emerald-200 bg-emerald-50",
    title: "text-emerald-900",
    sub: "text-emerald-600",
  },
  violet: {
    block: "border-violet-200 bg-violet-50",
    title: "text-violet-900",
    sub: "text-violet-500",
  },
  amber: {
    block: "border-amber-200 bg-amber-50",
    title: "text-amber-900",
    sub: "text-amber-600",
  },
  rose: {
    block: "border-rose-200 bg-rose-50",
    title: "text-rose-900",
    sub: "text-rose-500",
  },
};

// ── 날짜 유틸 ────────────────────────────────────────────────
const pad = (n: number): string => String(n).padStart(2, "0");

export const isoDaysFromNow = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 오늘 자정 기준 D-day (양수: 남음, 0: 오늘, 음수: 지남) */
export const dday = (dateStr: string): number => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
};

export const ddayLabel = (diff: number): string =>
  diff > 0 ? `D-${diff}` : diff === 0 ? "D-Day" : `D+${Math.abs(diff)}`;

const KO_WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-07-28" → "7/28 (화)" */
export const formatDateK = (dateStr: string): string => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return `${date.getMonth() + 1}/${date.getDate()} (${KO_WEEKDAY[date.getDay()]})`;
};

// ── localStorage ────────────────────────────────────────────
const TIMETABLE_KEY = "aone.home.timetable.v1";
const UNTIMED_KEY = "aone.home.timetableUntimed.v1";
const ASSIGNMENTS_KEY = "aone.home.assignments.v1";
const EXAMS_KEY = "aone.home.exams.v1";

/**
 * 요소 검증 함수로 정상화된 배열을 로드한다.
 * localStorage가 손상(잘못된 JSON·비배열·오염 요소)돼도 크래시 없이
 * 유효 요소만 남긴다. 유효 요소가 없으면 빈 배열/그대로 반환.
 */
const loadValidated = <T,>(
  key: string,
  validate: (x: unknown) => T | null,
): T[] | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map(validate)
      .filter((x): x is T => x !== null);
  } catch {
    return null;
  }
};

const isNonEmptyString = (x: unknown): x is string =>
  typeof x === "string" && x.length > 0;

const VALID_COLORS: readonly LectureColor[] = [
  "blue",
  "emerald",
  "violet",
  "amber",
  "rose",
];

/** Lecture 요소 검증 — 필수 필드·유효 weekday/color 확인. 오염 시 null(드롭). */
const validateLecture = (x: unknown): Lecture | null => {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (
    !isNonEmptyString(o.id) ||
    !isNonEmptyString(o.subject) ||
    !isNonEmptyString(o.start) ||
    !isNonEmptyString(o.end)
  )
    return null;
  const weekday = WEEKDAYS.includes(o.weekday as Weekday)
    ? (o.weekday as Weekday)
    : null;
  if (!weekday) return null;
  const color = VALID_COLORS.includes(o.color as LectureColor)
    ? (o.color as LectureColor)
    : "blue";
  return {
    id: o.id,
    subject: o.subject,
    weekday,
    start: o.start,
    end: o.end,
    room: typeof o.room === "string" ? o.room : "",
    color,
  };
};

/** Assignment 요소 검증 — id·subject·title·due(문자열) 확인. */
const validateAssignment = (x: unknown): Assignment | null => {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (
    !isNonEmptyString(o.id) ||
    !isNonEmptyString(o.subject) ||
    !isNonEmptyString(o.title) ||
    !isNonEmptyString(o.due)
  )
    return null;
  return { id: o.id, subject: o.subject, title: o.title, due: o.due };
};

/** Exam 요소 검증 — id·subject·title·date(문자열) 확인. */
const validateExam = (x: unknown): Exam | null => {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (
    !isNonEmptyString(o.id) ||
    !isNonEmptyString(o.subject) ||
    !isNonEmptyString(o.title) ||
    !isNonEmptyString(o.date)
  )
    return null;
  return { id: o.id, subject: o.subject, title: o.title, date: o.date };
};

const saveList = <T,>(key: string, list: T[]): void => {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // localStorage 사용 불가 시 세션 한정으로 유지
  }
};

// ── 웹 데모 시드 ──────────────────────────────────────────────
// Vercel 웹 데모는 사용자가 자료를 넣거나 시간표를 인식시킬 수 없다(로컬 AI 필요).
// 그래서 브라우저에서 처음 열었을 때만 실제 한 학기 시간표·시험·과제를 채워
// 심사위원이 홈 화면의 의미를 바로 볼 수 있게 한다.
// 데스크톱 앱에서는 절대 채우지 않는다 — 거기서는 사용자가 직접 넣는 흐름이 제품의 핵심.

/** 실제 2026-1학기 시간표 (에브리타임 캡처 기준) */
const DEMO_TIMETABLE: Lecture[] = [
  { id: "d-1", subject: "데이터통신", weekday: "월", start: "10:00", end: "12:00", room: "공5411", color: "rose" },
  { id: "d-2", subject: "실전코딩", weekday: "월", start: "15:00", end: "19:00", room: "공5410", color: "amber" },
  { id: "d-3", subject: "데이터통신", weekday: "화", start: "13:00", end: "15:00", room: "공5414", color: "rose" },
  { id: "d-4", subject: "운영체제및실습", weekday: "수", start: "09:00", end: "11:00", room: "공5416", color: "emerald" },
  { id: "d-5", subject: "데이터베이스", weekday: "수", start: "16:00", end: "18:00", room: "공5412", color: "blue" },
  { id: "d-6", subject: "운영체제및실습", weekday: "목", start: "10:00", end: "12:00", room: "공5404", color: "emerald" },
  { id: "d-7", subject: "영상처리", weekday: "목", start: "13:00", end: "15:00", room: "공5411", color: "violet" },
  { id: "d-8", subject: "IT영어1", weekday: "목", start: "17:00", end: "19:00", room: "공5401", color: "amber" },
  { id: "d-9", subject: "영상처리", weekday: "금", start: "11:00", end: "13:00", room: "공5416", color: "violet" },
  { id: "d-10", subject: "데이터베이스", weekday: "금", start: "16:00", end: "18:00", room: "공5415", color: "blue" },
];

const DEMO_UNTIMED = ["취업과 창업", "창업실습Ⅳ"];

/** 시험·과제는 방문 시점 기준으로 잡아 D-day가 항상 자연스럽게 보이게 한다. */
const isoAfter = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const demoExams = (): Exam[] => [
  { id: "de-1", subject: "데이터통신", title: "중간고사", date: isoAfter(9) },
  { id: "de-2", subject: "운영체제", title: "중간고사", date: isoAfter(14) },
  { id: "de-3", subject: "데이터베이스", title: "퀴즈 2", date: isoAfter(21) },
];

const demoAssignments = (): Assignment[] => [
  { id: "da-1", subject: "데이터통신", title: "3장 데이터 전송 연습문제", due: isoAfter(3) },
  { id: "da-2", subject: "영상처리", title: "Canny edge detection 구현", due: isoAfter(5) },
  { id: "da-3", subject: "운영체제", title: "프로세스 스케줄링 보고서", due: isoAfter(8) },
];

/** 이 브라우저에 데모를 이미 채웠는지 (사용자가 지운 걸 되살리지 않기 위해) */
const DEMO_SEEDED_KEY = "aone.home.demoSeeded.v1";

/**
 * 웹 데모에서 처음 열었을 때 시간표·시험·과제를 한 번만 채운다.
 * - 데스크톱 앱(Tauri)에서는 아무것도 하지 않는다.
 * - 이미 채웠거나 사용자가 직접 넣은 데이터가 있으면 건드리지 않는다.
 */
export const seedWebDemoIfEmpty = (isDesktop: boolean): void => {
  if (isDesktop || typeof localStorage === "undefined") return;
  try {
    if (localStorage.getItem(DEMO_SEEDED_KEY)) return;
    localStorage.setItem(DEMO_SEEDED_KEY, "1");
    if (loadTimetable().length === 0) {
      saveTimetable(DEMO_TIMETABLE);
      saveUntimedSubjects(DEMO_UNTIMED);
    }
    if (loadExams().length === 0) saveExams(demoExams());
    if (loadAssignments().length === 0) saveAssignments(demoAssignments());
  } catch {
    // localStorage 사용 불가 — 데모 없이 빈 화면으로 동작
  }
};

export const loadTimetable = (): Lecture[] =>
  loadValidated<Lecture>(TIMETABLE_KEY, validateLecture) ?? [];
export const saveTimetable = (lectures: Lecture[]): void =>
  saveList(TIMETABLE_KEY, lectures);

/** 시간 미지정 과목 (온라인 강의 등) */
export const loadUntimedSubjects = (): string[] =>
  loadValidated<string>(UNTIMED_KEY, (x) => (isNonEmptyString(x) ? x : null)) ??
  [];
export const saveUntimedSubjects = (subjects: string[]): void =>
  saveList(UNTIMED_KEY, subjects);

export const loadAssignments = (): Assignment[] =>
  loadValidated<Assignment>(ASSIGNMENTS_KEY, validateAssignment) ?? [];
export const saveAssignments = (assignments: Assignment[]): void =>
  saveList(ASSIGNMENTS_KEY, assignments);

export const loadExams = (): Exam[] =>
  loadValidated<Exam>(EXAMS_KEY, validateExam) ?? [];
export const saveExams = (exams: Exam[]): void => saveList(EXAMS_KEY, exams);

export const newId = (prefix: string): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
