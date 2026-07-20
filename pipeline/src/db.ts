/**
 * SQLite 영속층.
 * concepts / evidence / signals / concept_scores(unit별) /
 * past_exam_items / predicted_questions / proactive / activity_log
 *
 * 일반화(§3): week INTEGER → subject TEXT + unit TEXT + unit_order INTEGER.
 * 누적(히스토리)은 같은 subject 안에서 unit_order 오름차순.
 * wipe 금지 — 어떤 실행 경로도 기존 행을 지우지 않는다 (재실행 시 upsert).
 */
import Database from "better-sqlite3";
import nodeFs from "node:fs";
import nodePath from "node:path";
import { nfc, type UnitKey } from "./folders.js";

export type SourceType = "transcript" | "slide" | "exam";
export type SignalKind = "emphasis" | "exam_hint";
export type Layer = "L0" | "L1" | "L2" | "L3" | "L4" | "orchestrator";

export interface ConceptRow {
  id: string;
  subject: string;
  name: string;
  norm: string;
  first_unit: string;
  first_unit_order: number;
}

export interface EvidenceRow {
  id: number;
  concept_id: string;
  subject: string;
  unit: string;
  unit_order: number;
  source_type: SourceType;
  locator: string;
  quote: string;
}

export interface SignalRow {
  id: number;
  concept_id: string;
  subject: string;
  unit: string;
  unit_order: number;
  kind: SignalKind;
  source_type: SourceType;
  locator: string;
  quote: string;
}

export interface ScoreRow {
  concept_id: string;
  subject: string;
  unit: string;
  unit_order: number;
  importance: number;
  exam_signal: number;
}

export interface QuestionRow {
  id: string;
  subject: string;
  unit: string;
  unit_order: number;
  concept_id: string;
  q: string;
  a: string;
  difficulty: string;
  /** 블룸 인지수준: "remember"|"understand"|"apply"|"analyze" (구 데이터는 "") */
  cognitive_level: string;
  reasoning: string;
  sources_json: string;
  verified: number;
}

export interface ProactiveRow {
  id: number;
  subject: string;
  unit: string;
  unit_order: number;
  text: string;
  question_ids_json: string;
}

export interface ActivityRow {
  id: number;
  ts: string;
  subject: string;
  unit: string;
  unit_order: number;
  layer: Layer;
  text: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  name TEXT NOT NULL,
  norm TEXT NOT NULL,
  first_unit TEXT NOT NULL,
  first_unit_order INTEGER NOT NULL,
  UNIQUE (subject, norm)
);
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  subject TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_order INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('transcript','slide','exam')),
  locator TEXT NOT NULL,
  quote TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_uniq
  ON evidence(concept_id, subject, unit, source_type, locator, quote);
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  subject TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_order INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('emphasis','exam_hint')),
  source_type TEXT NOT NULL CHECK (source_type IN ('transcript','slide','exam')),
  locator TEXT NOT NULL,
  quote TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS signals_uniq
  ON signals(concept_id, subject, unit, kind, source_type, locator, quote);
