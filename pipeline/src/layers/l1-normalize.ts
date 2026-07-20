/**
 * L1 — 지각(정규화) 계층.
 * - 전사본 파서: 클로바노트식 "참석자 N MM:SS" 블록 → {t, text}[]
 *   (타임스탬프 없는 평문 전사본도 줄 단위로 수용: locator = "#L<줄번호>")
 * - 슬라이드 텍스트 파서: 페이지 번호(단독 숫자 줄) 기준 페이지 단위 분해
 * - 기출 JSON 로더: past_exams.json → 문항 단위 평탄화
 */
import fs from "node:fs";
import path from "node:path";
import { nfc, type UnitKey } from "../folders.js";

export interface Utterance {
  /** locator: "12:34"(타임스탬프) 또는 "#L12"(줄번호) */
  t: string;
  text: string;
}

export interface SlidePage {
  page: number;
  lines: string[];
}

export interface SlideDoc {
  /** 예: "theory_01", "practice_01" */
  tag: string;
  file: string;
  pages: SlidePage[];
}

export interface PastExamItem {
  id: string;
  year: number | null;
  examId: string;
  question: string;
}

export interface UnitInputs {
  key: UnitKey;
  transcript: Utterance[];
  transcriptMeta: { title: string | null; header: string | null };
  slides: SlideDoc[];
  pastExams: PastExamItem[];
}

const SPEAKER_RE = /^참석자\s*\d+\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*$/;
const HEADER_DATE_RE = /^\d{4}\.\d{2}\.\d{2}.*[분초]/;
const PAGE_NUM_RE = /^\d{1,3}$/;

function stripBom(s: string): string {
  return s.replace(/^﻿/, "");
}

/** 클로바노트식 전사본 → 발화 목록. 평문(타임스탬프 없음)도 처리. */
export function parseTranscript(rawText: string): { utterances: Utterance[]; title: string | null; header: string | null } {
  const lines = stripBom(rawText).split(/\r?\n/);
  const utterances: Utterance[] = [];
  let title: string | null = null;
  let header: string | null = null;

  // 헤더 감지: 첫 줄 제목 + 둘째 줄 "YYYY.MM.DD … N분 N초"
  let start = 0;
  if (lines.length >= 2 && HEADER_DATE_RE.test(lines[1].trim())) {
    title = lines[0].trim() || null;
    header = lines[1].trim();
    start = 2;
    // 작성자 줄(비어있지 않은 다음 한 줄) 건너뛰기
    while (start < lines.length && lines[start].trim() === "") start++;
    if (start < lines.length && !SPEAKER_RE.test(lines[start].trim())) start++;
  }

  const hasSpeakerBlocks = lines.some((l) => SPEAKER_RE.test(l.trim()));

  if (hasSpeakerBlocks) {
    let currentT: string | null = null;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "") continue;
      const m = line.match(SPEAKER_RE);
      if (m) {
        currentT = m[1];
        continue;
      }
      if (currentT === null) continue; // 헤더 잔여물
      // 블록 내부 줄 = 발화 문장(들). 문장 단위로 분해.
      for (const sent of splitSentences(line)) {
        utterances.push({ t: currentT, text: sent });
      }
    }
  } else {
    for (let i = start; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "") continue;
      for (const sent of splitSentences(line)) {
        utterances.push({ t: `#L${i + 1}`, text: sent });
      }
    }
  }
  return { utterances, title, header };
}

