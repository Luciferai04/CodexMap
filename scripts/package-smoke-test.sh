#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cd "$ROOT"
npm pack --silent --pack-destination "$TMP_DIR" >/dev/null
TARBALL="$(find "$TMP_DIR" -name 'codexmap-*.tgz' -print -quit)"

if [[ -z "$TARBALL" ]]; then
  echo "ERROR: npm pack did not produce a tarball" >&2
  exit 1
fi

mkdir -p "$TMP_DIR/project"
cd "$TMP_DIR/project"
npm init -y >/dev/null
npm install "$TARBALL" >/dev/null
npx codexmap doctor --port 39999 --ws-port 49999 >/dev/null
echo "[package-smoke] installed $(basename "$TARBALL") and ran npx codexmap doctor"
