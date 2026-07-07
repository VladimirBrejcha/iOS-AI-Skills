#!/bin/sh
# Xcode Cloud post-clone script: install XcodeGen and generate the project

set -e

echo "=== post-clone: XcodeGen setup ==="

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_ROOT="${SCRIPT_DIR}/.."

cd "$REPO_ROOT"

PROJECT_SPEC_PATH="${PROJECT_SPEC_PATH:-}"
if [ -n "${PROJECT_SPEC_PATH}" ]; then
  if [ ! -f "${PROJECT_SPEC_PATH}" ]; then
    echo "ERROR: PROJECT_SPEC_PATH not found: ${PROJECT_SPEC_PATH}"
    exit 1
  fi
elif [ -f "project.yml" ]; then
  PROJECT_SPEC_PATH="project.yml"
elif [ -f "project.yaml" ]; then
  PROJECT_SPEC_PATH="project.yaml"
else
  echo "ERROR: project.yml or project.yaml not found at repo root: $(pwd)"
  exit 1
fi

if command -v xcodegen >/dev/null 2>&1; then
  echo "XcodeGen already installed: $(xcodegen --version)"
else
  echo "Installing XcodeGen..."
  brew install xcodegen
fi

echo "Generating Xcode project from ${PROJECT_SPEC_PATH}..."
xcodegen generate --spec "${PROJECT_SPEC_PATH}"

echo "=== post-clone complete ==="
