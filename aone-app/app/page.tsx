"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { marked } from "marked";
import NoteCards from "@/components/NoteCards";
import { parseNoteCards } from "@/lib/note-cards";
import TranscriptViewer, {
  type TranscriptHighlight,
} from "@/components/TranscriptViewer";
import { locatorToAnchor, parseConceptSource } from "@/lib/transcript";
// 파일 kind 판정 단일 진입점 (R1) — 각 호출부에 정규식을 흩어놓지 않는다
import {
  kindOf,
  isTranscript,
  isPastExam,
  isExamFolder as isExamFolderName,
} from "@/lib/file-kind";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BellRing,
  BookOpen,
  Check,
  ChevronRight,
  Command,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GraduationCap,
  Home as HomeIcon,
  Info,
  LayoutGrid,
  List,
  LogOut,
  MessageSquare,
  Mic,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Upload,
  User,
  X,
  Zap,
} from "lucide-react";
import {
  analysisLog,
  analysisStatus,
  ENGINE_LABELS,
  getActiveEngine,
  isTauriRuntime,
  runFolderAnalysis,
  runSlideSummarize,
  slideSummarizeStatus,
  stopAnalysis,
  type EngineChoice,
  type LogKind,
} from "@/lib/engines";
import {
  folderKeyOf,
  parseManifest,
  slugOf,
  type FilesManifest,
  type ManifestFile,
  type ManifestSubject,
} from "@/lib/manifest";
import {
  createSubjectFolders,
  deleteFile,
  dropFiles,
  onFileAdded,
  onWindowFileDrop,
  pickAndUploadFiles,
  renameFolder,
  rescanFiles,
  startGoldsetWatcher,
  stopGoldsetWatcher,
  trashFolder,
  type RejectedFile,
  loadSnapshot,
  loadDocUrl,
  loadDocText,
  docExists,
  userErrorMessage,
} from "@/lib/fs-bridge";
import FileIcon, { fileIconTypeOf, type FileIconType } from "@/components/FileIcon";
import PdfViewer from "@/components/PdfViewer";
import PdfThumbStrip from "@/components/PdfThumbStrip";
import ExamViewer from "@/components/ExamViewer";
import QuizTab from "@/components/QuizTab";
import { signalMeta, signalMetaOf, signalLevel, type SignalLevel } from "@/lib/signal";
import AgentConsole from "@/components/AgentConsole";
import DesktopOnlyModal, { WebDemoBadge } from "@/components/DesktopOnlyModal";
import HomeView, { type HomeViewHandle } from "@/components/home/HomeView";
import ExamPrep, { type ExamInfo } from "@/components/ExamPrep";
import {
  dday,
  ddayLabel,
  loadExams,
  seedWebDemoIfEmpty,
} from "@/components/home/homeData";
import { getUserName, getUserOrg, saveUserProfile } from "@/lib/user";

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

interface Activity {
  ts: string;
  layer: string;
  text: string;
}

interface Proactive {
  text: string;
  questionIds?: string[];
}

/** 전역 에이전트 화면용 — 어느 수업에서 나온 제안인지까지 담은 능동 제안 */
interface ProactiveItem extends Proactive {
  subject: string;
  unit: string;
  unitOrder: number;
  /** "데이터통신 · 3주차" */
  lectureName: string;
}

interface QuestionSource {
  type: string;
  /** 근거가 나온 수업(unit) 이름 */
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
  activities: Activity[];
  proactive: Proactive[];
  questions: Question[];
  note?: { markdown: string };
}

/**
 * 로드한 스냅샷의 배열 필드를 정상화한다.
 * 손상된(비배열·필드 누락) 스냅샷에서도 concepts·activities·proactive·questions가
 * 항상 배열이 되도록 보장해 하위 렌더·필터·병합의 크래시를 원천 차단한다.
 * 유효 객체가 아니면 null.
 */
const normalizeSnapshot = (data: unknown): Snapshot | null => {
  if (typeof data !== "object" || data === null) return null;
  const o = data as Partial<Snapshot>;
  return {
    subject: typeof o.subject === "string" ? o.subject : "",
    unit: typeof o.unit === "string" ? o.unit : "",
    unitOrder: typeof o.unitOrder === "number" ? o.unitOrder : 0,
    concepts: Array.isArray(o.concepts) ? o.concepts : [],
    activities: Array.isArray(o.activities) ? o.activities : [],
    proactive: Array.isArray(o.proactive) ? o.proactive : [],
    questions: Array.isArray(o.questions) ? o.questions : [],
    note: o.note,
  };
};

/** 파일 항목 — 매니페스트(§7)의 파일 그대로 */
type FileEntry = ManifestFile;

interface DocConcept {
  name: string;
  importance: number;
  examSignal: number;
}

interface DocQuote {
  quote: string;
  locator: string;
  concept: string;
}

interface DocSourceDetail {
  concepts: DocConcept[];
  emphasis: DocQuote[];
  examHints: DocQuote[];
  questionIds: string[];
}

type DocSourceType = "transcript" | "slide" | "exam";

interface DocsSnapshot {
  bySource: Record<DocSourceType, DocSourceDetail>;
}

/** 슬라이드별 요약 (public/slides/{slug}.json) */
interface SlideSummary {
  slide_id: string;
  doc: string; // "theory_01" | "practice_01" …
  page: number;
  title_ko: string;
  summary_ko: string;
  key_points_ko: string[];
  diagram_ko: string;
  exam_tip: string;
  lecture_ref: string;
}

/**
 * 자료 단위 요약 — 쪽별 카드로는 알 수 없는 것들.
 * 흩어진 페이지가 같은 주제라는 것(예: PCB가 11~16쪽과 25~27쪽)은
 * 자료 전체를 한 번에 봐야 나오므로 파이프라인이 따로 만들어 둔다.
 */
interface DocSummary {
  doc: string;
  /** 이 자료가 무엇을 다루고 어떤 흐름인지 */
  overview: string;
  themes: {
    name: string;
    pages: number[];
    /** 무엇을 다루는지 한 줄 */
    point: string;
    /** 핵심 내용 2~4문장 — 이것만 읽어도 알맹이가 잡히도록 */
    body?: string;
    /** 짚고 넘어갈 것 3~5개 */
    keyPoints?: string[];
  }[];
  pages: number;
  generatedAt: string;
}

/** 강의 PDF 매니페스트 (public/lecture-pdfs/manifest.json) — 키는 slug */
interface LecturePdfEntry {
  file: string;
  title: string;
  size: number;
  available: boolean;
}

type LecturePdfManifest = Record<string, Record<string, LecturePdfEntry>>;

/** 파일명 → 매니페스트/슬라이드 doc 키 ("week2_theory_02.txt" → "theory_02") */
const docKeyOf = (name: string): string | null =>
  name.match(/((?:theory|practice)_\d{2})/)?.[1] ?? null;

const isPdfName = (name: string): boolean =>
  name.toLowerCase().endsWith(".pdf");

/** PPT/PPTX 원본 — 슬라이드 텍스트/요약 카드 뷰로 연다 */
const isPptName = (name: string): boolean =>
  /\.pptx?$/i.test(name);

/**
 * 업로드 문서(PDF·PPT)의 doc 태그 — 확장자를 뗀 파일명.
 * 파이프라인 CLI(summarize-slides --doc)가 `goldset/{subject}/{unit}/<태그>.pdf|.pptx`를 찾으므로 그대로 맞춘다.
 */
const uploadDocTagOf = (name: string): string =>
  name.replace(/\.(pdf|pptx?)$/i, "");

/** 업로드 PDF의 웹 경로 — Rust rescan이 public/uploads/{slug}/로 미러링해 둔다. */
const uploadPdfUrl = (slug: string, name: string): string =>
  `/uploads/${encodeURIComponent(slug)}/${encodeURIComponent(name)}`;

/** goldset 상대 경로(folderKey)의 원문 웹 경로 — 세그먼트별 인코딩 */
const docUrl = (folderKey: string, name: string): string =>
  `/docs/${folderKey.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(name)}`;

/** 녹음 원본 후보 파일명 (public/docs/{folderKey}/) */
const AUDIO_CANDIDATES = [
  "recording.m4a",
  "recording.mp3",
  "recording.wav",
  "audio.m4a",
  "audio.mp3",
];

/** 파일 타입 → 파이프라인 source_type 매핑 */
const SOURCE_OF_FILE_TYPE: Record<string, DocSourceType> = {
  transcript: "transcript",
  theory: "slide",
  practice: "slide",
  past_exam: "exam",
};

/** 능동 제안 한 건을 칩으로 요약한 형태 */
interface ProactiveChip {
  /** 제안이 가리키는 개념 이름 */
  concept: string;
  /** "기출 5회 · 강조 2회" 처럼 압축한 근거 */
  evidence: string;
  /** 원문 (펼침 목록에서 그대로 보여준다) */
  text: string;
  questionIds: string[];
}

/**
 * 제안 문장에서 개념 이름과 근거를 뽑아 칩으로 만든다.
 * 문장 형식: "'개념' — 기출에 5번 나왔고, 수업에서 2번 강조됐어요. …"
 */
const toProactiveChip = (p: Proactive): ProactiveChip => {
  const nameMatch = p.text.match(/'([^']+)'/);
  // 두 형식 모두 지원: "기출에 5번 나왔고 … 수업에서 2번 강조" / "기출 5회 매칭, 시험 언급 1회, 강조 2회 감지"
  const exam =
    p.text.match(/기출에\s*(\d+)번/) ?? p.text.match(/기출\s*(\d+)회/);
  const emphasis =
    p.text.match(/수업에서\s*(\d+)번/) ?? p.text.match(/강조\s*(\d+)회/);
  const mention = p.text.match(/시험 언급\s*(\d+)회/);
  const parts: string[] = [];
  if (exam && Number(exam[1]) > 0) parts.push(`기출 ${exam[1]}회`);
  if (/시험에 나온다고 직접 언급/.test(p.text)) parts.push("교수 언급");
  else if (mention && Number(mention[1]) > 0)
    parts.push(`시험 언급 ${mention[1]}회`);
  if (emphasis && Number(emphasis[1]) > 0) parts.push(`강조 ${emphasis[1]}회`);
  return {
    concept: nameMatch ? nameMatch[1] : "이 개념",
    evidence: parts.join(" · ") || "시험 신호 감지",
    text: p.text,
    questionIds: p.questionIds ?? [],
  };
};

interface FileTypeMeta {
  label: string;
}

const FILE_TYPE_META: Record<string, FileTypeMeta> = {
  transcript: { label: "녹취" },
  theory: { label: "이론" },
  practice: { label: "실습" },
  past_exam: { label: "기출" },
};

const DEFAULT_FILE_META: FileTypeMeta = { label: "문서" };

const fileMeta = (type: string): FileTypeMeta =>
  FILE_TYPE_META[type] ?? DEFAULT_FILE_META;

const formatSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

// ── 파일 카드 "원본화" — 중간 산출물(txt/json)을 사용자 언어로 변환 ──
// files.json·Rust rescan은 그대로 두고 UI 표시 계층에서만 바꾼다.
interface DisplayFile {
  key: string;
  /** 카드에 보여줄 이름 (PDF 원제목 · 강의 녹음 · 기출 모음) */
  title: string;
  subtitle: string;
  icon: FileIconType;
  /** 카드 자체 배지 (전사 완료 등) — 있으면 컨텍스트 배지보다 우선 */
  badge?: string;
  /** 클릭 시 열 실제 파일 엔트리 (기존 문서 화면 그대로 사용) */
  entry: FileEntry;
  /** 파일 1개와 1:1 대응하지 않는 카드(기출 모음 등)는 삭제 메뉴를 달지 않는다 */
  bundle?: boolean;
}

const displayFilesOf = (
  slug: string,
  entries: FileEntry[],
  manifest: LecturePdfManifest | null
): DisplayFile[] => {
  const out: DisplayFile[] = [];
  const exams: FileEntry[] = [];
  // slug는 "과목__주차" — 뒤쪽이 폴더 이름이다 (kind 판정에 넘긴다, R1)
  const folder = slug.split("__").pop() ?? "";
  for (const f of entries) {
    const kind = kindOf(f, folder);
    // 기출은 여러 산출물을 카드 1장으로 합친다 (아래에서 push)
    if (kind === "past_exam") {
      exams.push(f);
      continue;
    }
    // transcript.txt → "강의 녹음" 카드
    if (kind === "transcript") {
      out.push({
        key: `${slug}-${f.name}`,
        title: "강의 녹음 전사본",
        subtitle: "전사 텍스트 · 59분 분량",
        icon: "audio",
        badge: "전사본",
        entry: f,
      });
      continue;
    }
    // *_theory_NN.txt / *_practice_NN.txt → 대응 PDF 원본 카드
    const dk = docKeyOf(f.name);
    const pdf = dk ? manifest?.[slug]?.[dk] ?? null : null;
    if (pdf && pdf.available) {
      out.push({
        key: `${slug}-${f.name}`,
        title: pdf.title,
        subtitle: `${fileMeta(kind).label} · ${formatSize(pdf.size)}`,
        icon: fileIconTypeOf(kind, pdf.title),
        entry: f,
      });
      continue;
    }
    // 나머지 json(lab_*.json 등) 중간 산출물은 목록에서 숨긴다
    if (f.name.toLowerCase().endsWith(".json")) continue;
    out.push({
      key: `${slug}-${f.name}`,
      title: f.name,
      subtitle: `${fileMeta(kind).label} · ${formatSize(f.size)}`,
      icon: fileIconTypeOf(kind, f.name),
      entry: f,
    });
  }
  if (exams.length > 0) {
    const main = exams.find((f) => f.name.endsWith(".json")) ?? exams[0];
    out.push({
      key: `${slug}-past-exams`,
      title: "기출 모음",
      subtitle: `기출 · 문서 ${exams.length}개`,
      icon: "exam",
      entry: main,
      bundle: true,
    });
  }
  return out;
};

// ── 문서 원문 파싱 (실패 시 null → pre-wrap 폴백) ─────────────
interface TranscriptBlock {
  speaker: string;
  time: string;
  text: string;
}

/** `참석자 N MM:SS` 헤더 줄 기준으로 전사본을 블록화 */
const parseTranscript = (
  raw: string
): { intro: string; blocks: TranscriptBlock[] } | null => {
  const header = /^(참석자\s*\d+)\s+(\d{1,3}:\d{2}(?::\d{2})?)\s*$/;
  const blocks: TranscriptBlock[] = [];
  const intro: string[] = [];
  let cur: TranscriptBlock | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(header);
    if (m) {
      if (cur) blocks.push(cur);
      cur = { speaker: m[1], time: m[2], text: "" };
    } else if (cur) {
      cur.text += (cur.text ? "\n" : "") + line;
    } else {
      intro.push(line);
    }
  }
  if (cur) blocks.push(cur);
  if (blocks.length < 2) return null;
  return {
    intro: intro.join("\n").trim(),
    blocks: blocks.map((b) => ({ ...b, text: b.text.trim() })),
  };
};

/** "MM:SS" 또는 "H:MM:SS" → 초 */
const timeToSeconds = (t: string): number => {
  const parts = t.split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

/** 슬라이드/기출 텍스트: `===PAGE N===` 마커 또는 단독 페이지 번호 줄로 분할 */
const parseSlidePages = (
  raw: string
): { page: string; text: string }[] | null => {
  if (raw.includes("===PAGE")) {
    const parts = raw.split(/===PAGE\s*(\d+)===/);
    const pages: { page: string; text: string }[] = [];
    for (let i = 1; i < parts.length; i += 2) {
      pages.push({ page: parts[i], text: (parts[i + 1] ?? "").trim() });
    }
    return pages.length > 0 ? pages : null;
  }
  const pages: { page: string; text: string }[] = [];
  let buf: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (/^\d{1,3}$/.test(line.trim()) && buf.join("").trim()) {
      pages.push({ page: line.trim(), text: buf.join("\n").trim() });
      buf = [];
    } else {
      buf.push(line);
    }
  }
  const rest = buf.join("\n").trim();
  if (rest) pages.push({ page: "", text: rest });
  return pages.length >= 2 ? pages : null;
};

const prettyJson = (raw: string): string | null => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return null;
  }
};

type RunUiState = "idle" | "running" | "done" | "failed";

// ── 실패 원인 매핑 (부록 A4 · 시나리오 S5) — logTail 패턴 → 한국어 안내 ──
type FailReason = "network" | "engine" | "limit" | "other";

const FAIL_MESSAGES: Record<FailReason, string> = {
  network:
    "인터넷 연결을 확인해주세요. 자료는 저장돼 있고, 연결되면 다시 분석할 수 있어요.",
  engine: "AI 엔진 연결이 필요해요. 설정에서 연결을 확인해주세요.",
  // Gemini 무료 티어의 분당 요청 한도(429). 앱이 자동 재시도하므로 정상 동작임을 안내.
  limit:
    "AI 사용량이 잠시 몰렸어요 — 1~2분 뒤 자동으로 다시 시도돼요. 자료는 안전하게 저장돼 있어요. (Gemini 무료 한도는 분당 요청 수 제한이 있어요)",
  other: "분석 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.",
};

const failReasonOf = (logTail: string): FailReason => {
  if (/fetch failed|ENOTFOUND|ETIMEDOUT|network/i.test(logTail)) return "network";
  // "Gemini API 키가 등록되어 있지 않습니다…"도 엔진 미연결 계열 (→ "설정 열기")
  if (/연결 필요|login|auth|API 키가 등록되어|API key not valid|invalid.*key/i.test(logTail))
    return "engine";
  // 429·RESOURCE_EXHAUSTED·quota·Too Many Requests·rate limit (Gemini 무료 티어 분당 한도)
  if (/429|RESOURCE_EXHAUSTED|Too Many Requests|quota|rate.?limit|exceeded.*(quota|limit)/i.test(logTail))
    return "limit";
  return "other";
};

/** 실패한 유닛 — 수업 화면·에이전트 화면의 실패 배너 + "다시 분석" 버튼 대상 */
interface AnalysisFailure {
  subject: string;
  unit: string;
  reason: FailReason;
  message: string;
}

// ── 업로드 거부 안내 (부록 A3 · 시나리오 S3) ──
const REJECT_MESSAGES: Record<string, string> = {
  audio:
    "녹음 원본은 아직 지원하지 않아요. 클로바노트 등으로 전사한 텍스트(.txt)를 올려주세요. (로컬 Whisper 전사 지원 예정)",
  unsupported: "지원하지 않는 파일 형식이에요 (.pdf .ppt .txt .md .png .jpg)",
};

const rejectionMessageOf = (rejected: RejectedFile[]): string | null => {
  if (rejected.length === 0) return null;
  const r = rejected.find((x) => x.reason === "audio") ?? rejected[0];
  return REJECT_MESSAGES[r.reason] ?? REJECT_MESSAGES.unsupported;
};

/** 분석 가능한 파일 — 과목 직속에 두면 보관만 되므로 수업 폴더로 옮겨 넣는 대상 */
const isAnalyzablePath = (p: string): boolean => /\.(pdf|pptx?|txt|md)$/i.test(p);

/** 과목 직속 폴더(goldset 루트 아님 · unit 아님) 여부 — folderKey에 "/"가 없다 */
const isSubjectDirect = (folder: string): boolean =>
  folder !== "" && !folder.includes("/");

// ── 신규 슬라이드 문서 자동 요약 (부록 A5) ──
const isSlideDocName = (name: string): boolean => /\.(pdf|pptx?)$/i.test(name);
const slideDocTagOf = (name: string): string =>
  name.replace(/\.(pdf|pptx?)$/i, "");

/** 자동/수동 공용 슬라이드 요약 작업 — busy면 큐에 쌓여 순차 실행 */
interface SlideJob {
  subject: string;
  unit: string;
  doc: string;
  /** 토스트에 보여줄 이름 (파일명 등) — 없으면 doc 태그 */
  label?: string;
}

/** 분석 대기 큐 항목 (부록 A4) */
interface PendingTarget {
  subject: string;
  unit: string;
}

/**
 * 수업 화면 세그먼트 네비 — 수업 단위 산출물만 남긴다.
 * 파일별 산출물(슬라이드 요약·전사)은 탭이 아니라 "파일을 연 화면"에서 본다.
 */
type Tab = "files" | "note" | "questions";
/** 에이전트는 수업 탭이 아니라 사이드바 전역 화면 */
type View =
  | "home"
  | "agent"
  | "exam"
  | "all"
  | "subject"
  | "lecture"
  | "trash";
type ViewMode = "grid" | "list";

const TABS: { id: Tab; label: string }[] = [
  { id: "files", label: "자료" },
  { id: "note", label: "강의 요약" },
  { id: "questions", label: "퀴즈" },
];

/**
 * 강의자료(PDF/PPT) 세부 페이지 상단 네비바 5탭.
 * 자료 하나 중심 뷰지만 데이터·분석 단위는 여전히 폴더(folderKey).
 */
type DetailTab = "slides" | "note" | "quiz" | "recording" | "chat";
const DETAIL_TABS: { id: DetailTab; label: string; badge?: string }[] = [
  { id: "slides", label: "슬라이드 설명" },
  { id: "note", label: "강의 요약" },
  { id: "quiz", label: "퀴즈" },
  { id: "recording", label: "녹음·필기" },
  { id: "chat", label: "AI 챗봇", badge: "준비 중" },
];

/**
 * 파일을 열었을 때 띄울 전용 화면 종류.
 * pdf → 슬라이드 리더(PDF 이미지) · slides → 슬라이드 텍스트/요약 카드 뷰(PPT)
 * · transcript → 전사 뷰어 · exam → 기출 뷰어 · text → 텍스트 뷰어
 */
type FileViewKind = "pdf" | "slides" | "transcript" | "exam" | "text";

const fileViewKindOf = (entry: FileEntry): FileViewKind => {
  // PPT/PPTX는 페이지 이미지 렌더가 어려워 슬라이드 텍스트·요약 카드 뷰로 연다
  if (isPptName(entry.name)) return "slides";
  // 업로드 PDF는 타입과 무관하게 슬라이드 리더로 연다 (기출 PDF 포함)
  if (isPdfName(entry.name)) return "pdf";
  const kind = kindOf(entry);
  if (kind === "theory" || kind === "practice") return "pdf";
  if (kind === "transcript") return "transcript";
  if (kind === "past_exam") return "exam";
  return "text";
};

/** 진행 스트립 문구 — 실행 로그의 레이어 태그를 사람 말로 옮긴다 */
const STEP_LABELS: { re: RegExp; label: string }[] = [
  // 429·한도 재시도 대기 — 멈춘 게 아니라 약 1분 뒤 자동 재시도 중임을 알린다
  { re: /429|RESOURCE_EXHAUSTED|quota|Too Many Requests|분당.*한도|자동 재시도|재시도/i, label: "사용량 한도 — 약 1분 뒤 자동으로 다시 시도해요" },
  { re: /^\[L4\]/, label: "예상문제 생성 중" },
  { re: /^\[L3\]/, label: "시험 신호 분석 중" },
  { re: /^\[L2\]/, label: "개념 추출 중" },
  { re: /^\[L1\]/, label: "자료 읽는 중" },
  { re: /^\[L0\]/, label: "자료 정리 중" },
];

const ONBOARD_KEY = "aone.onboarded.v1";
const SIDEBAR_KEY = "aone.sidebarCollapsed.v1";
const NOTIF_KEY = "aone.notifications.v1";
const NOTIF_MAX = 50;

/** 알림 센터 항목 — watcher/분석/요약/실패 이벤트가 누적된다 */
type NotifKind = "detected" | "analyzed" | "summarized" | "failed";
type AppNotification = {
  id: string;
  kind: NotifKind;
  text: string;
  /** 클릭 시 이동할 수업 폴더 (subject/unit) — 있으면 항목이 이동 버튼이 된다 */
  folderKey?: string;
  at: number;
  read: boolean;
};

/** at(ms) → "방금" · "3분 전" · "2시간 전" · "어제" 형태의 상대시간 */
const relTime = (at: number): string => {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 45) return "방금";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return d === 1 ? "어제" : `${d}일 전`;
};

/**
 * 현재 열려 있는 수업 — 매니페스트의 subject/unit 폴더 하나.
 * 파일시스템(goldset) 매니페스트가 단일 진실이다.
 */
interface Lecture {
  subject: string;
  unit: string;
  /** goldset 상대 경로 "{subject}/{unit}" — 업로드·삭제·원문 fetch 대상 */
  folderKey: string;
  /** 산출 파일명 키 "{subject}__{unit}" — 스냅샷·슬라이드·uploads 미러 */
  slug: string;
  /** 사용자에게 보이는 이름 = unit 폴더 이름 그대로 */
  name: string;
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  /** 과목 화면에서 열려 있는 과목 이름 (view === "subject") */
  const [activeSubject, setActiveSubject] = useState<string | null>(null);
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [tab, setTab] = useState<Tab>("files");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [files, setFiles] = useState<FilesManifest | null>(null);
  /** 능동 제안이 있는 수업 folderKey 집합 (사이드바 파란 점) */
  const [proactiveKeys, setProactiveKeys] = useState<Set<string>>(new Set());
  const [showAllProactive, setShowAllProactive] = useState(false);

