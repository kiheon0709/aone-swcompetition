/**
 * public/files.json에 kind를 채운다 (R1-a).
 *
 * 왜 rescan_files()로 재생성하지 않는가 —
 * `public/files.json`은 goldset 스캔 결과가 아니라 **손으로 큐레이션한 데모 매니페스트**다.
 * 50개 중 15개(운영체제 PDF 8 + 족보 7)는 저작권 때문에 실제 파일을 배포하지 않는다
 * (`.gitignore`: "public 데모 데이터 (교수 강의 자료 — 저작권)").
 * goldset에서 재생성하면 운영체제가 22개 → 1개가 되어 데모가 무너진다.
 *
 * 그래서 목록은 그대로 두고 **kind만 채운다.** 판정 규칙은 Rust `classify_in`과 같다
 * (`src-tauri/src/commands/files.rs`). 두 곳이 갈라지면 안 되므로 규칙을 바꿀 때는 양쪽을 함께 고친다.
 *
 * 사용: node scripts/add-kind-to-files-json.mjs [--check]
 *   --check 를 주면 쓰지 않고 차이만 보고한다 (CI/검증용).
 */
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(import.meta.dirname, "..", "public", "files.json");
const check = process.argv.includes("--check");

const hasAny = (s, words) => words.some((w) => s.includes(w));
const extOf = (n) => {
  const i = n.lastIndexOf(".");
  return i === -1 ? "" : n.slice(i + 1);
};

/** Rust classify_by_name — 확장자 규칙이 없는 형식(.json·확장자 없음)용 폴백 */
const classifyByName = (n) => {
  if (n.includes("transcript")) return "transcript";
  if (n.includes("theory")) return "theory";
  if (n.includes("practice") || n.startsWith("lab_")) return "practice";
  if (n.includes("exam")) return "past_exam";
  return "other";
};

/** Rust classify — 확장자 우선, 같은 확장자 안에서 파일명 키워드 */
const classify = (name) => {
  const n = name.toLowerCase();
  switch (extOf(n)) {
    case "pdf":
    case "ppt":
    case "pptx":
      if (hasAny(n, ["practice", "실습", "lab"])) return "practice";
      if (hasAny(n, ["exam", "기출", "족보"])) return "past_exam";
      return "theory";
    case "m4a":
    case "mp3":
    case "wav":
    case "m4v":
      return "audio";
    case "txt":
    case "md":
      if (hasAny(n, ["transcript", "전사", "녹음"])) return "transcript";
      if (hasAny(n, ["exam", "기출", "족보"])) return "past_exam";
      if (n.includes("theory")) return "theory";
      if (n.includes("practice") || n.startsWith("lab_")) return "practice";
      return "note";
    case "jpg":
    case "jpeg":
    case "png":
      return hasAny(n, ["exam", "기출", "족보"]) ? "past_exam" : "image";
    case "":
    case "json":
      return classifyByName(n);
    default:
      return "other";
  }
};

/** Rust is_exam_folder */
const isExamFolder = (folder) =>
  hasAny(folder.toLowerCase(), ["족보", "기출", "exam"]);

/** Rust classify_in — 족보 폴더 안이면 파일명과 무관하게 past_exam (전사본·녹음 제외) */
const classifyIn = (folder, name) => {
  const byName = classify(name);
  if (!isExamFolder(folder)) return byName;
  return byName === "transcript" || byName === "audio" ? byName : "past_exam";
};

const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const changes = [];
let total = 0;

const applyTo = (folder, files) => {
  for (const f of files ?? []) {
    total++;
    const kind = classifyIn(folder, f.name);
    if (f.kind !== kind) {
      changes.push(`${folder || "(루트)"}/${f.name}: ${f.kind ?? "(없음)"} → ${kind}`);
      f.kind = kind;
    }
  }
};

applyTo("", doc.rootFiles);
for (const s of doc.subjects ?? []) {
  applyTo("", s.rootFiles);
  for (const u of s.units ?? []) applyTo(u.name, u.files);
}

console.log(`파일 ${total}개 중 ${changes.length}개 변경`);
for (const c of changes) console.log(`  ${c}`);

if (!check) {
  // Rust serde_json::to_string_pretty와 같은 2칸 들여쓰기 + 끝 개행
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + "\n");
  console.log(`\n기록: ${FILE}`);
} else if (changes.length > 0) {
  process.exit(1);
}
