#!/bin/bash
# 사이드카 스테이징 — .dmg 빌드 전에 실행.
# 번들 내용: Node 런타임(바이너리+npm/npx) + pipeline(node_modules 포함).
# 심사위원 머신에 Node가 없어도 앱 단독으로 파이프라인이 돈다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_SRC="$HOME/.nvm/versions/node/v22.19.0"
DEST="$ROOT/aone-app/src-tauri/resources"

rm -rf "$DEST"
mkdir -p "$DEST/node/bin" "$DEST/node/lib/node_modules"

# 1) Node 바이너리 + npm 본체만 (전역 패키지 제외)
cp "$NODE_SRC/bin/node" "$DEST/node/bin/node"
cp -R "$NODE_SRC/lib/node_modules/npm" "$DEST/node/lib/node_modules/npm"
# npx/npm은 심볼릭 링크라 번들에서 깨질 수 있어 실제 래퍼 스크립트로 생성
cat > "$DEST/node/bin/npx" << 'WRAP'
#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/node" "$DIR/../lib/node_modules/npm/bin/npx-cli.js" "$@"
WRAP
cat > "$DEST/node/bin/npm" << 'WRAP'
#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/node" "$DIR/../lib/node_modules/npm/bin/npm-cli.js" "$@"
WRAP
chmod +x "$DEST/node/bin/node" "$DEST/node/bin/npx" "$DEST/node/bin/npm"

# 2) pipeline (소스+의존성, 데이터·로그 제외)
rsync -a \
  --exclude "aone.db*" --exclude "*.log" --exclude ".DS_Store" \
  --exclude "exports/" --exclude "node_modules/.cache" \
  "$ROOT/pipeline/" "$DEST/pipeline/"

# 3) node_modules/.bin은 심볼릭 링크 농장인데 Tauri 번들러가 링크를 깨뜨린다
#    (링크 대상 파일을 .bin 안으로 복사 → 상대 import 실패).
#    실제로 쓰는 tsx만 진짜 래퍼 스크립트로 교체해 링크 의존을 없앤다.
rm -f "$DEST/pipeline/node_modules/.bin/tsx"
cat > "$DEST/pipeline/node_modules/.bin/tsx" << 'WRAP'
#!/bin/sh
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$DIR/tsx/dist/cli.mjs" "$@"
WRAP
chmod +x "$DEST/pipeline/node_modules/.bin/tsx"

# 4) 데모 데이터 — 분석 완료된 ~/Aone 형식 세트(/tmp/aone-demo-seed).
#    첫 실행 시 lib.rs setup_bundled_runtime이 ~/Aone으로 복사한다 (심사위원이 바로 열람).
DEMO_SRC="${AONE_DEMO_SEED:-/tmp/aone-demo-seed}"
if [ -d "$DEMO_SRC" ]; then
  rsync -a --exclude ".DS_Store" --exclude "*.log" \
    "$DEMO_SRC/" "$DEST/demo/"
  echo "데모 데이터 번들: $(du -sh "$DEST/demo" | cut -f1)"
else
  echo "경고: 데모 시드($DEMO_SRC) 없음 — 데모 없이 스테이징 (빈 첫 실행)"
fi

echo "스테이징 완료: $(du -sh "$DEST" | cut -f1)"
