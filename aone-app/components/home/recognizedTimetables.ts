// 실물 에브리타임 캡처 4장(에타시간표1~4.jpeg)을 사전 판독한 시간표 세트.
// 업로드된 이미지의 파일명/크기로 세트를 매칭해 데모 OCR 결과로 보여준다.

import {
  LECTURE_COLOR_CLASSES,
  type Lecture,
  type LectureColor,
  type Weekday,
} from "./homeData";

export interface RawLecture {
  subject: string;
  weekday: Weekday;
  start: string;
  end: string;
  room: string;
}

export interface RecognizedTimetable {
  /** 캡처 파일 번호 — 에타시간표N.jpeg */
  n: number;
  /** 원본 캡처 파일 크기(bytes) — 파일명이 다를 때 근접 매칭용 */
  fileSize: number;
  lectures: Lecture[];
  /** 시간 미지정 과목 (온라인 강의 등) */
  untimed: string[];
}

const COLORS = Object.keys(LECTURE_COLOR_CLASSES) as LectureColor[];

/** 과목별로 컬러를 순환 배정하며 Lecture[] 생성 — 실인식(A2) 결과 변환에도 사용 */
export const buildLectures = (idPrefix: string, raws: RawLecture[]): Lecture[] => {
  const colorOf = new Map<string, LectureColor>();
  return raws.map((raw, i) => {
    let color = colorOf.get(raw.subject);
    if (!color) {
      color = COLORS[colorOf.size % COLORS.length];
      colorOf.set(raw.subject, color);
    }
    return { id: `${idPrefix}-${i}`, color, ...raw };
  });
};

const build = (n: number, raws: RawLecture[]): Lecture[] =>
  buildLectures(`tt${n}`, raws);

