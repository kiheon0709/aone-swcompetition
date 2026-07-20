/**
 * 신호 중요도 = 상/중/하 색상 시스템 (공용 · 부록 A안 §1).
 *
 * examSignal(1~100, 코드 계산값)은 사용자에게 숫자로 노출하지 않는다.
 * high(빨강 "시험 강조") / mid(amber "주목") / low(회색 "참고")로만 표시한다.
 */

export type SignalLevel = "high" | "mid" | "low";

/** examSignal 숫자 → 상/중/하 레벨 (>=70 high, >=40 mid, else low) */
export const signalLevel = (examSignal: number): SignalLevel =>
  examSignal >= 70 ? "high" : examSignal >= 40 ? "mid" : "low";

export interface SignalMeta {
  level: SignalLevel;
  /** 배지 라벨 */
  label: string;
  /** 배지(칩) 색상 클래스 — 배경·글자 */
  badgeClass: string;
  /** 점(dot) 색상 클래스 — 목차 썸네일·요약 패널 오버레이용 */
  dotClass: string;
  /** 이모지 아이콘 */
  icon: string;
}

const META: Record<SignalLevel, SignalMeta> = {
  high: {
    level: "high",
    label: "시험 강조",
    badgeClass: "bg-red-500/15 text-red-700",
    dotClass: "bg-red-500",
    icon: "🔴",
  },
  mid: {
    level: "mid",
    label: "주목",
    badgeClass: "bg-amber-500/15 text-amber-700",
    dotClass: "bg-amber-400",
    icon: "🟡",
  },
  low: {
    level: "low",
    label: "참고",
    badgeClass: "bg-black/[0.06] text-gray-500",
    dotClass: "bg-gray-300",
    icon: "⚪",
  },
};

/** examSignal 숫자 → 표시 메타(라벨·색상·아이콘) */
export const signalMeta = (examSignal: number): SignalMeta =>
  META[signalLevel(examSignal)];

/** 레벨 → 표시 메타 (레벨을 이미 아는 경우) */
export const signalMetaOf = (level: SignalLevel): SignalMeta => META[level];
