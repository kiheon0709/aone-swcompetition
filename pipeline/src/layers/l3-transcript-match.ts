/**
 * L3 — 슬라이드 ↔ 전사본 발화 매칭 (LLM 미사용).
 *
 * "이 장표에서 교수님이 뭐라고 했지"에 답하기 위한 연결이다.
 * 전사본은 주차 폴더에 파일 하나로 들어오고 그 주차 자료는 여러 개일 수 있는데,
 * 파일을 자료별로 쪼개 배정하지 않는다 — 오배정 시 전사본이 통째로 엉뚱한 곳에 붙기 때문이다.
 * 대신 슬라이드 단위로 "관련 있어 보이는 발화"를 가리키기만 한다. 틀려도 학생이 읽으면 바로 알고,
 * 다른 기능(점수·문제 생성)에 전파되지 않는다.
 *
 * 앱에 STT가 없어 전사본 형식을 통제할 수 없다(클로바노트·Whisper·손필기 노트 등).
 * 그래서 타임스탬프·헤더는 있으면 쓰고 없으면 무시하는 보조 신호로만 다룬다.
 */

/** 전사본에서 잘라낸 발화 한 덩어리 */
export interface Utterance {
  /** 0부터 */
  index: number;
  /** "14:32" 같은 표기. 없으면 null */
  timestamp: string | null;
  text: string;
}

export interface SlideKeywords {
  /** slides.json의 slide_id */
  slideId: string;
  page: number;
  /** 개념명 등 변별력 높은 키워드 */
  strong: string[];
  /** 제목·핵심포인트에서 뽑은 일반 키워드 */
  weak: string[];
}

export interface MatchResult {
  slideId: string;
  page: number;
  /** 구간의 대표 발화 (임계 미만이면 null) */
  utterance: Utterance | null;
  /** 대표 발화를 중심으로 이어지는 연속 구간 (없으면 빈 배열) */
  utterances: Utterance[];
  score: number;
  /** 어떤 키워드가 맞아 이 점수가 나왔는지 — 화면·검증에서 근거로 쓴다 */
  hits: string[];
  /** 매칭을 아예 시도하지 않은 경우의 사유 (전사 분량 부족 등) */
  skipReason?: string;
}

/** 타임스탬프 표기 — "참석자 1 00:00", "화자 1 00:19", 맨앞 "12:34" 등 */
const TS_LINE = /(?:^|\n)\s*(?:참석자|화자|speaker)?\s*\d*\s*(\d{1,2}:\d{2}(?::\d{2})?)/gi;

/**
 * 전사본을 발화 블록으로 자른다.
 * 타임스탬프가 있으면 그 경계로, 없으면 빈 줄로, 그것도 없으면 길이로 자른다.
 */
export function splitUtterances(raw: string, targetChars = 700): Utterance[] {
  const text = raw.replace(/^﻿/, "").trim();
  if (!text) return [];

  // 1) 타임스탬프 경계
  const marks: { pos: number; ts: string }[] = [];
  for (const m of text.matchAll(TS_LINE)) {
    marks.push({ pos: m.index ?? 0, ts: m[1] });
  }
  if (marks.length >= 3) {
    const out: Utterance[] = [];
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].pos;
      const end = i + 1 < marks.length ? marks[i + 1].pos : text.length;
      const body = text.slice(start, end).replace(TS_LINE, " ").trim();
      if (body.length > 0) out.push({ index: out.length, timestamp: marks[i].ts, text: body });
    }
    return out;
  }

  // 2) 빈 줄 경계.
  // 문단이 targetChars보다 훨씬 길면(STT 결과를 이어 붙인 경우 등) 문단 하나가 통째로
  // 블록이 되어 매칭이 무의미해진다. 그런 문단은 아래 길이 분할로 다시 쪼갠다.
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length >= 3 && paras.every((p) => p.length <= targetChars * 3)) {
    const out: Utterance[] = [];
    let buf = "";
    for (const p of paras) {
      buf = buf ? `${buf}\n${p}` : p;
      if (buf.length >= targetChars) {
        out.push({ index: out.length, timestamp: null, text: buf });
        buf = "";
      }
    }
    if (buf) out.push({ index: out.length, timestamp: null, text: buf });
    return out;
  }

  // 3) 길이로 자른다.
  // STT 결과에는 문장부호도 줄바꿈도 없이 한 덩어리로 오는 경우가 흔하다
  // (실측: 15,872자에 줄바꿈 0개·마침표 0개). 그래서 문장 경계를 기대할 수 없고,
  // 종결어미("~합니다", "~습니다")나 공백을 경계로 삼는다.
  const out: Utterance[] = [];
  let cur = 0;
  while (cur < text.length) {
    let end = Math.min(cur + targetChars, text.length);
    if (end < text.length) {
      const window = text.slice(cur, Math.min(cur + targetChars * 1.3, text.length));
      // 종결어미 우선 — 문장이 끊기는 자연스러운 지점이다
      let cut = -1;
      for (const m of window.matchAll(/(?:습니다|합니다|입니다|됩니다|하죠|이죠|해요|에요)\s/g)) {
        const pos = (m.index ?? 0) + m[0].length;
        if (pos > targetChars * 0.5) {
          cut = pos;
          if (pos >= targetChars) break;
        }
      }
      if (cut < 0) {
        const sp = text.lastIndexOf(" ", end);
        cut = sp > cur + targetChars * 0.5 ? sp - cur + 1 : end - cur;
      }
      end = cur + cut;
    }
    const body = text.slice(cur, end).trim();
    if (body) out.push({ index: out.length, timestamp: null, text: body });
    cur = end;
  }
  return out;
}

