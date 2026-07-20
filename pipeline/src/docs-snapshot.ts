/**
 * unit별 문서 상세 JSON export — 문서 화면(원문 + AI 분석 패널)용.
 * docs_{slug}.json (slug = "{subject}__{unit}") 형태로 aone-app이 그대로 소비한다 (zod 자검증 후 기록).
 *
 * 주의: evidence/signals는 파일 단위가 아니라 source_type 단위 granularity다.
 * 한 unit에 슬라이드가 여러 개여도 slide로 합쳐서 노출한다.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AoneDb, SignalKind, SourceType } from "./db.js";
import { nfc, type UnitKey } from "./folders.js";
import { exportFilePath } from "./paths.js";

const SourceDetailSchema = z.object({
  concepts: z.array(
    z.object({
      name: z.string(),
      importance: z.number().min(0).max(100),
      examSignal: z.number().min(0).max(100),
    }),
  ),
  emphasis: z.array(z.object({ quote: z.string(), locator: z.string(), concept: z.string() })),
  examHints: z.array(z.object({ quote: z.string(), locator: z.string(), concept: z.string() })),
  questionIds: z.array(z.string()),
});

export const DocsSnapshotSchema = z.object({
  subject: z.string().min(1),
  unit: z.string().min(1),
  unitOrder: z.number().int(),
  bySource: z.object({
    transcript: SourceDetailSchema,
    slide: SourceDetailSchema,
    exam: SourceDetailSchema,
  }),
});

export type DocsSnapshot = z.infer<typeof DocsSnapshotSchema>;

const SOURCE_TYPES: SourceType[] = ["transcript", "slide", "exam"];

export function buildDocsSnapshot(db: AoneDb, key: UnitKey): DocsSnapshot {
  const nameOf = new Map(db.allConcepts(key.subject).map((c) => [c.id, c.name]));
  const questions = db.questionsAtUnit(key).map((q) => ({
    id: q.id,
    sources: JSON.parse(q.sources_json) as { type: SourceType; unit: string; unitOrder: number }[],
  }));

  const bySource = {} as DocsSnapshot["bySource"];
  for (const st of SOURCE_TYPES) {
    const conceptIds = (
      db.raw
        .prepare("SELECT DISTINCT concept_id FROM evidence WHERE subject = ? AND unit = ? AND source_type = ?")
        .all(key.subject, key.unit, st) as { concept_id: string }[]
    ).map((r) => r.concept_id);

    const concepts = conceptIds
      .map((id) => {
        const s = db.score(id, key);
        return {
          name: nameOf.get(id) ?? id,
          importance: s?.importance ?? 0,
          examSignal: s?.exam_signal ?? 0,
        };
      })
      .sort((a, b) => b.examSignal - a.examSignal || b.importance - a.importance || a.name.localeCompare(b.name, "ko"));

    const signalRows = db.raw
      .prepare(
        "SELECT kind, locator, quote, concept_id FROM signals WHERE subject = ? AND unit = ? AND source_type = ? ORDER BY id",
      )
      .all(key.subject, key.unit, st) as { kind: SignalKind; locator: string; quote: string; concept_id: string }[];
    const toQuote = (r: (typeof signalRows)[number]) => ({
      quote: r.quote,
      locator: r.locator,
      concept: nameOf.get(r.concept_id) ?? r.concept_id,
    });

    bySource[st] = {
      concepts,
      emphasis: signalRows.filter((r) => r.kind === "emphasis").map(toQuote),
      examHints: signalRows.filter((r) => r.kind === "exam_hint").map(toQuote),
      questionIds: questions
        .filter((q) => q.sources.some((s) => nfc(s.unit) === nfc(key.unit) && s.type === st))
        .map((q) => q.id),
    };
  }

  return DocsSnapshotSchema.parse({ subject: key.subject, unit: key.unit, unitOrder: key.unitOrder, bySource });
}

/** DB에 점수가 존재하는 unit들의 문서 상세를 outDir에 기록 (subject/unit으로 필터 가능) */
export function exportDocsSnapshots(
  db: AoneDb,
  outDir: string,
  filter?: { subject?: string; unit?: string },
): { key: UnitKey; file: string }[] {
  const written: { key: UnitKey; file: string }[] = [];
  for (const key of db.unitsWithScores(filter?.subject)) {
    if (filter?.unit !== undefined && key.unit !== filter.unit) continue;
    const snapshot = buildDocsSnapshot(db, key); // 생성 시점에 zod 자검증
    const file = exportFilePath("docs", key, outDir); // 새 레이아웃=.aone/docs.json, 폴백={outDir}/docs_{slug}.json
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    written.push({ key, file });
  }
  return written;
}
