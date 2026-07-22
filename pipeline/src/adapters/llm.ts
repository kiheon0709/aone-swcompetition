/**
 * LLM 어댑터.
 *   llm(request) → zod 검증된 JSON.
 * 백엔드 4종:
 *   - stub       : 규칙 기반 결정적 구현 (배관 검증용)
 *   - claude-cli : `claude -p --output-format json` (stdin 프롬프트, usage 집계)
 *   - codex-cli  : `codex exec -o <file> "<prompt>"` (GPT 구독 연결용, 호출 수만 집계)
 *   - gemini-api : Google Generative Language REST API (GEMINI_API_KEY 필요)
 *
 * 계약: 모든 백엔드는 request.schema(zod)로 파싱된 값을 반환한다.
 * stub은 request.prompt를 무시하고 request.task + request.payload로 동작하며,
 * 실 백엔드는 request.prompt(페이로드 직렬화 포함)를 모델에 전달한다.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { Utterance, SlideDoc, PastExamItem } from "../layers/l1-normalize.js";

// ─────────────────────────────────────────────────────────────
// 공통 인터페이스
// ─────────────────────────────────────────────────────────────

export type LlmTask =
  | "extract_concepts"
  | "extract_signals"
  | "extract_knowledge" // L2+L3 통합: 개념+근거+평가신호를 청크당 1회 호출로
  | "match_exam_items"
  | "merge_concept_aliases" // 표기만 다른 동일 개념 묶기 (한/영, 축약형, 부분 표현)
  | "link_prerequisites" // 같은 주차 개념들 사이의 논리적 선수관계 판정
  | "generate_question"
  | "verify_question"
  | "generate_questions_batch" // L4: 상위 개념 전체 문항 1회 일괄 생성
  | "verify_questions_batch" // L4: 생성 문항 전체 1회 일괄 검증
  | "compose_note" // L4: 누적 학습노트 마크다운 조립
  | "compose_guide" // 시험대비 전체 재조립: 과목/범위 학습 가이드 1회 생성
  | "compose_slide_summaries" // 슬라이드 페이지 텍스트 → 앱 표시용 페이지별 요약 카드
  | "recognize_timetable"; // 시간표 캡처 이미지 → 강의 목록 (부록 A2)

export interface LlmRequest<T> {
  task: LlmTask;
  /** 실 LLM 백엔드용 지시문(페이로드 직렬화 포함) */
  prompt: string;
  /** stub 백엔드용 구조화 입력 */
  payload: unknown;
  /** 출력 스키마 (transform/default 허용 — 입력형과 출력형이 달라도 됨) */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** 진행 로그 표기용 (예: 청크 1/3). 동작에는 영향 없음. */
  progress?: { index: number; total: number };
  /** vision 입력 이미지 절대경로 — gemini-api는 inline_data로 첨부, CLI 백엔드는 무시(프롬프트에 경로 명시) */
  imagePath?: string;
  /** PDF 첨부 절대경로 — claude-cli는 Read 도구로 원본 PDF(그림·도식 포함)를 읽는다. gemini-api는 inline_data(application/pdf). 텍스트만 쓰는 stub·codex는 무시. */
  pdfPath?: string;
}

export interface EngineUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export interface LlmEngine {
  readonly name: string;
  /** 실 백엔드의 누적 사용량 (stub은 undefined) */
  readonly usage?: EngineUsage;
  call<T>(req: LlmRequest<T>): Promise<T>;
}

export interface EngineOptions {
  /** 독립 호출의 최대 동시 실행 수 (실 백엔드만 적용, 기본 4) */
  concurrency?: number;
  /** claude-cli에 --model 플래그로 전달할 모델명 (미지정 시 CLI 기본값) */
  model?: string;
  /** claude-cli 추가 CLI 인자 (예: --add-dir, --allowedTools — 시간표 이미지 Read용) */
  extraCliArgs?: string[];
  /** 재시도 대기(ms, 기본 30초) — 유닛 테스트에서만 단축용 */
  retryDelayMs?: number;
}

export function createEngine(
  name: "stub" | "claude-cli" | "gemini-api" | "codex-cli",
  opts: EngineOptions = {},
): LlmEngine {
  switch (name) {
    case "stub":
      return new StubEngine();
    case "claude-cli":
      return new ClaudeCliEngine(opts.concurrency ?? 4, opts.model, opts.extraCliArgs, opts.retryDelayMs);
    case "codex-cli":
      // codex(GPT 구독)는 동시 세션을 여러 개 물지 못해, 동시성이 높으면(4) execFile로
      // 동시에 부른 세션들이 출력 파일을 만들지 못하고 전량 실패한다("대용량 실패"의 실제 원인).
      // 따라서 기본 동시성을 1로 둔다 (호출은 세마포어가 직렬화). Claude·Gemini는 영향 없음.
      return new CodexCliEngine(opts.concurrency ?? 3, opts.model, opts.retryDelayMs);
    case "gemini-api":
      // Gemini 무료 티어는 분당 요청 한도가 좁아 처음부터 동시성 2로 시작 (429 예방).
      // (CLI 구독 엔진은 한도가 넓어 4 유지)
      return new GeminiApiEngine(opts.concurrency ?? 2, opts.model, opts.retryDelayMs);
  }
}

