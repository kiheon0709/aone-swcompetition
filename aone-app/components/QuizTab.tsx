"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  PencilLine,
  RotateCcw,
  Timer,
  X,
} from "lucide-react";

export interface QuestionSource {
  type: string;
  /** 근거가 나온 수업(unit) 이름 — 표시 문자열 그대로 */
  unit: string;
  locator: string;
  quote: string;
}

export interface Question {
  id: string;
  q: string;
  a: string;
  difficulty: string;
  reasoning: string;
  sources: QuestionSource[];
}

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: "쉬움",
  medium: "보통",
  hard: "어려움",
};

/* ══════════════════════════════════════════════════════════════
 * 문항 파싱 — 데이터에 선택지 필드가 없어 문제 텍스트에서 뽑아낸다
 * ══════════════════════════════════════════════════════════════ */

export type QuestionKind = "choice" | "ox" | "open";

export interface Choice {
  mark: string;
  text: string;
}

export interface ParsedQuestion {
  kind: QuestionKind;
  /** 선택지를 제거한 문제 지문 */
  stem: string;
  /** 객관식일 때만 채워진다 */
  choices: Choice[];
  /** 객관식: "④" / OX: "O" | "X" / open: null */
  answerKey: string | null;
  /** 모범답안에서 정답 기호를 뗀 해설 부분 (없으면 원문) */
  explanation: string;
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
const CIRCLED_RE = /[①-⑩]/g;

/** "정답: ③ — 설명" → "③" */
const leadingCircled = (a: string): string | null =>
  /^\s*(?:정답\s*[:：]?\s*)?([①-⑩])/.exec(a)?.[1] ?? null;

/** "정답: 2) 설명" / "2. 설명" → "2" */
const leadingNumeric = (a: string): string | null =>
  /^\s*(?:정답\s*[:：]?\s*)?(\d)\s*[).]/.exec(a)?.[1] ?? null;

/** 모범답안에서 선두 정답 기호와 이어지는 구분자를 떼어낸다 */
const stripAnswerKey = (a: string): string => {
  const m = /^\s*(?:정답\s*[:：]?\s*)?(?:[①-⑩]|\d\s*[).])\s*[—–\-.。,·:]*\s*/.exec(a);
  const rest = m ? a.slice(m[0].length).trim() : "";
  return rest || a.trim();
};

/** 마커 위치 목록으로 지문·선택지를 자른다 */
const sliceChoices = (
  q: string,
  hits: { mark: string; start: number; end: number }[]
): { stem: string; choices: Choice[] } => {
  const stem = q.slice(0, hits[0].start).trim();
  const choices = hits.map((h, i) => ({
    mark: h.mark,
    text: q
      .slice(h.end, i + 1 < hits.length ? hits[i + 1].start : q.length)
      .trim()
      .replace(/[.,;]$/, ""),
  }));
  return { stem, choices };
};

/** ①②③④⑤ 마커 추출 */
const circledHits = (q: string) => {
  const hits: { mark: string; start: number; end: number }[] = [];
  for (const m of q.matchAll(CIRCLED_RE)) {
    hits.push({ mark: m[0], start: m.index, end: m.index + m[0].length });
  }
  return hits;
};

/**
 * "1) 2) 3)" 마커 추출.
 * "(1) … (2) …"는 계산형 문항의 소문항 번호라 선택지가 아니다 — 여는 괄호가 붙으면 제외한다.
 */
const numericHits = (q: string) => {
  const hits: { mark: string; start: number; end: number }[] = [];
  for (const m of q.matchAll(/(?:^|[\s\n])(\d)\s*\)/g)) {
    const at = m.index + m[0].indexOf(m[1]);
    if (at > 0 && q[at - 1] === "(") continue;
    hits.push({ mark: m[1], start: at, end: m.index + m[0].length });
  }
  return hits;
};

