/**
 * 전사본 파서 (FIX 14) — 세 가지 형식을 한 모델로 통일한다.
 *
 * 실측한 형식(데모 데이터 기준):
 *   A형  "참석자 1 00:00"  + 발화 줄       (데통 1~4주차 · 클로바노트)
 *   B형  "화자 1 00:19"    + 발화 줄       (운체 5~7주차)
 *   C형  타임스탬프 없음 — 순수 텍스트      (데통 5~7주차, 운체 1~4주차)
 *
 * 근거(evidence)의 locator도 형식에 맞춰 두 갈래로 저장돼 있다:
 *   "MM:SS" / "H:MM:SS"  → A·B형 블록 헤더 시각
 *   "#L{줄번호}"          → C형 (1-base 줄 번호)
 * 둘 다 실측 119/119 매칭되므로 정규화가 필요 없다.
 */

export interface TranscriptBlock {
  /** 기본 앵커 id — "t-02:21" 또는 "l-75" */
  id: string;
  /**
   * 이 블록이 덮는 줄 범위 [시작, 끝] (1-base, 끝 포함 안 함).
   * 운체 5~7주차처럼 타임스탬프 형식인데 근거는 #L 줄번호로 저장된 경우가 있어
   * 시각 앵커(id)와 줄 범위를 함께 갖는다.
   */
  lineRange: [number, number];
  /** A·B형 화자 표기 ("참석자 1"). C형은 null */
  speaker: string | null;
  /** A·B형 시각 ("02:21"). C형은 null */
  time: string | null;
  /** 1-base 줄 번호 — C형 표기·앵커에 쓴다 */
  lineNo: number;
  text: string;
}

export interface ParsedTranscript {
  /** 파일 머리말(날짜·제목 등) — 블록 앞에 있던 줄 */
  intro: string;
  blocks: TranscriptBlock[];
  /** 타임스탬프가 있는 형식인가 (A·B형) */
  timed: boolean;
}

const HEADER = /^(참석자\s*\d+|화자\s*\d+)\s+(\d{1,3}:\d{2}(?::\d{2})?)\s*$/;

/** "MM:SS" 또는 "H:MM:SS" → 초 */
export const timeToSeconds = (t: string): number => {
  const parts = t.split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

/** 근거 locator("02:21" · "1:20:06" · "#L75")를 블록 앵커 id로 바꾼다 */
export const locatorToAnchor = (locator: string): string | null => {
  const raw = locator.trim();
  if (!raw) return null;
  const line = raw.match(/^#L(\d+)$/);
  if (line) return `l-${line[1]}`;
  if (/^\d{1,3}:\d{2}(:\d{2})?$/.test(raw)) return `t-${raw}`;
  return null;
};

/** 발화 시각 근거인가 (페이지 근거·기출 근거와 구분) */
export const isTranscriptLocator = (locator: string): boolean =>
  locatorToAnchor(locator) !== null;

/**
 * 개념 카드의 source 문자열을 수업+앵커로 쪼갠다.
 *   "1주차 03:38"  → { unit: "1주차", anchor: "t-03:38" }
 *   "5주차 #L19"   → { unit: "5주차", anchor: "l-19" }
 *   "2주차 (이론)… p.7" → null (페이지 근거는 이 경로가 아니다)
 */
export const parseConceptSource = (
  source: string,
): { unit: string; anchor: string } | null => {
  const m = source.trim().match(/^(\S+주차)\s+(.+)$/);
  if (!m) return null;
  const anchor = locatorToAnchor(m[2]);
  return anchor ? { unit: m[1], anchor } : null;
};

/**
 * 전사본을 블록으로 나눈다.
 * A·B형은 헤더 기준, C형은 빈 줄이 아닌 줄 하나가 곧 한 블록이다
 * (근거 locator가 줄 번호를 가리키므로 줄 단위여야 앵커가 맞는다).
 */
export const parseTranscript = (raw: string): ParsedTranscript | null => {
  if (!raw || !raw.trim()) return null;
  // BOM 제거 — 클로바노트 파일 앞에 붙어 온다
  const lines = raw.replace(/^﻿/, "").split(/\r?\n/);

  const blocks: TranscriptBlock[] = [];
  const intro: string[] = [];
  let cur: TranscriptBlock | null = null;
  /** 블록이 끝나는 줄 — 줄 범위 앵커 산출용 */
  const endLine: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(HEADER);
    if (m) {
      if (cur) {
        blocks.push(cur);
        endLine.push(i); // 이전 블록은 이 헤더 직전 줄까지
      }
      cur = {
        id: `t-${m[2]}`,
        lineRange: [i + 2, i + 2],
        speaker: m[1],
        time: m[2],
        lineNo: i + 1,
        text: "",
      };
    } else if (cur) {
      cur.text += (cur.text ? "\n" : "") + line;
    } else {
      intro.push(line);
    }
  }
  if (cur) {
    blocks.push(cur);
    endLine.push(lines.length);
  }

  if (blocks.length >= 2) {
    return {
      intro: intro.join("\n").trim(),
      blocks: blocks.map((b, i) => ({
        ...b,
        text: b.text.trim(),
        // 헤더 다음 줄부터 다음 헤더 직전까지를 이 블록이 받는다.
        // 줄마다 앵커 문자열을 만들면 블록당 수백 개가 되므로 범위로 갖는다.
        lineRange: [b.lineNo + 1, endLine[i]] as [number, number],
      })),
      timed: true,
    };
  }

  // C형 — 타임스탬프가 없다. 줄 하나 = 블록 하나 (근거가 줄 번호를 가리킨다)
  const plain: TranscriptBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (!text) continue;
    plain.push({
      id: `l-${i + 1}`,
      lineRange: [i + 1, i + 2],
      speaker: null,
      time: null,
      lineNo: i + 1,
      text,
    });
  }
  if (plain.length === 0) return null;
  return { intro: "", blocks: plain, timed: false };
};
