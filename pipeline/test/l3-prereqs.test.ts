/**
 * l3-prereqs.ts 유닛 테스트 — 선수관계 그래프와 공부 순서.
 * LLM을 쓰지 않는 부분(curriculum·exam_pair 규칙, studyOrder 위상정렬)만 검증한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AoneDb } from "../src/db.js";
import { createEngine } from "../src/adapters/llm.js";
import { linkPrerequisites, studyOrder } from "../src/layers/l3-prereqs.js";

const SUBJECT = "운영체제";
const engine = createEngine("stub", {});

/** id는 이름 그대로 써서 테스트를 읽기 쉽게 한다 */
function addConcept(db: AoneDb, name: string, unitOrder: number): string {
  const id = `c-${name}`;
  db.insertConcept({
    id,
    subject: SUBJECT,
    name,
    norm: name,
    first_unit: `${unitOrder}주차`,
    first_unit_order: unitOrder,
  });
  return id;
}

/** 두 개념을 같은 자료 구간에 등장시켜 "관련 있음"으로 만든다 */
function coOccur(db: AoneDb, a: string, b: string, unit: string, locator: string): void {
  for (const id of [a, b]) {
    db.addEvidence({
      concept_id: id,
      subject: SUBJECT,
      unit,
      unit_order: Number(unit[0]),
      source_type: "slide",
      locator,
      quote: `${id} 설명`,
    });
  }
}

function setScore(db: AoneDb, id: string, unitOrder: number, importance: number): void {
  db.raw
    .prepare(
      "INSERT OR REPLACE INTO concept_scores (concept_id, subject, unit, unit_order, importance, exam_signal) VALUES (?,?,?,?,?,0)",
    )
    .run(id, SUBJECT, `${unitOrder}주차`, unitOrder, importance);
}

test("curriculum: 같은 자료에 함께 등장한 이전 주차 개념만 선수가 된다", async () => {
  const db = new AoneDb(":memory:");
  const proc = addConcept(db, "프로세스", 1);
  const sched = addConcept(db, "스케줄링", 2);
  const unrelated = addConcept(db, "파일시스템", 1);
  setScore(db, proc, 1, 50);
  setScore(db, unrelated, 1, 90); // 중요도는 더 높지만 관련이 없다
  setScore(db, sched, 2, 50);
  coOccur(db, proc, sched, "2주차", "theory_01 p.3");

  await linkPrerequisites(db, engine, SUBJECT);

  const prereqs = db.raw
    .prepare("SELECT prerequisite_id FROM concept_prereqs WHERE concept_id = ? AND origin = 'curriculum'")
    .all(sched) as { prerequisite_id: string }[];
  assert.deepEqual(
    prereqs.map((p) => p.prerequisite_id),
    [proc],
    "함께 등장하지 않은 개념은 중요도가 높아도 선수로 잡히면 안 된다",
  );
});

test("curriculum: 나중에 배운 개념은 선수가 되지 않는다", async () => {
  const db = new AoneDb(":memory:");
  const early = addConcept(db, "이른개념", 1);
  const late = addConcept(db, "늦은개념", 3);
  setScore(db, early, 1, 50);
  setScore(db, late, 3, 50);
  coOccur(db, early, late, "3주차", "theory_01 p.1");

  await linkPrerequisites(db, engine, SUBJECT);

  const back = db.raw
    .prepare("SELECT 1 FROM concept_prereqs WHERE concept_id = ? AND prerequisite_id = ?")
    .get(early, late);
  assert.equal(back, undefined, "시간을 거스르는 선수관계는 생기면 안 된다");
});

test("exam_pair: 같은 기출 문항에 2회 이상 함께 매칭되면 양방향으로 연결된다", async () => {
  const db = new AoneDb(":memory:");
  const a = addConcept(db, "세마포어", 1);
  const b = addConcept(db, "임계구역", 1);
  for (const locator of ["2019-Q1", "2020-Q3"]) {
    for (const id of [a, b]) {
      db.addSignal({
        concept_id: id,
        subject: SUBJECT,
        unit: "1주차",
        unit_order: 1,
        kind: "exam_hint",
        source_type: "exam",
        locator,
        quote: `${locator} 문항`,
      });
    }
  }

  await linkPrerequisites(db, engine, SUBJECT);

  const rows = db.raw
    .prepare("SELECT concept_id, prerequisite_id FROM concept_prereqs WHERE origin = 'exam_pair'")
    .all() as { concept_id: string; prerequisite_id: string }[];
  assert.equal(rows.length, 2, "함께 물어본 개념은 선후가 아니라 짝이므로 양방향");
});

