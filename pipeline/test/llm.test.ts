/**
 * llm.ts 유닛 테스트 (GEMINI_API_KEY 실키 불필요 — fetch 목킹).
 * 실행: npm test (= tsx --test test/*.test.ts)
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  extractJson,
  buildGeminiRequestBody,
  geminiModelName,
  TimetableOutput,
  createEngine,
} from "../src/adapters/llm.js";

// ── extractJson ──────────────────────────────────────────────

test("extractJson: 코드펜스 안 JSON", () => {
  assert.deepEqual(extractJson('설명\n```json\n{"a":1}\n```\n끝'), { a: 1 });
});

test("extractJson: 전후 잡음 있는 생 JSON", () => {
  assert.deepEqual(extractJson('결과는 다음과 같습니다: {"lectures":[]} '), { lectures: [] });
});

test("extractJson: JSON 없으면 throw", () => {
  assert.throws(() => extractJson("JSON이 없는 응답"));
});

// ── gemini 요청 조립 (순수 함수) ─────────────────────────────

test("buildGeminiRequestBody: 텍스트만", () => {
  const body = buildGeminiRequestBody("프롬프트") as {
    contents: { parts: unknown[] }[];
    generationConfig: { responseMimeType: string; temperature: number };
  };
  assert.deepEqual(body.contents[0].parts, [{ text: "프롬프트" }]);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.temperature, 0);
});

test("buildGeminiRequestBody: 이미지 inline_data가 텍스트보다 앞에", () => {
  const body = buildGeminiRequestBody("시간표 추출", { mimeType: "image/jpeg", data: "QUJD" }) as {
    contents: { parts: unknown[] }[];
  };
  assert.deepEqual(body.contents[0].parts, [
    { inline_data: { mime_type: "image/jpeg", data: "QUJD" } },
    { text: "시간표 추출" },
  ]);
});

test("geminiModelName: 기본 gemini-flash-latest, GEMINI_MODEL·인자 오버라이드", () => {
  const saved = process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL;
  assert.equal(geminiModelName(), "gemini-flash-latest");
  process.env.GEMINI_MODEL = "gemini-2.5-pro";
  assert.equal(geminiModelName(), "gemini-2.5-pro");
  assert.equal(geminiModelName("gemini-2.0-flash"), "gemini-2.0-flash");
  if (saved === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = saved;
});

// ── 시간표 계약 스키마 ───────────────────────────────────────

test("TimetableOutput: 정상 파싱 + H:MM zero-pad + room 기본값", () => {
  const out = TimetableOutput.parse({
    lectures: [{ subject: "데이터통신", weekday: "월", start: "9:00", end: "10:30" }],
    untimed: ["취업과 창업"],
  });
  assert.equal(out.lectures[0].start, "09:00");
  assert.equal(out.lectures[0].end, "10:30");
  assert.equal(out.lectures[0].room, "");
  assert.deepEqual(out.untimed, ["취업과 창업"]);
});

test("TimetableOutput: 잘못된 요일·시간 형식 거부", () => {
  assert.throws(() =>
    TimetableOutput.parse({
      lectures: [{ subject: "x", weekday: "토", start: "09:00", end: "10:00", room: "" }],
      untimed: [],
    }),
  );
  assert.throws(() =>
    TimetableOutput.parse({
      lectures: [{ subject: "x", weekday: "월", start: "9시", end: "10:00", room: "" }],
      untimed: [],
    }),
  );
});

// ── GeminiApiEngine: fetch 목킹으로 재시도·파싱·usage 검증 ──

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_API_KEY;
});

const okGeminiResponse = (json: string) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: json }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }),
    { status: 200 },
  );

test("gemini-api: 429 후 재시도해 성공, usage는 성공 호출만 집계", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) return new Response("rate limited", { status: 429 });
    return okGeminiResponse('```json\n{"lectures":[],"untimed":[]}\n```');
  }) as typeof fetch;

  const engine = createEngine("gemini-api", { retryDelayMs: 5 });
  const out = await engine.call({
    task: "recognize_timetable",
    prompt: "p",
    payload: null,
    schema: TimetableOutput,
  });
  assert.equal(calls, 2);
  assert.deepEqual(out, { lectures: [], untimed: [] });
  assert.equal(engine.usage?.calls, 1);
  assert.equal(engine.usage?.inputTokens, 10);
  assert.equal(engine.usage?.outputTokens, 5);
});

test("gemini-api: 스키마 불일치 응답은 3회 재시도 후 실패", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return okGeminiResponse('{"wrong":"shape"}');
  }) as typeof fetch;

  const engine = createEngine("gemini-api", { retryDelayMs: 5 });
  await assert.rejects(
    engine.call({ task: "recognize_timetable", prompt: "p", payload: null, schema: TimetableOutput }),
  );
  assert.equal(calls, 3);
});

test("gemini-api: GEMINI_API_KEY 없으면 실패", async () => {
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = (async () => {
    throw new Error("fetch가 호출되면 안 됨");
  }) as typeof fetch;
  const engine = createEngine("gemini-api", { retryDelayMs: 5 });
  await assert.rejects(
    engine.call({ task: "recognize_timetable", prompt: "p", payload: null, schema: TimetableOutput }),
    /GEMINI_API_KEY/,
  );
});
