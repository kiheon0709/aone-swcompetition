/**
 * l1-normalize.ts 유닛 테스트 — 전사본/슬라이드 파서 + 청킹 + 기출 로더.
 * 순수 함수 위주(파일시스템 불필요). 실행: npm test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTranscript,
  splitSentences,
  timeToSeconds,
  chunkUtterances,
  parseSlides,
  parseExtractedSlides,
  loadPastExams,
  type Utterance,
} from "../src/layers/l1-normalize.js";

// ── timeToSeconds ────────────────────────────────────────────

test("timeToSeconds: MM:SS / H:MM:SS / 타임스탬프 아님", () => {
  assert.equal(timeToSeconds("00:00"), 0);
  assert.equal(timeToSeconds("12:34"), 12 * 60 + 34);
  assert.equal(timeToSeconds("1:02:03"), 3600 + 2 * 60 + 3);
  assert.equal(timeToSeconds("#L12"), null); // 줄번호 locator
  assert.equal(timeToSeconds("abc"), null);
  assert.equal(timeToSeconds(""), null);
});

// ── splitSentences ───────────────────────────────────────────

test("splitSentences: 마침표/물음표/느낌표 뒤 공백 기준 분리, 빈 조각 제거", () => {
  assert.deepEqual(splitSentences("첫 문장. 둘째 문장? 셋째!"), [
    "첫 문장.",
    "둘째 문장?",
    "셋째!",
  ]);
  assert.deepEqual(splitSentences("   "), []);
  assert.deepEqual(splitSentences("구분자 없는 한 문장"), ["구분자 없는 한 문장"]);
});

// ── parseTranscript ──────────────────────────────────────────

test("parseTranscript: 클로바노트식 화자블록 → t/text, 헤더 추출", () => {
  const raw = [
    "데이터통신 3주차",
    "2025.03.15 오후 90분 12초",
    "홍길동",
    "참석자 1 00:05",
    "패킷 교환에 대해 배웁니다. 중요합니다.",
    "참석자 1 10:20",
    "다음 주제로 넘어갑니다.",
  ].join("\n");
  const { utterances, title, header } = parseTranscript(raw);
  assert.equal(title, "데이터통신 3주차");
  assert.equal(header, "2025.03.15 오후 90분 12초");
  assert.deepEqual(utterances, [
    { t: "00:05", text: "패킷 교환에 대해 배웁니다." },
    { t: "00:05", text: "중요합니다." },
    { t: "10:20", text: "다음 주제로 넘어갑니다." },
  ]);
});

test("parseTranscript: 화자블록 없는 평문 → #L줄번호 locator", () => {
  const raw = "첫째 줄입니다.\n\n둘째 줄입니다.";
  const { utterances, title, header } = parseTranscript(raw);
  assert.equal(title, null);
  assert.equal(header, null);
  assert.deepEqual(utterances, [
    { t: "#L1", text: "첫째 줄입니다." },
    { t: "#L3", text: "둘째 줄입니다." }, // 빈 줄(L2) 건너뜀, 줄번호는 1-based 유지
  ]);
});

test("parseTranscript: BOM 제거 + 빈 입력 → 빈 발화", () => {
  assert.deepEqual(parseTranscript("").utterances, []);
  assert.deepEqual(parseTranscript("﻿텍스트").utterances, [{ t: "#L1", text: "텍스트" }]);
});

test("parseTranscript: 화자 태그 앞 헤더 잔여물은 currentT null이라 버려짐", () => {
  const raw = "참석자 1 00:00\n실제 발화.";
  const { utterances } = parseTranscript(raw);
  assert.deepEqual(utterances, [{ t: "00:00", text: "실제 발화." }]);
});

// ── chunkUtterances ──────────────────────────────────────────

test("chunkUtterances: 빈 입력 → 빈 배열", () => {
  assert.deepEqual(chunkUtterances([]), []);
});

test("chunkUtterances: 타임스탬프 블록 경계(blockSeconds)로 분할", () => {
  const us: Utterance[] = [
    { t: "00:00", text: "a" },
    { t: "05:00", text: "b" }, // 같은 10분 버킷(0)
    { t: "10:00", text: "c" }, // 버킷 1
    { t: "19:59", text: "d" }, // 버킷 1
    { t: "20:00", text: "e" }, // 버킷 2
  ];
  const chunks = chunkUtterances(us, 600);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[0].map((u) => u.text), ["a", "b"]);
  assert.deepEqual(chunks[1].map((u) => u.text), ["c", "d"]);
  assert.deepEqual(chunks[2].map((u) => u.text), ["e"]);
});

test("chunkUtterances: 타임스탬프 없으면 maxChars 문자량으로 분할", () => {
  const us: Utterance[] = [
    { t: "#L1", text: "aaaa" }, // 4자
    { t: "#L2", text: "bbbb" }, // +4 = 8
    { t: "#L3", text: "cccc" }, // 8+4=12 > 10 → 새 청크
  ];
  const chunks = chunkUtterances(us, 600, 10);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0].map((u) => u.text), ["aaaa", "bbbb"]);
  assert.deepEqual(chunks[1].map((u) => u.text), ["cccc"]);
});

test("chunkUtterances: maxChars보다 큰 단일 발화도 유실 없이 자기 청크로", () => {
  const us: Utterance[] = [{ t: "#L1", text: "x".repeat(50) }];
  const chunks = chunkUtterances(us, 600, 10);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0][0].text.length, 50);
});

// ── parseSlides ──────────────────────────────────────────────

test("parseSlides: 단독 숫자 줄을 페이지 꼬리표로, 빈 줄 제거", () => {
  const raw = ["제목", "본문 A", "1", "본문 B", "2"].join("\n");
  const pages = parseSlides(raw);
  assert.deepEqual(pages, [
    { page: 1, lines: ["제목", "본문 A"] },
    { page: 2, lines: ["본문 B"] },
  ]);
});

test("parseSlides: 페이지 꼬리표 없이 끝나면 마지막 버퍼를 last+1 페이지로", () => {
  const raw = ["본문 A", "1", "본문 B"].join("\n");
  const pages = parseSlides(raw);
  assert.deepEqual(pages, [
    { page: 1, lines: ["본문 A"] },
    { page: 2, lines: ["본문 B"] },
  ]);
});

test("parseSlides: 빈 입력 → 빈 페이지 목록", () => {
  assert.deepEqual(parseSlides(""), []);
  assert.deepEqual(parseSlides("\n\n"), []);
});

// ── parseExtractedSlides (폼피드 \f 구분) ────────────────────

test("parseExtractedSlides: \\f 페이지 구분 + 빈 페이지 제거", () => {
  const raw = "1페이지 줄1\n1페이지 줄2\n\f\n2페이지\n\f\n   \n";
  const pages = parseExtractedSlides(raw);
  assert.deepEqual(pages, [
    { page: 1, lines: ["1페이지 줄1", "1페이지 줄2"] },
    { page: 2, lines: ["2페이지"] },
    // 세 번째 폼피드 조각은 공백뿐이라 제거됨
  ]);
});

test("parseExtractedSlides: 빈 입력 → 빈 배열", () => {
  assert.deepEqual(parseExtractedSlides(""), []);
});

// ── loadPastExams ────────────────────────────────────────────

test("loadPastExams: exams[].example_questions 평탄화 + id 부여", () => {
  const json = JSON.stringify({
    exams: [
      { year: 2024, id: "midterm", example_questions: ["Q1?", "Q2?"] },
      { example_questions: ["Q3?"] }, // year/id 없음 → null / "기출"
    ],
  });
  const items = loadPastExams(json);
  assert.deepEqual(items, [
    { id: "midterm-Q1", year: 2024, examId: "midterm", question: "Q1?" },
    { id: "midterm-Q2", year: 2024, examId: "midterm", question: "Q2?" },
    { id: "기출-Q1", year: null, examId: "기출", question: "Q3?" },
  ]);
});

test("loadPastExams: exams 없음/빈 배열 → 빈 목록", () => {
  assert.deepEqual(loadPastExams("{}"), []);
  assert.deepEqual(loadPastExams(JSON.stringify({ exams: [] })), []);
});
