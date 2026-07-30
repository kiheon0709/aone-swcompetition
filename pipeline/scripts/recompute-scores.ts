/**
 * 4단계 — 전 주차 computeScores 재계산 + 전/후 비교표.
 *
 * SCORE는 LLM을 안 쓰는 순수 코드라 재실행이 무료다. 이 스크립트는
 *   1) 현재 DB의 점수 분포를 먼저 읽어 "before"로 잡고
 *   2) 두 과목 1~7주차에 computeScores를 다시 돌리고
 *   3) 다시 읽어 "after"로 잡아 표로 낸다.
 *
 * 사용: npx tsx tmp-score-recompute.ts [db경로] [--dry]
 *   --dry 를 주면 재계산 없이 현재 분포만 본다.
 */
import { AoneDb } from "./src/db.js";
import { makeConfig } from "./src/config.js";
import { computeScores } from "./src/layers/l3-signals.js";
import { goldsetDir, dbPath, outDir } from "./src/paths.js";
import type { UnitKey } from "./src/folders.js";

const dbFile = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : dbPath();
const dry = process.argv.includes("--dry");

const db = new AoneDb(dbFile);
const cfg = makeConfig({ goldsetDir: goldsetDir(), dbPath: dbFile, outDir: outDir() });

interface Stat {
  subject: string;
  unit: string;
  n: number;
  impMax: number;
  impMedian: number;
  impAt100: number;
  esMax: number;
  esOver: number;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** 실제 과목만 (테스트 픽스처 과목 제외) */
const REAL = new Set(["데이터통신", "운영체제"]);

function snapshot(): Map<string, Stat> {
  const m = new Map<string, Stat>();
  for (const key of db.unitsWithScores()) {
    if (!REAL.has(key.subject)) continue;
    const rows = db.scoresAtUnit(key);
    const imp = rows.map((r) => r.importance);
    const es = rows.map((r) => r.exam_signal);
    m.set(`${key.subject}|${key.unit}`, {
      subject: key.subject,
      unit: key.unit,
      n: rows.length,
      impMax: Math.max(...imp, 0),
      impMedian: median(imp),
      impAt100: imp.filter((v) => v >= 100).length,
      esMax: Math.max(...es, 0),
      esOver: es.filter((v) => v > cfg.proactiveExamSignalThreshold).length,
    });
  }
  return m;
}

const before = snapshot();

if (!dry) {
  const targets: UnitKey[] = [];
  for (const key of db.unitsWithScores()) {
    if (REAL.has(key.subject)) targets.push(key);
  }
  targets.sort((a, b) =>
    a.subject === b.subject ? a.unitOrder - b.unitOrder : a.subject.localeCompare(b.subject),
  );
  for (const key of targets) {
    const { scored } = computeScores(db, cfg, key);
    console.log(`재계산 ${key.subject} ${key.unit} — 개념 ${scored}개`);
  }
}

const after = snapshot();

const w = cfg.scoreWeights;
console.log("");
console.log(`가중치: importance ${w.importancePerWeekSeen}/${w.importancePerEvidence}/${w.importancePerEmphasis}/${w.importancePerExamMatch}`);
console.log(`        examSignal ${w.examSignalPerEmphasis}/${w.examSignalPerExamHint}/${w.examSignalPerExamMatch}, 임계 ${cfg.proactiveExamSignalThreshold}`);
console.log("");
console.log("| 과목 | 주차 | 개념수 | imp 최대 (전→후) | imp 중앙 (전→후) | imp=100 (전→후) | es>임계 (전→후) |");
console.log("|---|---|---|---|---|---|---|");
const arrow = (a: number, b: number) => (a === b ? `${a}` : `${a} → **${b}**`);
for (const [k, aft] of after) {
  const bef = before.get(k);
  if (!bef) continue;
  console.log(
    `| ${aft.subject} | ${aft.unit} | ${aft.n} | ${arrow(bef.impMax, aft.impMax)} | ${arrow(bef.impMedian, aft.impMedian)} | ${arrow(bef.impAt100, aft.impAt100)} | ${arrow(bef.esOver, aft.esOver)} |`,
  );
}
db.close();
