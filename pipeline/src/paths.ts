/**
 * 파이프라인 경로 결정 (경로재설계_계약 §4).
 *
 * 환경변수 우선, 없으면 현행 개발 경로로 폴백 (개발 지속 가능하게).
 *   AONE_ROOT — 자료 루트(과목 폴더 직속). 있으면 goldset = AONE_ROOT, export는 폴더 옆 .aone/로.
 *   AONE_DB   — knowledge.db 절대경로.
 *   AONE_DATA — 앱 전역 데이터 디렉토리(=.aone). extracted/, usage.json이 여기.
 *
 * 폴백(개발):
 *   goldset   = <PROJECT_ROOT>/../goldset
 *   db        = <PROJECT_ROOT>/aone.db
 *   extracted = <PROJECT_ROOT>/.extracted
 *   usage.json= <PROJECT_ROOT>/../aone-app/public/snapshots/usage.json
 *   export    = aone-app/public/snapshots|slides (플랫)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UnitKey } from "./folders.js";
import { slugOf, nfc } from "./folders.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, "..");

/** AONE_ROOT env가 설정되면 새 레이아웃(폴더 옆 .aone/), 없으면 개발 폴백(플랫 public) */
export function isNewLayout(): boolean {
  return !!process.env.AONE_ROOT;
}

/** 자료 루트(goldset). env AONE_ROOT 우선, 없으면 현행 ../goldset */
export function goldsetDir(): string {
  return process.env.AONE_ROOT ?? path.resolve(PROJECT_ROOT, "..", "goldset");
}

/** knowledge.db 경로. env AONE_DB 우선, 없으면 현행 aone.db */
export function dbPath(): string {
  return process.env.AONE_DB ?? path.join(PROJECT_ROOT, "aone.db");
}

/** L0 추출 캐시 디렉토리. env AONE_DATA/extracted, 없으면 현행 .extracted */
export function extractedDir(): string {
  return process.env.AONE_DATA
    ? path.join(process.env.AONE_DATA, "extracted")
    : path.join(PROJECT_ROOT, ".extracted");
}

/** run 시 out 디렉토리 (export 기본 out). 새 레이아웃에서는 export가 폴더 .aone/로 가므로 의미 축소 */
export function outDir(): string {
  return path.join(PROJECT_ROOT, "out");
}

/** usage.json 경로. env AONE_DATA/usage.json, 없으면 현행 public/snapshots/usage.json */
export function usagePath(): string {
  return process.env.AONE_DATA
    ? path.join(process.env.AONE_DATA, "usage.json")
    : path.resolve(PROJECT_ROOT, "..", "aone-app", "public", "snapshots", "usage.json");
}

/**
 * LLM 실패 덤프 디렉토리 (R7).
 * 모델이 실제로 뭘 반환했는지 남기지 않아 원인 규명이 매번 막혔다.
 * env AONE_DATA/logs, 없으면 pipeline/logs.
 */
export function logsDir(): string {
  const dir = process.env.AONE_DATA
    ? path.join(process.env.AONE_DATA, "logs")
    : path.join(PROJECT_ROOT, "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 개발 폴백 슬라이드 병합 디렉토리 (플랫) */
export function appSlidesDir(): string {
  return path.resolve(PROJECT_ROOT, "..", "aone-app", "public", "slides");
}

/** 새 레이아웃에서 unit 폴더 옆 .aone/ 디렉토리 (AONE_ROOT/<과목>/<폴더>/.aone) */
export function unitAoneDir(key: Pick<UnitKey, "subject" | "unit">): string {
  return path.join(goldsetDir(), key.subject, key.unit, ".aone");
}

/** 개발 폴백 스냅샷 디렉토리 (플랫) — guide_<slug>.json 등 과목 수준 산출물의 폴백 위치 */
export function appSnapshotsDir(): string {
  return path.resolve(PROJECT_ROOT, "..", "aone-app", "public", "snapshots");
}

/**
 * 학습 가이드(과목 수준) 산출물 경로.
 *   새 레이아웃(AONE_ROOT): AONE_ROOT/<과목>/.aone/guide.json
 *   폴백(env 없음)        : public/snapshots/guide_<과목slug>.json  (fallbackDir는 호출자가 넘김)
 */
export function guideFilePath(subject: string, fallbackDir: string): string {
  if (isNewLayout()) {
    return path.join(goldsetDir(), subject, ".aone", "guide.json");
  }
  const slug = nfc(subject).replace(/[/\\]/g, "_");
  return path.join(fallbackDir, `guide_${slug}.json`);
}

/**
 * export 산출물의 실제 파일 경로 결정.
 *   새 레이아웃(AONE_ROOT): analysis→.aone/analysis.json, docs→.aone/docs.json, slides→.aone/slides.json
 *   폴백(env 없음)         : 현행 플랫 — analysis→{outDir}/{slug}.json, docs→{outDir}/docs_{slug}.json,
 *                            slides→{slidesDir}/{slug}.json  (outDir/slidesDir는 호출자가 넘김)
 */
export function exportFilePath(
  kind: "analysis" | "docs" | "slides" | "docSummaries",
  key: UnitKey,
  fallbackDir: string,
): string {
  if (isNewLayout()) {
    const dir = unitAoneDir(key);
    const name =
      kind === "analysis"
        ? "analysis.json"
        : kind === "docs"
          ? "docs.json"
          : kind === "docSummaries"
            ? "doc-summaries.json"
            : "slides.json";
    return path.join(dir, name);
  }
  const slug = slugOf(key);
  if (kind === "slides") return path.join(fallbackDir, `${slug}.json`);
  // 자료 단위 요약(overview·themes) — slides.json은 배열이라 담을 곳이 없어 따로 둔다.
  if (kind === "docSummaries") return path.join(fallbackDir, `docsum_${slug}.json`);
  const prefix = kind === "docs" ? "docs_" : "";
  return path.join(fallbackDir, `${prefix}${slug}.json`);
}
