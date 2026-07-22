/**
 * L4 — 행동(산출물) 계층.
 * - 예상문제 생성: reasoning + source[] 스키마 → 검증(source 실존 확인 + 검증 투표)
 * - 능동 제안 판단: examSignal 임계 && 이번 주 신호 발생 && 전주 대비 상승
 */
import { AoneDb, SourceType } from "../db.js";
import type { PipelineConfig } from "../config.js";
import {
  LlmEngine,
  ComposeNoteOutput,
  ComposeNotePayload,
  ComposeGuideOutput,
  ComposeGuidePayload,
  GenerateQuestionOutput,
  GenerateQuestionPayload,
  GenerateQuestionsBatchOutput,
  GenerateQuestionsBatchPayload,
  VerifyQuestionOutput,
  VerifyQuestionPayload,
  VerifyQuestionsBatchOutput,
  VerifyQuestionsBatchPayload,
  buildPrompt,
} from "../adapters/llm.js";
import type { UnitKey } from "../folders.js";
import { studyOrder } from "./l3-prereqs.js";

export interface QuestionSource {
  type: SourceType;
  unit: string;
  unitOrder: number;
  locator: string;
  quote: string;
}

export interface ArtifactResult {
  generated: number;
  verified: number;
  rejected: number;
}

/** 시험신호 상위 개념에 대해 예상문제 생성 + 검증 (티어에 따라 일괄/개별) */
export async function generateQuestions(
  db: AoneDb,
  engine: LlmEngine,
  cfg: PipelineConfig,
  key: UnitKey,
): Promise<ArtifactResult> {
  return cfg.tierConfig.batchQuestions
    ? generateQuestionsBatched(db, engine, cfg, key)
    : generateQuestionsIndividually(db, engine, cfg, key);
}

/** 문항 생성 대상 개념과 source[] 선정 (일괄/개별 경로 공유) */
function pickTargets(db: AoneDb, cfg: PipelineConfig, key: UnitKey) {
  const tier = cfg.tierConfig;
  const top = db.scoresAtUnit(key).slice(0, tier.topConceptsForQuestions);
  const concepts = db.allConcepts(key.subject);
  const targets: {
    conceptId: string;
    name: string;
    importance: number;
    examSignal: number;
    sources: QuestionSource[];
    pastExamHints: string[];
    signalSummary: { emphasis: number; examHint: number; examMatch: number };
  }[] = [];
  for (const score of top) {
    const concept = concepts.find((c) => c.id === score.concept_id);
    if (!concept) continue;
    const allEvidence = db.evidenceForConcept(concept.id, key.subject, key.unitOrder);
    if (allEvidence.length === 0) continue;
    const examEvAll = allEvidence.filter((e) => e.source_type === "exam");
    // 근거 → source[] (최근 unit 우선, 최대 3건, 기출 근거 우선 포함)
    const otherEv = allEvidence.filter((e) => e.source_type !== "exam").reverse();
    const picked = [...examEvAll.slice(0, 1), ...otherEv].slice(0, 3);
    targets.push({
      conceptId: concept.id,
      name: concept.name,
      importance: score.importance,
      examSignal: score.exam_signal,
      sources: picked.map((e) => ({
        type: e.source_type,
        unit: e.unit,
        unitOrder: e.unit_order,
        locator: e.locator,
        quote: e.quote,
      })),
      pastExamHints: examEvAll.slice(0, 3).map((e) => e.quote),
      signalSummary: db.signalStats(concept.id, key.subject, key.unitOrder),
    });
  }
  return targets;
}

