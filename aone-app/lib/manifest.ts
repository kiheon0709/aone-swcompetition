/**
 * files.json 매니페스트 (docs/일반화_설계.md §7) — Rust rescan이 쓰고 프론트가 읽는다.
 * 파일시스템(goldset)의 subject/unit 트리가 단일 진실이다.
 */

export interface ManifestFile {
  name: string;
  kind: string; // "theory" | "practice" | "transcript" | "past_exam" | "audio" | …
  size: number;
}

export interface ManifestUnit {
  name: string;
  order: number;
  files: ManifestFile[];
}

export interface ManifestSubject {
  name: string;
  rootFiles: ManifestFile[];
  units: ManifestUnit[];
}

export interface FilesManifest {
  subjects: ManifestSubject[];
  rootFiles: ManifestFile[];
}

/** 한글 키·경로는 항상 NFC (macOS NFD 함정 방지 — §2) */
export const nfc = (s: string): string => s.normalize("NFC");

/** folderKey = "{subject}/{unit}" — 업로드·삭제·원문 fetch의 goldset 상대 경로 */
export const folderKeyOf = (subject: string, unit: string): string =>
  nfc(`${subject}/${unit}`);

/** slug = "{subject}__{unit}" — 산출 파일명(snapshots/slides/uploads) 키 */
export const slugOf = (subject: string, unit: string): string =>
  nfc(`${subject}__${unit}`);

const asFiles = (v: unknown): ManifestFile[] =>
  Array.isArray(v)
    ? v
        .filter(
          (f): f is { name: string; kind?: string; size?: number } =>
            typeof f === "object" && f !== null && typeof (f as { name?: unknown }).name === "string"
        )
        .map((f) => ({
          name: nfc(f.name),
          kind: typeof f.kind === "string" ? f.kind : "other",
          size: typeof f.size === "number" ? f.size : 0,
        }))
    : [];

/**
 * files.json 파싱 — §7 구조가 아니면(구 포맷 등) 빈 매니페스트로 폴백.
 * subject·unit 이름은 NFC 정규화, unit은 order 오름차순 정렬.
 */
export const parseManifest = (data: unknown): FilesManifest => {
  if (typeof data !== "object" || data === null) {
    return { subjects: [], rootFiles: [] };
  }
  const raw = data as { subjects?: unknown; rootFiles?: unknown };
  const subjects: ManifestSubject[] = Array.isArray(raw.subjects)
    ? raw.subjects
        .filter(
          (s): s is { name: string; rootFiles?: unknown; units?: unknown } =>
            typeof s === "object" && s !== null && typeof (s as { name?: unknown }).name === "string"
        )
        .map((s) => ({
          name: nfc(s.name),
          rootFiles: asFiles(s.rootFiles),
          units: (Array.isArray(s.units) ? s.units : [])
            .filter(
              (u): u is { name: string; order?: number; files?: unknown } =>
                typeof u === "object" && u !== null && typeof (u as { name?: unknown }).name === "string"
            )
            .map((u) => ({
              name: nfc(u.name),
              order: typeof u.order === "number" ? u.order : 1000,
              files: asFiles(u.files),
            }))
            .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
        }))
    : [];
  return { subjects, rootFiles: asFiles(raw.rootFiles) };
};
