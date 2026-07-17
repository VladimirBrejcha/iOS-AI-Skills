#!/usr/bin/env bash
set -euo pipefail

skill_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
asset="$skill_root/assets/ci_pre_xcodebuild.sh"

assert_contains() {
  local haystack="$1"
  local needle="$2"

  if [[ "$haystack" != *"$needle"* ]]; then
    echo "expected output to contain: $needle" >&2
    echo "actual output:" >&2
    printf '%s\n' "$haystack" >&2
    exit 1
  fi
}

expect_failure() {
  local output
  if output="$("$@" 2>&1)"; then
    echo "expected command to fail: $*" >&2
    exit 1
  fi
  printf '%s' "$output"
}

sh -n "$asset"

source_text="$(
  printf '%s\n' \
    "$(<"$skill_root/SKILL.md")" \
    "$(<"$skill_root/references/xcode-cloud-notes.md")" \
    "$(<"$asset")"
)"
for unsafe in \
  'brew install xcodegen' \
  'git push' \
  'GITHUB_TOKEN' \
  'x-access-token:' \
  'CI_XCODEBUILD_EXIT_CODE:-0'; do
  if [[ "$source_text" == *"$unsafe"* ]]; then
    echo "unsafe default remains in xcode-cloud source: $unsafe" >&2
    exit 1
  fi
done

assert_contains "$source_text" "continuously present"
assert_contains "$source_text" "Retrieved: 2026-07-16"
assert_contains "$source_text" "CI_PRIMARY_REPOSITORY_PATH"
assert_contains "$source_text" "XCODEGEN_REQUIRED_VERSION"

fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT
repo_root="$fixture_root/repository"
project_root="$repo_root/App"
spec_root="$repo_root/Config"
mkdir -p "$project_root/ci_scripts" "$project_root/App.xcodeproj" "$spec_root"
mkdir -p "$project_root/App.xcworkspace"
package_resolved="$project_root/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
mkdir -p "$(dirname "$package_resolved")"
printf '%s\n' '{"pins":[{"identity":"fixture"}]}' >"$package_resolved"
cp "$asset" "$project_root/ci_scripts/ci_pre_xcodebuild.sh"
printf '%s\n' 'name: App' 'options:' '  minimumXcodeGenVersion: 2.45.4' >"$spec_root/project.yml"

cat >"$fixture_root/fake-xcodegen" <<'SH'
#!/bin/sh
set -eu
if [ "${1:-}" = "--version" ]; then
  printf 'Version: %s\n' "${FAKE_XCODEGEN_VERSION:-2.45.4}"
  exit 0
fi
printf '%s\n' "$*" >>"$FAKE_XCODEGEN_LOG"
mkdir -p "$FAKE_XCODEGEN_OUTPUT"
SH
chmod +x "$fixture_root/fake-xcodegen"

missing_opt_in_output="$(
  expect_failure env \
    CI_PRIMARY_REPOSITORY_PATH="$repo_root" \
    PROJECT_SPEC_PATH=Config/project.yml \
    EXPECTED_PROJECT_PATH=App/App.xcodeproj \
    XCODEGEN_REQUIRED_VERSION=2.45.4 \
    XCODEGEN_BIN="$fixture_root/fake-xcodegen" \
    sh "$project_root/ci_scripts/ci_pre_xcodebuild.sh"
)"
assert_contains "$missing_opt_in_output" "ALLOW_XCODEGEN_REGENERATION must be set to 1"

relative_repo_root_output="$(
  expect_failure env \
    CI_PRIMARY_REPOSITORY_PATH=relative/path \
    ALLOW_XCODEGEN_REGENERATION=1 \
    PROJECT_SPEC_PATH=Config/project.yml \
    EXPECTED_PROJECT_PATH=App/App.xcodeproj \
    XCODEGEN_REQUIRED_VERSION=2.45.4 \
    XCODEGEN_BIN="$fixture_root/fake-xcodegen" \
    sh "$project_root/ci_scripts/ci_pre_xcodebuild.sh"
)"
assert_contains "$relative_repo_root_output" "CI_PRIMARY_REPOSITORY_PATH must be absolute"

workspace_output="$(
  expect_failure env \
    CI_PRIMARY_REPOSITORY_PATH="$repo_root" \
    ALLOW_XCODEGEN_REGENERATION=1 \
    PROJECT_SPEC_PATH=Config/project.yml \
    EXPECTED_PROJECT_PATH=App/App.xcworkspace \
    XCODEGEN_REQUIRED_VERSION=2.45.4 \
    XCODEGEN_BIN="$fixture_root/fake-xcodegen" \
    sh "$project_root/ci_scripts/ci_pre_xcodebuild.sh"
)"
assert_contains "$workspace_output" "workspace regeneration is not supported"
[[ -d "$project_root/App.xcworkspace" ]]

