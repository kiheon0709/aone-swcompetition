/**
 * 9단계 감사 — 이미 저장된 근거·신호를 원문과 대조해 몇 건이 어긋나는지 센다.
 *
 * 검증 로직 자체는 L4(정확히는 L2 저장 시점)에 들어갔다. 이 스크립트는 그 로직을
 * **기존 데이터에 적용해 규모를 보고**하기 위한 것이다(쓰기 없음, 읽기 전용).
 *
 * 사용: npx tsx scripts/audit-evidence.ts [스냅샷디렉터리]
 */
import fs from "node:fs";
import path from "node:path";
import { parseTranscript } from "../src/layers/l1-normalize.js";
import { verifyEvidence, isVerifiable } from "../src/layers/evidence-verify.js";

const snapDir =
  process.argv[2] ??
  path.join(import.meta.dirname, "..", "..", "aone-app", "public", "snapshots");
const goldset = path.join(import.meta.dirname, "..", "..", "goldset");

interface Row {
  subject: string;
  unit: string;
  kind: string;
  locator: string;
  quote: string;
}

/** 앱이 서빙하는 전사본 미러 — 운영체제는 goldset이 아니라 여기에만 있다 */
const appDocs = path.join(
  import.meta.dirname,
  "..",
  "..",
  "aone-app",
  "public",
  "docs",
);

/** 전사본 원문 → locator → 텍스트 맵 */
function sourceMapOf(subject: string, unit: string): Map<string, string> | null {
  const candidates = [
    path.join(goldset, subject, unit, "transcript.txt"),
    path.join(appDocs, subject, unit, "transcript.txt"),
  ];
  const f = candidates.find((p) => fs.existsSync(p));
  if (!f) return null;
  const { utterances } = parseTranscript(fs.readFileSync(f, "utf8"));
  const m = new Map<string, string>();
  for (const u of utterances) {
    const prev = m.get(u.t);
    m.set(u.t, prev ? `${prev}\n${u.text}` : u.text);
  }
  return m;
}

let checked = 0;
let ok = 0;
let relocated = 0;
let dropped = 0;
let unverifiable = 0;
const details: string[] = [];

const files = fs
  .readdirSync(snapDir)
  .filter((f) => f.startsWith("docs_") && f.endsWith(".json"));

for (const f of files.sort()) {
  const doc = JSON.parse(fs.readFileSync(path.join(snapDir, f), "utf8"));
  const subject: string = doc.subject;
  const unit: string = doc.unit;
  const t = doc.bySource?.transcript;
  if (!t) continue;
  const sources = sourceMapOf(subject, unit);
  if (!sources) {
    console.log(`  건너뜀(원문 없음): ${subject} ${unit}`);
    continue;
  }

  const rows: Row[] = [];
  for (const kind of ["emphasis", "examHints"]) {
    for (const e of t[kind] ?? []) {
      rows.push({ subject, unit, kind, locator: e.locator, quote: e.quote });
    }
  }

  for (const r of rows) {
    if (!isVerifiable(r.quote)) {
      unverifiable++;
      continue;
    }
    checked++;
    const v = verifyEvidence(r.locator, r.quote, sources);
    if (v.outcome === "ok") ok++;
    else if (v.outcome === "relocated") {
      relocated++;
      details.push(
        `교정 | ${r.subject} ${r.unit} | ${r.kind} | ${r.locator} → ${v.locator} | "${r.quote.slice(0, 50)}…"`,
      );
    } else {
      dropped++;
      details.push(
        `폐기(${v.reason}) | ${r.subject} ${r.unit} | ${r.kind} | ${r.locator} | "${r.quote.slice(0, 50)}…"`,
      );
    }
  }
}

console.log("");
console.log(`검사 ${checked}건 — 일치 ${ok} · 교정 ${relocated} · 폐기 ${dropped}`);
console.log(`미검증 ${unverifiable}건 (인용문 없음·너무 짧음)`);
if (details.length) {
  console.log("");
  console.log("── 어긋난 건 ──");
  for (const d of details) console.log(d);
}
