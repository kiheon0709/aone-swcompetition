/**
 * 5단계 — L4 composeNote만 단독 실행 (다른 레이어·다른 주차는 건드리지 않는다).
 *
 * `cli.ts run`은 L0~L4를 다 돌리므로 노트만 다시 만들 수 없다. 이 스크립트는
 * `composeNote`만 호출한다. DB 경로를 인자로 받으므로 사본에 대고 돌려
 * 원본을 위험에 두지 않을 수 있다.
 *
 * 사용: npx tsx scripts/compose-note-only.ts <db경로> <과목> <주차> [엔진]
 *   예: npx tsx scripts/compose-note-only.ts /tmp/try.db 데이터통신 6주차 codex-cli
 */
import { AoneDb } from "../src/db.js";
import { makeConfig, EngineName } from "../src/config.js";
import { createEngine } from "../src/adapters/llm.js";
import { composeNote } from "../src/layers/l4-artifacts.js";
import { goldsetDir, outDir } from "../src/paths.js";
import { resolveUnit } from "../src/folders.js";

const [dbFile, subject, unit, engineName = "codex-cli"] = process.argv.slice(2);
if (!dbFile || !subject || !unit) {
  console.error("사용: npx tsx scripts/compose-note-only.ts <db> <과목> <주차> [엔진]");
  process.exit(2);
}

const db = new AoneDb(dbFile);
const cfg = makeConfig({ goldsetDir: goldsetDir(), dbPath: dbFile, outDir: outDir() });
const engine = createEngine(engineName as EngineName, cfg);
const key = resolveUnit(cfg.goldsetDir, subject, unit);

const before = db.noteAtUnit(key);
console.log(`실행 전 노트: ${before === undefined ? "없음" : before.length + "자"}`);
console.log(`엔진: ${engineName} / DB: ${dbFile}`);

const t0 = Date.now();
const r = await composeNote(db, engine, cfg, key);
console.log(
  `완료 ${Math.round((Date.now() - t0) / 1000)}초 — 개념 ${r.concepts}개, ${r.markdownChars}자, skipped=${r.skipped}`,
);
const after = db.noteAtUnit(key);
console.log(`실행 후 노트: ${after === undefined ? "없음" : after.length + "자, 섹션 " + (after.split("\n## ").length - 1)}`);
db.close();
