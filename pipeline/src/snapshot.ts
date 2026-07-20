/**
 * unit별 스냅샷 JSON export — UI 계약 스키마 (zod 자검증 후 기록).
 * out/{slug}.json (slug = "{subject}__{unit}") 형태로 aone-app이 그대로 소비한다.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AoneDb } from "./db.js";
import { type UnitKey } from "./folders.js";
import { exportFilePath } from "./paths.js";

export const SnapshotSchema = z.object({
  subject: z.string().min(1),
  unit: z.string().min(1),
  unitOrder: z.number().int(),
  concepts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      importance: z.number().min(0).max(100),
      examSignal: z.number().min(0).max(100),
      history: z.array(
        z.object({ unit: z.string(), unitOrder: z.number().int(), examSignal: z.number().min(0).max(100) }),
      ),
    }),
  ),
  activities: z.array(
    z.object({
      ts: z.string(),
      unit: z.string(),
      unitOrder: z.number().int(),
      layer: z.enum(["L0", "L1", "L2", "L3", "L4", "orchestrator"]),
      text: z.string(),
    }),
  ),
  proactive: z.array(z.object({ text: z.string(), questionIds: z.array(z.string()) })),
  /** 통합 학습노트 (해당 unit 시점 누적, 옵셔널) */
  note: z.object({ markdown: z.string() }).optional(),
  questions: z.array(
    z.object({
      id: z.string(),
      q: z.string(),
      a: z.string(),
      difficulty: z.string(),
      /** 블룸 인지수준 (구 데이터는 "") — 프론트 배지용 */
      cognitiveLevel: z.string().default(""),
      reasoning: z.string(),
      sources: z.array(
        z.object({
          type: z.enum(["transcript", "slide", "exam"]),
          unit: z.string(),
          unitOrder: z.number().int(),
          locator: z.string(),
          quote: z.string(),
        }),
      ),
    }),
  ),
});

export type Snapshot = z.infer<typeof SnapshotSchema>;

export function buildSnapshot(db: AoneDb, key: UnitKey): Snapshot {
  const conceptRows = db.allConcepts(key.subject);

  const concepts = db.scoresAtUnit(key).map((s) => {
    const c = conceptRows.find((r) => r.id === s.concept_id)!;
    return {
      id: c.id,
      name: c.name,
      importance: s.importance,
      examSignal: s.exam_signal,
      history: db
        .scoreHistory(c.id, key.subject, key.unitOrder)
        .map((h) => ({ unit: h.unit, unitOrder: h.unit_order, examSignal: h.exam_signal })),
    };
  });

  const activities = db.activitiesAtUnit(key).map((a) => ({
    ts: a.ts,
    unit: a.unit,
    unitOrder: a.unit_order,
    layer: a.layer,
    text: a.text,
  }));

  const proactive = db.proactiveAtUnit(key).map((p) => ({
    text: p.text,
    questionIds: JSON.parse(p.question_ids_json) as string[],
  }));

  const questions = db.questionsAtUnit(key).map((q) => ({
    id: q.id,
    q: q.q,
    a: q.a,
    difficulty: q.difficulty,
    cognitiveLevel: q.cognitive_level ?? "",
    reasoning: q.reasoning,
    sources: JSON.parse(q.sources_json) as Snapshot["questions"][number]["sources"],
  }));

  const noteMarkdown = db.noteAtUnit(key);
  const note = noteMarkdown !== undefined ? { markdown: noteMarkdown } : undefined;

  return SnapshotSchema.parse({
    subject: key.subject,
    unit: key.unit,
    unitOrder: key.unitOrder,
    concepts,
    activities,
    proactive,
    questions,
    note,
  });
}

/** DB에 점수가 존재하는 unit들의 스냅샷을 outDir에 기록 (subject/unit으로 필터 가능) */
export function exportSnapshots(
  db: AoneDb,
  outDir: string,
  filter?: { subject?: string; unit?: string },
): { key: UnitKey; file: string }[] {
  const written: { key: UnitKey; file: string }[] = [];
  for (const key of db.unitsWithScores(filter?.subject)) {
    if (filter?.unit !== undefined && key.unit !== filter.unit) continue;
    const snapshot = buildSnapshot(db, key); // 생성 시점에 zod 자검증
    const file = exportFilePath("analysis", key, outDir); // 새 레이아웃=.aone/analysis.json, 폴백={outDir}/{slug}.json
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    written.push({ key, file });
  }
  return written;
}
