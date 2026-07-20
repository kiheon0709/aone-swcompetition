/**
 * 폴더 키·슬러그 규칙 (일반화_설계.md §2).
 * - folderKey = "{subject}/{unit}", 항상 NFC 정규화 (macOS NFD 함정 방지)
 * - slug(파일명용) = "{subject}__{unit}"
 * - unit_order = unit 이름의 첫 숫자, 없으면 1000 + 폴더 mtime 순번
 */
import fs from "node:fs";
import path from "node:path";

export interface UnitKey {
  subject: string;
  unit: string;
  unitOrder: number;
}

export function nfc(s: string): string {
  return s.normalize("NFC");
}

export function slugOf(key: Pick<UnitKey, "subject" | "unit">): string {
  return nfc(`${key.subject}__${key.unit}`);
}

export function folderKeyOf(key: Pick<UnitKey, "subject" | "unit">): string {
  return nfc(`${key.subject}/${key.unit}`);
}

/** goldset/{subject}의 unit 폴더 목록을 unit_order 오름차순으로 반환 (NFC 정규화) */
export function listUnits(goldsetDir: string, subject: string): UnitKey[] {
  const subjDir = path.join(goldsetDir, subject);
  if (!fs.existsSync(subjDir)) {
    throw new Error(`과목 폴더 없음: ${subjDir}`);
  }
  const dirs = fs
    .readdirSync(subjDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => ({
      unit: nfc(e.name),
      raw: e.name,
      mtime: fs.statSync(path.join(subjDir, e.name)).mtimeMs,
    }))
    .sort((a, b) => a.mtime - b.mtime);
  return dirs
    .map((d, mtimeRank) => {
      const m = d.unit.match(/(\d+)/);
      return {
        subject: nfc(subject),
        unit: d.unit,
        unitOrder: m ? parseInt(m[1], 10) : 1000 + mtimeRank,
      };
    })
    .sort((a, b) => a.unitOrder - b.unitOrder || a.unit.localeCompare(b.unit, "ko"));
}

/** subject/unit 이름으로 UnitKey 해석 (폴더 실존 + unit_order 산출) */
export function resolveUnit(goldsetDir: string, subject: string, unit: string): UnitKey {
  const units = listUnits(goldsetDir, subject);
  const found = units.find((u) => u.unit === nfc(unit));
  if (!found) {
    throw new Error(
      `unit 폴더 없음: ${folderKeyOf({ subject, unit })} — 존재하는 unit: ${units.map((u) => u.unit).join(", ") || "(없음)"}`,
    );
  }
  return found;
}