/**
 * 매칭에서 제외할 흔한 말.
 * 강의 발화에는 "여러", "동시에", "경우" 같은 말이 어디든 나와서, 이런 단어가 섞이면
 * 내용과 무관한 발화가 높은 점수를 받는다. 변별력 없는 토큰은 아예 키워드로 안 쓴다.
 */
const NOISE = new Set([
  "여러", "사람이", "동시에", "경우", "때문", "정도", "부분", "내용", "설명", "사용",
  "이런", "그런", "저런", "어떤", "무슨", "다음", "이번", "먼저", "다시", "만약",
  "진행", "발생", "가능", "필요", "중요", "위해", "통해", "대한", "대해", "관련",
  "하는", "있는", "없는", "되는", "같은", "받는", "주는", "보는", "쓰는",
  "슬라이드", "페이지", "장표", "그림", "예시", "예제", "문제", "방법", "방식",
  "기다려", "이해", "확인", "표시", "구성", "포함", "제공", "지원", "처리",
]);

/**
 * 개념명 하나에서 매칭에 쓸 표기들을 뽑는다.
 *
 * DB 개념명은 "세마포어(Semaphore)"처럼 한글·영어를 같이 담는데, 실제 강의 발화와 슬라이드는
 * 둘 중 하나만 쓴다. 괄호 앞만 쓰면 영어로 말하는 수업에서 전부 놓치고, 그 반대도 마찬가지다.
 * (실측: 운영체제 슬라이드 33장 중 21장이 이 이유로 키워드 0개가 됐다)
 */
function keywordVariants(name: string): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    const t = v.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
    if (t.length >= 2) out.push(t);
  };
  push(name.replace(/\([^)]*\)/g, " ")); // 괄호 밖: "세마포어"
  for (const m of name.matchAll(/\(([^)]*)\)/g)) push(m[1]); // 괄호 안: "Semaphore"
  return [...new Set(out)];
}

/**
 * 영어 용어의 한글 음차 표기.
 *
 * STT 도구마다 영어를 다르게 처리한다 — 같은 강의를 전사한 두 파일에서
 * "Critical Section"이 한쪽은 70회, 다른 쪽은 "크리티컬" 63회로 나왔다.
 * 슬라이드는 영어를 쓰므로, 음차만 나오는 전사본에서는 매칭이 전부 실패한다.
 * 자주 쓰이는 전공 용어만 최소한으로 담는다 (자동 음차 변환은 오탐이 크다).
 */
