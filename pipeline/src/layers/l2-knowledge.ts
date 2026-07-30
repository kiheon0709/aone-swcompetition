/**
 * L2 — 기억(지식) 계층.
 * 개념 추출 → 기존 개념과 병합(이름 유사 병합) → evidence 연결.
 */
import { AoneDb, ConceptRow, SourceType } from "../db.js";
import type { PipelineConfig } from "../config.js";
import {
  LlmEngine,
  ExtractConceptsOutput,
  ExtractConceptsPayload,
  ExtractKnowledgeOutput,
  ExtractKnowledgePayload,
  MergeAliasesOutput,
  MergeAliasesPayload,
  buildPrompt,
} from "../adapters/llm.js";
import type { SlideDoc, Utterance, UnitInputs } from "./l1-normalize.js";
import { chunkUtterances } from "./l1-normalize.js";
import { nfc, type UnitKey } from "../folders.js";
import {
  verifyEvidence,
  isVerifiable,
  emptyVerifyStats,
  type VerifyStats,
} from "./evidence-verify.js";

/** allSettled rejection 사유를 짧은 로그 문자열로 */
function describeErr(reason: unknown): string {
  const msg = reason instanceof Error ? reason.message : String(reason);
  return msg.slice(0, 160);
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_./]/g, "");
}