/** 일괄 경로: 상위 개념 전체 문항을 1회 생성 + 1회 검증 (LLM 호출 2회) */
async function generateQuestionsBatched(
  db: AoneDb,
  engine: LlmEngine,
  cfg: PipelineConfig,
  key: UnitKey,
): Promise<ArtifactResult> {
  const tier = cfg.tierConfig;
  const result: ArtifactResult = { generated: 0, verified: 0, rejected: 0 };
  const targets = pickTargets(db, cfg, key);
  if (targets.length === 0) return result;

  const genPayload: GenerateQuestionsBatchPayload = {
    concepts: targets.map((t) => ({
      conceptId: t.conceptId,
      name: t.name,
      importance: t.importance,
      examSignal: t.examSignal,
      evidence: t.sources,
      pastExamHints: t.pastExamHints,
      signalSummary: t.signalSummary,
    })),
    questionsPerConcept: tier.questionsPerConcept,
  };
  const gen = await engine.call({
    task: "generate_questions_batch",
    payload: genPayload,
    schema: GenerateQuestionsBatchOutput,
    prompt: buildPrompt(
      "generate_questions_batch",
      [
        `대학 '${key.subject}' 중간고사 예상문제를 아래 개념 목록(concepts) 전체에 대해 한 번에 생성하라.`,
        `각 개념(conceptId)마다 정확히 ${tier.questionsPerConcept}문항씩, 같은 개념의 문항끼리는 각도를 다르게(정의/적용/계산/오답고르기 등).`,
        "각 문항의 conceptId는 입력의 conceptId를 그대로 복사하라.",
        "evidence의 인용문(강의 발화·슬라이드·기출) 내용에 실제로 근거해서 출제할 것 — 인용문에 없는 사실을 지어내지 마라.",
        "pastExamHints(해당 개념 관련 기출 문항)가 있으면 그 출제 스타일(객관식/계산/옳지 않은 것 고르기)을 따라라.",
        "능동 회상을 유도하는 문항으로 — 단순 정의 암기가 아니라 '왜/어떻게/차이/적용'을 묻는다.",
        "q=문제(객관식이면 보기 포함), a=모범답안(간결·정확), difficulty=easy|medium|hard,",
        "cognitiveLevel=문항의 블룸 인지수준을 remember|understand|apply|analyze 중 하나로 매겨라 (단순 암기=remember는 최소화).",
        "reasoning=왜 이 문제가 출제될 가능성이 높은지 signalSummary(강조/시험언급/기출매칭 횟수)와 근거를 들어 2문장 이내로.",
      ].join("\n"),
      genPayload,
      `{"questions":[{"conceptId":"...","q":"...","a":"...","difficulty":"easy|medium|hard","cognitiveLevel":"remember|understand|apply|analyze","reasoning":"..."}]}`,
    ),
  });

  // conceptId → 대상 매핑, 개념별 문항 수 상한 적용 + 문항 id 부여
  const byConcept = new Map(targets.map((t) => [t.conceptId, t]));
  const counter = new Map<string, number>();
  const pending: {
    id: string;
    conceptId: string;
    q: string;
    a: string;
    difficulty: string;
    cognitiveLevel: string;
    reasoning: string;
    sources: QuestionSource[];
    sourcesExist: boolean;
  }[] = [];
  for (const item of gen.questions ?? []) {
    const target = byConcept.get(item.conceptId);
    if (!target) continue; // 목록에 없는 conceptId는 버림
    if (!item.q?.trim() || !item.a?.trim()) continue; // 빈 문제·답은 스킵
    const n = (counter.get(item.conceptId) ?? 0) + 1;
    if (n > tier.questionsPerConcept) continue;
    counter.set(item.conceptId, n);
    // 검증 1단계(코드): source 실존 확인
    const sourcesExist =
      target.sources.length > 0 &&
      target.sources.every((s) => db.evidenceExists(s.type, key.subject, s.unit, s.locator, s.quote));
    pending.push({
      id: `w${key.unitOrder}-${item.conceptId}-q${n}`,
      conceptId: item.conceptId,
      q: item.q,
      a: item.a,
      difficulty: item.difficulty,
      cognitiveLevel: item.cognitiveLevel,
      reasoning: item.reasoning,
      sources: target.sources,
      sourcesExist,
    });
  }
  if (pending.length === 0) return result;

  // 검증 2단계(LLM): 전 문항 1회 일괄 검증
  const verifyPayload: VerifyQuestionsBatchPayload = {
    questions: pending.map((p) => ({ id: p.id, q: p.q, a: p.a, sources: p.sources, sourcesExist: p.sourcesExist })),
  };
  const verdictOut = await engine.call({
    task: "verify_questions_batch",
    payload: verifyPayload,
    schema: VerifyQuestionsBatchOutput,
    prompt: buildPrompt(
      "verify_questions_batch",
      "다음 예상문제 목록(questions)을 문항별로 검증하라. 각 문항이 제시된 출처 인용문(sources[].quote)만으로 뒷받침되는지 판단하고, " +
        "문제·답이 출처와 모순되거나 출처에 전혀 없는 내용을 단정하면 ok=false. " +
        "출처 기반의 합리적 출제·표현 다듬기는 허용(지나치게 엄격하게 굴지 마라). " +
        "verdicts에는 입력의 모든 문항 id가 정확히 한 번씩 포함되어야 한다.",
      verifyPayload,
      `{"verdicts":[{"id":"...","ok":true,"reason":"..."}]}`,
    ),
  });
  const verdictById = new Map((verdictOut.verdicts ?? []).map((v) => [v.id, v]));

  for (const p of pending) {
    const verdict = verdictById.get(p.id);
    const passed = p.sourcesExist && (verdict?.ok ?? false);
    db.addQuestion({
      id: p.id,
      subject: key.subject,
      unit: key.unit,
      unit_order: key.unitOrder,
      concept_id: p.conceptId,
      q: p.q,
      a: p.a,
      difficulty: p.difficulty,
      cognitive_level: p.cognitiveLevel,
      reasoning: p.reasoning,
      sources_json: JSON.stringify(p.sources),
      verified: passed ? 1 : 0,
    });
    result.generated++;
    passed ? result.verified++ : result.rejected++;
  }
  return result;
}