const TRANSLITERATION: Record<string, string[]> = {
  semaphore: ["세마포어", "세마포"],
  critical: ["크리티컬"],
  section: ["섹션"],
  mutual: ["뮤추얼"],
  exclusion: ["익스클루전", "익스클루션"],
  deadlock: ["데드락", "데드록"],
  process: ["프로세스"],
  thread: ["스레드", "쓰레드"],
  interrupt: ["인터럽트"],
  atomic: ["아토믹", "어토믹"],
  buffer: ["버퍼"],
  queue: ["큐"],
  lock: ["락"],
  monitor: ["모니터"],
  scheduling: ["스케줄링"],
  context: ["컨텍스트", "콘텍스트"],
  switch: ["스위치"],
  starvation: ["스타베이션"],
  banker: ["뱅커"],
};

/** 키워드에 대응하는 음차 표기들 (영어 단어 단위로 찾는다) */
function transliterationsOf(keyword: string): string[] {
  const out: string[] = [];
  for (const w of keyword.toLowerCase().split(/\s+/)) {
    const t = TRANSLITERATION[w];
    if (t) out.push(...t);
  }
  return out;
}

/** 조사·어미가 붙어도 매칭되도록 핵심 토큰만 남긴다 */
function normalizeKeyword(k: string): string {
  return k.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
}

/**
 * 키워드가 텍스트에 몇 번 등장하는지.
 * 한국어는 조사가 붙으므로 부분 문자열 포함으로 센다("대역폭을" 안의 "대역폭").
 */
function countOccurrences(text: string, keyword: string): number {
  if (keyword.length < 2) return 0;
  let n = 0;
  let from = 0;
  for (;;) {
    const i = text.indexOf(keyword, from);
    if (i < 0) break;
    n++;
    from = i + keyword.length;
  }
  return n;
}

/**
 * 개념명은 변별력이 높아 가중치를 크게 준다.
 * 임계 1.1은 1차 실측 분포(0.05~2.4)에서 잡았다. 2.0으로 올렸더니 1차에서 100% 적중했던
 * 케이스까지 전부 걸러져(0건) 과교정이었다 — 재사용 페널티가 이미 점수를 깎기 때문이다.
 */
const STRONG_WEIGHT = 3;
const WEAK_WEIGHT = 1;

/**
 * 슬라이드당 전사 글자 수가 이보다 적으면 매칭을 시도하지 않는다.
 * 1차 실험에서 슬라이드당 53자였던 자료는 적중률 0%였다 — 근거가 없는데 억지로 붙이면
 * 잡담이 배정된다. "못 찾았다"고 말하는 편이 정직하다.
 */
const MIN_CHARS_PER_SLIDE = 120;

/** 한 발화가 이미 배정될 때마다 다음 슬라이드에게는 이 비율만큼 점수가 깎인다 */
const REUSE_PENALTY = 0.75;

/** 한 슬라이드에 붙일 연속 발화의 최대 개수 */
const MAX_SPAN = 4;

/** 발화 하나의 점수를 계산한다 (strong 히트가 없으면 0 — 잡담 배제) */
function scoreUtterance(
  u: Utterance,
  strong: string[],
  weak: string[],
): { score: number; hits: string[]; hasStrong: boolean } {
  let score = 0;
  const hits: string[] = [];
  let strongHits = 0;

  for (const k of strong) {
    // 원표기로 못 찾으면 음차 표기로도 찾는다 (STT마다 영어 처리가 다르다)
    let n = countOccurrences(u.text, k);
    let label = k;
    if (n === 0) {
      for (const tr of transliterationsOf(k)) {
        const m = countOccurrences(u.text, tr);
        if (m > n) {
          n = m;
          label = tr;
        }
      }
    }
    if (n > 0) {
      score += STRONG_WEIGHT * (1 + Math.log2(n)) * Math.min(k.length, 8) / 4;
      hits.push(label);
      strongHits++;
    }
  }
  for (const k of weak) {
    const n = countOccurrences(u.text, k);
    if (n > 0) {
      score += WEAK_WEIGHT * (1 + Math.log2(n)) * Math.min(k.length, 8) / 4;
      hits.push(k);
    }
  }

  // 개념이 하나도 없는 발화는 매칭 후보에서 제외한다.
  // 1차 실험에서 잡담("금융 공공 관련… 공항 케이블")이 일반 단어만으로 4장을 독점했다.
  if (strongHits === 0) return { score: 0, hits: [], hasStrong: false };

  const density = score / Math.max(1, Math.log2(u.text.length));
  return { score: density, hits: [...new Set(hits)], hasStrong: true };
}

