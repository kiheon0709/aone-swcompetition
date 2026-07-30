/**
 * 오케스트레이터 — 프레임워크 없는 쌩 코드 상태머신.
 * 이벤트(unit 자료 투입)가 들어오면 태스크 DAG를 구성해 순서대로 실행한다.
 *
 *   지각(Perceive, L1) → 기억(Remember, L2) → 추론(Reason, L3) → 행동(Act, L4)
 *
 * 모든 행동은 activity_log에 기록된다.
 */
import fs from "node:fs";
import path from "node:path";
import { AoneDb } from "./db.js";
import type { PipelineConfig } from "./config.js";
import { LlmEngine } from "./adapters/llm.js";
import { extractUnitPdfs } from "./layers/l0-extract.js";
import { loadUnitInputs, UnitInputs } from "./layers/l1-normalize.js";
import { updateKnowledge, updateKnowledgeUnified } from "./layers/l2-knowledge.js";
import { extractSignals, ingestPastExams, computeScores } from "./layers/l3-signals.js";
import { linkPrerequisites } from "./layers/l3-prereqs.js";
import { generateQuestions, composeNote, decideProactive } from "./layers/l4-artifacts.js";
import { folderKeyOf, type UnitKey } from "./folders.js";

export interface UnitEvent {
  kind: "unit_ingest";
  key: UnitKey;
}

export interface TaskCtx {
  db: AoneDb;
  engine: LlmEngine;
  cfg: PipelineConfig;
  key: UnitKey;
  /** 태스크 간 전달 상태 */
  inputs?: UnitInputs;
  /** 태스크가 완료 로그에 실을 요약 (runDag가 읽어 출력) */
  detail?: string;
}

export interface Task {
  id: string;
  layer: "L0" | "L1" | "L2" | "L3" | "L4";
  deps: string[];
  /** 콘솔 시작 줄에 표시할 한국어 작업명 */
  title: string;
  run: (ctx: TaskCtx) => Promise<void>;
}

/** DAG 실행 결과 — 부분 실패를 호출부가 구분할 수 있게 (R7) */
export interface DagResult {
  done: Set<string>;
  /** 태스크 id → 실패 메시지 */
  failed: Map<string, string>;
  /** 선행 실패로 실행하지 못한 태스크 id */
  skipped: Set<string>;
}