/** 바이그램 Dice 유사도 */
function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };
  const ma = bigrams(a);
  const mb = bigrams(b);
  let inter = 0;
  for (const [bg, n] of ma) inter += Math.min(n, mb.get(bg) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/** 괄호 보충 표기 제거한 기본 이름: "패킷 (Packet)" → "패킷" */
function baseName(name: string): string {
  return normalizeName(name.split("(")[0]);
}

/** 이름 유사 병합 판정: 정규화 동일 / 괄호 제거 기본명 동일 / 포함 관계 / Dice ≥ 0.8 */
export function isSameConcept(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  const ba = baseName(a);
  const bb = baseName(b);
  if (ba.length >= 2 && ba === bb) return true;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  return diceSimilarity(na, nb) >= 0.8;
}

export function findExistingConcept(existing: ConceptRow[], name: string): ConceptRow | undefined {
  return existing.find((c) => isSameConcept(c.name, name));
}

/** 개념 id는 subject 범위에서 유니크해야 하므로 subject를 포함한다 (기존 행의 구식 id는 그대로 유효) */
export function conceptId(subject: string, name: string): string {
  const clean = (s: string) => normalizeName(s).replace(/[^a-z0-9가-힣]/g, "");
  return `c-${clean(subject)}-${clean(name)}`;
}

export interface KnowledgeResult {
  newConcepts: number;
  mergedConcepts: number;
  evidenceAdded: number;
  conceptNames: string[];
}

const SCHEMA_HINT = `{"concepts":[{"name":"...","evidence":[{"type":"transcript|slide","locator":"12:34|theory_01 p.5","quote":"..."}]}]}`;

/**
 * locator → 원문 맵 (9단계 인용문 대조용).
 * 전사본 발화는 locator가 곧 `t`이고, 슬라이드는 "{tag} p.{n}"에 그 페이지 줄을 합친다.
 * 교정 후보를 찾을 때 **호출 청크가 아니라 그 unit 전체**를 봐야 하므로 호출자가 전체를 넘긴다.
 */
function buildSourceTexts(utterances: Utterance[], slides: SlideDoc[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const u of utterances) {
    // 같은 타임스탬프가 여러 줄로 쪼개져 오면 이어붙인다 (인용문이 줄을 넘길 수 있다)
    const key = nfc(u.t);
    const prev = m.get(key);
    m.set(key, prev ? `${prev}\n${u.text}` : u.text);
  }
  for (const doc of slides) {
    for (const p of doc.pages) {
      m.set(nfc(`${doc.tag} p.${p.page}`), p.lines.join("\n"));
    }
  }
  return m;
}

/** 실 LLM용 호출 단위: 페이로드 + 프롬프트 + 허용 locator 집합(할루시네이션 근거 차단) */
interface ExtractCall {
  payload: ExtractConceptsPayload;
  prompt: string;
  /** null이면 검증 생략(stub — 실데이터에서 직접 생성하므로) */
  allowedLocators: Set<string> | null;
}

function buildExtractCalls(cfg: PipelineConfig, inputs: UnitInputs, isStub: boolean): ExtractCall[] {
  const cap = cfg.tierConfig.evidencePerConceptPerWeek;
  if (isStub) {
    // stub: 전체 자료 1회 호출 (빈도 기반이라 전역 통계가 필요)
    return [
      {
        payload: {
          utterances: inputs.transcript,
          slides: inputs.slides,
          maxConcepts: cfg.maxConceptsPerWeek,
          evidencePerConcept: cap,
        },
        prompt: "",
        allowedLocators: null,
      },
    ];
  }

  const calls: ExtractCall[] = [];
  // 전사본: 블록 단위 청킹(티어 설정), 발화 원문 전체를 페이로드로
  for (const chunk of chunkUtterances(inputs.transcript, cfg.tierConfig.chunkSeconds, cfg.tierConfig.chunkMaxChars)) {
    calls.push({
      payload: { utterances: chunk, slides: [], maxConcepts: 6, evidencePerConcept: cap },
      prompt: buildPrompt(
        "extract_concepts",
        [
          `아래는 대학 '${inputs.key.subject}' 강의(${inputs.key.unit}) STT 전사본의 한 블록(약 10분)이다.`,
          "이 블록에서 시험공부 대상이 되는 핵심 도메인 개념(예: 프로토콜, 대역폭, 다중화, OSI 계층)을 3~6개 추출하라.",
          "수업 운영 공지·잡담·일반 단어는 개념으로 잡지 마라. 개념 이름은 간결한 한국어 명사구(영문 약어 허용).",
          `각 개념의 evidence는 최대 ${cap}개: type은 "transcript", locator는 입력 발화의 t 값을 그대로, quote는 해당 발화 문장을 그대로 복사(120자 이내로 앞부분만 잘라도 됨). 입력에 없는 발화를 지어내지 마라.`,
        ].join("\n"),
        { utterances: chunk },
        SCHEMA_HINT,
      ),
      allowedLocators: new Set(chunk.map((u) => nfc(u.t))),
    });
  }
  // 슬라이드: 문서 단위 호출
  for (const doc of inputs.slides) {
    calls.push({
      payload: { utterances: [], slides: [doc], maxConcepts: 10, evidencePerConcept: cap },
      prompt: buildPrompt(
        "extract_concepts",
        [
          `아래는 대학 '${inputs.key.subject}' 강의(${inputs.key.unit}) 슬라이드 텍스트(${doc.tag})다.`,
          "핵심 도메인 개념을 5~10개 추출하라. 행정 정보(교수 이메일, 성적 비율 등)는 제외.",
          `각 개념의 evidence는 최대 ${cap}개: type은 "slide", locator는 정확히 "${doc.tag} p.<페이지번호>" 형식(입력에 존재하는 페이지만), quote는 해당 페이지의 줄을 그대로 복사.`,
        ].join("\n"),
        { slide: { tag: doc.tag, pages: doc.pages } },
        SCHEMA_HINT,
      ),
      allowedLocators: new Set(doc.pages.map((p) => nfc(`${doc.tag} p.${p.page}`))),
    });
  }
  return calls;
}

export async function updateKnowledge(
  db: AoneDb,
  engine: LlmEngine,
  cfg: PipelineConfig,
  inputs: UnitInputs,
): Promise<KnowledgeResult> {
  const calls = buildExtractCalls(cfg, inputs, engine.name === "stub");
  const isStub = engine.name === "stub";

  let newConcepts = 0;
  let merged = 0;
  let evidenceAdded = 0;
  const existing = db.allConcepts(inputs.key.subject);
  const cap = cfg.tierConfig.evidencePerConceptPerWeek;
  // stub은 실데이터에서 직접 근거를 만들므로 대조가 의미 없다 (9단계)
  const sourceTexts = isStub ? null : buildSourceTexts(inputs.transcript, inputs.slides);
  const verifyStats = emptyVerifyStats();

  // 독립 호출(청크·슬라이드 문서별)은 병렬 실행 — DB 반영은 호출 순서대로 결정적으로.
  // allSettled: 한 호출이 실패해도 성공분은 살려서 병합한다(엔진 세마포어가 동시성 제어).
  const settled = await Promise.allSettled(
    calls.map((call, i) =>
      engine.call({
        task: "extract_concepts",
        payload: call.payload,
        schema: ExtractConceptsOutput,
        prompt: call.prompt,
        progress: { index: i, total: calls.length },
      }),
    ),
  );

  for (let ci = 0; ci < calls.length; ci++) {
    const s = settled[ci];
    if (s.status === "rejected") {
      console.warn(`  경고: 개념 추출 호출 ${ci + 1}/${calls.length} 실패 — 건너뜁니다 (${describeErr(s.reason)}).`);
      continue;
    }
    const r = applyExtractedConcepts(
      db,
      inputs.key,
      cap,
      existing,
      s.value.concepts ?? [],
      calls[ci].allowedLocators,
      sourceTexts,
      verifyStats,
    );
    newConcepts += r.newConcepts;
    merged += r.merged;
    evidenceAdded += r.evidenceAdded;
  }

  logVerifyStats(verifyStats);

  return {
    newConcepts,
    mergedConcepts: merged,
    evidenceAdded,
    conceptNames: db.allConcepts(inputs.key.subject).map((c) => c.name),
  };
}

/** 인용문 대조 결과를 한 줄로 남긴다 (9단계) */
function logVerifyStats(s: VerifyStats): void {
  if (s.checked === 0 && s.unverifiable === 0) return;
  console.log(
    `  근거 인용문 대조: ${s.checked}건 검사 — 일치 ${s.ok} · 교정 ${s.relocated} · 폐기 ${s.dropped}` +
      (s.unverifiable > 0 ? ` (미검증 ${s.unverifiable}건 — 인용문 없음)` : ""),
  );
}

// ─────────────────────────────────────────────────────────────
// L2+L3 통합 추출 (standard 티어): 청크당 1회 호출로 개념+근거+평가신호를
// 함께 추출한다. 슬라이드 문서는 전사본 청크 호출에 라운드로빈으로 동승.
// ─────────────────────────────────────────────────────────────

export interface UnifiedExtractionResult {
  knowledge: KnowledgeResult;
  signals: { emphasisAdded: number; examHintAdded: number };
  calls: number;
}

const UNIFIED_SCHEMA_HINT =
  `{"concepts":[{"name":"...","evidence":[{"type":"transcript|slide","locator":"12:34|theory_01 p.5","quote":"..."}]}],` +
  `"signals":[{"concept":"...","kind":"emphasis|exam_hint","locator":"12:34","quote":"..."}]}`;

export async function updateKnowledgeUnified(
  db: AoneDb,
  engine: LlmEngine,
  cfg: PipelineConfig,
  inputs: UnitInputs,
): Promise<UnifiedExtractionResult> {
  const tier = cfg.tierConfig;
  const cap = tier.evidencePerConceptPerWeek;
  const existing = db.allConcepts(inputs.key.subject);
  const priorNames = existing.map((c) => c.name);
  const isStub = engine.name === "stub";
  // 9단계 — 교정 후보는 청크가 아니라 unit 전체에서 찾아야 한다
  const sourceTexts = isStub ? null : buildSourceTexts(inputs.transcript, inputs.slides);
  const verifyStats = emptyVerifyStats();

  // 번들 구성: 전사본 청크(25분/문자량 단위) + 슬라이드 문서 라운드로빈 동승
  const chunks = chunkUtterances(inputs.transcript, tier.chunkSeconds, tier.chunkMaxChars).filter((c) => c.length > 0);
  const bundles: { utterances: Utterance[]; slides: SlideDoc[] }[] = chunks.map((c) => ({ utterances: c, slides: [] }));
  if (bundles.length === 0) bundles.push({ utterances: [], slides: [] });
  inputs.slides.forEach((doc, i) => bundles[i % bundles.length].slides.push(doc));

  const settled = await Promise.allSettled(
    bundles.map((b, bi) => {
      const payload: ExtractKnowledgePayload = {
        utterances: b.utterances,
        slides: b.slides,
        conceptNames: priorNames,
        maxConcepts: 6 + 4 * b.slides.length,
        evidencePerConcept: cap,
      };
      const slidePart =
        b.slides.length > 0
          ? `슬라이드 텍스트(${b.slides.map((d) => d.tag).join(", ")})도 함께 주어진다. 슬라이드 개념의 evidence는 type="slide", locator는 정확히 "<tag> p.<페이지번호>" 형식(입력에 존재하는 페이지만). `
          : "";
      return engine.call({
        task: "extract_knowledge",
        payload,
        schema: ExtractKnowledgeOutput,
        prompt: buildPrompt(
          "extract_knowledge",
          [
            `아래는 대학 '${inputs.key.subject}' 강의(${inputs.key.unit}) STT 전사본의 한 블록(약 25분)${b.slides.length > 0 ? "과 슬라이드 텍스트" : ""}다. 두 가지를 한 번에 수행하라.`,
            "",
            `[1. 개념 추출] 시험공부 대상이 되는 핵심 도메인 개념(예: 프로토콜, 대역폭, 다중화, OSI 계층)을 최대 ${payload.maxConcepts}개 추출하라.`,
            "수업 운영 공지·잡담·일반 단어·행정 정보(교수 이메일, 성적 비율 등)는 개념으로 잡지 마라. 개념 이름은 간결한 한국어 명사구(영문 약어 허용).",
            `각 개념의 evidence는 최대 ${cap}개: 전사 근거는 type="transcript", locator는 입력 발화의 t 값을 그대로, quote는 해당 발화 문장을 그대로 복사(120자 이내로 앞부분만 잘라도 됨). ` +
              slidePart +
              "입력에 없는 발화·페이지를 지어내지 마라.",
            "",
            "[2. 평가신호 추출] 전사본에서 교수가 시험 출제를 직접 암시하는 발화(kind=exam_hint: \"시험에 나온다\", \"중간고사\", 기출/족보 언급, \"문제 낼 거예요\" 등)와",
            "특별히 강조하는 발화(kind=emphasis: \"중요하다\", \"반드시\", \"꼭 기억\", 반복 강조)를 찾아라.",
            "각 신호의 concept는 [1]에서 추출한 개념 또는 기존 개념 목록(conceptNames) 중 실제로 관련된 이름을 그대로 사용하라. 관련 개념이 없으면 그 신호는 버려라.",
            "신호의 locator는 해당 발화의 t 값을 그대로, quote는 그 발화 문장을 그대로 복사(140자 이내). 해당 없으면 signals를 빈 배열로.",
          ].join("\n"),
          { utterances: b.utterances, slides: b.slides.map((d) => ({ tag: d.tag, pages: d.pages })), conceptNames: priorNames },
          UNIFIED_SCHEMA_HINT,
        ),
        progress: { index: bi, total: bundles.length },
      });
    }),
  );

  let newConcepts = 0;
  let merged = 0;
  let evidenceAdded = 0;
  let emphasisAdded = 0;
  let examHintAdded = 0;

  for (let i = 0; i < bundles.length; i++) {
    const b = bundles[i];
    const s = settled[i];
    if (s.status === "rejected") {
      console.warn(`  경고: 지식 추출 호출 ${i + 1}/${bundles.length} 실패 — 건너뜁니다 (${describeErr(s.reason)}).`);
      continue;
    }
    const out = s.value;
    const allowedEvidence = isStub
      ? null
      : new Set([
          ...b.utterances.map((u) => nfc(u.t)),
          ...b.slides.flatMap((d) => d.pages.map((p) => nfc(`${d.tag} p.${p.page}`))),
        ]);
    const r = applyExtractedConcepts(
      db,
      inputs.key,
      cap,
      existing,
      out.concepts ?? [],
      allowedEvidence,
      sourceTexts,
      verifyStats,
    );
    newConcepts += r.newConcepts;
    merged += r.merged;
    evidenceAdded += r.evidenceAdded;

    // 신호 반영 (전사본 발화만 신호 출처로 인정)
    const allowedSignal = isStub ? null : new Set(b.utterances.map((u) => nfc(u.t)));
    for (const s of out.signals ?? []) {
      const concept = existing.find((c) => isSameConcept(c.name, s.concept));
      if (!concept) continue;
      if (allowedSignal && !allowedSignal.has(nfc(s.locator))) continue; // 지어낸 locator 차단
      if (db.signalCount(concept.id, inputs.key, s.kind) >= cfg.maxSignalsPerConceptKindWeek) continue;

      // 신호도 인용문을 원문과 대조한다 (9단계).
      // 실측된 데통 3주차 1:08:12 귀속 오류가 바로 이 경로에 있었다.
      let locator = s.locator;
      if (sourceTexts) {
        if (!isVerifiable(s.quote)) {
          verifyStats.unverifiable++;
        } else {
          verifyStats.checked++;
          const v = verifyEvidence(s.locator, s.quote, sourceTexts);
          if (v.outcome === "ok") {
            verifyStats.ok++;
          } else if (v.outcome === "relocated") {
            verifyStats.relocated++;
            locator = v.locator;
            console.warn(
              `  신호 교정: "${s.quote.slice(0, 40)}…" ${s.locator} → ${v.locator}`,
            );
          } else {
            verifyStats.dropped++;
            console.warn(
              `  신호 폐기(${v.reason}): ${s.locator} "${s.quote.slice(0, 40)}…"`,
            );
            continue;
          }
        }
      }

      const added = db.addSignal({
        concept_id: concept.id,
        subject: inputs.key.subject,
        unit: inputs.key.unit,
        unit_order: inputs.key.unitOrder,
        kind: s.kind,
        source_type: "transcript",
        locator,
        quote: s.quote,
      });
      if (added) s.kind === "emphasis" ? emphasisAdded++ : examHintAdded++;
    }
  }

  logVerifyStats(verifyStats);

  return {
    knowledge: {
      newConcepts,
      mergedConcepts: merged,
      evidenceAdded,
      conceptNames: db.allConcepts(inputs.key.subject).map((c) => c.name),
    },
    signals: { emphasisAdded, examHintAdded },
    calls: bundles.length,
  };
}

/** 추출된 개념 목록을 DB에 반영 (병합·근거 연결). 통합/개별 추출 경로가 공유. */
function applyExtractedConcepts(
  db: AoneDb,
  key: UnitKey,
  cap: number,
  existing: ConceptRow[],
  concepts: { name: string; evidence: { type: string; locator: string; quote: string }[] }[],
  allowedLocators: Set<string> | null,
  /** locator → 원문. 있으면 인용문 원문 대조까지 한다 (9단계). null이면 생략(stub) */
  sourceTexts: Map<string, string> | null,
  stats: VerifyStats,
): { newConcepts: number; merged: number; evidenceAdded: number } {
  let newConcepts = 0;
  let merged = 0;
  let evidenceAdded = 0;

  for (const c of concepts) {
    // 근거 locator 실존 검증 (실 LLM의 지어낸 출처 차단)
    const existsChecked = allowedLocators
      ? (c.evidence ?? []).filter((ev) => allowedLocators.has(nfc(ev.locator)))
      : (c.evidence ?? []);

    // 인용문 원문 대조 (9단계) — 없으면 유일한 위치로 교정, 애매하면 폐기
    const validEvidence = sourceTexts
      ? existsChecked.flatMap((ev) => {
          if (!isVerifiable(ev.quote)) {
            stats.unverifiable++;
            return [ev];
          }
          stats.checked++;
          const v = verifyEvidence(ev.locator, ev.quote, sourceTexts);
          if (v.outcome === "ok") {
            stats.ok++;
            return [ev];
          }
          if (v.outcome === "relocated") {
            stats.relocated++;
            console.warn(
              `  근거 교정: "${ev.quote.slice(0, 40)}…" ${ev.locator} → ${v.locator}`,
            );
            return [{ ...ev, locator: v.locator }];
          }
          stats.dropped++;
          console.warn(
            `  근거 폐기(${v.reason}): ${ev.locator} "${ev.quote.slice(0, 40)}…"`,
          );
          return [];
        })
      : existsChecked;

    if (validEvidence.length === 0) continue; // 근거 없는 개념은 등록하지 않음

    let row = findExistingConcept(existing, c.name);
    if (row) {
      merged++;
    } else {
      row = {
        id: conceptId(key.subject, c.name),
        subject: key.subject,
        name: c.name,
        norm: normalizeName(c.name),
        first_unit: key.unit,
        first_unit_order: key.unitOrder,
      };
      // id/norm 충돌 방지(이론상): 이미 존재하면 병합 처리
      if (existing.some((e) => e.id === row!.id || e.norm === row!.norm)) {
        row = existing.find((e) => e.id === conceptId(key.subject, c.name) || e.norm === normalizeName(c.name))!;
        merged++;
      } else {
        db.insertConcept(row);
        existing.push(row);
        newConcepts++;
      }
    }
    for (const ev of validEvidence) {
      if (db.evidenceCountForUnit(row.id, key) >= cap) break;
      const added = db.addEvidence({
        concept_id: row.id,
        subject: key.subject,
        unit: key.unit,
        unit_order: key.unitOrder,
        source_type: ev.type as SourceType,
        locator: ev.locator,
        quote: ev.quote,
      });
      if (added) evidenceAdded++;
    }
  }
  return { newConcepts, merged, evidenceAdded };
}

/** 개념 별칭 병합 결과 */
export interface MergeAliasesResult {
  /** 흡수되어 사라진 개념 수 */
  merged: number;
  /** 사람이 읽을 병합 로그 ("레이스 컨디션 → 경쟁 상태(Race Condition)") */
  log: string[];
}

/**
 * 표기만 다른 동일 개념을 LLM 판단으로 병합한다.
 *
 * isSameConcept은 문자열 유사도 기반이라 "레이스 컨디션" ↔ "경쟁 상태(Race Condition)",
 * "독자-작성자 문제" ↔ "Readers-Writers 문제"처럼 한/영 표기 체계가 다른 쌍을 잡지 못한다.
 * 이 경우 같은 개념이 여러 행으로 흩어져 등장 unit 수가 낮게 집계되고,
 * importance(= w1·등장unit수 + …)가 실제보다 과소평가된다.
 *
 * 병합은 먼저 등록된 개념(first_unit_order가 빠른 쪽)을 남기고 나머지를 흡수시킨다.
 * evidence/signals는 남는 개념으로 이관하고, 파생 테이블(scores·questions)은 재계산 대상이라 삭제한다.
 */
export async function mergeConceptAliases(
  db: AoneDb,
  engine: LlmEngine,
  subject: string,
): Promise<MergeAliasesResult> {
  const result: MergeAliasesResult = { merged: 0, log: [] };
  const concepts = db.allConcepts(subject);
  if (concepts.length < 2) return result;

  const out = await engine.call({
    task: "merge_concept_aliases",
    payload: { conceptNames: concepts.map((c) => c.name) } satisfies MergeAliasesPayload,
    schema: MergeAliasesOutput,
    prompt: buildPrompt(
      "merge_concept_aliases",
      `아래는 대학 '${subject}' 강의에서 추출된 개념 이름 목록이다. ` +
        "표기만 다르고 실제로는 같은 개념인 것들을 묶어라. " +
        "예: 한글/영어 표기 차이, 약어와 full name, 괄호 보충 유무. " +
        "canonical에는 가장 명확하고 대표적인 이름을, aliases에는 그 개념으로 흡수될 나머지 이름을 넣어라. " +
        "반드시 목록에 있는 이름을 그대로 사용하라. " +
        "주의: 상위-하위 관계이거나 서로 구별해서 배우는 별개 개념은 묶지 마라 " +
        "(예: '세마포어'와 '바이너리 세마포어'는 구별되는 개념이므로 묶지 않는다). " +
        "확신이 없으면 묶지 않는 쪽을 택하라. 묶을 것이 없으면 groups를 빈 배열로 반환하라.",
      { concepts: concepts.map((c) => c.name) },
      `{"groups":[{"canonical":"...","aliases":["..."]}]}`,
    ),
  });

  const byName = new Map(concepts.map((c) => [normalizeName(c.name), c]));
  const removed = new Set<string>();

  for (const group of out.groups ?? []) {
    const canonical = byName.get(normalizeName(group.canonical));
    if (!canonical || removed.has(canonical.id)) continue;

    for (const alias of group.aliases ?? []) {
      const drop = byName.get(normalizeName(alias));
      // 자기 자신·이미 병합된 것·목록에 없는 이름은 건너뛴다 (LLM이 지어낸 이름 방어)
      if (!drop || drop.id === canonical.id || removed.has(drop.id)) continue;

      db.raw.prepare("UPDATE OR IGNORE evidence SET concept_id = ? WHERE concept_id = ?").run(canonical.id, drop.id);
      db.raw.prepare("DELETE FROM evidence WHERE concept_id = ?").run(drop.id);
      db.raw.prepare("UPDATE OR IGNORE signals SET concept_id = ? WHERE concept_id = ?").run(canonical.id, drop.id);
      db.raw.prepare("DELETE FROM signals WHERE concept_id = ?").run(drop.id);
      db.raw.prepare("DELETE FROM concept_scores WHERE concept_id = ?").run(drop.id);
      db.raw.prepare("DELETE FROM predicted_questions WHERE concept_id = ?").run(drop.id);
      db.raw.prepare("DELETE FROM concepts WHERE id = ?").run(drop.id);

      removed.add(drop.id);
      result.merged++;
      result.log.push(`${drop.name} → ${canonical.name}`);
    }
  }
  return result;
}
