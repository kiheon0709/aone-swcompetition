import { invoke } from "@tauri-apps/api/core";

interface TauriWindow extends Window {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
}

export const isTauriRuntime = (): boolean => {
  if (typeof window === "undefined") return false;
  const w = window as TauriWindow;
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
};

export interface EngineStatus {
  codexInstalled: boolean;
  codexVersion: string | null;
  codexLoggedIn: boolean;
  claudeInstalled: boolean;
  claudeVersion: string | null;
  claudeLoggedIn: boolean;
  claudeGlobalCredentials: boolean;
  /** Gemini API 키 존재 여부 (~/.aone/keys.json) */
  geminiKeyPresent: boolean;
  /** 저장된 키가 실제로 유효한지 (백엔드 검증) */
  geminiValid: boolean;
}

export type CodexLoginState = "logged_in" | "not_logged_in" | "not_installed";

export const detectEngines = async (): Promise<EngineStatus | null> => {
  if (!isTauriRuntime()) return null;
  return invoke<EngineStatus>("detect_engines");
};

export const connectCodex = async (): Promise<void> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  await invoke("connect_codex");
};

export const codexStatus = async (): Promise<CodexLoginState> => {
  if (!isTauriRuntime()) return "not_installed";
  return invoke<CodexLoginState>("codex_status");
};

export const runLlm = async (engine: string, prompt: string): Promise<string> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  return invoke<string>("run_llm", { engine, prompt });
};

export interface AnalysisStatus {
  status: "idle" | "running" | "done" | "failed";
  subject: string | null;
  unit: string | null;
  exitCode: number | null;
  logTail: string;
}

/** 수업 폴더(subject/unit) 분석 실행 — Rust run_folder_analysis (§6) */
export const runFolderAnalysis = async (
  subject: string,
  unit: string,
  engine: EngineChoice = "claude"
): Promise<void> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  await invoke("run_folder_analysis", { subject, unit, engine });
};

/** 활성 엔진 선택 (localStorage, 기본 claude) — 부록 A1: 3종 */
export type EngineChoice = "claude" | "codex" | "gemini";

const ACTIVE_ENGINE_STORAGE = "aone.activeEngine";

export const ENGINE_LABELS: Record<EngineChoice, string> = {
  claude: "Claude (Pro)",
  codex: "GPT (Codex)",
  gemini: "Gemini",
};

export const getActiveEngine = (): EngineChoice => {
  if (typeof window === "undefined") return "claude";
  const v = localStorage.getItem(ACTIVE_ENGINE_STORAGE);
  return v === "codex" || v === "gemini" ? v : "claude";
};

export const setActiveEngine = (engine: EngineChoice): void => {
  localStorage.setItem(ACTIVE_ENGINE_STORAGE, engine);
};

export const analysisStatus = async (): Promise<AnalysisStatus> => {
  if (!isTauriRuntime())
    return { status: "idle", subject: null, unit: null, exitCode: null, logTail: "" };
  return invoke<AnalysisStatus>("analysis_status");
};

// ── 슬라이드 요약 라이브 생성 (run_slide_summarize / slide_summarize_status) ──
export interface SlideSummarizeStatus {
  status: "idle" | "running" | "done" | "failed";
  subject: string | null;
  unit: string | null;
  doc: string | null;
  exitCode: number | null;
  logTail: string;
}

export const runSlideSummarize = async (
  subject: string,
  unit: string,
  doc: string,
  engine: EngineChoice = "claude"
): Promise<void> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  await invoke("run_slide_summarize", { subject, unit, doc, engine });
};

export const slideSummarizeStatus = async (): Promise<SlideSummarizeStatus> => {
  if (!isTauriRuntime())
    return {
      status: "idle",
      subject: null,
      unit: null,
      doc: null,
      exitCode: null,
      logTail: "",
    };
  return invoke<SlideSummarizeStatus>("slide_summarize_status");
};

// ── 시험대비 학습 가이드 생성 (run_compose_guide / compose_guide_status) ──
export interface ComposeGuideStatus {
  status: "idle" | "running" | "done" | "failed";
  subject: string | null;
  exitCode: number | null;
  logTail: string;
}

/** 시험 범위 학습 가이드 생성 시작 — units 생략 시 과목 전체 */
export const runComposeGuide = async (
  subject: string,
  units?: string[],
  engine: EngineChoice = "claude"
): Promise<void> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  await invoke("run_compose_guide", { subject, units: units ?? null, engine });
};

