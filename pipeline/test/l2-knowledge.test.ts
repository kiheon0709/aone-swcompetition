/**
 * l2-knowledge.ts 유닛 테스트 — 개념 이름 정규화/병합 판정/개념 id.
 * (LLM 호출 없는 순수 결정 로직만 검증.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, isSameConcept, conceptId } from "../src/layers/l2-knowledge.js";

test("normalizeName: 소문자화 + 공백·구분자 제거", () => {
  assert.equal(normalizeName("TCP / IP"), "tcpip");
  assert.equal(normalizeName("패킷 교환"), "패킷교환");
  assert.equal(normalizeName("Error-Correction_Code"), "errorcorrectioncode");
});

test("isSameConcept: 정규화 동일(표기 차이) 병합", () => {
  assert.ok(isSameConcept("TCP/IP", "tcp ip"));
  assert.ok(isSameConcept("패킷 교환", "패킷교환"));
});

test("isSameConcept: 괄호 보충표기 제거한 기본명 동일 병합", () => {
  assert.ok(isSameConcept("패킷 (Packet)", "패킷"));
  assert.ok(isSameConcept("흐름 제어 (Flow Control)", "흐름 제어"));
});

test("isSameConcept: 포함 관계(3자 이상) 병합", () => {
  assert.ok(isSameConcept("오류 검출 코드", "오류 검출"));
});

test("isSameConcept: 서로 다른 개념은 병합 안 함", () => {
  assert.equal(isSameConcept("패킷 교환", "회선 교환"), false);
  assert.equal(isSameConcept("TCP", "UDP"), false);
});

test("isSameConcept: 짧은 문자열은 부분포함 오병합 방지", () => {
  // na 길이 < 3이면 포함관계 규칙 미적용 (Dice로만 판정)
  assert.equal(isSameConcept("AB", "ABCDEF"), false);
});

test("conceptId: subject 스코프 + 영숫자/한글만 유지", () => {
  assert.equal(conceptId("데이터통신", "패킷 교환"), "c-데이터통신-패킷교환");
  assert.equal(conceptId("OS 운영체제", "TCP/IP"), "c-os운영체제-tcpip");
  // 같은 개념명이라도 subject가 다르면 다른 id
  assert.notEqual(conceptId("A", "패킷"), conceptId("B", "패킷"));
});
