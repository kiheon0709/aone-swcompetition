"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Monitor } from "lucide-react";
import {
  codexStatus,
  connectCodex,
  detectEngines,
  ENGINE_LABELS,
  getActiveEngine,
  isTauriRuntime,
  runLlm,
  saveApiKey,
  setActiveEngine,
  type CodexLoginState,
  type EngineChoice,
  type EngineStatus,
} from "@/lib/engines";
import { userErrorMessage } from "@/lib/fs-bridge";

interface UsageRun {
  ts: string;
  engine: string;
  /** 신규 run 항목 — folderKey 배열 (예: ["데이터통신/1주차"]) */
  folders?: string[];
  /** 구버전 run 항목 폴백 */
  weeks?: number[];
  calls: number;
  outputTokens: number;
  costUsd: number;
}

interface UsageData {
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    costUsd: number;
  };
  runs: UsageRun[];
}

type CodexUiState =
  | "unknown"
  | "not_installed"
  | "not_logged_in"
  | "connecting"
  | "logged_in";

function Badge({ children, tone }: { children: React.ReactNode; tone: "on" | "off" | "pending" | "muted" }) {
  const styles: Record<string, string> = {
    on: "bg-primary text-white border-primary",
    off: "bg-white text-gray-600 border-gray-300",
    pending: "bg-white text-primary border-primary",
    muted: "bg-gray-100 text-gray-400 border-gray-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

export default function EnginesPage() {
  const [desktop, setDesktop] = useState(false);
  const [engines, setEngines] = useState<EngineStatus | null>(null);
  const [codexUi, setCodexUi] = useState<CodexUiState>("unknown");
  const [showClaudeGuide, setShowClaudeGuide] = useState(false);
  // Gemini — API 키는 Rust(~/.aone/keys.json)에 저장, localStorage 금지 (부록 A1)
  // 연결 상태는 detect_engines의 geminiKeyPresent/geminiValid로 판단한다.
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [activeEngine, setActiveEngineState] = useState<EngineChoice>("claude");
  const [claudeVerifying, setClaudeVerifying] = useState(false);
  const [claudeVerifiedMs, setClaudeVerifiedMs] = useState<number | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // 초기 감지
  useEffect(() => {
    setDesktop(isTauriRuntime());
    setActiveEngineState(getActiveEngine());
    detectEngines()
      .then((status) => {
        if (!status) return;
        setEngines(status);
        setCodexUi(
          !status.codexInstalled
            ? "not_installed"
            : status.codexLoggedIn
              ? "logged_in"
              : "not_logged_in"
        );
      })
      .catch(() => setCodexUi("unknown"));
    // 사용량 스냅샷 — 파일이 없으면 카드 숨김
    fetch("/snapshots/usage.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: UsageData | null) => {
        if (data?.totals) setUsage(data);
      })
      .catch(() => {});
    return stopPolling;
  }, [stopPolling]);

  const handleConnectCodex = async () => {
    try {
      await connectCodex();
      setCodexUi("connecting");
      stopPolling();
      // 로그인을 끝내 완료하지 않아도 무한 폴링하지 않도록 상한(40회 ≈ 2분)을 둔다
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        if (attempts > 40) {
          stopPolling();
          setCodexUi("not_logged_in");
          return;
        }
        try {
          const state: CodexLoginState = await codexStatus();
          if (state === "logged_in") {
            setCodexUi("logged_in");
            stopPolling();
          } else if (state === "not_installed") {
            setCodexUi("not_installed");
            stopPolling();
          }
        } catch {
          // 폴링 실패는 무시하고 다음 주기에 재시도
        }
      }, 3000);
    } catch (e) {
      alert(userErrorMessage(e));
    }
  };

  const handleSelectEngine = (engine: EngineChoice) => {
    setActiveEngine(engine);
    setActiveEngineState(engine);
  };

  /** Claude 실질 연결 확인: 미니 프롬프트 실호출 (Keychain 인증이라 파일 감지 불가) */
  const handleVerifyClaude = async () => {
    setClaudeVerifying(true);
    setClaudeVerifiedMs(null);
    const started = performance.now();
    try {
      await runLlm("claude", 'ping — {"ok":true} JSON만 출력');
      setClaudeVerifiedMs(Math.round(performance.now() - started));
    } catch {
      setShowClaudeGuide(true);
    } finally {
      setClaudeVerifying(false);
    }
  };

  /** Gemini API 키 저장 → detect_engines 재조회로 "연결됨" 뱃지 갱신 */
  const handleSaveGeminiKey = async () => {
    const key = geminiKey.trim();
    if (!key) return;
    setGeminiSaving(true);
    try {
      await saveApiKey("gemini", key);
      const status = await detectEngines();
      if (status) setEngines(status);
      setGeminiKey("");
    } catch (e) {
      alert(userErrorMessage(e));
    } finally {
      setGeminiSaving(false);
    }
  };

  const geminiValid = engines?.geminiValid ?? false;

  // 활성 엔진으로 실제 분석한 횟수 — usage.json의 engine 필드를 활성 엔진과 매칭
  // (엔진 id "gemini" ↔ 파이프라인 "gemini-api", "claude" ↔ "claude-cli", "codex" ↔ "codex-cli")
  const engineRunCount = Array.isArray(usage?.runs)
    ? usage.runs.filter((r) => (r.engine ?? "").startsWith(activeEngine)).length
    : 0;

  const geminiBadge = () => {
    if (!desktop) return <Badge tone="off">데스크톱 전용</Badge>;
    if (!engines) return <Badge tone="off">확인 중…</Badge>;
    if (engines.geminiValid)
      return (
        <Badge tone="on">
          <Check className="h-3 w-3" aria-hidden /> 연결됨
        </Badge>
      );
    if (engines.geminiKeyPresent)
      return <Badge tone="off">키가 유효하지 않아요</Badge>;
    return <Badge tone="off">연결 안 됨</Badge>;
  };

  const codexBadge = () => {
    switch (codexUi) {
      case "not_installed":
        return <Badge tone="off">미설치</Badge>;
      case "not_logged_in":
        return <Badge tone="off">연결 안 됨</Badge>;
      case "connecting":
        return <Badge tone="pending">브라우저에서 로그인 진행 중…</Badge>;
      case "logged_in":
        return (
          <Badge tone="on">
            <Check className="h-3 w-3" aria-hidden /> 연결됨
          </Badge>
        );
      default:
        return <Badge tone="off">{desktop ? "확인 중…" : "데스크톱 전용"}</Badge>;
    }
  };

  const claudeBadge = () => {
    if (claudeVerifiedMs !== null) {
      return (
        <Badge tone="on">
          <Check className="h-3 w-3" aria-hidden /> 연결됨 (전역 인증) ·{" "}
          {(claudeVerifiedMs / 1000).toFixed(1)}s
        </Badge>
      );
    }
    if (claudeVerifying) return <Badge tone="pending">연결 확인 중…</Badge>;
    if (!engines) {
      return <Badge tone="off">{desktop ? "확인 중…" : "데스크톱 전용"}</Badge>;
    }
    if (!engines.claudeInstalled) return <Badge tone="off">미설치</Badge>;
    if (engines.claudeLoggedIn)
      return (
        <Badge tone="on">
          <Check className="h-3 w-3" aria-hidden /> 연결됨
        </Badge>
      );
    return <Badge tone="off">연결 안 됨</Badge>;
  };

  const useEngineButton = (engine: EngineChoice, selectable: boolean) =>
    activeEngine === engine ? (
      <span className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
        <Check className="h-4 w-4" aria-hidden /> 사용 중
      </span>
    ) : (
      <button
        onClick={() => handleSelectEngine(engine)}
        disabled={!selectable}
        className="glass-button press-scale mt-4 rounded-xl px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
      >
        이 엔진 사용
      </button>
    );

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-black"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> 대시보드
        </Link>
        <h1 className="mt-2 text-xl font-bold">AI 엔진 연결</h1>
        <p className="mt-1 text-sm text-gray-500">
          이미 쓰고 있는 AI 구독을 Aone에 연결하세요. 추가 비용이 들지 않습니다.
        </p>
      </div>

      {/* 웹 데모 안내 — 브라우저에서는 연결 버튼이 모두 의미 없다 */}
      {!desktop && (
        <div
          className="glass-card mb-6 rounded-2xl border border-black/[0.06] bg-black/[0.02] p-5"
          data-testid="settings-web-demo-notice"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Monitor className="h-4 w-4 text-primary" aria-hidden />
            웹 데모 — 엔진 연결은 데스크톱 앱에서 동작해요
          </p>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            AI는 내 컴퓨터에 설치된 Claude·GPT·Gemini로 동작하기 때문에 브라우저에서는
            연결할 수 없어요. 아래 카드는 데스크톱 앱(Aone.dmg)에서 어떤 화면이 뜨는지
            보여드리는 미리보기입니다. 웹 데모에서는 이미 분석된 결과를 모두 열람하실
            수 있어요.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {/* GPT (Codex) */}
        <section className="glass-card rounded-2xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold">GPT</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                ChatGPT 구독 계정으로 연결 (Codex CLI)
              </p>
            </div>
            {codexBadge()}
          </div>
          <div className="flex items-center gap-2">
            {codexUi !== "logged_in" && (
              <button
                onClick={handleConnectCodex}
                disabled={!desktop || codexUi === "not_installed" || codexUi === "connecting"}
                className="press-scale mt-4 rounded-xl bg-primary px-4 py-2 text-sm text-white transition-colors duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                연결하기
              </button>
            )}
            {useEngineButton("codex", codexUi === "logged_in")}
          </div>
          {codexUi === "not_installed" && (
            <p className="mt-2 text-xs text-gray-500">
              Codex CLI가 설치되어 있지 않습니다. <code className="rounded bg-gray-100 px-1">npm install -g @openai/codex</code>
            </p>
          )}
        </section>

        {/* Claude */}
        <section className="glass-card rounded-2xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold">Claude</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                Claude 구독 계정으로 연결 (Claude Code CLI)
              </p>
            </div>
            {claudeBadge()}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleVerifyClaude}
              disabled={!desktop || claudeVerifying}
              className="press-scale mt-4 flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm text-white transition-colors duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {claudeVerifying && <span className="spinner" aria-hidden />}
              {claudeVerifying ? "확인 중…" : "연결 확인"}
            </button>
            <button
              onClick={() => setShowClaudeGuide(true)}
              className="glass-button press-scale mt-4 rounded-xl px-4 py-2 text-sm"
            >
              터미널 가이드 보기
            </button>
            {useEngineButton("claude", true)}
          </div>
        </section>

        {/* Ollama */}
        <section className="glass-card rounded-2xl p-5 opacity-60">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-gray-500">로컬 모델</h2>
              <p className="mt-0.5 text-sm text-gray-400">
                Ollama로 완전 오프라인 실행
              </p>
            </div>
            <Badge tone="muted">지원 예정</Badge>
          </div>
        </section>

        {/* Gemini — API 키 연결 */}
        <section className="glass-card rounded-2xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold">Gemini</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                Google Gemini API 키로 연결 (AI Studio에서 발급)
              </p>
            </div>
            {geminiBadge()}
          </div>
          <div className="mt-4 flex gap-2">
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder={
                engines?.geminiKeyPresent
                  ? "키 저장됨 — 새 키로 교체하려면 입력"
                  : "AIza..."
              }
              className="flex-1 rounded-xl border border-gray-300 bg-white/70 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              aria-label="Gemini API 키"
            />
            <button
              onClick={() => void handleSaveGeminiKey()}
              disabled={!desktop || geminiSaving || geminiKey.trim() === ""}
              className="press-scale flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm text-white transition-colors duration-200 hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {geminiSaving && <span className="spinner" aria-hidden />}
              {geminiSaving ? "저장 중…" : "저장"}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {useEngineButton("gemini", geminiValid)}
          </div>
        </section>

        {/* 사용 현황 — 학생용(토큰·비용 대신 "얼마나 썼는지"만) */}
        {usage && (
          <section className="glass-card rounded-2xl p-5">
            <h2 className="font-semibold">사용 현황</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              {activeEngine === "gemini"
                ? "Gemini 무료 한도 안에서 처리돼요 — 별도 결제 없이 쓸 수 있어요"
                : "내 구독 한도 안에서 처리돼요 — 추가 비용이 들지 않아요"}
            </p>
            <div className="mt-4 flex items-center gap-4 rounded-xl bg-black/[0.03] px-4 py-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <Check className="h-5 w-5 text-primary" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {ENGINE_LABELS[activeEngine]}로 연결됨
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {engineRunCount > 0
                    ? `이 엔진으로 ${engineRunCount.toLocaleString("ko-KR")}번 분석했어요`
                    : "아직 이 엔진으로 분석한 적이 없어요"}
                </p>
              </div>
            </div>
            {activeEngine === "gemini" && (
              <p className="mt-3 text-xs leading-relaxed text-gray-400">
                한도에 도달하면 잠시 후 다시 시도해달라고 알려드려요. 더 많이
                쓰려면 Google AI Studio에서 결제를 연결할 수 있어요.
              </p>
            )}
          </section>
        )}
      </div>

      {/* Claude 터미널 가이드 모달 */}
      {showClaudeGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowClaudeGuide(false)}
        >
          <div
            className="glass-panel w-full max-w-md rounded-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold">Claude 연결 가이드</h3>
            <p className="mt-2 text-sm text-gray-600">
              터미널을 열고 아래 명령을 순서대로 실행하세요. 브라우저가 열리면
              Claude 구독 계정으로 로그인하면 됩니다.
            </p>
            <pre className="mt-4 overflow-x-auto rounded bg-gray-100 p-3 text-xs leading-relaxed">
{`claude
> /login`}
            </pre>
            <p className="mt-3 text-xs text-gray-500">
              로그인 후 &ldquo;연결 확인&rdquo; 버튼을 다시 누르면 상태가 갱신됩니다.
            </p>
            <button
              onClick={() => setShowClaudeGuide(false)}
              className="press-scale mt-4 w-full rounded-xl bg-primary px-4 py-2 text-sm text-white transition-colors duration-200 hover:bg-primary-hover"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