/** 개별 경로(deep 티어): 문항별 생성 + 검증 투표 */
async function generateQuestionsIndividually(
  db: AoneDb,
  engine: LlmEngine,
  cfg: PipelineConfig,
  key: UnitKey,
): Promise<ArtifactResult> {
  const tier = cfg.tierConfig;
  const top = db.scoresAtUnit(key).slice(0, tier.topConceptsForQuestions);
  const concepts = db.allConcepts(key.subject);
  const result: ArtifactResult = { generated: 0, verified: 0, rejected: 0 };

  // 문항 단위 체인(생성→검증→저장)은 서로 독립 — 병렬 실행 (동시성 제한은 엔진 세마포어가 담당)
  const jobs: Promise<void>[] = [];

  for (const score of top) {
    const concept = concepts.find((c) => c.id === score.concept_id);
    if (!concept) continue;
    const allEvidence = db.evidenceForConcept(concept.id, key.subject, key.unitOrder);
    if (allEvidence.length === 0) continue;
    const signalSummary = db.signalStats(concept.id, key.subject, key.unitOrder);
    const examEvAll = allEvidence.filter((e) => e.source_type === "exam");

    for (let i = 0; i < tier.questionsPerConcept; i++) {
      // 근거 → source[] (최근 unit 우선, 최대 3건, 기출 근거 우선 포함)
      const otherEv = allEvidence.filter((e) => e.source_type !== "exam").reverse();
      const picked = [...examEvAll.slice(0, 1), ...otherEv].slice(0, 3);
      const sources: QuestionSource[] = picked.map((e) => ({
        type: e.source_type,
        unit: e.unit,
        unitOrder: e.unit_order,
        locator: e.locator,
        quote: e.quote,
      }));

      jobs.push(
        processQuestion(db, engine, tier.verifyVotes, key, concept.id, concept.name, score, sources, {
          pastExamHints: examEvAll.slice(0, 3).map((e) => e.quote),
          signalSummary,
          index: i,
        }).then((r) => {
          result.generated++;
          r ? result.verified++ : result.rejected++;
        }),
      );
    }
  }

  // allSettled: 한 문항 체인이 실패해도 나머지 성공분은 유지한다(동시성은 엔진 세마포어).
  const settled = await Promise.allSettled(jobs);
  for (const s of settled) {
    if (s.status === "rejected") {
      const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
      console.warn(`  경고: 예상문제 생성 1건 실패 — 건너뜁니다 (${msg.slice(0, 160)}).`);
    }
  }
  return result;
}

