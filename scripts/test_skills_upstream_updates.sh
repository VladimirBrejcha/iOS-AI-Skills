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

legacy_dir="$tmp_dir/legacy"
mkdir -p "$legacy_dir"
write_fixture_registry "$legacy_dir" "1.1.0" "$commit_110"
ruby -ryaml -e '
  registry_path, lock_path = ARGV
  registry = YAML.safe_load(File.read(registry_path), aliases: false)
  registry.fetch("skills").first["status"] = "legacy"
  File.write(registry_path, registry.to_yaml)
  lock = YAML.safe_load(File.read(lock_path), aliases: false)
  lock["skills"] = []
  File.write(lock_path, lock.to_yaml)
' "$legacy_dir/skills.registry.yaml" "$legacy_dir/skills.lock.yaml"
legacy_json="$(run_report "$legacy_dir" --json --fail-on-stale)"
assert_contains "$legacy_json" '"external_skills": 0'
assert_not_contains "$legacy_json" '"id": "external-skill"'

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

remote_helper_dir="$tmp_dir/remote-helper-url"
mkdir -p "$remote_helper_dir"
write_fixture_registry "$remote_helper_dir" "1.0.0" "$commit_100" "1.0.0" "$commit_100" "foo::anything"
remote_helper_output="$(expect_failure run_report "$remote_helper_dir" --json)"
assert_contains "$remote_helper_output" "external-skill: external-git source.url must be a public, credential-free URL or safe relative test URL"

mixed_case_transport_dir="$tmp_dir/mixed-case-transport"
mkdir -p "$mixed_case_transport_dir"
write_fixture_registry "$mixed_case_transport_dir" "1.0.0" "$commit_100" "1.0.0" "$commit_100" "HTTPS://example.com/acme/skills.git"
mixed_case_transport_output="$(expect_failure run_report "$mixed_case_transport_dir" --json)"
assert_contains "$mixed_case_transport_output" "external-skill: external-git source.url must be a public, credential-free URL or safe relative test URL"

query_url_dir="$tmp_dir/query-url"
mkdir -p "$query_url_dir"
write_fixture_registry "$query_url_dir" "1.0.0" "$commit_100" "1.0.0" "$commit_100" "https://example.com/org/repo.git?token=secret"
query_url_output="$(expect_failure run_report "$query_url_dir" --json)"
assert_contains "$query_url_output" "external-skill: external-git source.url must be a public, credential-free URL or safe relative test URL"
assert_not_contains "$query_url_output" "token"

private_http_dir="$tmp_dir/private-http-url"
mkdir -p "$private_http_dir"
write_fixture_registry "$private_http_dir" "1.0.0" "$commit_100" "1.0.0" "$commit_100" "http://10.0.0.5/org/repo.git"
private_http_output="$(expect_failure run_report "$private_http_dir" --json)"
assert_contains "$private_http_output" "external-skill: external-git source.url must be a public, credential-free URL or safe relative test URL"

localhost_ssh_dir="$tmp_dir/localhost-ssh-url"
mkdir -p "$localhost_ssh_dir"
write_fixture_registry "$localhost_ssh_dir" "1.0.0" "$commit_100" "1.0.0" "$commit_100" "ssh://localhost/org/repo.git"
localhost_ssh_output="$(expect_failure run_report "$localhost_ssh_dir" --json)"
assert_contains "$localhost_ssh_output" "external-skill: external-git source.url must be a public, credential-free URL or safe relative test URL"

windows_path_dir="$tmp_dir/windows-path-url"
mkdir -p "$windows_path_dir"
write_fixture_registry "$windows_path_dir" "1.0.0" "$commit_100" "1.0.0" "$commit_100" "C:/Users/alice/private-repo"
windows_path_output="$(expect_failure run_report "$windows_path_dir" --json)"
assert_contains "$windows_path_output" "external-skill: external-git source.url must be a public, credential-free URL or safe relative test URL"
assert_not_contains "$windows_path_output" "C:/Users/alice/private-repo"

upstream_rewrite_disabled_dir="$tmp_dir/upstream-rewrite-disabled"
mkdir -p "$upstream_rewrite_disabled_dir/tmp-worktree" "$upstream_rewrite_disabled_dir/bin"
git -C "$upstream_rewrite_disabled_dir/tmp-worktree" init -q
git -C "$upstream_rewrite_disabled_dir/tmp-worktree" config url.file:///tmp/private.insteadOf https://example.com/org/repo.git
write_fixture_registry \
  "$upstream_rewrite_disabled_dir/tmp-worktree" \
  "1.0.0" \
  "$commit_100" \
  "1.0.0" \
  "$commit_100" \
  "https://example.com/org/repo.git"
