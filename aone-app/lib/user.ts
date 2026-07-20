/**
 * 사용자 프로필 — localStorage 기반 단일 소스 (헤더 프로필·홈 인사말·온보딩이 공유).
 * 저장된 값이 없으면 기본값("사용자")을 쓴다. SSR(window 없음)에서도 안전.
 */
const NAME_KEY = "aone.profile.name.v1";
const ORG_KEY = "aone.profile.org.v1";

const DEFAULT_NAME = "사용자";
const DEFAULT_ORG = "";

const read = (key: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    return v && v.trim() ? v : fallback;
  } catch {
    return fallback;
  }
};

/** 사용자 이름 — 없으면 "사용자" */
export const getUserName = (): string => read(NAME_KEY, DEFAULT_NAME);

/** 소속(대학 등) — 없으면 빈 문자열 */
export const getUserOrg = (): string => read(ORG_KEY, DEFAULT_ORG);

/** 프로필 저장 — 온보딩에서 입력받아 호출. 빈 값은 저장하지 않는다. */
export const saveUserProfile = (name: string, org?: string): void => {
  if (typeof window === "undefined") return;
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
    if (org != null && org.trim()) localStorage.setItem(ORG_KEY, org.trim());
  } catch {
    // localStorage 사용 불가 시 세션 한정 — 무시
  }
};
