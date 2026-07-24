/**
 * l3-transcript-match.ts 정렬 매칭 유닛 테스트.
 * 합성 데이터로 핵심 성질을 검증한다 — 단조성, 오답 자료 거부, 잡담 배제, 복합 개념명 토큰 매칭.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { alignSlidesToUtterances, SlideKeywords, Utterance } from "../src/layers/l3-transcript-match.js";

const utt = (index: number, text: string): Utterance => ({ index, timestamp: null, text });
const slide = (page: number, strong: string[], weak: string[] = []): SlideKeywords => ({
  slideId: `doc_p${String(page).padStart(2, "0")}`,
  page,
  strong,
  weak,
});

// 발화가 짧으면 분량 게이트에 걸리므로 테스트 발화는 넉넉히 채운다
const pad = "이 내용은 수업에서 다룬 설명이며 예시와 함께 진행되었다. ".repeat(6);

test("정렬: 순서대로 진행된 강의가 순서대로 매칭된다", () => {
  const slides = [slide(1, ["세마포어"]), slide(2, ["교착상태"]), slide(3, ["기아현상"])];
  const utts = [
    utt(0, `세마포어는 정수형 변수와 큐로 만들어진 특수한 변수입니다 세마포어 값이 음수면 기다립니다 ${pad}`),
    utt(1, `이제 교착상태를 봅시다 교착상태는 서로가 서로를 기다려 아무도 진행하지 못하는 상황입니다 ${pad}`),
    utt(2, `마지막으로 기아현상입니다 기아현상은 스케줄러가 영원히 선택하지 않는 것입니다 ${pad}`),
  ];
  const { results, docScore } = alignSlidesToUtterances(slides, utts);
  assert.ok(docScore > 0.3, `docScore=${docScore}`);
  assert.equal(results[0].utterance?.index, 0);
  assert.equal(results[1].utterance?.index, 1);
  assert.equal(results[2].utterance?.index, 2);
});

test("정렬: 순서를 거스르는 배정은 하지 않는다 (단조성)", () => {
  // 발화: [A강, B강, A약] — 마지막 A 발화는 포인터가 B를 지난 뒤라 A에 못 붙는다
  const slides = [slide(1, ["세마포어"]), slide(2, ["교착상태"])];
  const utts = [
    utt(0, `세마포어는 특수한 변수입니다 세마포어 세마포어 값을 증가시키고 감소시킵니다 ${pad}`),
    utt(1, `교착상태는 서로를 기다리는 상황입니다 교착상태 교착상태의 조건을 봅시다 ${pad}`),
    utt(2, `아까 세마포어 얘기로 잠깐 돌아가면 ${pad}`),
  ];
  const { results } = alignSlidesToUtterances(slides, utts);
  const aIdx = results[0].utterances.map((u) => u.index);
  const bIdx = results[1].utterances.map((u) => u.index);
  // A에 배정된 모든 발화는 B에 배정된 모든 발화보다 앞서야 한다
  if (aIdx.length && bIdx.length) {
    assert.ok(Math.max(...aIdx) < Math.min(...bIdx), `A=${aIdx} B=${bIdx}`);
  }
});

test("정렬: 전사본이 다른 수업(실습) 자료면 자료 전체를 거부한다", () => {
  // 이론 수업 녹음 vs 도커 실습 슬라이드 — 키워드가 하나도 안 겹친다
  const slides = [slide(1, ["도커"], ["컨테이너"]), slide(2, ["와이어샤크"], ["패킷캡처"])];
  const utts = [
    utt(0, `세마포어는 정수형 변수입니다 세마포어 값이 음수면 블록됩니다 ${pad}`),
    utt(1, `교착상태는 서로를 기다려 아무도 진행하지 못합니다 ${pad}`),
  ];
  const { results, docScore } = alignSlidesToUtterances(slides, utts);
  assert.ok(docScore < 0.3, `docScore=${docScore}`);
  assert.ok(results.every((r) => r.utterance === null), "오답 자료에는 아무것도 붙이면 안 된다");
});

test("정렬: 개념어가 없는 잡담 발화는 어느 슬라이드에도 붙지 않는다", () => {
  const slides = [slide(1, ["세마포어"])];
  const junk = utt(0, `자 다음 주에 과제 제출이 있으니까 잊지 마시고 질문 있으면 이메일 주세요 ${pad}`);
  const real = utt(1, `세마포어는 정수형 변수와 큐로 만들어진 특수한 변수입니다 세마포어 값이 음수면 프로세스가 블록됩니다 ${pad}`);
  const { results } = alignSlidesToUtterances(slides, [junk, real]);
  assert.ok(!results[0].utterances.some((u) => u.index === 0), "잡담이 배정되면 안 된다");
  assert.equal(results[0].utterance?.index, 1);
});

test("정렬: 복합 개념명은 토큰으로도 매칭된다", () => {
  // "파일 제어 블록과 파일 속성" — 발화에 전체 구문은 없지만 토큰(파일 제어 블록, 속성)은 있다
  const slides = [slide(1, ["파일 제어 블록과 파일 속성"])];
  const utts = [
    utt(0, `파일을 만들면 운영체제는 파일 제어 블록을 만들어 속성 정보를 저장합니다 파일 제어 블록에는 크기와 위치가 들어갑니다 ${pad}`),
  ];
  const { results, docScore } = alignSlidesToUtterances(slides, utts);
  assert.ok(docScore > 0, `docScore=${docScore}`);
  assert.equal(results[0].utterance?.index, 0);
});

test("정렬: 전사 분량이 슬라이드 수 대비 부족하면 시도하지 않는다", () => {
  const slides = Array.from({ length: 20 }, (_, i) => slide(i + 1, ["세마포어"]));
  const utts = [utt(0, "세마포어 짧은 메모")];
  const { results } = alignSlidesToUtterances(slides, utts);
  assert.ok(results.every((r) => r.skipReason));
});
