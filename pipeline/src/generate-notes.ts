/**
 * 일회성 백필 스크립트: 기존 DB(개념·근거·점수)를 재료로 unit별 통합 학습노트만
 * 실 LLM(claude-cli)으로 생성해 notes 테이블에 저장한다. (unit당 1회 호출)
 * DB의 다른 데이터는 건드리지 않는다.
 *
 * 사용: CLAUDE_BIN=<순정 claude 경로> npx tsx src/generate-notes.ts --subject 데이터통신 [--unit 3주차] [--model <name>] [--db <file>] [--concurrency 2]
 */
import { AoneDb } from "./db.js";
import { makeConfig } from "./config.js";
import { createEngine } from "./adapters/llm.js";
import { composeNote } from "./layers/l4-artifacts.js";
import { nfc, folderKeyOf } from "./folders.js";
import { goldsetDir, dbPath as resolveDbPath, outDir } from "./paths.js";

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const dbPath = opt("db") ?? resolveDbPath(); // --db 플래그 우선, 없으면 env AONE_DB, 없으면 aone.db
const concurrency = parseInt(opt("concurrency") ?? "2", 10);
const model = opt("model");
const subject = opt("subject");
if (!subject) {
  console.error("--subject 필요 (예: --subject 데이터통신)");
  process.exit(1);
}
const unitFilter = opt("unit");

const cfg = makeConfig({
  tier: "standard",
  engine: "claude-cli",
  goldsetDir: goldsetDir(), // env AONE_ROOT 우선, 없으면 ../goldset
  dbPath,
  outDir: outDir(),
});
const db = new AoneDb(dbPath);
const engine = createEngine("claude-cli", { concurrency, model });

const units = db
  .unitsWithScores(nfc(subject))
  .filter((k) => unitFilter === undefined || k.unit === nfc(unitFilter));

const main = async () => {
  console.log(
    `학습노트 백필 — [${units.map((k) => folderKeyOf(k)).join(", ")}], db=${dbPath}, concurrency=${concurrency}${model ? `, model=${model}` : ""}`,
  );
  await Promise.all(
    units.map(async (key) => {
      const r = await composeNote(db, engine, cfg, key);
      db.log(key, "L4", `통합 학습노트 조립 — 중요도 상위 개념 ${r.concepts}개, 마크다운 ${r.markdownChars}자 (${key.unit}까지 누적)`);
      console.log(`${folderKeyOf(key)}: 노트 생성 완료 — 개념 ${r.concepts}개, ${r.markdownChars}자`);
    }),
  );
  const u = engine.usage!;
  console.log(
    `\nLLM 사용량 — 호출 ${u.calls}회, input ${u.inputTokens} tok, cache 생성 ${u.cacheCreationTokens} tok, cache 읽기 ${u.cacheReadTokens} tok, output ${u.outputTokens} tok, 비용 $${u.costUsd.toFixed(4)}`,
  );
  db.close();
};

main().catch((e) => {
  console.error("오류:", e instanceof Error ? e.message : e);
  process.exit(1);
});
