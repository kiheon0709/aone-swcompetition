/**
 * L3 — 개념 간 선수관계.
 *
 * 중요도 점수는 "무엇이 시험에 나오나"에 답하지만, 만점 개념이 여러 개면
 * 학생은 "그래서 뭐부터?"에 답을 얻지 못한다. 이 레이어는 개념 사이의
 * 의존 관계를 만들어 공부 순서를 계산 가능한 형태로 남긴다.
 *
 * 판정 근거는 셋이고, 앞의 둘은 LLM 없이 DB만으로 계산한다.
 *   curriculum — 먼저 배운 개념이 선수. 커리큘럼 자체가 순서를 담고 있다.
 *   exam_pair  — 같은 기출 문항에 함께 매칭된 개념. 선후가 아니라 "묶어서 볼 짝".
 *   llm        — 같은 주차에 처음 등장해 curriculum으로 선후를 못 가리는 경우만.
 */
import { AoneDb, ConceptRow } from "../db.js";
import {
  LlmEngine,
  LinkPrerequisitesOutput,
  LinkPrerequisitesPayload,
  buildPrompt,
} from "../adapters/llm.js";
import { normalizeName } from "./l2-knowledge.js";

export interface PrereqResult {
  curriculum: number;
  examPair: number;
  llm: number;
}

/** 한 개념이 가질 수 있는 최대 선수 개념 수 — 그래프가 과밀해지면 순서 제안이 무의미해진다 */
const MAX_PREREQS_PER_CONCEPT = 4;
/** exam_pair로 인정할 최소 동시출현 횟수 — 1회 우연 동시출현은 노이즈다 */
const MIN_EXAM_PAIR_COUNT = 2;

/**
 * 선수관계를 계산해 concept_prereqs에 저장한다.
 *
 * 매 주차 분석마다 호출되므로 비용이 문제가 된다. 그래서 셋을 다르게 다룬다.
 *  - curriculum·exam_pair: 순수 SQL(LLM 0회)이라 매번 전체 재계산해도 공짜다.
 *    개념 병합·점수 변동이 바로 반영되도록 지우고 다시 만든다.
 *  - llm: 이미 판정한 주차의 답은 바뀌지 않으므로 다시 묻지 않는다.
 *    onlyUnitOrder가 주어지면 그 주차 그룹만, 없으면 아직 판정 안 된 주차만 처리한다.
 *
 * 결과적으로 한 주차 분석당 LLM 호출은 최대 1회, 새 개념이 없으면 0회다.
 */
