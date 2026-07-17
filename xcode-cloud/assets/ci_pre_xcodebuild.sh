#!/bin/sh
# Optional Xcode Cloud pre-xcodebuild guard for reviewed XcodeGen regeneration

set -eu

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

validate_relative_path() {
  case "$1" in
    ""|/*|..|../*|*/..|*/../*)
      fail "$2 must be a non-empty repository-relative path"
      ;;
  esac
}

if [ "${ALLOW_XCODEGEN_REGENERATION:-}" != "1" ]; then
  fail "ALLOW_XCODEGEN_REGENERATION must be set to 1 after project-specific review"
fi

PROJECT_SPEC_PATH="${PROJECT_SPEC_PATH:-}"
EXPECTED_PROJECT_PATH="${EXPECTED_PROJECT_PATH:-}"
XCODEGEN_REQUIRED_VERSION="${XCODEGEN_REQUIRED_VERSION:-}"

validate_relative_path "$PROJECT_SPEC_PATH" "PROJECT_SPEC_PATH"
validate_relative_path "$EXPECTED_PROJECT_PATH" "EXPECTED_PROJECT_PATH"
[ -n "$XCODEGEN_REQUIRED_VERSION" ] || fail "XCODEGEN_REQUIRED_VERSION is required"

case "$EXPECTED_PROJECT_PATH" in
  *.xcodeproj|*.xcworkspace)
    ;;
  *)
    fail "EXPECTED_PROJECT_PATH must name an .xcodeproj or .xcworkspace"
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
case "${CI_PRIMARY_REPOSITORY_PATH:-}" in
  "")
    REPO_ROOT="${SCRIPT_DIR}/.."
    ;;
  /*)
    REPO_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
    ;;
  *)
    fail "CI_PRIMARY_REPOSITORY_PATH must be absolute when set"
    ;;
esac

[ -d "$REPO_ROOT" ] || fail "repository root not found: $REPO_ROOT"

cd "$REPO_ROOT"

[ -f "$PROJECT_SPEC_PATH" ] || fail "PROJECT_SPEC_PATH not found: $PROJECT_SPEC_PATH"
[ -e "$EXPECTED_PROJECT_PATH" ] || fail "EXPECTED_PROJECT_PATH must exist before regeneration: $EXPECTED_PROJECT_PATH"

XCODEGEN_BIN="${XCODEGEN_BIN:-$(command -v xcodegen 2>/dev/null || true)}"
[ -n "$XCODEGEN_BIN" ] || fail "XcodeGen is not available; provision the reviewed version deterministically"
[ -x "$XCODEGEN_BIN" ] || fail "XCODEGEN_BIN is not executable: $XCODEGEN_BIN"

VERSION_OUTPUT="$("$XCODEGEN_BIN" --version 2>&1)" || fail "unable to read XcodeGen version"
case "$VERSION_OUTPUT" in
  "$XCODEGEN_REQUIRED_VERSION"|"Version: $XCODEGEN_REQUIRED_VERSION")
    ;;
  *)
    fail "XcodeGen version mismatch: expected $XCODEGEN_REQUIRED_VERSION, got $VERSION_OUTPUT"
    ;;
esac

echo "Regenerating $EXPECTED_PROJECT_PATH from $PROJECT_SPEC_PATH with XcodeGen $XCODEGEN_REQUIRED_VERSION"
"$XCODEGEN_BIN" generate --spec "$PROJECT_SPEC_PATH"
[ -e "$EXPECTED_PROJECT_PATH" ] || fail "regeneration did not preserve expected project: $EXPECTED_PROJECT_PATH"

echo "XcodeGen regeneration guard complete"
