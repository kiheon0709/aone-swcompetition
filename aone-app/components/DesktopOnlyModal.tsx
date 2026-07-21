"use client";

/**
 * 웹 데모 안내 모달 — 데스크톱(Tauri) 전용 기능을 브라우저에서 눌렀을 때 뜬다.
 *
 * 브라우저에서는 lib/engines·lib/fs-bridge의 커맨드가 throw하거나 no-op이라
 * 그대로 두면 raw 에러 토스트/무반응이 되어 "고장난 앱"으로 보인다.
 * 호출부에서 `if (!desktop) return showDesktopOnly("업로드")` 로 먼저 가로채고,
 * 기존 throw는 데스크톱 로직 보호용으로 그대로 남겨둔다.
 */
import { Monitor, X } from "lucide-react";

/** 안내 모달을 여는 함수 — 인자는 기능 이름("업로드"·"폴더 만들기" 등) */
export type ShowDesktopOnly = (feature: string) => void;

interface Props {
  /** 열려 있으면 기능 이름, 닫혀 있으면 null */
  feature: string | null;
  onClose: () => void;
}

export default function DesktopOnlyModal({ feature, onClose }: Props) {
  if (!feature) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      data-testid="desktop-only-modal"
    >
      <div
        className="glass-panel relative w-full max-w-md rounded-2xl p-6 text-center"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${feature} — 데스크톱 앱 기능`}
      >
        <button
          onClick={onClose}
          aria-label="닫기"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors duration-200 hover:bg-black/[0.05] hover:text-gray-700"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Monitor className="h-6 w-6 text-primary" aria-hidden />
        </span>

        <h3 className="text-lg font-bold tracking-tight text-gray-900">
          {feature} — 데스크톱 앱에서 동작해요
        </h3>

        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          웹 데모에서는 이미 분석된 결과를 모두 열람하실 수 있어요. 자료 업로드와
          AI 분석은 내 컴퓨터의 AI(Claude·GPT·Gemini)로 동작하기 때문에 데스크톱
          앱(Aone.dmg)에서 사용하실 수 있습니다.
        </p>

        <button
          onClick={onClose}
          className="press-scale mt-5 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors duration-200 hover:bg-primary-hover"
        >
          둘러보기 계속하기
        </button>
      </div>
    </div>
  );
}

/** 상단·사이드바에 다는 담백한 "웹 데모" 배지 — 데스크톱에서는 렌더하지 않는다 */
export function WebDemoBadge({ className = "" }: { className?: string }) {
  return (
    <span
      data-testid="web-demo-badge"
      className={`inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.03] px-3 py-1.5 text-[11px] font-semibold text-gray-500 ${className}`}
    >
      <Monitor className="h-3.5 w-3.5 text-gray-400" aria-hidden />
      웹 데모 · 분석 결과 열람용
    </span>
  );
}
