"use client";

/**
 * 에이전트 콘솔 — [에이전트] 탭의 본문.
 *
 * 실행 중: 파이프라인 로그를 1초 폴링해 실시간 스트림으로 보여준다
 *   ([LN]/[오케스트레이터] 태그 → 배지, "호출 중…" → 스피너, "완료" → 체크).
 * 실행 종료: 소요 시간·LLM 호출 수·생성물 요약 카드.
 * 미실행: 기존 활동 피드(activities) + 개념별 시험신호.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { analysisLog, ENGINE_LABELS, type EngineChoice, type LogKind } from "@/lib/engines";
import { signalMeta } from "@/lib/signal";

export interface AgentConsoleActivity {
  ts: string;
  layer: string;
  text: string;
}

export interface AgentConsoleConcept {
  id: string;
  name: string;
  examSignal: number;
}

interface Props {
  /** 실행 중인 작업 종류 — null이면 미실행(활동 피드 렌더) */
  runKind: LogKind | null;
  /** "running" | "done" | "failed" — 실행 이력이 없으면 "idle" */
  runState: "idle" | "running" | "done" | "failed";
  engine: EngineChoice;
  activities: AgentConsoleActivity[];
  concepts: AgentConsoleConcept[];
}

/** 로그 한 줄의 파싱 결과 */
interface ParsedLine {
  /** "L0"~"L4" | "오케스트레이터" | "완료" | null(평문·LLM 호출 줄) */
  tag: string | null;
  text: string;
  /** 진행 중(스피너) / 완료(체크) / 일반 */
  state: "pending" | "done" | "plain";
  /** LLM 어댑터 호출 줄 (들여쓰기 표시) */
  isCall: boolean;
}

const TAG_RE = /^\[(L[0-4]|오케스트레이터|완료)\]\s*(.*)$/;
const CALL_RE = /^\s+([→←])\s*(.*)$/;

function parseLine(raw: string): ParsedLine {
  const tagged = TAG_RE.exec(raw);
  if (tagged) {
    const [, tag, text] = tagged;
    const state = text.startsWith("완료") || tag === "완료" ? "done" : text.endsWith("호출 중…") ? "pending" : "plain";
    return { tag, text, state, isCall: false };
  }
  const call = CALL_RE.exec(raw);
  if (call) {
    const [, arrow, text] = call;
    return { tag: null, text, state: arrow === "←" ? "done" : "pending", isCall: true };
  }
  return { tag: null, text: raw, state: "plain", isCall: false };
}

/** 레이어별 배지 색 — 오케스트레이션 단계를 한눈에 구분 */
const TAG_STYLE: Record<string, string> = {
  오케스트레이터: "bg-violet-500/15 text-violet-300",
  L0: "bg-slate-500/20 text-slate-300",
  L1: "bg-sky-500/15 text-sky-300",
  L2: "bg-emerald-500/15 text-emerald-300",
  L3: "bg-amber-500/15 text-amber-300",
  L4: "bg-rose-500/15 text-rose-300",
  완료: "bg-primary/20 text-primary",
};

/** 완료 요약 카드 값 — 로그에서 파싱 */
interface RunSummary {
  seconds: string;
  calls: string;
  concepts?: string;
  questions?: string;
}

const DONE_RE = /^\[완료\]\s*([\d.]+)초\s*·\s*LLM 호출\s*(\d+)회/;
const DONE_ARTIFACTS_RE = /개념\s*(\d+)개\s*·\s*검증 통과 문항\s*(\d+)개/;

function summaryOf(lines: string[]): RunSummary | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = DONE_RE.exec(lines[i]);
    if (!m) continue;
    const artifacts = DONE_ARTIFACTS_RE.exec(lines[i]);
    return {
      seconds: m[1],
      calls: m[2],
      concepts: artifacts?.[1],
      questions: artifacts?.[2],
    };
  }
  return null;
}

/** 지금까지 로그에 나타난 LLM 호출 시작 횟수 */
function callCountOf(lines: string[]): number {
  return lines.filter((l) => /^\s+→/.test(l)).length;
}