/** unit 투입 이벤트에 대한 태스크 DAG 정의 */
function buildDag(cfg: PipelineConfig, hasExamUpload: boolean): Task[] {
  const unified = cfg.tierConfig.unifiedExtraction;
  const tasks: Task[] = [];

  if (cfg.extractedDir) {
    tasks.push({
      // ── 추출: unit 폴더의 PDF → 텍스트 캐시 (.extracted/{subject}/{unit})
      id: "L0.extract",
      layer: "L0",
      deps: [],
      title: "PDF 텍스트 추출",
      run: async (ctx) => {
        const r = await extractUnitPdfs(ctx.cfg.goldsetDir, ctx.key, ctx.cfg.extractedDir!);
        ctx.db.log(
          ctx.key,
          "L0",
          `PDF 텍스트 추출 — 신규 ${r.extracted.length}건, 캐시 스킵 ${r.skipped.length}건` +
            (r.extracted.length > 0 ? ` (${r.extracted.join(", ")})` : ""),
        );
        ctx.detail = `신규 추출 ${r.extracted.length}건, 캐시 재사용 ${r.skipped.length}건`;
      },
    });
  }

  tasks.push(
    {
      // ── 지각: 원자료를 구조화된 관찰로 정규화
      id: "L1.normalize",
      layer: "L1",
      deps: cfg.extractedDir ? ["L0.extract"] : [],
      title: "자료 정규화",
      run: async (ctx) => {
        ctx.inputs = loadUnitInputs(ctx.cfg.goldsetDir, ctx.key, ctx.cfg.extractedDir);
        const slidePages = ctx.inputs.slides.reduce((n, s) => n + s.pages.length, 0);
        ctx.db.log(
          ctx.key,
          "L1",
          `${ctx.key.unit} 자료 정규화 — 전사 발화 ${ctx.inputs.transcript.length}건, 슬라이드 ${ctx.inputs.slides.length}종 ${slidePages}페이지` +
            (ctx.inputs.pastExams.length > 0 ? `, 기출 문항 ${ctx.inputs.pastExams.length}건` : ""),
        );
        ctx.detail =
          `전사 발화 ${ctx.inputs.transcript.length}건, 슬라이드 ${ctx.inputs.slides.length}종 ${slidePages}페이지` +
          (ctx.inputs.pastExams.length > 0 ? `, 기출 ${ctx.inputs.pastExams.length}건` : "");
      },
    },
  );

  if (unified) {
    // ── 기억+추론(1) 통합: 청크당 1회 호출로 개념+근거+평가신호 추출 (호출 밀도 최적화)
    tasks.push({
      id: "L2L3.extract",
      layer: "L2",
      deps: ["L1.normalize"],
      title: "개념+평가신호 통합 추출",
      run: async (ctx) => {
        const r = await updateKnowledgeUnified(ctx.db, ctx.engine, ctx.cfg, ctx.inputs!);
        ctx.db.log(
          ctx.key,
          "L2",
          `개념+신호 통합 추출(호출 ${r.calls}회) — 신규 개념 ${r.knowledge.newConcepts}개, 기존 병합 ${r.knowledge.mergedConcepts}개, ` +
            `근거 ${r.knowledge.evidenceAdded}건 연결 (누적 개념 ${r.knowledge.conceptNames.length}개), ` +
            `강조 ${r.signals.emphasisAdded}건, 시험 언급 ${r.signals.examHintAdded}건`,
        );
        ctx.detail =
          `개념 ${r.knowledge.newConcepts + r.knowledge.mergedConcepts}개(신규 ${r.knowledge.newConcepts}·병합 ${r.knowledge.mergedConcepts}), ` +
          `근거 ${r.knowledge.evidenceAdded}건, 평가신호 ${r.signals.emphasisAdded + r.signals.examHintAdded}건`;
      },
    });
  } else {
    tasks.push(
      {
        // ── 기억: 개념 추출·병합, 근거 연결
        id: "L2.knowledge",
        layer: "L2",
        deps: ["L1.normalize"],
        title: "개념 추출",
        run: async (ctx) => {
          const r = await updateKnowledge(ctx.db, ctx.engine, ctx.cfg, ctx.inputs!);
          ctx.db.log(
            ctx.key,
            "L2",
            `개념 갱신 — 신규 ${r.newConcepts}개, 기존 병합 ${r.mergedConcepts}개, 근거 ${r.evidenceAdded}건 연결 (누적 개념 ${r.conceptNames.length}개)`,
          );
          ctx.detail = `개념 ${r.newConcepts + r.mergedConcepts}개(신규 ${r.newConcepts}·병합 ${r.mergedConcepts}), 근거 ${r.evidenceAdded}건`;
        },
      },
      {
        // ── 추론(1): 평가신호 추출 (emphasis / exam_hint)
        id: "L3.signals",
        layer: "L3",
        deps: ["L2.knowledge"],
        title: "평가신호 추출",
        run: async (ctx) => {
          const r = await extractSignals(ctx.db, ctx.engine, ctx.cfg, ctx.inputs!);
          ctx.db.log(ctx.key, "L3", `평가신호 추출 — 강조 ${r.emphasisAdded}건, 시험 언급 ${r.examHintAdded}건`);
          ctx.detail = `강조 ${r.emphasisAdded}건, 시험 언급 ${r.examHintAdded}건`;
        },
      },
    );
  }

  const extractDone = unified ? "L2L3.extract" : "L3.signals";

  if (hasExamUpload) {
    tasks.push({
      // ── 추론(2): 기출 투입 이벤트 처리 (조건부 태스크)
      id: "L3.examIngest",
      layer: "L3",
      deps: [extractDone],
      title: "기출 문항 매칭",
      run: async (ctx) => {
        const r = await ingestPastExams(ctx.db, ctx.engine, ctx.cfg, ctx.inputs!);
        ctx.db.log(
          ctx.key,
          "L3",
          `기출 투입 처리 — 문항 ${r.itemsStored}건 저장, 개념 매칭 ${r.matches}건 (${r.matchedConceptIds.size}개 개념 시험신호 상승)`,
        );
        ctx.detail = `기출 ${r.itemsStored}건 저장, 개념 매칭 ${r.matches}건 → ${r.matchedConceptIds.size}개 개념 시험신호 상승`;
      },
    });
  }

  tasks.push(
    {
      // ── 추론(3): 결정적 가중 함수로 importance/examSignal 산출
      id: "L3.scores",
      layer: "L3",
      deps: hasExamUpload ? ["L3.examIngest"] : [extractDone],
      title: "중요도·시험신호 점수 산출",
      run: async (ctx) => {
        const r = computeScores(ctx.db, ctx.cfg, ctx.key);
        ctx.db.log(ctx.key, "L3", `unit 점수 산출 — 개념 ${r.scored}개 importance/examSignal 갱신 (결정적 가중 함수)`);
        ctx.detail = `개념 ${r.scored}개 점수 갱신 (결정적 가중 함수)`;
      },
    },
    {
      // ── 추론(4): 개념 간 선수관계 갱신 (공부 순서의 근거)
      // 중요도는 "무엇이 나오나"에 답하지만 "뭐부터 하나"에는 답하지 못한다.
      // curriculum·exam_pair는 SQL로 전체 재계산(LLM 0회), 논리적 의존만 이번 주차에 대해 1회 판정한다.
      id: "L3.prereqs",
      layer: "L3",
      deps: ["L3.scores"],
      title: "개념 선수관계 갱신",
      run: async (ctx) => {
        const r = await linkPrerequisites(ctx.db, ctx.engine, ctx.key.subject, ctx.key.unitOrder);
        ctx.db.log(
          ctx.key,
          "L3",
          `선수관계 갱신 — 커리큘럼 ${r.curriculum}건, 기출 동시출현 ${r.examPair}건, 논리적 의존 ${r.llm}건`,
        );
        ctx.detail = `선수관계 ${r.curriculum + r.examPair + r.llm}건 (커리큘럼 ${r.curriculum} · 기출쌍 ${r.examPair} · 논리 ${r.llm})`;
      },
    },
    {
      // ── 행동(1): 예상문제 생성 + 검증
      id: "L4.questions",
      layer: "L4",
      deps: ["L3.prereqs"],
      title: "예상문제 생성 → 근거 검증",
      run: async (ctx) => {
        const r = await generateQuestions(ctx.db, ctx.engine, ctx.cfg, ctx.key);
        ctx.db.log(
          ctx.key,
          "L4",
          `예상문제 생성 — ${r.generated}문항 생성, 검증 통과 ${r.verified}건, 반려 ${r.rejected}건 (tier=${ctx.cfg.tier})`,
        );
        ctx.detail = `예상문제 ${r.generated}개 생성 → 근거 검증 → ${r.verified}개 통과, ${r.rejected}개 반려`;
      },
    },
    {
      // ── 행동(2): 통합 학습노트 조립 ("지금까지 배운 것", LLM 호출 1회)
      id: "L4.note",
      layer: "L4",
      deps: ["L3.scores"],
      title: "학습노트 조립",
      run: async (ctx) => {
        const r = await composeNote(ctx.db, ctx.engine, ctx.cfg, ctx.key);
        if (r.failed?.inherited) {
          // LLM은 실패했지만 직전 노트를 승계했다 — 화면이 "낡은 노트"로 구분해야 한다 (R7)
          ctx.db.log(
            ctx.key,
            "L4",
            `통합 학습노트 실패 — 직전 노트 승계 (${r.markdownChars}자). 사유: ${r.failed.reason}`,
          );
          ctx.detail = `노트 생성 실패 → 직전 노트 승계 (${r.markdownChars}자)`;
        } else if (r.skipped) {
          ctx.db.log(
            ctx.key,
            "L4",
            `통합 학습노트 — 이번 unit 델타 없음, 직전 노트 승계 (LLM 호출 스킵, ${r.markdownChars}자)`,
          );
          ctx.detail = `델타 없음 → 직전 노트 승계 (${r.markdownChars}자, 호출 0)`;
        } else {
          ctx.db.log(
            ctx.key,
            "L4",
            `통합 학습노트 증분 조립 — 반영 개념 ${r.concepts}개, 마크다운 ${r.markdownChars}자 (${ctx.key.unit}까지 누적)`,
          );
          ctx.detail = `개념 ${r.concepts}개 증분 반영으로 학습노트 ${r.markdownChars}자`;
        }
      },
    },
    {
      // ── 행동(3): 능동 제안 판단
      id: "L4.proactive",
      layer: "L4",
      deps: ["L4.questions"],
      title: "능동 제안 판단",
      run: async (ctx) => {
        const r = decideProactive(ctx.db, ctx.cfg, ctx.key);
        if (r.suggestions.length > 0) {
          ctx.db.log(
            ctx.key,
            "L4",
            `능동 제안 ${r.suggestions.length}건 발동 — ${r.suggestions.map((s) => s.conceptName).join(", ")}`,
          );
          ctx.detail = `능동 제안 ${r.suggestions.length}건 발동 — ${r.suggestions.map((s) => s.conceptName).join(", ")}`;
        } else {
          ctx.db.log(ctx.key, "L4", "능동 제안 조건 미충족 (임계·상승 조건 미달)");
          ctx.detail = "능동 제안 조건 미충족 (임계·상승 조건 미달)";
        }
      },
    },
  );
  return tasks;
}