real_git="$(command -v git)"
cat >"$upstream_rewrite_disabled_dir/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "ls-remote" ]; then
  pwd_path="$(pwd -P)"
  if [ "${GIT_CONFIG_NOSYSTEM:-}" != "1" ]; then
    echo "expected GIT_CONFIG_NOSYSTEM=1" >&2
    exit 99
  fi
  if [ "${GIT_CONFIG_SYSTEM:-}" != "/dev/null" ]; then
    echo "expected GIT_CONFIG_SYSTEM=/dev/null" >&2
    exit 99
  fi
  if [ "${GIT_CONFIG_GLOBAL:-}" != "/dev/null" ]; then
    echo "expected GIT_CONFIG_GLOBAL=/dev/null" >&2
    exit 99
  fi
  if [ "${GIT_CONFIG_COUNT:-}" != "0" ]; then
    echo "expected GIT_CONFIG_COUNT=0" >&2
    exit 99
  fi
  if [ -n "${GIT_CONFIG_PARAMETERS:-}" ]; then
    echo "expected GIT_CONFIG_PARAMETERS to be cleared" >&2
    exit 99
  fi
  if [ -n "${GIT_CONFIG_KEY_0:-}" ] || [ -n "${GIT_CONFIG_VALUE_0:-}" ]; then
    echo "expected GIT_CONFIG_KEY_0 and GIT_CONFIG_VALUE_0 to be cleared" >&2
    exit 99
  fi
  if [ -n "${GIT_DIR:-}" ] || [ -n "${GIT_WORK_TREE:-}" ]; then
    echo "expected GIT_DIR and GIT_WORK_TREE to be cleared" >&2
    exit 99
  fi
  if [ "${GIT_TERMINAL_PROMPT:-}" != "0" ]; then
    echo "expected GIT_TERMINAL_PROMPT=0" >&2
    exit 99
  fi
  if [ "${GIT_ASKPASS:-}" != "false" ] || [ "${SSH_ASKPASS:-}" != "false" ]; then
    echo "expected askpass helpers to be disabled" >&2
    exit 99
  fi
  if [ "${SSH_ASKPASS_REQUIRE:-}" != "never" ]; then
    echo "expected SSH_ASKPASS_REQUIRE=never" >&2
    exit 99
  fi
  if [ "${GCM_INTERACTIVE:-}" != "never" ]; then
    echo "expected GCM_INTERACTIVE=never" >&2
    exit 99
  fi
  if [ "${GIT_SSH_COMMAND:-}" != "ssh -F /dev/null -oBatchMode=yes -oIdentityAgent=none" ]; then
    echo "expected GIT_SSH_COMMAND to ignore SSH config and agent" >&2
    exit 99
  fi
  if [ -n "${SSH_AUTH_SOCK:-}" ] || [ -n "${SSH_AGENT_PID:-}" ]; then
    echo "expected SSH agent variables to be cleared" >&2
    exit 99
  fi
  if [ "${HOME:-}" = "__ORIGINAL_HOME__" ] || [ "${USERPROFILE:-}" = "__ORIGINAL_HOME__" ]; then
    echo "expected HOME and USERPROFILE to be isolated from the real home directory" >&2
    exit 99
  fi
  if [ "${XDG_CONFIG_HOME:-}" != "${HOME:-}" ]; then
    echo "expected XDG_CONFIG_HOME to match HOME" >&2
    exit 99
  fi
  if [ "$pwd_path" = "__TMP_WORKTREE__" ]; then
    echo "unexpected repo-local cwd" >&2
    exit 99
  fi
  if [ "${4:-}" != "https://example.com/org/repo.git" ]; then
    echo "unexpected upstream: ${4:-}" >&2
    exit 99
  fi

  printf '__COMMIT_100__\trefs/tags/1.0.0^{}\n'
  exit 0
fi

