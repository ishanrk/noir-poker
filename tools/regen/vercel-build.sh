#!/usr/bin/env bash
set -euo pipefail

base=340a9be579c2ca26715146b4c79ff0c8f681a1b5
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

cat tools/regen/noir-tools.part.* | base64 --decode > /tmp/noir-tools.tar.xz
echo "db20d0ff5ffcb9541da5e09ec84b27d4ea7c6e9064dba4bd51f562fe5a449ec7  /tmp/noir-tools.tar.xz" | sha256sum -c -
tar -xJf /tmp/noir-tools.tar.xz -C tools/regen
python3 -m py_compile tools/regen/common.py tools/regen/backend.py tools/regen/frontend.py tools/regen/apply.py
PYTHONPATH=tools/regen python3 tools/regen/apply.py

mkdir -p apps/web/public

git add -A
git diff --cached --binary "$base" -- \
  . \
  ':(exclude).github/workflows/noir-redesign.yml' \
  ':(exclude)tools/regen' \
  ':(exclude)apps/web/public' \
  > apps/web/public/noir-poker-redesign-fairness.patch
test -s apps/web/public/noir-poker-redesign-fairness.patch
sha256sum apps/web/public/noir-poker-redesign-fairness.patch \
  > apps/web/public/noir-poker-redesign-fairness.patch.sha256

tar \
  --exclude=.git \
  --exclude=tools/regen \
  --exclude=apps/web/node_modules \
  --exclude=apps/web/.next \
  --exclude=apps/web/public \
  -czf apps/web/public/noir-poker-redesign-source.tar.gz .

npm --prefix apps/web run challenge:test
npm --prefix apps/web run deal:test
npm --prefix apps/web run receipt:test
npm --prefix apps/web run lint

cat > apps/web/public/redesign-validation.json <<JSON
{
  "baseline": "$base",
  "patch_sha256": "$(cut -d' ' -f1 apps/web/public/noir-poker-redesign-fairness.patch.sha256)",
  "frontend_tests": "passed",
  "source_archive": "noir-poker-redesign-source.tar.gz"
}
JSON

cd apps/web
./node_modules/.bin/next build