export const RECOGNIZED_TIMETABLES: RecognizedTimetable[] = [
  // ── 1번 — 본인 시간표 (2026년 1학기) ──────────────────────
  {
    n: 1,
    fileSize: 456027,
    lectures: build(1, [
      { subject: "데이터통신", weekday: "월", start: "10:00", end: "12:00", room: "공5411" },
      { subject: "데이터통신", weekday: "화", start: "13:00", end: "15:00", room: "공5414" },
      { subject: "운영체제및실습", weekday: "수", start: "09:00", end: "11:00", room: "공5416" },
      { subject: "운영체제및실습", weekday: "목", start: "10:00", end: "12:00", room: "공5404" },
      { subject: "영상처리", weekday: "금", start: "11:00", end: "13:00", room: "공5416" },
      { subject: "영상처리", weekday: "목", start: "13:00", end: "15:00", room: "공5411" },
      { subject: "실전코딩", weekday: "월", start: "15:00", end: "19:00", room: "공5410" },
      { subject: "데이터베이스", weekday: "수", start: "16:00", end: "18:00", room: "공5412" },
      { subject: "데이터베이스", weekday: "금", start: "16:00", end: "18:00", room: "공5415" },
      { subject: "IT영어1", weekday: "목", start: "17:00", end: "19:00", room: "공5401" },
    ]),
    untimed: ["취업과 창업", "창업실습IV"],
  },
  // ── 2번 — 김태우 (2026년 1학기) ───────────────────────────
  {
    n: 2,
    fileSize: 421637,
    lectures: build(2, [
      { subject: "해킹과침해대응", weekday: "월", start: "09:00", end: "10:00", room: "coss" },
      { subject: "시큐어코딩", weekday: "화", start: "09:00", end: "10:00", room: "coss" },
      { subject: "운영체제및실습", weekday: "수", start: "09:00", end: "11:00", room: "공5415" },
      { subject: "운영체제및실습", weekday: "월", start: "13:00", end: "15:00", room: "공5404" },
      { subject: "데이터통신", weekday: "목", start: "10:00", end: "12:00", room: "공5414" },
      { subject: "데이터통신", weekday: "화", start: "15:00", end: "17:00", room: "공5411" },
      { subject: "정신건강", weekday: "월", start: "10:30", end: "12:00", room: "교214" },
      { subject: "정신건강", weekday: "수", start: "12:00", end: "13:30", room: "교214" },
      { subject: "데이터베이스", weekday: "수", start: "16:00", end: "18:00", room: "공5412" },
      { subject: "데이터베이스", weekday: "금", start: "16:00", end: "18:00", room: "공5415" },
    ]),
    untimed: [],
  },
  // ── 3번 — 민영기 · 농대 (2026년 1학기) ────────────────────
  {
    n: 3,
    fileSize: 482015,
    lectures: build(3, [
      { subject: "탄소중립 목재이용학개론", weekday: "월", start: "09:00", end: "12:00", room: "농3113" },
      { subject: "목재물리학및실험", weekday: "화", start: "09:00", end: "11:00", room: "임산공206" },
      { subject: "목재물리학및실험", weekday: "금", start: "13:00", end: "15:00", room: "농3113" },
      { subject: "셀룰로오스 섬유공정 및 실험", weekday: "화", start: "11:00", end: "13:00", room: "농3113" },
      { subject: "셀룰로오스 섬유공정 및 실험", weekday: "금", start: "10:00", end: "12:00", room: "농3113" },
      { subject: "열역학", weekday: "수", start: "13:00", end: "15:00", room: "농3113" },
      { subject: "열역학", weekday: "화", start: "14:00", end: "15:00", room: "농3113" },
      { subject: "에코소재유기화학", weekday: "목", start: "13:00", end: "15:00", room: "농3113" },
      { subject: "에코소재유기화학", weekday: "화", start: "15:00", end: "16:00", room: "농3113" },
      { subject: "융합푸드소재분석개론", weekday: "월", start: "14:00", end: "16:00", room: "농3113" },
      { subject: "융합푸드소재분석개론", weekday: "목", start: "15:00", end: "16:00", room: "농3113" },
    ]),
    untimed: [],
  },
  // ── 4번 — 윤유빈 (2026년 1학기) ───────────────────────────
  {
    n: 4,
    fileSize: 407649,
    lectures: build(4, [
      { subject: "확률 및 통계", weekday: "목", start: "09:00", end: "12:00", room: "공5412" },
      { subject: "영상처리", weekday: "금", start: "09:00", end: "11:00", room: "공5416" },
      { subject: "영상처리", weekday: "목", start: "15:00", end: "17:00", room: "공5411" },
      { subject: "경제의이해", weekday: "월", start: "10:00", end: "13:00", room: "경S344" },
      { subject: "운영체제및실습", weekday: "화", start: "10:00", end: "12:00", room: "공5410" },
      { subject: "운영체제및실습", weekday: "수", start: "11:00", end: "13:00", room: "공5415" },
      { subject: "데이터베이스", weekday: "수", start: "14:00", end: "16:00", room: "공5412" },
      { subject: "데이터베이스", weekday: "금", start: "14:00", end: "16:00", room: "공5415" },
      { subject: "실전코딩", weekday: "월", start: "15:00", end: "19:00", room: "공5410" },
    ]),
    untimed: [],
  },
];

export type MatchedBy = "name" | "size";

/**
 * 업로드된 이미지 → 내장 데모 세트 fast-path 매칭 (부록 A2).
 * 1) 파일명에 "에타시간표N" 포함 → N번 세트
 * 2) 파일 크기 ±5% 이내 → 가장 근접한 세트
 * 3) 실패 → null (가짜 fallback 없음 — 호출부가 실인식으로 넘어간다)
 */
export const matchRecognizedTimetable = (
  fileName: string,
  fileSize: number
): { set: RecognizedTimetable; matchedBy: MatchedBy } | null => {
  const m = fileName.match(/에타시간표([1-4])/);
  if (m) {
    const set = RECOGNIZED_TIMETABLES.find((t) => t.n === Number(m[1]));
    if (set) return { set, matchedBy: "name" };
  }
  let best: RecognizedTimetable | null = null;
  let bestDiff = Infinity;
  for (const t of RECOGNIZED_TIMETABLES) {
    const diff = Math.abs(fileSize - t.fileSize) / t.fileSize;
    if (diff <= 0.05 && diff < bestDiff) {
      best = t;
      bestDiff = diff;
    }
  }
  if (best) return { set: best, matchedBy: "size" };
  return null;
};
