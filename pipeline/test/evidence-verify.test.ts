/**
 * 근거 인용문 원문 대조 테스트 (9단계).
 * 실제로 발견된 데통 3주차 1:08:12 귀속 오류를 재현해 교정되는지 확인한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyEvidence,
  isVerifiable,
} from "../src/layers/evidence-verify.js";

/** 실측 데이터 축약 — 인용문은 1:06:54 블록에 있는데 저장된 locator는 1:08:12였다 */
const REAL_CASE = new Map<string, string>([
  [
    "1:06:54",
    "그 알 수 있게 해주는 수학적인 도구가 프레이 변화는 이게 왜 중요하냐 사실 모든 통신이 다 써요.",
  ],
  [
    "1:08:12",
    "이 소설에 그냥 재미삼아 쓴 게 아니고 여러분이 쓰고 있는 지금 와이파이, 블루투스 이동통신 GPS 모든 통신이 다 쓰는 기술이에요.",
  ],
]);

test("인용문이 그 블록에 있으면 그대로 통과", () => {
  const r = verifyEvidence(
    "1:06:54",
    "수학적인 도구가 프레이 변화는",
    REAL_CASE,
  );
  assert.equal(r.outcome, "ok");
  assert.equal(r.locator, "1:06:54");
});

test("데통 3주차 1:08:12 — 인용문이 이전 블록에 있으면 그 블록으로 교정된다", () => {
  const r = verifyEvidence(
    "1:08:12",
    "그 알 수 있게 해주는 수학적인 도구가 프레이 변화는 이게 왜 중요하냐 사실 모든 통신이 다 써요.",
    REAL_CASE,
  );
  assert.equal(r.outcome, "relocated");
  assert.equal(r.locator, "1:06:54");
});

test("원문 어디에도 없는 인용문은 폐기한다", () => {
  const r = verifyEvidence("1:06:54", "교수님이 하지 않은 말입니다 지어낸 문장", REAL_CASE);
  assert.equal(r.outcome, "dropped");
  assert.equal(r.reason, "no-match");
});

test("여러 블록에 걸리는 인용문은 붙이지 않고 폐기한다", () => {
  // "모든 통신이 다 " 는 1:06:54·1:08:12 두 블록에 모두 있다.
  // 지목된 블록(03:38)에는 없으니 교정 후보를 찾지만, 둘 중 어느 쪽인지 정할 수 없다.
  const src = new Map(REAL_CASE);
  src.set("03:38", "주파수 이야기만 있는 블록");
  const r = verifyEvidence("03:38", "모든 통신이 다 ", src);
  assert.equal(r.outcome, "dropped");
  assert.equal(r.reason, "ambiguous");
});

test("locator가 없어도 인용문이 유일하게 실존하면 교정한다", () => {
  // 인용문 자체는 검증된 사실이므로 버리지 않고 제자리로 보낸다
  const r = verifyEvidence("9:99", "와이파이, 블루투스 이동통신 GPS", REAL_CASE);
  assert.equal(r.outcome, "relocated");
  assert.equal(r.locator, "1:08:12");
});

test("locator도 인용문도 가짜면 폐기한다", () => {
  const r = verifyEvidence("99:99", "지어낸 출처의 지어낸 인용", REAL_CASE);
  assert.equal(r.outcome, "dropped");
  assert.equal(r.reason, "unknown-locator");
});

test("공백 차이는 일치로 본다 (글자는 그대로)", () => {
  const src = new Map([["03:38", "주파수  사람이\n들을 수 있는"]]);
  const r = verifyEvidence("03:38", "주파수 사람이 들을 수 있는", src);
  assert.equal(r.outcome, "ok");
});

test("유사도로 붙이지 않는다 — 한 글자만 달라도 폐기", () => {
  const src = new Map([["03:38", "대역폭은 단위 시간당 전송 가능한 비트 수다"]]);
  const r = verifyEvidence("03:38", "대역폭은 단위 시간당 전송 불가능한 비트 수다", src);
  assert.equal(r.outcome, "dropped");
});

test("빈 인용·너무 짧은 인용은 대조 대상이 아니다", () => {
  assert.equal(isVerifiable(""), false);
  assert.equal(isVerifiable("   "), false);
  assert.equal(isVerifiable("네"), false);
  assert.equal(isVerifiable("대역폭이란"), true);
});
