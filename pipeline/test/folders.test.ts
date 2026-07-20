/**
 * folders.ts 유닛 테스트 — 폴더 키/슬러그/NFC 정규화 + listUnits(unit_order 규칙).
 * 실행: npm test (= tsx --test test/*.test.ts)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nfc, slugOf, folderKeyOf, listUnits, resolveUnit } from "../src/folders.js";

// ── nfc / slug / folderKey ──────────────────────────────────

test("nfc: NFD(자소분리) 입력을 NFC로 합성", () => {
  const nfd = "데이터통신".normalize("NFD");
  assert.notEqual(nfd, "데이터통신"); // 전제: 실제로 NFD가 다름
  assert.equal(nfc(nfd), "데이터통신");
  assert.equal(nfc(nfd).length, "데이터통신".length);
});

test("slugOf: subject__unit, folderKeyOf: subject/unit — 둘 다 NFC", () => {
  const key = { subject: "데이터통신", unit: "3주차" };
  assert.equal(slugOf(key), "데이터통신__3주차");
  assert.equal(folderKeyOf(key), "데이터통신/3주차");

  // NFD 입력이라도 결과는 NFC
  const nfdKey = { subject: "데이터통신".normalize("NFD"), unit: "3주차".normalize("NFD") };
  assert.equal(slugOf(nfdKey), "데이터통신__3주차");
  assert.equal(slugOf(nfdKey).normalize("NFC"), slugOf(nfdKey));
});

// ── listUnits: unit_order = 첫 숫자, 없으면 1000+mtime순번 ───

function mkTmpGoldset(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aone-folders-"));
}

test("listUnits: 첫 숫자 추출 + 숫자없는 폴더는 1000+, order 오름차순 정렬", () => {
  const root = mkTmpGoldset();
  const subj = path.join(root, "데이터통신");
  // mtime 순서를 강제: 족보를 먼저, 참고를 나중에 만든다
  fs.mkdirSync(path.join(subj, "족보"), { recursive: true });
  fs.mkdirSync(path.join(subj, "10주차"), { recursive: true });
  fs.mkdirSync(path.join(subj, "3주차"), { recursive: true });
  fs.mkdirSync(path.join(subj, "참고"), { recursive: true });

  // 숫자 없는 폴더의 mtime을 명시적으로 벌린다 (족보 < 참고)
  const past = new Date(Date.now() - 100000);
  fs.utimesSync(path.join(subj, "족보"), past, past);

  const units = listUnits(root, "데이터통신");
  const names = units.map((u) => u.unit);
  // 숫자 폴더(3, 10)가 앞(order=첫 숫자), 숫자 없는 폴더(1000+, mtime순)가 뒤
  assert.deepEqual(names, ["3주차", "10주차", "족보", "참고"]);
  assert.equal(units[0].unitOrder, 3);
  assert.equal(units[1].unitOrder, 10);
  // 숫자 없는 폴더는 1000 이상, 족보(더 오래된 mtime)가 참고보다 앞
  assert.ok(units[2].unitOrder >= 1000);
  assert.ok(units[3].unitOrder > units[2].unitOrder);
  // subject/unit 모두 NFC
  assert.ok(units.every((u) => u.subject === "데이터통신" && u.unit === u.unit.normalize("NFC")));
});

test("listUnits: 숨김 폴더(.으로 시작) 제외", () => {
  const root = mkTmpGoldset();
  const subj = path.join(root, "운영체제");
  fs.mkdirSync(path.join(subj, "1주차"), { recursive: true });
  fs.mkdirSync(path.join(subj, ".aone"), { recursive: true });
  fs.mkdirSync(path.join(subj, ".trash"), { recursive: true });

  const units = listUnits(root, "운영체제");
  assert.deepEqual(units.map((u) => u.unit), ["1주차"]);
});

test("listUnits: 존재하지 않는 과목 폴더 → 명확한 에러", () => {
  const root = mkTmpGoldset();
  assert.throws(() => listUnits(root, "없는과목"), /과목 폴더 없음/);
});

test("resolveUnit: NFD 입력도 NFC unit과 매칭, 없으면 후보 나열 에러", () => {
  const root = mkTmpGoldset();
  const subj = path.join(root, "데이터통신");
  fs.mkdirSync(path.join(subj, "3주차"), { recursive: true });

  const found = resolveUnit(root, "데이터통신", "3주차".normalize("NFD"));
  assert.equal(found.unit, "3주차");
  assert.equal(found.unitOrder, 3);

  assert.throws(() => resolveUnit(root, "데이터통신", "99주차"), /unit 폴더 없음/);
});
