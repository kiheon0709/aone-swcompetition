/**
 * 설정 이중화 감시 테스트 (3단계).
 *
 * 배경 — 데스크톱 배포본(.dmg)은 `scripts/stage-sidecar.sh`가 `pipeline/`을
 * `aone-app/src-tauri/resources/pipeline/`으로 rsync해서 만든다. 그래서 같은
 * `config.ts`가 두 곳에 존재한다. 스테이징을 잊으면 앱은 옛 가중치로 돌고
 * 웹은 새 가중치로 돌아, 같은 개념이 화면마다 다른 점수를 보인다.
 * (실제로 그랬다: 개발본은 7/21 포화 수정본, 사본은 7/14 값 그대로였다.)
 *
 * 이 테스트는 사본이 존재할 때만 대조한다. 사본은 gitignore 대상이라
 * CI·클론 환경에는 없는 게 정상이므로, 없으면 조용히 통과시킨다.
 * 있는데 다르면 실패시켜 "스테이징을 다시 돌려라"를 빌드 시점에 알린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const DEV = join(here, "..", "src", "config.ts");
const COPY = join(
  here,
  "..",
  "..",
  "aone-app",
  "src-tauri",
  "resources",
  "pipeline",
  "src",
  "config.ts",
);

test("번들 사본 config.ts가 개발본과 같다", () => {
  if (!existsSync(COPY)) {
    // 사본 없음 = 아직 스테이징 안 한 환경. 검사 대상이 없으므로 통과.
    return;
  }
  const dev = readFileSync(DEV, "utf8");
  const copy = readFileSync(COPY, "utf8");
  assert.equal(
    copy,
    dev,
    "pipeline/src/config.ts 와 resources 사본이 다릅니다. " +
      "`bash scripts/stage-sidecar.sh` 를 다시 돌려 번들 사본을 갱신하세요.",
  );
});
