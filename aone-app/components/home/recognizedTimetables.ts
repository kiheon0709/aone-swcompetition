// 시간표 인식 결과 → Lecture[] 변환 유틸.
//
// 예전에는 실물 캡처 4장을 사전 판독한 세트(RECOGNIZED_TIMETABLES)를 두고
// 업로드 파일의 **이름·크기로 매칭**해 그것을 보여줬다. 그런데 기준 크기가
// 456027 / 421637 / 482015 / 407649 바이트로 **스마트폰 스크린샷 JPEG가 흔히 걸리는 대역**이라,
// 사용자가 자기 시간표를 올렸는데 크기가 우연히 맞으면 **남의 시간표가 그대로 채워졌다.**
// 인식된 게 아니라는 표시도 전혀 없었다.
//
// 실인식(claude-cli·gemini-api)이 실제로 동작하는 것을 확인해(에타시간표1.jpeg → 33.2초,
// 강의 10건 + 시간미지정 2건, 사전 판독 세트와 일치) 가짜 매칭을 전부 제거했다.

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
