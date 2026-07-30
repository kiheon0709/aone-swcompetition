/**
 * 파일 kind 판정 — **단일 진실 공급원** (R1-c).
 *
 * 배경 — `files.json`의 `kind`가 비어 있으면 `f.kind === "transcript"` 같은 비교가
 * 전부 거짓이 된다. 화면 15곳이 그 비교에 걸려 있었고, 폴백은 일부(`page.tsx:1408/1419`)에만
 * 손으로 붙어 있었다. 나머지(1490·2053·2784)에는 없어서 같은 파일을 두고 화면마다 판정이 달랐다.
 *
 * 그래서 판정을 여기 한 곳에 모은다. 각 호출부에 정규식을 흩어놓지 않는다.
 *
 * 판정 순서:
 *   1. 매니페스트의 `kind`가 있고 `other`가 아니면 그대로 믿는다 (Rust 생산자가 이미 폴더까지 봤다)
 *   2. 없으면 파일명 + 폴더명으로 추론한다 — Rust `classify_in`과 같은 규칙
 *
 * 규칙을 바꿀 때는 `src-tauri/src/commands/files.rs`의 `classify`/`classify_in`과
 * `scripts/add-kind-to-files-json.mjs`도 함께 고쳐야 한다. 세 곳이 갈라지면 이 결함이 되돌아온다.
 */

/** 파이프라인·화면이 쓰는 파일 종류 */
export type FileKind =
  | "theory"
  | "practice"
  | "transcript"
  | "past_exam"
  | "audio"
  | "image"
  | "note"
  | "other";

/** kind 판정에 필요한 최소 정보 */
export interface KindInput {
  name: string;
  kind?: string;
}

const hasAny = (s: string, words: string[]): boolean =>
  words.some((w) => s.includes(w));

const extOf = (n: string): string => {
  const i = n.lastIndexOf(".");
  return i === -1 ? "" : n.slice(i + 1);
};

/** 확장자 규칙이 없는 형식(.json·확장자 없음)용 폴백 — Rust classify_by_name */
const byName = (n: string): FileKind => {
  if (n.includes("transcript")) return "transcript";
  if (n.includes("theory")) return "theory";
  if (n.includes("practice") || n.startsWith("lab_")) return "practice";
  if (n.includes("exam")) return "past_exam";
  return "other";
};

/** 파일명만으로 판정 — Rust classify */
export const kindOfName = (name: string): FileKind => {
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
      return byName(n);
    default:
      return "other";
  }
};

/** 족보 폴더인가 — 사용자가 "족보"·"기출"·"exam" 중 무엇으로 만들든 같게 본다 */
export const isExamFolder = (folder: string): boolean =>
  hasAny(folder.toLowerCase(), ["족보", "기출", "exam"]);

/**
 * 파일 kind 판정 (권장 진입점).
 *
 * @param file  매니페스트 엔트리 (`kind`가 없거나 `other`여도 된다)
 * @param folder 그 파일이 있는 폴더 이름 ("3주차"·"족보"). 모르면 생략한다.
 */
export const kindOf = (file: KindInput, folder = ""): FileKind => {
  const declared = file.kind;
  if (declared && declared !== "other") return declared as FileKind;

  const guessed = kindOfName(file.name);
  if (!isExamFolder(folder)) return guessed;
  // 족보 폴더 안 — 전사본·녹음은 그대로, 나머지는 족보로 본다
  return guessed === "transcript" || guessed === "audio" ? guessed : "past_exam";
};

/** 전사본인가 — 가장 많이 쓰이는 판정이라 헬퍼로 둔다 */
export const isTranscript = (file: KindInput, folder = ""): boolean =>
  kindOf(file, folder) === "transcript";

/** 족보 자료인가 */
export const isPastExam = (file: KindInput, folder = ""): boolean =>
  kindOf(file, folder) === "past_exam";

/** 슬라이드(이론·실습)인가 */
export const isSlide = (file: KindInput, folder = ""): boolean => {
  const k = kindOf(file, folder);
  return k === "theory" || k === "practice";
};