/**
 * 문항 유형 판정.
 *
 * 객관식 성립 조건 (전부 만족해야 한다):
 *   1. 마커가 ①부터 순서대로 2개 이상
 *   2. 모든 선택지에 본문 텍스트가 있음
 *   3. 모범답안 선두 기호가 선택지 마커 중 하나와 일치
 * → 3번 조건이 "① 컴퓨터융합학부 — 100대, ② 인공지능학과 — 50대" 같은
 *   계산형 문항의 소문항 열거를 객관식으로 오인하는 것을 막아준다.
 */
export function parseQuestion(q: string, a: string): ParsedQuestion {
  const raw = q.trim();

  // ── 객관식 ──
  for (const [hits, key] of [
    [circledHits(raw), leadingCircled(a)],
    [numericHits(raw), leadingNumeric(a)],
  ] as const) {
    if (hits.length < 2 || !key) continue;
    const sequential = hits.every(
      (h, i) => h.mark === (/\d/.test(h.mark) ? String(i + 1) : CIRCLED[i])
    );
    if (!sequential) continue;
    const { stem, choices } = sliceChoices(raw, hits);
    if (!choices.every((c) => c.text.length > 0)) continue;
    if (!choices.some((c) => c.mark === key)) continue;
    return {
      kind: "choice",
      stem: stem || raw,
      choices,
      answerKey: key,
      explanation: stripAnswerKey(a),
    };
  }

  // ── OX ──
  const oxAnswer = /^\s*[([]?\s*(O|X|Ｏ|Ｘ|참|거짓)\b/i.exec(a.trim());
  const oxQuestion = /(옳은가|맞는가|참인가|참\/거짓|O\/X|OX 문제)/.test(raw);
  if (oxAnswer || oxQuestion) {
    const token = oxAnswer?.[1];
    const key =
      token === undefined
        ? null
        : /^(O|Ｏ|참)$/i.test(token)
          ? "O"
          : /^(X|Ｘ|거짓)$/i.test(token)
            ? "X"
            : null;
    if (key) {
      return {
        kind: "ox",
        stem: raw,
        choices: [],
        answerKey: key,
        explanation: a.replace(/^\s*[([]?\s*(O|X|Ｏ|Ｘ|참|거짓)\s*[)\]]?\s*[—–\-.。,·:]*\s*/i, "").trim() || a.trim(),
      };
    }
  }

  // ── 서술·계산형 ──
  return {
    kind: "open",
    stem: raw,
    choices: [],
    answerKey: null,
    explanation: a.trim(),
  };
}

/* ══════════════════════════════════════════════════════════════
 * 저장 상태
 * ══════════════════════════════════════════════════════════════ */

/** 채점 결과 — 객관식·OX는 자동, 서술형은 사용자가 직접 고른다 */
type Verdict = "correct" | "wrong";

interface QuizState {
  /** 서술형 답안 */
  answers: Record<string, string>;
  /** 객관식·OX에서 고른 선택지 기호 */
  picks: Record<string, string>;
  /** 채점 결과 */
  verdicts: Record<string, Verdict>;
}

const emptyState = (): QuizState => ({ answers: {}, picks: {}, verdicts: {} });

const storageKey = (folderKey: string) => `aone.quiz.v1.${folderKey}`;

const loadQuizState = (folderKey: string): QuizState => {
  try {
    const raw = localStorage.getItem(storageKey(folderKey));
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<QuizState>;
    return {
      answers: parsed.answers ?? {},
      picks: parsed.picks ?? {},
      verdicts: parsed.verdicts ?? {},
    };
  } catch {
    return emptyState();
  }
};

const saveQuizState = (folderKey: string, state: QuizState) => {
  try {
    localStorage.setItem(storageKey(folderKey), JSON.stringify(state));
  } catch {
    // localStorage 사용 불가 — 저장 생략 (화면 동작에는 영향 없음)
  }
};

const formatClock = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/* ══════════════════════════════════════════════════════════════
 * 표시 조각
 * ══════════════════════════════════════════════════════════════ */

function SourceList({ sources }: { sources: QuestionSource[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  return (
    <div>
      <button
        data-testid="quiz-sources-toggle"
        onClick={() => setOpen((v) => !v)}
        className="press-scale flex items-center gap-1 rounded-lg text-xs font-semibold text-gray-500 transition-colors duration-200 hover:text-gray-900"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
        근거 출처 {sources.length}건
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5" data-testid="quiz-sources">
          {sources.map((s, i) => (
            <li
              key={i}
              className="rounded-lg bg-black/[0.03] px-3 py-2 text-xs leading-relaxed text-gray-600"
            >
              <span className="font-mono text-primary/80">
                [{s.type} · {s.unit} · {s.locator}]
              </span>{" "}
              &ldquo;{s.quote}&rdquo;
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 채점 후 펼치는 해설 — 해설 · 왜 나올까 · 근거 출처 */
function Explanation({
  question,
  parsed,
}: {
  question: Question;
  parsed: ParsedQuestion;
}) {
  return (
    <div
      className="mt-5 space-y-4 rounded-2xl bg-black/[0.025] p-5"
      data-testid="quiz-explanation"
    >
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          해설
        </p>
        <p className="text-[15px] leading-relaxed text-gray-800">
          {parsed.explanation}
        </p>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
          왜 나올까
        </p>
        <p className="text-sm leading-relaxed text-gray-600">
          {question.reasoning}
        </p>
      </div>
      <SourceList sources={question.sources} />
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return verdict === "correct" ? (
    <span
      data-testid="quiz-verdict-badge"
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-700"
    >
      <Check className="h-3.5 w-3.5" aria-hidden />
      정답
    </span>
  ) : (
    <span
      data-testid="quiz-verdict-badge"
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-700"
    >
      <X className="h-3.5 w-3.5" aria-hidden />
      오답
    </span>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  return (
    <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
      {DIFFICULTY_LABELS[difficulty] ?? difficulty}
    </span>
  );
}

function KindBadge({ kind }: { kind: QuestionKind }) {
  const label =
    kind === "choice" ? "객관식" : kind === "ox" ? "OX" : "서술·계산형";
  return (
    <span
      data-testid={`quiz-kind-${kind}`}
      className="shrink-0 rounded-full bg-black/[0.05] px-2.5 py-1 text-xs font-medium text-gray-500"
    >
      {label}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════
 * 문항 카드 — 유형별 풀이 UI. 연습·모의고사 모드가 함께 쓴다
 * ══════════════════════════════════════════════════════════════ */

const OX_CHOICES: Choice[] = [
  { mark: "O", text: "맞다" },
  { mark: "X", text: "틀리다" },
];

/**
 * 배지에 찍을 글자.
 * ①을 원형 배지 안에 그대로 넣으면 원 안의 원이 되어 읽히지 않는다 — 숫자로 바꾼다.
 */
const badgeLabel = (mark: string) => {
  const at = CIRCLED.indexOf(mark);
  return at >= 0 ? String(at + 1) : mark;
};

function QuestionCard({
  question,
  parsed,
  index,
  answer,
  pick,
  verdict,
  onAnswer,
  onPick,
  onVerdict,
  onReset,
  /** 모의고사 결과 화면 — 항상 해설을 펼치고 입력은 잠근다 */
  review = false,
}: {
  question: Question;
  parsed: ParsedQuestion;
  index: number;
  answer: string;
  pick: string | undefined;
  verdict: Verdict | undefined;
  onAnswer: (value: string) => void;
  onPick: (mark: string) => void;
  onVerdict: (v: Verdict) => void;
  onReset: () => void;
  review?: boolean;
}) {
  // 서술형 — "확인"을 눌러야 모범답안을 펼친다
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setRevealed(verdict !== undefined);
  }, [question.id, verdict]);

  const graded = verdict !== undefined;
  const border =
    graded && verdict === "correct"
      ? "!border-emerald-500/50 shadow-[0_2px_16px_-4px_rgba(16,185,129,0.25)]"
      : graded
        ? "!border-red-500/50 shadow-[0_2px_16px_-4px_rgba(239,68,68,0.25)]"
        : "";

  const selectable = parsed.kind === "choice" || parsed.kind === "ox";
  const choices = parsed.kind === "ox" ? OX_CHOICES : parsed.choices;

  return (
    <article
      data-testid="quiz-card"
      data-kind={parsed.kind}
      data-verdict={verdict ?? "none"}
      className={`glass-card rounded-2xl p-7 ${border}`}
    >
      <div className="mb-4 flex items-center gap-2">
        <span className="font-mono text-xs font-semibold text-gray-400">
          Q{index + 1}
        </span>
        <KindBadge kind={parsed.kind} />
        <DifficultyBadge difficulty={question.difficulty} />
        <span className="ml-auto">{graded && <VerdictBadge verdict={verdict} />}</span>
      </div>

      <p
        data-testid="quiz-stem"
        className="whitespace-pre-wrap text-[17px] font-medium leading-relaxed text-gray-900"
      >
        {parsed.stem}
      </p>

      {/* ── 객관식 · OX — 클릭해서 푼다 ── */}
      {selectable && (
        <div
          className={
            parsed.kind === "ox"
              ? "mt-6 grid grid-cols-2 gap-4"
              : "mt-6 space-y-2.5"
          }
          data-testid="quiz-choices"
        >
          {choices.map((c) => {
            const picked = pick === c.mark;
            const isAnswer = parsed.answerKey === c.mark;
            const showAnswer = graded && isAnswer;
            const showWrongPick = graded && picked && !isAnswer;

            const tone = showAnswer
              ? "border-emerald-500/60 bg-emerald-500/10"
              : showWrongPick
                ? "border-red-500/60 bg-red-500/10"
                : picked
                  ? "border-primary/60 bg-primary/[0.07] shadow-glow"
                  : graded
                    ? "border-black/[0.06] bg-white/60 opacity-60"
                    : "border-black/[0.08] bg-white/70 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_8px_20px_-10px_rgba(10,132,255,0.35)]";

            const badgeTone = showAnswer
              ? "bg-emerald-500 text-white"
              : showWrongPick
                ? "bg-red-500 text-white"
                : picked
                  ? "bg-primary text-white"
                  : "bg-black/[0.05] text-gray-500";

            return (
              <button
                key={c.mark}
                data-testid="quiz-choice"
                data-mark={c.mark}
                data-picked={picked ? "true" : "false"}
                disabled={graded}
                onClick={() => onPick(c.mark)}
                className={`press-scale flex w-full items-center gap-3.5 rounded-xl border px-4 text-left transition-all duration-200 disabled:cursor-default ${tone} ${
                  parsed.kind === "ox"
                    ? "flex-col justify-center gap-2 py-7"
                    : "py-3.5"
                }`}
              >
                <span
                  className={`flex shrink-0 items-center justify-center rounded-full font-semibold transition-colors duration-200 ${badgeTone} ${
                    parsed.kind === "ox"
                      ? "h-16 w-16 text-3xl"
                      : "h-8 w-8 text-sm"
                  }`}
                >
                  {badgeLabel(c.mark)}
                </span>
                <span
                  className={
                    parsed.kind === "ox"
                      ? "text-sm font-medium text-gray-700"
                      : "flex-1 text-[15px] leading-relaxed text-gray-800"
                  }
                >
                  {c.text}
                </span>
                {showAnswer && (
                  <Check
                    className="h-5 w-5 shrink-0 text-emerald-600"
                    aria-hidden
                  />
                )}
                {showWrongPick && (
                  <X className="h-5 w-5 shrink-0 text-red-600" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ── 서술·계산형 — 입력 + 모범답안 대조 + 자기채점 ── */}
      {parsed.kind === "open" && (
        <div className="mt-6">
          <label
            className="mb-2 block text-xs font-semibold text-gray-700"
            htmlFor={`ans-${question.id}`}
          >
            내 답안
          </label>
          {graded || review ? (
            <p className="whitespace-pre-wrap rounded-xl bg-black/[0.03] px-4 py-3 text-[15px] leading-relaxed text-gray-700">
              {answer.trim() ? answer : "(빈 답안)"}
            </p>
          ) : (
            <textarea
              id={`ans-${question.id}`}
              data-testid="quiz-answer-input"
              rows={4}
              value={answer}
              onChange={(e) => onAnswer(e.target.value)}
              placeholder="답을 자유롭게 적어보세요. 확인을 누르면 모범답안과 대조합니다."
              className="w-full resize-y rounded-xl border border-black/[0.08] bg-white/70 px-4 py-3 text-[15px] leading-relaxed text-gray-800 outline-none transition-colors duration-200 placeholder:text-gray-300 focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
          )}
        </div>
      )}

      {/* ── 행동 버튼 ── */}
      {!review && (
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          {selectable && !graded && (
            <>
              <button
                data-testid="quiz-check"
                disabled={pick === undefined}
                onClick={() =>
                  onVerdict(pick === parsed.answerKey ? "correct" : "wrong")
                }
                className="press-scale rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                정답 확인
              </button>
              {pick === undefined && (
                <span className="text-xs text-gray-400">
                  선택지를 고르면 채점할 수 있어요.
                </span>
              )}
            </>
          )}

          {parsed.kind === "open" && !revealed && (
            <>
              <button
                data-testid="quiz-check"
                disabled={answer.trim() === ""}
                onClick={() => setRevealed(true)}
                className="press-scale rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                모범답안 확인
              </button>
              {answer.trim() === "" && (
                <span className="text-xs text-gray-400">
                  답을 입력하면 채점할 수 있어요.
                </span>
              )}
            </>
          )}

          {parsed.kind === "open" && revealed && !graded && (
            <>
              <span className="mr-1 text-xs font-semibold text-gray-700">
                모범답안과 대조해 채점하세요
              </span>
              <button
                data-testid="quiz-verdict-correct"
                onClick={() => onVerdict("correct")}
                className="press-scale flex items-center gap-1.5 rounded-xl bg-emerald-500/12 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition-colors duration-200 hover:bg-emerald-500/20"
              >
                <Check className="h-4 w-4" aria-hidden />내가 맞았다
              </button>
              <button
                data-testid="quiz-verdict-wrong"
                onClick={() => onVerdict("wrong")}
                className="press-scale flex items-center gap-1.5 rounded-xl bg-red-500/12 px-4 py-2.5 text-sm font-semibold text-red-700 transition-colors duration-200 hover:bg-red-500/20"
              >
                <X className="h-4 w-4" aria-hidden />내가 틀렸다
              </button>
            </>
          )}

          {graded && (
            <button
              data-testid="quiz-retry"
              onClick={onReset}
              className="press-scale flex items-center gap-1.5 rounded-xl bg-black/[0.04] px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors duration-200 hover:bg-black/[0.07]"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              다시 풀기
            </button>
          )}
        </div>
      )}

      {/* ── 해설 — 채점 후(또는 서술형 모범답안 확인 후) ── */}
      {(graded || (parsed.kind === "open" && revealed)) && (
        <Explanation question={question} parsed={parsed} />
      )}
    </article>
  );
}

/* ══════════════════════════════════════════════════════════════
 * QuizTab
 * ══════════════════════════════════════════════════════════════ */

export interface QuizTabProps {
  questions: Question[];
  /** 현재 수업 폴더 키 ("subject/unit") — 답안 저장 키로 쓴다 */
  folderKey: string;
  /** 배너·자료 패널에서 열어달라고 넘어온 문항 (연습 모드에서 그 문항으로 이동) */
  focusQuestionId: string | null;
  onFocusHandled: () => void;
  /** 문항이 없을 때 보여줄 빈 상태 */
  emptyState: React.ReactNode;
  loading: boolean;
}

export default function QuizTab({
  questions,
  folderKey,
  focusQuestionId,
  onFocusHandled,
  emptyState: emptyStateNode,
  loading,
}: QuizTabProps) {
  const [mode, setMode] = useState<"practice" | "exam">("practice");
  const [state, setState] = useState<QuizState>(emptyState);
  const [hydrated, setHydrated] = useState(false);

  // 연습 모드 — 한 문항씩 넘겨 본다
  const [index, setIndex] = useState(0);

  // 모의고사 모드
  const [examStarted, setExamStarted] = useState(false);
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [examIndex, setExamIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [wrongOnly, setWrongOnly] = useState(false);

  const parsed = useMemo(
    () => new Map(questions.map((q) => [q.id, parseQuestion(q.q, q.a)])),
    [questions]
  );

  // 저장된 답안 복원 (새로고침 견딤)
  useEffect(() => {
    setState(loadQuizState(folderKey));
    setHydrated(true);
    setIndex(0);
    setExamStarted(false);
    setExamSubmitted(false);
    setExamIndex(0);
    setElapsed(0);
    setWrongOnly(false);
  }, [folderKey]);

  useEffect(() => {
    if (hydrated) saveQuizState(folderKey, state);
  }, [hydrated, folderKey, state]);

  // 배너·자료 패널에서 특정 문항을 지목하면 연습 모드에서 그 문항으로 이동
  useEffect(() => {
    if (!focusQuestionId) return;
    const at = questions.findIndex((q) => q.id === focusQuestionId);
    if (at >= 0) {
      setMode("practice");
      setIndex(at);
    }
    onFocusHandled();
  }, [focusQuestionId, questions, onFocusHandled]);

  // 모의고사 타이머
  useEffect(() => {
    if (!examStarted || examSubmitted) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [examStarted, examSubmitted]);

  const setAnswer = useCallback((id: string, value: string) => {
    setState((s) => ({ ...s, answers: { ...s.answers, [id]: value } }));
  }, []);

  const setPick = useCallback((id: string, mark: string) => {
    setState((s) => ({ ...s, picks: { ...s.picks, [id]: mark } }));
  }, []);

  const setVerdict = useCallback((id: string, verdict: Verdict) => {
    setState((s) => ({ ...s, verdicts: { ...s.verdicts, [id]: verdict } }));
  }, []);

  const resetQuestion = useCallback((id: string) => {
    setState((s) => {
      const answers = { ...s.answers };
      const picks = { ...s.picks };
      const verdicts = { ...s.verdicts };
      delete answers[id];
      delete picks[id];
      delete verdicts[id];
      return { answers, picks, verdicts };
    });
  }, []);

  const resetAll = useCallback(() => {
    setState(emptyState());
    setIndex(0);
    setExamStarted(false);
    setExamSubmitted(false);
    setExamIndex(0);
    setElapsed(0);
    setWrongOnly(false);
  }, []);

  const gradedCount = useMemo(
    () => questions.filter((q) => state.verdicts[q.id] !== undefined).length,
    [questions, state.verdicts]
  );
  const correctCount = useMemo(
    () => questions.filter((q) => state.verdicts[q.id] === "correct").length,
    [questions, state.verdicts]
  );
  const accuracy =
    gradedCount === 0 ? 0 : Math.round((correctCount / gradedCount) * 100);

  if (loading) {
    return <p className="text-sm text-gray-400">불러오는 중…</p>;
  }
  if (questions.length === 0) {
    return <>{emptyStateNode}</>;
  }

  const modeSwitch = (
    <div className="inline-flex rounded-xl bg-black/[0.04] p-1" role="tablist">
      {(
        [
          { id: "practice" as const, label: "연습 모드", icon: PencilLine },
          { id: "exam" as const, label: "모의고사 모드", icon: ClipboardCheck },
        ] satisfies { id: "practice" | "exam"; label: string; icon: typeof PencilLine }[]
      ).map((m) => {
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            data-testid={`quiz-mode-${m.id}`}
            onClick={() => setMode(m.id)}
            className={`press-scale flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
              mode === m.id
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {m.label}
          </button>
        );
      })}
    </div>
  );

  /** 진행 표시 (3/8) + 정답률 + 진행 바 */
  const progressBar = (current: number) => (
    <div className="mb-4" data-testid="quiz-progress">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-semibold text-gray-800">
          {current + 1}
          <span className="text-gray-400"> / {questions.length}</span>
        </span>
        <span className="text-xs text-gray-500" data-testid="quiz-stats">
          푼 문항 {gradedCount}/{questions.length} · 정답률 {accuracy}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${((current + 1) / questions.length) * 100}%` }}
        />
      </div>
    </div>
  );

  /** 이전 / 다음 내비게이션 */
  const nav = (
    current: number,
    move: (i: number) => void,
    submit?: React.ReactNode
  ) => (
    <div className="mt-5 flex items-center justify-between gap-3">
      <button
        data-testid="quiz-prev"
        disabled={current === 0}
        onClick={() => move(Math.max(0, current - 1))}
        className="press-scale flex items-center gap-1 rounded-xl bg-black/[0.04] px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors duration-200 hover:bg-black/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        이전
      </button>
      {submit ?? (
        <button
          data-testid="quiz-next"
          disabled={current === questions.length - 1}
          onClick={() => move(Math.min(questions.length - 1, current + 1))}
          className="press-scale flex items-center gap-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          다음
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );

  const cardFor = (q: Question, i: number, review = false) => (
    <QuestionCard
      key={q.id}
      question={q}
      parsed={parsed.get(q.id)!}
      index={i}
      answer={state.answers[q.id] ?? ""}
      pick={state.picks[q.id]}
      verdict={state.verdicts[q.id]}
      onAnswer={(v) => setAnswer(q.id, v)}
      onPick={(m) => setPick(q.id, m)}
      onVerdict={(v) => setVerdict(q.id, v)}
      onReset={() => resetQuestion(q.id)}
      review={review}
    />
  );

  // ══ 연습 모드 — 한 문항씩 큰 카드 ══
  if (mode === "practice") {
    const current = Math.min(index, questions.length - 1);
    const q = questions[current];
    return (
      <section data-testid="tab-questions">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {modeSwitch}
          {gradedCount > 0 && (
            <button
              data-testid="quiz-reset-all"
              onClick={resetAll}
              className="press-scale flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-900"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              전체 초기화
            </button>
          )}
        </div>

        {progressBar(current)}
        {cardFor(q, current)}
        {nav(current, setIndex)}

        {/* 문항 점퍼 — 정오 상태를 한눈에 */}
        <div className="mt-5 flex flex-wrap gap-1.5" data-testid="quiz-jumper">
          {questions.map((item, i) => {
            const v = state.verdicts[item.id];
            return (
              <button
                key={item.id}
                onClick={() => setIndex(i)}
                title={item.q.split("\n")[0]}
                className={`press-scale flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold transition-colors duration-200 ${
                  v === "correct"
                    ? "bg-emerald-500/15 text-emerald-700"
                    : v === "wrong"
                      ? "bg-red-500/15 text-red-700"
                      : "bg-black/[0.05] text-gray-400 hover:bg-black/[0.09]"
                } ${i === current ? "ring-2 ring-primary/60 ring-offset-1" : ""}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  // ══ 모의고사 모드 — 시작 화면 ══
  if (!examStarted) {
    return (
      <section data-testid="tab-questions">
        <div className="mb-4">{modeSwitch}</div>
        <div
          className="glass-card flex flex-col items-center rounded-2xl px-6 py-14 text-center"
          data-testid="quiz-exam-intro"
        >
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-black/5 bg-white/70 shadow-sm">
            <ClipboardCheck className="h-6 w-6 text-primary" aria-hidden />
          </div>
          <p className="text-sm font-semibold text-gray-800">
            모의고사 · 총 {questions.length}문항
          </p>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-gray-400">
            한 문항씩 순서대로 풀고 마지막에 제출하면 점수와 문항별 정오표를
            보여줍니다. 답안은 자동 저장되어 새로고침해도 남아 있습니다.
          </p>
          <button
            data-testid="quiz-exam-start"
            onClick={() => {
              setExamStarted(true);
              setExamSubmitted(false);
              setExamIndex(0);
              setElapsed(0);
            }}
            className="press-scale mt-7 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover"
          >
            시작하기
          </button>
        </div>
      </section>
    );
  }

  // ══ 모의고사 결과 ══
  if (examSubmitted) {
    const shown = wrongOnly
      ? questions.filter((q) => state.verdicts[q.id] !== "correct")
      : questions;
    return (
      <section data-testid="tab-questions">
        <div className="mb-4">{modeSwitch}</div>
        <div
          className="glass-card mb-5 rounded-2xl p-6"
          data-testid="quiz-exam-result"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            모의고사 결과
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
            <p className="text-3xl font-bold tracking-tight text-gray-900">
              {correctCount}
              <span className="text-xl text-gray-400"> / {questions.length}</span>
            </p>
            <p className="pb-1 text-sm text-gray-500">
              정답률{" "}
              {Math.round((correctCount / Math.max(questions.length, 1)) * 100)}% ·
              소요 시간 {formatClock(elapsed)}
            </p>
          </div>

          {/* 문항별 정오표 */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {questions.map((q, i) => {
              const v = state.verdicts[q.id];
              return (
                <span
                  key={q.id}
                  title={q.q.split("\n")[0]}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-semibold ${
                    v === "correct"
                      ? "bg-emerald-500/15 text-emerald-700"
                      : v === "wrong"
                        ? "bg-red-500/15 text-red-700"
                        : "bg-black/[0.05] text-gray-400"
                  }`}
                >
                  {i + 1}
                </span>
              );
            })}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              data-testid="quiz-wrong-only"
              onClick={() => setWrongOnly((v) => !v)}
              className={`press-scale rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors duration-200 ${
                wrongOnly
                  ? "bg-primary text-white shadow-glow"
                  : "bg-black/[0.04] text-gray-700 hover:bg-black/[0.07]"
              }`}
            >
              틀린 문제만 다시보기
            </button>
            <button
              onClick={resetAll}
              className="press-scale flex items-center gap-1.5 rounded-xl bg-black/[0.04] px-3.5 py-2 text-xs font-semibold text-gray-700 transition-colors duration-200 hover:bg-black/[0.07]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              다시 응시
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {shown.map((q) => cardFor(q, questions.indexOf(q), true))}
          {shown.length === 0 && (
            <div className="glass-card rounded-2xl p-8 text-center text-sm text-gray-400">
              틀린 문제가 없습니다.
            </div>
          )}
        </div>
      </section>
    );
  }

  // ══ 모의고사 응시 중 — 연습 모드와 같은 클릭 UI ══
  const current = Math.min(examIndex, questions.length - 1);
  const q = questions[current];
  const last = current === questions.length - 1;

  return (
    <section data-testid="tab-questions">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {modeSwitch}
        <span className="flex items-center gap-1.5 rounded-full bg-black/[0.04] px-3 py-1.5 text-xs font-semibold text-gray-600">
          <Timer className="h-3.5 w-3.5 text-primary" aria-hidden />
          {formatClock(elapsed)}
        </span>
      </div>

      {progressBar(current)}
      {cardFor(q, current)}

      {nav(
        current,
        setExamIndex,
        last ? (
          <button
            data-testid="quiz-exam-submit"
            onClick={() => {
              // 미채점 문항은 오답으로 확정
              setState((s) => {
                const verdicts = { ...s.verdicts };
                for (const item of questions) {
                  if (verdicts[item.id] === undefined) verdicts[item.id] = "wrong";
                }
                return { ...s, verdicts };
              });
              setExamSubmitted(true);
            }}
            className="press-scale rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover"
          >
            제출하기
          </button>
        ) : undefined
      )}
    </section>
  );
}
