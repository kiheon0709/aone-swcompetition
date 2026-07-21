/**
 * l3-signals.ts computeScores 유닛 테스트 — 결정적 가중 점수 계산 (LLM 미사용).
 * in-memory DB에 개념/근거/신호를 직접 넣고 importance·examSignal 값을 검증한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AoneDb } from "../src/db.js";
import { makeConfig } from "../src/config.js";
import { computeScores } from "../src/layers/l3-signals.js";
import type { UnitKey } from "../src/folders.js";

const SUBJECT = "데이터통신";
const CID = "c-데이터통신-패킷교환";

function freshDb(): AoneDb {
  const db = new AoneDb(":memory:");
  db.insertConcept({
    id: CID,
    subject: SUBJECT,
    name: "패킷 교환",
    norm: "패킷교환",
    first_unit: "1주차",
    first_unit_order: 1,
  });
  return db;
}

const cfg = makeConfig({ goldsetDir: "", dbPath: ":memory:", outDir: "" });
/** 점수 기대값은 설정의 가중치에서 계산한다 — 가중치를 조정해도 테스트가 깨지지 않게. */
const W = cfg.scoreWeights;
const key3: UnitKey = { subject: SUBJECT, unit: "3주차", unitOrder: 3 };

test("computeScores: 근거 없는 개념 → importance = unitsSeen 최소 1로 기저값", () => {
  const db = freshDb();
  // 근거·신호 전무: unitsSeen = 0 || 1 = 1, evidenceCount 0
  const { scored } = computeScores(db, cfg, key3);
  assert.equal(scored, 1);
  const s = db.score(CID, key3)!;
  // importance = w.perWeekSeen * 1 (unitsSeen 최소 1), examSignal = 0
  assert.equal(s.importance, Math.round(W.importancePerWeekSeen));
  assert.equal(s.exam_signal, 0);
  db.close();
});

test("computeScores: 근거·강조·기출매칭 가중 합산 (경계 이하)", () => {
  const db = freshDb();
  // 서로 다른 unit 2개에 근거 2건 → unitsSeen=2, evidenceCount=2
  db.addEvidence({ concept_id: CID, subject: SUBJECT, unit: "1주차", unit_order: 1, source_type: "transcript", locator: "00:01", quote: "q1" });
  db.addEvidence({ concept_id: CID, subject: SUBJECT, unit: "3주차", unit_order: 3, source_type: "slide", locator: "p1", quote: "q2" });
  // 강조 1, exam_hint(exam=매칭) 1
  db.addSignal({ concept_id: CID, subject: SUBJECT, unit: "3주차", unit_order: 3, kind: "emphasis", source_type: "transcript", locator: "00:01", quote: "중요" });
  db.addSignal({ concept_id: CID, subject: SUBJECT, unit: "3주차", unit_order: 3, kind: "exam_hint", source_type: "exam", locator: "2024-Q1", quote: "문항" });

  computeScores(db, cfg, key3);
  const s = db.score(CID, key3)!;
  // unitsSeen=2, evidence=2, emphasis=1, examMatch=1 (exam_hint의 source_type=exam은 매칭으로 집계)
  assert.equal(
    s.importance,
    Math.round(
      W.importancePerWeekSeen * 2 +
        W.importancePerEvidence * 2 +
        W.importancePerEmphasis * 1 +
        W.importancePerExamMatch * 1,
    ),
  );
  assert.equal(
    s.exam_signal,
    Math.round(W.examSignalPerEmphasis * 1 + W.examSignalPerExamMatch * 1),
  );
  db.close();
});

test("computeScores: clamp — 과도한 신호는 100으로 상한", () => {
  const db = freshDb();
  // 강조·시험언급·기출매칭을 상한을 넘길 만큼 쌓아 clamp(100) 동작을 확인한다.
  // (가중치를 바꿔도 깨지지 않도록 필요한 개수를 가중치에서 역산)
  const need = Math.ceil(
    100 / (W.examSignalPerEmphasis + W.examSignalPerExamHint + W.examSignalPerExamMatch),
  ) + 1;
  for (let i = 0; i < need; i++) {
    db.addSignal({ concept_id: CID, subject: SUBJECT, unit: "3주차", unit_order: 3, kind: "emphasis", source_type: "transcript", locator: `e${i}`, quote: "q" });
    db.addSignal({ concept_id: CID, subject: SUBJECT, unit: "3주차", unit_order: 3, kind: "exam_hint", source_type: "transcript", locator: `h${i}`, quote: "q" });
    db.addSignal({ concept_id: CID, subject: SUBJECT, unit: "3주차", unit_order: 3, kind: "exam_hint", source_type: "exam", locator: `m${i}`, quote: "q" });
  }
  computeScores(db, cfg, key3);
  const s = db.score(CID, key3)!;
  // 상한 초과 → 100으로 clamp
  assert.equal(s.exam_signal, 100);
  // importance도 같은 신호로 계산된다 (미clamp면 가중 합, 넘으면 100)
  assert.equal(
    s.importance,
    Math.min(
      100,
      Math.round(
        W.importancePerWeekSeen * 1 +
          W.importancePerEmphasis * need +
          W.importancePerExamMatch * need,
      ),
    ),
  );
  db.close();
});

test("computeScores: unit_order 상한 — 미래 unit 근거·신호는 누적에서 제외", () => {
  const db = freshDb();
  // 5주차(order=5) 근거·강조는 3주차 계산에 포함되면 안 됨
  db.addEvidence({ concept_id: CID, subject: SUBJECT, unit: "5주차", unit_order: 5, source_type: "transcript", locator: "x", quote: "future" });
  db.addSignal({ concept_id: CID, subject: SUBJECT, unit: "5주차", unit_order: 5, kind: "emphasis", source_type: "transcript", locator: "x", quote: "future" });

  computeScores(db, cfg, key3);
  const s = db.score(CID, key3)!;
  // 미래 근거·신호 제외 → unitsSeen 기저값만
  assert.equal(s.importance, Math.round(W.importancePerWeekSeen));
  assert.equal(s.exam_signal, 0);
  db.close();
});

test("computeScores: first_unit_order > 현재 unit인 개념은 점수 계산 대상 제외", () => {
  const db = new AoneDb(":memory:");
  db.insertConcept({ id: "c-late", subject: SUBJECT, name: "나중개념", norm: "나중개념", first_unit: "5주차", first_unit_order: 5 });
  const { scored } = computeScores(db, cfg, key3); // 3주차 시점
  assert.equal(scored, 0);
  assert.equal(db.score("c-late", key3), undefined);
  db.close();
});
