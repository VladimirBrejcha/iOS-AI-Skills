#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

assert_contains() {
  local haystack="$1"
  local needle="$2"

  if ! printf '%s\n' "$haystack" | grep -F -q -- "$needle"; then
    echo "expected output to contain: $needle" >&2
    echo "actual output:" >&2
    printf '%s\n' "$haystack" >&2
    exit 1
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"

  if printf '%s\n' "$haystack" | grep -F -q -- "$needle"; then
    echo "unexpected output: $needle" >&2
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

git_commit() {
  local repo="$1"
  local message="$2"

  git -C "$repo" add .
  git -C "$repo" -c user.name="Fixture" -c user.email="fixture@example.com" commit -q -m "$message"
}

write_fixture_registry() {
  local root="$1"
  local pinned_tag="$2"
  local observed_commit="$3"
  local lock_pinned_tag="${4:-$pinned_tag}"
  local lock_observed_commit="${5:-$observed_commit}"
  local source_url="${6:-upstream}"

  cat >"$root/skills.registry.yaml" <<YAML
schema_version: 0.1
status: active-partial
registry:
  id: fixture-skills
  name: Fixture Skills
  manager_source: fixture/skills
skills:
  - id: external-skill
    status: needs-import-review
    source:
      type: external-git
      url: "$source_url"
      path: swiftui-pro
      pinned_tag: "$pinned_tag"
      observed_commit: "$observed_commit"
      observed_at: "2026-07-05"
    exported_names:
      - external-skill
    clients:
      codex: planned
    scopes:
      - machine
      - repo
    update_policy: external-reviewed
    catalog:
      description: External fixture skill.
YAML

  cat >"$root/skills.lock.yaml" <<YAML
schema_version: 0.1
skills:
  - id: external-skill
    source_type: external-git
    url: "$source_url"
    path: swiftui-pro
    pinned_tag: "$lock_pinned_tag"
    observed_commit: "$lock_observed_commit"
    exported_names:
      - external-skill
YAML
}

run_report() {
  local root="$1"
  shift

  (
    cd "$root"
    ruby "$repo_root/scripts/skills_upstream_updates.rb" \
      --registry skills.registry.yaml \
      --lock skills.lock.yaml \
      --today 2026-07-05 \
      "$@"
  )
}

fixture_dir="$tmp_dir/fixture"
upstream_dir="$fixture_dir/upstream"
mkdir -p "$upstream_dir/swiftui-pro"
git -C "$upstream_dir" init -q

cat >"$upstream_dir/swiftui-pro/SKILL.md" <<'SKILL'
---
name: swiftui-pro
description: Fixture 1.0.0 skill.
---

# SwiftUI Pro
SKILL
git_commit "$upstream_dir" "initial skill"
git -C "$upstream_dir" tag 1.0.0
commit_100="$(git -C "$upstream_dir" rev-parse 1.0.0^{})"

cat >"$upstream_dir/swiftui-pro/SKILL.md" <<'SKILL'
---
name: swiftui-pro
description: Fixture 1.1.0 skill.
---

# SwiftUI Pro
SKILL
git_commit "$upstream_dir" "update skill"
git -C "$upstream_dir" tag 1.1.0
commit_110="$(git -C "$upstream_dir" rev-parse 1.1.0^{})"

write_fixture_registry "$fixture_dir" "1.0.0" "$commit_100"
stale_json="$(run_report "$fixture_dir" --json)"
assert_contains "$stale_json" '"status": "stale"'
assert_contains "$stale_json" '"pinned_tag": "1.0.0"'
assert_contains "$stale_json" '"tag": "1.1.0"'
assert_contains "$stale_json" '"update_required": true'

stale_markdown="$(run_report "$fixture_dir" --markdown)"
assert_contains "$stale_markdown" "# Upstream Update Report"
assert_contains "$stale_markdown" "git diff --stat 1.0.0..1.1.0 -- swiftui-pro"
assert_contains "$stale_markdown" "Regenerate skills.lock.yaml"
assert_not_contains "$stale_markdown" "$tmp_dir"

stale_failure="$(expect_failure run_report "$fixture_dir" --fail-on-stale)"
assert_contains "$stale_failure" "stale external pins"

write_fixture_registry "$fixture_dir" "1.1.0" "$commit_110"
current_json="$(run_report "$fixture_dir" --json --fail-on-stale)"
assert_contains "$current_json" '"status": "current"'
assert_contains "$current_json" '"update_required": false'
assert_contains "$current_json" '"update_required": 0'

git -C "$upstream_dir" tag -f 1.0.0 "$commit_110" >/dev/null 2>&1
write_fixture_registry "$fixture_dir" "1.0.0" "$commit_100"
moved_pin_json="$(run_report "$fixture_dir" --json)"
assert_contains "$moved_pin_json" '"status": "pin-mismatch"'
assert_contains "$moved_pin_json" '"tag": "1.1.0"'
assert_contains "$moved_pin_json" '"update_required": true'

write_fixture_registry "$fixture_dir" "9.9.9" "$commit_110"
missing_json="$(run_report "$fixture_dir" --json)"
assert_contains "$missing_json" '"status": "missing-current-tag"'
assert_contains "$missing_json" '"update_required": true'
missing_failure="$(expect_failure run_report "$fixture_dir" --fail-on-stale)"
assert_contains "$missing_failure" "stale external pins"

check_failed_dir="$tmp_dir/check-failed"
mkdir -p "$check_failed_dir"
write_fixture_registry "$check_failed_dir" "1.1.0" "$commit_110" "1.1.0" "$commit_110" "missing-upstream"
check_failed_json="$(run_report "$check_failed_dir" --json)"
assert_contains "$check_failed_json" '"status": "check-failed"'
assert_contains "$check_failed_json" '"check_failed": 1'
check_failed_markdown="$(run_report "$check_failed_dir" --markdown)"
assert_contains "$check_failed_markdown" "## Upstream Check Failures"
assert_not_contains "$check_failed_markdown" "No external pins require an update PR."
check_failed_failure="$(expect_failure run_report "$check_failed_dir" --json --fail-on-stale)"
assert_contains "$check_failed_failure" '"status": "check-failed"'
assert_contains "$check_failed_failure" "stale external pins or upstream check failures found"
assert_not_contains "$check_failed_failure" "NoMethodError"

scheme_credential_dir="$tmp_dir/scheme-credential-url"
mkdir -p "$scheme_credential_dir"
write_fixture_registry "$scheme_credential_dir" "1.0.0" "$commit_100" "1.0.0" "$commit_100" "ssh://git:token@example.com/acme/skills.git"
scheme_credential_output="$(expect_failure run_report "$scheme_credential_dir" --json)"
assert_contains "$scheme_credential_output" "external-skill: external-git source.url must be a public, credential-free URL or safe relative test URL"
assert_not_contains "$scheme_credential_output" "token"

scp_credential_dir="$tmp_dir/scp-credential-url"
mkdir -p "$scp_credential_dir"
write_fixture_registry "$scp_credential_dir" "1.0.0" "$commit_100" "1.0.0" "$commit_100" "git:token@example.com:acme/skills.git"
scp_credential_output="$(expect_failure run_report "$scp_credential_dir" --json)"
assert_contains "$scp_credential_output" "external-skill: external-git source.url must be a public, credential-free URL or safe relative test URL"
assert_not_contains "$scp_credential_output" "token"

write_fixture_registry "$fixture_dir" "1.1.0" "$commit_110" "1.0.0" "$commit_100"
lock_mismatch="$(expect_failure run_report "$fixture_dir" --json)"
assert_contains "$lock_mismatch" "external-skill: lock entry differs from registry fields"

echo "skills_upstream_updates test ok"
