/**
 * 근거 인용문 원문 대조 (9단계).
 *
 * 배경 — LLM이 붙인 근거(locator + quote)를 지금까지 아무도 검사하지 않았다.
 * locator가 입력에 존재하는지는 확인했지만(`allowedLocators`), **그 locator의 발화 안에
 * 인용문이 실제로 있는지**는 보지 않았다. 그래서 인용문은 진짜인데 locator만 옆 블록을
 * 가리키는 귀속 오류가 통과했다 (실측 예: 데통 3주차 `1:08:12` — 인용문은 `1:06:54` 블록에 있다).
 *
 * 학습 도구에서 근거가 틀리면 기능 결함이 아니라 신뢰 문제다. 그래서 코드가 걸러낸다.
 *
 * 규칙:
 *   1. quote가 locator의 원문에 **정확히 포함**되면 그대로 채택한다.
 *   2 없으면 전체 원문에서 quote를 정확히 포함하는 곳을 찾는다.
 *      - 딱 하나면 그 locator로 **교정**한다.
 *      - 여러 개거나 하나도 없으면 **폐기**한다.
 *   3. 유사도로 "비슷한 블록"을 찾아 붙이지 않는다. **정확 일치만** 인정한다.
 */
import { nfc } from "../folders.js";

/** 검사 판정 */
export type VerifyOutcome = "ok" | "relocated" | "dropped";

export interface VerifyResult {
  outcome: VerifyOutcome;
  /** relocated면 교정된 locator, 그 외엔 입력 그대로 */
  locator: string;
  /** dropped 이유 — 로그용 */
  reason?: "no-match" | "ambiguous" | "unknown-locator";
}

export interface VerifyStats {
  checked: number;
  ok: number;
  relocated: number;
  dropped: number;
  /** 대조 불가(인용문이 비어 있음) — 검증 대상에서 제외한 건수 */
  unverifiable: number;
}

export const emptyVerifyStats = (): VerifyStats => ({
  checked: 0,
  ok: 0,
  relocated: 0,
  dropped: 0,
  unverifiable: 0,
});

/**
 * 인용문 비교용 정규화.
 * 공백만 접는다 — LLM이 줄바꿈·중복 공백을 흘리는 경우가 있어서다.
 * 글자를 지우거나 바꾸지 않으므로 "정확 일치"의 성질은 유지된다.
 */
const norm = (s: string): string => nfc(s).replace(/\s+/g, " ").trim();

/** 인용문이 대조 가능한 최소 길이 — 너무 짧으면 우연히 여러 곳에 걸린다 */
const MIN_QUOTE = 4;

/**
 * quote가 locator의 원문에 있는지 확인하고, 없으면 원문 전체에서 유일한 위치를 찾는다.
 *
 * @param sources locator → 원문. 전사본 발화·슬라이드 페이지를 한 맵에 담는다.
 */
export function verifyEvidence(
  locator: string,
  quote: string,
  sources: Map<string, string>,
): VerifyResult {
  const q = norm(quote);
  // 인용문이 없거나 너무 짧으면 대조 자체가 불가능하다 — 판정을 내리지 않고 통과시킨다.
  // (호출자가 unverifiable로 센다)
  if (q.length < MIN_QUOTE) return { outcome: "ok", locator };

  const own = sources.get(nfc(locator));
  if (own !== undefined && norm(own).includes(q)) {
    return { outcome: "ok", locator };
  }

  // locator가 틀렸다(또는 존재하지 않는다). 원문 전체에서 정확히 포함하는 곳을 모은다.
  // locator가 없는 경우에도 인용문이 유일하게 실존하면 교정하는 편이 낫다 —
  // 인용문 자체는 검증된 사실이고, 버리면 근거를 잃는다.
  const hits: string[] = [];
  for (const [loc, text] of sources) {
    if (norm(text).includes(q)) hits.push(loc);
  }
  if (hits.length === 1) {
    return { outcome: "relocated", locator: hits[0] };
  }
  if (hits.length > 1) {
    return { outcome: "dropped", locator, reason: "ambiguous" };
  }
  // 원문 어디에도 없다. locator까지 가짜였는지 구분해 로그에 남긴다.
  return {
    outcome: "dropped",
    locator,
    reason: own === undefined ? "unknown-locator" : "no-match",
  };
}

/** 인용문이 대조 가능한가 (빈 인용·너무 짧은 인용은 미검증으로 분류) */
export const isVerifiable = (quote: string): boolean =>
  norm(quote).length >= MIN_QUOTE;
