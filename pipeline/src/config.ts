/**
 * 파이프라인 설정. 품질 티어(standard/deep)와 점수 가중치를
 * 코드 상수가 아닌 config 객체로 노출한다.
 */

export type Tier = "standard" | "deep";
export type EngineName = "stub" | "claude-cli" | "gemini-api" | "codex-cli";

export interface TierConfig {
  /** 개념당 근거를 주차마다 최대 몇 개까지 연결할지 */
  evidencePerConceptPerWeek: number;
  /** 예상문제 생성 대상: 시험신호 상위 N개 개념 */
  topConceptsForQuestions: number;
  /** 개념당 문항 수 */
  questionsPerConcept: number;
  /** 문항 검증 투표 수 (개별 검증 모드에서의 LLM 검증 호출 횟수, 과반 통과) */
  verifyVotes: number;
  /** 전사본 청크 크기 (타임스탬프 기준, 초) */
  chunkSeconds: number;
  /** 전사본 청크 크기 (타임스탬프 없는 평문, 문자 수) */
  chunkMaxChars: number;
  /** true: L2 개념 추출 + L3 신호 추출을 청크당 1회 통합 호출로 병합 (슬라이드도 청크에 동승) */
  unifiedExtraction: boolean;
  /** true: L4 예상문제를 1회 일괄 생성 + 1회 일괄 검증 */
  batchQuestions: boolean;
}

export const TIERS: Record<Tier, TierConfig> = {
  // standard = 최적화 밀도 (통합 추출 + 25분 청크 + 일괄 생성/검증) → 주당 호출 ≤ 8회
  standard: {
    evidencePerConceptPerWeek: 3,
    topConceptsForQuestions: 5,
    questionsPerConcept: 2,
    verifyVotes: 1,
    chunkSeconds: 1500,
    chunkMaxChars: 21000,
    unifiedExtraction: true,
    batchQuestions: true,
  },
  // deep = 기존 밀도 (계층별 개별 호출 + 10분 청크 + 문항별 생성/검증)
  deep: {
    evidencePerConceptPerWeek: 5,
    topConceptsForQuestions: 10,
    questionsPerConcept: 4,
    verifyVotes: 3,
    chunkSeconds: 600,
    chunkMaxChars: 5000,
    unifiedExtraction: false,
    batchQuestions: false,
  },
};

/** L3 점수 계산(결정적 가중 함수)의 가중치 */
export interface ScoreWeights {
  importancePerWeekSeen: number;
  importancePerEvidence: number;
  importancePerEmphasis: number;
  importancePerExamMatch: number;
  examSignalPerEmphasis: number;
  examSignalPerExamHint: number;
  /** 기출 문항과 직접 매칭된 exam_hint(source=exam) 가중치 */
  examSignalPerExamMatch: number;
}

export interface PipelineConfig {
  tier: Tier;
  tierConfig: TierConfig;
  engine: EngineName;
  goldsetDir: string;
  dbPath: string;
  outDir: string;
  /** L0 PDF 추출 캐시 디렉토리 (미지정 시 L0 단계 비활성) */
  extractedDir?: string;
  /** 주차당 stub 개념 추출 상한 */
  maxConceptsPerWeek: number;
  /** 개념·종류별 주차당 신호 저장 상한 (점수 폭주 방지) */
  maxSignalsPerConceptKindWeek: number;
  scoreWeights: ScoreWeights;
  /** 능동 제안 발동: examSignal 임계 && 이번 주 신호 발생 && 전주 대비 상승 */
  proactiveExamSignalThreshold: number;
}

export function makeConfig(partial: Partial<PipelineConfig> & { goldsetDir: string; dbPath: string; outDir: string }): PipelineConfig {
  const tier: Tier = partial.tier ?? "standard";
  return {
    engine: "stub",
    maxConceptsPerWeek: 12,
    maxSignalsPerConceptKindWeek: 5,
    // 한 학기(7주 이상) 누적을 견디는 가중치.
    // 이전 값(주차당 14점 등)은 4~5주만 지나도 대부분의 개념이 상한 100에 붙어
    // 우선순위 변별력이 사라졌다. 실측 분포(등장 주차 평균 3·최대 7, 근거 평균 8·최대 38,
    // 기출매칭 평균 6·최대 33)를 기준으로 상위 개념이 90~100, 평균 개념이 40~60에
    // 오도록 낮췄다.
    scoreWeights: {
      importancePerWeekSeen: 6,
      importancePerEvidence: 1.2,
      importancePerEmphasis: 4,
      importancePerExamMatch: 2.2,
      examSignalPerEmphasis: 7,
      examSignalPerExamHint: 12,
      examSignalPerExamMatch: 8,
    },
    // 강조(emphasis)만으로는 도달 불가한 값(강조 상한 5×7=35) →
    // 시험 언급/기출 매칭이 있어야 능동 제안이 발동한다.
    proactiveExamSignalThreshold: 55,
    ...partial,
    tier,
    tierConfig: partial.tierConfig ?? TIERS[tier],
  };
}