export async function linkPrerequisites(
  db: AoneDb,
  engine: LlmEngine,
  subject: string,
  onlyUnitOrder?: number,
): Promise<PrereqResult> {
  const result: PrereqResult = { curriculum: 0, examPair: 0, llm: 0 };
  const concepts = db.allConcepts(subject);
  if (concepts.length < 2) return result;

  // llm 판정은 보존한다 — 재계산 대상은 SQL로 만드는 둘뿐이다.
  db.raw
    .prepare("DELETE FROM concept_prereqs WHERE subject = ? AND origin IN ('curriculum','exam_pair')")
    .run(subject);
  const insert = db.raw.prepare(
    "INSERT OR IGNORE INTO concept_prereqs (concept_id, prerequisite_id, subject, origin, weight) VALUES (?, ?, ?, ?, ?)",
  );

  // ── 1) curriculum: 직전 주차 개념 중 중요도 상위를 선수로 삼는다.
  // 모든 이전 개념을 잇는 건 의미가 없으므로(그래프 과밀), 바로 앞 주차의 핵심만 연결한다.
  const byUnit = new Map<number, ConceptRow[]>();
  for (const c of concepts) {
    const list = byUnit.get(c.first_unit_order) ?? [];
    list.push(c);
    byUnit.set(c.first_unit_order, list);
  }
  const orders = [...byUnit.keys()].sort((a, b) => a - b);

  /** 개념의 대표 중요도 = 마지막 주차 점수 (없으면 0) */
  const importanceOf = new Map<string, number>();
  for (const row of db.raw
    .prepare(
      // 개념의 대표 중요도 = 가장 최근 주차의 점수 (MAX(unit_order) 행의 importance)
      "SELECT concept_id, importance FROM concept_scores WHERE subject = ? GROUP BY concept_id HAVING unit_order = MAX(unit_order)",
    )
    .all(subject) as { concept_id: string; importance: number }[]) {
    importanceOf.set(row.concept_id, row.importance);
  }
  const byImportance = (a: ConceptRow, b: ConceptRow) =>
    (importanceOf.get(b.id) ?? 0) - (importanceOf.get(a.id) ?? 0);

  // 시간순만으로 잇지 않는다 — 그러면 "모스 부호의 선수는 도커" 같은 무의미한 연결이 생긴다.
  // 같은 자료 구간(locator)에 함께 등장한 적이 있는 쌍만 실제로 관련이 있다고 본다.
  const related = new Set<string>();
  for (const row of db.raw
    .prepare(
      `SELECT a.concept_id x, b.concept_id y
       FROM evidence a
       JOIN evidence b ON a.locator = b.locator AND a.unit = b.unit AND a.concept_id <> b.concept_id
       WHERE a.subject = ? AND b.subject = ?
       GROUP BY x, y`,
    )
    .all(subject, subject) as { x: string; y: string }[]) {
    related.add(`${row.x}|${row.y}`);
  }

  for (let i = 1; i < orders.length; i++) {
    // 직전 주차만이 아니라 이전 전체에서 찾는다 — 관련성으로 거르므로 과밀해지지 않는다.
    const earlier = orders.slice(0, i).flatMap((o) => byUnit.get(o) ?? []);
    for (const c of byUnit.get(orders[i]) ?? []) {
      const prereqs = earlier
        .filter((p) => related.has(`${c.id}|${p.id}`) || related.has(`${p.id}|${c.id}`))
        .sort(byImportance)
        .slice(0, MAX_PREREQS_PER_CONCEPT);
      for (const p of prereqs) {
        insert.run(c.id, p.id, subject, "curriculum", 1);
        result.curriculum++;
      }
    }
  }

  // ── 2) exam_pair: 같은 기출 문항(locator)에 함께 매칭된 개념 쌍.
  // 선후 관계가 아니라 "함께 물어보는 짝"이므로 양방향으로 넣는다.
  const pairs = db.raw
    .prepare(
      `SELECT a.concept_id x, b.concept_id y, COUNT(DISTINCT a.locator) n
       FROM signals a
       JOIN signals b ON a.locator = b.locator AND a.unit = b.unit AND a.concept_id < b.concept_id
       WHERE a.subject = ? AND a.kind = 'exam_hint' AND b.kind = 'exam_hint' AND b.subject = ?
       GROUP BY x, y HAVING n >= ?`,
    )
    .all(subject, subject, MIN_EXAM_PAIR_COUNT) as { x: string; y: string; n: number }[];
  for (const p of pairs) {
    insert.run(p.x, p.y, subject, "exam_pair", p.n);
    insert.run(p.y, p.x, subject, "exam_pair", p.n);
    result.examPair += 2;
  }

  // ── 3) llm: 같은 주차에 처음 등장한 개념들 사이의 논리적 의존.
  // 주차가 다르면 curriculum이 이미 답을 주므로 여기서는 다루지 않는다.
  //
  // 이미 판정이 끝난 주차는 건너뛴다 — 그 주차의 개념 구성은 더 바뀌지 않으므로
  // 다시 물어도 같은 답이 나온다. 이것이 매 주차 호출해도 비용이 선형에 그치는 이유다.
  const judged = new Set(
    (
      db.raw
        .prepare(
          `SELECT DISTINCT c.first_unit_order o
           FROM concept_prereqs p JOIN concepts c ON c.id = p.concept_id
           WHERE p.subject = ? AND p.origin = 'llm'`,
        )
        .all(subject) as { o: number }[]
    ).map((r) => r.o),
  );

  const targets = onlyUnitOrder !== undefined ? [onlyUnitOrder] : orders.filter((o) => !judged.has(o));

  for (const order of targets) {
    const group = byUnit.get(order) ?? [];
    if (group.length < 2) continue;
    // 재판정하는 주차라면 기존 llm 링크를 걷어내고 다시 넣는다
    if (onlyUnitOrder !== undefined) {
      const ids = group.map((c) => c.id);
      db.raw
        .prepare(
          `DELETE FROM concept_prereqs WHERE subject = ? AND origin = 'llm'
           AND concept_id IN (${ids.map(() => "?").join(",")})`,
        )
        .run(subject, ...ids);
    }
    const names = group.map((c) => c.name);
    const unit = group[0].first_unit;

    const out = await engine.call({
      task: "link_prerequisites",
      payload: { conceptNames: names, unit } satisfies LinkPrerequisitesPayload,
      schema: LinkPrerequisitesOutput,
      prompt: buildPrompt(
        "link_prerequisites",
        `아래는 대학 '${subject}' ${unit}에 함께 등장한 개념들이다. ` +
          "이 중에서 'A를 이해하려면 B를 먼저 알아야 한다'는 관계만 골라라. " +
          "concept에는 나중에 배울 개념(A), prerequisite에는 먼저 알아야 할 개념(B)을 넣어라. " +
          "단순히 관련이 있다거나 같은 주제라는 이유로는 연결하지 마라 — 정말로 선행 이해가 필요한 경우만이다. " +
          "반드시 목록에 있는 이름을 그대로 사용하고, 순환(A→B, B→A)이 생기지 않게 하라. " +
          "해당하는 관계가 없으면 links를 빈 배열로 반환하라.",
        { concepts: names },
        `{"links":[{"concept":"...","prerequisite":"..."}]}`,
      ),
    });

    const byName = new Map(group.map((c) => [normalizeName(c.name), c]));
    for (const link of out.links ?? []) {
      const c = byName.get(normalizeName(link.concept));
      const p = byName.get(normalizeName(link.prerequisite));
      // 지어낸 이름·자기참조는 버린다
      if (!c || !p || c.id === p.id) continue;
      insert.run(c.id, p.id, subject, "llm", 2);
      result.llm++;
    }
  }

  return result;
}