version_mismatch_output="$(
  expect_failure env \
    CI_PRIMARY_REPOSITORY_PATH="$repo_root" \
    ALLOW_XCODEGEN_REGENERATION=1 \
    PROJECT_SPEC_PATH=Config/project.yml \
    EXPECTED_PROJECT_PATH=App/App.xcodeproj \
    XCODEGEN_REQUIRED_VERSION=2.45.4 \
    XCODEGEN_BIN="$fixture_root/fake-xcodegen" \
    FAKE_XCODEGEN_VERSION=2.45.3 \
    sh "$project_root/ci_scripts/ci_pre_xcodebuild.sh"
)"
assert_contains "$version_mismatch_output" "XcodeGen version mismatch"

missing_project_output="$(
  expect_failure env \
    CI_PRIMARY_REPOSITORY_PATH="$repo_root" \
    ALLOW_XCODEGEN_REGENERATION=1 \
    PROJECT_SPEC_PATH=Config/project.yml \
    EXPECTED_PROJECT_PATH=App/Missing.xcodeproj \
    XCODEGEN_REQUIRED_VERSION=2.45.4 \
    XCODEGEN_BIN="$fixture_root/fake-xcodegen" \
    sh "$project_root/ci_scripts/ci_pre_xcodebuild.sh"
)"
assert_contains "$missing_project_output" "must be an existing project directory before regeneration"

external_root="$fixture_root/external"
mkdir -p "$external_root/ParentLinked.xcodeproj" "$external_root/ProjectLinked.xcodeproj"
printf '%s\n' 'keep parent-linked project' >"$external_root/ParentLinked.xcodeproj/marker"
printf '%s\n' 'keep project-linked project' >"$external_root/ProjectLinked.xcodeproj/marker"
ln -s "$external_root" "$repo_root/Linked"
ln -s "$external_root/ProjectLinked.xcodeproj" "$project_root/ProjectLinked.xcodeproj"

linked_parent_output="$(
  expect_failure env \
    CI_PRIMARY_REPOSITORY_PATH="$repo_root" \
    ALLOW_XCODEGEN_REGENERATION=1 \
    PROJECT_SPEC_PATH=Config/project.yml \
    EXPECTED_PROJECT_PATH=Linked/ParentLinked.xcodeproj \
    XCODEGEN_REQUIRED_VERSION=2.45.4 \
    XCODEGEN_BIN="$fixture_root/fake-xcodegen" \
    sh "$project_root/ci_scripts/ci_pre_xcodebuild.sh"
)"
assert_contains "$linked_parent_output" "parent resolves outside repository root"
[[ "$(<"$external_root/ParentLinked.xcodeproj/marker")" == 'keep parent-linked project' ]]

linked_project_output="$(
  expect_failure env \
    CI_PRIMARY_REPOSITORY_PATH="$repo_root" \
    ALLOW_XCODEGEN_REGENERATION=1 \
    PROJECT_SPEC_PATH=Config/project.yml \
    EXPECTED_PROJECT_PATH=App/ProjectLinked.xcodeproj \
    XCODEGEN_REQUIRED_VERSION=2.45.4 \
    XCODEGEN_BIN="$fixture_root/fake-xcodegen" \
    sh "$project_root/ci_scripts/ci_pre_xcodebuild.sh"
)"
assert_contains "$linked_project_output" "resolves outside repository root"
[[ "$(<"$external_root/ProjectLinked.xcodeproj/marker")" == 'keep project-linked project' ]]

FAKE_XCODEGEN_LOG="$fixture_root/xcodegen.log" \
FAKE_XCODEGEN_OUTPUT=App/App.xcodeproj \
CI_PRIMARY_REPOSITORY_PATH="$repo_root" \
ALLOW_XCODEGEN_REGENERATION=1 \
PROJECT_SPEC_PATH=Config/project.yml \
EXPECTED_PROJECT_PATH=App/App.xcodeproj \
XCODEGEN_REQUIRED_VERSION=2.45.4 \
XCODEGEN_BIN="$fixture_root/fake-xcodegen" \
  sh "$project_root/ci_scripts/ci_pre_xcodebuild.sh" >/dev/null

assert_contains "$(<"$fixture_root/xcodegen.log")" "generate --spec Config/project.yml --project App"
[[ "$(<"$package_resolved")" == '{"pins":[{"identity":"fixture"}]}' ]]

mismatched_project_output="$(
  expect_failure env \
    FAKE_XCODEGEN_LOG="$fixture_root/xcodegen.log" \
    FAKE_XCODEGEN_OUTPUT=App/Other.xcodeproj \
    CI_PRIMARY_REPOSITORY_PATH="$repo_root" \
    ALLOW_XCODEGEN_REGENERATION=1 \
    PROJECT_SPEC_PATH=Config/project.yml \
    EXPECTED_PROJECT_PATH=App/App.xcodeproj \
    XCODEGEN_REQUIRED_VERSION=2.45.4 \
    XCODEGEN_BIN="$fixture_root/fake-xcodegen" \
    sh "$project_root/ci_scripts/ci_pre_xcodebuild.sh"
)"
assert_contains "$mismatched_project_output" "regeneration did not create expected project"
[[ ! -e "$project_root/App.xcodeproj" ]]
[[ -e "$project_root/Other.xcodeproj" ]]

echo "xcode-cloud contract tests passed"