/** 조절 가능한 세마포어 — rate limit 감지 시 max를 낮춘다 */
class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(public max: number) {}

  async acquire(): Promise<void> {
    while (this.active >= this.max) {
      await new Promise<void>((r) => this.queue.push(r));
    }
    this.active++;
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ─────────────────────────────────────────────────────────────
// 태스크별 페이로드/출력 타입 (stub과 레이어가 공유)
// ─────────────────────────────────────────────────────────────

export interface ExtractConceptsPayload {
  utterances: Utterance[];
  slides: SlideDoc[];
  maxConcepts: number;
  evidencePerConcept: number;
}

export const ExtractedConceptSchema = z.object({
  name: z.string().min(1),
  evidence: z.array(
    z.object({
      type: z.enum(["transcript", "slide"]),
      locator: z.string(),
      quote: z.string(),
    }),
  ),
});
export const ExtractConceptsOutput = z.object({ concepts: z.array(ExtractedConceptSchema) });
export type ExtractConceptsOutputT = z.infer<typeof ExtractConceptsOutput>;

export interface ExtractSignalsPayload {
  utterances: Utterance[];
  conceptNames: string[];
}

export const SignalItemSchema = z.object({
  concept: z.string(),
  kind: z.enum(["emphasis", "exam_hint"]),
  locator: z.string(),
  quote: z.string(),
});
export const ExtractSignalsOutput = z.object({ signals: z.array(SignalItemSchema) });
export type ExtractSignalsOutputT = z.infer<typeof ExtractSignalsOutput>;

/** L2+L3 통합 추출 페이로드: 전사본 청크 + (동승한) 슬라이드 문서 + 기존 개념 목록 */
export interface ExtractKnowledgePayload {
  utterances: Utterance[];
  slides: SlideDoc[];
  /** 신호 연결용 기존(누적) 개념 이름 목록 */
  conceptNames: string[];
  maxConcepts: number;
  evidencePerConcept: number;
}

export const ExtractKnowledgeOutput = z.object({
  concepts: z.array(ExtractedConceptSchema),
  signals: z.array(SignalItemSchema),
});
export type ExtractKnowledgeOutputT = z.infer<typeof ExtractKnowledgeOutput>;

export interface MatchExamPayload {
  items: PastExamItem[];
  conceptNames: string[];
}

export const MatchExamOutput = z.object({
  matches: z.array(z.object({ itemId: z.string(), concept: z.string() })),
});
export type MatchExamOutputT = z.infer<typeof MatchExamOutput>;

export interface MergeAliasesPayload {
  conceptNames: string[];
}

/**
 * 표기만 다른 동일 개념 묶음.
 * canonical은 그 묶음의 대표 이름, aliases는 canonical로 흡수될 이름들.
 * 문자열 유사도(isSameConcept)로는 "레이스 컨디션" ↔ "경쟁 상태(Race Condition)"처럼
 * 표기 체계가 다른 쌍을 잡지 못해 LLM 판단이 필요하다.
 */
export const MergeAliasesOutput = z.object({
  groups: z.array(z.object({ canonical: z.string(), aliases: z.array(z.string()) })),
});
export type MergeAliasesOutputT = z.infer<typeof MergeAliasesOutput>;

export interface LinkPrerequisitesPayload {
  /** 같은 주차에 처음 등장해 배운 순서로는 선후를 알 수 없는 개념들 */
  conceptNames: string[];
  unit: string;
}

/**
 * 선수관계: prerequisite를 먼저 이해해야 concept를 이해할 수 있다.
 * 주차가 다른 개념은 커리큘럼 순서(first_unit_order)로 이미 판정되므로,
 * LLM은 같은 주차 안에서만 논리적 의존을 판정한다.
 */
export const LinkPrerequisitesOutput = z.object({
  links: z.array(z.object({ concept: z.string(), prerequisite: z.string() })),
});
export type LinkPrerequisitesOutputT = z.infer<typeof LinkPrerequisitesOutput>;

export interface GenerateQuestionPayload {
  concept: { name: string; importance: number; examSignal: number };
  evidence: { type: string; unit: string; unitOrder: number; locator: string; quote: string }[];
  /** 이 개념과 매칭된 기출 문항 원문 (있으면 출제 스타일 참고용) */
  pastExamHints: string[];
  signalSummary: { emphasis: number; examHint: number; examMatch: number };
  index: number;
}

/** 블룸 인지수준(능동 회상 유도). 구 응답 호환 위해 기본값 "understand". */
export const CognitiveLevelSchema = z
  .enum(["remember", "understand", "apply", "analyze"])
  .default("understand");

export const GenerateQuestionOutput = z.object({
  q: z.string().min(1),
  a: z.string().min(1),
  difficulty: z.string().min(1),
  cognitiveLevel: CognitiveLevelSchema,
  reasoning: z.string().min(1),
});
export type GenerateQuestionOutputT = z.infer<typeof GenerateQuestionOutput>;

export interface VerifyQuestionPayload {
  question: { q: string; a: string };
  sources: { type: string; unit: string; unitOrder: number; locator: string; quote: string }[];
  /** 코드 레벨 source 실존 확인 결과 (stub 검증 입력) */
  sourcesExist: boolean;
}

export const VerifyQuestionOutput = z.object({ ok: z.boolean(), reason: z.string() });
export type VerifyQuestionOutputT = z.infer<typeof VerifyQuestionOutput>;

/** L4 일괄 생성: 상위 개념 전체의 문항을 1회 호출로 */
export interface GenerateQuestionsBatchPayload {
  concepts: {
    conceptId: string;
    name: string;
    importance: number;
    examSignal: number;
    evidence: { type: string; unit: string; unitOrder: number; locator: string; quote: string }[];
    pastExamHints: string[];
    signalSummary: { emphasis: number; examHint: number; examMatch: number };
  }[];
  questionsPerConcept: number;
}

export const GenerateQuestionsBatchOutput = z.object({
  questions: z.array(
    z.object({
      conceptId: z.string(),
      q: z.string().min(1),
      a: z.string().min(1),
      difficulty: z.string().min(1),
      cognitiveLevel: CognitiveLevelSchema,
      reasoning: z.string().min(1),
    }),
  ),
});
export type GenerateQuestionsBatchOutputT = z.infer<typeof GenerateQuestionsBatchOutput>;

/** L4 일괄 검증: 생성 문항 전체를 1회 호출로 */
export interface VerifyQuestionsBatchPayload {
  questions: {
    id: string;
    q: string;
    a: string;
    sources: { type: string; unit: string; unitOrder: number; locator: string; quote: string }[];
    /** 코드 레벨 source 실존 확인 결과 */
    sourcesExist: boolean;
  }[];
}

export const VerifyQuestionsBatchOutput = z.object({
  verdicts: z.array(z.object({ id: z.string(), ok: z.boolean(), reason: z.string() })),
});
export type VerifyQuestionsBatchOutputT = z.infer<typeof VerifyQuestionsBatchOutput>;

/** L4 학습노트 조립(증분): 직전 노트 + 이번 unit 델타 개념만 반영 */
export interface ComposeNotePayload {
  subject: string;
  unit: string;
  /** 직전 unit 노트 마크다운(있으면). 증분 반영의 기반. 없으면 빈 문자열. */
  priorNote: string;
  /** priorNote가 존재하면 true — 델타만 반영, false면 전체 신규 작성 */
  incremental: boolean;
  /** concepts 목록 = 이번 unit 델타(증분 시) 또는 상위 개념 전체(전체 작성 시) */
  concepts: {
    name: string;
    importance: number;
    examSignal: number;
    /** 시험신호 임계 초과 → 노트에 ⚠️ 표기 대상 */
    examAlert: boolean;
    evidence: { type: string; unit: string; locator: string; quote: string }[];
  }[];
}

export const ComposeNoteOutput = z.object({ markdown: z.string().min(1) });
export type ComposeNoteOutputT = z.infer<typeof ComposeNoteOutput>;

/** 시험대비 학습 가이드(전체 재조립): 범위 내 개념·신호·기출을 1회로 조립 */
export interface ComposeGuidePayload {
  subject: string;
  /** 범위 라벨 (예: "전체" 또는 "1주차, 2주차") */
  scopeLabel: string;
  concepts: {
    name: string;
    importance: number;
    examSignal: number;
    examAlert: boolean;
    signalSummary: { emphasis: number; examHint: number; examMatch: number };
    evidence: { type: string; unit: string; locator: string; quote: string }[];
  }[];
  /** 족보(기출) — 있을 때만 "기출 빈출" 섹션. 없으면 빈 배열 → 스킵. */
  pastExams: { unit: string; year: number | null; question: string }[];
  /**
   * 선수관계로 계산된 공부 순서 (앞에서부터 차례로).
   * LLM이 순서를 지어내지 않고 이 배열을 그대로 쓰게 한다.
   */
  studyOrder: { name: string; prereqs: string[] }[];
}

/**
 * 학습 가이드 산출물 — 마크다운 한 덩어리가 아니라 구조화 데이터로 받는다.
 *
 * 앱 화면은 개념을 접었다 펴고 섹션을 따로 배치해야 하는데, 마크다운을 역파싱하면
 * LLM이 과목·엔진마다 조금씩 다르게 쓰는 문장 형식에 의존하게 된다.
 * (실제로 같은 프롬프트에서 "**왜 중요할까:**"와 "중요 이유:" 두 형식이 관측됐다)
 * 스키마로 강제하면 어떤 과목이 들어와도 화면이 같은 방식으로 동작한다.
 */
export const ComposeGuideOutput = z.object({
  /** 이 시험 범위가 전체적으로 어떤 흐름인지 2~4문장 — 개념을 보기 전에 읽는 "숲" */
  overview: z.string().min(1),
  concepts: z.array(
    z.object({
      /** 입력 concepts의 name과 정확히 일치해야 한다 */
      name: z.string().min(1),
      /** 파인만식 설명 — 쉬운 말과 비유로 */
      body: z.string().min(1),
      /** 왜 시험에 중요한지 한 문장 */
      why: z.string(),
      /** "5주차 #L19" 같은 근거 위치 (없으면 빈 문자열) */
      source: z.string(),
    }),
  ),
  /** 기출 빈출 주제 — 족보가 없으면 빈 배열 */
  pastExamTopics: z.array(
    z.object({
      /** 주제명 (예: "PCB와 process context") */
      topic: z.string().min(1),
      /** 어떻게 출제되는지 */
      detail: z.string(),
      /** 출제 연도 (알 수 있을 때만) */
      years: z.array(z.number().int()),
    }),
  ),
  /** 공부 순서 — studyOrder 입력과 같은 순서·같은 이름. reason은 왜 그 자리인지 */
  studyOrder: z.array(z.object({ name: z.string().min(1), reason: z.string() })),
});
export type ComposeGuideOutputT = z.infer<typeof ComposeGuideOutput>;

/** 슬라이드 요약: doc 태그 하나의 페이지 텍스트 묶음(청크) → 앱 슬라이드 JSON 항목들 */
export interface ComposeSlideSummariesPayload {
  subject: string;
  unit: string;
  /** doc 태그 (예: "theory_01" 또는 업로드 PDF 원본명 기반) */
  tag: string;
  pages: { page: number; lines: string[] }[];
}

export const SlideSummaryItemSchema = z.object({
  slide_id: z.string().min(1),
  title_ko: z.string().min(1),
  summary_ko: z.string().min(1),
  key_points_ko: z.array(z.string().min(1)).min(1),
  diagram_ko: z.string().optional(),
  exam_tip: z.string().optional(),
  lecture_ref: z.string().optional(),
});
/**
 * 슬라이드 요약 산출물.
 *
 * 자료 전체를 한 번에 넘길 때는 overview·themes까지 함께 받는다. 쪽별 카드만
 * 이어붙이면 "이 자료가 무엇을 다루는지"가 어디에도 없고, 흩어진 페이지가 같은
 * 주제라는 것도 드러나지 않는다(예: PCB가 11~16쪽과 25~27쪽에 나뉘어 등장).
 * 긴 자료를 청크로 나눌 때는 청크 하나가 전체를 못 보므로 비워두고,
 * 청크가 다 끝난 뒤 따로 1회 조립한다.
 */
export const ComposeSlideSummariesOutput = z.object({
  slides: z.array(SlideSummaryItemSchema),
  /** 이 자료 전체가 무엇을 다루는지 3~4문장 */
  overview: z.string().default(""),
  /**
   * 큰 주제 묶음 — 흩어진 페이지를 주제로 모으고, 그 주제의 핵심 내용까지 담는다.
   * point만 있으면 "무엇을 다루는지"만 알 뿐 "그래서 그게 뭔데"에 답하지 못해
   * 결국 쪽별 카드를 다시 훑게 된다. body·keyPoints가 그 답이다.
   */
  themes: z
    .array(
      z.object({
        name: z.string(),
        pages: z.array(z.number().int()),
        /** 이 주제가 무엇을 다루는지 한 줄 */
        point: z.string().default(""),
        /** 핵심 내용 2~4문장 — 이것만 읽어도 주제의 알맹이가 잡혀야 한다 */
        body: z.string().default(""),
        /** 짚고 넘어갈 것 3~5개 (짧은 문장) */
        keyPoints: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});
export type ComposeSlideSummariesOutputT = z.infer<typeof ComposeSlideSummariesOutput>;

// ─────────────────────────────────────────────────────────────
// stub 백엔드 — 규칙 기반 결정적 구현
// ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "여러분", "여러분들", "우리", "우리가", "저희", "사람", "생각", "얘기", "이야기",
  "이거", "그거", "저거", "이게", "그게", "저게", "이건", "그건", "요거",
  "이런", "그런", "저런", "어떤", "무슨", "이렇게", "그렇게", "저렇게", "어떻게",
  "지금", "오늘", "내일", "다음", "이번", "저번", "요즘", "나중", "먼저", "제일",
  "그래서", "그러면", "그리고", "그런데", "근데", "그다음", "그때", "때문", "경우",
  "정도", "부분", "내용", "설명", "시간", "수업", "강의", "공부", "과제", "숙제",
  "하나", "여기", "저기", "거기", "가지", "말씀", "질문", "대답", "정답",
  "합니다", "됩니다", "있습니다", "없습니다", "입니다", "그렇습니다", "보세요",
  "있어요", "없어요", "돼요", "해요", "하는", "있는", "없는", "되는", "같은",
  "보면", "하면", "되면", "해서", "해야", "하니까", "그러니까", "왜냐하면",
  "아니라", "아니고", "가지고", "이거를", "그거를", "무엇", "이것", "그것", "저것",
  "이제", "바로", "계속", "다시", "많이", "조금",
  "진짜", "정말", "아주", "매우", "되게", "약간", "그냥", "일단", "물론", "당연히",
  "예를", "들어서", "예시", "다음과", "위해", "통해", "대한", "대해", "관련",
  "the", "and", "for", "with", "that", "this", "from", "http", "https", "www",
]);

/** 한국어 토큰 꼬리의 조사 제거 (남는 길이 2 이상일 때만) */
const PARTICLES = [
  "이라는", "이라고", "에서는", "에서도", "으로는", "으로도", "한테", "에게",
  "들이", "들을", "들은", "들도", "이나", "이란", "이든", "부터", "까지", "마다",
  "에서", "으로", "이랑", "이야", "인데", "이고", "하고", "보다", "처럼", "같이",
  "은", "는", "이", "가", "을", "를", "의", "에", "도", "만", "과", "와", "로", "요",
];

export function normalizeToken(tok: string): string {
  let t = tok;
  if (/^[가-힣]+$/.test(t)) {
    for (const p of PARTICLES) {
      if (t.length - p.length >= 2 && t.endsWith(p)) {
        t = t.slice(0, t.length - p.length);
        break;
      }
    }
  }
  return t.toLowerCase();
}

export function tokenize(text: string): string[] {
  const raw = text.match(/[A-Za-z][A-Za-z0-9]{1,}|[가-힣]{2,}/g) ?? [];
  const out: string[] = [];
  for (const r of raw) {
    const t = normalizeToken(r);
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

const EXAM_HINT_RE = /시험|중간고사|기말|퀴즈|기출|족보|출제|문제.{0,6}(나오|나온|나올|낼|냅)/;
const EMPHASIS_RE = /중요|핵심|반드시|꼭\s|외우|외워|기억하|잊지|강조|포인트/;

function truncate(s: string, n = 140): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * 텍스트가 개념을 언급하는지 판정.
 * 라틴 문자 개념(ip, ai …)은 부분 문자열 오탐("iperf" ⊃ "ip")을 막기 위해 토큰 일치만 허용.
 */
function conceptMentioned(text: string, conceptName: string, tokenCache?: Set<string>): boolean {
  const name = conceptName.toLowerCase();
  if (/^[a-z][a-z0-9]*$/.test(name)) {
    const tokens = tokenCache ?? new Set(tokenize(text));
    return tokens.has(name);
  }
  return text.toLowerCase().includes(name);
}

class StubEngine implements LlmEngine {
  readonly name = "stub";
  /** 호출 밀도 드라이런 검증용: stub도 호출 횟수를 집계한다 (토큰·비용은 0) */
  readonly usage: EngineUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
  };

  async call<T>(req: LlmRequest<T>): Promise<T> {
    this.usage.calls++;
    let out: unknown;
    switch (req.task) {
      case "extract_concepts":
        out = stubExtractConcepts(req.payload as ExtractConceptsPayload);
        break;
      case "extract_signals":
        out = stubExtractSignals(req.payload as ExtractSignalsPayload);
        break;
      case "extract_knowledge":
        out = stubExtractKnowledge(req.payload as ExtractKnowledgePayload);
        break;
      case "match_exam_items":
        out = stubMatchExamItems(req.payload as MatchExamPayload);
        break;
      case "merge_concept_aliases":
        // stub은 LLM 판단을 흉내내지 않는다 — 병합 없음(빈 그룹)이 안전한 기본값.
        out = { groups: [] } satisfies MergeAliasesOutputT;
        break;
      case "link_prerequisites":
        // 같은 이유로 링크 없음이 기본값 — 커리큘럼 순서 기반 관계는 코드가 따로 만든다.
        out = { links: [] } satisfies LinkPrerequisitesOutputT;
        break;
      case "generate_question":
        out = stubGenerateQuestion(req.payload as GenerateQuestionPayload);
        break;
      case "verify_question":
        out = stubVerifyQuestion(req.payload as VerifyQuestionPayload);
        break;
      case "generate_questions_batch":
        out = stubGenerateQuestionsBatch(req.payload as GenerateQuestionsBatchPayload);
        break;
      case "verify_questions_batch":
        out = stubVerifyQuestionsBatch(req.payload as VerifyQuestionsBatchPayload);
        break;
      case "compose_note":
        out = stubComposeNote(req.payload as ComposeNotePayload);
        break;
      case "compose_guide":
        out = stubComposeGuide(req.payload as ComposeGuidePayload);
        break;
      case "compose_slide_summaries":
        out = stubComposeSlideSummaries(req.payload as ComposeSlideSummariesPayload);
        break;
      default:
        throw new Error(`stub: 알 수 없는 태스크 ${req.task as string}`);
    }
    return req.schema.parse(out);
  }
}

/** 명사 빈도 상위 추출을 개념으로 흉내: 슬라이드 등장 가중(×3), 슬라이드 미등장 시 고빈도 요구 */
function stubExtractConcepts(p: ExtractConceptsPayload): ExtractConceptsOutputT {
  const tFreq = new Map<string, number>();
  for (const u of p.utterances) {
    for (const tok of tokenize(u.text)) tFreq.set(tok, (tFreq.get(tok) ?? 0) + 1);
  }
  const sFreq = new Map<string, number>();
  for (const doc of p.slides) {
    for (const page of doc.pages) {
      for (const line of page.lines) {
        for (const tok of tokenize(line)) sFreq.set(tok, (sFreq.get(tok) ?? 0) + 1);
      }
    }
  }

  const candidates: { name: string; score: number }[] = [];
  const names = new Set([...tFreq.keys(), ...sFreq.keys()]);
  for (const name of names) {
    const t = tFreq.get(name) ?? 0;
    const s = sFreq.get(name) ?? 0;
    if (s === 0 && t < 6) continue; // 슬라이드에 없으면 전사본 고빈도만
    if (s > 0 && t + s < 3) continue;
    candidates.push({ name, score: t + 3 * s });
  }
  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"));

  // 발화별 토큰 캐시 (라틴 개념 토큰 일치 판정용)
  const uTokens = p.utterances.map((u) => new Set(tokenize(u.text)));

  const concepts = candidates.slice(0, p.maxConcepts).map((c) => {
    const evidence: { type: "transcript" | "slide"; locator: string; quote: string }[] = [];
    // 슬라이드 근거 우선 1건
    outer: for (const doc of p.slides) {
      for (const page of doc.pages) {
        for (const line of page.lines) {
          if (conceptMentioned(line, c.name)) {
            evidence.push({ type: "slide", locator: `${doc.tag} p.${page.page}`, quote: truncate(line) });
            break outer;
          }
        }
      }
    }
    for (let i = 0; i < p.utterances.length; i++) {
      if (evidence.length >= p.evidencePerConcept) break;
      const u = p.utterances[i];
      if (conceptMentioned(u.text, c.name, uTokens[i])) {
        evidence.push({ type: "transcript", locator: u.t, quote: truncate(u.text) });
      }
    }
    return { name: c.name, evidence };
  });

  return { concepts: concepts.filter((c) => c.evidence.length > 0) };
}

/** "시험"·"중요" 류 문장을 평가신호로: exam_hint / emphasis 두 갈래 */
function stubExtractSignals(p: ExtractSignalsPayload): ExtractSignalsOutputT {
  const signals: ExtractSignalsOutputT["signals"] = [];
  for (const u of p.utterances) {
    const isExam = EXAM_HINT_RE.test(u.text);
    const isEmph = EMPHASIS_RE.test(u.text);
    if (!isExam && !isEmph) continue;
    const tokens = new Set(tokenize(u.text));
    for (let i = 0; i < p.conceptNames.length; i++) {
      if (!conceptMentioned(u.text, p.conceptNames[i], tokens)) continue;
      signals.push({
        concept: p.conceptNames[i],
        kind: isExam ? "exam_hint" : "emphasis",
        locator: u.t,
        quote: truncate(u.text),
      });
    }
  }
  return { signals };
}

/** 기출 문항 ↔ 개념 매칭: 개념명이 문항에 등장(부분 문자열/토큰 일치) */
function stubMatchExamItems(p: MatchExamPayload): MatchExamOutputT {
  const matches: MatchExamOutputT["matches"] = [];
  for (const item of p.items) {
    const qTokens = new Set(tokenize(item.question));
    for (const concept of p.conceptNames) {
      if (conceptMentioned(item.question, concept, qTokens)) {
        matches.push({ itemId: item.id, concept });
      }
    }
  }
  return { matches };
}

const DIFFICULTIES = ["easy", "medium", "hard"];
/** stub 문항 각도(index)별 블룸 인지수준 — 정의/오답고르기/적용/계산 순 */
const COGNITIVE_LEVELS = ["understand", "analyze", "apply", "apply"] as const;

function stubGenerateQuestion(p: GenerateQuestionPayload): GenerateQuestionOutputT {
  const name = p.concept.name;
  const ev = p.evidence[p.index % Math.max(1, p.evidence.length)];
  const templates = [
    `${name}의 개념을 정의하고, 강의에서 다룬 맥락에서 그 역할을 설명하시오.`,
    `${name}에 대한 설명으로 옳지 않은 것을 고르시오. (강의·슬라이드 근거 기반)`,
    `${name}이(가) 실제 통신 시스템에서 어떻게 적용되는지 예를 들어 서술하시오.`,
    `${name}과(와) 관련된 계산/적용 문제: 강의에서 제시된 조건을 이용해 값을 구하시오.`,
  ];
  const q = templates[p.index % templates.length];
  const cognitiveLevel = COGNITIVE_LEVELS[p.index % COGNITIVE_LEVELS.length];
  const a = ev
    ? `강의 근거(${ev.locator})에 따르면: ${ev.quote}`
    : `${name}에 대한 강의 내용을 근거로 답한다.`;
  const s = p.signalSummary;
  const reasoning =
    `examSignal ${p.concept.examSignal}/100, importance ${p.concept.importance}/100 — ` +
    `기출 매칭 ${s.examMatch}회, 시험 언급 ${s.examHint}회, 강조 ${s.emphasis}회. ` +
    `근거 ${p.evidence.length}건(${p.evidence.map((e) => e.locator).slice(0, 3).join(", ")}) 기반 출제.`;
  return { q, a, difficulty: DIFFICULTIES[p.index % DIFFICULTIES.length], cognitiveLevel, reasoning };
}

function stubVerifyQuestion(p: VerifyQuestionPayload): VerifyQuestionOutputT {
  if (!p.sourcesExist) return { ok: false, reason: "source 실존 확인 실패: 근거 저장소에 없는 출처" };
  if (p.sources.length === 0) return { ok: false, reason: "출처 없음" };
  if (p.sources.some((s) => s.quote.trim().length < 5)) return { ok: false, reason: "출처 인용문이 비어있거나 너무 짧음" };
  return { ok: true, reason: `출처 ${p.sources.length}건 실존 확인 및 인용문 점검 통과` };
}

/** L2+L3 통합 stub: 청크(+동승 슬라이드)에서 개념 추출 후, 같은 청크에서 신호 추출 */
function stubExtractKnowledge(p: ExtractKnowledgePayload): ExtractKnowledgeOutputT {
  const { concepts } = stubExtractConcepts({
    utterances: p.utterances,
    slides: p.slides,
    maxConcepts: p.maxConcepts,
    evidencePerConcept: p.evidencePerConcept,
  });
  const names = [...new Set([...p.conceptNames, ...concepts.map((c) => c.name)])];
  const { signals } = stubExtractSignals({ utterances: p.utterances, conceptNames: names });
  return { concepts, signals };
}

function stubGenerateQuestionsBatch(p: GenerateQuestionsBatchPayload): GenerateQuestionsBatchOutputT {
  const questions: GenerateQuestionsBatchOutputT["questions"] = [];
  for (const c of p.concepts) {
    for (let i = 0; i < p.questionsPerConcept; i++) {
      const one = stubGenerateQuestion({
        concept: { name: c.name, importance: c.importance, examSignal: c.examSignal },
        evidence: c.evidence,
        pastExamHints: c.pastExamHints,
        signalSummary: c.signalSummary,
        index: i,
      });
      questions.push({ conceptId: c.conceptId, ...one });
    }
  }
  return { questions };
}

function stubVerifyQuestionsBatch(p: VerifyQuestionsBatchPayload): VerifyQuestionsBatchOutputT {
  return {
    verdicts: p.questions.map((q) => {
      const v = stubVerifyQuestion({ question: { q: q.q, a: q.a }, sources: q.sources, sourcesExist: q.sourcesExist });
      return { id: q.id, ...v };
    }),
  };
}

/** 학습노트 stub: 결정적 마크다운 조립 (배관 검증용). 증분 시 직전 노트 뒤에 델타 섹션을 덧붙인다. */
function stubComposeNote(p: ComposeNotePayload): ComposeNoteOutputT {
  const sectionsOf = (startNo: number): string[] => {
    const lines: string[] = [];
    p.concepts.forEach((c, i) => {
      lines.push(`## ${startNo + i}. ${c.name}${c.examAlert ? " ⚠️" : ""}`);
      lines.push(`중요도 ${c.importance}/100, 시험신호 ${c.examSignal}/100.`);
      for (const ev of c.evidence.slice(0, 2)) {
        lines.push(`> "${ev.quote}" — (${ev.type} ${ev.locator}, ${ev.unit})`);
      }
      lines.push("");
    });
    return lines;
  };

  if (p.incremental && p.priorNote.trim() !== "") {
    // 델타만 반영: 직전 노트를 그대로 두고 이번 unit 갱신 섹션을 뒤에 덧붙임 (제목의 unit 표기는 갱신)
    const prior = p.priorNote.replace(/^# .+$/m, `# ${p.subject} 학습노트 — ${p.unit}까지`);
    const delta = [`### ${p.unit} 갱신`, "", ...sectionsOf(1)];
    return { markdown: `${prior.trimEnd()}\n\n${delta.join("\n")}`.trimEnd() + "\n" };
  }

  const lines: string[] = [`# ${p.subject} 학습노트 — ${p.unit}까지`, "", ...sectionsOf(1)];
  return { markdown: lines.join("\n") };
}

/** 학습 가이드 stub: 결정적 구조화 출력 (LLM 없이 입력만으로 조립) */
function stubComposeGuide(p: ComposeGuidePayload): ComposeGuideOutputT {
  const byImportance = [...p.concepts].sort((a, b) => b.importance - a.importance || b.examSignal - a.examSignal);
  return {
    overview: `${p.subject} ${p.scopeLabel} 범위 — 개념 ${p.concepts.length}개, 기출 ${p.pastExams.length}문항.`,
    concepts: byImportance.map((c) => {
      const ev = c.evidence[0];
      return {
        name: c.name,
        body: ev ? ev.quote : `${c.name} — 근거 인용 없음.`,
        why: `강조 ${c.signalSummary.emphasis}회, 시험 언급 ${c.signalSummary.examHint}회, 기출 매칭 ${c.signalSummary.examMatch}회.`,
        source: ev ? `${ev.unit} ${ev.locator}` : "",
      };
    }),
    pastExamTopics: p.pastExams.slice(0, 10).map((e) => ({
      topic: truncate(e.question, 40),
      detail: e.question,
      years: e.year ? [e.year] : [],
    })),
    // studyOrder 입력이 있으면 그대로, 없으면 중요도 순 (stub은 순서를 지어내지 않는다)
    studyOrder:
      p.studyOrder.length > 0
        ? p.studyOrder.map((o) => ({
            name: o.name,
            reason: o.prereqs.length > 0 ? `${o.prereqs.join(", ")}를 먼저 본다.` : "선행 개념 없음.",
          }))
        : byImportance.map((c) => ({ name: c.name, reason: "" })),
  };
}

/** 슬라이드 요약 stub: 페이지 첫 줄=제목, 상위 줄=요약/포인트, 시험 단서 줄이 있을 때만 exam_tip */
function stubComposeSlideSummaries(p: ComposeSlideSummariesPayload): ComposeSlideSummariesOutputT {
  const slides = p.pages.map((page) => {
    const lines = page.lines.filter((l) => l.trim() !== "");
    const title = truncate(lines[0] ?? `${p.tag} ${page.page}페이지`, 60);
    const keyPoints = (lines.length > 1 ? lines.slice(1, 6) : lines.slice(0, 1)).map((l) => truncate(l, 120));
    const examLine = lines.find((l) => EXAM_HINT_RE.test(l) || EMPHASIS_RE.test(l));
    return {
      slide_id: `${p.tag}_p${String(page.page).padStart(2, "0")}`,
      title_ko: title,
      summary_ko: lines.slice(0, 3).join("\n") || title,
      key_points_ko: keyPoints.length > 0 ? keyPoints : [title],
      diagram_ko: "",
      exam_tip: examLine ? truncate(examLine, 120) : "",
      lecture_ref: "",
    };
  });
  // stub은 주제를 판단하지 않는다 — 페이지 수만 알리는 결정적 문장으로 둔다.
  return {
    slides,
    overview: `${p.tag} — ${p.pages.length}쪽 자료.`,
    themes: [],
  };
}

// ─────────────────────────────────────────────────────────────
// claude-cli 백엔드
// 활성화: cli.ts --engine claude-cli  (사용자 전역 claude 인증 그대로 사용)
// ─────────────────────────────────────────────────────────────

interface ClaudeCliEnvelope {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

const RATE_LIMIT_RE = /rate.?limit|too many|overloaded|429|529/i;

/**
 * 실 백엔드 공통 베이스 (CLI·API 공용): 동시성 세마포어 + 일시 오류 재시도.
 * 일시 오류(rate limit 등): 30초 대기 후 재시도, 최대 2회. rate limit 감지 시 동시성 2로 하향.
 */
abstract class RetryingCliEngine implements LlmEngine {
  abstract readonly name: string;
  readonly usage: EngineUsage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
  };
  protected readonly sem: Semaphore;
  private readonly retryDelayMs: number;

  constructor(concurrency: number, retryDelayMs = 30_000) {
    this.sem = new Semaphore(concurrency);
    this.retryDelayMs = retryDelayMs;
  }

  async call<T>(req: LlmRequest<T>): Promise<T> {
    let lastErr: unknown;
    // 진행 로그: 앱 에이전트 콘솔이 "→ ... 호출" / "← ... 완료" 줄을 파싱해 호출 수·스피너를 표시한다.
    const where = req.progress ? `, 청크 ${req.progress.index + 1}/${req.progress.total}` : "";
    // 분당 한도(429)는 시간이 해결하므로 재시도를 넉넉히 준다.
    // 일반 오류: 3회(빠른 재시도). rate limit: 최대 6회(분당 리셋 대기).
    const MAX_ATTEMPTS = 6;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let waitMs = 0; // 이번 시도 후 대기 (재시도 시에만 >0)
      await this.sem.acquire();
      const t0 = Date.now();
      console.log(`  → ${this.name} 호출 (task=${req.task}${where})`);
      try {
        const out = await this.callOnce(req);
        console.log(
          `  ← ${this.name} 완료 (task=${req.task}${where}, ${((Date.now() - t0) / 1000).toFixed(1)}초)`,
        );
        return out;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isRateLimit = RATE_LIMIT_RE.test(msg);
        if (isRateLimit && this.sem.max > 1) {
          console.error(`  [${this.name}] 분당 한도 감지 — 동시성 ${this.sem.max}→1로 하향`);
          this.sem.max = 1;
        }
        // rate limit이 아닌 일반 오류는 3회까지만 (더 기다려도 안 풀림)
        const attemptCap = isRateLimit ? MAX_ATTEMPTS : 3;
        if (attempt + 1 >= attemptCap) break;
        // 대기: rate limit이면 분당 리셋을 위해 65초, 그 외는 짧게.
        waitMs = isRateLimit ? 65_000 : this.retryDelayMs;
        console.error(
          isRateLimit
            ? `  [${this.name}] 분당 사용량 한도 — 약 ${Math.round(waitMs / 1000)}초 뒤 자동 재시도 (${attempt + 1}/${attemptCap}). 한도는 1분마다 초기화됩니다.`
            : `  [${this.name}] ${req.task} 실패 (시도 ${attempt + 1}/${attemptCap}): ${msg.slice(0, 160)} — ${Math.round(waitMs / 1000)}초 후 재시도`,
        );
      } finally {
        this.sem.release();
      }
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    }
    throw lastErr;
  }

  protected abstract callOnce<T>(req: LlmRequest<T>): Promise<T>;
}

class ClaudeCliEngine extends RetryingCliEngine {
  readonly name = "claude-cli";
  private readonly model?: string;
  private readonly extraCliArgs: string[];

  constructor(concurrency: number, model?: string, extraCliArgs?: string[], retryDelayMs?: number) {
    super(concurrency, retryDelayMs);
    this.model = model;
    this.extraCliArgs = extraCliArgs ?? [];
  }

  protected callOnce<T>(req: LlmRequest<T>): Promise<T> {
    // 프롬프트는 stdin으로 전달 (argv 길이 제한 회피). 비동기 spawn — 병렬 실행 가능.
    const env = { ...process.env };
    delete env.CLAUDE_CONFIG_DIR; // 격리 설정 없이 전역 인증 사용
    // 재현성: 사용자·전역 CLAUDE.md와 설정을 무시한다. 이게 없으면 노트북·계정마다
    // 다른 CLAUDE.md가 산출물에 개입해 결과가 달라진다 (전역 인증은 유지됨).
    const isolateArgs = ["--setting-sources", ""];
    // B안: PDF 원본 첨부 — Read 도구로 그 폴더 파일(그림·도식 포함)을 읽게 허용.
    const pdfArgs = req.pdfPath
      ? ["--add-dir", path.dirname(req.pdfPath), "--allowedTools", "Read"]
      : [];
    return new Promise<T>((resolve, reject) => {
      const child = execFile(
        process.env.CLAUDE_BIN ?? "claude",
        ["-p", "--output-format", "json", ...isolateArgs, ...(this.model ? ["--model", this.model] : []), ...pdfArgs, ...this.extraCliArgs],
        { encoding: "utf8", timeout: 600_000, maxBuffer: 32 * 1024 * 1024, env }, // 10분 — 긴 조립(compose_guide 등) 대응
        (err, stdout, stderr) => {
          try {
            if (err) {
              throw new Error(`claude-cli 실행 실패: ${err.message.slice(0, 200)} ${String(stderr).slice(0, 200)}`);
            }
            const envelope = JSON.parse(stdout) as ClaudeCliEnvelope;
            this.usage.calls++;
            this.usage.inputTokens += envelope.usage?.input_tokens ?? 0;
            this.usage.outputTokens += envelope.usage?.output_tokens ?? 0;
            this.usage.cacheCreationTokens += envelope.usage?.cache_creation_input_tokens ?? 0;
            this.usage.cacheReadTokens += envelope.usage?.cache_read_input_tokens ?? 0;
            this.usage.costUsd += envelope.total_cost_usd ?? 0;
            if (envelope.is_error) {
              throw new Error(`claude-cli 오류 응답: ${String(envelope.result).slice(0, 300)}`);
            }
            resolve(req.schema.parse(extractJson(envelope.result ?? stdout)));
          } catch (e) {
            reject(e);
          }
        },
      );
      child.stdin!.write(req.prompt);
      child.stdin!.end();
    });
  }
}

// ─────────────────────────────────────────────────────────────
// codex-cli 백엔드 (GPT 구독 연결용)
// 활성화: cli.ts --engine codex-cli  (codex login 상태 필요)
//   codex exec --skip-git-repo-check -o <임시파일> "<프롬프트>"
// 실행 후 임시파일(마지막 메시지)을 읽는다.
// JSON 스키마 강제: codex의 --output-schema는 JSON Schema 파일이 필요한데
// zod v3에는 내장 변환이 없어 프롬프트 강제 + extractJson + zod 파싱(+베이스의
// 재시도 패턴)으로 대신한다.
// env: CODEX_HOME이 설정돼 있으면 그대로 전달(격리 인증), CODEX_BIN으로 바이너리 오버라이드.
// usage: codex exec는 토큰 사용량을 주지 않으므로 호출 횟수만 집계.
// ─────────────────────────────────────────────────────────────

/** codex exec 명령 인자 조립 (유닛 검증용으로 분리).
 *
 * 프롬프트는 argv 위치 인자가 아니라 stdin으로 전달한다 — 위치 인자로 큰 프롬프트를
 * 주면서 stdin(execFile의 non-TTY 파이프)이 열려 있으면 codex가 stdin 입력을 계속
 * 기다리다 타임아웃돼 출력 파일을 만들지 못한다("대용량 실패"의 실제 원인).
 * 위치 인자를 "-"로 두면 codex가 stdin에서 프롬프트를 읽는다. (프롬프트는 caller가 stdin으로 씀) */
export function buildCodexExecArgs(outFile: string, model?: string, attachPath?: string): string[] {
  return [
    "exec",
    "--skip-git-repo-check",
    // 재현성: 사용자·프로젝트 AGENTS.md를 무시한다 (project_doc_max_bytes=0).
    // 이게 없으면 노트북마다 다른 AGENTS.md가 산출물에 개입해 결과가 달라진다.
    "-c",
    "project_doc_max_bytes=0",
    "-o",
    outFile,
    ...(model ? ["--model", model] : []),
    // vision: codex도 이미지·PDF 첨부를 지원한다(-i). 스캔 PDF까지 읽는 것을 실측 확인.
    ...(attachPath ? ["-i", attachPath] : []),
    "-", // 프롬프트를 stdin에서 읽는다
  ];
}

class CodexCliEngine extends RetryingCliEngine {
  readonly name = "codex-cli";
  private readonly model?: string;

  constructor(concurrency: number, model?: string, retryDelayMs?: number) {
    super(concurrency, retryDelayMs);
    this.model = model;
  }

  protected callOnce<T>(req: LlmRequest<T>): Promise<T> {
    const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aone-codex-")), "last-message.txt");
    return new Promise<T>((resolve, reject) => {
      const child = execFile(
        process.env.CODEX_BIN ?? "codex",
        // 슬라이드 요약의 PDF 첨부(pdfPath)와 이미지 입력(imagePath) 모두 codex는 -i로 받는다.
        buildCodexExecArgs(outFile, this.model, req.pdfPath ?? req.imagePath),
        // CODEX_HOME 등은 process.env를 그대로 전달
        { encoding: "utf8", timeout: 600_000, maxBuffer: 32 * 1024 * 1024, env: process.env }, // 10분 — 긴 조립 대응
        (err, _stdout, stderr) => {
          try {
            if (err) {
              throw new Error(
                `codex-cli 실행 실패: ${err.message.slice(0, 200)} ${String(stderr).slice(0, 200)} — GPT 연결 필요 (설정에서 연결)`,
              );
            }
            this.usage.calls++;
            if (!fs.existsSync(outFile)) {
              throw new Error("codex-cli: 출력 파일이 생성되지 않음 — GPT 연결 필요 (설정에서 연결)");
            }
            const lastMessage = fs.readFileSync(outFile, "utf8");
            resolve(req.schema.parse(extractJson(lastMessage)));
          } catch (e) {
            reject(e);
          } finally {
            fs.rmSync(path.dirname(outFile), { recursive: true, force: true });
          }
        },
      );
      // 프롬프트는 stdin으로 (위치 인자 "-"가 stdin을 프롬프트로 읽게 한다).
      child.stdin!.write(req.prompt);
      child.stdin!.end();
    });
  }
}

// ─────────────────────────────────────────────────────────────
// gemini-api 백엔드 (부록 A1)
// 활성화: 환경변수 GEMINI_API_KEY 설정 후 --engine gemini-api
// 재시도·extractJson·zod 파싱·동시성은 RetryingCliEngine 베이스와 동일 패턴.
// vision: req.imagePath가 있으면 inline_data(base64)로 첨부.
// ─────────────────────────────────────────────────────────────

/** 기본 모델 gemini-flash-latest(항상 최신 flash 별칭), env GEMINI_MODEL → --model 순으로 오버라이드 */
export function geminiModelName(model?: string): string {
  return model ?? process.env.GEMINI_MODEL ?? "gemini-flash-latest";
}

export interface GeminiInlineImage {
  mimeType: string;
  /** base64 인코딩된 이미지 바이트 */
  data: string;
}

/** generateContent 요청 본문 조립 — 키 없이 순수 함수 (유닛 테스트 대상) */
export function buildGeminiRequestBody(
  prompt: string,
  image?: GeminiInlineImage,
  pdf?: { data: string },
): unknown {
  const parts: unknown[] = [];
  if (image) parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
  if (pdf) parts.push({ inline_data: { mime_type: "application/pdf", data: pdf.data } });
  parts.push({ text: prompt });
  return {
    contents: [{ parts }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };
}

const GEMINI_IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

class GeminiApiEngine extends RetryingCliEngine {
  readonly name = "gemini-api";
  private readonly model: string;

  constructor(concurrency: number, model?: string, retryDelayMs?: number) {
    super(concurrency, retryDelayMs);
    this.model = geminiModelName(model);
  }

  protected async callOnce<T>(req: LlmRequest<T>): Promise<T> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("gemini-api 백엔드: GEMINI_API_KEY 환경변수가 필요합니다");

    let image: GeminiInlineImage | undefined;
    if (req.imagePath) {
      const ext = path.extname(req.imagePath).slice(1).toLowerCase();
      const mimeType = GEMINI_IMAGE_MIME[ext];
      if (!mimeType) throw new Error(`gemini-api: 지원하지 않는 이미지 형식 .${ext} (png/jpg/jpeg만)`);
      image = { mimeType, data: fs.readFileSync(req.imagePath).toString("base64") };
    }
    // B안: PDF 원본 첨부 (그림·도식 포함). 텍스트 추출로는 못 잡는 다이어그램을 모델이 직접 본다.
    let pdf: { data: string } | undefined;
    if (req.pdfPath) {
      pdf = { data: fs.readFileSync(req.pdfPath).toString("base64") };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      // 키는 URL이 아닌 헤더로 (로그·에러 메시지에 키가 남지 않게)
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(buildGeminiRequestBody(req.prompt, image, pdf)),
      signal: AbortSignal.timeout(180_000),
    });
    const bodyText = await res.text();
    // 429/529 등은 메시지의 상태코드로 RATE_LIMIT_RE에 걸려 베이스가 동시성을 낮춘다.
    if (!res.ok) throw new Error(`gemini-api HTTP ${res.status}: ${bodyText.slice(0, 300)}`);

    const data = JSON.parse(bodyText) as GeminiResponse;
    this.usage.calls++;
    this.usage.inputTokens += data.usageMetadata?.promptTokenCount ?? 0;
    this.usage.outputTokens += data.usageMetadata?.candidatesTokenCount ?? 0;
    this.usage.cacheReadTokens += data.usageMetadata?.cachedContentTokenCount ?? 0;

    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (!text.trim()) throw new Error(`gemini-api: 응답 텍스트가 비어 있음 (${bodyText.slice(0, 200)})`);
    return req.schema.parse(extractJson(text));
  }
}

// ─────────────────────────────────────────────────────────────
// 시간표 인식 출력 계약 (부록 A2) — recognize-timetable이 stdout 마지막 줄로 내보내는 JSON
// ─────────────────────────────────────────────────────────────

/** "H:MM"/"HH:MM" 허용 → "HH:MM"으로 zero-pad */
const HhMmSchema = z
  .string()
  .regex(/^\d{1,2}:\d{2}$/)
  .transform((s) => {
    const [h, m] = s.split(":");
    return `${h.padStart(2, "0")}:${m}`;
  });

export const TimetableOutput = z.object({
  lectures: z.array(
    z.object({
      subject: z.string().min(1),
      weekday: z.enum(["월", "화", "수", "목", "금"]),
      start: HhMmSchema,
      end: HhMmSchema,
      room: z.string().default(""),
    }),
  ),
  untimed: z.array(z.string()).default([]),
});
export type TimetableOutputT = z.infer<typeof TimetableOutput>;

/** 모델 응답 텍스트에서 JSON 본문 추출 (코드펜스/전후 잡음 허용) */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error("LLM 응답에서 JSON을 찾지 못함");
  const raw = body.slice(start).trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    // 일부 모델(예: Sonnet)은 markdown 문자열 값에 개행·탭 등 제어문자를 이스케이프
    // 없이 넣어 JSON.parse가 실패한다. 문자열 리터럴 안의 제어문자만 이스케이프해 복구.
    const repaired = escapeControlCharsInStrings(raw);
    if (repaired !== raw) return JSON.parse(repaired);
    throw e;
  }
}