/** 한 문항의 생성→검증→저장 체인. 검증 통과 여부 반환. */
async function processQuestion(
  db: AoneDb,
  engine: LlmEngine,
  verifyVotes: number,
  key: UnitKey,
  conceptId: string,
  conceptName: string,
  score: { importance: number; exam_signal: number },
  sources: QuestionSource[],
  extra: {
    pastExamHints: string[];
    signalSummary: { emphasis: number; examHint: number; examMatch: number };
    index: number;
  },
): Promise<boolean> {
  const i = extra.index;
  const genPayload: GenerateQuestionPayload = {
    concept: { name: conceptName, importance: score.importance, examSignal: score.exam_signal },
    evidence: sources,
    pastExamHints: extra.pastExamHints,
    signalSummary: extra.signalSummary,
    index: i,
  };
  const gen = await engine.call({
    task: "generate_question",
    payload: genPayload,
    schema: GenerateQuestionOutput,
    prompt: buildPrompt(
      "generate_question",
      [
        `대학 '${key.subject}' 중간고사 예상문제 1개를 개념 "${conceptName}"에 대해 생성하라.`,
        "evidence의 인용문(강의 발화·슬라이드·기출) 내용에 실제로 근거해서 출제할 것 — 인용문에 없는 사실을 지어내지 마라.",
        "pastExamHints(이 개념 관련 기출 문항)가 있으면 그 출제 스타일(객관식/계산/옳지 않은 것 고르기)을 따라라.",
        `같은 개념의 ${i + 1}번째 문항이므로 이전 문항과 겹치지 않게 각도를 바꿔라 (index=${i}).`,
        "능동 회상을 유도하는 문항으로 — 단순 정의 암기가 아니라 '왜/어떻게/차이/적용'을 묻는다.",
        "q=문제(객관식이면 보기 포함), a=모범답안(간결·정확), difficulty=easy|medium|hard,",
        "cognitiveLevel=문항의 블룸 인지수준을 remember|understand|apply|analyze 중 하나로 매겨라 (단순 암기=remember는 최소화).",
        "reasoning=왜 이 문제가 출제될 가능성이 높은지 signalSummary(강조/시험언급/기출매칭 횟수)와 근거를 들어 2문장 이내로.",
      ].join("\n"),
      genPayload,
      `{"q":"...","a":"...","difficulty":"easy|medium|hard","cognitiveLevel":"remember|understand|apply|analyze","reasoning":"..."}`,
    ),
  });

  // 검증 1단계(코드): source 실존 확인 — evidence 테이블에 실제 존재하는지
  const sourcesExist =
    sources.length > 0 && sources.every((s) => db.evidenceExists(s.type, key.subject, s.unit, s.locator, s.quote));

  // 검증 2단계(LLM 투표): verifyVotes회, 과반 통과
  let okVotes = 0;
  for (let v = 0; v < verifyVotes; v++) {
    const verifyPayload: VerifyQuestionPayload = {
      question: { q: gen.q, a: gen.a },
      sources,
      sourcesExist,
    };
    const verdict = await engine.call({
      task: "verify_question",
      payload: verifyPayload,
      schema: VerifyQuestionOutput,
      prompt: buildPrompt(
        "verify_question",
        "다음 예상문제(question)가 제시된 출처 인용문(sources[].quote)만으로 뒷받침되는지 검증하라. " +
          "문제·답이 출처와 모순되거나 출처에 전혀 없는 내용을 단정하면 ok=false. " +
          "출처 기반의 합리적 출제·표현 다듬기는 허용(지나치게 엄격하게 굴지 마라).",
        verifyPayload,
        `{"ok":true,"reason":"..."}`,
      ),
    });
    if (verdict.ok) okVotes++;
  }
  const passed = sourcesExist && okVotes * 2 > verifyVotes;

  db.addQuestion({
    id: `w${key.unitOrder}-${conceptId}-q${i + 1}`,
    subject: key.subject,
    unit: key.unit,
    unit_order: key.unitOrder,
    concept_id: conceptId,
    q: gen.q,
    a: gen.a,
    difficulty: gen.difficulty,
    cognitive_level: gen.cognitiveLevel,
    reasoning: gen.reasoning,
    sources_json: JSON.stringify(sources),
    verified: passed ? 1 : 0,
  });
  return passed;
}

// ─────────────────────────────────────────────────────────────
// 통합 학습노트 조립 (L4 신규 태스크)
// ─────────────────────────────────────────────────────────────

/** 노트에 담을 개념 수 (중요도 상위) */
const NOTE_TOP_CONCEPTS = 12;
/** 개념당 노트에 전달할 근거 인용 수 */
const NOTE_EVIDENCE_PER_CONCEPT = 4;

export interface NoteResult {
  concepts: number;
  markdownChars: number;
  /** true면 델타 없음으로 LLM 호출을 건너뛰고 직전 노트를 유지 */
  skipped: boolean;
}