/**
 * 슬라이드마다 관련 발화 구간을 고른다.
 *
 * 1차와 달라진 점:
 *  - 확실한 것만 붙이고 나머지는 비운다 (전문 보기가 있으므로 낮은 커버리지는 결함이 아니다)
 *  - 최고점 발화 하나가 아니라 앞뒤로 이어지는 연속 구간을 잡는다
 *  - 개념어가 없는 발화는 후보에서 제외한다
 *  - 이미 쓰인 발화는 점수를 깎아 독점을 막는다
 */
export function matchSlidesToUtterances(
  slides: SlideKeywords[],
  utterances: Utterance[],
  minScore = 1.1,
): MatchResult[] {
  // 전사가 너무 얇으면 시도하지 않는다
  const totalChars = utterances.reduce((n, u) => n + u.text.length, 0);
  if (slides.length > 0 && totalChars / slides.length < MIN_CHARS_PER_SLIDE) {
    return slides.map((s) => ({
      slideId: s.slideId,
      page: s.page,
      utterance: null,
      utterances: [],
      score: 0,
      hits: [],
      skipReason: "전사 분량이 부족해 매칭하지 않음",
    }));
  }

  const usable = (k: string) => k.length >= 2 && !NOISE.has(k);
  /** 발화 index → 이미 배정된 횟수 */
  const used = new Map<number, number>();

  // 점수가 높은 슬라이드부터 배정해야 페널티가 의미를 갖는다.
  const scored = slides.map((s) => {
    const strong = s.strong.flatMap(keywordVariants).filter(usable);
    const weak = s.weak.map(normalizeKeyword).filter((k) => usable(k) && k.length >= 3);
    const per = utterances.map((u) => scoreUtterance(u, strong, weak));
    const best = per.reduce((m, r, i) => (r.score > per[m].score ? i : m), 0);
    return { slide: s, strong, weak, per, peak: per[best]?.score ?? 0 };
  });
  scored.sort((a, b) => b.peak - a.peak);

  const byId = new Map<string, MatchResult>();
  for (const { slide, per } of scored) {
    // 재사용 페널티를 반영해 최고점 발화를 고른다
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < per.length; i++) {
      if (!per[i].hasStrong) continue;
      const penalty = REUSE_PENALTY ** (used.get(i) ?? 0);
      const adj = per[i].score * penalty;
      if (adj > bestScore) {
        bestScore = adj;
        bestIdx = i;
      }
    }

    if (bestIdx < 0 || bestScore < minScore) {
      byId.set(slide.slideId, {
        slideId: slide.slideId,
        page: slide.page,
        utterance: null,
        utterances: [],
        score: Number(bestScore.toFixed(2)),
        hits: [],
      });
      continue;
    }

    // 최고점을 중심으로 앞뒤 연속 확장 — 점수가 절반 이상 유지되는 동안만.
    // 떨어진 발화를 모으지 않는 이유는 "이 구간에서 이 얘기를 했다"는 연속성이 깨지기 때문이다.
    const floor = per[bestIdx].score * 0.5;
    let lo = bestIdx;
    let hi = bestIdx;
    while (hi - lo + 1 < MAX_SPAN) {
      const prev = lo - 1 >= 0 && per[lo - 1].hasStrong ? per[lo - 1].score : -1;
      const next = hi + 1 < per.length && per[hi + 1].hasStrong ? per[hi + 1].score : -1;
      if (prev < floor && next < floor) break;
      if (next >= prev) hi++;
      else lo--;
    }

    const span = utterances.slice(lo, hi + 1);
    for (let i = lo; i <= hi; i++) used.set(i, (used.get(i) ?? 0) + 1);

    byId.set(slide.slideId, {
      slideId: slide.slideId,
      page: slide.page,
      utterance: utterances[bestIdx],
      utterances: span,
      score: Number(bestScore.toFixed(2)),
      hits: per[bestIdx].hits,
    });
  }

  // 입력 순서를 복원해서 반환한다
  return slides.map((s) => byId.get(s.slideId)!);
}