CREATE TABLE IF NOT EXISTS concept_scores (
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  subject TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_order INTEGER NOT NULL,
  importance INTEGER NOT NULL,
  exam_signal INTEGER NOT NULL,
  PRIMARY KEY (concept_id, subject, unit)
);
CREATE TABLE IF NOT EXISTS past_exam_items (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_order INTEGER NOT NULL,
  year INTEGER,
  exam_id TEXT NOT NULL,
  question TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS predicted_questions (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_order INTEGER NOT NULL,
  concept_id TEXT NOT NULL REFERENCES concepts(id),
  q TEXT NOT NULL,
  a TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  cognitive_level TEXT NOT NULL DEFAULT '',
  reasoning TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS proactive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_order INTEGER NOT NULL,
  text TEXT NOT NULL,
  question_ids_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  subject TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_order INTEGER NOT NULL,
  markdown TEXT NOT NULL,
  PRIMARY KEY (subject, unit)
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  subject TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_order INTEGER NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('L0','L1','L2','L3','L4','orchestrator')),
  text TEXT NOT NULL
);
`;

export class AoneDb {
  readonly raw: Database.Database;

  constructor(dbFile: string) {
    // 새 레이아웃(~/Aone/.aone/knowledge.db)에서 부모 디렉토리가 없으면 먼저 생성
    const dir = nodePath.dirname(dbFile);
    if (dir && dir !== "." && !nodeFs.existsSync(dir)) {
      nodeFs.mkdirSync(dir, { recursive: true });
    }
    this.raw = new Database(dbFile);
    this.raw.pragma("journal_mode = WAL");
    this.raw.exec(SCHEMA);
    this.migrate();
  }

  /**
   * 비파괴 증분 마이그레이션. 기존 테이블/행은 절대 건드리지 않고, 없는 컬럼만 추가한다.
   * (SQLite ADD COLUMN은 기존 행을 재작성하지 않으므로 안전)
   */
  private migrate(): void {
    const cols = this.raw.prepare("PRAGMA table_info(predicted_questions)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "cognitive_level")) {
      this.raw.exec("ALTER TABLE predicted_questions ADD COLUMN cognitive_level TEXT NOT NULL DEFAULT ''");
    }
  }

  close(): void {
    this.raw.close();
  }

  // ── concepts ────────────────────────────────────────────────
  insertConcept(c: ConceptRow): void {
    this.raw
      .prepare(
        "INSERT INTO concepts (id, subject, name, norm, first_unit, first_unit_order) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(c.id, c.subject, c.name, c.norm, c.first_unit, c.first_unit_order);
  }

  /** 개념 누적 범위 = subject (§3) */
  allConcepts(subject: string): ConceptRow[] {
    return this.raw.prepare("SELECT * FROM concepts WHERE subject = ?").all(subject) as ConceptRow[];
  }

  // ── evidence ────────────────────────────────────────────────
  addEvidence(e: Omit<EvidenceRow, "id">): boolean {
    const r = this.raw
      .prepare(
        "INSERT OR IGNORE INTO evidence (concept_id, subject, unit, unit_order, source_type, locator, quote) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      // locator·quote는 NFC로 정규화해 저장한다 (macOS NFD vs LLM NFC 바이트 불일치로
      // 근거 검증(evidenceExists·allowedLocators)이 전멸하는 것을 방지).
      .run(e.concept_id, e.subject, e.unit, e.unit_order, e.source_type, nfc(e.locator), nfc(e.quote));
    return r.changes > 0;
  }

  evidenceCountForUnit(conceptId: string, key: UnitKey): number {
    const r = this.raw
      .prepare("SELECT COUNT(*) AS n FROM evidence WHERE concept_id = ? AND subject = ? AND unit = ?")
      .get(conceptId, key.subject, key.unit) as { n: number };
    return r.n;
  }

  /** 같은 subject 안에서 unit_order ≤ upToOrder 누적 근거 */
  evidenceForConcept(conceptId: string, subject: string, upToOrder: number): EvidenceRow[] {
    return this.raw
      .prepare(
        "SELECT * FROM evidence WHERE concept_id = ? AND subject = ? AND unit_order <= ? ORDER BY unit_order, id",
      )
      .all(conceptId, subject, upToOrder) as EvidenceRow[];
  }

  /** 이번 unit에 근거(evidence)가 붙은 개념 id 집합 = 증분 노트의 "델타" 근사 */
  conceptIdsWithEvidenceAtUnit(key: Pick<UnitKey, "subject" | "unit">): Set<string> {
    const rows = this.raw
      .prepare("SELECT DISTINCT concept_id FROM evidence WHERE subject = ? AND unit = ?")
      .all(key.subject, key.unit) as { concept_id: string }[];
    return new Set(rows.map((r) => r.concept_id));
  }

  evidenceExists(sourceType: string, subject: string, unit: string, locator: string, quote: string): boolean {
    const r = this.raw
      .prepare(
        "SELECT COUNT(*) AS n FROM evidence WHERE source_type = ? AND subject = ? AND unit = ? AND locator = ? AND quote = ?",
      )
      // 저장 시 NFC 정규화했으므로 비교 인자도 NFC로 맞춘다 (근거 실존 검증 일관성).
      .get(sourceType, subject, unit, nfc(locator), nfc(quote)) as { n: number };
    return r.n > 0;
  }

  // ── signals ─────────────────────────────────────────────────
  addSignal(s: Omit<SignalRow, "id">): boolean {
    const r = this.raw
      .prepare(
        "INSERT OR IGNORE INTO signals (concept_id, subject, unit, unit_order, kind, source_type, locator, quote) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      // locator·quote NFC 정규화 (evidence와 동일 이유 — NFD/NFC 불일치 방지).
      .run(s.concept_id, s.subject, s.unit, s.unit_order, s.kind, s.source_type, nfc(s.locator), nfc(s.quote));
    return r.changes > 0;
  }

  signalCount(conceptId: string, key: UnitKey, kind: SignalKind, sourceType?: SourceType): number {
    if (sourceType !== undefined) {
      const r = this.raw
        .prepare(
          "SELECT COUNT(*) AS n FROM signals WHERE concept_id = ? AND subject = ? AND unit = ? AND kind = ? AND source_type = ?",
        )
        .get(conceptId, key.subject, key.unit, kind, sourceType) as { n: number };
      return r.n;
    }
    const r = this.raw
      .prepare("SELECT COUNT(*) AS n FROM signals WHERE concept_id = ? AND subject = ? AND unit = ? AND kind = ?")
      .get(conceptId, key.subject, key.unit, kind) as { n: number };
    return r.n;
  }

  /** 누적 신호 집계 (unit_order ≤ upToOrder 포함) */
  signalStats(conceptId: string, subject: string, upToOrder: number): { emphasis: number; examHint: number; examMatch: number } {
    const rows = this.raw
      .prepare(
        "SELECT kind, source_type, COUNT(*) AS n FROM signals WHERE concept_id = ? AND subject = ? AND unit_order <= ? GROUP BY kind, source_type",
      )
      .all(conceptId, subject, upToOrder) as { kind: SignalKind; source_type: SourceType; n: number }[];
    let emphasis = 0;
    let examHint = 0;
    let examMatch = 0;
    for (const r of rows) {
      if (r.kind === "emphasis") emphasis += r.n;
      else if (r.source_type === "exam") examMatch += r.n;
      else examHint += r.n;
    }
    return { emphasis, examHint, examMatch };
  }

  hasSignalInUnit(conceptId: string, key: UnitKey): boolean {
    const r = this.raw
      .prepare("SELECT COUNT(*) AS n FROM signals WHERE concept_id = ? AND subject = ? AND unit = ?")
      .get(conceptId, key.subject, key.unit) as { n: number };
    return r.n > 0;
  }

  // ── scores ──────────────────────────────────────────────────
  upsertScore(s: ScoreRow): void {
    this.raw
      .prepare(
        `INSERT INTO concept_scores (concept_id, subject, unit, unit_order, importance, exam_signal) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(concept_id, subject, unit) DO UPDATE SET importance = excluded.importance, exam_signal = excluded.exam_signal`,
      )
      .run(s.concept_id, s.subject, s.unit, s.unit_order, s.importance, s.exam_signal);
  }

  scoresAtUnit(key: Pick<UnitKey, "subject" | "unit">): ScoreRow[] {
    return this.raw
      .prepare(
        "SELECT * FROM concept_scores WHERE subject = ? AND unit = ? ORDER BY exam_signal DESC, importance DESC, concept_id",
      )
      .all(key.subject, key.unit) as ScoreRow[];
  }

  scoreHistory(conceptId: string, subject: string, upToOrder: number): ScoreRow[] {
    return this.raw
      .prepare(
        "SELECT * FROM concept_scores WHERE concept_id = ? AND subject = ? AND unit_order <= ? ORDER BY unit_order",
      )
      .all(conceptId, subject, upToOrder) as ScoreRow[];
  }

  score(conceptId: string, key: Pick<UnitKey, "subject" | "unit">): ScoreRow | undefined {
    return this.raw
      .prepare("SELECT * FROM concept_scores WHERE concept_id = ? AND subject = ? AND unit = ?")
      .get(conceptId, key.subject, key.unit) as ScoreRow | undefined;
  }

  /** 직전 unit(같은 subject에서 unit_order가 바로 아래인 것)의 점수 */
  prevScore(conceptId: string, subject: string, unitOrder: number): ScoreRow | undefined {
    return this.raw
      .prepare(
        "SELECT * FROM concept_scores WHERE concept_id = ? AND subject = ? AND unit_order < ? ORDER BY unit_order DESC LIMIT 1",
      )
      .get(conceptId, subject, unitOrder) as ScoreRow | undefined;
  }

  /** 점수가 존재하는 (subject, unit) 목록 — subject별 unit_order 오름차순 */
  unitsWithScores(subject?: string): UnitKey[] {
    const rows = (
      subject !== undefined
        ? this.raw
            .prepare(
              "SELECT DISTINCT subject, unit, unit_order FROM concept_scores WHERE subject = ? ORDER BY subject, unit_order",
            )
            .all(subject)
        : this.raw
            .prepare("SELECT DISTINCT subject, unit, unit_order FROM concept_scores ORDER BY subject, unit_order")
            .all()
    ) as { subject: string; unit: string; unit_order: number }[];
    return rows.map((r) => ({ subject: r.subject, unit: r.unit, unitOrder: r.unit_order }));
  }

  // ── past exams ──────────────────────────────────────────────
  addPastExamItem(item: { id: string; key: UnitKey; year: number | null; exam_id: string; question: string }): void {
    this.raw
      .prepare(
        "INSERT OR REPLACE INTO past_exam_items (id, subject, unit, unit_order, year, exam_id, question) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(item.id, item.key.subject, item.key.unit, item.key.unitOrder, item.year, item.exam_id, item.question);
  }

  /** 과목의 기출 문항 — units(unit 이름 목록) 지정 시 그 범위만, 없으면 과목 전체 */
  pastExamItemsForSubject(subject: string, units?: string[]): { unit: string; unit_order: number; year: number | null; question: string }[] {
    if (units && units.length > 0) {
      const placeholders = units.map(() => "?").join(", ");
      return this.raw
        .prepare(
          `SELECT unit, unit_order, year, question FROM past_exam_items WHERE subject = ? AND unit IN (${placeholders}) ORDER BY unit_order, id`,
        )
        .all(subject, ...units) as { unit: string; unit_order: number; year: number | null; question: string }[];
    }
    return this.raw
      .prepare("SELECT unit, unit_order, year, question FROM past_exam_items WHERE subject = ? ORDER BY unit_order, id")
      .all(subject) as { unit: string; unit_order: number; year: number | null; question: string }[];
  }

  // ── predicted questions ─────────────────────────────────────
  addQuestion(q: QuestionRow): void {
    this.raw
      .prepare(
        `INSERT OR REPLACE INTO predicted_questions (id, subject, unit, unit_order, concept_id, q, a, difficulty, cognitive_level, reasoning, sources_json, verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(q.id, q.subject, q.unit, q.unit_order, q.concept_id, q.q, q.a, q.difficulty, q.cognitive_level, q.reasoning, q.sources_json, q.verified);
  }

  questionsAtUnit(key: Pick<UnitKey, "subject" | "unit">): QuestionRow[] {
    return this.raw
      .prepare("SELECT * FROM predicted_questions WHERE subject = ? AND unit = ? AND verified = 1 ORDER BY id")
      .all(key.subject, key.unit) as QuestionRow[];
  }

  questionIdsForConceptAtUnit(conceptId: string, key: Pick<UnitKey, "subject" | "unit">): string[] {
    const rows = this.raw
      .prepare(
        "SELECT id FROM predicted_questions WHERE concept_id = ? AND subject = ? AND unit = ? AND verified = 1 ORDER BY id",
      )
      .all(conceptId, key.subject, key.unit) as { id: string }[];
    return rows.map((r) => r.id);
  }

  // ── notes (통합 학습노트) ────────────────────────────────────
  upsertNote(key: UnitKey, markdown: string): void {
    this.raw
      .prepare(
        `INSERT INTO notes (subject, unit, unit_order, markdown) VALUES (?, ?, ?, ?)
         ON CONFLICT(subject, unit) DO UPDATE SET markdown = excluded.markdown, unit_order = excluded.unit_order`,
      )
      .run(key.subject, key.unit, key.unitOrder, markdown);
  }

  noteAtUnit(key: Pick<UnitKey, "subject" | "unit">): string | undefined {
    const r = this.raw
      .prepare("SELECT markdown FROM notes WHERE subject = ? AND unit = ?")
      .get(key.subject, key.unit) as { markdown: string } | undefined;
    return r?.markdown;
  }

  /** 직전 unit(같은 subject에서 unit_order가 바로 아래인 것)의 노트 마크다운 — 증분 노트의 기반 */
  prevNote(subject: string, unitOrder: number): string | undefined {
    const r = this.raw
      .prepare(
        "SELECT markdown FROM notes WHERE subject = ? AND unit_order < ? ORDER BY unit_order DESC LIMIT 1",
      )
      .get(subject, unitOrder) as { markdown: string } | undefined;
    return r?.markdown;
  }

  // ── proactive ───────────────────────────────────────────────
  addProactive(key: UnitKey, text: string, questionIds: string[]): void {
    this.raw
      .prepare("INSERT INTO proactive (subject, unit, unit_order, text, question_ids_json) VALUES (?, ?, ?, ?, ?)")
      .run(key.subject, key.unit, key.unitOrder, text, JSON.stringify(questionIds));
  }

  proactiveAtUnit(key: Pick<UnitKey, "subject" | "unit">): ProactiveRow[] {
    return this.raw
      .prepare("SELECT * FROM proactive WHERE subject = ? AND unit = ? ORDER BY id")
      .all(key.subject, key.unit) as ProactiveRow[];
  }

  // ── activity log ────────────────────────────────────────────
  log(key: UnitKey, layer: Layer, text: string): void {
    this.raw
      .prepare("INSERT INTO activity_log (ts, subject, unit, unit_order, layer, text) VALUES (?, ?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), key.subject, key.unit, key.unitOrder, layer, text);
  }

  activitiesAtUnit(key: Pick<UnitKey, "subject" | "unit">): ActivityRow[] {
    return this.raw
      .prepare("SELECT * FROM activity_log WHERE subject = ? AND unit = ? ORDER BY id")
      .all(key.subject, key.unit) as ActivityRow[];
  }

  countsForUnit(key: UnitKey): { concepts: number; signals: number; activities: number; questions: number } {
    const concepts = (
      this.raw
        .prepare("SELECT COUNT(*) AS n FROM concepts WHERE subject = ? AND first_unit_order <= ?")
        .get(key.subject, key.unitOrder) as { n: number }
    ).n;
    const signals = (
      this.raw
        .prepare("SELECT COUNT(*) AS n FROM signals WHERE subject = ? AND unit = ?")
        .get(key.subject, key.unit) as { n: number }
    ).n;
    const activities = (
      this.raw
        .prepare("SELECT COUNT(*) AS n FROM activity_log WHERE subject = ? AND unit = ?")
        .get(key.subject, key.unit) as { n: number }
    ).n;
    const questions = (
      this.raw
        .prepare("SELECT COUNT(*) AS n FROM predicted_questions WHERE subject = ? AND unit = ? AND verified = 1")
        .get(key.subject, key.unit) as { n: number }
    ).n;
    return { concepts, signals, activities, questions };
  }
}
