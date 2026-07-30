/**
 * R7 — L4 노트 생성이 실패하면 직전 노트를 승계한다 (4단계).
 * 승계할 노트조차 없으면 그때만 throw (호출부가 태스크 실패로 처리).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AoneDb } from "../src/db.js";
import { makeConfig } from "../src/config.js";
import { composeNote } from "../src/layers/l4-artifacts.js";
import type { LlmEngine } from "../src/adapters/llm.js";
import type { UnitKey } from "../src/folders.js";

const SUBJECT = "테스트과목";

/** 항상 실패하는 엔진 — 실제 LLM 실패를 흉내낸다 */
const failingEngine = (): LlmEngine =>
  ({
    name: "stub",
    usage: { calls: 0 },
    call: async () => {
      throw new Error("모델 응답 파싱 실패 (주입된 실패)");
    },
  }) as unknown as LlmEngine;

function seed(db: AoneDb, unitOrder: number): UnitKey {
  const key: UnitKey = { subject: SUBJECT, unit: `${unitOrder}주차`, unitOrder };
  const id = `c-${SUBJECT}-개념${unitOrder}`;
  db.insertConcept({
    id,
    subject: SUBJECT,
    name: `개념${unitOrder}`,
    norm: `개념${unitOrder}`,
    first_unit: key.unit,
    first_unit_order: unitOrder,
  });
  db.addEvidence({
    concept_id: id,
    subject: SUBJECT,
    unit: key.unit,
    unit_order: unitOrder,
    source_type: "transcript",
    locator: "00:10",
    quote: "이 개념은 중요합니다.",
  });
  db.upsertScore({
    concept_id: id,
    subject: SUBJECT,
    unit: key.unit,
    unit_order: unitOrder,
    importance: 50,
    exam_signal: 30,
  });
  return key;
}

const cfg = () =>
  makeConfig({ goldsetDir: "/tmp", dbPath: ":memory:", outDir: "/tmp" });

test("직전 노트가 있으면 실패해도 승계한다 — throw하지 않는다", async () => {
  const db = new AoneDb(":memory:");
  const k1 = seed(db, 1);
  const prior = "# 테스트과목 학습노트 — 1주차까지\n\n## 1. 개념1\n내용";
  db.upsertNote(k1, prior);

  const k2 = seed(db, 2);
  const r = await composeNote(db, failingEngine(), cfg(), k2);

  assert.equal(r.failed?.inherited, true, "승계 표시가 있어야 한다");
  assert.match(r.failed!.reason, /주입된 실패/);
  assert.equal(db.noteAtUnit(k2), prior, "2주차에 직전 노트가 승계돼야 한다");
  db.close();
});

test("승계할 노트가 없으면 throw한다 (태스크 실패로 처리)", async () => {
  const db = new AoneDb(":memory:");
  const k1 = seed(db, 1); // 직전 노트 없음
  await assert.rejects(
    () => composeNote(db, failingEngine(), cfg(), k1),
    /주입된 실패/,
  );
  db.close();
});