// ─────────────────────────────────────────────────────────────
// 순서 정렬 매칭 (6차 실험 이후의 기본 방식)
//
// 강의는 슬라이드를 순서대로 넘기며 진행되고 전사본은 시간 순이다.
// 그러므로 이것은 검색이 아니라 두 순차열의 정렬 문제다. 위의
// matchSlidesToUtterances(독립 검색)는 매칭 순서가 19→12→11→30→…처럼
// 뒤죽박죽이 되는 구조적 결함이 있었다 — 실험 기록 32절 참조.
// ─────────────────────────────────────────────────────────────

/**
 * 개념명이 "파일 연산과 시스템 콜" 같은 복합 구문이면 발화에 그대로 등장하지 않는다
 * (교수는 "파일 연산"·"시스템 콜"로 끊어 말한다). 전체 구문이 안 맞으면
 * 구성 토큰으로도 찾되 가중치를 낮춘다. 실험에서 File_Management 자료가
 * 이 문제로 점수 0.17에 그쳤다.
 */
function strongKeywordScore(text: string, keyword: string): { score: number; label: string | null } {
  const n = countOccurrences(text, keyword);
  if (n > 0) return { score: STRONG_WEIGHT * (1 + Math.log2(n)) * Math.min(keyword.length, 8) / 4, label: keyword };
  for (const tr of transliterationsOf(keyword)) {
    const m = countOccurrences(text, tr);
    if (m > 0) return { score: STRONG_WEIGHT * (1 + Math.log2(m)) * Math.min(tr.length, 8) / 4, label: tr };
  }
  // 토큰 분해 폴백 — 조사·접속어를 떼고 2자 이상 토큰만
  const tokens = keyword.split(/[\s과와의·,]+/).filter((t) => t.length >= 2 && !NOISE.has(t));
  if (tokens.length >= 2) {
    let hit = 0;
    for (const t of tokens) if (countOccurrences(text, t) > 0) hit++;
    if (hit >= 2) {
      // 토큰 절반 이상 등장 시에만, 전체 구문의 절반 가중치
      return hit / tokens.length >= 0.5
        ? { score: (STRONG_WEIGHT / 2) * hit, label: tokens.slice(0, 2).join("+") }
        : { score: 0, label: null };
    }
  }
  return { score: 0, label: null };
}

/** 발화 하나에 대한 슬라이드 키워드 점수 (정렬용 — 개념 없으면 0으로 잡담 배제) */
function alignPairScore(
  u: Utterance,
  strong: string[],
  weak: string[],
): { score: number; hits: string[] } {
  let score = 0;
  const hits: string[] = [];
  let strongHits = 0;
  for (const k of strong) {
    const r = strongKeywordScore(u.text, k);
    if (r.score > 0) {
      score += r.score;
      if (r.label) hits.push(r.label);
      strongHits++;
    }
  }
  for (const k of weak) {
    const n = countOccurrences(u.text, k);
    if (n > 0) {
      score += WEAK_WEIGHT * (1 + Math.log2(n)) * Math.min(k.length, 8) / 4;
      hits.push(k);
    }
  }
  if (strongHits === 0) return { score: 0, hits: [] };
  return { score: score / Math.max(1, Math.log2(u.text.length)), hits: [...new Set(hits)] };
}

export interface AlignResult {
  /** 슬라이드별 결과 (입력 순서 유지) */
  results: MatchResult[];
  /**
   * 자료 전체 정렬 점수 (경로 총점 / 슬라이드 수).
   * 전사본이 이 자료의 수업 녹음이면 높고, 다른 수업(예: 실습) 자료면 0 근처다.
   * 실측: 맞는 자료 1.2~6.8 vs 틀린 자료 0.0~0.2 — 자료 판별에 그대로 쓴다.
   */
  docScore: number;
}

/**
 * 한 자료(doc)의 슬라이드들과 전사본을 단조 정렬한다.
 *
 * 발화를 시간 순으로 훑으며 슬라이드 포인터는 앞으로만 이동한다.
 * 각 발화는 현재 슬라이드에 배정되거나(점수 임계 이상), 건너뛰어지거나(잡담),
 * 포인터를 전진시킨다. DP로 전역 최적 배정을 찾는다.
 *
 * 순서 제약이 오배정을 막아 주므로 임계는 독립 검색(1.1)보다 낮은 0.5가 기본이다.
 * docScore가 minDocScore 미만이면 자료 전체를 거부한다 — 전사본이 이 자료의
 * 수업이 아니라는 뜻이다(예: 이론 수업 녹음 vs 실습 자료).
 */