  // 폴더 / 탐색 상태
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [creatingKind, setCreatingKind] = useState<"subject" | "unit">("subject");
  const [creatingAt, setCreatingAt] = useState<"sidebar" | "grid">("sidebar");
  const [newFolderName, setNewFolderName] = useState("");
  /** 사이드바 트리에서 접어둔 과목들 (기본: 모두 펼침) */
  const [closedSubjects, setClosedSubjects] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [toast, setToast] = useState<{
    message: string;
    /** 클릭 시 해당 수업/문서로 이동 (부록 A4) — 있으면 토스트가 버튼이 된다 */
    onClick?: () => void;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const newFolderRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 웹 데모 (브라우저) 전용 상태 ────────────────────────────
  /** 데스크톱 전용 기능 안내 모달 — 열려 있으면 기능 이름 */
  const [desktopOnlyFeature, setDesktopOnlyFeature] = useState<string | null>(
    null
  );
  /** 브라우저에서 사용자가 직접 연 PDF (blob URL) — 뷰어 전용, 분석 없음 */
  const [webPdf, setWebPdf] = useState<{ name: string; url: string } | null>(
    null
  );
  const [webPdfPage, setWebPdfPage] = useState(1);
  const webPdfInputRef = useRef<HTMLInputElement | null>(null);

  // 파일 전용 화면 — 자료 탭에서 파일을 열면 그 파일만 보는 풀 뷰로 전환
  const [openFile, setOpenFile] = useState<FileEntry | null>(null);
  const [docs, setDocs] = useState<DocsSnapshot | null>(null);
  const [docText, setDocText] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  /** 족보 폴더 뷰용 past_exam 원본 (연도별 카드 raw) */
  const [examFolderRaw, setExamFolderRaw] = useState<string | null>(null);

  // 슬라이드 리더 — 열린 PDF · 페이지 · 우측 패널
  const [pdfManifest, setPdfManifest] = useState<LecturePdfManifest | null>(null);
  const [slides, setSlides] = useState<SlideSummary[] | null>(null);
  const [docSummaries, setDocSummaries] = useState<DocSummary[]>([]);
  const [slideDocKey, setSlideDocKey] = useState<string | null>(null);
  const [docPage, setDocPage] = useState(1);
  const [docNumPages, setDocNumPages] = useState<number | null>(null);
  const [readerPanelOpen, setReaderPanelOpen] = useState(true);
  /** 리더 모드 썸네일 목차(좌측) 접기 — 접으면 PDF가 최대 폭을 갖는다 */
  const [readerTocOpen, setReaderTocOpen] = useState(true);
  /** 강의자료 세부 페이지 상단 네비바 활성 탭 (자료 열 때 항상 슬라이드 설명으로 시작) */
  const [detailTab, setDetailTab] = useState<DetailTab>("slides");
  /** [녹음·필기] 탭에서 펼쳐 본 전사/필기 파일명 + 원문 (탭 안에서만) */
  /** 근거 클릭으로 넘어온 전사 블록 앵커 — 도착하면 스크롤 + 강조 (FIX 14) */
  const [transcriptFocus, setTranscriptFocus] = useState<string | null>(null);
  /** 수업 전환이 끝나면 전사본을 열어야 하는 대기 요청 (FIX 14) */
  const [pendingTranscript, setPendingTranscript] = useState<{
    folderKey: string;
    anchor: string;
  } | null>(null);
  /** openFile 초기화가 끝난 뒤 열어야 하는 전사본 파일명 (FIX 14) */
  const [pendingRecDoc, setPendingRecDoc] = useState<string | null>(null);
  const [recDoc, setRecDoc] = useState<{ name: string; text: string | null } | null>(
    null
  );

  // 파일 삭제 — 카드 ⋯ 메뉴에서 연 확인 모달 대상
  const [pendingDelete, setPendingDelete] = useState<{
    folder: string;
    entry: FileEntry;
    title: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 폴더 이름 바꾸기 — ⋯ 메뉴에서 시작, 해당 행/카드가 인라인 입력으로 전환
  const [renamingFolder, setRenamingFolder] = useState<{
    folderKey: string;
    kind: "subject" | "unit";
    /** unit일 때 소속 과목 */
    subject: string | null;
    oldName: string;
    /** 입력으로 전환할 위치 — 사이드바 행 vs 과목 화면 카드 */
    origin: "sidebar" | "card";
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement | null>(null);

  // 전사 탭 — 녹음 원본 · 전사문 · 재생 위치
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [audioTime, setAudioTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 슬라이드 요약 라이브 생성 상태
  const [slideGenState, setSlideGenState] = useState<RunUiState>("idle");
  const slidePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const slideLogCursorRef = useRef(0);

  // 라이브 분석 상태
  const [desktop, setDesktop] = useState(false);
  const [activeEngine, setActiveEngineState] = useState<EngineChoice>("claude");
  const [runState, setRunState] = useState<RunUiState>("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 실패 UX (부록 A4) — folderKey → 실패 정보 (수업·에이전트 화면 배너)
  const [failures, setFailures] = useState<Record<string, AnalysisFailure>>({});
  /** 전역 진행 필의 빨간 실패 상태 — 3초 표시 후 사라진다 */
  const [failPill, setFailPill] = useState<string | null>(null);
  const failPillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 분석 대기 큐 (부록 A4) — 실행 중 watcher 이벤트가 오면 쌓고 완료 시 이어서
  const pendingTargetsRef = useRef<PendingTarget[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  /** startAnalysis 자기 참조 (큐 자동 이어달리기용) */
  const startAnalysisRef = useRef<
    ((subject: string, unit: string, auto?: boolean) => Promise<void>) | null
  >(null);

  // 슬라이드 요약 큐 (부록 A5) — 자동/수동 공용, busy면 순차 실행
  const slideBusyRef = useRef(false);
  const slideQueueRef = useRef<SlideJob[]>([]);
  const currentSlideJobRef = useRef<SlideJob | null>(null);
  const runSlideJobRef = useRef<((job: SlideJob) => Promise<void>) | null>(null);

  // 토스트 클릭 네비로 문서 리더까지 열기 위한 보류 상태
  const [pendingDocOpen, setPendingDocOpen] = useState<{
    folderKey: string;
    doc: string;
    /** 페이지 근거로 들어온 경우 그 페이지까지 이동한다 (없으면 1쪽) */
    page?: number;
  } | null>(null);

  /**
   * 페이지 근거로 들어온 목표 쪽 — 문서가 열린 뒤에 적용한다.
   * `slideDocKey`가 바뀌면 `docPage`가 1로 초기화되므로 그 다음 커밋에서 넣어야 한다.
   */
  const [pendingDocPage, setPendingDocPage] = useState<{
    doc: string;
    page: number;
  } | null>(null);

  // 진행 스트립 — 실행 중인 수업 · 현재 단계 · 경과 시간 · LLM 호출 수
  const [runTarget, setRunTarget] = useState<{
    subject: string;
    unit: string;
  } | null>(null);
  const [runStep, setRunStep] = useState<string>("분석 준비 중");
  const [runElapsed, setRunElapsed] = useState(0);
  const [runCalls, setRunCalls] = useState(0);
  const runStartRef = useRef<number | null>(null);
  const stepCursorRef = useRef(0);

  // 전역 에이전트 화면 — 모든 수업의 활동 이력 병합
  const [allActivities, setAllActivities] = useState<
    (Activity & { lectureName: string })[]
  >([]);
  const [allConcepts, setAllConcepts] = useState<
    (Concept & { lectureName: string })[]
  >([]);
  /** 전 수업의 능동 제안 — 에이전트 화면 상단 카드 */
  const [allProactive, setAllProactive] = useState<ProactiveItem[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);

  // 완료 안내 — 새로 만들어진 예상문제 수 (퀴즈 탭 NEW 배지)
  const [newQuestionCount, setNewQuestionCount] = useState(0);
  const questionCountRef = useRef(0);
  /** 슬라이드 폴링 정리 함수 참조 — [중지]가 아래 정의보다 먼저 선언되므로 ref로 우회 */
  const stopSlidePollingRef = useRef<(() => void) | null>(null);

  // 홈 화면 — 창 드롭 이미지를 시간표 인식 플로우로 넘긴다
  const homeRef = useRef<HomeViewHandle | null>(null);

  /** goldset 재스캔 → 매니페스트 상태 갱신 (홈의 과목 폴더 자동 생성 후 등) */
  const refreshManifest = useCallback(async () => {
    const json = await rescanFiles();
    setFiles(parseManifest(JSON.parse(json)));
  }, []);

  // watcher 능동 알림 · 자동 분석 가드
  const [watchBanner, setWatchBanner] = useState<string | null>(null);
  const watchBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analysisBusyRef = useRef(false);

  // 알림 센터 — 이벤트 누적(최근 50개) · 벨 드롭다운 · localStorage 영속
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const unreadCount = notifications.reduce((n, x) => n + (x.read ? 0 : 1), 0);

  const addNotification = useCallback(
    (kind: NotifKind, text: string, folderKey?: string) => {
      setNotifications((prev) =>
        [
          {
            id:
              typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind,
            text,
            folderKey,
            at: Date.now(),
            read: false,
          },
          ...prev,
        ].slice(0, NOTIF_MAX)
      );
    },
    []
  );

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  /** watcher 배너 표시 + 8초 후 자동 사라짐 (X로도 닫힘) */
  const showWatchBanner = useCallback((message: string | null) => {
    if (watchBannerTimerRef.current) {
      clearTimeout(watchBannerTimerRef.current);
      watchBannerTimerRef.current = null;
    }
    setWatchBanner(message);
    if (message) {
      watchBannerTimerRef.current = setTimeout(() => {
        setWatchBanner(null);
        watchBannerTimerRef.current = null;
      }, 8000);
    }
  }, []);

  // 온보딩 (최초 1회, 0 = 숨김)
  const [onboardStep, setOnboardStep] = useState(0);
  // 사용자 프로필 — localStorage 기반 (하드코딩 제거). 온보딩에서 이름 입력받음.
  const [userName, setUserName] = useState("사용자");
  const [userOrg, setUserOrg] = useState("");
  const [onboardName, setOnboardName] = useState("");

  // 시험 일정 (홈과 같은 localStorage 소스) — 사이드바 배지 · 시험 대비 화면 · 임박 배너
  const [exams, setExams] = useState<ExamInfo[]>([]);
  const [examBannerClosed, setExamBannerClosed] = useState(false);

  const lectureName = lecture?.name ?? "";
  /** 현재 수업 폴더 이름 — kind 판정에 넘긴다 (족보 폴더 규칙, R1) */
  const lectureFolder = lecture?.unit ?? "";
  /** 족보 폴더 — 3탭 대신 기출 뷰어로 분기 (부록 A안 §3).
   *  사용자가 "기출"·"exam"으로 만들어도 같게 본다 (R1) */
  const isExamFolder = isExamFolderName(lectureFolder);

  // 비동기 폴링 콜백이 재구독 없이 현재 수업을 읽도록 ref로 흘려둔다
  const lectureRef = useRef<Lecture | null>(null);
  lectureRef.current = lecture;

  useEffect(() => {
    const isDesktop = isTauriRuntime();
    setDesktop(isDesktop);
    setActiveEngineState(getActiveEngine());
    // 웹 데모에서만: 처음 열었을 때 시간표·시험·과제를 한 번 채운다 (데스크톱은 빈 상태 유지)
    seedWebDemoIfEmpty(isDesktop);
    setExams(loadExams());
    setUserName(getUserName());
    setUserOrg(getUserOrg());
    try {
      if (!localStorage.getItem(ONBOARD_KEY)) setOnboardStep(1);
      setSidebarCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
      const raw = localStorage.getItem(NOTIF_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setNotifications(parsed.slice(0, NOTIF_MAX));
      }
    } catch {
      // localStorage 사용 불가 시 온보딩 생략
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (slidePollRef.current) clearInterval(slidePollRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (failPillTimerRef.current) clearTimeout(failPillTimerRef.current);
      if (watchBannerTimerRef.current) clearTimeout(watchBannerTimerRef.current);
    };
  }, []);

  // 알림 변경 시 localStorage에 영속
  useEffect(() => {
    try {
      localStorage.setItem(NOTIF_KEY, JSON.stringify(notifications));
    } catch {
      // 저장 실패는 무시 — 세션 한정으로 유지
    }
  }, [notifications]);

  /** 지금 열린 파일의 전용 화면 종류 — 파일을 안 열었으면 null */
  const fileView = openFile ? fileViewKindOf(openFile) : null;

  /**
   * 강의자료(PDF/PPT)를 열면 = 세부 페이지 (상단 5탭 네비바).
   * 자료 하나 중심 뷰지만 데이터·분석 단위는 여전히 폴더.
   */
  const detailMode =
    view === "lecture" && (fileView === "pdf" || fileView === "slides");

  /**
   * PDF 리더 화면인가 (FIX 10).
   *
   * 예전에는 `detailTab === "slides"`까지 봤다. 그래서 탭을 옮기면 리더 골격이
   * 통째로 무너지고, 얇은 리더 헤더 → 검색 헤더로 바뀌면서 **탭 바가 30px 아래로 점프**했다
   * (실측: 슬라이드 설명 top=114, 나머지 탭 top=144).
   *
   * 이제 "PDF를 열었는가"만 본다. 탭을 옮겨도 헤더·여백·목차 사이드바가 그대로 유지되고,
   * 바뀌는 것은 우측 패널 내용뿐이다. PDF 캔버스 자체는 슬라이드 설명 탭에서만 그린다.
   */
  const readerMode = detailMode && fileView === "pdf";

  /**
   * PDF 캔버스가 실제로 그려지는 화면 (= 슬라이드 설명 탭).
   * 리더 골격(`readerMode`)은 탭과 무관하게 유지하되, "스크롤 없이 화면을 꽉 채운다"는
   * 규칙은 캔버스가 있을 때만 맞다. 다른 탭 내용은 길어질 수 있어 스크롤이 있어야 한다.
   */
  const readerCanvas = readerMode && detailTab === "slides";

  // 사이드바 폭 CSS 변수 — vibrancy 배경 오프셋(globals.css)과 동기화.
  // 리더 모드에서는 앱 사이드바 자리를 목차가 이어받는다 — 목차를 접으면 아이콘 폭만 남는다.
  const collapsedRail = readerMode ? !readerTocOpen : sidebarCollapsed;
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-w",
      collapsedRail ? "56px" : "228px"
    );
  }, [collapsedRail]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        // localStorage 사용 불가 시 세션 한정으로 유지
      }
      return next;
    });
  }, []);

  const finishOnboarding = useCallback(() => {
    // 온보딩에서 입력한 이름을 프로필로 저장 (비었으면 기본값 유지)
    if (onboardName.trim()) {
      saveUserProfile(onboardName);
      setUserName(getUserName());
    }
    try {
      localStorage.setItem(ONBOARD_KEY, "1");
    } catch {
      // 저장 실패해도 이번 세션에서는 닫는다
    }
    setOnboardStep(0);
  }, [onboardName]);