/**
 * unit 시점의 "지금까지 배운 것" 통합 학습노트를 마크다운으로 증분 조립.
 *
 * 증분 로직:
 *  - 직전 unit 노트(prevNote)가 있으면 그것을 기반으로, 이번 unit에 근거가 붙은 개념(델타)만 반영.
 *  - 델타가 없으면 LLM 호출을 건너뛰고 직전 노트를 현재 unit에 그대로 복사(승계).
 *  - 직전 노트가 없으면(첫 unit) 상위 개념 전체로 새로 작성.
 * 파인만 기법: 전공용어 나열이 아니라 처음 배우는 사람에게 설명하듯 쉬운 말·비유로.
 */
export async function composeNote(
  db: AoneDb,
  engine: LlmEngine,
  cfg: PipelineConfig,
  key: UnitKey,
): Promise<NoteResult> {
  const conceptRows = db.allConcepts(key.subject);
  const prior = db.prevNote(key.subject, key.unitOrder);
  const incremental = prior !== undefined && prior.trim() !== "";

  // 중요도 순 상위 개념 (전체 작성 시 후보)
  const top = [...db.scoresAtUnit(key)].sort(
    (a, b) => b.importance - a.importance || b.exam_signal - a.exam_signal || a.concept_id.localeCompare(b.concept_id),
  );

  // 델타 근사: 이번 unit에 evidence가 붙은 개념
  const deltaIds = db.conceptIdsWithEvidenceAtUnit(key);

  // 증분: 델타 개념만(중요도 순 유지). 전체 작성: 상위 N개.
  const selected = incremental
    ? top.filter((s) => deltaIds.has(s.concept_id))
    : top.slice(0, NOTE_TOP_CONCEPTS);

  // 증분인데 델타가 없으면 LLM 호출 스킵 — 직전 노트를 이번 unit에 승계
  if (incremental && selected.length === 0) {
    db.upsertNote(key, prior!);
    return { concepts: 0, markdownChars: prior!.length, skipped: true };
  }

  const payload: ComposeNotePayload = {
    subject: key.subject,
    unit: key.unit,
    priorNote: incremental ? prior! : "",
    incremental,
    concepts: selected.flatMap((s) => {
      const c = conceptRows.find((r) => r.id === s.concept_id);
      if (!c) return [];
      const evidence = db.evidenceForConcept(c.id, key.subject, key.unitOrder);
      // 교수 설명 인용 우선: transcript 근거를 앞세우고 슬라이드·기출로 보충
      const picked = [
        ...evidence.filter((e) => e.source_type === "transcript"),
        ...evidence.filter((e) => e.source_type !== "transcript"),
      ].slice(0, NOTE_EVIDENCE_PER_CONCEPT);
      return [
        {
          name: c.name,
          importance: s.importance,
          examSignal: s.exam_signal,
          examAlert: s.exam_signal >= cfg.proactiveExamSignalThreshold,
          evidence: picked.map((e) => ({ type: e.source_type, unit: e.unit, locator: e.locator, quote: e.quote })),
        },
      ];
    }),
  };

  const feynman = "설명은 파인만 기법으로 — 전공용어 나열이 아니라 처음 배우는 사람에게 설명하듯 쉬운 말과 비유로 풀고, 각 개념이 왜 중요한지 한 줄로 덧붙여라.";
  const commonSection = [
    "각 개념 섹션 구성:",
    `- 제목: "## <순번>. <개념명>" — examAlert=true인 개념은 제목 끝에 " ⚠️"를 붙여 시험 대비 경고를 표시.`,
    "- 정의 요약: evidence 인용문에 실제로 근거한 1~3문장. 인용문에 없는 사실을 지어내지 마라.",
    '- 교수 설명 인용: evidence 중 type="transcript"인 quote를 1개 이상 골라 인용 블록(>)으로 넣고, 끝에 "— (<unit> 강의 <locator>)" 형태로 타임스탬프·출처를 표기. 슬라이드/기출 근거를 쓰면 "— (<unit> <locator>)"로 표기.',
    "인용문(quote)은 입력에 있는 문장을 그대로 사용하라(앞부분만 잘라도 됨).",
  ];

  const instructions = incremental
    ? [
        `대학 '${key.subject}' 수강생의 기존 통합 학습노트(priorNote)에 이번 ${key.unit}에서 새로 추가·변경된 개념(concepts)만 반영하라.`,
        "priorNote의 나머지 내용은 그대로 유지하고, concepts에 해당하는 섹션만 추가하거나 갱신하라. 무관한 부분을 다시 쓰지 마라.",
        feynman,
        ...commonSection,
        `문서 맨 위 제목은 "# ${key.subject} 학습노트 — ${key.unit}까지"로 갱신하라.`,
        "출력은 갱신된 전체 노트의 markdown 필드 하나의 JSON으로만.",
      ].join("\n")
    : [
        `대학 '${key.subject}' 수강생을 위한 "지금까지 배운 것" 통합 학습노트를 마크다운으로 작성하라. 현재 시점은 ${key.unit} 수업 직후다.`,
        "입력 concepts는 중요도 순으로 정렬된 핵심 개념 목록이다. 그 순서를 유지해 개념별 섹션을 만들어라.",
        feynman,
        ...commonSection,
        `문서 맨 위에 "# ${key.subject} 학습노트 — ${key.unit}까지" 제목과, ⚠️ 표시 개념을 한 줄로 요약한 안내문을 넣어라.`,
        "출력은 markdown 필드 하나의 JSON으로만.",
      ].join("\n");

  const out = await engine.call({
    task: "compose_note",
    payload,
    schema: ComposeNoteOutput,
    prompt: buildPrompt("compose_note", instructions, payload, `{"markdown":"# ..."}`),
  });

  db.upsertNote(key, out.markdown);
  return { concepts: payload.concepts.length, markdownChars: out.markdown.length, skipped: false };
}