export function alignSlidesToUtterances(
  slides: SlideKeywords[],
  utterances: Utterance[],
  opts: { minScore?: number; minDocScore?: number } = {},
): AlignResult {
  const tau = opts.minScore ?? 0.5;
  const minDoc = opts.minDocScore ?? 0.3;
  const empty = (s: SlideKeywords, reason?: string): MatchResult => ({
    slideId: s.slideId,
    page: s.page,
    utterance: null,
    utterances: [],
    score: 0,
    hits: [],
    ...(reason ? { skipReason: reason } : {}),
  });

  // 전사 분량 게이트 (독립 검색과 동일 원칙)
  const totalChars = utterances.reduce((n, u) => n + u.text.length, 0);
  if (slides.length === 0 || utterances.length === 0 ||
      totalChars / slides.length < MIN_CHARS_PER_SLIDE) {
    return { results: slides.map((s) => empty(s, "전사 분량이 부족해 매칭하지 않음")), docScore: 0 };
  }

  const usable = (k: string) => k.length >= 2 && !NOISE.has(k);
  const sorted = [...slides].sort((a, b) => a.page - b.page);
  const M = sorted.length;
  const N = utterances.length;

  const keys = sorted.map((s) => ({
    strong: s.strong.map(normalizeKeyword).filter(usable),
    weak: s.weak.map(normalizeKeyword).filter((k) => usable(k) && k.length >= 3),
  }));
  const pair: { score: number; hits: string[] }[][] = keys.map((k) =>
    utterances.map((u) => alignPairScore(u, k.strong, k.weak)),
  );

  // DP — dp[i][j]: 포인터가 슬라이드 i, 발화 0..j-1 처리 완료일 때 최대 점수
  const NEG = -1e15;
  const dp: Float64Array[] = Array.from({ length: M }, () => new Float64Array(N + 1));
  const choice: Int8Array[] = Array.from({ length: M }, () => new Int8Array(N + 1)); // 0 skip-utt, 1 assign, 2 advance
  for (let j = 1; j <= N; j++) {
    for (let i = 0; i < M; i++) {
      const skip = dp[i][j - 1];
      const sc = pair[i][j - 1].score;
      const assign = sc >= tau ? dp[i][j - 1] + sc : NEG;
      const adv = i > 0 ? dp[i - 1][j] : NEG;
      if (assign >= skip && assign >= adv) { dp[i][j] = assign; choice[i][j] = 1; }
      else if (skip >= adv) { dp[i][j] = skip; choice[i][j] = 0; }
      else { dp[i][j] = adv; choice[i][j] = 2; }
    }
  }
  let endI = 0;
  for (let i = 1; i < M; i++) if (dp[i][N] > dp[endI][N]) endI = i;
  const total = dp[endI][N];
  const docScore = total / M;
  if (docScore < minDoc) {
    return { results: slides.map((s) => empty(s)), docScore: Number(docScore.toFixed(2)) };
  }

  // 경로 복원
  const assigned: number[][] = Array.from({ length: M }, () => []);
  let i = endI;
  let j = N;
  while (j > 0) {
    const c = choice[i][j];
    if (c === 2) { i--; continue; }
    if (c === 1) assigned[i].push(j - 1);
    j--;
  }
  for (const a of assigned) a.reverse();

  const byId = new Map<string, MatchResult>();
  sorted.forEach((s, idx) => {
    const utts = assigned[idx];
    if (utts.length === 0) { byId.set(s.slideId, empty(s)); return; }
    let best = utts[0];
    for (const u of utts) if (pair[idx][u].score > pair[idx][best].score) best = u;
    byId.set(s.slideId, {
      slideId: s.slideId,
      page: s.page,
      utterance: utterances[best],
      utterances: utts.map((u) => utterances[u]),
      score: Number(pair[idx][best].score.toFixed(2)),
      hits: pair[idx][best].hits,
    });
  });
  return { results: slides.map((s) => byId.get(s.slideId)!), docScore: Number(docScore.toFixed(2)) };
}
