/**
 * 번들 node_modules/.bin 심볼릭 링크 복구 (tauri build 후처리).
 *
 * 배경 — Tauri 번들러는 resources를 복사할 때 심볼릭 링크를 **따라가서 실제 파일로**
 * 만든다. 그러면 `.bin/tsx`가 `tsx/dist/cli.mjs`의 사본이 되는데, tsx는 자기 옆에서
 * `package-*.mjs` 같은 형제 모듈을 상대경로로 import한다. 사본은 `.bin/` 안에 홀로
 * 놓이므로 형제가 없어 실행이 죽는다:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../.bin/package-CiRlP2hu.mjs'
 *   imported from .../.bin/tsx
 *
 * 실제로 이 버그로 "슬라이드별 설명 만들기"가 무조건 실패했다 (앱 로그 aone-slides-run.log).
 * 파이프라인은 전부 `.bin/tsx`로 실행되므로 tsx가 죽으면 분석 기능 전체가 죽는다.
 *
 * 그래서 빌드 후 원본(pipeline/node_modules/.bin)의 링크 구조를 그대로 복원한다.
 * 원본이 링크인 항목만 대상으로 하고, 실제 파일인 항목은 건드리지 않는다.
 */
import { chmodSync, existsSync, lstatSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcBin = join(appDir, "..", "pipeline", "node_modules", ".bin");

/** 번들 산출물 안의 .bin 디렉토리 후보 (macOS .app + 그 외 타깃 레이아웃). */
const bundleBins = () => {
  const release = join(appDir, "src-tauri", "target", "release", "bundle");
  if (!existsSync(release)) return [];
  const found = [];
  // .app 안의 .bin은 bundle/ 기준 8단계 아래에 있다
  // (macos/Aone.app/Contents/Resources/resources/pipeline/node_modules/.bin).
  const walk = (dir, depth) => {
    if (depth > 10) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      const p = join(dir, e.name);
      if (e.name === ".bin" && p.includes(join("pipeline", "node_modules"))) found.push(p);
      else walk(p, depth + 1);
    }
  };
  walk(release, 0);
  return found;
};

if (!existsSync(srcBin)) {
  console.log(`[fix-bundle-bin] 원본 .bin 없음 — 건너뜀 (${srcBin})`);
  process.exit(0);
}

// 원본에서 "링크인 항목"만 수집 — 실제 파일은 복원 대상이 아니다.
const links = readdirSync(srcBin)
  .map((name) => ({ name, path: join(srcBin, name) }))
  .filter(({ path }) => lstatSync(path).isSymbolicLink())
  .map(({ name, path }) => ({ name, target: readlinkSync(path) }));

const targets = bundleBins();
if (targets.length === 0) {
  console.log("[fix-bundle-bin] 번들 .bin 을 찾지 못했습니다 — 건너뜀");
  process.exit(0);
}

for (const binDir of targets) {
  let restored = 0;
  for (const { name, target } of links) {
    const dst = join(binDir, name);
    // 이미 링크면 그대로 둔다 (재실행 안전).
    if (existsSync(dst) && lstatSync(dst).isSymbolicLink()) continue;
    if (existsSync(dst)) rmSync(dst, { force: true });
    symlinkSync(target, dst);
    restored++;
  }
  // 링크가 가리키는 실제 실행 파일에 실행 권한이 없으면 spawn이 EACCES로 죽는다.
  for (const { name, target } of links) {
    const real = resolve(binDir, target);
    if (existsSync(real)) chmodSync(real, 0o755);
  }
  console.log(`[fix-bundle-bin] ${restored}개 링크 복구 → ${binDir}`);
}
