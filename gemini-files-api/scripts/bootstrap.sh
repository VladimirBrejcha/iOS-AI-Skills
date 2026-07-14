#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK_FILE="$SCRIPT_DIR/package-lock.json"
LOCK_MARKER="$SCRIPT_DIR/node_modules/.gemini-files-api-lock-sha256"

cd "$SCRIPT_DIR"

if [[ "${1:-}" == "--force" ]]; then
  rm -rf node_modules
fi

if [[ -L node_modules ]]; then
  echo "[gemini-files-api] Replacing symlinked dependency directory at $SCRIPT_DIR/node_modules"
  rm -f node_modules
fi

lock_sha256="$(node -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
' "$LOCK_FILE")"

if [[ -d node_modules && -f "$LOCK_MARKER" && "$(cat "$LOCK_MARKER")" == "$lock_sha256" ]]; then
  echo "[gemini-files-api] Dependencies already installed at $SCRIPT_DIR/node_modules"
  exit 0
fi

echo "[gemini-files-api] Installing dependencies in $SCRIPT_DIR"
npm ci --ignore-scripts
printf '%s\n' "$lock_sha256" > "$LOCK_MARKER"
