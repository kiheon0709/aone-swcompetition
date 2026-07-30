"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { marked } from "marked";
import NoteCards from "./NoteCards";
// 연습 모드(퀴즈 탭)와 같은 답 입력칸·출처 목록을 쓴다 (FIX 5)
import { AnswerInput, SourceList } from "./QuizTab";
import { parseNoteCards } from "@/lib/note-cards";
import { parseConceptSource } from "@/lib/transcript";
import {
  AlertTriangle,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  Download,
  FileText,
  GraduationCap,
  Lightbulb,
  ListChecks,
  Map as MapIcon,
  RotateCcw,
  Route,
  Sparkles,
  Timer,
  X,
} from "lucide-react";
import { dday, ddayLabel, formatDateK } from "@/components/home/homeData";
import {
  composeGuideStatus,
  getActiveEngine,
  isTauriRuntime,
  runComposeGuide,
} from "@/lib/engines";
import { loadSnapshot, saveTextFile } from "@/lib/fs-bridge";
import DesktopOnlyModal from "@/components/DesktopOnlyModal";
import { slugOf, type ManifestSubject } from "@/lib/manifest";

// ── 스냅샷 타입 (page.tsx와 동일 형태 — 이 화면에서 필요한 필드만) ──
interface ConceptHistory {
  unitOrder: number;
  /** 등장 수업(unit) 이름 — 구버전 데이터엔 없을 수 있어 옵션 */
  unit?: string;
  examSignal: number;
}

interface Concept {
  id: string;
  name: string;
  importance: number;
  examSignal: number;
  history: ConceptHistory[];
}

interface QuestionSource {
  type: string;
  unit: string;
  locator: string;
  quote: string;
}

interface Question {
  id: string;
  q: string;
  a: string;
  difficulty: string;
  reasoning: string;
  sources: QuestionSource[];
}

interface Snapshot {
  subject: string;
  unit: string;
  unitOrder: number;
  concepts: Concept[];
  questions: Question[];
  note?: { markdown: string };
}

/** 학습 가이드 본문 — 파이프라인이 구조화해서 넘긴다 (마크다운 파싱 없음) */
interface GuideDoc {
  /** 개념을 보기 전에 읽는 "숲" */
  overview: string;
  concepts: {
    name: string;
    body: string;
    why: string;
    /** 근거 위치 ("5주차 #L19"). 없으면 "" */
    source: string;
    importance: number;
    examSignal: number;
    examAlert: boolean;
  }[];
  pastExamTopics: { topic: string; detail: string; years: number[] }[];
  studyOrder: { name: string; reason: string; prereqs: string[] }[];
}

/** compose-guide 산출물 스냅샷 (pipeline GuideSnapshotSchema와 동일) */
interface GuideSnapshot {
  subject: string;
  /** "전체" 또는 "3주차, 4주차" 식 범위 문자열 */
  scope: string;
  units: string[];
  generatedAt: string;
  /** 개념 수 */
  concepts: number;
  /** 기출 문항 수 */
  pastExams: number;
  guide: GuideDoc;
}

/**
 * 로드한 스냅샷의 배열 필드를 정상화한다 — concepts·questions가 배열이 아니면
 * 빈 배열로 채워 하위 병합·필터 단계의 크래시를 막는다. 유효 객체가 아니면 null.
 */
const normalizeSnapshot = (data: unknown): Snapshot | null => {
  if (typeof data !== "object" || data === null) return null;
  const o = data as Partial<Snapshot>;
  return {
    subject: typeof o.subject === "string" ? o.subject : "",
    unit: typeof o.unit === "string" ? o.unit : "",
    unitOrder: typeof o.unitOrder === "number" ? o.unitOrder : 0,
    concepts: Array.isArray(o.concepts) ? o.concepts : [],
    questions: Array.isArray(o.questions) ? o.questions : [],
    note: o.note,
  };
};

/**
 * 가이드 스냅샷 판별 — guide.concepts가 배열이어야 화면을 그릴 수 있다.
 * 구조가 깨진 파일(구버전 markdown 형식 포함)은 여기서 걸러 "가이드 없음"으로 처리한다.
 */
const isGuideSnapshot = (g: unknown): g is GuideSnapshot => {
  if (typeof g !== "object" || g === null) return false;
  const doc = (g as GuideSnapshot).guide;
  return (
    typeof doc === "object" &&
    doc !== null &&
    Array.isArray(doc.concepts) &&
    Array.isArray(doc.studyOrder) &&
    Array.isArray(doc.pastExamTopics)
  );
};

/** 시험 과목의 unit 하나에 대해 로드한 스냅샷 */
interface LoadedSnapshot {
  unit: string;
  unitOrder: number;
  data: Snapshot;
}

/** 병합 개념 — 이름 하나에 최고 시험신호 + 등장 수업 */
export interface MergedConcept {
  name: string;
  examSignal: number;
  importance: number;
  /** 이 개념이 등장한 수업(unit) 이름 (unit_order 오름차순) */
  units: string[];
  /** 시험신호가 가장 높았던 수업 — 클릭 시 여기로 이동 */
  topUnit: string;
}

/** 모의고사 문항 — 어느 수업에서 왔는지 붙여둔다 */
interface MockQuestion extends Question {
  unit: string;
  unitOrder: number;
  /** 선별 점수 (시험신호 × 난이도) */
  score: number;
  /** 문항 문장·해설에서 매칭된 개념 이름 — 결과 요약의 복습 목록에 쓴다 (FIX 5) */
  concepts: string[];
}

export interface ExamInfo {
  id: string;
  subject: string;
  title: string;
  date: string;
}

const MOCK_KEY = "aone.mockexam.v1";
const MOCK_SIZE = 15;

// ── 시험 범위 (선택된 unit 이름 목록) — 시험 id별 localStorage 저장 ──
const SCOPE_KEY_PREFIX = "aone.examScope.v1.";

/** 저장된 범위 로드 — 없거나 깨졌으면 null(전체) */
const loadScope = (examId: string): string[] | null => {
  try {
    const raw = localStorage.getItem(SCOPE_KEY_PREFIX + examId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.normalize("NFC"));
  } catch {
    return null;
  }
};

/** 범위 저장 — null(전체)이면 키 제거 */
const saveScope = (examId: string, units: string[] | null): void => {
  try {
    if (units === null) localStorage.removeItem(SCOPE_KEY_PREFIX + examId);
    else localStorage.setItem(SCOPE_KEY_PREFIX + examId, JSON.stringify(units));
  } catch {
    // localStorage 사용 불가 시 세션 한정으로 유지
  }
};

/** 난이도 가중치 — 어려운 문제일수록 시험 대비 가치가 크다 */
const DIFFICULTY_WEIGHT: Record<string, number> = {
  hard: 30,
  medium: 15,
  easy: 0,
};

const DIFFICULTY_LABEL: Record<string, string> = {
  hard: "어려움",
  medium: "보통",
  easy: "쉬움",
};

type Segment = "guide" | "note" | "mock";

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "guide", label: "학습 가이드" },
  { id: "note", label: "학습노트" },
  { id: "mock", label: "모의고사" },
];

/** 자기채점 결과 — 문항 id → 맞음/틀림 */
type Grade = "correct" | "wrong";

interface MockState {
  /** 채점 결과 (제출 전에도 누적 저장) */
  grades: Record<string, Grade>;
  /** 문항별로 쓴 답 (FIX 5) — 화면을 옮겨도 남아야 하므로 함께 저장한다 */
  answers: Record<string, string>;
  /** 제출 완료 여부 */
  submitted: boolean;
  /** 소요 시간 (초) */
  elapsed: number;
}

const emptyMockState = (): MockState => ({
  grades: {},
  answers: {},
  submitted: false,
  elapsed: 0,
});

const loadMockState = (): MockState => {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (!raw) return emptyMockState();
    const parsed = JSON.parse(raw) as Partial<MockState>;
    return {
      grades:
        parsed.grades && typeof parsed.grades === "object" ? parsed.grades : {},
      // answers는 v1 이후에 추가됐다 — 옛 저장분에는 없으므로 빈 객체로 시작한다
      answers:
        parsed.answers && typeof parsed.answers === "object"
          ? parsed.answers
          : {},
      submitted: Boolean(parsed.submitted),
      elapsed: typeof parsed.elapsed === "number" ? parsed.elapsed : 0,
    };
  } catch {
    return emptyMockState();
  }
};