/** 한국어 강의 문장 분리(마침표/물음표 기준의 단순 규칙) */
export function splitSentences(line: string): string[] {
  return line
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** "MM:SS" 또는 "H:MM:SS" → 초. 타임스탬프 아님(#L12 등)이면 null */
export function timeToSeconds(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return m[3] !== undefined
    ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    : Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 전사본을 실 LLM 호출용 블록으로 청킹.
 * 타임스탬프가 있으면 blockSeconds(기본 10분) 단위, 없으면 maxChars 문자량 단위.
 */
export function chunkUtterances(
  utterances: Utterance[],
  blockSeconds = 600,
  maxChars = 5000,
): Utterance[][] {
  const chunks: Utterance[][] = [];
  let current: Utterance[] = [];
  let bucket = -1;
  let chars = 0;
  for (const u of utterances) {
    const sec = timeToSeconds(u.t);
    if (sec !== null) {
      const b = Math.floor(sec / blockSeconds);
      if (b !== bucket && current.length > 0) {
        chunks.push(current);
        current = [];
      }
      bucket = b;
      current.push(u);
    } else {
      if (chars + u.text.length > maxChars && current.length > 0) {
        chunks.push(current);
        current = [];
        chars = 0;
      }
      current.push(u);
      chars += u.text.length;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** 슬라이드 추출 텍스트 → 페이지 목록. 단독 숫자 줄을 페이지 번호(꼬리표)로 간주. */
export function parseSlides(rawText: string): SlidePage[] {
  const lines = stripBom(rawText).split(/\r?\n/);
  const pages: SlidePage[] = [];
  let buf: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (PAGE_NUM_RE.test(line)) {
      pages.push({ page: parseInt(line, 10), lines: buf.filter((l) => l !== "") });
      buf = [];
    } else {
      buf.push(line);
    }
  }
  const rest = buf.filter((l) => l !== "");
  if (rest.length > 0) {
    const last = pages.length > 0 ? pages[pages.length - 1].page : 0;
    pages.push({ page: last + 1, lines: rest });
  }
  return pages;
}

/** L0가 추출한 PDF 텍스트(폼피드 \f 페이지 구분) → 페이지 목록 */
export function parseExtractedSlides(rawText: string): SlidePage[] {
  return stripBom(rawText)
    .split("\f")
    .map((chunk, i) => ({
      page: i + 1,
      lines: chunk.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== ""),
    }))
    .filter((p) => p.lines.length > 0);
}

/** past_exams.json → 문항 평탄화 */
export function loadPastExams(jsonText: string): PastExamItem[] {
  const data = JSON.parse(stripBom(jsonText)) as {
    exams?: { year?: number; id?: string; example_questions?: string[] }[];
  };
  const items: PastExamItem[] = [];
  for (const exam of data.exams ?? []) {
    const examId = exam.id ?? "기출";
    (exam.example_questions ?? []).forEach((q, i) => {
      items.push({
        id: `${examId}-Q${i + 1}`,
        year: exam.year ?? null,
        examId,
        question: q,
      });
    });
  }
  return items;
}

/** 슬라이드 텍스트 파일명 → doc 태그 (예: week3_theory_01.txt / theory_01.txt → "theory_01") */
const SLIDE_FILE_RE = /^(?:.*_)?(theory|practice)_(\d+)\.txt$/;

/**
 * goldset/{subject}/{unit} 디렉토리에서 해당 unit 입력 일체를 적재.
 * extractedDir가 주어지면 L0 캐시(extractedDir/{subject}/{unit}/*.txt)의 PDF 추출 텍스트도
 * 슬라이드 문서로 포함한다 (doc 태그 = 원본 PDF 파일명(확장자 제외), NFC 정규화).
 */
export function loadUnitInputs(goldsetDir: string, key: UnitKey, extractedDir?: string): UnitInputs {
  const dir = path.join(goldsetDir, key.subject, key.unit);
  if (!fs.existsSync(dir)) {
    throw new Error(`goldset unit 디렉토리 없음: ${dir}`);
  }

  let transcript: Utterance[] = [];
  let transcriptMeta: UnitInputs["transcriptMeta"] = { title: null, header: null };
  const transcriptPath = path.join(dir, "transcript.txt");
  if (fs.existsSync(transcriptPath)) {
    const parsed = parseTranscript(fs.readFileSync(transcriptPath, "utf8"));
    transcript = parsed.utterances;
    transcriptMeta = { title: parsed.title, header: parsed.header };
  }

  const slides: SlideDoc[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(SLIDE_FILE_RE);
    if (!m) continue;
    const tag = `${m[1]}_${m[2]}`;
    slides.push({
      tag,
      file: path.join(dir, f),
      pages: parseSlides(fs.readFileSync(path.join(dir, f), "utf8")),
    });
  }

  if (extractedDir) {
    const exDir = path.join(extractedDir, key.subject, key.unit);
    if (fs.existsSync(exDir)) {
      for (const f of fs.readdirSync(exDir).sort()) {
        if (!f.endsWith(".txt")) continue;
        const p = path.join(exDir, f);
        slides.push({
          tag: nfc(f.replace(/\.txt$/, "")),
          file: p,
          pages: parseExtractedSlides(fs.readFileSync(p, "utf8")),
        });
      }
    }
  }

  // 족보(past_exams.json)는 선택적 보조 데이터 — 손상돼도 분석 전체를 막지 않는다.
  // (사용자가 족보 폴더에 이상한 파일을 넣어도 개념·신호 추출은 계속 진행)
  let pastExams: PastExamItem[] = [];
  const examPath = path.join(dir, "past_exams.json");
  if (fs.existsSync(examPath)) {
    try {
      pastExams = loadPastExams(fs.readFileSync(examPath, "utf8"));
    } catch (e) {
      console.warn(
        `  경고: past_exams.json을 읽지 못해 기출은 건너뜁니다 (${e instanceof Error ? e.message : String(e)}). 분석은 계속합니다.`,
      );
    }
  }

  return { key, transcript, transcriptMeta, slides, pastExams };
}