exec "__REAL_GIT__" "$@"
EOF
perl -0pi -e "s|__REAL_GIT__|$real_git|g; s|__TMP_WORKTREE__|$upstream_rewrite_disabled_dir/tmp-worktree|g; s|__COMMIT_100__|$commit_100|g; s|__ORIGINAL_HOME__|$HOME|g" "$upstream_rewrite_disabled_dir/bin/git"
chmod +x "$upstream_rewrite_disabled_dir/bin/git"
upstream_rewrite_disabled_output="$(
  PATH="$upstream_rewrite_disabled_dir/bin:$PATH" \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="url.file:///tmp/private.insteadOf" \
    GIT_CONFIG_VALUE_0="https://example.com/org/repo.git" \
    GIT_CONFIG_PARAMETERS="'url.file:///tmp/private.insteadOf=https://example.com/org/repo.git'" \
    GIT_DIR="$upstream_rewrite_disabled_dir/tmp-worktree/.git" \
    GIT_WORK_TREE="$upstream_rewrite_disabled_dir/tmp-worktree" \
    GIT_TERMINAL_PROMPT=1 \
    GIT_ASKPASS=/bin/echo \
    SSH_ASKPASS=/bin/echo \
    SSH_ASKPASS_REQUIRE=force \
    GCM_INTERACTIVE=always \
    GIT_SSH_COMMAND="ssh -oBatchMode=no" \
    run_report "$upstream_rewrite_disabled_dir/tmp-worktree" --json
)"
assert_contains "$upstream_rewrite_disabled_output" '"status": "current"'
assert_not_contains "$upstream_rewrite_disabled_output" "expected GIT_CONFIG_NOSYSTEM=1"
assert_not_contains "$upstream_rewrite_disabled_output" "expected GIT_CONFIG_SYSTEM=/dev/null"
assert_not_contains "$upstream_rewrite_disabled_output" "expected GIT_CONFIG_GLOBAL=/dev/null"
assert_not_contains "$upstream_rewrite_disabled_output" "expected GIT_CONFIG_COUNT=0"
assert_not_contains "$upstream_rewrite_disabled_output" "expected GIT_CONFIG_PARAMETERS to be cleared"
assert_not_contains "$upstream_rewrite_disabled_output" "expected GIT_CONFIG_KEY_0 and GIT_CONFIG_VALUE_0 to be cleared"
assert_not_contains "$upstream_rewrite_disabled_output" "expected GIT_DIR and GIT_WORK_TREE to be cleared"
assert_not_contains "$upstream_rewrite_disabled_output" "expected GIT_TERMINAL_PROMPT=0"
assert_not_contains "$upstream_rewrite_disabled_output" "expected askpass helpers to be disabled"
assert_not_contains "$upstream_rewrite_disabled_output" "expected SSH_ASKPASS_REQUIRE=never"
assert_not_contains "$upstream_rewrite_disabled_output" "expected GCM_INTERACTIVE=never"
assert_not_contains "$upstream_rewrite_disabled_output" "expected GIT_SSH_COMMAND to ignore SSH config and agent"
assert_not_contains "$upstream_rewrite_disabled_output" "expected SSH agent variables to be cleared"
assert_not_contains "$upstream_rewrite_disabled_output" "expected HOME and USERPROFILE to be isolated from the real home directory"
assert_not_contains "$upstream_rewrite_disabled_output" "expected XDG_CONFIG_HOME to match HOME"
assert_not_contains "$upstream_rewrite_disabled_output" "unexpected repo-local cwd"
assert_not_contains "$upstream_rewrite_disabled_output" "unexpected upstream:"

cat >"$upstream_dir/swiftui-pro/SKILL.md" <<'SKILL'
---
name: swiftui-pro
description: Fixture 2.0.0-beta.1 skill.
---

# SwiftUI Pro
SKILL
git_commit "$upstream_dir" "beta skill"
git -C "$upstream_dir" tag 2.0.0-beta.1
commit_200_beta_1="$(git -C "$upstream_dir" rev-parse 2.0.0-beta.1^{})"

cat >"$upstream_dir/swiftui-pro/SKILL.md" <<'SKILL'
---
name: swiftui-pro
description: Fixture 2.0.0-beta.2 skill.
---

# SwiftUI Pro
SKILL
git_commit "$upstream_dir" "beta skill update"
git -C "$upstream_dir" tag 2.0.0-beta.2
commit_200_beta_2="$(git -C "$upstream_dir" rev-parse 2.0.0-beta.2^{})"

write_fixture_registry "$fixture_dir" "2.0.0-beta.1" "$commit_200_beta_1"
prerelease_default_json="$(run_report "$fixture_dir" --json)"
assert_contains "$prerelease_default_json" '"status": "current"'
assert_contains "$prerelease_default_json" '"update_required": false'
assert_contains "$prerelease_default_json" '"status_detail": "latest stable tag is older than pinned prerelease; rerun with --include-prerelease to compare prereleases"'

prerelease_full_json="$(run_report "$fixture_dir" --json --include-prerelease)"
assert_contains "$prerelease_full_json" '"status": "stale"'
assert_contains "$prerelease_full_json" '"tag": "2.0.0-beta.2"'
assert_contains "$prerelease_full_json" '"update_required": true'

git -C "$upstream_dir" tag release-2026-07-05 "$commit_200_beta_2"
write_fixture_registry "$fixture_dir" "release-2026-07-05" "$commit_200_beta_2"
non_release_pin_json="$(run_report "$fixture_dir" --json)"
assert_contains "$non_release_pin_json" '"status": "uncomparable-tags"'
assert_contains "$non_release_pin_json" '"status_detail": "pinned tag is not a release-like version"'
assert_contains "$non_release_pin_json" '"update_required": false'

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