/**
 * 선수관계를 반영한 공부 순서를 만든다 (위상정렬 + 중요도 우선).
 *
 * 선수 개념이 모두 소진된 것 중 중요도가 높은 것부터 내보낸다.
 * 순환이 있으면 그 그룹은 중요도 순으로 풀어 진행을 막지 않는다.
 * exam_pair는 선후가 아니므로 순서 계산에서 제외한다.
 */
export function studyOrder(
  db: AoneDb,
  subject: string,
  conceptIds: string[],
): { id: string; name: string; prereqs: string[] }[] {
  const inScope = new Set(conceptIds);
  const nameOf = new Map(db.allConcepts(subject).map((c) => [c.id, c.name]));

  const deps = new Map<string, Set<string>>(conceptIds.map((id) => [id, new Set<string>()]));
  for (const row of db.raw
    .prepare("SELECT concept_id, prerequisite_id FROM concept_prereqs WHERE subject = ? AND origin != 'exam_pair'")
    .all(subject) as { concept_id: string; prerequisite_id: string }[]) {
    if (!inScope.has(row.concept_id) || !inScope.has(row.prerequisite_id)) continue;
    deps.get(row.concept_id)!.add(row.prerequisite_id);
  }

  const importanceOf = new Map<string, number>();
  for (const row of db.raw
    .prepare("SELECT concept_id, MAX(importance) importance FROM concept_scores WHERE subject = ? GROUP BY concept_id")
    .all(subject) as { concept_id: string; importance: number }[]) {
    importanceOf.set(row.concept_id, row.importance);
  }

  const out: { id: string; name: string; prereqs: string[] }[] = [];
  const done = new Set<string>();
  const remaining = new Set(conceptIds);

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => [...deps.get(id)!].every((d) => done.has(d)));
    // 순환으로 아무것도 준비되지 않으면 남은 것 중 가장 중요한 하나를 강제로 진행시킨다
    const pick = (ready.length > 0 ? ready : [...remaining]).sort(
      (a, b) => (importanceOf.get(b) ?? 0) - (importanceOf.get(a) ?? 0) || a.localeCompare(b),
    )[0];
    out.push({
      id: pick,
      name: nameOf.get(pick) ?? pick,
      prereqs: [...deps.get(pick)!].filter((d) => inScope.has(d)).map((d) => nameOf.get(d) ?? d),
    });
    done.add(pick);
    remaining.delete(pick);
  }
  return out;
}