const saveMockState = (state: MockState): void => {
  try {
    localStorage.setItem(MOCK_KEY, JSON.stringify(state));
  } catch {
    // localStorage 사용 불가 시 세션 한정으로 유지
  }
};

const fmtElapsed = (sec: number): string =>
  `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

/**
 * 학기 전체 개념 병합 — 같은 이름은 최대 examSignal을 채택하고
 * 등장 수업(unit)을 모두 모은다. (스냅샷의 concepts는 누적본이라 history를 함께 본다)
 */
export const mergeConcepts = (snapshots: LoadedSnapshot[]): MergedConcept[] => {
  interface Acc {
    name: string;
    examSignal: number;
    importance: number;
    /** unit 이름 → unit_order (등장 수업 정렬용) */
    units: Map<string, number>;
    topUnit: string;
  }
  const byName = new Map<string, Acc>();
  for (const { unit, unitOrder, data } of snapshots) {
    for (const c of data.concepts) {
      // 개념이 등장한 수업 = history의 unit들 (없으면 스냅샷 unit)
      const history = Array.isArray(c.history) ? c.history : [];
      const appearances: [string, number][] =
        history.length > 0
          ? history.map(
              (h) => [h.unit ?? unit, h.unitOrder] as [string, number]
            )
          : [[unit, unitOrder]];
      const lastUnit = appearances[appearances.length - 1][0];
      const prev = byName.get(c.name);
      if (!prev) {
        byName.set(c.name, {
          name: c.name,
          examSignal: c.examSignal,
          importance: c.importance,
          units: new Map(appearances),
          topUnit: lastUnit,
        });
        continue;
      }
      if (c.examSignal > prev.examSignal) {
        prev.examSignal = c.examSignal;
        prev.topUnit = lastUnit;
      }
      prev.importance = Math.max(prev.importance, c.importance);
      for (const [u, o] of appearances) {
        if (!prev.units.has(u)) prev.units.set(u, o);
      }
    }
  }
  return [...byName.values()]
    .map((a) => ({
      name: a.name,
      examSignal: a.examSignal,
      importance: a.importance,
      topUnit: a.topUnit,
      units: [...a.units.entries()]
        .sort((x, y) => x[1] - y[1])
        .map(([u]) => u),
    }))
    .sort(
      (a, b) => b.examSignal - a.examSignal || b.importance - a.importance
    );
};

/** 개념 하나의 근거 요약 — "5개 수업에서 반복 · 시험 신호 최고: 3주차" */
const evidenceOf = (c: MergedConcept): string => {
  const parts: string[] = [];
  if (c.units.length > 1) parts.push(`${c.units.length}개 수업에서 반복`);
  parts.push(`시험 신호 최고: ${c.topUnit}`);
  return parts.join(" · ");
};

interface Props {
  /** 홈에서 읽어온 시험 목록 (임박순 정렬 전) */
  exams: ExamInfo[];
  /** 매니페스트 subjects — 시험 과목의 unit 목록을 찾는다 (null = 로딩 중) */
  subjects: ManifestSubject[] | null;
  /** 홈 화면으로 이동 (시험 일정 추가 유도) */
  onGoHome: () => void;
  /** 해당 수업(subject/unit) 화면으로 이동 */
  onGoUnit: (subject: string, unit: string) => void;
  /** 발화 시각 근거 클릭 → 그 수업 전사본의 해당 블록으로 (FIX 14) */
  onGoEvidence?: (subject: string, unit: string, anchor: string) => void;
}

/**
 * 시험 대비 화면 — 학기 데이터가 쌓인 뒤의 결말.
 * 우선 복습 개념 TOP 10 · 전 범위 학습노트(내보내기) · 전 범위 모의고사.
 */
export default function ExamPrep({ exams, subjects, onGoHome, onGoUnit, onGoEvidence }: Props) {
  const [segment, setSegment] = useState<Segment>("guide");
  const [snapshots, setSnapshots] = useState<LoadedSnapshot[] | null>(null);
  /** 시험 범위 — 선택된 unit 이름 집합. null = 전체 */
  const [scope, setScope] = useState<Set<string> | null>(null);
  /** 사용자가 고른 시험 id — null이면 시험 선택 화면을 띄운다 (자동 선택 안 함) */
  const [activeExamId, setActiveExamId] = useState<string | null>(null);

  /** 다가오는 시험 전체 (지난 시험 제외, 임박순) — 선택기 목록 */
  const upcoming = useMemo(
    () =>
      exams
        .filter((e) => dday(e.date) >= 0)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [exams]
  );

  /** 선택된 시험 — 사용자가 고른 것만. 없으면 null(=선택 화면) */
  const exam = useMemo(
    () => upcoming.find((e) => e.id === activeExamId) ?? null,
    [upcoming, activeExamId]
  );

  /** 시험을 고르면 세부 페이지로 — 항상 학습 가이드부터 */
  const openExam = useCallback((id: string) => {
    setActiveExamId(id);
    setSegment("guide");
  }, []);

  /** 시험 과목의 unit 목록 (매니페스트 순서 = order 오름차순) */
  const units = useMemo(() => {
    if (!exam || !subjects) return [];
    return subjects.find((s) => s.name === exam.subject)?.units ?? [];
  }, [exam, subjects]);

  // 시험이 바뀌면 저장된 범위 복원
  useEffect(() => {
    setScope(exam ? (() => {
      const stored = loadScope(exam.id);
      return stored ? new Set(stored) : null;
    })() : null);
  }, [exam]);

  /** unit 하나 토글 — 마지막 1개는 해제 불가. 전체가 되면 null로 환원 */
  const toggleUnit = useCallback(
    (name: string) => {
      if (!exam) return;
      const all = units.map((u) => u.name);
      const cur = new Set(scope ?? all);
      if (cur.has(name)) {
        if (cur.size <= 1) return;
        cur.delete(name);
      } else {
        cur.add(name);
      }
      const isAll = all.every((n) => cur.has(n));
      setScope(isAll ? null : cur);
      saveScope(exam.id, isAll ? null : [...cur]);
    },
    [exam, units, scope]
  );

  /** "전체" 토글 — 전체 선택으로 되돌린다 */
  const selectAllUnits = useCallback(() => {
    if (!exam) return;
    setScope(null);
    saveScope(exam.id, null);
  }, [exam]);

  // 시험 과목의 모든 unit 스냅샷을 매니페스트에서 찾아 unit_order 순으로 로드
  useEffect(() => {
    setSnapshots(null);
    if (!exam || subjects === null) return;
    const subject = exam.subject;
    const units = subjects.find((s) => s.name === subject)?.units ?? [];
    let cancelled = false;
    Promise.all(
      units.map((u) =>
        loadSnapshot("analysis", subject, u.name)
          .then((data) => ({
            unit: u.name,
            unitOrder: u.order,
            data: normalizeSnapshot(data),
          }))
          .catch(() => ({
            unit: u.name,
            unitOrder: u.order,
            data: null as Snapshot | null,
          }))
      )
    ).then((results) => {
      if (cancelled) return;
      setSnapshots(
        results
          .filter((r): r is LoadedSnapshot => r.data !== null)
          .sort((a, b) => a.unitOrder - b.unitOrder)
      );
    });
    return () => {
      cancelled = true;
    };
  }, [exam, subjects]);

  /** 선택된 범위 unit 목록 (매니페스트 순서) — 전체 선택이면 null */
  const scopeSel = useMemo(() => {
    if (scope === null || units.length === 0) return null;
    const sel = units.filter((u) => scope.has(u.name));
    if (sel.length === 0 || sel.length === units.length) return null;
    return sel;
  }, [scope, units]);

  /** 범위가 전체가 아닐 때 헤더 요약 — "범위: 3주차–7주차 (5개 수업)" */
  const scopeSummary = useMemo(() => {
    if (!scopeSel) return null;
    const range =
      scopeSel.length === 1
        ? scopeSel[0].name
        : `${scopeSel[0].name}–${scopeSel[scopeSel.length - 1].name}`;
    return `범위: ${range} (${scopeSel.length}개 수업)`;
  }, [scopeSel]);

  /** 문구용 범위 표기 — "학기 전체" 또는 "선택 범위(3주차~7주차)" */
  const scopeLabel = useMemo(() => {
    if (!scopeSel) return "학기 전체";
    const range =
      scopeSel.length === 1
        ? scopeSel[0].name
        : `${scopeSel[0].name}~${scopeSel[scopeSel.length - 1].name}`;
    return `선택 범위(${range})`;
  }, [scopeSel]);

  /** 내보내기 파일명용 범위 태그 — "학기전체" 또는 "3주차-7주차" */
  const scopeFileTag = useMemo(() => {
    if (!scopeSel) return "학기전체";
    return scopeSel.length === 1
      ? scopeSel[0].name
      : `${scopeSel[0].name}-${scopeSel[scopeSel.length - 1].name}`;
  }, [scopeSel]);

  // ── 시험 범위 학습 가이드 (compose-guide 산출물) ──────────
  const [desktop, setDesktop] = useState(false);
  /** 웹 데모 안내 모달 — 데스크톱 전용 기능을 브라우저에서 눌렀을 때 */
  const [desktopOnlyFeature, setDesktopOnlyFeature] = useState<string | null>(
    null
  );
  useEffect(() => {
    setDesktop(isTauriRuntime());
  }, []);

  const [guide, setGuide] = useState<GuideSnapshot | null>(null);
  const [guideGen, setGuideGen] = useState<"idle" | "running" | "failed">(
    "idle"
  );
  const [guideLogTail, setGuideLogTail] = useState("");
  const guidePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 현재 활성 과목 — 폴링 콜백이 과목 전환 후 stale 결과를 반영하지 못하게 가드 */
  const activeSubjectRef = useRef<string | null>(null);
  useEffect(() => {
    activeSubjectRef.current = exam?.subject ?? null;
  }, [exam]);

  const stopGuidePolling = useCallback(() => {
    if (guidePollRef.current) {
      clearInterval(guidePollRef.current);
      guidePollRef.current = null;
    }
  }, []);

  // 언마운트 시 폴링 중지
  useEffect(() => stopGuidePolling, [stopGuidePolling]);

  // 시험(과목)이 바뀌면 저장된 가이드 스냅샷 로드 + 진행 상태 초기화
  useEffect(() => {
    setGuide(null);
    stopGuidePolling();
    setGuideGen("idle");
    setGuideLogTail("");
    if (!exam) return;
    let cancelled = false;
    loadSnapshot("guide", exam.subject)
      .then((g) => {
        if (!cancelled && isGuideSnapshot(g)) setGuide(g);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [exam, stopGuidePolling]);

  /** 현재 선택 범위로 가이드 생성 시작 → 2초 폴링 → done이면 스냅샷 리로드 */
  const startGuide = useCallback(async () => {
    // 웹 데모: 실행 대신 안내 모달 (데스크톱 경로는 아래 그대로)
    if (!desktop) {
      setDesktopOnlyFeature("시험 범위 학습 가이드 만들기");
      return;
    }
    if (!exam || guideGen === "running") return;
    const subject = exam.subject;
    setGuideGen("running");
    setGuideLogTail("");
    try {
      await runComposeGuide(
        subject,
        scopeSel?.map((u) => u.name),
        getActiveEngine()
      );
    } catch (e) {
      setGuideGen("failed");
      setGuideLogTail(e instanceof Error ? e.message : String(e));
      return;
    }
    stopGuidePolling();
    guidePollRef.current = setInterval(() => {
      void (async () => {
        try {
          const s = await composeGuideStatus();
          if (s.status === "running") {
            setGuideLogTail(s.logTail);
            return;
          }
          stopGuidePolling();
          if (s.status === "done") {
            const g = await loadSnapshot(
              "guide",
              subject,
              undefined,
              Date.now()
            );
            // 과목이 전환됐으면 이전 과목 가이드를 새 화면에 표시하지 않는다
            if (activeSubjectRef.current !== subject) return;
            if (isGuideSnapshot(g)) setGuide(g);
            setGuideGen("idle");
          } else {
            setGuideLogTail(s.logTail);
            setGuideGen("failed");
          }
        } catch {
          stopGuidePolling();
          setGuideGen("failed");
        }
      })();
    }, 2000);
  }, [exam, desktop, guideGen, scopeSel, stopGuidePolling]);

  /** 내보내기용 마크다운 — 화면은 구조를 직접 그리므로, 파일로 저장할 때만 조립한다 */
  const guideMarkdown = useMemo(() => {
    if (!guide) return "";
    const d = guide.guide;
    const out: string[] = [`# ${guide.subject} 시험대비 학습 가이드`, ""];
    if (d.overview) out.push(d.overview, "");
    out.push("## 핵심 개념", "");
    for (const c of d.concepts) {
      out.push(`### ${c.examAlert ? "⚠️ " : ""}${c.name}`, c.body);
      if (c.why) out.push(`**왜 중요할까:** ${c.why}`);
      if (c.source) out.push(`_근거: ${c.source}_`);
      out.push("");
    }
    if (d.pastExamTopics.length > 0) {
      out.push("## 기출 빈출", "");
      for (const t of d.pastExamTopics) {
        const yrs = t.years.length > 0 ? ` (${t.years.join(", ")})` : "";
        out.push(`- **${t.topic}**${yrs} — ${t.detail}`);
      }
      out.push("");
    }
    if (d.studyOrder.length > 0) {
      out.push("## 공부 순서", "");
      d.studyOrder.forEach((o, i) => out.push(`${i + 1}. **${o.name}** — ${o.reason}`));
      out.push("");
    }
    return out.join("\n");
  }, [guide]);

  /** 범위 필터를 통과한 스냅샷 — 우선 복습·학습노트·모의고사가 전부 여기서 병합된다 */
  const scoped = useMemo(() => {
    if (!snapshots) return null;
    if (scope === null) return snapshots;
    return snapshots.filter((s) => scope.has(s.unit));
  }, [snapshots, scope]);

  const merged = useMemo(
    () => (scoped ? mergeConcepts(scoped) : []),
    [scoped]
  );

  /** 개념 이름 → 등장 수업 정보. 가이드 카드에서 "N개 수업에서 반복"·수업 이동에 쓴다 */
  const mergedByName = useMemo(
    () => new Map(merged.map((c) => [c.name, c])),
    [merged],
  );

  /** 범위 학습노트 — 수업별 note.markdown을 unit 헤더로 이어붙인다 */
  const fullMarkdown = useMemo(() => {
    if (!scoped) return "";
    const parts: string[] = [];
    for (const { unit, data } of scoped) {
      const md = data.note?.markdown?.trim();
      if (!md) continue;
      parts.push(`# ${unit}\n\n${md}`);
    }
    return parts.join("\n\n---\n\n");
  }, [scoped]);

  const fullNoteHtml = useMemo(() => {
    if (!fullMarkdown) return "";
    return marked.parse(fullMarkdown, { async: false }) as string;
  }, [fullMarkdown]);

  /** 범위 모의고사 문항 — 시험신호(개념 매칭) + 난이도로 상위 15문항 */
  const mockQuestions = useMemo<MockQuestion[]>(() => {
    if (!scoped) return [];
    const signalOf = new Map(merged.map((c) => [c.name, c.examSignal]));
    const seen = new Set<string>();
    const pool: MockQuestion[] = [];
    for (const { unit, unitOrder, data } of scoped) {
      for (const q of data.questions) {
        if (seen.has(q.id)) continue;
        seen.add(q.id);
        // 문항 id는 "w3-c-개념id-q1" 꼴 — 개념 이름으로 직접 맞추기 어려우니
        // 근거(sources)에 걸린 개념 신호 대신 문항이 인용한 개념 신호의 최대치를 쓴다.
        let signal = 0;
        // 매칭된 개념 이름도 모아둔다 — 결과 요약의 "틀린 문항 개념"에 쓴다 (FIX 5)
        const concepts: string[] = [];
        for (const [name, s] of signalOf) {
          if (q.q.includes(name) || q.reasoning.includes(name)) {
            signal = Math.max(signal, s);
            concepts.push(name);
          }
        }
        // 기출(exam) 근거가 있으면 재출제 가능성이 높다
        const sources = Array.isArray(q.sources) ? q.sources : [];
        const examRefs = sources.filter((s) => s.type === "exam").length;
        const score =
          signal +
          (DIFFICULTY_WEIGHT[q.difficulty] ?? 0) +
          examRefs * 20;
        pool.push({ ...q, unit, unitOrder, score, concepts });
      }
    }
    return pool
      .sort((a, b) => b.score - a.score || a.unitOrder - b.unitOrder)
      .slice(0, MOCK_SIZE);
  }, [scoped, merged]);

  const ddayValue = exam ? dday(exam.date) : null;
  const imminent = ddayValue !== null && ddayValue <= 14;

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  /** 마크다운 하나를 파일로 저장 — 데스크톱은 저장 다이얼로그, 웹은 Blob 다운로드 */
  const exportMarkdown = useCallback(async (md: string, kind: string) => {
    if (!md) return;
    setExporting(true);
    setExportMsg(null);
    const name = `${exam?.subject ?? "전체"}_${scopeFileTag}_${kind}.md`;
    try {
      const saved = await saveTextFile(name, md);
      setExportMsg(saved ? `저장했어요 — ${saved}` : null);
    } catch {
      // 브라우저(dev) 폴백 — Blob 다운로드
      const blob = new Blob([md], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg(`내려받았어요 — ${name}`);
    } finally {
      setExporting(false);
    }
  }, [exam, scopeFileTag]);

  const exportGuide = useCallback(
    () => void exportMarkdown(guideMarkdown, "학습가이드"),
    [exportMarkdown, guideMarkdown]
  );
  const exportNotes = useCallback(
    () => void exportMarkdown(fullMarkdown, "학습노트"),
    [exportMarkdown, fullMarkdown]
  );

  const loading = snapshots === null;

  // ── 시험을 아직 고르지 않았을 때 — 시험(과목) 선택 화면 ──
  if (!exam && upcoming.length > 0) {
    return (
      <ExamPicker
        exams={upcoming}
        subjects={subjects}
        onSelect={openExam}
      />
    );
  }

  // ── 시험 일정이 없을 때 ──────────────────────────────────
  if (!exam) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
        <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <GraduationCap className="h-6 w-6 text-primary" aria-hidden />
        </span>
        <h1 className="text-lg font-bold tracking-tight text-gray-900">
          시험 일정을 추가하면 대비를 시작합니다
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-500">
          홈에서 시험을 등록하면 시험 범위 학습노트를 조립하고 우선 복습 개념과
          모의고사를 만들어드려요.
        </p>
        <button
          onClick={onGoHome}
          data-testid="examprep-go-home"
          className="press-scale mt-5 flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover"
        >
          <CalendarPlus className="h-4 w-4" aria-hidden />
          홈에서 시험 일정 추가하기
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="exam-prep"
    >
      {/* ── 헤더 — 과목 · 시험명 · D-day ── */}
      <div className="px-6 pb-1 pt-7 lg:px-10">
        <button
          onClick={() => setActiveExamId(null)}
          data-testid="examprep-back"
          className="press-scale -ml-1.5 mb-2 flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-semibold text-gray-400 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          시험 선택으로
        </button>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
              시험 대비
            </p>
            <h1 className="flex items-center gap-2 text-[26px] font-bold tracking-tight text-gray-900">
              <GraduationCap className="h-6 w-6 text-primary" aria-hidden />
              {exam.subject} {exam.title}
            </h1>
            <p className="mt-0.5 text-sm font-medium text-gray-400">
              {formatDateK(exam.date)} · 분석된 수업 {snapshots?.length ?? 0}개
              {scopeSummary && (
                <span
                  className="text-primary"
                  data-testid="examprep-scope-summary"
                >
                  {" "}
                  · {scopeSummary}
                </span>
              )}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p
              className={`text-[44px] font-bold leading-none tracking-tight ${
                imminent ? "text-red-500" : "text-gray-900"
              }`}
              data-testid="examprep-dday"
            >
              {ddayLabel(ddayValue ?? 0)}
            </p>
            <p className="mt-1 text-xs font-medium text-gray-400">
              {ddayValue === 0 ? "오늘이 시험일이에요" : `${ddayValue}일 남았어요`}
            </p>
          </div>
        </div>

        {/* 이 과목에 분석된 자료가 없을 때 안내 */}
        {!loading && snapshots?.length === 0 && (
          <div
            className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-sm font-medium text-amber-700"
            data-testid="examprep-no-analysis"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            이 과목은 아직 분석된 자료가 없어요. 수업 자료를 업로드하고 분석하면
            학습 가이드를 만들어 드려요.
          </div>
        )}

        {/* 시험 임박 능동 제안 배너 (D-14 이내) */}
        {imminent && !loading && (
          <div
            className="glass-card mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-primary/20 bg-primary/[0.06] px-5 py-3.5"
            data-testid="examprep-banner"
          >
            <span
              className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary shadow-glow"
              aria-hidden
            />
            <span className="text-sm font-medium text-gray-900">
              에이전트가 {scopeLabel} 자료에서 개념 {merged.length}개를 뽑고
              공부 순서까지 정리했어요.
            </span>
          </div>
        )}

        {/* 시험 범위 — 과목 unit 체크박스 칩 (기본 전체 선택) */}
        {units.length > 0 && (
          <div
            className="mt-5 flex flex-wrap items-center gap-1.5"
            data-testid="examprep-scope"
          >
            <span className="mr-1 text-xs font-semibold text-gray-400">
              시험 범위
            </span>
            <button
              onClick={selectAllUnits}
              aria-pressed={scope === null}
              data-testid="examprep-scope-all"
              className={`press-scale flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                scope === null
                  ? "bg-primary/10 text-primary"
                  : "bg-black/[0.04] text-gray-400 hover:text-gray-600"
              }`}
            >
              전체
            </button>
            {units.map((u) => {
              const on = scope === null || scope.has(u.name);
              return (
                <button
                  key={u.name}
                  onClick={() => toggleUnit(u.name)}
                  aria-pressed={on}
                  data-testid={`examprep-scope-${u.name}`}
                  className={`press-scale flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                    on
                      ? "bg-primary/10 text-primary"
                      : "bg-black/[0.04] text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {on && <Check className="h-3 w-3" aria-hidden />}
                  {u.name}
                </button>
              );
            })}
          </div>
        )}

      </div>

      {/* 세그먼트 탭 — 스크롤해도 탭은 남는다 (헤더 전체를 고정하면 본문이 너무 좁아진다) */}
      <div className="sticky top-0 z-10 border-b border-black/[0.05] bg-white/85 px-6 py-3 backdrop-blur-xl lg:px-10">
        <div
          className="inline-flex rounded-xl bg-black/[0.04] p-1"
          role="tablist"
        >
          {SEGMENTS.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={segment === s.id}
              onClick={() => setSegment(s.id)}
              data-testid={`examprep-seg-${s.id}`}
              className={`press-scale rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                segment === s.id
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 본문 ── */}
      <div className="px-6 py-8 lg:px-10">
        {loading ? (
          <p className="text-sm text-gray-400">{scopeLabel} 자료를 조립하는 중…</p>
        ) : segment === "guide" ? (
          <GuideSection
            guide={guide}
            scopeConceptTotal={merged.length}
            guideGen={guideGen}
            guideLogTail={guideLogTail}
            canRebuild={desktop}
            onCompose={() => void startGuide()}
            scopeLabel={scopeLabel}
            onExport={exportGuide}
            exporting={exporting}
            exportMsg={exportMsg}
            mergedByName={mergedByName}
            onGoUnit={(unit) => onGoUnit(exam.subject, unit)}
            onGoEvidence={
              onGoEvidence
                ? (unit, anchor) => onGoEvidence(exam.subject, unit, anchor)
                : undefined
            }
          />
        ) : segment === "note" ? (
          <NoteSection
            html={fullNoteHtml}
            markdown={fullMarkdown}
            conceptCount={merged.length}
            unitCount={scoped?.length ?? 0}
            scopeLabel={scopeLabel}
            onExport={exportNotes}
            exporting={exporting}
            exportMsg={exportMsg}
          />
        ) : (
          <MockSection questions={mockQuestions} />
        )}
      </div>

      {/* 웹 데모 안내 모달 — 데스크톱에서는 feature가 항상 null이라 렌더되지 않는다 */}
      <DesktopOnlyModal
        feature={desktopOnlyFeature}
        onClose={() => setDesktopOnlyFeature(null)}
      />
    </div>
  );
}

// ── 학습 가이드 탭 — 시험 범위 학습 가이드(compose-guide 산출물) ──

/** 가이드 헤더의 범위 표기 — "학기 전체" 또는 "3주차~7주차" */
const guideScopeText = (g: GuideSnapshot): string => {
  if (g.scope === "전체") return "학기 전체";
  if (g.units.length > 1) return `${g.units[0]}~${g.units[g.units.length - 1]}`;
  return g.units[0] ?? g.scope;
};

/** ISO generatedAt → "7/20 14:32" (해석 불가면 원문) */
const fmtGeneratedAt = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/**
 * 개념 카드 — 기본은 접혀 있고, 펼쳐야 설명이 보인다.
 *
 * 설명을 처음부터 늘어놓으면 학생은 "읽었다"는 느낌만 얻고 넘어간다
 * (fluency illusion). 이름만 먼저 보여주고 스스로 떠올릴 틈을 준 뒤 펼치게 한다.
 */
function ConceptCard({
  concept,
  index,
  prereqs,
  merged,
  onGoUnit,
  onGoEvidence,
}: {
  concept: GuideDoc["concepts"][number];
  index: number;
  prereqs: string[];
  /** 스냅샷에서 온 등장 수업 정보 (없을 수도 있다) */
  merged?: MergedConcept;
  onGoUnit: (unit: string) => void;
  onGoEvidence?: (unit: string, anchor: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <li className="glass-card overflow-hidden rounded-2xl">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3.5 px-5 py-4 text-left transition-colors duration-200 hover:bg-black/[0.02]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-xs font-bold text-gray-500">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-semibold text-gray-900">{concept.name}</span>
            {concept.examAlert && (
              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                기출 빈출
              </span>
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-gray-400">
            {/* 반복 횟수는 "왜 위에 있는지"의 근거다 — 점수 대신 이걸 보여준다 */}
            {merged && merged.units.length > 1 && (
              <span className="font-medium text-gray-500">
                {merged.units.length}개 수업에서 반복
              </span>
            )}
            {prereqs.length > 0 && <span>{prereqs.join(" · ")} 먼저</span>}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="border-t border-black/[0.06] px-5 pb-5 pt-4">
          <p className="whitespace-pre-line text-[14px] leading-[1.75] text-gray-700">
            {concept.body}
          </p>
          {concept.why && (
            <p className="mt-3 flex gap-2 rounded-xl bg-primary/[0.06] px-4 py-3 text-[13px] leading-relaxed text-gray-700">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span>{concept.why}</span>
            </p>
          )}
          {concept.source &&
            (() => {
              // 발화 시각 근거면 전사본으로 이동한다 (FIX 14).
              // 매칭이 안 되는 근거는 링크를 걸지 않고 회색 텍스트로 둔다.
              const ev = parseConceptSource(concept.source);
              if (!ev || !onGoEvidence)
                return (
                  <p className="mt-2 text-[11px] text-gray-400">
                    근거 · {concept.source}
                  </p>
                );
              return (
                <button
                  onClick={() => onGoEvidence(ev.unit, ev.anchor)}
                  data-testid="concept-evidence-link"
                  className="press-scale mt-2 text-[11px] font-medium text-primary underline-offset-2 transition-opacity duration-200 hover:underline"
                >
                  근거 · {concept.source} →
                </button>
              );
            })()}

          {/* 이 개념이 나온 수업 — 누르면 그 수업 자료로 이동한다 */}
          {merged && merged.units.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-black/[0.06] pt-3">
              <span className="mr-0.5 text-[11px] font-semibold text-gray-400">
                나온 수업
              </span>
              {merged.units.map((u) => (
                <button
                  key={u}
                  onClick={() => onGoUnit(u)}
                  className={`press-scale rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                    u === merged.topUnit
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : "bg-black/[0.04] text-gray-500 hover:bg-black/[0.08]"
                  }`}
                  title={u === merged.topUnit ? "시험 신호가 가장 높았던 수업" : undefined}
                >
                  {u}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * 학습 경로 다이어그램 — 선수관계를 단계(layer)로 묶어 흐름으로 보여준다.
 *
 * 번호 목록으로 20개를 늘어놓으면 "무엇 다음에 무엇"은 보여도 "무엇과 무엇이
 * 같은 층위인지"가 보이지 않는다. 선수 개념이 모두 앞 단계에 있으면 같은 단계로
 * 묶어, 병렬로 봐도 되는 것과 순서를 지켜야 하는 것을 구분한다.
 */
function StudyFlow({ order }: { order: GuideDoc["studyOrder"] }) {
  const layers = useMemo(() => {
    const placed = new Map<string, number>();
    const result: GuideDoc["studyOrder"][] = [];
    for (const item of order) {
      // 선수 개념 중 가장 늦은 단계의 다음 단계에 놓는다
      const depth = item.prereqs.reduce(
        (max, p) => Math.max(max, placed.has(p) ? placed.get(p)! + 1 : 0),
        0,
      );
      placed.set(item.name, depth);
      (result[depth] ??= []).push(item);
    }
    return result.filter(Boolean);
  }, [order]);

  return (
    <div className="-mx-1 overflow-x-auto px-1 pt-1">
      <div className="flex min-w-max items-start gap-3">
        {layers.map((layer, li) => (
          <div key={li} className="flex items-start gap-3">
            <div className="flex min-w-[132px] flex-col gap-2">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                <span className="flex h-4 w-4 items-center justify-center rounded bg-primary/10 text-[9px] text-primary">
                  {li + 1}
                </span>
                단계
              </span>
              {layer.map((item) => (
                <span
                  key={item.name}
                  title={item.reason}
                  className="rounded-xl border border-black/[0.06] bg-white px-3 py-2 text-[12.5px] font-semibold leading-tight text-gray-700 shadow-sm"
                >
                  {item.name}
                </span>
              ))}
            </div>
            {li < layers.length - 1 && (
              <ChevronRight
                className="mt-7 h-4 w-4 shrink-0 text-gray-300"
                aria-hidden
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 섹션 제목 — 아이콘 + 제목 + 부제 */
function SectionHead({
  icon,
  title,
  sub,
}: {
  icon: ReactNode;
  title: string;
  sub?: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </span>
      <div>
        <h3 className="text-[15px] font-bold text-gray-900">{title}</h3>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  );
}

function GuideSection({
  guide,
  scopeConceptTotal,
  guideGen,
  guideLogTail,
  canRebuild,
  onCompose,
  scopeLabel,
  onExport,
  exporting,
  exportMsg,
  mergedByName,
  onGoUnit,
  onGoEvidence,
}: {
  guide: GuideSnapshot | null;
  /** 이 시험 범위의 전체 개념 수 — 배너 숫자와 같은 대상 (가이드 상위 N과 구분) */
  scopeConceptTotal: number;
  guideGen: "idle" | "running" | "failed";
  guideLogTail: string;
  /** Tauri 데스크톱에서만 "다시 만들기" 노출 — 브라우저는 열람 전용 */
  canRebuild: boolean;
  onCompose: () => void;
  scopeLabel: string;
  onExport: () => void;
  exporting: boolean;
  exportMsg: string | null;
  /** 개념 이름 → 등장 수업 정보 (스냅샷 기반) */
  mergedByName: Map<string, MergedConcept>;
  onGoUnit: (unit: string) => void;
  onGoEvidence?: (unit: string, anchor: string) => void;
}) {
  const logLine = guideLogTail.trim().split("\n").filter(Boolean).pop() ?? "";

  const exportNotice = exportMsg && (
    <p className="mb-4 flex items-center gap-1.5 rounded-xl bg-primary/10 px-4 py-2.5 text-xs font-medium text-primary">
      <Check className="h-3.5 w-3.5" aria-hidden />
      {exportMsg}
    </p>
  );

  // ── 가이드 뷰 — compose-guide 산출물 마크다운 ──
  if (guide) {
    return (
      <section
        className="mx-auto w-full max-w-[1400px]"
        data-testid="examprep-guide"
      >
        {/* 히어로 — 범위 요약 + 흐름(숲)을 한 덩어리로. 따로 두면 짧은 카드에 빈 공간이 남는다 */}
        <div className="glass-card mb-5 overflow-hidden rounded-3xl">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-black/[0.05] bg-gradient-to-br from-primary/[0.07] to-transparent px-7 py-6">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-primary">
              <Compass className="h-4 w-4" aria-hidden />
              학습 가이드
            </p>
            <p className="mt-2 text-[22px] font-bold tracking-tight text-gray-900">
              {guideScopeText(guide)}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-500">
              <span>
                핵심 개념 <b className="font-semibold text-gray-700">{guide.concepts}</b>개
                {scopeConceptTotal > guide.concepts && (
                  <span className="text-gray-400"> / 전체 {scopeConceptTotal}개</span>
                )}
              </span>
              <span className="text-gray-300">·</span>
              <span>기출 <b className="font-semibold text-gray-700">{guide.pastExams}</b>문항</span>
              <span className="text-gray-300">·</span>
              <span className="text-gray-400">{fmtGeneratedAt(guide.generatedAt)} 생성</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canRebuild && (
              <button
                onClick={onCompose}
                disabled={guideGen === "running"}
                data-testid="examprep-guide-rebuild"
                className="press-scale flex items-center gap-1.5 rounded-xl bg-black/[0.04] px-4 py-2 text-sm font-semibold text-gray-700 transition-colors duration-200 hover:bg-black/[0.08] disabled:opacity-50"
              >
                {guideGen === "running" ? (
                  <>
                    <span className="spinner-dark" aria-hidden />
                    만드는 중…
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    다시 만들기
                  </>
                )}
              </button>
            )}
            <button
              onClick={onExport}
              disabled={exporting}
              data-testid="examprep-export"
              className="press-scale flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover disabled:opacity-50"
            >
              <Download className="h-4 w-4" aria-hidden />
              {exporting ? "저장 중…" : "내보내기"}
            </button>
          </div>
          </div>

          {guide.guide.overview && (
            <p className="whitespace-pre-line px-7 py-6 text-[15px] leading-[1.9] text-gray-700">
              {guide.guide.overview}
            </p>
          )}
        </div>
        {guideGen === "running" && logLine && (
          <p className="mb-4 truncate rounded-xl bg-black/[0.03] px-4 py-2.5 font-mono text-[11px] text-gray-500">
            {logLine}
          </p>
        )}
        {guideGen === "failed" && (
          <p
            className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-xs font-medium text-red-500"
            data-testid="examprep-guide-error"
          >
            학습 가이드 생성에 실패했어요. 잠시 후 다시 시도해주세요.
            {logLine && ` — ${logLine}`}
          </p>
        )}
        {exportNotice}

        {/* 학습 경로 — 전폭. 단계가 5~6개라 좁은 칸에 넣으면 가로 스크롤이 생긴다 */}
        {guide.guide.studyOrder.length > 0 && (
          <div className="glass-card mb-5 rounded-3xl px-7 py-6">
            <SectionHead
              icon={<Route className="h-4 w-4" aria-hidden />}
              title="학습 경로"
              sub="왼쪽부터 순서대로 · 같은 단계끼리는 순서를 바꿔도 괜찮아요"
            />
            <StudyFlow order={guide.guide.studyOrder} />
          </div>
        )}

        {/* 본문 — 개념(넓게) + 기출·순서(사이드) */}
        <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr] xl:items-start">
          <div>
            <SectionHead
              icon={<MapIcon className="h-4 w-4" aria-hidden />}
              title={
                scopeConceptTotal > guide.guide.concepts.length
                  ? `이번 시험 핵심 ${guide.guide.concepts.length}개 (전체 ${scopeConceptTotal}개 중)`
                  : `이번 시험 핵심 ${guide.guide.concepts.length}개`
              }
              sub="이름을 보고 떠올려본 뒤 펼쳐보세요"
            />
            <ol className="space-y-2.5">
              {guide.guide.concepts.map((c, i) => (
                <ConceptCard
                  key={c.name}
                  concept={c}
                  index={i}
                  prereqs={
                    guide.guide.studyOrder.find((o) => o.name === c.name)?.prereqs ?? []
                  }
                  merged={mergedByName.get(c.name)}
                  onGoUnit={onGoUnit}
                  onGoEvidence={onGoEvidence}
                />
              ))}
            </ol>
          </div>

          <div className="space-y-5 xl:sticky xl:top-16">
            {/* 기출 — 족보가 있을 때만 */}
            {guide.guide.pastExamTopics.length > 0 && (
              <div className="glass-card rounded-3xl px-6 py-6">
                <SectionHead
                  icon={<FileText className="h-4 w-4" aria-hidden />}
                  title="기출에서 이렇게 나왔어요"
                  sub={`족보 ${guide.pastExams}문항 분석`}
                />
                <ul className="space-y-4">
                  {guide.guide.pastExamTopics.map((t) => (
                    <li key={t.topic}>
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-gray-900">
                          {t.topic}
                        </span>
                        {t.years.length > 0 && (
                          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                            {t.years.join(" · ")}
                          </span>
                        )}
                      </p>
                      {t.detail && (
                        <p className="mt-1 text-[12.5px] leading-relaxed text-gray-500">
                          {t.detail}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 순서별 이유 — 다이어그램에서 생략된 설명을 여기서 */}
            {guide.guide.studyOrder.length > 0 && (
              <div className="glass-card rounded-3xl px-6 py-6">
                <SectionHead
                  icon={<ListChecks className="h-4 w-4" aria-hidden />}
                  title="왜 이 순서인가"
                />
                <ol className="space-y-2.5">
                  {guide.guide.studyOrder.map((o, i) => (
                    <li key={o.name} className="flex gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-[10px] font-bold text-gray-400">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-gray-800">{o.name}</p>
                        {o.reason && (
                          <p className="mt-0.5 text-[12px] leading-relaxed text-gray-500">
                            {o.reason}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  // ── 가이드 없음 — 생성 CTA (웹에서는 DesktopOnlyModal 안내로 이어진다) ──
  return (
    <section
      className="mx-auto w-full max-w-[820px]"
      data-testid="examprep-guide"
    >
      <div
        className="glass-card rounded-2xl border border-primary/20 bg-primary/[0.06] px-6 py-6 text-center"
        data-testid="examprep-guide-cta"
      >
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden />
        </span>
        <p className="text-sm font-semibold text-gray-900">
          시험 범위 학습 가이드가 아직 없어요
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-gray-500">
          {scopeLabel}의 개념·기출을 즉석에서 가이드 하나로 조립해드려요.
        </p>
        <button
          onClick={onCompose}
          disabled={guideGen === "running"}
          data-testid="examprep-guide-compose"
          className="press-scale mx-auto mt-5 flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover disabled:opacity-50"
        >
          {guideGen === "running" ? (
            <>
              <span className="spinner" aria-hidden />
              만드는 중…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden />
              학습 가이드 만들기
            </>
          )}
        </button>
        {guideGen === "running" && logLine && (
          <p className="mt-3 truncate font-mono text-[11px] text-gray-500">
            {logLine}
          </p>
        )}
        {guideGen === "failed" && (
          <p
            className="mt-3 text-xs font-medium text-red-500"
            data-testid="examprep-guide-error"
          >
            학습 가이드 생성에 실패했어요. 잠시 후 다시 시도해주세요.
            {logLine && ` — ${logLine}`}
          </p>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-gray-400">
        가이드 없이도 <span className="font-semibold text-gray-500">학습노트</span>{" "}
        탭에서 수업별 노트를 모아 볼 수 있어요.
      </p>
    </section>
  );
}

// ── 학습노트 탭 — 수업별 노트 모아보기(누적 노트) ──
function NoteSection({
  html,
  markdown,
  conceptCount,
  unitCount,
  scopeLabel,
  onExport,
  exporting,
  exportMsg,
}: {
  html: string;
  /** 카드 렌더용 원문 — 파싱 실패 시 html 통짜 렌더로 폴백 */
  markdown: string;
  conceptCount: number;
  unitCount: number;
  scopeLabel: string;
  onExport: () => void;
  exporting: boolean;
  exportMsg: string | null;
}) {
  const hasCards = parseNoteCards(markdown).cards.length > 0;
  if (!html) {
    return <p className="text-sm text-gray-400">학습노트가 아직 없습니다.</p>;
  }
  return (
    <section
      className="mx-auto w-full max-w-[820px]"
      data-testid="examprep-note"
    >
      <div className="glass-card mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <FileText className="h-4 w-4 text-primary" aria-hidden />
            수업별 노트 모아보기 · {scopeLabel}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            수업 {unitCount}개의 학습노트를 이어붙인 참고용 뷰예요 · 개념{" "}
            {conceptCount}개
          </p>
        </div>
        <button
          onClick={onExport}
          disabled={exporting}
          data-testid="examprep-export"
          className="press-scale flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover disabled:opacity-50"
        >
          <Download className="h-4 w-4" aria-hidden />
          {exporting ? "저장 중…" : "내보내기"}
        </button>
      </div>
      {exportMsg && (
        <p className="mb-4 flex items-center gap-1.5 rounded-xl bg-primary/10 px-4 py-2.5 text-xs font-medium text-primary">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {exportMsg}
        </p>
      )}
      {/* 개념 카드 렌더 — 파싱 실패 시에만 기존 통짜 마크다운으로 폴백 */}
      {hasCards ? (
        <NoteCards markdown={markdown} />
      ) : (
        <div className="glass-card rounded-2xl p-8">
          <div
            className="note-md note-md-wide"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )}
    </section>
  );
}

// ── 전 범위 모의고사 ─────────────────────────────────────────
function MockSection({ questions }: { questions: MockQuestion[] }) {
  const [state, setState] = useState<MockState>(emptyMockState);
  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    setState(loadMockState());
    setReady(true);
  }, []);

  // 타이머 — 제출 전에만 흐른다
  useEffect(() => {
    if (!ready || state.submitted) return;
    startRef.current = Date.now() - state.elapsed * 1000;
    const t = setInterval(() => {
      setState((s) => {
        if (s.submitted || startRef.current === null) return s;
        return {
          ...s,
          elapsed: Math.floor((Date.now() - startRef.current) / 1000),
        };
      });
    }, 1000);
    return () => clearInterval(t);
    // elapsed는 의도적으로 의존성에서 제외 (타이머 자신이 갱신)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, state.submitted]);

  const persist = useCallback((next: MockState) => {
    setState(next);
    saveMockState(next);
  }, []);

  const current = questions[index] ?? null;
  const graded = Object.keys(state.grades).length;
  const correct = Object.values(state.grades).filter(
    (g) => g === "correct"
  ).length;
  const wrong = Object.values(state.grades).filter((g) => g === "wrong").length;
  const ungraded = questions.length - graded;

  /** 틀린 문항에 걸린 개념 (중복 제거) — 결과 요약의 복습 목록 (FIX 5) */
  const wrongConcepts = useMemo(() => {
    const names = new Set<string>();
    for (const q of questions) {
      if (state.grades[q.id] !== "wrong") continue;
      for (const name of q.concepts) names.add(name);
    }
    return [...names];
  }, [questions, state.grades]);

  const grade = (g: Grade) => {
    if (!current) return;
    const next: MockState = {
      ...state,
      grades: { ...state.grades, [current.id]: g },
    };
    persist(next);
    setRevealed(false);
    if (index < questions.length - 1) setIndex((i) => i + 1);
  };

  const submit = () => {
    persist({ ...state, submitted: true });
  };

  const reset = () => {
    startRef.current = Date.now();
    persist(emptyMockState());
    setIndex(0);
    setRevealed(false);
  };

  if (questions.length === 0) {
    return <p className="text-sm text-gray-400">모의고사 문항이 없습니다.</p>;
  }

  // ── 결과 화면 (제출 후) ──
  if (state.submitted) {
    const score = Math.round((correct / questions.length) * 100);
    return (
      <section
        className="mx-auto w-full max-w-[820px]"
        data-testid="examprep-mock-result"
      >
        <div className="glass-card mb-5 rounded-2xl p-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            전 범위 모의고사 결과
          </p>
          <p className="mt-2 text-[52px] font-bold leading-none tracking-tight text-gray-900">
            {score}
            <span className="text-2xl text-gray-400">점</span>
          </p>
          <p className="mt-2 text-sm text-gray-500">
            총 {questions.length}문항 · 맞음 {correct} · 틀림 {wrong}
            {ungraded > 0 && ` · 미채점 ${ungraded}`} · 소요{" "}
            {fmtElapsed(state.elapsed)}
          </p>

          {/* 틀린 문항의 개념 — 다시 볼 것 (FIX 5) */}
          {wrongConcepts.length > 0 && (
            <div className="mt-5 text-left" data-testid="examprep-mock-weak">
              <p className="mb-2 text-xs font-semibold text-gray-700">
                다시 볼 개념 · {wrongConcepts.length}개
              </p>
              <div className="flex flex-wrap gap-1.5">
                {wrongConcepts.map((name) => (
                  <span
                    key={name}
                    className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-500"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={reset}
            data-testid="examprep-mock-reset"
            className="press-scale mt-5 inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            다시 풀기
          </button>
        </div>

        {/* 정오표 */}
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-gray-900">
          정오표
        </h2>
        <ol className="space-y-2.5">
          {questions.map((q, i) => {
            const g = state.grades[q.id];
            return (
              <li key={q.id} className="glass-card rounded-2xl p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      g === "correct"
                        ? "bg-emerald-50 text-emerald-600"
                        : g === "wrong"
                          ? "bg-red-50 text-red-500"
                          : "bg-black/[0.04] text-gray-400"
                    }`}
                  >
                    {g === "correct" ? (
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    ) : g === "wrong" ? (
                      <X className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                    {q.unit}
                  </span>
                  <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                    {DIFFICULTY_LABEL[q.difficulty] ?? q.difficulty}
                  </span>
                  {!g && (
                    <span className="text-[11px] font-medium text-gray-400">
                      미채점
                    </span>
                  )}
                </div>
                <p className="text-sm font-semibold leading-relaxed text-gray-900">
                  {q.q}
                </p>
                {/* 내가 쓴 답 — 모범답안과 나란히 두고 다시 대조할 수 있게 (FIX 5) */}
                <p className="mt-2 text-[11px] font-semibold text-gray-400">
                  내 답안
                </p>
                <p className="mt-1 whitespace-pre-wrap rounded-xl bg-white/70 px-4 py-3 text-[13px] leading-relaxed text-gray-700">
                  {(state.answers[q.id] ?? "").trim() || "(빈 답안)"}
                </p>
                <p className="mt-3 text-[11px] font-semibold text-primary">
                  모범답안
                </p>
                <p className="mt-1 whitespace-pre-wrap rounded-xl bg-black/[0.03] px-4 py-3 text-[13px] leading-relaxed text-gray-600">
                  {q.a}
                </p>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  // ── 풀이 화면 ──
  return (
    <section
      className="mx-auto w-full max-w-[820px]"
      data-testid="examprep-mock"
    >
      {/* 진행 · 타이머 */}
      <div className="glass-card mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-5 py-3.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <ListChecks className="h-4 w-4 text-primary" aria-hidden />
          {index + 1} / {questions.length}
        </span>
        <span className="flex items-center gap-1.5 rounded-md bg-black/[0.04] px-2 py-0.5 font-mono text-xs text-gray-500">
          <Timer className="h-3.5 w-3.5" aria-hidden />
          {fmtElapsed(state.elapsed)}
        </span>
        <span className="text-xs font-medium text-gray-400">
          채점 {graded} · 정답 {correct}
        </span>
        <button
          onClick={submit}
          data-testid="examprep-mock-submit"
          className="press-scale ml-auto rounded-xl bg-primary px-4 py-1.5 text-[13px] font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover"
        >
          제출하기
        </button>
      </div>

      {/* 진행 바 */}
      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${(graded / questions.length) * 100}%` }}
        />
      </div>

      {current && (
        <div className="glass-card rounded-2xl p-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
              {current.unit}
            </span>
            <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
              {DIFFICULTY_LABEL[current.difficulty] ?? current.difficulty}
            </span>
            {Array.isArray(current.sources) &&
              current.sources.some((s) => s.type === "exam") && (
              <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-500">
                기출 유사
              </span>
            )}
          </div>
          <p className="text-[15px] font-semibold leading-relaxed text-gray-900">
            {current.q}
          </p>

          {/* 답 입력 — 연습 모드와 같은 컴포넌트를 쓴다 (FIX 5) */}
          <AnswerInput
            questionId={current.id}
            answer={state.answers[current.id] ?? ""}
            onAnswer={(v) =>
              persist({
                ...state,
                answers: { ...state.answers, [current.id]: v },
              })
            }
            readOnly={revealed}
          />

          {revealed ? (
            <>
              <div className="mt-5 space-y-4 rounded-2xl bg-black/[0.025] p-5">
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                    모범답안
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                    {current.a}
                  </p>
                </div>
                {current.reasoning && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      왜 나올까
                    </p>
                    <p className="text-sm leading-relaxed text-gray-600">
                      {current.reasoning}
                    </p>
                  </div>
                )}
                <SourceList sources={current.sources ?? []} />
              </div>
              <p className="mt-4 text-xs font-medium text-gray-400">
                모범답안과 대조해 채점하세요 — 맞았나요?
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => grade("correct")}
                  data-testid="examprep-mock-correct"
                  className="press-scale flex items-center gap-1.5 rounded-xl bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-600 transition-colors duration-200 hover:bg-emerald-100"
                >
                  <Check className="h-4 w-4" aria-hidden />
                  맞음
                </button>
                <button
                  onClick={() => grade("wrong")}
                  data-testid="examprep-mock-wrong"
                  className="press-scale flex items-center gap-1.5 rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-500 transition-colors duration-200 hover:bg-red-100"
                >
                  <X className="h-4 w-4" aria-hidden />
                  틀림
                </button>
              </div>
            </>
          ) : (
            /* 답을 쓰기 전에는 정답을 열 수 없다 (FIX 5) */
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => setRevealed(true)}
                disabled={(state.answers[current.id] ?? "").trim() === ""}
                data-testid="examprep-mock-reveal"
                className="press-scale rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                제출
              </button>
              {(state.answers[current.id] ?? "").trim() === "" && (
                <span className="text-xs text-gray-400">
                  답을 입력하면 모범답안과 대조할 수 있어요.
                </span>
              )}
            </div>
          )}

          {/* 문항 이동 */}
          <div className="mt-6 flex items-center justify-between border-t border-black/[0.05] pt-4">
            <button
              onClick={() => {
                setRevealed(false);
                setIndex((i) => Math.max(0, i - 1));
              }}
              disabled={index === 0}
              className="press-scale rounded-lg px-3 py-1.5 text-[13px] font-medium text-gray-500 transition-colors duration-200 hover:bg-black/[0.04] disabled:opacity-40"
            >
              이전
            </button>
            <div className="flex flex-wrap items-center gap-1">
              {questions.map((q, i) => {
                const g = state.grades[q.id];
                return (
                  <button
                    key={q.id}
                    onClick={() => {
                      setRevealed(false);
                      setIndex(i);
                    }}
                    aria-label={`${i + 1}번 문항`}
                    className={`h-2 w-2 rounded-full transition-colors duration-200 ${
                      i === index
                        ? "bg-primary ring-2 ring-primary/25"
                        : g === "correct"
                          ? "bg-emerald-400"
                          : g === "wrong"
                            ? "bg-red-400"
                            : "bg-black/10"
                    }`}
                  />
                );
              })}
            </div>
            <button
              onClick={() => {
                setRevealed(false);
                setIndex((i) => Math.min(questions.length - 1, i + 1));
              }}
              disabled={index === questions.length - 1}
              className="press-scale rounded-lg px-3 py-1.5 text-[13px] font-medium text-gray-500 transition-colors duration-200 hover:bg-black/[0.04] disabled:opacity-40"
            >
              다음
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── 시험(과목) 선택 화면 — [시험 대비] 진입 시 가장 먼저 뜬다 ──
function ExamPicker({
  exams,
  subjects,
  onSelect,
}: {
  exams: ExamInfo[];
  subjects: ManifestSubject[] | null;
  onSelect: (id: string) => void;
}) {
  /** 과목별 가이드 스냅샷 — 가이드 존재 여부 판단용 */
  const [guides, setGuides] = useState<Record<string, GuideSnapshot>>({});
  /**
   * 과목별 "전체 개념 수".
   * guide.concepts는 가이드에 싣는 상위 N 고정값(20)이라 과목 지표가 될 수 없다.
   * 주차 스냅샷의 concepts[]는 누적본이므로 가장 큰 값이 그 과목의 전체 개념 수다.
   */
  const [conceptTotals, setConceptTotals] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    const names = [...new Set(exams.map((e) => e.subject))];
    Promise.all(
      names.map((s) =>
        loadSnapshot("guide", s)
          .then((g) => [s, g] as const)
          .catch(() => [s, null] as const)
      )
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, GuideSnapshot> = {};
      for (const [s, g] of rows) if (isGuideSnapshot(g)) next[s] = g;
      setGuides(next);
    });
    return () => {
      cancelled = true;
    };
  }, [exams]);

  // 과목별 전체 개념 수 — 그 과목의 모든 주차 스냅샷을 읽어 최댓값을 취한다
  useEffect(() => {
    let cancelled = false;
    const names = [...new Set(exams.map((e) => e.subject))];
    Promise.all(
      names.map(async (s) => {
        const units = subjects?.find((x) => x.name === s)?.units ?? [];
        const counts = await Promise.all(
          units.map((u) =>
            loadSnapshot("analysis", s, u.name)
              .then((d) => {
                const c = (d as { concepts?: unknown[] } | null)?.concepts;
                return Array.isArray(c) ? c.length : 0;
              })
              .catch(() => 0)
          )
        );
        return [s, counts.length > 0 ? Math.max(...counts) : 0] as const;
      })
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, number> = {};
      for (const [s, n] of rows) if (n > 0) next[s] = n;
      setConceptTotals(next);
    });
    return () => {
      cancelled = true;
    };
  }, [exams, subjects]);

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-7"
      data-testid="examprep-picker"
    >
      <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
        시험 대비
      </p>
      <h1 className="flex items-center gap-2 text-[26px] font-bold tracking-tight text-gray-900">
        <GraduationCap className="h-6 w-6 text-primary" aria-hidden />
        어떤 시험을 대비할까요?
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        과목을 고르면 학습 가이드 · 우선 복습 · 모의고사를 준비해드려요.
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {exams.map((e) => {
          const d = dday(e.date);
          const units = subjects?.find((s) => s.name === e.subject)?.units ?? [];
          const g = guides[e.subject];
          const total = conceptTotals[e.subject];
          const status =
            units.length === 0
              ? "아직 분석된 수업이 없어요"
              : total
                ? `${units.length}개 수업 분석됨 · 개념 ${total}개`
                : g
                  ? `${units.length}개 수업 분석됨`
                  : `${units.length}개 수업`;
          return (
            <li key={e.id}>
              <button
                onClick={() => onSelect(e.id)}
                data-testid={`examprep-pick-${e.id}`}
                className="glass-card glass-card-hover flex w-full items-center gap-4 rounded-2xl p-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold tracking-tight text-gray-900">
                    {e.subject}
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-medium text-gray-500">
                    {e.title} · {formatDateK(e.date)}
                  </span>
                  <span className="mt-2 block text-xs text-gray-400">
                    {status}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-bold ${
                    d <= 14
                      ? "bg-red-50 text-red-500"
                      : "bg-black/[0.04] text-gray-500"
                  }`}
                >
                  {ddayLabel(d)}
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-gray-300"
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