export interface ProactiveResult {
  suggestions: { conceptName: string; text: string; questionIds: string[] }[];
}

/**
 * 능동 제안 판단 (결정적 코드):
 *   examSignal(unit) ≥ 임계값  &&  이번 unit 해당 개념 신호 발생  &&  직전 unit 대비 examSignal 상승
 */
export function decideProactive(db: AoneDb, cfg: PipelineConfig, key: UnitKey): ProactiveResult {
  const result: ProactiveResult = { suggestions: [] };
  const concepts = db.allConcepts(key.subject);

  for (const score of db.scoresAtUnit(key)) {
    if (score.exam_signal < cfg.proactiveExamSignalThreshold) continue;
    if (!db.hasSignalInUnit(score.concept_id, key)) continue;
    const prev = db.prevScore(score.concept_id, key.subject, key.unitOrder);
    const prevSignal = prev?.exam_signal ?? 0;
    if (score.exam_signal <= prevSignal) continue;

    const concept = concepts.find((c) => c.id === score.concept_id);
    if (!concept) continue;
    const questionIds = db.questionIdsForConceptAtUnit(concept.id, key);
    const stats = db.signalStats(concept.id, key.subject, key.unitOrder);
    const examPart = stats.examMatch > 0 ? `기출 ${stats.examMatch}회 매칭, ` : "";
    const text =
      `'${concept.name}' 시험신호가 ${prevSignal}→${score.exam_signal}로 상승했습니다. ` +
      `${examPart}시험 언급 ${stats.examHint}회, 강조 ${stats.emphasis}회 감지 — ` +
      (questionIds.length > 0
        ? `예상문제 ${questionIds.length}개를 준비했어요. 지금 풀어보시겠어요?`
        : `다음 주기에 예상문제를 준비할게요.`);
    db.addProactive(key, text, questionIds);
    result.suggestions.push({ conceptName: concept.name, text, questionIds });
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// 학습 가이드 = 시험대비 전체 재조립 (버튼 트리거, LLM 호출 1회)
// ─────────────────────────────────────────────────────────────

/** 가이드에 담을 상위 개념 수 (중요도 순) */
const GUIDE_TOP_CONCEPTS = 20;
/** 개념당 가이드에 전달할 근거 인용 수 */
const GUIDE_EVIDENCE_PER_CONCEPT = 2;

export interface GuideResult {
  guide: GuideDoc;
  concepts: number;
  pastExams: number;
}

/**
 * 학습 가이드 산출물 — 앱이 그대로 화면에 쓰는 구조.
 *
 * 마크다운 한 덩어리 대신 구조화해서 넘긴다. 화면은 개념을 접었다 펴고 섹션을
 * 따로 배치해야 하는데, 마크다운을 역파싱하면 LLM이 과목·엔진마다 다르게 쓰는
 * 문장 형식에 의존하게 되기 때문이다.
 */
export interface GuideDoc {
  /** 개념을 보기 전에 읽는 "숲" — 이 범위가 어떤 흐름인지 */
  overview: string;
  concepts: {
    name: string;
    body: string;
    why: string;
    /** 근거 위치 ("5주차 #L19"). 없으면 "" */
    source: string;
    /** 아래 셋은 LLM이 아니라 코드가 계산한 값 */
    importance: number;
    examSignal: number;
    examAlert: boolean;
  }[];
  /** 기출 빈출 주제 — 족보가 없으면 빈 배열 */
  pastExamTopics: { topic: string; detail: string; years: number[] }[];
  /** 선수관계로 계산된 공부 순서 */
  studyOrder: { name: string; reason: string; prereqs: string[] }[];
}

/**
 * 과목(또는 units 범위)의 모든 개념·신호·기출을 모아 시험대비 학습 가이드를 1회 LLM 호출로 조립.
 * 섹션: ① 핵심 개념 요약(중요도 순, 파인만 톤) ② 기출 빈출(족보 있을 때만) ③ 공부 순서 제안.
 *
 * 범위 처리: units 미지정=과목 전체. units 지정 시 그 unit들에서 최신 점수를 쓰고, 기출도 그 범위만.
 * 점수는 unit별로 저장되므로, 각 개념의 "가장 최근(최대 unitOrder) 점수"를 개념 대표값으로 사용한다.
 */
export async function composeGuide(
  db: AoneDb,
  engine: LlmEngine,
  subject: string,
  units?: string[],
): Promise<GuideResult> {
  const conceptRows = db.allConcepts(subject);
  const allUnits = db.unitsWithScores(subject);
  const scopeUnits = units && units.length > 0 ? allUnits.filter((u) => units.includes(u.unit)) : allUnits;
  if (scopeUnits.length === 0) {
    throw new Error(`가이드 생성 대상 unit이 없습니다: ${subject}${units ? ` (범위 ${units.join(", ")})` : ""}`);
  }
  const maxOrder = Math.max(...scopeUnits.map((u) => u.unitOrder));
  const scopeLabel = units && units.length > 0 ? units.join(", ") : "전체";

  // 개념별 대표 점수 = 범위 내 unit 중 가장 최근(최대 unitOrder) 점수
  const bestScore = new Map<string, { importance: number; exam_signal: number }>();
  for (const u of [...scopeUnits].sort((a, b) => a.unitOrder - b.unitOrder)) {
    for (const s of db.scoresAtUnit(u)) {
      bestScore.set(s.concept_id, { importance: s.importance, exam_signal: s.exam_signal });
    }
  }

  const ranked = [...bestScore.entries()]
    .map(([conceptId, sc]) => ({ conceptId, ...sc }))
    .sort((a, b) => b.importance - a.importance || b.exam_signal - a.exam_signal || a.conceptId.localeCompare(b.conceptId))
    .slice(0, GUIDE_TOP_CONCEPTS);

  // examAlert("기출 빈출" 강조)는 절대 점수가 아니라 이 범위 안에서의 상대 위치로 정한다.
  // 절대 임계값(55)을 쓰면 신호가 많은 과목은 20개 전부 강조되고(=강조의 의미 상실),
  // 적은 과목은 하나도 안 붙는다. 실제로 두 과목에서 20/20과 1/20으로 갈렸다.
  // 상위 30%만 강조하되, 신호가 실제로 있는 개념(>0)으로 한정한다.
  const signalsDesc = ranked.map((r) => r.exam_signal).sort((a, b) => b - a);
  const cutoffIndex = Math.max(0, Math.ceil(signalsDesc.length * 0.3) - 1);
  const threshold = Math.max(1, signalsDesc[cutoffIndex] ?? 1);
  const concepts: ComposeGuidePayload["concepts"] = ranked.flatMap((r) => {
    const c = conceptRows.find((cr) => cr.id === r.conceptId);
    if (!c) return [];
    const evidence = db.evidenceForConcept(c.id, subject, maxOrder);
    const picked = [
      ...evidence.filter((e) => e.source_type === "transcript"),
      ...evidence.filter((e) => e.source_type !== "transcript"),
    ].slice(0, GUIDE_EVIDENCE_PER_CONCEPT);
    return [
      {
        name: c.name,
        importance: r.importance,
        examSignal: r.exam_signal,
        examAlert: r.exam_signal >= threshold,
        signalSummary: db.signalStats(c.id, subject, maxOrder),
        evidence: picked.map((e) => ({ type: e.source_type, unit: e.unit, locator: e.locator, quote: e.quote })),
      },
    ];
  });

  const pastExamRows = db.pastExamItemsForSubject(subject, units);
  const pastExams = pastExamRows.map((e) => ({ unit: e.unit, year: e.year, question: e.question }));

  // 공부 순서는 LLM 추측이 아니라 선수관계 그래프에서 계산한다.
  // 그래프는 매 주차 분석(L3)에서 증분 갱신되므로 여기서는 읽기만 한다.
  const order = studyOrder(
    db,
    subject,
    ranked.map((r) => r.conceptId),
  ).map((o) => ({ name: o.name, prereqs: o.prereqs }));

  const payload: ComposeGuidePayload = { subject, scopeLabel, concepts, pastExams, studyOrder: order };

  const out = await engine.call({
    task: "compose_guide",
    payload,
    schema: ComposeGuideOutput,
    prompt: buildPrompt(
      "compose_guide",
      [
        `대학 '${subject}' 수강생을 위한 시험대비 학습 가이드를 만들어라. 범위: ${scopeLabel}.`,
        "",
        "각 필드를 이렇게 채워라:",
        "",
        "overview — 이 시험 범위가 전체적으로 어떤 흐름인지 2~4문장. 개념 하나하나가 아니라 '무엇에서 출발해 무엇으로 이어지는 과목인지' 지형을 먼저 잡아주는 글이다. studyOrder의 흐름을 참고하라.",
        "",
        "concepts — 입력 concepts 각각에 대해:",
        "  · name: 입력의 이름을 그대로 (바꾸지 마라)",
        "  · body: 처음 배우는 사람에게 설명하듯 쉬운 말과 비유로. 전공용어를 나열하지 마라. 2~4문장.",
        "  · why: 이게 왜 시험에 중요한지 한 문장. evidence와 기출에 실제로 근거하라.",
        "  · source: 근거 위치를 evidence의 unit·locator로 (예: \"5주차 #L19\"). 없으면 빈 문자열.",
        "  입력 순서(중요도 순)를 유지하라.",
        "",
        pastExams.length > 0
          ? "pastExamTopics — pastExams(족보)를 주제별로 묶어라. topic은 주제명, detail은 어떤 형태로 출제되는지(O/X·계산·서술 등), years는 출제 연도. 5~10개."
          : "pastExamTopics — 족보가 없으므로 빈 배열로 두어라.",
        "",
        order.length > 0
          ? "studyOrder — 입력 studyOrder는 선수관계로 계산된 순서다. name과 순서를 그대로 유지하고 reason만 채워라. " +
            "reason은 왜 그 자리에 오는지 한 문장으로, 학생에게 말하듯 자연스럽게. " +
            "'prereqs' 같은 데이터 필드 이름을 문장에 쓰지 말고 '~를 먼저 알아야 ~가 이해된다' 식으로 선수 개념 이름을 녹여라. " +
            "선수 개념이 없는 항목은 '먼저 알아야 할 게 없다'를 반복하지 말고 그 개념이 왜 시작점인지 설명하라."
          : "studyOrder — 입력이 비었으므로 concepts를 중요도 순으로 넣고 reason은 빈 문자열로 두어라.",
        "",
        "evidence 인용문에 실제로 근거하고, 없는 사실을 지어내지 마라.",
      ].join("\n"),
      payload,
      `{"overview":"...","concepts":[{"name":"...","body":"...","why":"...","source":"..."}],"pastExamTopics":[{"topic":"...","detail":"...","years":[2023]}],"studyOrder":[{"name":"...","reason":"..."}]}`,
    ),
  });

  // 개념 메타(점수)는 LLM 출력이 아니라 계산값을 붙인다 — 화면이 순위·강조를 판단할 때 쓴다.
  const metaByName = new Map(concepts.map((c) => [c.name, c]));

  return {
    guide: {
      overview: out.overview,
      concepts: out.concepts.map((c) => {
        const meta = metaByName.get(c.name);
        return {
          name: c.name,
          body: c.body,
          why: c.why,
          source: c.source,
          importance: meta?.importance ?? 0,
          examSignal: meta?.examSignal ?? 0,
          examAlert: meta?.examAlert ?? false,
        };
      }),
      pastExamTopics: out.pastExamTopics,
      studyOrder: out.studyOrder.map((o) => ({
        name: o.name,
        reason: o.reason,
        prereqs: order.find((x) => x.name === o.name)?.prereqs ?? [],
      })),
    },
    concepts: concepts.length,
    pastExams: pastExams.length,
  };
}
