#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[release-preflight] checking for local secret patterns"
SECRET_REGEX="sk""-proj-|sk""-[A-Za-z0-9_-]{20,}"
SECRET_FILES="$(
  rg -l "$SECRET_REGEX" \
    --glob '!node_modules/**' \
    --glob '!.git/**' \
    --glob '!package-lock.json' \
    --glob '!*.tgz' \
    . || true
)"

if [[ -n "$SECRET_FILES" ]]; then
  echo "ERROR: potential secret-like tokens found in files:" >&2
  printf '%s\n' "$SECRET_FILES" >&2
  echo "Remove or rotate before release. Token values were not printed." >&2
  exit 1
fi

npm run check
npm test
npm run test:python-wrapper
npm run test:cli-ux
npm run test:package
npm run test:e2e:fake
npm run test:e2e:codex
npm run pack:smoke
npm publish --dry-run --provenance --access public --tag alpha
git diff --check

echo "[release-preflight] release gates passed"
