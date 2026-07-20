/**
 * L3 — 추론(평가신호) 계층.
 * - 평가신호 추출: emphasis / exam_hint 두 갈래 (LLM 태스크)
 * - 기출 문항 매칭 → exam_hint(source=exam) 신호
 * - 점수 계산: LLM이 아닌 코드 — 결정적 가중 함수 computeScores
 */
import { AoneDb } from "../db.js";
import type { PipelineConfig } from "../config.js";
import {
  LlmEngine,
  ExtractSignalsOutput,
  ExtractSignalsPayload,
  MatchExamOutput,
  MatchExamPayload,
  buildPrompt,
} from "../adapters/llm.js";
import type { UnitInputs } from "./l1-normalize.js";
import { chunkUtterances } from "./l1-normalize.js";
import { isSameConcept } from "./l2-knowledge.js";
import { nfc, type UnitKey } from "../folders.js";

export interface SignalResult {
  emphasisAdded: number;
  examHintAdded: number;
}

export async function extractSignals(
  db: AoneDb,
  engine: LlmEngine,
  cfg: PipelineConfig,
  inputs: UnitInputs,
): Promise<SignalResult> {
  const concepts = db.allConcepts(inputs.key.subject);
  const conceptNames = concepts.map((c) => c.name);
  const isStub = engine.name === "stub";
  // stub은 전체 1회, 실 LLM은 블록 단위(티어 설정)로 발화 원문을 전달
  const chunks = isStub
    ? [inputs.transcript]
    : chunkUtterances(inputs.transcript, cfg.tierConfig.chunkSeconds, cfg.tierConfig.chunkMaxChars);

  let emphasisAdded = 0;
  let examHintAdded = 0;

  const nonEmpty = chunks.filter((c) => c.length > 0);
  // 청크별 호출은 독립 — 병렬 실행, DB 반영은 청크 순서대로.
  // allSettled: 한 청크 호출이 실패해도 나머지 성공분은 반영한다.
  const settled = await Promise.allSettled(
    nonEmpty.map((chunk, ci) => {
      const payload: ExtractSignalsPayload = { utterances: chunk, conceptNames };
      return engine.call({
        task: "extract_signals",
        progress: { index: ci, total: nonEmpty.length },
        payload,
        schema: ExtractSignalsOutput,
        prompt: buildPrompt(
          "extract_signals",
          [
            `아래는 대학 '${inputs.key.subject}' 강의(${inputs.key.unit}) STT 전사본의 한 블록이다.`,
            "교수가 시험 출제를 직접 암시하는 발화(kind=exam_hint: \"시험에 나온다\", \"중간고사\", 기출/족보 언급, \"문제 낼 거예요\" 등)와",
            "특별히 강조하는 발화(kind=emphasis: \"중요하다\", \"반드시\", \"꼭 기억\", 반복 강조)를 찾아라.",
            "각 발화를 아래 개념 목록(conceptNames) 중 실제로 관련된 개념에 연결하라. 목록에 없는 개념은 만들지 말고 버려라.",
            "locator는 해당 발화의 t 값을 그대로, quote는 그 발화 문장을 그대로 복사(140자 이내). 해당 없으면 signals를 빈 배열로.",
          ].join("\n"),
          payload,
          `{"signals":[{"concept":"...","kind":"emphasis|exam_hint","locator":"12:34","quote":"..."}]}`,
        ),
      });
    }),
  );

  for (let ci = 0; ci < nonEmpty.length; ci++) {
    const chunk = nonEmpty[ci];
    const res = settled[ci];
    if (res.status === "rejected") {
      const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
      console.warn(`  경고: 평가신호 추출 청크 ${ci + 1}/${nonEmpty.length} 실패 — 건너뜁니다 (${msg.slice(0, 160)}).`);
      continue;
    }
    const out = res.value;
    const allowed = isStub ? null : new Set(chunk.map((u) => nfc(u.t)));
    for (const s of out.signals ?? []) {
      const concept = concepts.find((c) => isSameConcept(c.name, s.concept));
      if (!concept) continue;
      if (allowed && !allowed.has(nfc(s.locator))) continue; // 지어낸 locator 차단
      if (db.signalCount(concept.id, inputs.key, s.kind) >= cfg.maxSignalsPerConceptKindWeek) continue;
      const added = db.addSignal({
        concept_id: concept.id,
        subject: inputs.key.subject,
        unit: inputs.key.unit,
        unit_order: inputs.key.unitOrder,
        kind: s.kind,
        source_type: "transcript",
        locator: s.locator,
        quote: s.quote,
      });
      if (added) s.kind === "emphasis" ? emphasisAdded++ : examHintAdded++;
    }
  }
  return { emphasisAdded, examHintAdded };
}

