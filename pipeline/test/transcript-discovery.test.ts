/**
 * R5 — 전사본 파일명 하드코딩 제거 (5단계).
 *
 * 앱은 `txt|md` 중 이름에 `transcript`·`전사`·`녹음`이 있으면 전사본으로 분류하는데
 * 파이프라인은 `transcript.txt` 고정이었다. 그래서 `데이터통신_1주차_전사.txt`를 넣으면
 * **앱 UI는 "강의 녹음" 카드로 보여주는데 파이프라인은 발화 0건으로 돌았다.**
 * 경고 한 줄 없이 앱의 핵심 가치(발화 근거·평가신호·능동 제안)가 통째로 빠진다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isTranscriptFileName,
  loadUnitInputs,
} from "../src/layers/l1-normalize.js";

const TRANSCRIPT = "참석자 1 00:00\n안녕하세요 오늘은 신호처리를 배웁니다.\n\n참석자 1 00:30\n푸리에 변환이 핵심입니다.\n";

/** 임시 goldset 트리를 만들고 경로를 준다 */
function fixture(files: Record<string, string>): { dir: string; clean: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aone-r5-"));
  const unit = path.join(root, "신호처리", "1주차");
  fs.mkdirSync(unit, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(unit, name), body);
  }
  return { dir: root, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const KEY = { subject: "신호처리", unit: "1주차", unitOrder: 1 };

test("앱과 같은 기준으로 전사본을 인식한다", () => {
  // 앱(files.rs classify)이 transcript로 보는 이름들
  assert.ok(isTranscriptFileName("transcript.txt"));
  assert.ok(isTranscriptFileName("신호처리_1주차_전사.txt"));
  assert.ok(isTranscriptFileName("데이터통신_1주차_녹음.md"));
  assert.ok(isTranscriptFileName("Lecture-Transcript.TXT"));
  // 전사본이 아닌 것
  assert.ok(!isTranscriptFileName("강의자료.pdf"));
  assert.ok(!isTranscriptFileName("메모.txt"));
  assert.ok(!isTranscriptFileName("전사.pdf")); // 확장자가 아니다
});

test("_전사.txt 이름으로도 발화가 인식된다", () => {
  const f = fixture({ "신호처리_1주차_전사.txt": TRANSCRIPT });
  try {
    const inputs = loadUnitInputs(f.dir, KEY);
    assert.equal(inputs.transcript.length, 2, "발화 2건이 읽혀야 한다");
    assert.equal(inputs.transcriptSource.file, "신호처리_1주차_전사.txt");
    assert.equal(inputs.transcriptSource.warning, null);
  } finally {
    f.clean();
  }
});

test("transcript.txt는 예전과 똑같이 동작한다 (데모 회귀 방지)", () => {
  const f = fixture({ "transcript.txt": TRANSCRIPT });
  try {
    const inputs = loadUnitInputs(f.dir, KEY);
    assert.equal(inputs.transcript.length, 2);
    assert.equal(inputs.transcriptSource.file, "transcript.txt");
    assert.equal(inputs.transcriptSource.warning, null);
  } finally {
    f.clean();
  }
});

test("전사본이 없으면 경고를 남긴다 — 조용히 통과시키지 않는다", () => {
  const f = fixture({ "메모.txt": "전사본이 아닌 파일" });
  try {
    const inputs = loadUnitInputs(f.dir, KEY);
    assert.equal(inputs.transcript.length, 0);
    assert.equal(inputs.transcriptSource.file, null);
    assert.match(inputs.transcriptSource.warning ?? "", /전사본이 인식되지 않아/);
  } finally {
    f.clean();
  }
});

test("전사본이 2개면 transcript.txt를 우선하고 경고한다", () => {
  const f = fixture({
    "transcript.txt": TRANSCRIPT,
    "신호처리_1주차_전사.txt": "참석자 1 00:00\n다른 파일입니다.\n",
  });
  try {
    const inputs = loadUnitInputs(f.dir, KEY);
    assert.equal(inputs.transcriptSource.file, "transcript.txt");
    assert.equal(inputs.transcriptSource.candidates.length, 2);
    assert.match(inputs.transcriptSource.warning ?? "", /후보가 2개/);
  } finally {
    f.clean();
  }
});

test("transcript.txt가 없고 후보가 여럿이면 가장 큰 파일을 쓴다", () => {
  const f = fixture({
    "짧은_전사.txt": "참석자 1 00:00\n짧다.\n",
    "긴_녹음.txt": TRANSCRIPT + "참석자 1 01:00\n" + "긴 내용입니다. ".repeat(50) + "\n",
  });
  try {
    const inputs = loadUnitInputs(f.dir, KEY);
    assert.equal(inputs.transcriptSource.file, "긴_녹음.txt");
    assert.match(inputs.transcriptSource.warning ?? "", /후보가 2개/);
  } finally {
    f.clean();
  }
});

test("전사본은 있는데 발화를 못 읽으면 경고한다", () => {
  const f = fixture({ "전사.txt": "" });
  try {
    const inputs = loadUnitInputs(f.dir, KEY);
    assert.equal(inputs.transcript.length, 0);
    assert.match(inputs.transcriptSource.warning ?? "", /발화를 하나도 읽지 못했습니다/);
  } finally {
    f.clean();
  }
});