test("exam_pair: 1회만 함께 나온 쌍은 노이즈로 보고 버린다", async () => {
  const db = new AoneDb(":memory:");
  const a = addConcept(db, "개념A", 1);
  const b = addConcept(db, "개념B", 1);
  for (const id of [a, b]) {
    db.addSignal({
      concept_id: id,
      subject: SUBJECT,
      unit: "1주차",
      unit_order: 1,
      kind: "exam_hint",
      source_type: "exam",
      locator: "2019-Q1",
      quote: "한 번만 함께",
    });
  }

  await linkPrerequisites(db, engine, SUBJECT);

  const rows = db.raw.prepare("SELECT 1 FROM concept_prereqs WHERE origin = 'exam_pair'").all();
  assert.equal(rows.length, 0);
});

test("studyOrder: 선수 개념이 항상 먼저 나온다", async () => {
  const db = new AoneDb(":memory:");
  const base = addConcept(db, "기초", 1);
  const mid = addConcept(db, "중간", 2);
  const top = addConcept(db, "심화", 3);
  // 중요도는 역순으로 줘서, 순서가 중요도가 아니라 선수관계로 결정되는지 본다
  setScore(db, base, 1, 10);
  setScore(db, mid, 2, 50);
  setScore(db, top, 3, 100);
  coOccur(db, base, mid, "2주차", "p.1");
  coOccur(db, mid, top, "3주차", "p.2");

  await linkPrerequisites(db, engine, SUBJECT);
  const order = studyOrder(db, SUBJECT, [top, mid, base]).map((o) => o.name);

  assert.ok(order.indexOf("기초") < order.indexOf("중간"), "기초가 중간보다 먼저");
  assert.ok(order.indexOf("중간") < order.indexOf("심화"), "중간이 심화보다 먼저");
});

test("studyOrder: 범위 밖 개념은 선수로 표시하지 않는다", async () => {
  const db = new AoneDb(":memory:");
  const base = addConcept(db, "기초", 1);
  const target = addConcept(db, "대상", 2);
  setScore(db, base, 1, 50);
  setScore(db, target, 2, 50);
  coOccur(db, base, target, "2주차", "p.1");

  await linkPrerequisites(db, engine, SUBJECT);
  // 기초를 범위에서 빼고 대상만 요청
  const order = studyOrder(db, SUBJECT, [target]);

  assert.equal(order.length, 1);
  assert.deepEqual(order[0].prereqs, [], "범위 밖 개념이 선수로 새어나오면 안 된다");
});

test("studyOrder: 순환이 있어도 멈추지 않고 모든 개념을 낸다", async () => {
  const db = new AoneDb(":memory:");
  const a = addConcept(db, "A", 1);
  const b = addConcept(db, "B", 1);
  setScore(db, a, 1, 40);
  setScore(db, b, 1, 90);
  // 같은 주차 개념에 순환 선수관계를 직접 심는다 (llm 판정이 잘못된 경우를 흉내)
  const ins = db.raw.prepare(
    "INSERT INTO concept_prereqs (concept_id, prerequisite_id, subject, origin, weight) VALUES (?,?,?,'llm',1)",
  );
  ins.run(a, b, SUBJECT);
  ins.run(b, a, SUBJECT);

  const order = studyOrder(db, SUBJECT, [a, b]);
  assert.equal(order.length, 2, "순환에 걸려 개념이 누락되면 안 된다");
  assert.equal(order[0].name, "B", "교착 시 중요도가 높은 쪽을 먼저 진행시킨다");
});

test("증분: 이미 판정한 주차는 LLM에 다시 묻지 않는다", async () => {
  const db = new AoneDb(":memory:");
  const a = addConcept(db, "개념A", 1);
  const b = addConcept(db, "개념B", 1);
  setScore(db, a, 1, 50);
  setScore(db, b, 1, 50);
  // 1주차에 llm 판정이 이미 있다고 표시
  db.raw
    .prepare(
      "INSERT INTO concept_prereqs (concept_id, prerequisite_id, subject, origin, weight) VALUES (?,?,?,'llm',2)",
    )
    .run(b, a, SUBJECT);

  let calls = 0;
  const counting = {
    name: "counting",
    usage: { calls: 0, retries: 0 },
    async call<T>(req: { schema: { parse: (v: unknown) => T } }): Promise<T> {
      calls++;
      return req.schema.parse({ links: [] });
    },
  } as unknown as Parameters<typeof linkPrerequisites>[1];

  await linkPrerequisites(db, counting, SUBJECT);
  assert.equal(calls, 0, "판정이 끝난 주차만 있으면 LLM 호출이 없어야 한다");

  // 기존 판정은 살아있어야 한다
  const kept = db.raw.prepare("SELECT 1 FROM concept_prereqs WHERE origin = 'llm'").all();
  assert.equal(kept.length, 1);
});