/** JSON 문자열 리터럴 내부의 이스케이프되지 않은 제어문자(개행·탭 등)를 이스케이프한다.
 * 문자열 밖의 구조적 공백(개행 등)은 그대로 둔다. */
function escapeControlCharsInStrings(json: string): string {
  let out = "";
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    const code = json.charCodeAt(i);
    if (inStr) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === "\\") {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inStr = false;
      } else if (code < 0x20) {
        // 이스케이프 안 된 제어문자 → \uXXXX 로
        if (ch === "\n") out += "\\n";
        else if (ch === "\t") out += "\\t";
        else if (ch === "\r") out += "\\r";
        else out += "\\u" + code.toString(16).padStart(4, "0");
      } else {
        out += ch;
      }
    } else {
      out += ch;
      if (ch === '"') inStr = true;
    }
  }
  return out;
}

/** 실 LLM 백엔드용 프롬프트 조립 헬퍼 */
export function buildPrompt(task: LlmTask, instructions: string, payload: unknown, schemaHint: string): string {
  return [
    `[태스크: ${task}]`,
    instructions,
    "",
    "다음 JSON 스키마 형태로만 응답하라 (설명 텍스트 금지):",
    schemaHint,
    "",
    "입력 데이터:",
    JSON.stringify(payload, null, 1),
  ].join("\n");
}