export interface ExamIngestResult {
  itemsStored: number;
  matches: number;
  matchedConceptIds: Set<string>;
}

/** 기출 투입 이벤트: 문항 저장 + 개념 매칭 → exam_hint(source=exam) 신호 */
export async function ingestPastExams(
  db: AoneDb,
  engine: LlmEngine,
  cfg: PipelineConfig,
  inputs: UnitInputs,
): Promise<ExamIngestResult> {
  const result: ExamIngestResult = { itemsStored: 0, matches: 0, matchedConceptIds: new Set() };
  if (inputs.pastExams.length === 0) return result;

  for (const item of inputs.pastExams) {
    db.addPastExamItem({
      id: item.id,
      key: inputs.key,
      year: item.year,
      exam_id: item.examId,
      question: item.question,
    });
    result.itemsStored++;
  }

  const concepts = db.allConcepts(inputs.key.subject);
  const payload: MatchExamPayload = { items: inputs.pastExams, conceptNames: concepts.map((c) => c.name) };
  const out = await engine.call({
    task: "match_exam_items",
    payload,
    schema: MatchExamOutput,
    prompt: buildPrompt(
      "match_exam_items",
      `아래는 '${inputs.key.subject}' 중간고사 기출 문항 요약(items)과 현재 지식 베이스의 개념 목록(concepts)이다. ` +
        "각 문항이 실제로 다루는 개념을 목록에서 골라 매칭하라(한 문항에 여러 개념 가능, 관련 개념이 없으면 그 문항은 생략). " +
        "concept 값은 반드시 목록의 이름을 그대로 사용하라.",
      { items: inputs.pastExams.map((i) => ({ id: i.id, q: i.question })), concepts: payload.conceptNames },
      `{"matches":[{"itemId":"...","concept":"..."}]}`,
    ),
  });

  for (const m of out.matches ?? []) {
    const concept = concepts.find((c) => isSameConcept(c.name, m.concept));
    const item = inputs.pastExams.find((i) => i.id === m.itemId);
    if (!concept || !item) continue;
    if (db.signalCount(concept.id, inputs.key, "exam_hint", "exam") >= cfg.maxSignalsPerConceptKindWeek) continue;
    const qNo = item.id.split("-Q").pop();
    const locator = item.year !== null && qNo ? `${item.year}-Q${qNo}` : item.id;
    const added = db.addSignal({
      concept_id: concept.id,
      subject: inputs.key.subject,
      unit: inputs.key.unit,
      unit_order: inputs.key.unitOrder,
      kind: "exam_hint",
      source_type: "exam",
      locator,
      quote: item.question,
    });
    if (added) {
      result.matches++;
      result.matchedConceptIds.add(concept.id);
      // 기출 문항 자체를 근거(evidence)로도 연결 — 예상문제 source에 사용
      db.addEvidence({
        concept_id: concept.id,
        subject: inputs.key.subject,
        unit: inputs.key.unit,
        unit_order: inputs.key.unitOrder,
        source_type: "exam",
        locator,
        quote: item.question,
      });
    }
  }
  return result;
}

/**
 * 결정적 점수 계산 (LLM 미사용).
 * importance  = w1·등장unit수 + w2·근거수 + w3·강조수 + w4·기출매칭수
 * examSignal  = w5·강조수 + w6·시험언급수 + w7·기출매칭수
 */
export function computeScores(db: AoneDb, cfg: PipelineConfig, key: UnitKey): { scored: number } {
  const w = cfg.scoreWeights;
  const concepts = db.allConcepts(key.subject).filter((c) => c.first_unit_order <= key.unitOrder);
  for (const c of concepts) {
    const evidence = db.evidenceForConcept(c.id, key.subject, key.unitOrder);
    const unitsSeen = new Set(evidence.map((e) => e.unit)).size || 1;
    const evidenceCount = evidence.length;
    const s = db.signalStats(c.id, key.subject, key.unitOrder);
    const importance = clamp(
      w.importancePerWeekSeen * unitsSeen +
        w.importancePerEvidence * evidenceCount +
        w.importancePerEmphasis * s.emphasis +
        w.importancePerExamMatch * s.examMatch,
    );
    const examSignal = clamp(
      w.examSignalPerEmphasis * s.emphasis +
        w.examSignalPerExamHint * s.examHint +
        w.examSignalPerExamMatch * s.examMatch,
    );
    db.upsertScore({
      concept_id: c.id,
      subject: key.subject,
      unit: key.unit,
      unit_order: key.unitOrder,
      importance,
      exam_signal: examSignal,
    });
  }
  return { scored: concepts.length };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