export const composeGuideStatus = async (): Promise<ComposeGuideStatus> => {
  if (!isTauriRuntime())
    return { status: "idle", subject: null, exitCode: null, logTail: "" };
  return invoke<ComposeGuideStatus>("compose_guide_status");
};

// ── 에이전트 콘솔용 로그 증분 스트리밍 (analysis_log) ──
export type LogKind = "analysis" | "slides";

export interface LogChunk {
  /** 요청한 fromLine 이후의 신규 줄 */
  lines: string[];
  /** 다음 폴링에 넘길 커서 */
  nextLine: number;
  /** 프로세스 종료 여부 */
  done: boolean;
  exitCode: number | null;
}

export const analysisLog = async (
  kind: LogKind,
  fromLine: number
): Promise<LogChunk> => {
  if (!isTauriRuntime())
    return { lines: [], nextLine: fromLine, done: true, exitCode: null };
  return invoke<LogChunk>("analysis_log", { kind, fromLine });
};

/** 실행 중인 분석·슬라이드 요약을 중지한다 (Child kill). 브라우저에서는 no-op. */
export const stopAnalysis = async (kind: LogKind): Promise<void> => {
  if (!isTauriRuntime()) return;
  await invoke("stop_analysis", { kind });
};

// ── API 키 저장 (부록 A1 — Rust ~/.aone/keys.json, localStorage 금지) ──
export type ApiKeyProvider = "gemini";

export interface ApiKeyStatus {
  gemini: boolean;
}

export const saveApiKey = async (
  provider: ApiKeyProvider,
  key: string
): Promise<void> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  await invoke("save_api_key", { provider, key });
};

export const apiKeyStatus = async (): Promise<ApiKeyStatus> => {
  if (!isTauriRuntime()) return { gemini: false };
  return invoke<ApiKeyStatus>("api_key_status");
};

export const deleteApiKey = async (provider: ApiKeyProvider): Promise<void> => {
  if (!isTauriRuntime()) return;
  await invoke("delete_api_key", { provider });
};

// ── 시간표 실인식 (부록 A2 — recognize_timetable) ──
export interface RecognizedLectureRaw {
  subject: string;
  weekday: string; // "월|화|수|목|금" — 검증은 호출부에서
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  room: string;
}

export interface TimetableRecognition {
  lectures: RecognizedLectureRaw[];
  untimed: string[];
}

/**
 * 시간표 캡처 이미지 실인식 — Rust recognize_timetable (JSON 문자열 반환).
 * engine은 "claude" | "gemini"만 수용 (codex는 백엔드가 명시 거부).
 */
/** 시간표 이미지 네이티브 선택 — 절대 경로 반환 (취소 시 null) */
export const pickTimetableImage = async (): Promise<string | null> => {
  if (!isTauriRuntime()) return null;
  return invoke<string | null>("pick_timetable_image");
};

export const recognizeTimetableImage = async (
  imagePath: string,
  engine: "claude" | "gemini"
): Promise<TimetableRecognition> => {
  if (!isTauriRuntime()) throw new Error("데스크톱 앱에서만 사용할 수 있습니다.");
  const raw = await invoke<unknown>("recognize_timetable", { imagePath, engine });
  // 백엔드가 JSON 문자열/객체 어느 쪽을 반환해도 수용
  const data: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (typeof data !== "object" || data === null) {
    throw new Error("시간표 인식 결과를 해석할 수 없습니다.");
  }
  const o = data as { lectures?: unknown; untimed?: unknown };
  const lectures: RecognizedLectureRaw[] = Array.isArray(o.lectures)
    ? o.lectures.filter(
        (l): l is RecognizedLectureRaw =>
          typeof l === "object" &&
          l !== null &&
          typeof (l as RecognizedLectureRaw).subject === "string" &&
          typeof (l as RecognizedLectureRaw).weekday === "string" &&
          typeof (l as RecognizedLectureRaw).start === "string" &&
          typeof (l as RecognizedLectureRaw).end === "string"
      )
      .map((l) => ({ ...l, room: typeof l.room === "string" ? l.room : "" }))
    : [];
  const untimed: string[] = Array.isArray(o.untimed)
    ? o.untimed.filter((s): s is string => typeof s === "string")
    : [];
  return { lectures, untimed };
};
