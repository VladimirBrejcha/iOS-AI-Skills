#!/bin/sh
# Xcode Cloud pre-xcodebuild script: install XcodeGen and generate the project

set -e

echo "=== pre-xcodebuild: XcodeGen setup ==="

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_ROOT="${SCRIPT_DIR}/.."

cd "$REPO_ROOT"

if [ ! -f "project.yml" ]; then
  echo "ERROR: project.yml not found at repo root: $(pwd)"
  exit 1
fi

if command -v xcodegen >/dev/null 2>&1; then
  echo "XcodeGen already installed: $(xcodegen --version)"
else
  echo "Installing XcodeGen..."
  brew install xcodegen
fi

echo "Generating Xcode project..."
xcodegen generate

echo "=== pre-xcodebuild complete ==="