export default function AgentConsole({
  runKind,
  runState,
  engine,
  activities,
  concepts,
}: Props) {
  const [lines, setLines] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const cursorRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef<number | null>(null);

  const active = runKind !== null && runState !== "idle";

  // 새 실행이 시작되면 스트림 초기화
  useEffect(() => {
    if (runState === "running") {
      cursorRef.current = 0;
      startedRef.current = Date.now();
      setLines([]);
      setElapsed(0);
    }
  }, [runState, runKind]);

  // 로그 증분 폴링 (1초). 실행이 끝나도 마지막 잔여 줄을 한 번 더 받는다.
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const chunk = await analysisLog(runKind, cursorRef.current);
        if (disposed) return;
        cursorRef.current = chunk.nextLine;
        if (chunk.lines.length > 0) setLines((prev) => [...prev, ...chunk.lines]);
      } catch {
        // 폴링 실패는 다음 주기에 재시도
      }
    };

    void tick();
    if (runState === "running") timer = setInterval(tick, 1000);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, [active, runKind, runState]);

  // 경과 시간 타이머 (실행 중에만)
  useEffect(() => {
    if (runState !== "running") return;
    const t = setInterval(() => {
      if (startedRef.current) setElapsed(Math.floor((Date.now() - startedRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [runState]);

  // 자동 스크롤 — 새 줄이 붙을 때마다 바닥으로
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const summary = summaryOf(lines);
  const calls = callCountOf(lines);

  // ── 미실행: 기존 활동 피드 + 개념 시험신호 ──
  if (!active) {
    return <ActivityFeed activities={activities} concepts={concepts} />;
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.35fr_1fr]">
      {/* 실시간 로그 스트림 */}
      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-gray-900">
          {runKind === "slides" ? "슬라이드 요약 생성 중" : "에이전트 실행 로그"}
        </h2>

        <div className="glass-banner-dark overflow-hidden rounded-2xl">
          {/* 상태 바 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2.5 text-xs">
            <span className="rounded-md bg-primary/20 px-2 py-1 font-medium text-primary">
              엔진: {ENGINE_LABELS[engine]}
            </span>
            <span className="rounded-md bg-white/10 px-2 py-1 font-mono text-white/70">
              {formatElapsed(runState === "running" ? elapsed : Number(summary?.seconds ?? elapsed))}
            </span>
            <span className="rounded-md bg-white/10 px-2 py-1 text-white/70">
              LLM 호출 {summary?.calls ?? calls}회
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-white/70">
              {runState === "running" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
                  실행 중
                </>
              ) : runState === "failed" ? (
                <span className="text-rose-300">실패</span>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
                  완료
                </>
              )}
            </span>
          </div>

          {/* 로그 스트림 */}
          <div
            ref={scrollRef}
            data-testid="agent-log-stream"
            className="h-[26rem] overflow-y-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed"
          >
            {lines.length === 0 && (
              <p className="text-white/40">파이프라인을 시작하는 중…</p>
            )}
            {lines.map((raw, i) => (
              <LogRow key={i} line={parseLine(raw)} />
            ))}
          </div>
        </div>
      </div>

      {/* 완료 요약 + 개념 시험신호 */}
      <div className="space-y-6">
        {summary && (
          <div>
            <h2 className="mb-3 text-sm font-semibold tracking-tight text-gray-900">
              실행 요약
            </h2>
            <div
              className="glass-card rounded-xl p-4"
              data-testid="agent-run-summary"
            >
              <div className="grid grid-cols-2 gap-3">
                <SummaryStat label="소요 시간" value={`${summary.seconds}초`} />
                <SummaryStat label="LLM 호출" value={`${summary.calls}회`} />
                {summary.concepts && (
                  <SummaryStat label="개념" value={`${summary.concepts}개`} />
                )}
                {summary.questions && (
                  <SummaryStat label="검증 통과 문항" value={`${summary.questions}개`} />
                )}
              </div>
            </div>
          </div>
        )}

        <div>
          <h2 className="mb-3 text-sm font-semibold tracking-tight text-gray-900">
            개념별 시험신호
          </h2>
          <ConceptSignals concepts={concepts} />
        </div>
      </div>
    </div>
  );
}

function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold tracking-tight text-gray-900">{value}</p>
    </div>
  );
}

function LogRow({ line }: { line: ParsedLine }) {
  return (
    <div
      className={`flex items-start gap-2 py-0.5 ${line.isCall ? "pl-4 text-white/50" : "text-white/85"}`}
    >
      {/* 상태 아이콘 */}
      <span className="mt-[3px] w-3.5 shrink-0">
        {line.state === "pending" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
        ) : line.state === "done" ? (
          <Check className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
        ) : null}
      </span>

      {line.tag && (
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            TAG_STYLE[line.tag] ?? "bg-white/10 text-white/70"
          }`}
        >
          {line.tag}
        </span>
      )}
      <span className="min-w-0 break-words">{line.text}</span>
    </div>
  );
}

/** 미실행 상태의 기존 화면 — 활동 피드 + 개념 시험신호 */
function ActivityFeed({
  activities,
  concepts,
}: {
  activities: AgentConsoleActivity[];
  concepts: AgentConsoleConcept[];
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-gray-900">
          에이전트 활동
        </h2>
        <ul className="space-y-2.5">
          {activities.map((a, i) => (
            <li key={i} className="glass-card glass-card-hover rounded-xl p-3.5">
              <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-500">
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-primary">
                  {a.layer}
                </span>
                <span>{new Date(a.ts).toLocaleString("ko-KR")}</span>
              </div>
              <p className="text-sm leading-relaxed">{a.text}</p>
            </li>
          ))}
          {activities.length === 0 && (
            <li className="text-sm text-gray-400">활동 내역이 없습니다.</li>
          )}
        </ul>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-gray-900">
          개념별 시험신호
        </h2>
        <ConceptSignals concepts={concepts} />
      </div>
    </div>
  );
}

function ConceptSignals({ concepts }: { concepts: AgentConsoleConcept[] }) {
  return (
    <ul className="space-y-2.5">
      {concepts.map((c) => {
        const meta = signalMeta(c.examSignal);
        return (
          <li key={c.id} className="glass-card glass-card-hover rounded-xl p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{c.name}</span>
              <span
                className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} aria-hidden />
                {meta.label}
              </span>
            </div>
          </li>
        );
      })}
      {concepts.length === 0 && (
        <li className="text-sm text-gray-400">등록된 개념이 없습니다.</li>
      )}
    </ul>
  );
}