  // ⌘K → 검색바 포커스
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 알림 드롭다운 — 바깥 클릭 · Escape 닫힘
  useEffect(() => {
    if (!notifOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!notifRef.current?.contains(e.target as Node)) setNotifOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNotifOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [notifOpen]);

  // 새 폴더 입력 자동 포커스
  useEffect(() => {
    if (creatingFolder) newFolderRef.current?.focus();
  }, [creatingFolder]);

  // 이름 바꾸기 입력 자동 포커스 + 전체 선택
  useEffect(() => {
    if (renamingFolder) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renamingFolder]);

  const showToast = useCallback((message: string, onClick?: () => void) => {
    setToast({ message, onClick });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    // 클릭 가능한 토스트는 누를 시간을 조금 더 준다
    toastTimerRef.current = setTimeout(
      () => setToast(null),
      onClick ? 5000 : 2600
    );
  }, []);

  /** 웹 데모: 데스크톱 전용 기능 안내 모달 열기 */
  const showDesktopOnly = useCallback((feature: string) => {
    setDesktopOnlyFeature(feature);
  }, []);

  /** 웹 데모: 브라우저 파일 선택 → blob URL로 PdfViewer에 띄운다 (분석 없음) */
  const openWebPdf = useCallback(() => {
    webPdfInputRef.current?.click();
  }, []);

  /** 웹 데모: PDF 파일 하나를 blob URL로 열어 뷰어에 띄운다 (파일 선택·드롭 공용) */
  const showWebPdf = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setWebPdf((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { name: file.name, url };
    });
    setWebPdfPage(1);
  }, []);

  const handleWebPdfSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) showWebPdf(file);
    },
    [showWebPdf]
  );

  const closeWebPdf = useCallback(() => {
    setWebPdf((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  // 언마운트 시 blob URL 정리 (최신 값을 ref로 읽어 effect 재실행 없이 해제)
  const webPdfRef = useRef<{ name: string; url: string } | null>(null);
  webPdfRef.current = webPdf;
  useEffect(
    () => () => {
      if (webPdfRef.current) URL.revokeObjectURL(webPdfRef.current.url);
    },
    []
  );

  // 파일 매니페스트(§7) 로드 — 파일시스템(goldset)이 단일 진실.
  //
  // 웹에서만 정적 파일을 읽는다 (R3). 데스크톱에서는 아래 watcher effect의 rescanFiles()가
  // 실제 파일시스템을 스캔해 매니페스트를 만든다. 둘 다 무조건 돌면 순서 보장이 없어,
  // 정적 fetch가 나중에 끝나면 **낡은 빌드 시점 매니페스트로 덮어쓴다**
  // (사용자가 넣은 파일이 목록에서 사라진다). 런타임별로 하나만 돌게 한다.
  useEffect(() => {
    // `desktop` state는 다른 effect에서 비동기로 채워져 첫 렌더에 false다.
    // 여기서는 동기 판정(isTauriRuntime)을 직접 써서 경합 자체를 없앤다.
    if (isTauriRuntime()) return;
    fetch("/files.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (data) setFiles(parseManifest(data));
      })
      .catch(() => {});
  }, []);

  /** 매니페스트의 모든 수업(subject/unit) 평탄화 — 키·슬러그 포함 */
  const allUnits = useMemo(
    () =>
      (files?.subjects ?? []).flatMap((s) =>
        s.units.map((u) => ({
          subject: s.name,
          unit: u.name,
          order: u.order,
          entries: u.files,
          folderKey: folderKeyOf(s.name, u.name),
          slug: slugOf(s.name, u.name),
        }))
      ),
    [files]
  );

  // 강의 PDF 매니페스트 로드 (1회)
  useEffect(() => {
    fetch("/lecture-pdfs/manifest.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: LecturePdfManifest | null) => {
        if (data) setPdfManifest(data);
      })
      .catch(() => {});
  }, []);

  // 수업별 슬라이드 요약 로드
  useEffect(() => {
    if (!lecture) {
      setSlides([]);
      return;
    }
    let cancelled = false;
    setSlides(null);
    loadSnapshot("slides", lecture.subject, lecture.unit)
      .then((data) => {
        if (!cancelled) setSlides(Array.isArray(data) ? (data as SlideSummary[]) : []);
      })
      .catch(() => {
        if (!cancelled) setSlides([]);
      });
    // 자료 단위 요약은 없을 수 있다(구 분석본) — 없으면 쪽별 카드만 보여준다.
    loadSnapshot("docSummaries", lecture.subject, lecture.unit)
      .then((data) => {
        if (!cancelled) setDocSummaries(Array.isArray(data) ? (data as DocSummary[]) : []);
      })
      .catch(() => {
        if (!cancelled) setDocSummaries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lecture]);

  // 수업이 바뀌면 뷰어 상태 초기화
  useEffect(() => {
    setSlideDocKey(null);
    setDocPage(1);
    setDocNumPages(null);
    setReaderPanelOpen(true);
    setOpenFile(null);
    setSlideGenState((s) => (s === "running" ? s : "idle"));
  }, [lecture]);

  // 슬라이드 요약 탭: 문서를 바꾸면 1페이지부터
  useEffect(() => {
    setDocPage(1);
    setDocNumPages(null);
  }, [slideDocKey]);

  // 전사 탭: 녹음 원본(public/docs/{folderKey}/) 존재 여부 탐지
  useEffect(() => {
    setAudioSrc(null);
    if (!lecture) return;
    const folderKey = lecture.folderKey;
    let cancelled = false;
    (async () => {
      for (const cand of AUDIO_CANDIDATES) {
        const url = docUrl(folderKey, cand);
        // Tauri는 커맨드로 존재 확인, 웹은 HEAD (R3)
        if (await docExists(folderKey, cand, url)) {
          if (!cancelled) setAudioSrc(url);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lecture]);

  /**
   * 전 수업 스냅샷을 한 번에 읽어 두 곳에 쓴다.
   * 1) 사이드바 파란 점 — 능동 제안이 있는 수업
   * 2) 전역 에이전트 화면 — 모든 수업의 활동 이력·개념을 병합
   */
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      allUnits.map((u) =>
        loadSnapshot("analysis", u.subject, u.unit, reloadKey)
          .then((data) => ({ ...u, data: normalizeSnapshot(data) }))
          .catch(() => ({ ...u, data: null as Snapshot | null }))
      )
    ).then((results) => {
      if (cancelled) return;
      const proactive = new Set<string>();
      const activities: (Activity & { lectureName: string })[] = [];
      const concepts: (Concept & { lectureName: string })[] = [];
      // 에이전트 화면용 — 전 수업의 능동 제안을 병합 (본문 중복은 제거)
      const proactiveItems: ProactiveItem[] = [];
      const seenProactive = new Set<string>();
      for (const { subject, unit, order, folderKey, data } of results) {
        if (!data) continue;
        const name = `${subject} · ${unit}`;
        if (data.proactive.length > 0) proactive.add(folderKey);
        for (const a of data.activities) activities.push({ ...a, lectureName: name });
        for (const c of data.concepts) concepts.push({ ...c, lectureName: name });
        for (const p of data.proactive) {
          if (seenProactive.has(p.text)) continue;
          seenProactive.add(p.text);
          proactiveItems.push({ ...p, subject, unit, unitOrder: order, lectureName: name });
        }
      }
      // 시각 역순 — 최근 활동이 위로
      activities.sort((a, b) => b.ts.localeCompare(a.ts));
      concepts.sort((a, b) => b.examSignal - a.examSignal);
      // 최신 주차가 위로 (같은 주차면 원래 순서 유지)
      proactiveItems.sort((a, b) => b.unitOrder - a.unitOrder);
      setProactiveKeys(proactive);
      setAllActivities(activities);
      setAllConcepts(concepts);
      setAllProactive(proactiveItems);
    });
    return () => {
      cancelled = true;
    };
  }, [allUnits, reloadKey]);

  // 수업 스냅샷({slug}.json) 로드
  useEffect(() => {
    setError(null);
    if (!lecture) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    loadSnapshot("analysis", lecture.subject, lecture.unit, reloadKey)
      .then((data) => {
        const normalized = normalizeSnapshot(data);
        if (normalized == null) throw new Error("snapshot not found");
        return normalized;
      })
      .then((data: Snapshot) => {
        if (!cancelled) setSnapshot(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [lecture, reloadKey]);

  // 자료별 분석 상세(docs_{slug}.json) 로드
  useEffect(() => {
    setDocs(null);
    if (!lecture) return;
    let cancelled = false;
    loadSnapshot("docs", lecture.subject, lecture.unit, reloadKey)
      .then((data) => {
        if (!cancelled && data) setDocs(data as DocsSnapshot);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lecture, reloadKey]);

  /** 현재 수업의 매니페스트 파일 목록 */
  const lectureEntries = useMemo(
    () =>
      lecture
        ? allUnits.find((u) => u.folderKey === lecture.folderKey)?.entries ?? []
        : [],
    [lecture, allUnits]
  );

  /** [녹음·필기] 탭 목록 — 이 폴더의 전사본(.txt)·필기(.md) (오디오는 화이트리스트 밖) */
  const recordingEntries = useMemo(
    () =>
      lectureEntries.filter(
        (f) => isTranscript(f, lectureFolder) || /\.(md|txt)$/i.test(f.name)
      ),
    [lectureEntries]
  );


  // 세부 페이지를 닫거나 다른 자료로 바꾸면 [녹음·필기] 펼침 상태 초기화
  useEffect(() => {
    setRecDoc(null);
  }, [openFile, lecture]);

  // 위 초기화가 끝난 뒤 전사본을 연다 — 근거 클릭 경로 전용 (FIX 14)
  useEffect(() => {
    if (!pendingRecDoc) return;
    setRecDoc({ name: pendingRecDoc, text: null });
    setPendingRecDoc(null);
  }, [pendingRecDoc, openFile]);

  /**
   * 근거 클릭 → 그 수업의 전사본을 열고 해당 발화로 이동 (FIX 14).
   * 수업 전환 후 파일 목록이 준비되면 실행된다.
   */
  useEffect(() => {
    if (!pendingTranscript) return;
    // 수업 전환이 실제로 끝난 뒤에 연다 — 아니면 위의 "수업이 바뀌면 초기화"가
    // openFile을 다시 비운다 (pendingDocOpen과 같은 규칙).
    if (!lecture || lecture.folderKey !== pendingTranscript.folderKey) return;
    // kind가 비어 있어도 파일명으로 판정된다 (lib/file-kind.ts).
    const t =
      recordingEntries.find((f) => isTranscript(f, lectureFolder)) ??
      recordingEntries.find((f) => /\.txt$/i.test(f.name));
    if (!t) {
      setPendingTranscript(null); // 전사본이 없는 수업 — 조용히 취소
      return;
    }
    // 전사본 파일을 직접 열면 단독 뷰어(fileView==="transcript")로 가므로,
    // 5탭 세부 페이지를 열어 [녹음·필기] 탭 안에서 보여준다.
    // 이론 슬라이드를 우선 — 없으면 아무 PDF나
    const pdf =
      lectureEntries.find((f) => kindOf(f, lectureFolder) === "theory") ??
      lectureEntries.find((f) => isPdfName(f.name));
    if (!pdf) {
      setPendingTranscript(null);
      return;
    }
    setOpenFile(pdf);
    setDetailTab("recording");
    setTranscriptFocus(pendingTranscript.anchor);
    // recDoc은 openFile 변경이 만드는 초기화(위 effect)에 지워지므로
    // 그 커밋이 끝난 뒤 별도 요청으로 연다.
    setPendingRecDoc(t.name);
    setPendingTranscript(null);
  }, [pendingTranscript, lecture, recordingEntries, lectureEntries]);

  // 펼친 전사/필기 원문 로드 (탭 안에서만 — 폴더 folderKey 기준)
  useEffect(() => {
    if (!recDoc || recDoc.text !== null || !lecture) return;
    let cancelled = false;
    // Tauri에선 커맨드로, 웹에선 정적 경로로 (R3)
    loadDocText(
      lecture.folderKey,
      recDoc.name,
      docUrl(lecture.folderKey, recDoc.name)
    ).then((text) => {
      if (!cancelled) setRecDoc((d) => (d ? { ...d, text: text ?? "" } : d));
    });
    return () => {
      cancelled = true;
    };
  }, [recDoc, lecture]);

  // 토스트 클릭 네비 — 수업 전환 뒤 해당 문서 리더를 연다.
  // (위 "수업이 바뀌면 뷰어 상태 초기화" effect 다음에 선언되어 같은 커밋에서 이긴다)
  useEffect(() => {
    if (!pendingDocOpen) return;
    if (!lecture || lecture.folderKey !== pendingDocOpen.folderKey) return;
    const entry =
      lectureEntries.find(
        (f) => isPdfName(f.name) && uploadDocTagOf(f.name) === pendingDocOpen.doc
      ) ?? lectureEntries.find((f) => docKeyOf(f.name) === pendingDocOpen.doc);
    setSlideDocKey(pendingDocOpen.doc);
    if (entry) setOpenFile(entry);
    // 페이지 근거로 들어왔으면 그 쪽으로 이동한다.
    // slideDocKey 변경 effect가 docPage를 1로 되돌리므로 여기서 바로 넣으면 덮인다.
    // 문서가 실제로 열린 뒤 적용하도록 보류해 둔다 (pendingTranscript와 같은 방식).
    setPendingDocPage(
      pendingDocOpen.page && pendingDocOpen.page > 1
        ? { doc: pendingDocOpen.doc, page: pendingDocOpen.page }
        : null
    );
    setPendingDocOpen(null);
  }, [pendingDocOpen, lecture, lectureEntries]);

  // 페이지 근거 목표 쪽 적용 — 문서가 실제로 바뀐 뒤에 넣는다.
  // ("문서를 바꾸면 1페이지부터" effect보다 뒤에 선언되어 같은 커밋에서 이긴다)
  useEffect(() => {
    if (!pendingDocPage) return;
    if (slideDocKey !== pendingDocPage.doc) return;
    setDocPage(pendingDocPage.page);
    setPendingDocPage(null);
  }, [pendingDocPage, slideDocKey]);

  // 전사문 원문 로드 (전사 탭)
  useEffect(() => {
    setTranscriptText(null);
    if (!lecture) return;
    const entry = lectureEntries.find((f) => isTranscript(f, lectureFolder));
    if (!entry) return;
    let cancelled = false;
    loadDocText(
      lecture.folderKey,
      entry.name,
      docUrl(lecture.folderKey, entry.name)
    ).then((text) => {
      if (!cancelled && text !== null) setTranscriptText(text);
    });
    return () => {
      cancelled = true;
    };
  }, [lecture, lectureEntries]);

  // 열린 파일 원문 로드 (기출·텍스트 뷰어) — PDF·PPT·전사는 전용 소스를 쓴다
  // (PPT는 바이너리라 텍스트로 읽지 않고, 파이프라인 슬라이드 요약을 카드로 보여준다)
  useEffect(() => {
    if (!openFile || !lecture) return;
    const vk = fileViewKindOf(openFile);
    if (vk === "pdf" || vk === "slides") return;
    let cancelled = false;
    setDocText(null);
    setDocError(null);
    loadDocText(
      lecture.folderKey,
      openFile.name,
      docUrl(lecture.folderKey, openFile.name)
    ).then((text) => {
      if (cancelled) return;
      if (text === null) setDocError("파일을 읽지 못했습니다");
      else setDocText(text);
    });
    return () => {
      cancelled = true;
    };
  }, [openFile, lecture]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** 전역 진행 필의 빨간 실패 상태 — 3초 표시 후 자동으로 사라진다 (S5) */
  const showFailPill = useCallback((message: string) => {
    setFailPill(message);
    if (failPillTimerRef.current) clearTimeout(failPillTimerRef.current);
    failPillTimerRef.current = setTimeout(() => setFailPill(null), 3000);
  }, []);

  /** logTail 패턴 매핑으로 실패를 기록하고 실패 필을 띄운다 (S5) */
  const registerFailure = useCallback(
    (subject: string, unit: string, logTail: string) => {
      const reason = failReasonOf(logTail);
      const message = FAIL_MESSAGES[reason];
      setFailures((prev) => ({
        ...prev,
        [folderKeyOf(subject, unit)]: { subject, unit, reason, message },
      }));
      showFailPill(message);
    },
    [showFailPill]
  );

  const clearFailureOf = useCallback((subject: string, unit: string) => {
    const key = folderKeyOf(subject, unit);
    setFailures((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  /** 대기 큐(부록 A4)에서 다음 타깃을 꺼내 자동 시작 — 완료/실패 공통 */
  const startNextPending = useCallback(() => {
    const next = pendingTargetsRef.current.shift();
    setPendingCount(pendingTargetsRef.current.length);
    if (next) void startAnalysisRef.current?.(next.subject, next.unit, true);
  }, []);

  /**
   * 수업 분석 실행 + 완료 폴링 (수동 버튼·watcher 자동 트리거 공용).
   * 화면은 그대로 두고 상단 진행 스트립만 띄운다 — 로그는 주인공이 아니다.
   * 완료되면 스냅샷을 재로드하고 "결과"로 안내한다 (클릭 이동 토스트 + 퀴즈 탭 NEW 배지).
   */
  const startAnalysis = useCallback(
    async (subject: string, unit: string, auto = false) => {
      if (analysisBusyRef.current) {
        // 이미 다른 분석이 돌고 있음 — 수동 트리거엔 이유를 알린다 (자동은 대기열로)
        if (!auto) showToast("다른 분석이 진행 중이에요 — 끝나면 이어서 처리할게요");
        return;
      }
      analysisBusyRef.current = true;
      clearFailureOf(subject, unit);
      const before = questionCountRef.current;
      const slug = slugOf(subject, unit);
      try {
        await runFolderAnalysis(subject, unit, getActiveEngine());
        setRunState("running");
        setRunTarget({ subject, unit });
        setRunStep("분석 준비 중");
        setRunElapsed(0);
        setRunCalls(0);
        runStartRef.current = Date.now();
        stepCursorRef.current = 0;
        stopPolling();
        const analysisDeadline = Date.now() + 10 * 60 * 1000; // 최대 10분
        pollRef.current = setInterval(async () => {
          // 백엔드가 done/failed를 끝내 주지 않아도 busy가 영구 true가 되지 않게 한다
          if (Date.now() > analysisDeadline) {
            stopPolling();
            analysisBusyRef.current = false;
            setRunState("failed");
            registerFailure(subject, unit, "분석이 시간 내에 끝나지 않았어요 (10분 초과)");
            addNotification(
              "failed",
              `${unit} 분석이 시간 내에 끝나지 않았어요`,
              folderKeyOf(subject, unit)
            );
            if (auto) showWatchBanner(null);
            startNextPending();
            return;
          }
          try {
            const s = await analysisStatus();
            if (s.status === "done") {
              stopPolling();
              analysisBusyRef.current = false;
              setRunState("done");
              setReloadKey((k) => k + 1); // 스냅샷 재로드
              // 결과로 안내 — 새로 만들어진 예상문제 수를 세어 알린다
              try {
                const data = normalizeSnapshot(
                  await loadSnapshot("analysis", subject, unit, Date.now()),
                );
                const made = data ? data.questions.length : 0;
                setNewQuestionCount(made > before ? made - before : made);
                showToast(
                  made > 0
                    ? `예상문제 ${made}개가 만들어졌어요 — 퀴즈 탭에서 확인하세요`
                    : `${unit} 분석이 완료됐어요`,
                  () => selectUnit(subject, unit, made > 0 ? "questions" : "files")
                );
                addNotification(
                  "analyzed",
                  made > 0
                    ? `${unit} — 예상문제 ${made}개가 만들어졌어요`
                    : `${unit} 분석이 완료됐어요`,
                  folderKeyOf(subject, unit)
                );
              } catch {
                showToast(`${unit} 분석이 완료됐어요`, () =>
                  selectUnit(subject, unit)
                );
                addNotification(
                  "analyzed",
                  `${unit} 분석이 완료됐어요`,
                  folderKeyOf(subject, unit)
                );
              }
              if (auto) {
                showWatchBanner(
                  `${unit} 분석이 완료됐어요 — 강의 요약과 퀴즈가 갱신되었습니다`
                );
              }
              startNextPending();
            } else if (s.status === "failed") {
              stopPolling();
              analysisBusyRef.current = false;
              setRunState("failed");
              registerFailure(subject, unit, s.logTail || "");
              addNotification(
                "failed",
                `${unit} 분석에 실패했어요`,
                folderKeyOf(subject, unit)
              );
              if (auto) showWatchBanner(null);
              startNextPending();
            }
          } catch {
            // 폴링 실패는 다음 주기에 재시도
          }
        }, 2500);
      } catch (e) {
        analysisBusyRef.current = false;
        setRunState("failed");
        registerFailure(subject, unit, e instanceof Error ? e.message : String(e));
        addNotification(
          "failed",
          `${unit} 분석에 실패했어요`,
          folderKeyOf(subject, unit)
        );
        startNextPending();
      }
    },
    [
      stopPolling,
      showToast,
      clearFailureOf,
      registerFailure,
      startNextPending,
      addNotification,
      showWatchBanner,
    ]
  );
  startAnalysisRef.current = startAnalysis;

  const handleRunAnalysis = useCallback(() => {
    if (!desktop) {
      showDesktopOnly("자료 분석 실행");
      return;
    }
    if (!lecture) return;
    void startAnalysis(lecture.subject, lecture.unit);
  }, [desktop, showDesktopOnly, lecture, startAnalysis]);

  /** 진행 스트립 [중지] — Rust에서 Child를 kill하고 상태를 정리한다 */
  const handleStopRun = useCallback(async () => {
    const kind: LogKind = runState === "running" ? "analysis" : "slides";
    try {
      await stopAnalysis(kind);
    } catch (e) {
      showToast(userErrorMessage(e));
      return;
    }
    // 중지는 실패가 아니다 — 폴링을 먼저 끊고 상태를 idle로 되돌린다
    stopPolling();
    stopSlidePollingRef.current?.();
    analysisBusyRef.current = false;
    runStartRef.current = null;
    setRunState("idle");
    setSlideGenState("idle");
    setRunTarget(null);
    // 대기 큐도 함께 비운다 — 중지 후 몰래 이어달리지 않는다
    pendingTargetsRef.current = [];
    setPendingCount(0);
    slideQueueRef.current = [];
    slideBusyRef.current = false;
    currentSlideJobRef.current = null;
    showToast("분석을 중지했습니다");
  }, [runState, stopPolling, showToast]);

  // ── 슬라이드 요약 큐 (부록 A5) — 자동(watcher)·수동(버튼) 공용 실행기 ──

  /** 토스트 클릭 네비 — 해당 수업을 열고 문서 리더까지 이동 (부록 A4) */
  const openDocReader = useCallback(
    (subject: string, unit: string, doc: string) => {
      selectUnit(subject, unit);
      setPendingDocOpen({ folderKey: folderKeyOf(subject, unit), doc });
    },
    []
  );

  /** 슬라이드 요약 1건 실행 + 폴링 — 끝나면 큐의 다음 작업으로 이어달린다 */
  const runSlideJob = useCallback(
    async (job: SlideJob) => {
      slideBusyRef.current = true;
      currentSlideJobRef.current = job;
      setSlideGenState("running");
      slideLogCursorRef.current = 0;
      // 유닛 분석이 병행 중이면 진행 필 타이머는 분석 쪽을 유지한다
      if (!analysisBusyRef.current) {
        runStartRef.current = Date.now();
        setRunElapsed(0);
        setRunCalls(0);
      }
      const finish = () => {
        currentSlideJobRef.current = null;
        const next = slideQueueRef.current.shift();
        if (next) void runSlideJobRef.current?.(next);
        else slideBusyRef.current = false;
      };
      try {
        await runSlideSummarize(job.subject, job.unit, job.doc, getActiveEngine());
        stopSlidePollingRef.current?.();
        slidePollRef.current = setInterval(async () => {
          try {
            const chunk = await analysisLog("slides", slideLogCursorRef.current);
            slideLogCursorRef.current = chunk.nextLine;
            for (const raw of chunk.lines)
              if (/^\s+→/.test(raw)) setRunCalls((n) => n + 1);
          } catch {
            // 로그 폴링 실패는 무시 — 카운터만 멈춘다
          }
          try {
            const s = await slideSummarizeStatus();
            if (s.status === "done") {
              stopSlidePollingRef.current?.();
              setSlideGenState("done");
              const slug = slugOf(job.subject, job.unit);
              // 지금 보고 있는 수업이면 즉시 반영 (캐시버스터)
              if (lectureRef.current?.slug === slug) {
                try {
                  const data = await loadSnapshot(
                    "slides",
                    job.subject,
                    job.unit,
                    Date.now(),
                  );
                  if (Array.isArray(data)) setSlides(data as SlideSummary[]);
                } catch {
                  // 다음 수업 전환 시 자동 재로드
                }
              }
              showToast(
                `${job.label ?? job.doc} 슬라이드 요약이 준비됐어요`,
                () => openDocReader(job.subject, job.unit, job.doc)
              );
              addNotification(
                "summarized",
                `${job.label ?? job.doc} 슬라이드 요약이 준비됐어요`,
                folderKeyOf(job.subject, job.unit)
              );
              finish();
            } else if (s.status === "failed") {
              stopSlidePollingRef.current?.();
              setSlideGenState("failed");
              const message = FAIL_MESSAGES[failReasonOf(s.logTail || "")];
              showToast(message);
              showFailPill(message);
              addNotification(
                "failed",
                `${job.label ?? job.doc} 슬라이드 요약에 실패했어요`,
                folderKeyOf(job.subject, job.unit)
              );
              finish();
            }
          } catch {
            // 폴링 실패는 다음 주기에 재시도
          }
        }, 2500);
      } catch (e) {
        setSlideGenState("failed");
        const message =
          FAIL_MESSAGES[failReasonOf(e instanceof Error ? e.message : String(e))];
        showToast(message);
        showFailPill(message);
        addNotification(
          "failed",
          `${job.label ?? job.doc} 슬라이드 요약에 실패했어요`,
          folderKeyOf(job.subject, job.unit)
        );
        finish();
      }
    },
    [showToast, showFailPill, openDocReader, addNotification]
  );
  runSlideJobRef.current = runSlideJob;

  /** 요약 작업 추가 — slides 실행 중이면 큐(중복 제거) 후 순차 실행 */
  const enqueueSlideJob = useCallback((job: SlideJob) => {
    const same = (a: SlideJob, b: SlideJob) =>
      a.subject === b.subject && a.unit === b.unit && a.doc === b.doc;
    if (slideBusyRef.current) {
      if (currentSlideJobRef.current && same(currentSlideJobRef.current, job))
        return;
      if (!slideQueueRef.current.some((q) => same(q, job)))
        slideQueueRef.current.push(job);
      return;
    }
    void runSlideJobRef.current?.(job);
  }, []);

  /** watcher 신규 pdf/ppt(x) — 기존 요약이 없는 문서만 자동 요약 시작 (A5) */
  const enqueueSlideJobsForNewDocs = useCallback(
    async (subject: string, unit: string, files: string[]) => {
      const docs = files.filter(isSlideDocName);
      if (docs.length === 0) return;
      const slug = slugOf(subject, unit);
      let existing: SlideSummary[] = [];
      // 정적 경로가 아니라 Tauri 커맨드를 경유해야 데스크톱에서 중복 판정이 된다 (R3).
      // 이게 안 되면 같은 자료를 매번 다시 LLM 요약한다.
      const data = await loadSnapshot("slides", subject, unit, Date.now());
      if (Array.isArray(data)) existing = data as SlideSummary[];
      for (const name of docs) {
        const doc = slideDocTagOf(name);
        if (existing.some((s) => s.doc === doc)) continue; // 이미 요약 있음 → 스킵
        enqueueSlideJob({ subject, unit, doc, label: name });
      }
    },
    [enqueueSlideJob]
  );

  // Tauri 런타임: goldset 감시 시작 + 새 파일 감지 시 능동 분석·자동 요약
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    // 앱 시작 시 1회 재스캔 — 앱이 꺼진 사이 파일시스템 변화(삭제 포함)를 매니페스트에 반영
    rescanFiles()
      .then((json) => {
        if (!disposed) setFiles(parseManifest(JSON.parse(json)));
      })
      .catch(() => {});
    startGoldsetWatcher().catch(() => {});
    onFileAdded((payload) => {
      rescanFiles()
        .then((json) => setFiles(parseManifest(JSON.parse(json))))
        .catch(() => {});
      const name = payload.unit || payload.subject;
      // subject 직속 파일(unit="")은 분석 단위가 아니다 — 보관만
      if (!payload.unit) {
        showWatchBanner(`${name}에 새 자료가 감지됐어요`);
        addNotification("detected", `${name}에 새 자료가 감지됐어요`);
        return;
      }
      // A5: 신규 슬라이드 문서(pdf/ppt)는 유닛 분석과 병행으로 자동 요약
      void enqueueSlideJobsForNewDocs(payload.subject, payload.unit, payload.files);
      if (analysisBusyRef.current) {
        // A4: 분석 실행 중 — 대기 큐에 push (중복 제거), 완료 시 자동 이어달리기
        const key = folderKeyOf(payload.subject, payload.unit);
        if (
          !pendingTargetsRef.current.some(
            (t) => folderKeyOf(t.subject, t.unit) === key
          )
        ) {
          pendingTargetsRef.current.push({
            subject: payload.subject,
            unit: payload.unit,
          });
          setPendingCount(pendingTargetsRef.current.length);
        }
        showWatchBanner(
          `${name}에 새 자료가 감지됐어요 — 현재 분석이 끝나면 이어서 분석합니다`
        );
        addNotification(
          "detected",
          `${name}에 새 자료가 감지됐어요 — 대기 후 이어서 분석합니다`,
          folderKeyOf(payload.subject, payload.unit)
        );
      } else {
        showWatchBanner(
          `${name}에 새 자료가 감지됐어요 — 에이전트가 분석을 시작합니다`
        );
        addNotification(
          "detected",
          `${name}에 새 자료가 감지됐어요 — 분석을 시작합니다`,
          folderKeyOf(payload.subject, payload.unit)
        );
        void startAnalysis(payload.subject, payload.unit, true);
      }
    })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
      stopGoldsetWatcher().catch(() => {});
    };
  }, [
    desktop,
    startAnalysis,
    enqueueSlideJobsForNewDocs,
    addNotification,
    showWatchBanner,
  ]);

  // 현재 수업의 문항 수를 기억해 분석 완료 시 "새로 만들어진 수"를 계산한다
  useEffect(() => {
    questionCountRef.current = snapshot?.questions.length ?? 0;
  }, [snapshot]);

  // 진행 스트립 경과 시간 (실행 중에만 1초 갱신)
  useEffect(() => {
    if (runState !== "running" && slideGenState !== "running") return;
    const t = setInterval(() => {
      if (runStartRef.current)
        setRunElapsed(Math.floor((Date.now() - runStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [runState, slideGenState]);

  // 진행 스트립 단계 갱신 — 실행 로그를 파싱해 "개념 추출 중"처럼 사람 말로 옮긴다
  useEffect(() => {
    if (runState !== "running") return;
    const t = setInterval(async () => {
      try {
        const chunk = await analysisLog("analysis", stepCursorRef.current);
        stepCursorRef.current = chunk.nextLine;
        for (const raw of chunk.lines) {
          if (/^\s+→/.test(raw)) setRunCalls((n) => n + 1);
          const hit = STEP_LABELS.find((s) => s.re.test(raw));
          if (hit) setRunStep(hit.label);
        }
      } catch {
        // 다음 주기에 재시도
      }
    }, 1500);
    return () => clearInterval(t);
  }, [runState]);

  // 홈에서 시험을 추가·삭제할 수 있으므로, 화면을 옮길 때마다 시험 목록을 다시 읽는다
  useEffect(() => {
    setExams(loadExams());
  }, [view]);

  /** 다가오는 시험 중 가장 임박한 것 — 사이드바 배지 · 임박 배너의 기준 */
  const nextExam = useMemo(() => {
    const upcoming = exams
      .filter((e) => dday(e.date) >= 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0] ?? null;
  }, [exams]);

  const nextExamDday = nextExam ? dday(nextExam.date) : null;
  /** D-14 이내 = 시험 임박 (배지 · 능동 제안 배너) */
  const examImminent = nextExamDday !== null && nextExamDday <= 14;

  const noteHtml = useMemo(() => {
    if (!snapshot?.note?.markdown) return null;
    return marked.parse(snapshot.note.markdown, { async: false }) as string;
  }, [snapshot]);

  /** 카드 파싱이 되면 카드로, 안 되면 기존 통짜 마크다운으로 폴백한다 */
  /**
   * "노트만 없음"인가 (R7).
   *
   * L4.note가 실패하면 그 unit의 다른 산출물(개념·문항)은 살아 있는데 노트만 비어 있다.
   * 그냥 "아직 없습니다"라고 하면 분석을 안 돌린 것처럼 보여, 사용자가 다시 돌려도
   * 같은 자리에서 또 실패한다. 무엇이 됐고 무엇이 안 됐는지 구분해 보여준다.
   *
   * 판별 — 개념·문항은 있는데 노트가 없다. (분석 자체를 안 돌렸으면 개념도 0이다)
   */
  const noteOnlyMissing = useMemo(() => {
    if (!snapshot || snapshot.note?.markdown) return false;
    return snapshot.concepts.length > 0 || snapshot.questions.length > 0;
  }, [snapshot]);

  /** 노트 실패 사유 — 오케스트레이터가 활동 로그에 남긴다 (R7) */
  const noteFailureReason = useMemo(() => {
    if (!noteOnlyMissing) return null;
    const hit = (snapshot?.activities ?? []).find(
      (a) => /태스크 실패 — L4\.note|학습노트 실패/.test(a.text)
    );
    return hit?.text ?? null;
  }, [noteOnlyMissing, snapshot]);

  const noteHasCards = useMemo(
    () =>
      snapshot?.note?.markdown
        ? parseNoteCards(snapshot.note.markdown).cards.length > 0
        : false,
    [snapshot]
  );

  // 수업별 표시용 카드 (원본화 변환) — 개수·검색·목록이 모두 이 기준을 쓴다
  const displayFilesByKey = useMemo(() => {
    const m = new Map<string, DisplayFile[]>();
    for (const u of allUnits) {
      m.set(u.folderKey, displayFilesOf(u.slug, u.entries, pdfManifest));
    }
    return m;
  }, [allUnits, pdfManifest]);

  /** 폴더 직속 파일을 카드로 — goldset 루트·과목 직속 공용 */
  const plainFilesOf = useCallback(
    (key: string, entries: FileEntry[]): DisplayFile[] =>
      entries.map((entry) => ({
        key: `${key}/${entry.name}`,
        title: entry.name,
        subtitle: formatSize(entry.size),
        icon: fileIconTypeOf(entry.kind, entry.name),
        entry,
      })),
    []
  );

  /** 현재 수업의 자료 카드 */
  const lectureFiles = useMemo(() => {
    if (!lecture) return [];
    return displayFilesByKey.get(lecture.folderKey) ?? [];
  }, [lecture, displayFilesByKey]);

  /**
   * 족보 폴더의 스캔 이미지 (R7-7).
   * 예전에는 `ExamViewer`에 모듈 상수로 박혀 있어 **어떤 과목의 족보를 열어도**
   * 데이터통신 스캔 2장이 떴고, 사용자가 올린 스캔은 어디에도 안 나왔다.
   * 이제 매니페스트의 실제 파일에서 만든다.
   */
  const examImages = useMemo(() => {
    if (!lecture) return [];
    return lectureEntries
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name))
      .map((f) => ({
        src: docUrl(lecture.folderKey, f.name),
        // 파일명이 곧 라벨이다 — 확장자만 뗀다 (사용자가 붙인 이름을 존중)
        label: f.name.replace(/\.[^.]+$/, ""),
      }));
  }, [lecture, lectureEntries]);

  /** 족보 폴더 안의 past_exam 원본 파일 (연도별 카드용 raw) */
  const examFolderFile = useMemo(
    () => lectureFiles.find((d) => isPastExam(d.entry, lectureFolder)) ?? null,
    [lectureFiles]
  );

  // 족보 폴더 뷰 — past_exam 원본을 폴더 진입 시 미리 불러온다 (파일을 열지 않아도 카드 표시)
  useEffect(() => {
    if (!lecture || !isExamFolder || !examFolderFile) {
      setExamFolderRaw(null);
      return;
    }
    let cancelled = false;
    setExamFolderRaw(null);
    loadDocText(
      lecture.folderKey,
      examFolderFile.entry.name,
      docUrl(lecture.folderKey, examFolderFile.entry.name)
    ).then((text) => {
      if (!cancelled) setExamFolderRaw(text);
    });
    return () => {
      cancelled = true;
    };
  }, [lecture, isExamFolder, examFolderFile]);

  /** 루트 뷰에 함께 보여줄 goldset 루트 직속 파일 */
  const rootLooseFiles = useMemo(
    () => plainFilesOf("", files?.rootFiles ?? []),
    [plainFilesOf, files]
  );

  /** 과목 화면에 함께 보여줄 과목 직속 파일 (분석 단위는 아니고 보관만) */
  const subjectLooseFiles = useMemo(() => {
    if (!activeSubject) return [];
    const s = files?.subjects.find((x) => x.name === activeSubject);
    return plainFilesOf(activeSubject, s?.rootFiles ?? []);
  }, [plainFilesOf, files, activeSubject]);

  /** 전체 파일 수 — 표시 카드 수가 아니라 실제 파일 수 (R1) */
  const totalFileCount = useMemo(() => {
    let n = (files?.rootFiles ?? []).length;
    for (const s of files?.subjects ?? []) {
      n += (s.rootFiles ?? []).length;
      for (const u of s.units) n += u.files.length;
    }
    return n;
  }, [files]);

  const signalCount =
    snapshot?.concepts.filter((c) => c.examSignal > 0).length ?? 0;

  // 웹 데모에서는 버튼을 비활성 대신 살려둔다 — 누르면 안내 모달이 뜨는 편이
  // "왜 안 눌리지?"보다 친절하다. 데스크톱 동작은 그대로.
  const canRun = desktop
    ? lecture !== null && runState !== "running"
    : true;

  /** 지금 열린 수업의 실패 정보 — 수업 화면 상단 실패 배너 (S5) */
  const lectureFailure = lecture ? failures[lecture.folderKey] ?? null : null;

  /**
   * 전사본 경고 (R5) — 파이프라인이 활동 로그에 남긴 것을 화면으로 끌어올린다.
   * 이게 없으면 "분석 완료"인데 발화 근거가 0인 상태를 사용자가 알 수 없다.
   */
  const transcriptWarning = useMemo(() => {
    const hit = (snapshot?.activities ?? []).find((a) =>
      a.text.startsWith("전사본 경고 — ")
    );
    return hit ? hit.text.replace("전사본 경고 — ", "") : null;
  }, [snapshot]);
  /** 에이전트 화면에 보여줄 전체 실패 목록 */
  const failureList = useMemo(() => Object.values(failures), [failures]);

  // 에이전트 콘솔이 스트리밍할 실행 로그 종류 (없으면 활동 피드). 분석 우선.
  const agentRunKind: LogKind | null =
    runState !== "idle" ? "analysis" : slideGenState !== "idle" ? "slides" : null;

  const trimmedQuery = query.trim().toLowerCase();

  // 검색어 입력 시 문서 화면으로 전환 — 홈·휴지통 등에서도 검색이 항상 반응하게
  useEffect(() => {
    if (trimmedQuery === "") return;
    setView((v) =>
      v === "home" || v === "agent" || v === "exam" || v === "trash" ? "all" : v
    );
  }, [trimmedQuery]);

  const matchesQuery = useCallback(
    (name: string) =>
      trimmedQuery === "" || name.toLowerCase().includes(trimmedQuery),
    [trimmedQuery]
  );

  // ── 탐색 액션 ──────────────────────────────────────────────
  const resetScreen = () => {
    setOpenFile(null);
    setOpenQuestion(null);
    setShowAllProactive(false);
  };

  const goHome = () => {
    setView("all");
    setActiveSubject(null);
    setLecture(null);
    resetScreen();
  };

  const selectHome = () => {
    setView("home");
    setLecture(null);
    resetScreen();
  };

  /** 전역 에이전트 화면 — 실행 상태 · 전체 활동 이력 · 실행 로그 */
  const selectAgent = () => {
    setView("agent");
    setLecture(null);
    resetScreen();
  };

  /** 시험 대비 화면 — 우선 복습 · 전 범위 학습노트 · 전 범위 모의고사 */
  const selectExam = () => {
    setView("exam");
    setLecture(null);
    resetScreen();
  };

  const selectSubject = (name: string) => {
    setView("subject");
    setActiveSubject(name);
    setLecture(null);
    resetScreen();
  };

  /** 수업(subject/unit 폴더) 열기 */
  const selectUnit = (subject: string, unit: string, nextTab: Tab = "files") => {
    setLecture({
      subject,
      unit,
      folderKey: folderKeyOf(subject, unit),
      slug: slugOf(subject, unit),
      name: unit,
    });
    setActiveSubject(subject);
    setView("lecture");
    setTab(nextTab);
    resetScreen();
  };

  const selectTrash = () => {
    setView("trash");
    setLecture(null);
    resetScreen();
  };

  /** 알림 항목 클릭 — read 처리 + folderKey가 있으면 해당 수업으로 이동 */
  const openNotification = (n: AppNotification) => {
    setNotifications((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, read: true } : x))
    );
    setNotifOpen(false);
    if (!n.folderKey) return;
    const u = allUnits.find((x) => x.folderKey === n.folderKey);
    if (u) selectUnit(u.subject, u.unit);
  };

  /** 과목 추가(사이드바·루트) vs 주차 추가(과목 화면) — 구조 결정을 UI가 그대로 따른다 */
  const startCreateFolder = (kind: "subject" | "unit", at: "sidebar" | "grid") => {
    setCreatingKind(kind);
    setCreatingAt(at);
    setCreatingFolder(true);
    // 이름은 항상 빈 값에서 시작 — placeholder가 예시를 안내하고,
    // 빈 채로 blur하면 commitCreateFolder가 조용히 취소한다.
    setNewFolderName("");
  };

  const cancelCreateFolder = () => {
    setCreatingFolder(false);
    setNewFolderName("");
  };

  /**
   * 지정 폴더(goldset 상대경로 = folderKey)로 파일 업로드. ""이면 루트.
   * accept로 업로드 성격을 구분한다:
   *  - "material"(기본): 강의자료(PDF·PPT·이미지)만. 전사·필기(txt·md)는 거부하고 안내.
   *  - "note": 전사본·필기(txt·md)만 (세부페이지 "녹음·필기" 탭 전용).
   *  - "exam": 족보 폴더 — 기출은 PDF·스캔 사진·타이핑한 텍스트 어느 형태로든 오므로
   *    Rust 화이트리스트(pdf·ppt·txt·md·png·jpg) 전부를 그대로 받는다.
   * 전사 텍스트는 "어느 강의와 짝인지" 명확해야 하므로 세부페이지에서만 받는다.
   */
  const uploadTo = useCallback(
    async (folder: string, label: string, accept: "material" | "note" | "exam" = "material") => {
      if (!desktop) {
        // 웹 데모: 강의자료 업로드 자리에서는 "내 PDF 열어보기"로 체험을 잇고,
        // 전사본·필기(note)는 대체 체험이 없으므로 안내 모달만 띄운다.
        if (accept === "material") openWebPdf();
        else showDesktopOnly("전사본·필기 올리기");
        return;
      }
      const isNote = (n: string) => /\.(txt|md)$/i.test(n);
      try {
        const { copied, rejected } = await pickAndUploadFiles(folder);
        if (copied.length === 0 && rejected.length === 0) return; // 사용자가 취소
        // 성격에 안 맞는 파일은 되돌린다 (Rust 화이트리스트는 넓지만 UI에서 컨텍스트로 좁힘).
        // material 컨텍스트에선 전사·필기(txt·md) 거부, note 컨텍스트에선 그 외 거부.
        // exam(족보)은 형태를 가리지 않으므로 되돌리지 않는다.
        const misplaced =
          accept === "exam"
            ? []
            : copied.filter((n) => (accept === "material" ? isNote(n) : !isNote(n)));
        const good = copied.filter((n) => !misplaced.includes(n));
        for (const n of misplaced) {
          try { await deleteFile(folder, n); } catch { /* 정리 실패는 무시 */ }
        }
        if (good.length > 0 || misplaced.length > 0) {
          const json = await rescanFiles();
          setFiles(parseManifest(JSON.parse(json)));
        }
        if (misplaced.length > 0) {
          showToast(
            accept === "material"
              ? "전사본·필기(.txt·.md)는 강의 자료를 연 뒤 '녹음·필기' 탭에서 올려주세요."
              : "여기에는 전사본·필기(.txt·.md)만 올릴 수 있어요."
          );
          return;
        }
        const rejectMsg = rejectionMessageOf(rejected);
        showToast(rejectMsg ?? `${label}에 ${good.length}개 파일 추가됨`);
      } catch (e) {
        showToast(userErrorMessage(e));
      }
    },
    [desktop, showToast, openWebPdf, showDesktopOnly]
  );

  /**
   * 폴더 생성 = goldset에 실제 빈 폴더 즉시 생성 (파일시스템이 단일 진실).
   * 과목 추가(최상위) / 주차 추가(과목 하위) — 구조 결정 그대로.
   */
  const commitCreateFolder = () => {
    const name = newFolderName.trim().normalize("NFC");
    const kind = creatingKind;
    setCreatingFolder(false);
    setNewFolderName("");
    if (!name || name.includes("/")) return;
    if (!desktop) {
      showDesktopOnly("폴더 만들기");
      return;
    }
    const subject = kind === "unit" ? activeSubject : null;
    const key = subject ? folderKeyOf(subject, name) : name;
    // 새 과목이면 '족보' 폴더도 함께 생성 (기출 빈출 분석의 전제)
    const keys = subject ? [key] : [key, `${name}/족보`];
    void (async () => {
      try {
        await createSubjectFolders(keys);
        await refreshManifest();
        if (subject) selectUnit(subject, name);
        else selectSubject(name);
      } catch (e) {
        showToast(userErrorMessage(e));
      }
    })();
  };

  /** 폴더 이름 바꾸기 시작 — 해당 행/카드를 인라인 입력으로 전환 */
  const startRenameFolder = (target: {
    folderKey: string;
    kind: "subject" | "unit";
    subject: string | null;
    oldName: string;
    origin: "sidebar" | "card";
  }) => {
    if (!desktop) {
      showDesktopOnly("이름 바꾸기");
      return;
    }
    setRenamingFolder(target);
    setRenameValue(target.oldName);
  };

  const cancelRenameFolder = () => setRenamingFolder(null);

  /**
   * Rust rename_folder → 재스캔 → 선택 상태였으면 새 이름으로 유지.
   * 스냅샷·DB는 옛 이름 기준이라 다음 분석 때 새 이름으로 다시 만들어진다 — 토스트에 그대로 안내.
   */
  const commitRenameFolder = async () => {
    if (!renamingFolder) return;
    const target = renamingFolder;
    const newName = renameValue.trim().normalize("NFC");
    setRenamingFolder(null);
    if (!newName || newName.includes("/") || newName === target.oldName) return;
    try {
      await renameFolder(target.folderKey, newName);
      await refreshManifest();
      if (target.kind === "subject") {
        if (activeSubject === target.oldName) setActiveSubject(newName);
        if (lecture?.subject === target.oldName)
          setLecture({
            ...lecture,
            subject: newName,
            folderKey: folderKeyOf(newName, lecture.unit),
            slug: slugOf(newName, lecture.unit),
          });
      } else if (target.subject && lecture?.folderKey === target.folderKey) {
        setLecture({
          ...lecture,
          unit: newName,
          name: newName,
          folderKey: folderKeyOf(target.subject, newName),
          slug: slugOf(target.subject, newName),
        });
      }
      showToast("이름을 바꿨어요 — 분석 결과는 다음 분석 때 새 이름으로 정리돼요");
    } catch (e) {
      showToast(userErrorMessage(e));
    }
  };

  /** Rust trash_folder(goldset/.trash로 이동) → 재스캔 → 열려 있던 화면이면 상위로 */
  const trashFolderAction = async (target: {
    folderKey: string;
    kind: "subject" | "unit";
    subject: string | null;
    name: string;
  }) => {
    if (!desktop) {
      showDesktopOnly("폴더 삭제");
      return;
    }
    try {
      await trashFolder(target.folderKey);
      await refreshManifest();
      if (target.kind === "subject") {
        if (activeSubject === target.name) goHome();
      } else if (lecture?.folderKey === target.folderKey) {
        if (target.subject) selectSubject(target.subject);
        else goHome();
      }
      showToast("휴지통으로 옮겼어요");
    } catch (e) {
      showToast(userErrorMessage(e));
    }
  };

  /** 지금 열려 있는 위치 = 업로드 대상. [goldset 상대경로, 표시 이름] */
  const uploadTarget = useMemo<[string, string]>(() => {
    if (view === "lecture" && lecture) return [lecture.folderKey, lecture.name];
    if (view === "subject" && activeSubject) return [activeSubject, activeSubject];
    return ["", "모든 문서"]; // 루트
  }, [view, lecture, activeSubject]);

  /**
   * 지금 열려 있는 위치로 업로드. 과목 직속은 분석 단위가 아니므로
   * 업로드하지 않고 "먼저 폴더를 만들어 주세요"라고 안내한다.
   */
  const handleUpload = useCallback(() => {
    const [folder, label] = uploadTarget;
    // 과목 직속 업로드는 분석 단위가 아니라 보관 — 폴더를 먼저 만들라고 안내
    if (view === "subject" && isSubjectDirect(folder)) {
      showToast(
        "먼저 수업/자료 폴더를 만들고 그 안에 넣어주세요 — 폴더 단위로 분석해요"
      );
      return;
    }
    // 족보 폴더는 기출 원문(PDF·스캔 사진·타이핑 텍스트)을 형태 구분 없이 받는다
    void uploadTo(folder, label, isExamFolder ? "exam" : "material");
  }, [view, uploadTo, uploadTarget, showToast, isExamFolder]);

  // ── 창 드래그&드롭 업로드 — 지금 열려 있는 폴더로 들어간다 ──
  const [dragOver, setDragOver] = useState(false);
  const uploadTargetRef = useRef(uploadTarget);
  uploadTargetRef.current = uploadTarget;
  // 드롭 핸들러가 재구독 없이 현재 뷰를 읽도록 ref로 흘려둔다
  const viewRef = useRef(view);
  viewRef.current = view;

  const isImagePath = (p: string): boolean =>
    /\.(jpe?g|png)$/i.test(p);

  /**
   * 웹 데모: 브라우저 창에 파일을 떨어뜨리면 기본 동작(그 파일로 페이지 이동)이 일어나
   * 앱이 사라진다. 이를 막고, PDF면 뷰어로 열어 데스크톱과 같은 흐름을 준다.
   */
  useEffect(() => {
    if (desktop) return;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (/\.pdf$/i.test(file.name)) showWebPdf(file);
      else
        showToast(
          "웹 데모에서는 PDF만 열어볼 수 있어요 — 자료 업로드와 분석은 데스크톱 앱에서 동작합니다."
        );
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [desktop, showWebPdf, showToast]);

  useEffect(() => {
    if (!desktop) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const un = await onWindowFileDrop({
        onHover: () => setDragOver(true),
        onCancel: () => setDragOver(false),
        onDrop: (paths) => {
          setDragOver(false);
          // 홈에서는 이미지 = 시간표 인식 플로우 (업로드가 아니다)
          if (viewRef.current === "home") {
            const img = paths.find(isImagePath);
            if (img) {
              const name = img.split("/").pop() ?? img;
              // 절대 경로를 넘겨야 데모 매칭 실패 시 실인식(A2)으로 넘어간다
              homeRef.current?.recognizeTimetable(name, 0, img);
            } else {
              showToast("시간표 캡처 이미지(jpg·png)를 올려주세요.");
            }
            return;
          }
          const [folder, label] = uploadTargetRef.current;
          void (async () => {
            try {
              // 과목 직속 드롭은 분석 단위가 아니다 — 보관하되 폴더 생성을 안내
              if (isSubjectDirect(folder)) {
                showToast(
                  "먼저 수업/자료 폴더를 만들고 그 안에 넣어주세요 — 폴더 단위로 분석해요"
                );
                return;
              }
              const { copied, rejected } = await dropFiles(paths, folder);
              if (copied.length === 0 && rejected.length === 0) return;
              if (copied.length > 0) {
                const json = await rescanFiles();
                setFiles(parseManifest(JSON.parse(json)));
              }
              const rejectMsg = rejectionMessageOf(rejected);
              showToast(rejectMsg ?? `${label}에 ${copied.length}개 파일 추가됨`);
            } catch (e) {
              showToast(userErrorMessage(e));
            }
          })();
        },
      });
      if (cancelled) un();
      else unlisten = un;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [desktop, showToast]);

  const showQuestionFromBanner = (id: string) => {
    setTab("questions");
    setOpenQuestion(id);
  };

  const showQuestionFromDoc = (id: string) => {
    setOpenFile(null);
    setTab("questions");
    setOpenQuestion(id);
  };

  /** 퀴즈 탭이 지목된 문항을 펼치고 나면 포커스 요청을 비운다 */
  const clearOpenQuestion = useCallback(() => setOpenQuestion(null), []);

  // ── 슬라이드 요약 탭 파생값 ───────────────────────────────
  /**
   * 이 수업의 PDF 문서들 — 요약이 없어도 목록에 뜬다.
   * 두 출처를 합친다:
   *  1) 매니페스트(골드셋 강의 PDF) — 기존 동작 그대로
   *  2) 사용자가 올린 PDF (files.json) — Rust rescan이 public/uploads/로 미러링해 둔 것
   * 업로드 PDF의 doc 키 = 확장자 뗀 파일명 (파이프라인 --doc 태그와 동일).
   */
  const lectureDocs = useMemo(() => {
    if (!lecture) return [];
    const slug = lecture.slug;
    // ppt=true → 페이지 이미지가 없는 슬라이드 문서(요약 카드 뷰). file은 원본 다운로드/열기 링크.
    const docs: { key: string; pdf: LecturePdfEntry; ppt?: boolean }[] = [];

    // 1) 강의 PDF 매니페스트 (키 = slug)
    for (const [key, pdf] of Object.entries(pdfManifest?.[slug] ?? {})) {
      if (pdf.available) docs.push({ key, pdf });
    }

    // 2) 업로드 PDF·PPT — 매니페스트가 이미 덮은 doc 키는 건너뛴다
    for (const f of lectureEntries) {
      const isPpt = isPptName(f.name);
      if (!isPdfName(f.name) && !isPpt) continue;
      const key = uploadDocTagOf(f.name);
      if (docs.some((d) => d.key === key)) continue;
      docs.push({
        key,
        // PPT는 이미지 미러가 없으므로 원본 파일 경로(docUrl)를 file로 둔다 (열기/다운로드용)
        pdf: {
          file: isPpt
            ? docUrl(lecture.folderKey, f.name)
            : uploadPdfUrl(slug, f.name),
          title: f.name,
          size: f.size,
          available: true,
        },
        ppt: isPpt,
      });
    }

    const rank = (k: string) => (k.startsWith("theory") ? 0 : 1); // 이론 → 실습 순
    return docs.sort(
      (a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key)
    );
  }, [lecture, pdfManifest, lectureEntries]);

  /** 선택 문서 — 미선택이면 첫 번째 문서 */
  const activeDocKey = useMemo(() => {
    if (lectureDocs.length === 0) return null;
    if (slideDocKey && lectureDocs.some((d) => d.key === slideDocKey))
      return slideDocKey;
    return lectureDocs[0].key;
  }, [lectureDocs, slideDocKey]);

  const activeDocPdf = useMemo(
    () => lectureDocs.find((d) => d.key === activeDocKey)?.pdf ?? null,
    [lectureDocs, activeDocKey]
  );

  /** 현재 선택 문서가 PPT(슬라이드 텍스트/요약 카드 뷰)인지 */
  const activeDocIsPpt = useMemo(
    () => lectureDocs.find((d) => d.key === activeDocKey)?.ppt ?? false,
    [lectureDocs, activeDocKey]
  );

  // PDF 로드용 URL — 새 레이아웃(Tauri)은 uploads 미러가 없으므로 원본 바이트를
  // read_doc_bytes로 받아 blob URL을 만든다. 브라우저·개발 폴백은 웹 URL 그대로.
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!activeDocPdf || activeDocIsPpt || !lecture) {
      setPdfBlobUrl(null);
      return;
    }
    let revoke = () => {};
    let cancelled = false;
    void loadDocUrl(lecture.folderKey, activeDocPdf.title, activeDocPdf.file)
      .then(({ url, revoke: r }) => {
        revoke = r;
        if (cancelled) r();
        else setPdfBlobUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPdfBlobUrl(activeDocPdf.file); // 실패 시 웹 URL 폴백
      });
    return () => {
      cancelled = true;
      revoke();
    };
  }, [activeDocPdf, activeDocIsPpt, lecture]);

  /** PdfViewer에 넘길 실제 URL (blob 우선, 준비 전엔 웹 URL) */
  const pdfViewUrl = pdfBlobUrl ?? activeDocPdf?.file ?? "";

  /**
   * 원본 파일 열기/내려받기 (R3).
   * 데스크톱에선 `/uploads/...`·`/docs/...` 정적 경로가 없어 404였다.
   * Tauri에서는 원본 바이트를 blob으로 받아 내려준다. 웹은 기존 URL 그대로.
   */
  const openOriginalDoc = useCallback(
    async (doc: { file: string; title: string }) => {
      if (!lecture) return;
      try {
        const { url, revoke } = await loadDocUrl(
          lecture.folderKey,
          doc.title,
          doc.file
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = doc.title;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // blob URL은 다운로드가 시작된 뒤 해제한다 (즉시 해제하면 취소된다)
        window.setTimeout(revoke, 10_000);
      } catch {
        showToast("원본 파일을 열지 못했습니다");
      }
    },
    [lecture, showToast]
  );

  /** 지금 보고 있는 자료의 전체 요약 (없으면 null — 구 분석본) */
  const activeDocSummary = useMemo(
    () => docSummaries.find((d) => d.doc === activeDocKey) ?? null,
    [docSummaries, activeDocKey],
  );

  const docSlides = useMemo(() => {
    if (!activeDocKey || !slides) return [];
    return slides
      .filter((s) => s.doc === activeDocKey)
      .sort((a, b) => a.page - b.page);
  }, [activeDocKey, slides]);

  const currentSlide = useMemo(
    () => docSlides.find((s) => s.page === docPage) ?? null,
    [docSlides, docPage]
  );

  /**
   * 슬라이드 신호 오버레이 (부록 A안 §2) — 개념명 문자열 매칭.
   * 슬라이드의 제목·요약·핵심포인트에 스냅샷 개념명이 들어 있으면
   * 그 개념의 신호 레벨을 이 페이지에 얹는다. (정밀 매핑 아님, 가벼운 힌트)
   */
  const slideSignalByPage = useMemo(() => {
    const out = new Map<
      number,
      { level: SignalLevel; concepts: { name: string; level: SignalLevel }[] }
    >();
    const concepts = snapshot?.concepts ?? [];
    if (concepts.length === 0) return out;
    for (const s of docSlides) {
      const hay = [s.title_ko, s.summary_ko, ...s.key_points_ko].join(" ");
      const matched: { name: string; level: SignalLevel; sig: number }[] = [];
      for (const c of concepts) {
        // 개념명 자체 또는 괄호 앞 핵심 토큰이 슬라이드 텍스트에 등장하면 매칭
        const token = c.name.split(/[(（]/)[0].trim();
        if (token.length >= 2 && hay.includes(token)) {
          matched.push({ name: c.name, level: signalLevel(c.examSignal), sig: c.examSignal });
        }
      }
      if (matched.length === 0) continue;
      matched.sort((a, b) => b.sig - a.sig);
      out.set(s.page, {
        level: matched[0].level,
        concepts: matched.slice(0, 4).map((m) => ({ name: m.name, level: m.level })),
      });
    }
    return out;
  }, [docSlides, snapshot]);

  const currentSlideSignal = currentSlide
    ? slideSignalByPage.get(currentSlide.page) ?? null
    : null;

  /**
   * 썸네일 목차 항목 — 요약이 있으면 제목·시험팁을 얹고,
   * 없으면 PDF 페이지 수만으로 목차를 만든다 (미리보기는 항상 보인다).
   * signal: 시험팁 있으면 high, 아니면 매칭 개념의 최고 신호 레벨.
   */
  const tocItems = useMemo(() => {
    const byPage = new Map(docSlides.map((s) => [s.page, s]));
    const total = docNumPages ?? (docSlides.at(-1)?.page ?? 0);
    return Array.from({ length: total }, (_, i) => {
      const p = i + 1;
      const s = byPage.get(p);
      const examTip = Boolean(s?.exam_tip);
      const sig = slideSignalByPage.get(p);
      const signal: SignalLevel | undefined = examTip
        ? "high"
        : sig?.level;
      return {
        page: p,
        title: s?.title_ko,
        examTip,
        signal,
      };
    });
  }, [docSlides, docNumPages, slideSignalByPage]);

  /** 슬라이드 요약 라이브 생성 — Rust run_slide_summarize + 폴링 */
  const stopSlidePolling = useCallback(() => {
    if (slidePollRef.current) {
      clearInterval(slidePollRef.current);
      slidePollRef.current = null;
    }
  }, []);
  stopSlidePollingRef.current = stopSlidePolling;

  /** 수동 "슬라이드 요약 생성" 버튼 — 공용 큐 실행기(runSlideJob)로 위임 */
  const handleGenerateSlides = useCallback(async () => {
    if (!desktop) {
      showDesktopOnly("슬라이드별 설명 만들기");
      return;
    }
    if (!lecture || !activeDocKey || slideGenState === "running")
      return;
    enqueueSlideJob({
      subject: lecture.subject,
      unit: lecture.unit,
      doc: activeDocKey,
      label: activeDocPdf?.title ?? activeDocKey,
    });
  }, [
    lecture,
    activeDocKey,
    activeDocPdf,
    desktop,
    showDesktopOnly,
    slideGenState,
    enqueueSlideJob,
  ]);

  // ── 전사 탭 파생값 ────────────────────────────────────────
  const transcriptBody = useMemo(
    () => (transcriptText ? parseTranscript(transcriptText) : null),
    [transcriptText]
  );

  const transcriptDetail = docs?.bySource.transcript ?? null;

  /**
   * 전사본 뷰어에 넘길 강조·시험언급 발화 (FIX 14).
   * locator는 형식에 따라 시각("02:21") 또는 줄번호("#L75")로 저장돼 있고,
   * locatorToAnchor가 둘 다 블록 앵커로 바꿔준다.
   */
  const transcriptHighlights = useMemo(() => {
    if (!transcriptDetail) return [];
    const out: TranscriptHighlight[] = [];
    const push = (q: DocQuote, kind: "emphasis" | "exam") => {
      const anchor = locatorToAnchor(q.locator ?? "");
      if (anchor) out.push({ anchor, quote: q.quote ?? "", kind });
    };
    for (const q of transcriptDetail.emphasis ?? []) push(q, "emphasis");
    for (const q of transcriptDetail.examHints ?? []) push(q, "exam");
    return out;
  }, [transcriptDetail]);

  /** 재생 중인 발화 블록 — 오디오가 없으면 -1 (하이라이트 없음) */
  const activeBlockIdx = useMemo(() => {
    if (!audioSrc || !transcriptBody) return -1;
    let idx = -1;
    transcriptBody.blocks.forEach((b, i) => {
      if (timeToSeconds(b.time) <= audioTime) idx = i;
    });
    return idx;
  }, [audioSrc, transcriptBody, audioTime]);

  // ── 열린 파일(기출·텍스트) 본문 파싱 ───────────────────────
  const docBody = useMemo(() => {
    if (!openFile || docText === null) return null;
    const fileKind = kindOf(openFile, lectureFolder);
    // 기출은 전용 뷰어가 렌더한다 (원시 JSON 노출 금지)
    if (fileKind === "past_exam") return { kind: "exam" as const };
    if (openFile.name.endsWith(".json")) {
      const pretty = prettyJson(docText);
      return { kind: "code" as const, text: pretty ?? docText };
    }
    if (fileKind === "transcript") {
      const t = parseTranscript(docText);
      if (t) return { kind: "transcript" as const, ...t };
    } else {
      const pages = parseSlidePages(docText);
      if (pages) return { kind: "pages" as const, pages };
    }
    return { kind: "plain" as const, text: docText };
  }, [openFile, docText, lectureFolder]);

  const docDetail =
    openFile && docs
      ? docs.bySource[SOURCE_OF_FILE_TYPE[kindOf(openFile, lectureFolder)] ?? "slide"]
      : null;

  const openFileDisplay = openFile
    ? lectureFiles.find((d) => d.entry.name === openFile.name) ?? null
    : null;

  /**
   * 자료 카드 클릭 → 그 파일 전용 화면(풀 뷰)을 연다.
   * PDF면 슬라이드 리더가 뜨도록 선택 문서 키까지 맞춘다.
   */
  const openFileFromCard = (entry: FileEntry) => {
    if (isPdfName(entry.name) || isPptName(entry.name)) {
      // 업로드 PDF·PPT — doc 키는 확장자 뗀 파일명
      setSlideDocKey(uploadDocTagOf(entry.name));
    } else if (entry.kind === "theory" || entry.kind === "practice") {
      const dk = docKeyOf(entry.name);
      if (dk) setSlideDocKey(dk);
    }
    // 세부 페이지는 항상 [슬라이드 설명] 탭부터
    setDetailTab("slides");
    setOpenFile(entry);
  };

  // ── AI 분석 패널 (자료별 개념·강조·시험 언급) ─────────────
  const renderAiPanel = (detail: DocSourceDetail | null) => {
    if (!detail) {
      return (
        <p className="text-sm text-gray-400">
          {docs
            ? "이 자료에 대한 분석 결과가 없습니다."
            : "이 폴더는 아직 분석 전입니다."}
        </p>
      );
    }
    const concepts = [...detail.concepts].sort(
      (a, b) => b.importance - a.importance
    );
    const questions = snapshot
      ? detail.questionIds
          .map((id) => snapshot.questions.find((q) => q.id === id))
          .filter((q): q is Question => q !== undefined)
      : [];
    return (
      <div className="space-y-5">
        {/* 개념 칩 */}
        <div>
          <p className="mb-2 text-xs font-semibold text-gray-500">
            추출된 개념 · {detail.concepts.length}
          </p>
          <div className="flex flex-wrap gap-2">
            {concepts.map((c) => {
              const meta = signalMeta(c.examSignal);
              return (
                <span
                  key={c.name}
                  className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-3 py-1.5 text-xs font-medium text-gray-700"
                >
                  {c.name}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
                  >
                    {meta.label}
                  </span>
                </span>
              );
            })}
            {concepts.length === 0 && (
              <span className="text-xs text-gray-400">
                추출된 개념이 없습니다.
              </span>
            )}
          </div>
        </div>

        {/* 교수 강조 */}
        <div className="border-t border-black/5 pt-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-500">
            <Zap className="h-3.5 w-3.5 text-amber-500" aria-hidden />
            교수 강조 · {detail.emphasis.length}
          </p>
          {detail.emphasis.length > 0 ? (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {detail.emphasis.map((s, i) => (
                <li
                  key={i}
                  className="rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-xs text-gray-600"
                >
                  <span className="font-mono text-primary/80">[{s.locator}]</span>{" "}
                  &ldquo;{s.quote}&rdquo;
                  <span className="ml-1 text-gray-400">— {s.concept}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">강조 인용이 없습니다.</p>
          )}
        </div>

        {/* 시험 언급 */}
        <div className="border-t border-black/5 pt-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-500">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" aria-hidden />
            시험 언급 · {detail.examHints.length}
          </p>
          {detail.examHints.length > 0 ? (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {detail.examHints.map((s, i) => (
                <li
                  key={i}
                  className="rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-xs text-gray-600"
                >
                  <span className="font-mono text-primary/80">[{s.locator}]</span>{" "}
                  &ldquo;{s.quote}&rdquo;
                  <span className="ml-1 text-gray-400">— {s.concept}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">시험 언급 인용이 없습니다.</p>
          )}
        </div>

        {/* 관련 퀴즈 */}
        <div className="border-t border-black/5 pt-4">
          <p className="mb-2 text-xs font-semibold text-gray-500">
            관련 퀴즈 · {questions.length}
          </p>
          {questions.length > 0 ? (
            <ul className="space-y-1.5">
              {questions.map((q) => (
                <li key={q.id}>
                  <button
                    onClick={() => showQuestionFromDoc(q.id)}
                    className="press-scale flex w-full items-baseline justify-between gap-2 rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-left text-xs text-gray-700 transition-colors duration-200 hover:bg-primary/10 hover:text-gray-900"
                  >
                    <span>{q.q}</span>
                    <span className="shrink-0 text-primary" aria-hidden>
                      →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-400">관련 퀴즈가 없습니다.</p>
          )}
        </div>
      </div>
    );
  };

  // 슬라이드 요약 카드 — 현재 페이지 요약
  const slideCurrentCard = currentSlide ? (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
        현재 페이지 · p.{currentSlide.page}
      </p>
      <h3
        className="text-sm font-bold text-gray-900"
        data-testid="slide-summary-title"
      >
        {currentSlide.title_ko}
      </h3>
      {currentSlide.summary_ko && (
        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-700">
          {currentSlide.summary_ko}
        </p>
      )}
      {currentSlideSignal && currentSlideSignal.concepts.length > 0 && (
        <div className="mt-2.5" data-testid="slide-signal-concepts">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            이 페이지 신호 개념
          </p>
          <div className="flex flex-wrap gap-1.5">
            {currentSlideSignal.concepts.map((sc) => {
              const meta = signalMetaOf(sc.level);
              return (
                <span
                  key={sc.name}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} aria-hidden />
                  {sc.name}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {currentSlide.key_points_ko.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {currentSlide.key_points_ko.map((k, i) => (
            <li
              key={i}
              className="flex gap-1.5 text-xs leading-relaxed text-gray-600"
            >
              <span
                className="mt-[6px] inline-block h-1 w-1 shrink-0 rounded-full bg-primary/60"
                aria-hidden
              />
              {k}
            </li>
          ))}
        </ul>
      )}
      {currentSlide.diagram_ko && (
        <p className="mt-2.5 rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-xs leading-relaxed text-gray-600">
          <span className="font-semibold text-gray-700">도식 · </span>
          {currentSlide.diagram_ko}
        </p>
      )}
      {currentSlide.exam_tip && (
        <p className="mt-2.5 rounded-lg border border-amber-300/60 bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-800">
          <span className="font-semibold">⚠️ 시험 팁 · </span>
          {currentSlide.exam_tip}
        </p>
      )}
      {currentSlide.lecture_ref && (
        <p className="mt-2 text-[11px] text-gray-400">
          강의 참조 · {currentSlide.lecture_ref}
        </p>
      )}
    </div>
  ) : (
    <p className="rounded-xl bg-black/[0.03] px-3 py-2.5 text-xs text-gray-400">
      p.{docPage}에 대한 요약이 없습니다.
    </p>
  );

  // ── 파생: 현재 화면 데이터 ─────────────────────────────────
  interface FolderCard {
    kind: "subject" | "unit";
    id: string;
    name: string;
    sub: string;
    /** unit 카드일 때 소속 과목 */
    subject?: string;
    /** unit 카드일 때 folderKey (능동 제안 점 표시용) */
    folderKey?: string;
    /** 실제 파일 수 — 표시 카드 수와 다르다 (족보 폴더는 여러 파일이 카드 1장) */
    fileCount: number;
  }

  /** 루트 레벨: 과목 폴더들 (매니페스트 subjects) */
  const rootFolderCards: FolderCard[] = useMemo(
    () =>
      (files?.subjects ?? []).map((s) => {
        // "파일 N개"는 실제 파일 수다 — 표시 카드 수가 아니다 (R1).
        // 족보처럼 여러 파일을 카드 1장으로 합치는 폴더가 있어 둘이 다르다.
        let n = s.rootFiles.length;
        for (const u of s.units) n += u.files.length;
        return {
          kind: "subject" as const,
          id: `subject-${s.name}`,
          name: s.name,
          fileCount: n,
          sub: `폴더 ${s.units.length}개 · 파일 ${n}개`,
        };
      }),
    [files, displayFilesByKey]
  );

  /** 과목 내부: 수업(unit) 폴더들 — unit_order 순 */
  const subjectFolderCards: FolderCard[] = useMemo(() => {
    if (!activeSubject) return [];
    return allUnits
      .filter((u) => u.subject === activeSubject)
      .map((u) => ({
        kind: "unit" as const,
        id: u.folderKey,
        subject: u.subject,
        folderKey: u.folderKey,
        name: u.unit,
        fileCount: u.entries.length,
        sub: `파일 ${u.entries.length}개`,
      }));
  }, [activeSubject, allUnits, displayFilesByKey]);

  const filteredRootCards = rootFolderCards.filter((c) => matchesQuery(c.name));
  const filteredSubjectCards = subjectFolderCards.filter((c) =>
    matchesQuery(c.name)
  );

  /** 모든 문서 화면에서 검색 시: 전 수업 파일도 함께 검색 (표시 제목 기준) */
  const globalFileMatches = useMemo(() => {
    if (trimmedQuery === "") return [];
    const out: (DisplayFile & {
      subject: string;
      unit: string;
      folderKey: string;
    })[] = [];
    for (const u of allUnits) {
      for (const d of displayFilesByKey.get(u.folderKey) ?? []) {
        if (d.title.toLowerCase().includes(trimmedQuery))
          out.push({ ...d, subject: u.subject, unit: u.unit, folderKey: u.folderKey });
      }
    }
    return out;
  }, [allUnits, displayFilesByKey, trimmedQuery]);

  const filteredLectureFiles = lectureFiles.filter((d) => matchesQuery(d.title));

  const showLectureScreen = view === "lecture" && lecture !== null;
  /** 파일 전용 화면(슬라이드 리더·전사 뷰어)은 세로 공간이 귀하다 — 배너를 한 줄로 접는다 */
  const readerTab = fileView === "pdf" || fileView === "transcript";

  /** 능동 제안 — 개념 칩으로 요약해 배너 하나로 합친다 */
  const proactiveChips = useMemo(
    () => (snapshot?.proactive ?? []).map(toProactiveChip),
    [snapshot]
  );
  /** 배너의 [예상문제 보기]가 열어줄 첫 문항 */
  const proactiveFirstQuestionId = useMemo(
    () => proactiveChips.find((c) => c.questionIds.length > 0)?.questionIds[0] ?? null,
    [proactiveChips]
  );

  // 패널 헤더 타이틀/카운트
  const panelTitle =
    view === "all"
      ? "모든 문서"
      : view === "subject"
        ? activeSubject ?? "폴더"
        : view === "lecture"
          ? lectureName
          : view === "trash"
            ? "휴지통"
            : "폴더";

  const panelSub =
    view === "all"
      ? `폴더 ${rootFolderCards.length}개, 파일 ${totalFileCount}개`
      : view === "subject"
        ? `폴더 ${subjectFolderCards.length}개, 파일 ${subjectFolderCards.reduce(
            (n, c) => n + c.fileCount,
            subjectLooseFiles.length
          )}개`
        : view === "lecture"
          ? `파일 ${lectureEntries.length}개`
          : view === "trash"
            ? "삭제된 항목이 여기에 보관됩니다"
            : "폴더 0개, 파일 0개";

  // 브레드크럼 (모든 문서 / 과목 / 수업)
  const breadcrumb: { label: string; onClick?: () => void }[] = (() => {
    const items: { label: string; onClick?: () => void }[] = [
      { label: "모든 문서", onClick: goHome },
    ];
    if (view === "subject" && activeSubject) items.push({ label: activeSubject });
    else if (view === "lecture" && lecture) {
      items.push(
        { label: lecture.subject, onClick: () => selectSubject(lecture.subject) },
        { label: lecture.name }
      );
    }
    return items;
  })();

  const openFileFromSearch = (d: DisplayFile & { subject: string; unit: string }) => {
    selectUnit(d.subject, d.unit);
    setTimeout(() => openFileFromCard(d.entry), 0);
  };

  /**
   * 시험 임박 능동 제안 배너 (D-14 이내, 홈 상단).
   * 범위 선택 상태는 시험 대비 화면이 알고 있으므로 여기서는 중립 문구만 쓴다.
   */
  const examBanner = nextExam && nextExamDday !== null && (
    <div
      className="glass-card flex items-center gap-4 rounded-2xl border border-primary/20 bg-primary/[0.06] px-5 py-4"
      data-testid="exam-imminent-banner"
    >
      {/* 알림 아이콘 */}
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/25"
        aria-hidden
      >
        <BellRing className="h-5 w-5 text-white" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold leading-snug text-gray-900">
          {nextExam.subject} 시험이 {nextExamDday}일 남았어요
        </p>
        <p className="mt-1 truncate text-[12.5px] leading-snug text-gray-500">
          시험 대비 학습노트와 우선 복습 개념이 준비돼 있어요
        </p>
      </div>

      <button
        onClick={selectExam}
        data-testid="exam-banner-cta"
        className="press-scale shrink-0 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover"
      >
        시험 대비 시작
      </button>
      <button
        onClick={() => setExamBannerClosed(true)}
        aria-label="배너 닫기"
        className="shrink-0 rounded-md p-1 text-gray-400 transition-colors duration-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );

  // ── 렌더 조각 ─────────────────────────────────────────────
  /**
   * 파일 카드. hover 시 우상단 ⋯ 메뉴(열기·삭제)가 뜬다.
   * 카드 본체는 button, 메뉴는 형제 요소로 둔다 (버튼 중첩 금지).
   * `folder`가 없으면 삭제 대상 폴더를 특정할 수 없으므로 메뉴를 달지 않는다.
   */
  const renderFileCard = (
    d: DisplayFile,
    opts: { badge?: string; onClick: () => void; key: string; folder?: string }
  ) => {
    const badge = d.badge ?? opts.badge;
    const menu = opts.folder !== undefined && !d.bundle ? (
      <FileCardMenu
        title={d.title}
        variant={viewMode}
        canDelete={desktop}
        onOpen={opts.onClick}
        onDelete={() => {
          if (!desktop) {
            showDesktopOnly("파일 삭제");
            return;
          }
          setPendingDelete({
            folder: opts.folder as string,
            entry: d.entry,
            title: d.title,
          });
        }}
      />
    ) : null;
    return viewMode === "grid" ? (
      <div key={opts.key} className="group relative">
        <button
          onClick={opts.onClick}
          title={d.title}
          className="glass-card glass-card-hover w-full cursor-pointer rounded-2xl p-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <div className="mb-4 flex items-start justify-between">
            <FileIcon type={d.icon} />
            {badge && (
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary group-hover:opacity-0">
                {badge}
              </span>
            )}
          </div>
          <p className="truncate text-sm font-semibold text-gray-900">{d.title}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-gray-400">
            {d.subtitle}
            <ArrowUpRight
              className="h-3.5 w-3.5 text-primary opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              aria-hidden
            />
          </p>
        </button>
        {menu}
      </div>
    ) : (
      <div key={opts.key} className="group relative">
        <button
          onClick={opts.onClick}
          title={d.title}
          className="glass-card glass-card-hover flex w-full cursor-pointer items-center gap-4 rounded-2xl px-4 py-3 pr-12 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <FileIcon type={d.icon} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-gray-900">
              {d.title}
            </span>
            <span className="mt-0.5 block text-xs text-gray-400">{d.subtitle}</span>
          </span>
          {badge && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
              {badge}
            </span>
          )}
          {!menu && (
            <ArrowUpRight
              className="h-4 w-4 shrink-0 text-primary opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              aria-hidden
            />
          )}
        </button>
        {menu}
      </div>
    );
  };

  /** 삭제 확인 → Rust delete_file → rescan → 카드 갱신 */
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteFile(pendingDelete.folder, pendingDelete.entry.name);
      const json = await rescanFiles();
      setFiles(parseManifest(JSON.parse(json)));
      if (openFile?.name === pendingDelete.entry.name) setOpenFile(null);
      showToast(`${pendingDelete.title} 파일을 삭제했습니다`);
      setPendingDelete(null);
    } catch (e) {
      showToast(userErrorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  const renderFolderCard = (card: FolderCard) => {
    const onClick = () => {
      if (card.kind === "subject") selectSubject(card.name);
      else if (card.subject) selectUnit(card.subject, card.name);
    };
    const Icon =
      card.name === "족보"
        ? ScrollText
        : card.kind === "subject"
          ? FolderOpen
          : Folder;
    const dot =
      card.kind === "unit" &&
      card.folderKey !== undefined &&
      proactiveKeys.has(card.folderKey);
    const iconBox = (
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10"
        aria-hidden
      >
        <Icon className="h-5 w-5 text-primary" />
      </span>
    );

    // 유닛 카드(과목 화면)만 ⋯ 메뉴 — 사이드바와 같은 이름 바꾸기·삭제
    const unitKey =
      card.kind === "unit" && card.subject !== undefined
        ? card.folderKey
        : undefined;

    // 이름 바꾸는 중이면 카드가 인라인 입력으로 전환
    if (
      unitKey !== undefined &&
      renamingFolder?.folderKey === unitKey &&
      renamingFolder.origin === "card"
    ) {
      const input = (
        <input
          ref={renameRef}
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRenameFolder();
            if (e.key === "Escape") cancelRenameFolder();
          }}
          onBlur={commitRenameFolder}
          className="w-full bg-transparent text-sm font-semibold text-gray-900 focus:outline-none"
        />
      );
      return viewMode === "grid" ? (
        <div
          key={card.id}
          className="glass-card rounded-2xl p-5 ring-1 ring-primary/30"
        >
          <div className="mb-4 flex items-start justify-between">{iconBox}</div>
          {input}
          <p className="mt-1 text-xs text-gray-400">{card.sub}</p>
        </div>
      ) : (
        <div
          key={card.id}
          className="glass-card flex w-full items-center gap-4 rounded-2xl px-4 py-3 ring-1 ring-primary/30"
        >
          {iconBox}
          <span className="min-w-0 flex-1">
            {input}
            <span className="mt-0.5 block text-xs text-gray-400">
              {card.sub}
            </span>
          </span>
        </div>
      );
    }

    const menu =
      unitKey !== undefined && card.subject !== undefined ? (
        <FolderMenu
          name={card.name}
          className={
            viewMode === "grid"
              ? "right-2.5 top-2.5"
              : "right-2.5 top-1/2 -translate-y-1/2"
          }
          confirmDelete={desktop}
          onRename={() =>
            startRenameFolder({
              folderKey: unitKey,
              kind: "unit",
              subject: card.subject!,
              oldName: card.name,
              origin: "card",
            })
          }
          onTrash={() =>
            void trashFolderAction({
              folderKey: unitKey,
              kind: "unit",
              subject: card.subject!,
              name: card.name,
            })
          }
        />
      ) : null;

    return viewMode === "grid" ? (
      <div key={card.id} className="group relative">
        <button
          onClick={onClick}
          title={card.name}
          className="glass-card glass-card-hover w-full cursor-pointer rounded-2xl p-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <div className="mb-4 flex items-start justify-between">
            {iconBox}
            {dot && (
              <span
                className="mt-1 inline-block h-2 w-2 rounded-full bg-primary shadow-glow transition-opacity duration-200 group-hover:opacity-0"
                title="능동 제안 있음"
                aria-label="능동 제안 있음"
              />
            )}
          </div>
          <p className="truncate text-sm font-semibold text-gray-900">
            {card.name}
          </p>
          <p className="mt-1 text-xs text-gray-400">{card.sub}</p>
        </button>
        {menu}
      </div>
    ) : (
      <div key={card.id} className="group relative">
        <button
          onClick={onClick}
          title={card.name}
          className={`glass-card glass-card-hover flex w-full cursor-pointer items-center gap-4 rounded-2xl px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
            menu ? "pr-12" : ""
          }`}
        >
          {iconBox}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-gray-900">
              {card.name}
            </span>
            <span className="mt-0.5 block text-xs text-gray-400">
              {card.sub}
            </span>
          </span>
          {dot && (
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-primary shadow-glow"
              title="능동 제안 있음"
              aria-label="능동 제안 있음"
            />
          )}
        </button>
        {menu}
      </div>
    );
  };

  const emptySearchState =
    trimmedQuery !== "" ? (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-black/5 bg-white/70 shadow-sm">
          <Search className="h-6 w-6 text-gray-300" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-gray-700">
          &ldquo;{query.trim()}&rdquo;에 대한 검색 결과가 없습니다
        </p>
        <p className="mt-1 text-xs text-gray-400">
          다른 검색어로 다시 시도해보세요.
        </p>
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-black/5 bg-white/70 shadow-sm">
          <FolderOpen className="h-6 w-6 text-gray-300" aria-hidden />
        </div>
        <p className="text-sm font-semibold text-gray-700">
          아직 자료가 없어요
        </p>
        <p className="mt-1 text-xs text-gray-400">
          {desktop
            ? "강의 자료를 드래그하거나 업로드하면 에이전트가 알아서 정리합니다."
            : "웹 데모에서는 내 PDF를 열어 뷰어를 체험해보실 수 있어요. 분석은 데스크톱 앱에서 동작합니다."}
        </p>
        {!desktop && (
          <button
            onClick={openWebPdf}
            data-testid="web-pdf-open-empty"
            className="press-scale mt-5 flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover"
          >
            <FileText className="h-4 w-4" aria-hidden />
            PDF 열어보기
          </button>
        )}
      </div>
    );

  /** 탭 빈 상태 공용 */
  const emptyTabState = (
    icon: React.ReactNode,
    title: string,
    desc: string,
    action?: React.ReactNode,
    testId?: string
  ) => (
    <div
      className="flex flex-col items-center justify-center py-24 text-center"
      data-testid={testId}
    >
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-black/5 bg-white/70 shadow-sm">
        {icon}
      </div>
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-gray-400">
        {desc}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );

  /** "이 수업 분석하기" 버튼 */
  const analyzeButton = (
    <button
      onClick={handleRunAnalysis}
      disabled={!canRun}
      title={
        !desktop
          ? "웹 데모 — 분석은 데스크톱 앱에서 동작해요"
          : "자료를 다시 분석합니다"
      }
      className="press-scale flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {runState === "running" ? (
        <>
          <span className="spinner" aria-hidden />
          분석 중…
        </>
      ) : (
        <>
          <Sparkles className="h-4 w-4" aria-hidden />지금 분석하기
        </>
      )}
    </button>
  );

  const gridClass =
    viewMode === "grid"
      ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      : "flex flex-col gap-2.5";

  // ────────────────────────────────────────────────────────────
  return (
    <div
      className="app-shell flex h-screen overflow-hidden"
      data-tauri-drag-region
    >
      {/* 드래그&드롭 오버레이 — 창 위로 파일을 끌어오면 표시 */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-primary/[0.06] backdrop-blur-[2px]">
          <div className="glass-panel flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-primary/50 px-12 py-10">
            <Upload className="h-9 w-9 text-primary" aria-hidden />
            <p className="text-base font-semibold text-gray-900">
              {uploadTarget[1]}에 놓기
            </p>
            <p className="text-sm text-gray-500">
              강의 자료·전사본(.txt)·기출을 끌어다 놓으면 에이전트가 분석합니다
            </p>
            <p className="text-xs text-gray-400">
              허용 형식 · .pdf .ppt .pptx .txt .md .png .jpg (오디오 파일 제외)
            </p>
          </div>
        </div>
      )}

      {/* ── 좌측 사이드바 — 리더 모드에서는 슬라이드 목차로 교체 ── */}
      <aside
        className={`sidebar-connected z-20 flex shrink-0 flex-col transition-[width] duration-300 ${
          collapsedRail ? "w-[56px]" : "w-[228px]"
        }`}
      >
        {readerMode ? (
          /* ── 슬라이드 목차 사이드바 (앱 사이드바 자리 교체) — 접으면 아이콘 레일 ── */
          readerTocOpen ? (
            <>
              <div
                className="sidebar-brand flex flex-col gap-2 px-3 pb-2 pt-6"
                data-tauri-drag-region
              >
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setOpenFile(null)}
                    data-testid="reader-exit"
                    className="press-scale flex min-w-0 flex-1 items-center gap-1.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-semibold text-gray-600 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate">닫기</span>
                  </button>
                  <button
                    onClick={() => setReaderTocOpen(false)}
                    data-testid="reader-toc-toggle"
                    title="목차 접기"
                    aria-label="목차 접기"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />
                  </button>
                </div>
                <p
                  className="truncate px-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400"
                  title={activeDocPdf?.title}
                >
                  {activeDocPdf?.title ?? lectureName} · 목차
                </p>
              </div>

              <div className="mx-3 mb-2 h-px bg-black/[0.06]" />

              {/* 페이지 미리보기 썸네일 목차 */}
              {activeDocPdf ? (
                <PdfThumbStrip
                  key={activeDocPdf.file}
                  url={pdfViewUrl}
                  items={tocItems}
                  page={docPage}
                  onPageChange={setDocPage}
                />
              ) : (
                <p className="px-4 py-3 text-xs leading-relaxed text-gray-400">
                  강의자료(PDF)를 올리면 페이지 미리보기가 표시됩니다.
                </p>
              )}
            </>
          ) : (
            /* 목차 접힘 — 아이콘 레일 (나가기 · 목차 펼치기) */
            <div
              className="sidebar-brand flex flex-col items-center gap-1.5 px-2 pb-2 pt-6"
              data-tauri-drag-region
            >
              <button
                onClick={() => setOpenFile(null)}
                data-testid="reader-exit"
                title="닫기"
                aria-label="닫기"
                className="press-scale flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <ArrowLeft className="h-[18px] w-[18px]" aria-hidden />
              </button>
              <button
                onClick={() => setReaderTocOpen(true)}
                data-testid="reader-toc-toggle"
                title="목차 펼치기"
                aria-label="목차 펼치기"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden />
              </button>
            </div>
          )
        ) : sidebarCollapsed ? (
          /* ── 접힘: 아이콘 레일 ── */
          <>
            <div
              className="sidebar-brand flex flex-col items-center gap-1.5 px-2 pb-2 pt-6"
              data-tauri-drag-region
            >
              <button
                onClick={toggleSidebar}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                title="사이드바 펼치기"
                aria-label="사이드바 펼치기"
              >
                <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden />
              </button>
              <button
                onClick={goHome}
                className="press-scale flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                title="Aone — 모든 문서"
                aria-label="Aone — 모든 문서"
              >
                <span className="translate-x-[0.5px] -translate-y-[0.5px] text-base font-bold italic leading-none text-white">
                  A
                </span>
              </button>
            </div>
            <div className="mx-3 my-2 h-px bg-black/[0.06]" />
            <nav className="flex flex-1 flex-col items-center gap-1.5 px-2">
              <button
                onClick={selectHome}
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  view === "home"
                    ? "bg-primary/10 text-primary"
                    : "text-gray-500 hover:bg-black/[0.04] hover:text-gray-900"
                }`}
                title="홈"
                aria-label="홈"
              >
                <HomeIcon className="h-[18px] w-[18px]" aria-hidden />
              </button>
              <button
                onClick={selectAgent}
                className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  view === "agent"
                    ? "bg-primary/10 text-primary"
                    : "text-gray-500 hover:bg-black/[0.04] hover:text-gray-900"
                }`}
                title="에이전트"
                aria-label="에이전트"
              >
                <ActivityIcon className="h-[18px] w-[18px]" aria-hidden />
                {runState === "running" && (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                )}
              </button>
              <button
                onClick={selectExam}
                className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  view === "exam"
                    ? "bg-primary/10 text-primary"
                    : "text-gray-500 hover:bg-black/[0.04] hover:text-gray-900"
                }`}
                title="시험 대비"
                aria-label="시험 대비"
              >
                <GraduationCap className="h-[18px] w-[18px]" aria-hidden />
                {examImminent && (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                )}
              </button>
              <button
                onClick={goHome}
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  view === "subject" || view === "lecture" || view === "all"
                    ? "bg-primary/10 text-primary"
                    : "text-gray-500 hover:bg-black/[0.04] hover:text-gray-900"
                }`}
                title="폴더"
                aria-label="폴더"
              >
                <Folder className="h-[18px] w-[18px]" aria-hidden />
              </button>
            </nav>
            <div className="flex flex-col items-center border-t border-black/[0.06] px-2 py-2.5">
              <Link
                href="/settings/engines"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                title="설정"
                aria-label="설정"
              >
                <Settings className="h-[18px] w-[18px]" aria-hidden />
              </Link>
            </div>
          </>
        ) : (
          <>
            {/* 브랜드 — 오버레이 타이틀바 드래그 영역 겸용 */}
            <div
              className="sidebar-brand flex items-center justify-between gap-1 px-4 pb-2 pt-6"
              data-tauri-drag-region
            >
              <button
                onClick={goHome}
                className="press-scale flex min-w-0 items-center gap-2.5 rounded-2xl px-2 py-1.5 text-left transition-colors duration-200 hover:bg-black/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/25">
                  <span className="translate-x-[0.5px] -translate-y-[0.5px] text-xl font-bold italic leading-none text-white">
                    A
                  </span>
                </span>
                <span className="truncate text-xl font-bold tracking-tight text-gray-900">
                  Aone
                </span>
              </button>
              <button
                onClick={toggleSidebar}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                title="사이드바 접기"
                aria-label="사이드바 접기"
              >
                <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />
              </button>
            </div>

            <div className="mx-5 my-3 h-px bg-black/[0.06]" />

            {/* 폴더 트리 */}
            <nav className="flex-1 overflow-y-auto px-3 pb-2">
              {/* 홈 — 시간표 · 과제 · 시험 대시보드 */}
              <button
                onClick={selectHome}
                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  view === "home"
                    ? "bg-primary/10 text-primary"
                    : "text-gray-700 hover:bg-black/[0.04]"
                }`}
              >
                <HomeIcon
                  className={`h-4 w-4 shrink-0 ${view === "home" ? "text-primary" : "text-gray-400"}`}
                  aria-hidden
                />
                <span className="truncate">홈</span>
              </button>

              {/* 에이전트 — 전역 실행 상태 · 전체 활동 이력 · 실행 로그 */}
              <button
                onClick={selectAgent}
                data-testid="nav-agent"
                className={`mt-0.5 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  view === "agent"
                    ? "bg-primary/10 text-primary"
                    : "text-gray-700 hover:bg-black/[0.04]"
                }`}
              >
                <ActivityIcon
                  className={`h-4 w-4 shrink-0 ${view === "agent" ? "text-primary" : "text-gray-400"}`}
                  aria-hidden
                />
                <span className="truncate">에이전트</span>
                {runState === "running" && (
                  <span
                    className="ml-auto inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary shadow-glow"
                    aria-label="실행 중"
                  />
                )}
              </button>

              {/* 시험 대비 — 학기 전체 복습 · 학습노트 · 모의고사 */}
              <button
                onClick={selectExam}
                data-testid="nav-exam"
                className={`mt-0.5 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  view === "exam"
                    ? "bg-primary/10 text-primary"
                    : "text-gray-700 hover:bg-black/[0.04]"
                }`}
              >
                <GraduationCap
                  className={`h-4 w-4 shrink-0 ${view === "exam" ? "text-primary" : "text-gray-400"}`}
                  aria-hidden
                />
                <span className="truncate">시험 대비</span>
                {examImminent && nextExamDday !== null && (
                  <span
                    className="ml-auto shrink-0 rounded-md bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white"
                    data-testid="nav-exam-badge"
                  >
                    {ddayLabel(nextExamDday)}
                  </span>
                )}
              </button>

              <div className="mx-2 my-2.5 h-px bg-black/[0.06]" />

              <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                과목
              </p>

              {/* 과목 트리 — 매니페스트 subjects[].units[] */}
              {(files?.subjects ?? []).map((s) => {
                const open = !closedSubjects.has(s.name);
                const selected = view === "subject" && activeSubject === s.name;
                return (
                  <div key={s.name}>
                    {renamingFolder?.folderKey === s.name &&
                    renamingFolder.origin === "sidebar" ? (
                      <div className="flex items-center gap-2 rounded-xl bg-primary/5 px-2.5 py-2 ring-1 ring-primary/30">
                        <FolderOpen
                          className="h-4 w-4 shrink-0 text-primary"
                          aria-hidden
                        />
                        <input
                          ref={renameRef}
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRenameFolder();
                            if (e.key === "Escape") cancelRenameFolder();
                          }}
                          onBlur={commitRenameFolder}
                          className="w-full bg-transparent text-[13px] font-semibold text-gray-900 focus:outline-none"
                        />
                      </div>
                    ) : (
                    <div className="group/subj relative">
                    <button
                      onClick={() => {
                        if (selected) {
                          setClosedSubjects((prev) => {
                            const next = new Set(prev);
                            if (next.has(s.name)) next.delete(s.name);
                            else next.add(s.name);
                            return next;
                          });
                        } else {
                          setClosedSubjects((prev) => {
                            const next = new Set(prev);
                            next.delete(s.name);
                            return next;
                          });
                        }
                        selectSubject(s.name);
                      }}
                      className={`flex w-full items-center gap-1.5 rounded-xl px-2.5 py-2 pr-8 text-left text-[13px] font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                        selected
                          ? "bg-primary/10 text-primary"
                          : "text-gray-700 group-hover/subj:bg-black/[0.04]"
                      }`}
                    >
                      <ChevronRight
                        className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform duration-200 ${
                          open ? "rotate-90" : ""
                        }`}
                        aria-hidden
                      />
                      {open ? (
                        <FolderOpen
                          className={`h-4 w-4 shrink-0 ${selected ? "text-primary" : "text-gray-400"}`}
                          aria-hidden
                        />
                      ) : (
                        <Folder
                          className={`h-4 w-4 shrink-0 ${selected ? "text-primary" : "text-gray-400"}`}
                          aria-hidden
                        />
                      )}
                      <span className="truncate">{s.name}</span>
                    </button>
                    <FolderMenu
                      name={s.name}
                      compact
                      variant="sidebar"
                      groupName="subj"
                      className="right-1.5 top-1/2 -translate-y-1/2"
                      confirmDelete={desktop}
                      onRename={() =>
                        startRenameFolder({
                          folderKey: s.name,
                          kind: "subject",
                          subject: null,
                          oldName: s.name,
                          origin: "sidebar",
                        })
                      }
                      onTrash={() =>
                        void trashFolderAction({
                          folderKey: s.name,
                          kind: "subject",
                          subject: null,
                          name: s.name,
                        })
                      }
                    />
                    </div>
                    )}

                    {open && (
                      <div className="relative ml-[17px] border-l border-black/[0.06] pl-2">
                        {s.units.map((u) => {
                          const fk = folderKeyOf(s.name, u.name);
                          const unitSelected =
                            view === "lecture" && lecture?.folderKey === fk;
                          const UnitIcon =
                            u.name === "족보" ? ScrollText : Folder;
                          if (
                            renamingFolder?.folderKey === fk &&
                            renamingFolder.origin === "sidebar"
                          ) {
                            return (
                              <div
                                key={fk}
                                className="flex items-center gap-2 rounded-xl bg-primary/5 px-2.5 py-[7px] ring-1 ring-primary/30"
                              >
                                <UnitIcon
                                  className="h-4 w-4 shrink-0 text-primary"
                                  aria-hidden
                                />
                                <input
                                  ref={renameRef}
                                  type="text"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitRenameFolder();
                                    if (e.key === "Escape") cancelRenameFolder();
                                  }}
                                  onBlur={commitRenameFolder}
                                  className="w-full bg-transparent text-[13px] font-medium text-gray-900 focus:outline-none"
                                />
                              </div>
                            );
                          }
                          return (
                            <div key={fk} className="group/unit relative">
                            <button
                              onClick={() => selectUnit(s.name, u.name)}
                              className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-[7px] pr-8 text-left text-[13px] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                                unitSelected
                                  ? "bg-primary/10 font-semibold text-primary"
                                  : "font-medium text-gray-600 group-hover/unit:bg-black/[0.04] group-hover/unit:text-gray-900"
                              }`}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <UnitIcon
                                  className={`h-4 w-4 shrink-0 ${unitSelected ? "text-primary" : "text-gray-400"}`}
                                  aria-hidden
                                />
                                <span className="truncate">{u.name}</span>
                              </span>
                              {proactiveKeys.has(fk) && (
                                <span
                                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                                  title="능동 제안 있음"
                                  aria-label="능동 제안 있음"
                                />
                              )}
                            </button>
                            <FolderMenu
                              name={u.name}
                              compact
                              variant="sidebar"
                              groupName="unit"
                              className="right-1.5 top-1/2 -translate-y-1/2"
                              confirmDelete={desktop}
                              onRename={() =>
                                startRenameFolder({
                                  folderKey: fk,
                                  kind: "unit",
                                  subject: s.name,
                                  oldName: u.name,
                                  origin: "sidebar",
                                })
                              }
                              onTrash={() =>
                                void trashFolderAction({
                                  folderKey: fk,
                                  kind: "unit",
                                  subject: s.name,
                                  name: u.name,
                                })
                              }
                            />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {creatingFolder && creatingAt === "sidebar" && (
                <div className="flex items-center gap-2 rounded-xl bg-primary/5 py-2 pl-[30px] pr-2.5 ring-1 ring-primary/30">
                  <Folder className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <input
                    ref={newFolderRef}
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitCreateFolder();
                      if (e.key === "Escape") cancelCreateFolder();
                    }}
                    onBlur={commitCreateFolder}
                    placeholder="과목 이름 (예: 운영체제)"
                    className="w-full bg-transparent text-[13px] font-medium text-gray-900 placeholder-gray-400 focus:outline-none"
                  />
                </div>
              )}
            </nav>

            {/* 하단 푸터 — macOS 사이드바 스타일 (hairline + 조용한 리스트) */}
            <div className="border-t border-black/[0.06] px-3 py-2.5">
              <button
                onClick={() => startCreateFolder("subject", "sidebar")}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-[7px] text-left text-[13px] font-medium text-gray-600 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <FolderPlus className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                <span className="truncate">과목 추가</span>
              </button>
              <button
                onClick={selectTrash}
                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-[7px] text-left text-[13px] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  view === "trash"
                    ? "bg-primary/10 font-semibold text-primary"
                    : "font-medium text-gray-600 hover:bg-black/[0.04] hover:text-gray-900"
                }`}
              >
                <Trash2
                  className={`h-4 w-4 shrink-0 ${view === "trash" ? "text-primary" : "text-gray-400"}`}
                  aria-hidden
                />
                <span className="truncate">휴지통</span>
              </button>
            </div>

            {/* 웹 데모 한 줄 안내 — 데스크톱 앱에서는 렌더하지 않는다 */}
            {!desktop && (
              <p
                className="mt-auto px-2 pb-1 pt-4 text-[11px] leading-relaxed text-gray-400"
                data-testid="web-demo-note"
              >
                웹 데모 · 분석 결과 열람용
                <br />
                (전체 기능은 데스크톱 앱)
              </p>
            )}
          </>
        )}
      </aside>

      {/* ── 우측: 헤더 + 콘텐츠 패널 (불투명 서피스) ────────── */}
      <div
        className={`main-surface flex min-w-0 flex-1 flex-col ${
          readerMode ? "px-3 pb-3 pt-2" : "p-4"
        }`}
      >
        {readerMode ? (
          /* 리더 헤더 — 파일 제목 + 설정 아이콘만 (얇은 한 줄) */
          <header
            className="flex items-center justify-between gap-3 pb-2"
            data-tauri-drag-region
            data-testid="reader-header"
          >
            <p
              className="min-w-0 truncate text-sm font-semibold tracking-tight text-gray-900"
              title={openFileDisplay?.title ?? activeDocPdf?.title ?? ""}
            >
              {openFileDisplay?.title ?? activeDocPdf?.title ?? ""}
            </p>
            <Link
              href="/settings/engines"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors duration-200 hover:bg-black/[0.05] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              title="설정"
              aria-label="설정"
            >
              <Settings className="h-[18px] w-[18px]" aria-hidden />
            </Link>
          </header>
        ) : (
        /* 상단 헤더 */
        <header
          className="flex items-center justify-between gap-4 pb-4"
          data-tauri-drag-region
        >
          {/* 검색바 */}
          <div className="w-full max-w-xl">
            <div className="flex h-[46px] items-center rounded-2xl border border-black/[0.06] bg-white/80 px-4 shadow-sm backdrop-blur-md transition-all duration-200 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
              <Search
                className="mr-3 h-[18px] w-[18px] shrink-0 text-gray-400"
                aria-hidden
              />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="문서, 폴더 검색..."
                className="w-full bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
              />
              {query ? (
                <button
                  onClick={() => setQuery("")}
                  className="ml-2 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-700"
                >
                  지우기
                </button>
              ) : (
                <span className="ml-2 hidden shrink-0 items-center gap-1 rounded-md border border-black/[0.08] bg-black/[0.03] px-1.5 py-0.5 md:flex">
                  <Command className="h-3 w-3 text-gray-400" aria-hidden />
                  <span className="text-[10px] font-semibold text-gray-400">K</span>
                </span>
              )}
            </div>
          </div>

          {/* 우측 액션 — [엔진 배지] [설정] [알림벨] | [프로필] [로그아웃] */}
          <div className="flex shrink-0 items-center gap-2.5">
            {/* 웹 데모에서는 엔진 배지가 의미 없다 — "웹 데모" 배지로 대체 */}
            {desktop ? (
              <span className="hidden items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary lg:flex">
                <Check className="h-3.5 w-3.5" aria-hidden />
                엔진: {ENGINE_LABELS[activeEngine]}
              </span>
            ) : (
              <WebDemoBadge className="hidden lg:inline-flex" />
            )}

            <Link
              href="/settings/engines"
              className="flex h-10 w-10 items-center justify-center rounded-full text-gray-500 transition-colors duration-200 hover:bg-black/[0.05] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              title="설정"
              aria-label="설정"
            >
              <Settings className="h-[18px] w-[18px]" aria-hidden />
            </Link>

            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen((v) => !v)}
                className="relative flex h-10 w-10 items-center justify-center rounded-full text-gray-500 transition-colors duration-200 hover:bg-black/[0.05] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                title="알림"
                aria-label="알림"
                aria-expanded={notifOpen}
              >
                <Bell className="h-[18px] w-[18px]" aria-hidden />
                {unreadCount > 0 && (
                  <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                )}
              </button>

              {notifOpen && (
                <div
                  className="glass-panel absolute right-0 top-12 z-50 w-[360px] overflow-hidden rounded-2xl shadow-xl"
                  data-testid="notif-panel"
                >
                  <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3">
                    <span className="text-sm font-bold tracking-tight text-gray-900">
                      알림
                    </span>
                    {notifications.length > 0 && unreadCount > 0 && (
                      <button
                        onClick={markAllNotificationsRead}
                        className="text-xs font-semibold text-primary transition-opacity duration-200 hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      >
                        모두 읽음
                      </button>
                    )}
                  </div>

                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                      <Bell className="h-6 w-6 text-gray-300" aria-hidden />
                      <p className="text-sm font-medium text-gray-400">
                        새 알림이 없어요
                      </p>
                    </div>
                  ) : (
                    <ul className="max-h-[420px] overflow-y-auto py-1">
                      {notifications.map((n) => (
                        <li key={n.id}>
                          <button
                            onClick={() => openNotification(n)}
                            className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-black/[0.04] focus:outline-none focus-visible:bg-black/[0.04] ${
                              n.read ? "" : "bg-primary/[0.045]"
                            }`}
                          >
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                              {n.kind === "failed" ? (
                                <AlertTriangle
                                  className="h-4 w-4 text-red-500"
                                  aria-hidden
                                />
                              ) : n.kind === "detected" ? (
                                <span
                                  className="inline-block h-2 w-2 rounded-full bg-primary"
                                  aria-hidden
                                />
                              ) : (
                                <Check
                                  className="h-4 w-4 text-emerald-500"
                                  aria-hidden
                                />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-medium leading-snug text-gray-800">
                                {n.text}
                              </span>
                              <span className="mt-0.5 block text-[11px] font-medium text-gray-400">
                                {relTime(n.at)}
                              </span>
                            </span>
                            {!n.read && (
                              <span
                                className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                                aria-hidden
                              />
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <span className="h-6 w-px bg-black/[0.08]" aria-hidden />

            <div className="flex items-center gap-2.5 pl-0.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.05] bg-gradient-to-tr from-gray-100 to-gray-200">
                <User className="h-4 w-4 text-gray-500" aria-hidden />
              </span>
              <div className="hidden md:block">
                <p
                  className="text-[13px] font-bold leading-tight text-gray-900"
                  data-testid="profile-name"
                >
                  {userName}
                </p>
                {userOrg && (
                  <p className="text-[10px] font-medium tracking-wide text-gray-400">
                    {userOrg}
                  </p>
                )}
              </div>
            </div>

            <button
              onClick={() => showToast("데모 모드에서는 로그아웃할 수 없습니다.")}
              className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition-colors duration-200 hover:bg-red-50 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
              title="로그아웃"
              aria-label="로그아웃"
            >
              <LogOut className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </div>
        </header>
        )}

        {/* 콘텐츠 글래스 패널 */}
        <main className="min-h-0 flex-1">
          <div className="glass-panel flex h-full flex-col overflow-hidden rounded-[28px]">
            {view === "home" ? (
              /* ── 홈 화면 — 시간표 · 과제 · 시험 ── */
              <>
                {examImminent && !examBannerClosed && (
                  <div className="px-8 pt-7">{examBanner}</div>
                )}
                <HomeView
                  handleRef={homeRef}
                  subjects={(files?.subjects ?? []).map((s) => s.name)}
                  refreshManifest={refreshManifest}
                />
              </>
            ) : view === "exam" ? (
              /* ── 시험 대비 화면 — 우선 복습 · 전 범위 학습노트 · 모의고사 ── */
              <ExamPrep
                exams={exams}
                subjects={files?.subjects ?? null}
                onGoHome={selectHome}
                onGoUnit={(subject, unit) => selectUnit(subject, unit, "note")}
                onGoEvidence={(subject, unit, anchor) => {
                  // 그 수업의 전사본을 열고 해당 발화 블록으로 이동한다 (FIX 14)
                  selectUnit(subject, unit, "files");
                  setPendingTranscript({
                    folderKey: folderKeyOf(subject, unit),
                    anchor,
                  });
                }}
                onGoPage={(subject, unit, doc, page) => {
                  // 페이지 근거 — 그 슬라이드 문서를 열고 해당 쪽으로 이동한다
                  selectUnit(subject, unit);
                  setPendingDocOpen({
                    folderKey: folderKeyOf(subject, unit),
                    doc,
                    page,
                  });
                }}
              />
            ) : view === "agent" ? (
              /* ── 전역 에이전트 화면 — 실행 상태 · 전체 이력 · 로그 ── */
              <AgentGlobalView
                runState={runState}
                runLabel={runTarget?.unit ?? null}
                runStep={runStep}
                runElapsed={runElapsed}
                runCalls={runCalls}
                engine={activeEngine}
                agentRunKind={agentRunKind}
                slideGenState={slideGenState}
                pendingCount={pendingCount}
                desktop={desktop}
                failures={failureList}
                onRetry={(f) => void startAnalysis(f.subject, f.unit)}
                onStop={handleStopRun}
                activities={allActivities}
                concepts={allConcepts}
                proactive={allProactive}
                onOpenQuestion={(p, questionId) => {
                  // 제안이 나온 수업의 퀴즈 탭을 열고 해당 문항을 펼친다
                  selectUnit(p.subject, p.unit, "questions");
                  setOpenQuestion(questionId);
                }}
                consoleOpen={consoleOpen}
                onToggleConsole={() => setConsoleOpen((v) => !v)}
              />
            ) : (
              <>
                {/* ── 패널 헤더 — 리더 모드/세부 페이지에서는 숨긴다 ── */}
                {!readerMode && !detailMode && (
                <div className="border-b border-black/[0.05] px-8 pb-5 pt-7">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      {breadcrumb.length > 1 && view !== "trash" && (
                        <nav
                          className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-400"
                          aria-label="현재 위치"
                        >
                          {breadcrumb.map((b, i) => (
                            <span key={i} className="flex items-center gap-1">
                              {i > 0 && (
                                <ChevronRight className="h-3 w-3" aria-hidden />
                              )}
                              {b.onClick && i < breadcrumb.length - 1 ? (
                                <button
                                  onClick={b.onClick}
                                  className="rounded transition-colors duration-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                                >
                                  {b.label}
                                </button>
                              ) : (
                                <span className="text-gray-500">{b.label}</span>
                              )}
                            </span>
                          ))}
                        </nav>
                      )}
                      <h1 className="truncate text-[26px] font-bold tracking-tight text-gray-900">
                        {panelTitle}
                      </h1>
                      <p className="mt-0.5 text-sm font-medium text-gray-400">
                        {panelSub}
                      </p>
                    </div>

                    {view !== "trash" && (
                      <div className="flex flex-wrap items-center gap-3">
                        {/* 보기 토글 */}
                        <div className="flex items-center gap-0.5 rounded-xl border border-black/[0.05] bg-white p-1 shadow-sm">
                          <button
                            onClick={() => setViewMode("grid")}
                            title="그리드 보기"
                            aria-label="그리드 보기"
                            className={`rounded-lg p-1.5 transition-colors duration-200 ${
                              viewMode === "grid"
                                ? "bg-gray-100 text-gray-900"
                                : "text-gray-400 hover:text-gray-700"
                            }`}
                          >
                            <LayoutGrid className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            onClick={() => setViewMode("list")}
                            title="리스트 보기"
                            aria-label="리스트 보기"
                            className={`rounded-lg p-1.5 transition-colors duration-200 ${
                              viewMode === "list"
                                ? "bg-gray-100 text-gray-900"
                                : "text-gray-400 hover:text-gray-700"
                            }`}
                          >
                            <List className="h-4 w-4" aria-hidden />
                          </button>
                        </div>

                        <button
                          onClick={handleUpload}
                          className="press-scale flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        >
                          <Upload className="h-4 w-4" aria-hidden />
                          {desktop ? "업로드" : "PDF 열어보기"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 세그먼트 네비 — 수업 화면 (족보 폴더는 기출 뷰어라 탭 숨김) */}
                  {showLectureScreen && !isExamFolder && (
                    <div className="mt-5">
                      <div
                        className="inline-flex flex-wrap rounded-full border border-black/[0.05] bg-white p-1 shadow-sm"
                        data-testid="lecture-tabs"
                      >
                        {TABS.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => {
                              setTab(t.id);
                              setOpenFile(null);
                              setShowAllProactive(false);
                              if (t.id === "questions") setNewQuestionCount(0);
                            }}
                            className={`press-scale relative rounded-full px-4 py-1.5 text-[13px] transition-colors duration-200 ${
                              tab === t.id
                                ? "bg-primary font-semibold text-white shadow-glow"
                                : "font-medium text-gray-500 hover:text-gray-900"
                            }`}
                          >
                            {t.label}
                            {t.id === "questions" && newQuestionCount > 0 && (
                              <span
                                className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 align-middle text-[10px] font-bold text-primary"
                                data-testid="quiz-new-badge"
                              >
                                NEW
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                )}

                {/* ── 강의자료 세부 페이지 상단 네비바 (5탭) ── */}
                {detailMode && (
                  <div
                    className="border-b border-black/[0.05] px-6 pb-3 pt-4"
                    data-testid="detail-navbar"
                  >
                    {/* 브레드크럼 + 닫기 */}
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <nav
                        className="flex min-w-0 items-center gap-1 text-xs font-medium text-gray-400"
                        aria-label="현재 위치"
                      >
                        <span className="truncate text-gray-500">
                          {lecture?.subject}
                        </span>
                        <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate text-gray-500">
                          {lectureName}
                        </span>
                        <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate font-semibold text-gray-700">
                          {openFileDisplay?.title ?? openFile?.name}
                        </span>
                      </nav>
                      <button
                        onClick={() => setOpenFile(null)}
                        data-testid="detail-close"
                        className="press-scale flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-gray-600 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      >
                        <ArrowLeft className="h-4 w-4" aria-hidden /> 목록으로
                      </button>
                    </div>
                    {/* 5탭 세그먼트 */}
                    <div
                      className="inline-flex flex-wrap rounded-full border border-black/[0.05] bg-white p-1 shadow-sm"
                      data-testid="detail-tabs"
                    >
                      {DETAIL_TABS.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setDetailTab(t.id)}
                          className={`press-scale relative rounded-full px-4 py-1.5 text-[13px] transition-colors duration-200 ${
                            detailTab === t.id
                              ? "bg-primary font-semibold text-white shadow-glow"
                              : "font-medium text-gray-500 hover:text-gray-900"
                          }`}
                        >
                          {t.label}
                          {t.badge && (
                            <span
                              className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                detailTab === t.id
                                  ? "bg-white/20 text-white"
                                  : "bg-amber-500/10 text-amber-600"
                              }`}
                            >
                              {t.badge}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── 패널 본문 — PDF 캔버스가 있을 때만 스크롤 없이 꽉 채운다 ── */}
                <div
                  className={`flex min-h-0 flex-1 flex-col ${
                    readerCanvas ? "" : "overflow-y-auto"
                  }`}
                >
                  <div
                    className={`flex min-h-0 flex-1 flex-col ${
                      readerMode ? "px-4 pb-4 pt-3" : "p-8"
                    }`}
                  >
                    {/* 모든 문서 — 최상위 폴더만 */}
                    {view === "all" && (
                      <>
                        {filteredRootCards.length === 0 &&
                        globalFileMatches.length === 0 ? (
                          emptySearchState
                        ) : (
                          <>
                            {filteredRootCards.length > 0 && (
                              <div className={gridClass}>
                                {filteredRootCards.map(renderFolderCard)}
                                {trimmedQuery === "" &&
                                (creatingFolder && creatingAt === "grid" && view === "all" ? (
                                  <div
                                    className={`flex items-center gap-3 rounded-2xl border-2 border-dashed border-primary/50 bg-primary/[0.04] ${
                                      viewMode === "grid"
                                        ? "p-5"
                                        : "px-4 py-3"
                                    }`}
                                  >
                                    <span
                                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10"
                                      aria-hidden
                                    >
                                      <Plus className="h-5 w-5 text-primary" />
                                    </span>
                                    <input
                                      ref={newFolderRef}
                                      type="text"
                                      value={newFolderName}
                                      onChange={(e) => setNewFolderName(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") commitCreateFolder();
                                        if (e.key === "Escape") cancelCreateFolder();
                                      }}
                                      onBlur={commitCreateFolder}
                                      placeholder={"과목 이름 (예: 운영체제)"}
                                      className="w-full bg-transparent text-sm font-semibold text-gray-900 placeholder-gray-400 focus:outline-none"
                                    />
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => startCreateFolder("subject", "grid")}
                                    className={`group rounded-2xl border-2 border-dashed border-black/10 text-left transition-colors duration-200 hover:border-primary/60 hover:bg-primary/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                                      viewMode === "grid"
                                        ? "p-5"
                                        : "flex items-center gap-4 px-4 py-3"
                                    }`}
                                  >
                                    <span
                                      className={`flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 ${
                                        viewMode === "grid" ? "mb-4" : ""
                                      }`}
                                      aria-hidden
                                    >
                                      <Plus className="h-5 w-5 text-primary" />
                                    </span>
                                    <span className="block">
                                      <span className="block text-sm font-semibold text-gray-600 transition-colors group-hover:text-primary">
                                        과목 추가
                                      </span>
                                      <span className="mt-1 block text-xs text-gray-400">
                                        새 과목 폴더 만들기
                                      </span>
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {/* 폴더에 넣지 않고 바로 올린 파일들 */}
                            {trimmedQuery === "" && rootLooseFiles.length > 0 && (
                              <>
                                <p className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-gray-400">
                                  파일
                                </p>
                                <div className={gridClass}>
                                  {rootLooseFiles.map((d) =>
                                    renderFileCard(d, {
                                      key: d.key,
                                      folder: "",
                                      onClick: () =>
                                        showToast(
                                          "이 파일은 아직 분석 전입니다 — 분석하면 요약과 퀴즈가 만들어져요."
                                        ),
                                    })
                                  )}
                                </div>
                              </>
                            )}
                            {globalFileMatches.length > 0 && (
                              <>
                                <p
                                  className={`mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 ${
                                    filteredRootCards.length > 0 ? "mt-8" : ""
                                  }`}
                                >
                                  파일 검색 결과 · {globalFileMatches.length}
                                </p>
                                <div className={gridClass}>
                                  {globalFileMatches.map((d) =>
                                    renderFileCard(d, {
                                      key: d.key,
                                      folder: d.folderKey,
                                      badge: d.unit,
                                      onClick: () => openFileFromSearch(d),
                                    })
                                  )}
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}

                    {/* 과목 화면 — 수업(unit) 폴더 그리드 */}
                    {view === "subject" && (
                      <>
                        {trimmedQuery !== "" &&
                        filteredSubjectCards.length === 0 &&
                        subjectLooseFiles.length === 0 &&
                        globalFileMatches.length === 0 ? (
                          emptySearchState
                        ) : (
                          <>
                            {(filteredSubjectCards.length > 0 ||
                              trimmedQuery === "") && (
                              <div className={gridClass}>
                                {filteredSubjectCards.map(renderFolderCard)}
                                {trimmedQuery === "" &&
                                (creatingFolder && creatingAt === "grid" && view === "subject" ? (
                                  <div
                                    className={`flex items-center gap-3 rounded-2xl border-2 border-dashed border-primary/50 bg-primary/[0.04] ${
                                      viewMode === "grid"
                                        ? "p-5"
                                        : "px-4 py-3"
                                    }`}
                                  >
                                    <span
                                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10"
                                      aria-hidden
                                    >
                                      <Plus className="h-5 w-5 text-primary" />
                                    </span>
                                    <input
                                      ref={newFolderRef}
                                      type="text"
                                      value={newFolderName}
                                      onChange={(e) => setNewFolderName(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") commitCreateFolder();
                                        if (e.key === "Escape") cancelCreateFolder();
                                      }}
                                      onBlur={commitCreateFolder}
                                      placeholder={"폴더 이름 (예: 8주차, 스위칭)"}
                                      className="w-full bg-transparent text-sm font-semibold text-gray-900 placeholder-gray-400 focus:outline-none"
                                    />
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => startCreateFolder("unit", "grid")}
                                    className={`group rounded-2xl border-2 border-dashed border-black/10 text-left transition-colors duration-200 hover:border-primary/60 hover:bg-primary/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                                      viewMode === "grid"
                                        ? "p-5"
                                        : "flex items-center gap-4 px-4 py-3"
                                    }`}
                                  >
                                    <span
                                      className={`flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 ${
                                        viewMode === "grid" ? "mb-4" : ""
                                      }`}
                                      aria-hidden
                                    >
                                      <Plus className="h-5 w-5 text-primary" />
                                    </span>
                                    <span className="block">
                                      <span className="block text-sm font-semibold text-gray-600 transition-colors group-hover:text-primary">
                                        폴더 추가
                                      </span>
                                      <span className="mt-1 block text-xs text-gray-400">
                                        수업·자료 묶음 폴더 만들기
                                      </span>
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {/* 과목 직속 파일 (분석 단위 아님 — 보관) */}
                            {trimmedQuery === "" &&
                              subjectLooseFiles.length > 0 && (
                                <>
                                  <p className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wider text-gray-400">
                                    파일
                                  </p>
                                  <div className={gridClass}>
                                    {subjectLooseFiles.map((d) =>
                                      renderFileCard(d, {
                                        key: d.key,
                                        folder: activeSubject ?? "",
                                        onClick: () =>
                                          showToast(
                                            desktop
                                              ? "이 파일은 아직 분석 전입니다 — 수업 폴더에 넣으면 요약과 퀴즈가 만들어져요."
                                              : "이 파일은 아직 분석 전입니다 — 분석은 데스크톱 앱에서 동작해요."
                                          ),
                                      })
                                    )}
                                  </div>
                                </>
                              )}
                            {globalFileMatches.length > 0 && (
                              <>
                                <p
                                  className={`mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 ${
                                    filteredSubjectCards.length > 0 ? "mt-8" : ""
                                  }`}
                                >
                                  파일 검색 결과 · {globalFileMatches.length}
                                </p>
                                <div className={gridClass}>
                                  {globalFileMatches.map((d) =>
                                    renderFileCard(d, {
                                      key: d.key,
                                      folder: d.folderKey,
                                      badge: d.unit,
                                      onClick: () => openFileFromSearch(d),
                                    })
                                  )}
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}

                    {/* 휴지통 */}
                    {view === "trash" && (
                      <div className="flex h-full flex-col items-center justify-center pb-16 text-center">
                        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-black/5 bg-white/70 shadow-sm">
                          <Trash2 className="h-8 w-8 text-gray-300" aria-hidden />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          휴지통이 비어 있습니다
                        </h3>
                        <p className="mt-1.5 max-w-xs text-sm text-gray-400">
                          삭제된 문서와 폴더가 여기에 보관됩니다.
                        </p>
                      </div>
                    )}

                    {/* ══ 수업 화면 ══ */}
                    {showLectureScreen && (
                      <div className="flex min-h-0 flex-1 flex-col">
                        {/* 진행 스트립 — 분석 중에는 화면에 머무르며 상단에 상태만 띄운다 */}
                        {runState === "running" && (
                          <ProgressStrip
                            step={runStep}
                            engine={activeEngine}
                            elapsed={runElapsed}
                            calls={runCalls}
                            onStop={handleStopRun}
                            onDetails={selectAgent}
                          />
                        )}

                        {/* 실패 배너 (S5) — 원인별 안내 + 다시 분석 / 설정 열기 */}
                        {/* 전사본 경고 — 분석은 됐지만 발화 근거가 빠졌다 (R5) */}
                        {transcriptWarning && !readerMode && (
                          <div
                            className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 px-5 py-3"
                            data-testid="transcript-warning-banner"
                          >
                            <AlertTriangle
                              className="h-4 w-4 shrink-0 text-amber-600"
                              aria-hidden
                            />
                            <p className="min-w-0 flex-1 text-sm font-medium leading-relaxed text-amber-800">
                              {transcriptWarning}
                            </p>
                          </div>
                        )}

                        {lectureFailure && !readerMode && (
                          <div
                            className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-3"
                            data-testid="analysis-failed-banner"
                          >
                            <AlertTriangle
                              className="h-4 w-4 shrink-0 text-red-500"
                              aria-hidden
                            />
                            <p className="min-w-0 flex-1 text-sm font-medium leading-relaxed text-red-700">
                              {lectureFailure.message}
                            </p>
                            {lectureFailure.reason === "engine" ? (
                              <Link
                                href="/settings/engines"
                                data-testid="failed-open-settings"
                                className="press-scale shrink-0 rounded-xl bg-red-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-red-600"
                              >
                                설정 열기
                              </Link>
                            ) : (
                              <button
                                onClick={() =>
                                  void startAnalysis(
                                    lectureFailure.subject,
                                    lectureFailure.unit
                                  )
                                }
                                disabled={runState === "running"}
                                data-testid="failed-retry"
                                className="press-scale shrink-0 rounded-xl bg-red-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                다시 분석
                              </button>
                            )}
                          </div>
                        )}

                        {/* 능동 제안 배너 — 여러 개념을 배너 하나로 합쳐 상단 전역에 둔다.
                            슬라이드 리더에서는 아예 숨기고(수업 중 PDF 최대), 전사 뷰어에서는 한 줄로 접는다. */}
                        {readerMode ? null : proactiveChips.length > 0 &&
                          readerTab &&
                          !showAllProactive ? (
                          <button
                            onClick={() => setShowAllProactive(true)}
                            data-testid="proactive-banner"
                            className="glass-card press-scale mb-4 flex w-full items-center gap-3 rounded-2xl border border-primary/20 bg-primary/[0.06] px-5 py-2.5 text-left"
                          >
                            <span
                              className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary shadow-glow"
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-gray-900">
                              에이전트가 시험에 나올 가능성이 높은 개념{" "}
                              {proactiveChips.length}개를 찾았어요
                            </span>
                            <span className="shrink-0 text-xs font-medium text-primary">
                              자세히 보기 ↓
                            </span>
                          </button>
                        ) : proactiveChips.length > 0 ? (
                          <div
                            className="glass-card mb-6 rounded-2xl border border-primary/20 bg-primary/[0.06] px-5 py-4"
                            data-testid="proactive-banner"
                          >
                            <div className="flex items-start gap-3">
                              <span
                                className="mt-1.5 inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary shadow-glow"
                                aria-hidden
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold leading-relaxed text-gray-900">
                                  에이전트가 시험에 나올 가능성이 높은 개념{" "}
                                  {proactiveChips.length}개를 찾았어요
                                </p>

                                {/* 상위 3개 개념 칩 — 개념명 + 근거 요약 */}
                                <div className="mt-2.5 flex flex-wrap gap-1.5">
                                  {proactiveChips.slice(0, 3).map((c, i) => (
                                    <span
                                      key={i}
                                      className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/80 px-3 py-1 text-xs text-gray-800"
                                    >
                                      <span className="font-medium">{c.concept}</span>
                                      <span className="text-gray-400">
                                        {c.evidence}
                                      </span>
                                    </span>
                                  ))}
                                </div>

                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  {proactiveFirstQuestionId && (
                                    <button
                                      data-testid="proactive-cta"
                                      onClick={() =>
                                        showQuestionFromBanner(
                                          proactiveFirstQuestionId
                                        )
                                      }
                                      className="press-scale rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover"
                                    >
                                      예상문제 보기
                                    </button>
                                  )}
                                  {(proactiveChips.length > 3 || readerTab) && (
                                    <button
                                      data-testid="proactive-more"
                                      onClick={() => setShowAllProactive((v) => !v)}
                                      className="press-scale rounded-xl px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors duration-200 hover:text-gray-800"
                                    >
                                      {showAllProactive
                                        ? "접기 ↑"
                                        : `${Math.max(proactiveChips.length - 3, 0)}개 더 보기 ↓`}
                                    </button>
                                  )}
                                </div>

                                {/* 펼침 — 개념별 상세 */}
                                {showAllProactive && (
                                  <ul
                                    className="mt-3 space-y-1.5 border-t border-black/[0.06] pt-3"
                                    data-testid="proactive-details"
                                  >
                                    {proactiveChips.map((c, i) => (
                                      <li
                                        key={i}
                                        className="rounded-xl border border-black/[0.06] bg-white/80 px-3 py-2"
                                      >
                                        {/* 접힘 칩과 같은 형식 — 개념명 + 근거 뱃지 */}
                                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                          <span className="text-xs font-medium text-gray-900">
                                            {c.concept}
                                          </span>
                                          <span className="text-[11px] text-gray-400">
                                            {c.evidence}
                                          </span>
                                        </div>
                                        <p className="mt-1 text-xs leading-relaxed text-gray-600">
                                          {c.text}
                                        </p>
                                        {c.questionIds.length > 0 && (
                                          <button
                                            onClick={() =>
                                              showQuestionFromBanner(c.questionIds[0])
                                            }
                                            className="mt-1 text-xs font-medium text-primary underline-offset-2 transition-opacity duration-200 hover:underline"
                                          >
                                            관련 퀴즈 보기 →
                                          </button>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {/* ── 파일 전용 화면 (기출·텍스트) — 풀 뷰 ── */}
                        {openFile &&
                        (fileView === "exam" || fileView === "text") ? (
                            <section data-testid="file-view">
                              <button
                                onClick={() => setOpenFile(null)}
                                data-testid="file-view-exit"
                                className="press-scale mb-4 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-gray-600 transition-colors duration-200 hover:bg-white/60 hover:text-gray-900"
                              >
                                <ArrowLeft className="h-4 w-4" aria-hidden /> 목록으로
                              </button>

                              <div className="mb-5 flex items-center gap-3">
                                <FileIcon
                                  type={
                                    openFileDisplay?.icon ??
                                    fileIconTypeOf(openFile.kind, openFile.name)
                                  }
                                  size="lg"
                                />
                                <div className="min-w-0">
                                  <h2
                                    className="truncate text-lg font-bold tracking-tight"
                                    title={openFileDisplay?.title ?? openFile.name}
                                  >
                                    {openFileDisplay?.title ?? openFile.name}
                                  </h2>
                                  <p className="mt-0.5 text-xs text-gray-400">
                                    {lectureName} · {fileMeta(openFile.kind).label} ·{" "}
                                    {formatSize(openFile.size)}
                                  </p>
                                </div>
                              </div>

                              {docBody?.kind === "exam" ? (
                                /* 기출 뷰어 — 연도별 카드 + 이미지 갤러리 (폭 전체) */
                                <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
                                  <div className="min-w-0 flex-1">
                                    {docError ? (
                                      <p className="text-sm text-gray-500">
                                        기출 자료를 불러오지 못했습니다: {docError}
                                      </p>
                                    ) : (
                                      <ExamViewer
                                        raw={docText}
                                        concepts={
                                          snapshot?.concepts.map((c) => c.name) ?? []
                                        }
                                        images={examImages}
                                      />
                                    )}
                                  </div>
                                  <aside className="min-w-0 shrink-0 xl:w-[360px]">
                                    <div className="glass-card rounded-2xl p-5">
                                      <h2 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">
                                        이 자료에서 에이전트가 찾은 것
                                      </h2>
                                      {renderAiPanel(docDetail)}
                                    </div>
                                  </aside>
                                </div>
                              ) : (
                              <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                                <section className="min-w-0 lg:w-[58%]">
                                  <div className="glass-card rounded-2xl p-6">
                                    {docError && (
                                      <p className="text-sm text-gray-500">
                                        원문을 불러오지 못했습니다: {docError}
                                      </p>
                                    )}
                                    {!docError && docText === null && (
                                      <p className="text-sm text-gray-400">
                                        원문 불러오는 중…
                                      </p>
                                    )}
                                    {docBody?.kind === "transcript" && (
                                      <div className="space-y-5">
                                        {docBody.intro && (
                                          <p className="whitespace-pre-wrap border-b border-black/5 pb-4 text-xs leading-relaxed text-gray-400">
                                            {docBody.intro}
                                          </p>
                                        )}
                                        {docBody.blocks.map((b, i) => (
                                          <div key={i}>
                                            <div className="mb-1.5 flex items-center gap-2">
                                              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-medium text-primary">
                                                {b.time}
                                              </span>
                                              <span className="text-xs text-gray-400">
                                                {b.speaker}
                                              </span>
                                            </div>
                                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                                              {b.text}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {docBody?.kind === "pages" && (
                                      <div className="space-y-5">
                                        {docBody.pages.map((p, i) => (
                                          <div
                                            key={i}
                                            className={
                                              i > 0
                                                ? "border-t border-black/5 pt-5"
                                                : undefined
                                            }
                                          >
                                            <span className="mb-2 inline-block rounded-md bg-black/[0.04] px-1.5 py-0.5 font-mono text-xs text-gray-500">
                                              {p.page ? `p.${p.page}` : "끝"}
                                            </span>
                                            {p.text ? (
                                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                                                {p.text}
                                              </p>
                                            ) : (
                                              <p className="text-xs text-gray-400">
                                                (텍스트 없음)
                                              </p>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {docBody?.kind === "code" && (
                                      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-700">
                                        {docBody.text}
                                      </pre>
                                    )}
                                    {docBody?.kind === "plain" && (
                                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                                        {docBody.text}
                                      </p>
                                    )}
                                  </div>
                                </section>

                                <aside className="min-w-0 lg:w-[42%]">
                                  <div className="glass-card rounded-2xl p-5">
                                    <h2 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">
                                      이 자료에서 에이전트가 찾은 것
                                    </h2>
                                    {renderAiPanel(docDetail)}
                                  </div>
                                </aside>
                              </div>
                              )}
                            </section>
                        ) : null}

                        {/* ── 족보 폴더 — 3탭 대신 기출 뷰어 (부록 A안 §3) ── */}
                        {!openFile && isExamFolder && (
                          <section data-testid="tab-exam-folder">
                            {lectureFiles.length === 0 ? (
                              emptyTabState(
                                <ScrollText
                                  className="h-6 w-6 text-gray-300"
                                  aria-hidden
                                />,
                                "기출 자료를 넣어주세요",
                                "예상문제·기출 빈출 분석에 쓰여요. PDF·스캔 사진(png·jpg)·타이핑한 텍스트(txt·md) 어느 형태든 이 폴더에 넣으면 연도별로 정리해 드립니다.",
                                <button
                                  onClick={handleUpload}
                                  className="press-scale rounded-xl bg-primary/10 px-6 py-2.5 text-sm font-semibold text-primary transition-colors duration-200 hover:bg-primary/20"
                                >
                                  {desktop ? "기출 자료 업로드" : "PDF 열어보기"}
                                </button>,
                                "exam-empty"
                              )
                            ) : (
                              <ExamViewer
                                raw={examFolderRaw}
                                concepts={
                                  snapshot?.concepts.map((c) => c.name) ?? []
                                }
                                images={examImages}
                              />
                            )}
                          </section>
                        )}

                        {/* ── [자료] 탭 — 파일 목록 (파일을 열지 않았을 때) ── */}
                        {!openFile && !isExamFolder && tab === "files" && (
                            <section data-testid="tab-files">
                              {/* 요약 스트립 + 분석 버튼 */}
                              <div className="glass-card mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl px-5 py-3.5">
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                  <p className="text-sm text-gray-600">
                                    {snapshot ? (
                                      <>
                                        개념{" "}
                                        <span className="font-semibold text-gray-900">
                                          {snapshot.concepts.length}
                                        </span>
                                        개 정리 · 교수님 강조{" "}
                                        <span className="font-semibold text-gray-900">
                                          {signalCount}
                                        </span>
                                        곳 · 퀴즈{" "}
                                        <span className="font-semibold text-gray-900">
                                          {snapshot.questions.length}
                                        </span>
                                        개
                                      </>
                                    ) : error ? (
                                      `${lectureName} · 아직 분석 전입니다`
                                    ) : (
                                      "요약 불러오는 중…"
                                    )}
                                  </p>
                                  {runState === "done" && (
                                    <span className="flex items-center gap-1 text-xs font-medium text-primary">
                                      <Check className="h-3.5 w-3.5" aria-hidden />
                                      분석 완료 — 피드가 갱신되었습니다.
                                    </span>
                                  )}
                                </div>
                              </div>
                              {files && filteredLectureFiles.length === 0 ? (
                                trimmedQuery !== "" ? (
                                  emptySearchState
                                ) : (
                                  emptyTabState(
                                    <FolderPlus
                                      className="h-6 w-6 text-gray-300"
                                      aria-hidden
                                    />,
                                    `${lectureName}의 자료가 없습니다`,
                                    "파일을 업로드해 학습을 시작해보세요."
                                  )
                                )
                              ) : !files ? (
                                <p className="text-sm text-gray-400">불러오는 중…</p>
                              ) : (
                                <div className={gridClass}>
                                  {filteredLectureFiles.map((d) =>
                                    renderFileCard(d, {
                                      key: d.key,
                                      folder: lecture?.folderKey ?? "",
                                      badge: snapshot ? "분석됨" : undefined,
                                      onClick: () => openFileFromCard(d.entry),
                                    })
                                  )}
                                </div>
                              )}
                            </section>
                        )}

                        {/* ── [슬라이드 설명] 탭 — 슬라이드 리더 (PDF) ── */}
                        {openFile && fileView === "pdf" && detailTab === "slides" && (
                          <section
                            className="flex min-h-0 flex-1 flex-col"
                            data-testid="tab-slides"
                          >
                            {lectureDocs.length === 0 ? (
                              emptyTabState(
                                <FileText className="h-6 w-6 text-gray-300" aria-hidden />,
                                "강의자료를 올려주세요",
                                `${lectureName}에 강의 슬라이드(PDF)가 없습니다. 자료를 올리면 슬라이드별 설명을 만들어드립니다.`,
                                <button
                                  onClick={handleUpload}
                                  className="press-scale rounded-xl bg-primary/10 px-6 py-2.5 text-sm font-semibold text-primary transition-colors duration-200 hover:bg-primary/20"
                                >
                                  {desktop ? "강의자료 업로드" : "PDF 열어보기"}
                                </button>,
                                "slides-empty"
                              )
                            ) : (
                              <>
                                <div className="flex min-h-0 flex-1 gap-3">
                                  {/* PDF — 남은 공간 전부 (목차는 앱 사이드바 자리로 이동) */}
                                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                                    {activeDocPdf ? (
                                      <PdfViewer
                                        url={pdfViewUrl}
                                        page={docPage}
                                        onPageChange={setDocPage}
                                        onNumPages={setDocNumPages}
                                        compact
                                      />
                                    ) : (
                                      <p className="text-sm text-gray-400">
                                        강의자료를 올려주세요.
                                      </p>
                                    )}
                                  </div>

                                  {/* 우: 페이지 요약 (접기 가능) */}
                                  <aside
                                    className={`glass-card flex shrink-0 flex-col overflow-hidden rounded-2xl transition-[width] duration-300 ${
                                      readerPanelOpen ? "w-[340px]" : "w-[52px]"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 px-2 pt-2.5">
                                      <button
                                        onClick={() => setReaderPanelOpen((v) => !v)}
                                        title={
                                          readerPanelOpen ? "패널 접기" : "패널 펼치기"
                                        }
                                        aria-label={
                                          readerPanelOpen ? "패널 접기" : "패널 펼치기"
                                        }
                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                                      >
                                        {readerPanelOpen ? (
                                          <PanelRightClose
                                            className="h-[18px] w-[18px]"
                                            aria-hidden
                                          />
                                        ) : (
                                          <PanelRightOpen
                                            className="h-[18px] w-[18px]"
                                            aria-hidden
                                          />
                                        )}
                                      </button>
                                      {readerPanelOpen && (
                                        <p className="truncate text-xs font-semibold text-gray-700">
                                          슬라이드별 설명
                                        </p>
                                      )}
                                    </div>

                                    {readerPanelOpen && (
                                      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-3">
                                        {docSlides.length > 0 ? (
                                          <div data-testid="slide-summary">
                                            {slideCurrentCard}
                                          </div>
                                        ) : (
                                          /* 요약 없음 — 빈 상태 + 라이브 생성 버튼 */
                                          <div
                                            className="flex flex-col items-center py-10 text-center"
                                            data-testid="slide-generate-empty"
                                          >
                                            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-black/5 bg-white/70 shadow-sm">
                                              <Sparkles
                                                className="h-6 w-6 text-gray-300"
                                                aria-hidden
                                              />
                                            </div>
                                            <p className="text-sm font-semibold text-gray-700">
                                              이 문서의 슬라이드별 설명이 아직 없습니다
                                            </p>
                                            <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-gray-400">
                                              만들면 슬라이드별 설명·핵심 포인트·시험
                                              팁이 여기에 표시됩니다.
                                            </p>
                                            <button
                                              onClick={() =>
                                                void handleGenerateSlides()
                                              }
                                              disabled={
                                                desktop &&
                                                slideGenState === "running"
                                              }
                                              data-testid="slide-generate-button"
                                              title={
                                                !desktop
                                                  ? "웹 데모 — 설명 생성은 데스크톱 앱에서 동작해요"
                                                  : "이 문서의 슬라이드별 설명 만들기"
                                              }
                                              className="press-scale mt-5 flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                              {slideGenState === "running" ? (
                                                <>
                                                  <span
                                                    className="spinner"
                                                    aria-hidden
                                                  />
                                                  생성 중…
                                                </>
                                              ) : (
                                                <>
                                                  <Sparkles
                                                    className="h-4 w-4"
                                                    aria-hidden
                                                  />
                                                  슬라이드별 설명 만들기
                                                </>
                                              )}
                                            </button>
                                            {slideGenState === "running" && (
                                              <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
                                                엔진이 슬라이드별 설명을 만드는 중입니다
                                                — 수 분 걸릴 수 있어요.
                                              </p>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </aside>
                                </div>
                              </>
                            )}
                          </section>
                        )}

                        {/* ── [슬라이드 설명] 탭 — 슬라이드 카드 뷰 (PPT) ── */}
                        {openFile && fileView === "slides" && detailTab === "slides" && (
                          <section
                            className="flex min-h-0 flex-1 flex-col"
                            data-testid="tab-ppt-slides"
                          >
                            <div className="mb-4 flex items-center justify-end gap-3">
                              {activeDocPdf && (
                                <button
                                  onClick={() => void openOriginalDoc(activeDocPdf)}
                                  data-testid="open-original-doc"
                                  className="press-scale flex items-center gap-1.5 rounded-xl border border-black/[0.06] bg-white/70 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors duration-200 hover:bg-white hover:text-gray-900"
                                  title="원본 슬라이드 파일 열기/다운로드"
                                >
                                  <FileText className="h-3.5 w-3.5" aria-hidden />
                                  원본 파일 열기
                                </button>
                              )}
                            </div>

                            {docSlides.length > 0 ? (
                              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                                <p className="mb-3 text-xs text-gray-400">
                                  PPT는 페이지 이미지 대신 슬라이드별 텍스트·설명을
                                  카드로 보여줍니다 · 슬라이드 {docSlides.length}장
                                </p>
                                <div
                                  className="space-y-3"
                                  data-testid="ppt-slide-list"
                                >
                                  {docSlides.map((s) => (
                                    <article
                                      key={s.slide_id}
                                      data-testid="ppt-slide-card"
                                      className="glass-card rounded-2xl p-4"
                                    >
                                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
                                        슬라이드 {s.page}
                                      </p>
                                      <h3 className="text-sm font-bold text-gray-900">
                                        {s.title_ko}
                                      </h3>
                                      {s.summary_ko && (
                                        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-700">
                                          {s.summary_ko}
                                        </p>
                                      )}
                                      {s.key_points_ko.length > 0 && (
                                        <ul className="mt-2.5 space-y-1">
                                          {s.key_points_ko.map((k, i) => (
                                            <li
                                              key={i}
                                              className="flex gap-1.5 text-xs leading-relaxed text-gray-600"
                                            >
                                              <span
                                                className="mt-[6px] inline-block h-1 w-1 shrink-0 rounded-full bg-primary/60"
                                                aria-hidden
                                              />
                                              {k}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                      {s.exam_tip && (
                                        <p className="mt-2.5 rounded-lg border border-amber-300/60 bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-800">
                                          <span className="font-semibold">
                                            ⚠️ 시험 팁 ·{" "}
                                          </span>
                                          {s.exam_tip}
                                        </p>
                                      )}
                                    </article>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              /* 요약 없음 — 빈 상태 + 라이브 생성 버튼 */
                              <div
                                className="flex flex-1 flex-col items-center justify-center py-12 text-center"
                                data-testid="ppt-generate-empty"
                              >
                                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-black/5 bg-white/70 shadow-sm">
                                  <Sparkles
                                    className="h-6 w-6 text-gray-300"
                                    aria-hidden
                                  />
                                </div>
                                <p className="text-sm font-semibold text-gray-700">
                                  이 슬라이드의 요약이 아직 없습니다
                                </p>
                                <p className="mt-1 max-w-[280px] text-xs leading-relaxed text-gray-400">
                                  생성하면 슬라이드별 설명·핵심 포인트·시험 팁이
                                  카드로 표시됩니다. (완전한 슬라이드 이미지 뷰어는
                                  로드맵)
                                </p>
                                <button
                                  onClick={() => void handleGenerateSlides()}
                                  disabled={desktop && slideGenState === "running"}
                                  data-testid="ppt-generate-button"
                                  title={
                                    !desktop
                                      ? "웹 데모 — 요약 생성은 데스크톱 앱에서 동작해요"
                                      : "이 슬라이드의 요약 생성"
                                  }
                                  className="press-scale mt-5 flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {slideGenState === "running" ? (
                                    <>
                                      <span className="spinner" aria-hidden />
                                      생성 중…
                                    </>
                                  ) : (
                                    <>
                                      <Sparkles className="h-4 w-4" aria-hidden />
                                      슬라이드별 설명 만들기
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </section>
                        )}

                        {/* ── [강의 요약] 탭 (세부 페이지) — 이 자료 한 장 정리 ── */}
                        {detailMode && detailTab === "note" && (
                          <section
                            className="mx-auto w-full max-w-[1100px]"
                            data-testid="detail-note"
                          >
                            {docSlides.length > 0 ? (
                              <div className="glass-card rounded-3xl px-10 py-9 lg:px-14">
                                <header className="mb-7 border-b border-black/[0.06] pb-5">
                                  <h2 className="text-xl font-bold tracking-tight text-gray-900">
                                    {activeDocPdf?.title ?? activeDocKey}
                                  </h2>
                                  <p className="mt-1.5 text-sm text-gray-400">
                                    {docSlides.length}쪽 자료
                                  </p>
                                </header>

                                {/* 이 자료가 무엇을 다루나 — 쪽별 카드로는 알 수 없는 전체 그림 */}
                                {activeDocSummary?.overview && (
                                  <p className="mb-7 whitespace-pre-line text-[15px] leading-[1.9] text-gray-700">
                                    {activeDocSummary.overview}
                                  </p>
                                )}

                                {/* 주제별 정리 — 이 화면만 봐도 핵심이 잡히도록 내용까지 담는다 */}
                                {activeDocSummary && activeDocSummary.themes.length > 0 && (
                                  <div className="mb-8">
                                    <p className="mb-4 flex items-baseline gap-2 text-sm font-bold text-gray-900">
                                      핵심 정리
                                      <span className="text-xs font-medium text-gray-400">
                                        {activeDocSummary.themes.length}개 주제
                                      </span>
                                    </p>
                                    <ol className="flex flex-col gap-5">
                                      {activeDocSummary.themes.map((t, ti) => (
                                        <li
                                          key={t.name}
                                          className="rounded-2xl border border-black/[0.07] bg-white/60 px-6 py-5"
                                        >
                                          {/* 주제 제목 + 이 주제가 나온 쪽 */}
                                          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-black/[0.05] pb-3">
                                            <h3 className="flex items-center gap-2.5 text-[15.5px] font-bold text-gray-900">
                                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[11px] font-bold text-primary">
                                                {ti + 1}
                                              </span>
                                              {t.name}
                                            </h3>
                                            <span className="flex flex-wrap items-center gap-1">
                                              {t.pages.map((pg) => (
                                                <button
                                                  key={pg}
                                                  onClick={() => {
                                                    setDocPage(pg);
                                                    setDetailTab("slides");
                                                  }}
                                                  title={`${pg}쪽 보기`}
                                                  className="press-scale rounded-md bg-black/[0.04] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-gray-500 transition-colors duration-200 hover:bg-primary/15 hover:text-primary"
                                                >
                                                  {pg}
                                                </button>
                                              ))}
                                            </span>
                                          </div>

                                          {/* 핵심 내용 — 용어 나열이 아니라 실제 설명 */}
                                          {(t.body || t.point) && (
                                            <p className="whitespace-pre-line text-[14.5px] leading-[1.85] text-gray-700">
                                              {t.body || t.point}
                                            </p>
                                          )}

                                          {/* 짚고 넘어갈 것 */}
                                          {t.keyPoints && t.keyPoints.length > 0 && (
                                            <ul className="mt-3.5 flex flex-col gap-2 rounded-xl bg-black/[0.02] px-4 py-3.5">
                                              {t.keyPoints.map((k, i) => (
                                                <li
                                                  key={i}
                                                  className="flex gap-2.5 text-[13.5px] leading-relaxed text-gray-600"
                                                >
                                                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                                                  <span className="min-w-0">{k}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                        </li>
                                      ))}
                                    </ol>
                                  </div>
                                )}

                                {/* 쪽별 상세 — 주제 요약이 있으면 접어둔다 (필요할 때만 펼쳐 본다) */}
                                <details
                                  className="group border-t border-black/[0.06] pt-5"
                                  open={!activeDocSummary?.themes.length}
                                >
                                  <summary className="mb-5 flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900">
                                    <ChevronRight
                                      className="h-4 w-4 text-gray-400 transition-transform duration-200 group-open:rotate-90"
                                      aria-hidden
                                    />
                                    쪽별 상세 ({docSlides.length}쪽)
                                  </summary>
                                <ol className="flex flex-col gap-6">
                                  {docSlides.map((s) => (
                                    <li key={s.slide_id} className="flex gap-4">
                                      <button
                                        onClick={() => {
                                          setDocPage(s.page);
                                          setDetailTab("slides");
                                        }}
                                        title={`${s.page}쪽으로 이동`}
                                        className="press-scale mt-0.5 h-7 shrink-0 rounded-lg bg-primary/10 px-2.5 font-mono text-xs font-semibold text-primary transition-colors duration-200 hover:bg-primary/20"
                                      >
                                        {s.page}
                                      </button>
                                      <div className="min-w-0 flex-1">
                                        <h3 className="text-[15px] font-bold text-gray-900">
                                          {s.title_ko}
                                        </h3>
                                        <p className="mt-1 text-[14px] leading-relaxed text-gray-600">
                                          {s.summary_ko}
                                        </p>
                                        {s.key_points_ko.length > 0 && (
                                          <ul className="mt-2 flex flex-col gap-1">
                                            {s.key_points_ko.map((k, i) => (
                                              <li
                                                key={i}
                                                className="flex gap-2 text-[13.5px] leading-relaxed text-gray-500"
                                              >
                                                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/50" />
                                                <span className="min-w-0">{k}</span>
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ol>
                                </details>
                              </div>
                            ) : noteHtml ? (
                              /* 슬라이드별 설명이 아직 없으면 이 수업의 학습노트로 대체 */
                              <div>
                                <p className="mb-4 text-sm text-gray-400">
                                  이 자료의 쪽별 정리는 아직 없어서, 이 수업의 학습노트를 보여드려요.
                                </p>
                                {noteHasCards ? (
                                  <NoteCards
                                    markdown={snapshot!.note!.markdown}
                                  />
                                ) : (
                                  <div className="glass-card rounded-2xl px-10 py-9 lg:px-14">
                                    <div
                                      className="note-md note-md-wide"
                                      dangerouslySetInnerHTML={{ __html: noteHtml }}
                                    />
                                  </div>
                                )}
                              </div>
                            ) : (
                              emptyTabState(
                                <FileText
                                  className="h-6 w-6 text-gray-300"
                                  aria-hidden
                                />,
                                "강의 요약이 아직 없습니다",
                                "자료를 넣으면 에이전트가 알아서 분석합니다. 지금 바로 실행할 수도 있어요.",
                                analyzeButton,
                                "detail-note-empty"
                              )
                            )}
                          </section>
                        )}

                        {/* ── [퀴즈] 탭 (세부 페이지) — 폴더 예상문제 재활용 ── */}
                        {detailMode && detailTab === "quiz" && (
                          <QuizTab
                            questions={snapshot?.questions ?? []}
                            folderKey={lecture?.folderKey ?? ""}
                            focusQuestionId={openQuestion}
                            onFocusHandled={clearOpenQuestion}
                            loading={!snapshot && !error}
                            emptyState={emptyTabState(
                              <BookOpen
                                className="h-6 w-6 text-gray-300"
                                aria-hidden
                              />,
                              "이 수업은 아직 예상문제가 없어요",
                              "자료를 넣으면 에이전트가 근거와 출처가 있는 예상문제를 만들어 둡니다.",
                              analyzeButton,
                              "detail-quiz-empty"
                            )}
                          />
                        )}

                        {/* ── [녹음·필기] 탭 — 이 폴더 전사·필기 목록 + 업로드 ── */}
                        {detailMode && detailTab === "recording" && (
                          <section
                            className="mx-auto w-full max-w-[1100px]"
                            data-testid="detail-recording"
                          >
                            {recDoc ? (
                              /* 탭 안에서 전사/필기 원문 뷰 (다른 화면 이동 아님) */
                              <div>
                                <button
                                  onClick={() => setRecDoc(null)}
                                  data-testid="detail-recording-back"
                                  className="press-scale mb-4 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-gray-600 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-900"
                                >
                                  <ArrowLeft className="h-4 w-4" aria-hidden /> 목록으로
                                </button>
                                <div className="mb-4 flex items-center gap-2.5">
                                  <FileIcon type="doc" />
                                  <p className="truncate text-sm font-semibold text-gray-900">
                                    {recDoc.name}
                                  </p>
                                </div>
                                <div className="glass-card rounded-2xl p-6">
                                  {recDoc.text === null ? (
                                    <p className="text-sm text-gray-400">
                                      원문 불러오는 중…
                                    </p>
                                  ) : (
                                    <TranscriptViewer
                                      text={recDoc.text || ""}
                                      unitName={lectureName}
                                      highlights={transcriptHighlights}
                                      focusAnchor={transcriptFocus}
                                      onFocusHandled={() =>
                                        setTranscriptFocus(null)
                                      }
                                    />
                                  )}
                                </div>
                              </div>
                            ) : recordingEntries.length > 0 ? (
                              <div>
                                <div className="mb-4 flex items-center justify-between gap-3">
                                  <p className="text-xs text-gray-400">
                                    이 폴더의 전사본·필기 · {recordingEntries.length}개
                                  </p>
                                  <button
                                    onClick={() =>
                                      void uploadTo(
                                        lecture?.folderKey ?? "",
                                        lectureName,
                                        "note"
                                      )
                                    }
                                    data-testid="detail-recording-upload"
                                    className="press-scale flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-colors duration-200 hover:bg-primary/20"
                                  >
                                    <Upload className="h-4 w-4" aria-hidden />
                                    전사본·필기 올리기
                                  </button>
                                </div>
                                <ul className="flex flex-col gap-2.5">
                                  {recordingEntries.map((f) => (
                                    <li key={f.name}>
                                      <button
                                        onClick={() =>
                                          setRecDoc({ name: f.name, text: null })
                                        }
                                        data-testid="detail-recording-item"
                                        className="press-scale flex w-full items-center gap-3 rounded-2xl border border-black/[0.05] bg-white/70 px-4 py-3 text-left transition-colors duration-200 hover:bg-white"
                                      >
                                        <FileIcon
                                          type={
                                            f.kind === "transcript" ? "audio" : "doc"
                                          }
                                        />
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-sm font-semibold text-gray-900">
                                            {f.name}
                                          </span>
                                          <span className="block text-xs text-gray-400">
                                            {f.kind === "transcript"
                                              ? "강의 녹음 전사본"
                                              : "필기"}{" "}
                                            · {formatSize(f.size)}
                                          </span>
                                        </span>
                                        <ArrowUpRight
                                          className="h-4 w-4 shrink-0 text-gray-300"
                                          aria-hidden
                                        />
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : (
                              emptyTabState(
                                <Mic className="h-6 w-6 text-gray-300" aria-hidden />,
                                "이 강의 녹음 전사본을 올려주세요",
                                "전사 텍스트(.txt)·필기(.md)를 올리면 이 자료와 짝지어 같은 폴더에 저장됩니다. 오디오 파일은 직접 업로드로는 받지 않아요 — 전사 텍스트(.txt)를 올려주세요.",
                                <button
                                  onClick={() =>
                                    void uploadTo(
                                      lecture?.folderKey ?? "",
                                      lectureName,
                                      "note"
                                    )
                                  }
                                  data-testid="detail-recording-upload"
                                  className="press-scale flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover"
                                >
                                  <Upload className="h-4 w-4" aria-hidden />
                                  전사본·필기 올리기
                                </button>,
                                "detail-recording-empty"
                              )
                            )}
                          </section>
                        )}

                        {/* ── [AI 챗봇] 탭 — 미구현 목업 (입력 비활성) ── */}
                        {detailMode && detailTab === "chat" && (
                          <section
                            className="mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col"
                            data-testid="detail-chat"
                          >
                            <div className="mb-4 flex items-center gap-2">
                              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                                <MessageSquare
                                  className="h-[18px] w-[18px] text-primary"
                                  aria-hidden
                                />
                              </span>
                              <div>
                                <p className="text-sm font-bold tracking-tight text-gray-900">
                                  이 자료에 대해 무엇이든 물어보세요
                                </p>
                                <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600">
                                  <Sparkles className="h-3 w-3" aria-hidden />
                                  곧 지원돼요
                                </span>
                              </div>
                            </div>

                            {/* 준비 중 안내 — 대화 내역 없음 */}
                            <div className="glass-card flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl p-6 text-center">
                              <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-black/5 bg-white/70 shadow-sm">
                                <MessageSquare
                                  className="h-6 w-6 text-gray-300"
                                  aria-hidden
                                />
                              </span>
                              <p className="text-sm font-semibold text-gray-700">
                                이 자료를 근거로 답하는 챗봇을 준비하고 있어요
                              </p>
                            </div>

                            {/* 비활성 입력창 */}
                            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-black/[0.06] bg-black/[0.02] px-4 py-3">
                              <input
                                type="text"
                                disabled
                                placeholder="준비 중 — 곧 지원돼요"
                                data-testid="detail-chat-input"
                                className="min-w-0 flex-1 cursor-not-allowed bg-transparent text-sm text-gray-400 placeholder-gray-400 focus:outline-none"
                              />
                              <button
                                disabled
                                aria-label="보내기"
                                className="flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-xl bg-black/[0.05] text-gray-300"
                              >
                                <ArrowUpRight className="h-4 w-4" aria-hidden />
                              </button>
                            </div>
                          </section>
                        )}

                        {/* ── 전사 뷰어 (전사본 파일을 열었을 때) ── */}
                        {openFile && fileView === "transcript" && (
                          <section data-testid="tab-transcript">
                            <button
                              onClick={() => setOpenFile(null)}
                              data-testid="file-view-exit"
                              className="press-scale mb-4 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-gray-600 transition-colors duration-200 hover:bg-white/60 hover:text-gray-900"
                            >
                              <ArrowLeft className="h-4 w-4" aria-hidden /> 목록으로
                            </button>
                            {/* 녹음 플레이어 */}
                            <div
                              className="glass-card mb-6 rounded-2xl p-5"
                              data-testid="transcript-audio"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                  <FileIcon type="audio" />
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900">
                                      강의 녹음 전사본
                                    </p>
                                    <p className="text-xs text-gray-400">
                                      {lectureName} · 전사 텍스트
                                    </p>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {transcriptText && (
                                    <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-600">
                                      <Check className="h-3.5 w-3.5" aria-hidden />
                                      전사본
                                    </span>
                                  )}
                                  <button
                                    disabled
                                    title="강의 녹음이 기기를 떠나지 않는 온디바이스 전사"
                                    className="cursor-not-allowed rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-xs font-medium text-gray-400"
                                  >
                                    로컬 Whisper 전사 — 지원 예정
                                  </button>
                                </div>
                              </div>
                              <div className="mt-4">
                                {audioSrc ? (
                                  <audio
                                    ref={audioRef}
                                    controls
                                    src={audioSrc}
                                    preload="metadata"
                                    onTimeUpdate={(e) =>
                                      setAudioTime(e.currentTarget.currentTime)
                                    }
                                    className="w-full"
                                  />
                                ) : (
                                  /* 녹음 파일 없음 — 거짓 플레이어 대신 전사본 상태 카드 */
                                  <div
                                    className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-4 py-3.5"
                                    data-testid="transcript-audio-status"
                                  >
                                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                                      <div className="flex items-center gap-2">
                                        <Check
                                          className="h-4 w-4 shrink-0 text-emerald-600"
                                          aria-hidden
                                        />
                                        <p className="text-sm font-semibold text-gray-800">
                                          전사본
                                        </p>
                                      </div>
                                      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500">
                                        <div className="flex items-baseline gap-1.5">
                                          <dt className="text-gray-400">분량</dt>
                                          <dd className="font-semibold text-gray-700">
                                            약 59분
                                          </dd>
                                        </div>
                                        <div className="flex items-baseline gap-1.5">
                                          <dt className="text-gray-400">형식</dt>
                                          <dd className="font-semibold text-gray-700">
                                            전사 텍스트 (화자 분리)
                                          </dd>
                                        </div>
                                        <div className="flex items-baseline gap-1.5">
                                          <dt className="text-gray-400">발화</dt>
                                          <dd className="font-semibold text-gray-700">
                                            {transcriptBody
                                              ? `${transcriptBody.blocks.length}개 구간`
                                              : "—"}
                                          </dd>
                                        </div>
                                      </dl>
                                    </div>
                                    <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-gray-400">
                                      <Mic
                                        className="mt-px h-3.5 w-3.5 shrink-0"
                                        aria-hidden
                                      />
                                      전사 텍스트(.txt)만 올려 분석합니다 — 오디오
                                      파일은 앱에 들어오지 않습니다.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>

                            {transcriptBody || transcriptText ? (
                              <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                                {/* 좌: 타임스탬프 전사문 — 패널 스크롤을 따라간다 (이중 스크롤 금지) */}
                                <div className="min-w-0 lg:w-[58%]">
                                  <div className="glass-card rounded-2xl p-6">
                                    {transcriptBody ? (
                                      <div className="space-y-1.5">
                                        {transcriptBody.intro && (
                                          <p className="mb-4 whitespace-pre-wrap border-b border-black/5 pb-4 text-xs leading-relaxed text-gray-400">
                                            {transcriptBody.intro}
                                          </p>
                                        )}
                                        {transcriptBody.blocks.map((b, i) => {
                                          const active = i === activeBlockIdx;
                                          return (
                                            <div
                                              key={i}
                                              data-testid={
                                                active ? "transcript-active" : undefined
                                              }
                                              className={`rounded-xl px-3 py-2.5 transition-colors duration-200 ${
                                                active
                                                  ? "bg-primary/[0.07] ring-1 ring-primary/30"
                                                  : ""
                                              }`}
                                            >
                                              <div className="mb-1.5 flex items-center gap-2">
                                                {audioSrc ? (
                                                  <button
                                                    onClick={() => {
                                                      const a = audioRef.current;
                                                      if (!a) return;
                                                      a.currentTime = timeToSeconds(
                                                        b.time
                                                      );
                                                      void a.play();
                                                    }}
                                                    title={`${b.time}부터 재생`}
                                                    className="press-scale rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-medium text-primary transition-colors duration-200 hover:bg-primary/20"
                                                  >
                                                    {b.time}
                                                  </button>
                                                ) : (
                                                  <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-medium text-primary">
                                                    {b.time}
                                                  </span>
                                                )}
                                                <span className="text-xs text-gray-400">
                                                  {b.speaker}
                                                </span>
                                              </div>
                                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                                                {b.text}
                                              </p>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                                        {transcriptText}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* 우: 이 자료의 AI 분석 — 전사문을 내려도 따라온다 */}
                                <aside className="min-w-0 lg:sticky lg:top-0 lg:w-[42%]">
                                  <div className="glass-card rounded-2xl p-5">
                                    <h2 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">
                                      이 자료에서 에이전트가 찾은 것
                                    </h2>
                                    {renderAiPanel(transcriptDetail)}
                                  </div>
                                </aside>
                              </div>
                            ) : (
                              emptyTabState(
                                <Mic className="h-6 w-6 text-gray-300" aria-hidden />,
                                "전사본이 아직 없습니다",
                                "녹음을 올리면 전사합니다 (로컬 Whisper — 지원 예정).",
                                undefined,
                                "transcript-empty"
                              )
                            )}
                          </section>
                        )}

                        {/* ── [강의 요약] 탭 ── */}
                        {!openFile && !isExamFolder && tab === "note" && (
                          <section
                            className="mx-auto w-full max-w-[1100px]"
                            data-testid="tab-note"
                          >
                            {noteHtml ? (
                              noteHasCards ? (
                                <NoteCards
                                  markdown={snapshot!.note!.markdown}
                                />
                              ) : (
                                <div className="glass-card rounded-2xl px-10 py-9 lg:px-14">
                                  <div
                                    className="note-md note-md-wide"
                                    dangerouslySetInnerHTML={{ __html: noteHtml }}
                                  />
                                </div>
                              )
                            ) : (
                              emptyTabState(
                                <FileText
                                  className="h-6 w-6 text-gray-300"
                                  aria-hidden
                                />,
                                noteOnlyMissing
                                  ? "학습노트만 만들어지지 않았어요"
                                  : "강의 요약이 아직 없습니다",
                                noteOnlyMissing
                                  ? `개념 ${snapshot?.concepts.length ?? 0}개와 예상문제 ${snapshot?.questions.length ?? 0}개는 정상적으로 만들어졌습니다. 학습노트 생성만 실패했어요 — 다시 실행하면 노트만 다시 만듭니다.` +
                                    (noteFailureReason ? ` (${noteFailureReason})` : "")
                                  : "자료를 넣으면 에이전트가 알아서 분석합니다. 지금 바로 실행할 수도 있어요.",
                                analyzeButton,
                                "note-empty"
                              )
                            )}
                          </section>
                        )}

                        {/* ── [퀴즈] 탭 — 연습 모드 · 모의고사 모드 ── */}
                        {!openFile && !isExamFolder && tab === "questions" && (
                          <QuizTab
                            questions={snapshot?.questions ?? []}
                            folderKey={lecture?.folderKey ?? ""}
                            focusQuestionId={openQuestion}
                            onFocusHandled={clearOpenQuestion}
                            loading={!snapshot && !error}
                            emptyState={emptyTabState(
                              <BookOpen
                                className="h-6 w-6 text-gray-300"
                                aria-hidden
                              />,
                              "이 수업은 아직 예상문제가 없어요",
                              "자료를 넣으면 에이전트가 근거와 출처가 있는 예상문제를 만들어 둡니다.",
                              analyzeButton,
                              "questions-empty"
                            )}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      {/* watcher 능동 알림 배너 */}
      {watchBanner && (
        <div className="glass-banner-dark toast-pop fixed left-1/2 top-6 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl px-5 py-3.5">
          <span
            className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary shadow-glow"
            aria-hidden
          />
          <span className="text-sm font-medium text-white">{watchBanner}</span>
          <button
            onClick={() => showWatchBanner(null)}
            aria-label="알림 닫기"
            className="ml-1 rounded-md p-0.5 text-white/60 transition-colors duration-200 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {/* 파일 삭제 확인 — 되돌릴 수 없는 실제 파일 삭제 */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="delete-confirm"
        >
          <div className="glass-panel w-full max-w-sm rounded-[28px] p-7">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50">
              <Trash2 className="h-5 w-5 text-red-500" aria-hidden />
            </span>
            <h2 className="text-base font-bold tracking-tight text-gray-900">
              이 파일을 삭제할까요?
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
              되돌릴 수 없습니다.
            </p>
            <p className="mt-3 truncate rounded-xl bg-black/[0.03] px-3 py-2.5 text-xs font-medium text-gray-700">
              {pendingDelete.title}
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="press-scale rounded-xl px-4 py-2 text-sm font-medium text-gray-500 transition-colors duration-200 hover:bg-black/[0.04] hover:text-gray-900 disabled:opacity-40"
              >
                취소
              </button>
              <button
                onClick={() => void confirmDelete()}
                disabled={deleting}
                data-testid="delete-confirm-ok"
                className="press-scale flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-red-500/25 transition-colors duration-200 hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting && <span className="spinner" aria-hidden />}
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 온보딩 — 최초 1회 3-스텝 */}
      {onboardStep > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="glass-panel w-full max-w-md rounded-[28px] p-8 text-center">
            {onboardStep === 1 && (
              <>
                <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/25">
                  <span className="translate-x-[1px] -translate-y-[1px] text-2xl font-bold italic leading-none text-white">
                    A
                  </span>
                </span>
                <h2 className="text-lg font-bold tracking-tight text-gray-900">
                  Aone에 오신 걸 환영해요
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">
                  강의 자료를 넣어두기만 하면 에이전트가 알아서 정리하고 예상문제를
                  만들어드립니다.
                </p>
                <input
                  type="text"
                  value={onboardName}
                  onChange={(e) => setOnboardName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setOnboardStep((s) => s + 1);
                  }}
                  placeholder="이름을 알려주세요 (예: 홍길동)"
                  autoFocus
                  className="mt-4 w-full rounded-xl border border-black/[0.08] bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-primary/60 focus:outline-none"
                />
                <p className="mt-3 rounded-xl bg-black/[0.03] px-3 py-2.5 text-xs text-gray-500">
                  {desktop ? (
                    <>
                      저장소 위치 ·{" "}
                      <span className="font-mono text-gray-700">~/Aone</span>
                    </>
                  ) : (
                    <>웹 데모 · 분석 결과 열람용 (전체 기능은 데스크톱 앱)</>
                  )}
                </p>
              </>
            )}
            {onboardStep === 2 && (
              <>
                <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                  <Zap className="h-6 w-6 text-primary" aria-hidden />
                </span>
                <h2 className="text-lg font-bold tracking-tight text-gray-900">
                  {desktop ? "AI 엔진을 연결하세요" : "AI는 내 컴퓨터에서 동작해요"}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">
                  {desktop
                    ? "이미 쓰고 있는 Claude·GPT 구독을 그대로 연결합니다. 추가 비용이 들지 않습니다."
                    : "이미 쓰고 있는 Claude·GPT 구독을 그대로 씁니다. 웹 데모에서는 이미 분석된 결과를 열람하실 수 있어요."}
                </p>
                {desktop && (
                  <Link
                    href="/settings/engines"
                    onClick={finishOnboarding}
                    className="mt-4 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
                  >
                    설정에서 연결하기 →
                  </Link>
                )}
              </>
            )}
            {onboardStep === 3 && (
              <>
                <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                  <Sparkles className="h-6 w-6 text-primary" aria-hidden />
                </span>
                <h2 className="text-lg font-bold tracking-tight text-gray-900">
                  준비 끝!
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">
                  {desktop
                    ? "수업 폴더에 자료가 추가되면 에이전트가 자동으로 분석을 시작합니다. 지금 바로 둘러보세요."
                    : "이미 분석된 수업 자료가 준비돼 있어요. 강의자료 세부 화면과 시험 대비를 바로 둘러보세요."}
                </p>
              </>
            )}

            {/* 스텝 점 표시 */}
            <div className="mt-6 flex items-center justify-center gap-1.5">
              {[1, 2, 3].map((s) => (
                <span
                  key={s}
                  className={`h-1.5 rounded-full transition-all duration-200 ${
                    s === onboardStep ? "w-5 bg-primary" : "w-1.5 bg-black/10"
                  }`}
                  aria-hidden
                />
              ))}
            </div>

            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={finishOnboarding}
                className="press-scale rounded-xl px-4 py-2 text-sm font-medium text-gray-400 transition-colors duration-200 hover:text-gray-700"
              >
                건너뛰기
              </button>
              <button
                onClick={() =>
                  onboardStep >= 3 ? finishOnboarding() : setOnboardStep((s) => s + 1)
                }
                className="press-scale rounded-xl bg-primary px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover"
              >
                {onboardStep >= 3 ? "시작하기" : "다음"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 전역 진행 필 — 분석·요약이 도는 동안 어느 화면에서든 보인다.
          실패 시 빨간 실패 상태로 3초 표시 후 사라진다 (S5). */}
      {failPill ? (
        <div
          className="toast-pop fixed bottom-7 right-7 z-40 flex max-w-sm items-center gap-3 rounded-2xl bg-red-600/95 px-4 py-3 shadow-xl shadow-red-600/25 backdrop-blur-md"
          data-testid="progress-pill-failed"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-white" aria-hidden />
          <p className="min-w-0 text-[13px] font-semibold leading-snug text-white">
            {failPill}
          </p>
        </div>
      ) : (
        (runState === "running" || slideGenState === "running") &&
        view !== "agent" && (
          <div className="glass-banner-dark fixed bottom-7 right-7 z-40 flex items-center gap-3 rounded-2xl px-4 py-3">
            <span className="spinner spinner-dark shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold leading-tight text-white">
                {slideGenState === "running"
                  ? "슬라이드 요약 생성 중"
                  : `${runTarget ? `${runTarget.unit} ` : ""}분석 중`}
              </p>
              <p className="mt-0.5 font-mono text-[11px] leading-tight text-white/55">
                {fmtElapsed(runElapsed)} · LLM 호출 {runCalls}회
              </p>
            </div>
            {pendingCount > 0 && (
              <span
                className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white/80"
                data-testid="pending-badge"
                title="현재 분석이 끝나면 자동으로 이어서 분석합니다"
              >
                대기 {pendingCount}건
              </span>
            )}
            <button
              onClick={() => setView("agent")}
              className="press-scale ml-1 shrink-0 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-white/80 transition-colors duration-200 hover:bg-white/20"
            >
              자세히
            </button>
          </div>
        )
      )}

      {/* 토스트 — onClick이 있으면 클릭 시 해당 수업/문서로 이동 (부록 A4) */}
      {toast &&
        (toast.onClick ? (
          <button
            onClick={() => {
              const go = toast.onClick;
              setToast(null);
              if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
              go?.();
            }}
            data-testid="toast-action"
            className="glass-banner-dark toast-pop fixed bottom-7 left-1/2 z-50 flex -translate-x-1/2 cursor-pointer items-center gap-2.5 rounded-2xl px-5 py-3 text-left transition-transform duration-200 hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <Info className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="text-sm font-medium text-white">{toast.message}</span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          </button>
        ) : (
          <div className="glass-banner-dark toast-pop fixed bottom-7 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-2xl px-5 py-3">
            <Info className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="text-sm font-medium text-white">{toast.message}</span>
          </div>
        ))}

      {/* ── 웹 데모 전용 — 데스크톱 기능 안내 모달 · 내 PDF 뷰어 ── */}
      {!desktop && (
        <>
          <input
            ref={webPdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleWebPdfSelected}
            className="hidden"
            data-testid="web-pdf-input"
          />
          <DesktopOnlyModal
            feature={desktopOnlyFeature}
            onClose={() => setDesktopOnlyFeature(null)}
          />
          {webPdf && (
            <div
              className="fixed inset-0 z-[65] flex flex-col bg-black/50 p-4 backdrop-blur-sm sm:p-8"
              data-testid="web-pdf-overlay"
            >
              <div className="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
                <div className="flex shrink-0 items-center gap-3 border-b border-black/[0.06] px-5 py-3">
                  <FileText className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold tracking-tight text-gray-900">
                      {webPdf.name}
                    </span>
                    <span className="block text-[11px] text-gray-400">
                      웹 데모 · 이 PDF는 브라우저에서만 열람됩니다. AI 분석은
                      데스크톱 앱에서 동작해요
                    </span>
                  </span>
                  <button
                    onClick={closeWebPdf}
                    aria-label="닫기"
                    data-testid="web-pdf-close"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors duration-200 hover:bg-black/[0.05] hover:text-gray-700"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col p-3">
                  <PdfViewer
                    url={webPdf.url}
                    page={webPdfPage}
                    onPageChange={setWebPdfPage}
                    maxHeight="100%"
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 파일 카드 ⋯ 메뉴 — hover(또는 포커스·열림)에서만 보인다.
 * [열기] [삭제] 두 항목. 브라우저(비-Tauri)에서는 삭제 비활성 + 툴팁.
 */
function FileCardMenu({
  title,
  variant,
  canDelete,
  onOpen,
  onDelete,
}: {
  title: string;
  variant: ViewMode;
  canDelete: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className={`absolute z-10 ${
        variant === "grid"
          ? "right-2.5 top-2.5"
          : "right-2.5 top-1/2 -translate-y-1/2"
      }`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid={`file-menu-${title}`}
        title="더 보기"
        aria-label={`${title} 메뉴`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-8 w-8 items-center justify-center rounded-lg border border-black/[0.06] bg-white/90 text-gray-500 shadow-sm backdrop-blur-md transition-opacity duration-200 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
          open
            ? "opacity-100"
            : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        }`}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="file-menu-popover"
          className="absolute right-0 top-9 w-36 overflow-hidden rounded-xl border border-black/[0.06] bg-white py-1 shadow-xl"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpen();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-gray-700 transition-colors duration-200 hover:bg-black/[0.04]"
          >
            <ArrowUpRight className="h-4 w-4 text-gray-400" aria-hidden />
            열기
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            data-testid="file-menu-delete"
            title={
              canDelete
                ? "이 파일 삭제"
                : "삭제는 데스크톱 앱에서만 할 수 있습니다."
            }
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-red-600 transition-colors duration-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            삭제
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 폴더(과목·유닛) ⋯ 메뉴 — hover(또는 포커스·열림)에서만 보인다. FileCardMenu와 같은 디자인 언어.
 * [이름 바꾸기] / [삭제 → "정말 삭제할까요?" 1회 확인 후 휴지통 이동].
 * className: 부모(.group relative) 기준 절대 위치. compact: 사이드바 행용 작은 버튼.
 */
function FolderMenu({
  name,
  className,
  compact = false,
  variant = "card",
  groupName,
  confirmDelete,
  onRename,
  onTrash,
}: {
  name: string;
  className: string;
  compact?: boolean;
  /** "sidebar" = 배경 없는 순수 아이콘, "card" = 흰 알약 (파일 카드 위) */
  variant?: "sidebar" | "card";
  /** 명명된 group-hover 트리거 (예: "subj" → group-hover/subj) — 행 전체 호버 시 노출 */
  groupName?: string;
  /** false(브라우저)면 확인 단계 없이 바로 onTrash — 호출부가 "데스크톱 앱에서만" 토스트를 띄운다 */
  confirmDelete: boolean;
  onRename: () => void;
  onTrash: () => void;
}) {
  // Tailwind JIT는 정적 문자열만 인식 — 동적 조합 금지, 화이트리스트로 매핑
  const hoverShow =
    groupName === "subj"
      ? "group-hover/subj:opacity-100"
      : groupName === "unit"
        ? "group-hover/unit:opacity-100"
        : "group-hover:opacity-100";
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirming(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`absolute z-10 ${className}`}>
      <button
        onClick={() => {
          setConfirming(false);
          setOpen((v) => !v);
        }}
        data-testid={`folder-menu-${name}`}
        title="더 보기"
        aria-label={`${name} 메뉴`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center justify-center transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
          compact ? "h-6 w-6 rounded-md" : "h-8 w-8 rounded-lg"
        } ${
          variant === "sidebar"
            ? "text-gray-400 hover:bg-black/[0.06] hover:text-gray-700"
            : "border border-black/[0.06] bg-white/90 text-gray-500 shadow-sm backdrop-blur-md hover:text-gray-900"
        } ${
          open
            ? "opacity-100"
            : `opacity-0 focus-visible:opacity-100 ${hoverShow}`
        }`}
      >
        <MoreHorizontal
          className={compact ? "h-3.5 w-3.5" : "h-4 w-4"}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="folder-menu-popover"
          className={`absolute right-0 w-40 overflow-hidden rounded-xl border border-black/[0.06] bg-white py-1 shadow-xl ${
            compact ? "top-7" : "top-9"
          }`}
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirming(false);
              onRename();
            }}
            data-testid="folder-menu-rename"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-gray-700 transition-colors duration-200 hover:bg-black/[0.04]"
          >
            <Pencil className="h-4 w-4 text-gray-400" aria-hidden />
            이름 바꾸기
          </button>
          <button
            role="menuitem"
            onClick={() => {
              if (confirmDelete && !confirming) {
                setConfirming(true);
                return;
              }
              setOpen(false);
              setConfirming(false);
              onTrash();
            }}
            data-testid="folder-menu-delete"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-red-600 transition-colors duration-200 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {confirming ? "정말 삭제할까요?" : "삭제"}
          </button>
        </div>
      )}
    </div>
  );
}

/** MM:SS */
const fmtElapsed = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * 진행 스트립 — 분석 실행 중 현재 화면 상단에 뜨는 글래스 바.
 * "Claude(Pro)로 분석 중 — <단계>" + 스피너 + 경과 시간 + 호출 수 + [중지] + 자세히 보기.
 */
function ProgressStrip({
  step,
  engine,
  elapsed,
  calls,
  onStop,
  onDetails,
}: {
  step: string;
  engine: EngineChoice;
  elapsed: number;
  calls: number;
  onStop: () => void;
  onDetails: () => void;
}) {
  return (
    <div
      className="glass-banner-dark mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-5 py-3"
      data-testid="progress-strip"
    >
      <span className="spinner spinner-dark shrink-0" aria-hidden />
      <span className="min-w-0 text-sm font-semibold text-white">
        {ENGINE_LABELS[engine]}로 분석 중 —{" "}
        <span className="text-primary">{step}</span>
      </span>
      <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-xs text-white/70">
        {fmtElapsed(elapsed)}
      </span>
      <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-white/70">
        LLM 호출 {calls}회
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onDetails}
          className="press-scale rounded-lg px-2.5 py-1 text-xs font-medium text-white/70 transition-colors duration-200 hover:text-white"
        >
          자세히 보기 →
        </button>
        <button
          onClick={onStop}
          data-testid="progress-stop"
          className="press-scale flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-200 hover:bg-red-500/80"
        >
          <Square className="h-3 w-3 fill-current" aria-hidden />
          중지
        </button>
      </div>
    </div>
  );
}

/**
 * 전역 에이전트 화면 (사이드바 "에이전트" 메뉴).
 * 현재 실행 상태(진행 스트립 + 중지) · 전체 활동 이력(모든 수업 병합) · 실행 로그(기본 접힘).
 */
function AgentGlobalView({
  runState,
  runLabel,
  runStep,
  runElapsed,
  runCalls,
  engine,
  agentRunKind,
  slideGenState,
  pendingCount,
  desktop,
  failures,
  onRetry,
  onStop,
  activities,
  concepts,
  proactive,
  onOpenQuestion,
  consoleOpen,
  onToggleConsole,
}: {
  runState: RunUiState;
  /** 실행 중인 수업(unit) 이름 — 없으면 null */
  runLabel: string | null;
  runStep: string;
  runElapsed: number;
  runCalls: number;
  engine: EngineChoice;
  agentRunKind: LogKind | null;
  slideGenState: RunUiState;
  /** 대기 큐(부록 A4) 건수 */
  pendingCount: number;
  /** Tauri 런타임 여부 — 웹 데모에서는 실행 유도 문구를 쓰지 않는다 */
  desktop: boolean;
  /** 실패한 유닛 목록 (S5) — 다시 분석/설정 열기 버튼 */
  failures: AnalysisFailure[];
  onRetry: (f: AnalysisFailure) => void;
  onStop: () => void;
  activities: (Activity & { lectureName: string })[];
  concepts: (Concept & { lectureName: string })[];
  /** 전 수업 병합 능동 제안 — 에이전트가 먼저 건넨 말 */
  proactive: ProactiveItem[];
  onOpenQuestion: (p: ProactiveItem, questionId: string) => void;
  consoleOpen: boolean;
  onToggleConsole: () => void;
}) {
  const running = runState === "running" || slideGenState === "running";
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const suggestions = showAllSuggestions ? proactive : proactive.slice(0, 5);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-black/[0.05] px-8 pb-5 pt-7">
        <h1 className="flex items-center gap-2 text-[26px] font-bold tracking-tight text-gray-900">
          <ActivityIcon className="h-6 w-6 text-primary" aria-hidden />
          에이전트
        </h1>
        <p className="mt-0.5 text-sm font-medium text-gray-400">
          자료를 넣어두면 에이전트가 읽고, 시험에 나올 만한 것을 먼저 알려드려요
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-8">
        {/* 에이전트가 먼저 건넨 말 — 능동 제안 카드 */}
        {proactive.length > 0 && (
          <section className="mb-8" data-testid="agent-proactive">
            <h2 className="mb-1 text-sm font-semibold tracking-tight text-gray-900">
              에이전트가 먼저 건넨 말 · {proactive.length}
            </h2>
            <p className="mb-3 text-xs text-gray-400">
              묻지 않았는데 에이전트가 스스로 판단해 알려준 내용이에요
            </p>
            <ul className="space-y-2">
              {suggestions.map((p, i) => {
                const chip = toProactiveChip(p);
                return (
                  <li
                    key={`${p.lectureName}-${i}`}
                    className="glass-card rounded-2xl border border-primary/20 bg-primary/[0.06] px-5 py-3.5"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-semibold text-gray-900">
                        {chip.concept}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {chip.evidence}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] font-medium text-gray-400">
                        {p.lectureName}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-gray-700">
                      {p.text}
                    </p>
                    {chip.questionIds.length > 0 && (
                      <button
                        onClick={() => onOpenQuestion(p, chip.questionIds[0])}
                        className="press-scale mt-2 text-xs font-medium text-primary underline-offset-2 transition-opacity duration-200 hover:underline"
                      >
                        준비된 예상문제 보기 →
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {proactive.length > 5 && (
              <button
                onClick={() => setShowAllSuggestions((v) => !v)}
                className="press-scale mt-2.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors duration-200 hover:text-gray-800"
              >
                {showAllSuggestions
                  ? "접기 ↑"
                  : `${proactive.length - 5}개 더 보기 ↓`}
              </button>
            )}
          </section>
        )}

        {/* 현재 실행 상태 */}
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold tracking-tight text-gray-900">
            현재 실행 상태
          </h2>
          {running ? (
            <div
              className="glass-banner-dark flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-5 py-3.5"
              data-testid="agent-running-strip"
            >
              <span className="spinner spinner-dark shrink-0" aria-hidden />
              <span className="text-sm font-semibold text-white">
                {runLabel !== null ? `${runLabel} · ` : ""}
                {ENGINE_LABELS[engine]}로 분석 중 —{" "}
                <span className="text-primary">
                  {slideGenState === "running" ? "슬라이드 요약 생성 중" : runStep}
                </span>
              </span>
              <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-xs text-white/70">
                {fmtElapsed(runElapsed)}
              </span>
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs text-white/70">
                LLM 호출 {runCalls}회
              </span>
              {pendingCount > 0 && (
                <span
                  className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white/80"
                  title="현재 분석이 끝나면 자동으로 이어서 분석합니다"
                >
                  대기 {pendingCount}건
                </span>
              )}
              <button
                onClick={onStop}
                data-testid="agent-stop"
                className="press-scale ml-auto flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-200 hover:bg-red-500/80"
              >
                <Square className="h-3 w-3 fill-current" aria-hidden />
                중지
              </button>
            </div>
          ) : (
            <p className="glass-card rounded-2xl px-5 py-4 text-sm text-gray-500">
              {desktop
                ? "실행 중인 분석이 없습니다. 수업 화면에서 자료를 넣으면 여기에 에이전트의 진행 상태가 표시됩니다."
                : "웹 데모에서는 에이전트를 실행하지 않아요 — 아래는 데스크톱 앱이 이미 수행한 분석 활동 기록입니다."}
            </p>
          )}

          {/* 실패한 유닛 (S5) — 원인별 안내 + 다시 분석 / 설정 열기 */}
          {failures.map((f) => (
            <div
              key={`${f.subject}/${f.unit}`}
              className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-3"
              data-testid="agent-failed-strip"
            >
              <AlertTriangle
                className="h-4 w-4 shrink-0 text-red-500"
                aria-hidden
              />
              <p className="min-w-0 flex-1 text-sm font-medium leading-relaxed text-red-700">
                <span className="font-semibold">
                  {f.subject} · {f.unit}
                </span>{" "}
                분석 실패 — {f.message}
              </p>
              {f.reason === "engine" ? (
                <Link
                  href="/settings/engines"
                  className="press-scale shrink-0 rounded-xl bg-red-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-red-600"
                >
                  설정 열기
                </Link>
              ) : (
                <button
                  onClick={() => onRetry(f)}
                  disabled={running}
                  className="press-scale shrink-0 rounded-xl bg-red-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  다시 분석
                </button>
              )}
            </div>
          ))}
        </section>

        {/* 실행 로그 — 기본 접힘 */}
        <section className="mb-8">
          <button
            onClick={onToggleConsole}
            data-testid="agent-console-toggle"
            className="press-scale mb-3 flex items-center gap-1.5 text-sm font-semibold tracking-tight text-gray-900"
          >
            실행 로그
            <ChevronRight
              className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${consoleOpen ? "rotate-90" : ""}`}
              aria-hidden
            />
            {!consoleOpen && (
              <span className="text-xs font-medium text-primary">자세히 보기</span>
            )}
          </button>
          {consoleOpen && (
            <AgentConsole
              runKind={agentRunKind}
              runState={agentRunKind === "slides" ? slideGenState : runState}
              engine={engine}
              activities={[]}
              concepts={concepts}
            />
          )}
        </section>

        {/* 전체 활동 이력 — 모든 수업 병합, 시각 역순. 기본 접힘(개발자용 상세) */}
        <section>
          <details>
            <summary className="mb-3 cursor-pointer list-none text-sm font-semibold tracking-tight text-gray-900 transition-colors duration-200 hover:text-primary">
              전체 활동 이력 · {activities.length}
              <span className="ml-1.5 text-xs font-normal text-gray-400">
                펼치기 ↓
              </span>
            </summary>
          <ul className="space-y-2.5" data-testid="agent-all-activities">
            {activities.map((a, i) => (
              <li key={i} className="glass-card glass-card-hover rounded-xl p-3.5">
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
                    {a.lectureName}
                  </span>
                  <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 font-mono text-gray-500">
                    {a.layer}
                  </span>
                  <span>{new Date(a.ts).toLocaleString("ko-KR")}</span>
                </div>
                <p className="text-sm leading-relaxed text-gray-700">{a.text}</p>
              </li>
            ))}
            {activities.length === 0 && (
              <li className="text-sm text-gray-400">
                아직 활동 내역이 없습니다.
              </li>
            )}
          </ul>
          </details>
        </section>
      </div>
    </div>
  );
}
