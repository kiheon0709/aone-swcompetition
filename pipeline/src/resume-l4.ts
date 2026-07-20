/**
 * 일회성 복구 스크립트: 중단된 unit의 L4만 이어서 실행.
 * 1) 신규 병합 규칙(괄호 표기 변형)을 기존 개념에 소급 적용
 * 2) 해당 unit 점수 재계산
 * 3) L4 예상문제 생성+검증, 능동 제안 판단, activity_log 기록
 * 사용: npx tsx src/resume-l4.ts <subject> <unit>   (예: npx tsx src/resume-l4.ts 데이터통신 1주차)
 */
import { AoneDb } from "./db.js";
import { makeConfig } from "./config.js";
import { createEngine } from "./adapters/llm.js";
import { isSameConcept } from "./layers/l2-knowledge.js";
import { computeScores } from "./layers/l3-signals.js";
import { generateQuestions, decideProactive } from "./layers/l4-artifacts.js";
import { nfc, resolveUnit } from "./folders.js";
import { goldsetDir, dbPath, outDir } from "./paths.js";

const [subjectArg, unitArg] = process.argv.slice(2);
if (!subjectArg || !unitArg) {
  console.error("사용법: npx tsx src/resume-l4.ts <subject> <unit>");
  process.exit(1);
}

const cfg = makeConfig({
  tier: "standard",
  engine: "claude-cli",
  goldsetDir: goldsetDir(), // env AONE_ROOT 우선, 없으면 ../goldset
  dbPath: dbPath(), // env AONE_DB 우선, 없으면 aone.db
  outDir: outDir(),
});
const key = resolveUnit(cfg.goldsetDir, nfc(subjectArg), nfc(unitArg));
const db = new AoneDb(cfg.dbPath);
const engine = createEngine("claude-cli", { concurrency: 4 });

// 1) 중복 개념 소급 병합 (먼저 등록된 개념 유지)
const concepts = db.allConcepts(key.subject);
const removed = new Set<string>();
for (let i = 0; i < concepts.length; i++) {
  if (removed.has(concepts[i].id)) continue;
  for (let j = i + 1; j < concepts.length; j++) {
    if (removed.has(concepts[j].id)) continue;
    if (!isSameConcept(concepts[i].name, concepts[j].name)) continue;
    const keep = concepts[i].id;
    const drop = concepts[j].id;
    db.raw.prepare("UPDATE OR IGNORE evidence SET concept_id = ? WHERE concept_id = ?").run(keep, drop);
    db.raw.prepare("DELETE FROM evidence WHERE concept_id = ?").run(drop);
    db.raw.prepare("UPDATE OR IGNORE signals SET concept_id = ? WHERE concept_id = ?").run(keep, drop);
    db.raw.prepare("DELETE FROM signals WHERE concept_id = ?").run(drop);
    db.raw.prepare("DELETE FROM concept_scores WHERE concept_id = ?").run(drop);
    db.raw.prepare("DELETE FROM predicted_questions WHERE concept_id = ?").run(drop);
    db.raw.prepare("DELETE FROM concepts WHERE id = ?").run(drop);
    removed.add(drop);
    console.log(`병합: "${concepts[j].name}" → "${concepts[i].name}"`);
  }
}
console.log(`중복 병합 ${removed.size}건 — 개념 ${db.allConcepts(key.subject).length}개`);

// 2) 점수 재계산
computeScores(db, cfg, key);
db.log(key, "L3", `unit 점수 재산출(복구) — 중복 개념 ${removed.size}건 병합 반영`);

// 3) L4 재개
const main = async () => {
  const r = await generateQuestions(db, engine, cfg, key);
  db.log(key, "L4", `예상문제 생성 — ${r.generated}문항 생성, 검증 통과 ${r.verified}건, 반려 ${r.rejected}건 (tier=${cfg.tier})`);
  const p = decideProactive(db, cfg, key);
  db.log(
    key,
    "L4",
    p.suggestions.length > 0
      ? `능동 제안 ${p.suggestions.length}건 발동 — ${p.suggestions.map((s) => s.conceptName).join(", ")}`
      : "능동 제안 조건 미충족 (임계·상승 조건 미달)",
  );
  const c = db.countsForUnit(key);
  db.log(key, "orchestrator", `${key.unit} 처리 완료 — 누적 개념 ${c.concepts}개, 이번 unit 신호 ${c.signals}건, 검증 통과 문항 ${c.questions}건`);
  console.log(`L4 완료: 생성 ${r.generated}, 통과 ${r.verified}, 반려 ${r.rejected}, 능동 제안 ${p.suggestions.length}`);
  const u = engine.usage!;
  console.log(`usage: 호출 ${u.calls}, in ${u.inputTokens}, out ${u.outputTokens}, $${u.costUsd.toFixed(4)}`);
  db.close();
};
main().catch((e) => {
  console.error("오류:", e);
  process.exit(1);
});
