/**
 * R7 — 태스크 하나가 실패해도 DAG 전체가 죽지 않는다 (4단계).
 *
 * 실제로 있었던 일: `L4.note`가 실패하면 `await task.run(ctx)`에 try/catch가 없어
 * DAG가 중단되고, 호출부의 `run && export`가 export를 아예 실행하지 않아
 * L2·L3가 DB에 저장한 개념·근거·문항이 전부 화면에 도달하지 못했다.
 * (데통 6주차: 개념 90개는 살아남았는데 노트 없음, 능동제안 0.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDag, type Task, type TaskCtx } from "../src/orchestrator.js";

/** 실행 순서를 기록하는 가짜 태스크 */
const task = (
  id: string,
  deps: string[],
  ran: string[],
  fail = false,
): Task => ({
  id,
  layer: "L4",
  deps,
  title: id,
  run: async () => {
    if (fail) throw new Error(`${id} 일부러 실패`);
    ran.push(id);
  },
});

/**
 * runDag가 로그 줄을 만들 때 `ctx.engine.name`·`usage.calls`를 읽는다.
 * 이 테스트의 태스크는 db를 쓰지 않으므로 engine만 최소로 채운다.
 */
const ctx = () =>
  ({
    engine: { name: "stub", usage: { calls: 0 } },
    detail: undefined,
  }) as unknown as TaskCtx;

test("태스크 하나가 실패해도 무관한 태스크는 계속 실행된다", async () => {
  const ran: string[] = [];
  const r = await runDag(
    [
      task("L3.scores", [], ran),
      task("L4.questions", ["L3.scores"], ran),
      task("L4.note", ["L3.scores"], ran, true), // ← 실패 주입
      task("L4.proactive", ["L4.questions"], ran),
    ],
    ctx(),
  );

  // 노트만 실패하고 나머지는 전부 돌았다
  assert.deepEqual(ran.sort(), ["L3.scores", "L4.proactive", "L4.questions"]);
  assert.deepEqual([...r.failed.keys()], ["L4.note"]);
  assert.equal(r.skipped.size, 0);
  assert.ok(r.done.has("L4.proactive"), "능동 제안이 노트 실패에 삼켜지면 안 된다");
});

test("실패한 태스크에 의존하는 태스크만 건너뛴다", async () => {
  const ran: string[] = [];
  const r = await runDag(
    [
      task("A", [], ran, true), // 실패
      task("B", ["A"], ran), // A에 의존 → 스킵
      task("C", ["B"], ran), // 전이적으로 스킵
      task("D", [], ran), // 무관 → 실행
    ],
    ctx(),
  );

  assert.deepEqual(ran, ["D"]);
  assert.deepEqual([...r.failed.keys()], ["A"]);
  assert.deepEqual([...r.skipped].sort(), ["B", "C"]);
});

test("전부 성공하면 예전과 똑같이 동작한다 (회귀 방지)", async () => {
  const ran: string[] = [];
  const r = await runDag(
    [
      task("L1", [], ran),
      task("L2", ["L1"], ran),
      task("L3", ["L2"], ran),
    ],
    ctx(),
  );
  assert.deepEqual(ran, ["L1", "L2", "L3"]);
  assert.equal(r.failed.size, 0);
  assert.equal(r.skipped.size, 0);
  assert.equal(r.done.size, 3);
});

test("교착(순환 의존)은 여전히 에러다", async () => {
  const ran: string[] = [];
  await assert.rejects(
    () => runDag([task("X", ["Y"], ran), task("Y", ["X"], ran)], ctx()),
    /DAG 교착/,
  );
});