/** 초 단위 경과시간 (소수 1자리) — 콘솔 로그 표기용 */
function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}초`;
}

/** 엔진 표시명 — 콘솔 로그용 (예: claude-cli → "Claude(claude-cli)") */
function engineLabel(name: string): string {
  const brand: Record<string, string> = {
    "claude-cli": "Claude",
    "codex-cli": "GPT",
    "gemini-api": "Gemini",
  };
  return brand[name] ? `${brand[name]}(${name})` : name;
}

/**
 * DAG 실행기: 의존성 충족 순서대로 태스크를 실행하는 단순 상태머신.
 * 각 태스크의 시작/완료를 `[LN]` 접두사로 콘솔에 출력한다 (앱 에이전트 콘솔이 파싱).
 */
// export는 테스트용 — 실패 주입으로 DAG 격리를 검증한다 (R7)
export async function runDag(tasks: Task[], ctx: TaskCtx): Promise<DagResult> {
  const done = new Set<string>();
  /** 실패한 태스크 — 이것에 의존하는 태스크는 건너뛴다 */
  const failed = new Map<string, string>();
  /** 선행 실패로 실행하지 못한 태스크 */
  const skipped = new Set<string>();
  const pending = [...tasks];

  while (pending.length > 0) {
    // 실행 가능 = 모든 선행이 성공. 선행이 실패·스킵된 태스크는 스킵으로 옮긴다.
    // 스킵이 또 다른 스킵을 낳으므로(C→B→A) 더 이상 안 늘 때까지 반복한다.
    for (;;) {
      const blocked = pending.filter((t) =>
        t.deps.some((d) => failed.has(d) || skipped.has(d)),
      );
      if (blocked.length === 0) break;
      for (const t of blocked) {
        skipped.add(t.id);
        pending.splice(pending.indexOf(t), 1);
        console.warn(`[${t.layer}] 건너뜀 — ${t.title} (선행 태스크 실패)`);
      }
    }

    const ready = pending.filter((t) => t.deps.every((d) => done.has(d)));
    if (ready.length === 0) {
      if (pending.length === 0) break;
      throw new Error(`DAG 교착: 남은 태스크 ${pending.map((t) => t.id).join(", ")}`);
    }

    for (const task of ready) {
      const t0 = Date.now();
      const callsBefore = ctx.engine.usage?.calls ?? 0;
      ctx.detail = undefined;
      console.log(`[${task.layer}] ${task.title} — ${engineLabel(ctx.engine.name)} 호출 중…`);

      // 태스크 하나가 실패해도 DAG 전체를 죽이지 않는다 (R7).
      // 예전에는 여기 try/catch가 없어서 L4.note 실패가 L4.proactive까지 삼키고,
      // 호출부의 `run && export`가 export를 아예 실행하지 않아 L2·L3 산출물이
      // 화면에 도달하지 못했다.
      try {
        await task.run(ctx);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failed.set(task.id, msg);
        pending.splice(pending.indexOf(task), 1);
        console.error(
          `[${task.layer}] 실패 — ${task.title}: ${msg} (다른 태스크는 계속 진행)`,
        );
        continue;
      }

      const calls = (ctx.engine.usage?.calls ?? 0) - callsBefore;
      const suffix = `(호출 ${calls}회, ${secs(Date.now() - t0)})`;
      console.log(`[${task.layer}] 완료 — ${ctx.detail ?? task.title} ${suffix}`);
      done.add(task.id);
      pending.splice(pending.indexOf(task), 1);
    }
  }

  return { done, failed, skipped };
}

/** 이벤트 처리 진입점: unit 자료 투입 → DAG 실행 */
export async function handleUnitEvent(
  db: AoneDb,
  engine: LlmEngine,
  cfg: PipelineConfig,
  event: UnitEvent,
): Promise<void> {
  const key = event.key;
  const t0 = Date.now();
  const callsBefore = engine.usage?.calls ?? 0;
  db.log(key, "orchestrator", `이벤트 수신: ${folderKeyOf(key)} 자료 투입 (engine=${engine.name}, tier=${cfg.tier})`);

  const hasExamUpload = unitHasPastExams(cfg.goldsetDir, key);
  const dag = buildDag(cfg, hasExamUpload);
  db.log(key, "orchestrator", `태스크 DAG 구성 — ${dag.map((t) => t.id).join(" → ")}`);

  const materials = countUnitMaterials(cfg.goldsetDir, key);
  const layerPlan = [...new Set(dag.map((t) => t.layer))].join("→");
  console.log(
    `[오케스트레이터] ${folderKeyOf(key)} 자료 ${materials}개 감지 — 태스크 ${dag.length}개 계획 (${layerPlan})`,
  );

  const result = await runDag(dag, { db, engine, cfg, key });

  const c = db.countsForUnit(key);
  // 부분 실패를 화면이 구분할 수 있게 로그에 남긴다 (R7).
  // 예: "노트만 없음" — 개념·문항은 살아 있는데 L4.note만 실패한 경우.
  const failedIds = [...result.failed.keys()];
  const partial =
    failedIds.length > 0
      ? ` · 실패 태스크 ${failedIds.join(", ")}` +
        (result.skipped.size > 0 ? ` · 건너뜀 ${[...result.skipped].join(", ")}` : "")
      : "";
  db.log(
    key,
    "orchestrator",
    `${key.unit} 처리 ${failedIds.length > 0 ? "부분 완료" : "완료"} — 누적 개념 ${c.concepts}개, 이번 unit 신호 ${c.signals}건, 검증 통과 문항 ${c.questions}건${partial}`,
  );
  for (const [id, msg] of result.failed) {
    db.log(key, "orchestrator", `태스크 실패 — ${id}: ${msg}`);
  }

  const calls = (engine.usage?.calls ?? 0) - callsBefore;
  console.log(
    `[완료] ${secs(Date.now() - t0)} · LLM 호출 ${calls}회 · 엔진 ${engine.name} · ` +
      `개념 ${c.concepts}개 · 검증 통과 문항 ${c.questions}개`,
  );
}

/**
 * 이 unit 분석에 쓸 기출이 있는지 — 과목의 족보 폴더(과목 단위 자료)와
 * 수업 폴더 직속(구 구조) 둘 다 확인한다. l1-normalize의 로딩 경로와 일치해야 한다.
 */
function unitHasPastExams(goldsetDir: string, key: UnitKey): boolean {
  const subjectDir = path.join(goldsetDir, key.subject);
  const candidates = [
    ...["족보", "기출", "exam", "exams"].map((n) => path.join(subjectDir, n, "past_exams.json")),
    path.join(subjectDir, key.unit, "past_exams.json"),
  ];
  return candidates.some((p) => fs.existsSync(p));
}

/** unit 폴더의 자료 파일 수 (숨김 파일 제외) — 오케스트레이터 계획 로그용 */
function countUnitMaterials(goldsetDir: string, key: UnitKey): number {
  const dir = path.join(goldsetDir, key.subject, key.unit);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => !f.startsWith(".")).length;
}
