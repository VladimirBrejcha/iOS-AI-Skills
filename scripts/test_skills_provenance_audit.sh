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

write_skill() {
  local root="$1"
  local id="$2"
  local name="${3:-$id}"
  local body="${4:-# $id}"

  mkdir -p "$root/$id"
  cat >"$root/$id/SKILL.md" <<SKILL
---
name: $name
description: Fixture skill $id.
---

$body
SKILL
}

run_audit() {
  local root="$1"
  shift

  ruby "$repo_root/scripts/skills_provenance_audit.rb" \
    --root "$root" \
    --registry "$root/skills.registry.yaml" \
    --provenance "$root/provenance.sources.yaml" \
    "$@"
}

fixture_dir="$tmp_dir/fixture"
upstream_dir="$tmp_dir/upstreams"
mkdir -p "$fixture_dir" "$upstream_dir/public-source/skills/external-copy"

write_skill "$fixture_dir" "external-copy" "external-copy" "# External Copy"
write_skill "$fixture_dir" "unregistered-copy" "unregistered-copy" "# Unregistered Copy"
write_skill "$fixture_dir" "candidate-copy" "candidate-copy" "# Candidate Copy"
write_skill "$fixture_dir" "local-fork-copy" "local-fork-copy" "# Local Fork Copy"
write_skill "$fixture_dir" "local-owned" "local-owned" "# Local Owned"
write_skill "$fixture_dir" "duplicate-a" "duplicate-skill" "# Duplicate"
mkdir -p "$fixture_dir/duplicate-b"
cp "$fixture_dir/duplicate-a/SKILL.md" "$fixture_dir/duplicate-b/SKILL.md"

cp "$fixture_dir/external-copy/SKILL.md" "$upstream_dir/public-source/skills/external-copy/SKILL.md"

cat >"$fixture_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
status: active-partial
skills:
  - id: external-copy
    status: active
    source:
      type: registry-local
      path: external-copy
  - id: local-owned
    status: active
    source:
      type: registry-local
      path: local-owned
YAML

cat >"$fixture_dir/provenance.sources.yaml" <<'YAML'
schema_version: 0.1
observed_at: "2026-07-08"
sources:
  - id: public-source
    url: https://github.com/example/public-source.git
    observed_commit: "1111111111111111111111111111111111111111"
    skills:
      - local_id: external-copy
        upstream_path: skills/external-copy
        status: confirmed
        confidence: high
        match: exact-observed
        recommended_registry_source: external-git
      - local_id: unregistered-copy
        upstream_path: skills/unregistered-copy
        status: derived
        confidence: high
        match: upstream-drift-observed
        recommended_registry_source: external-git
      - local_id: candidate-copy
        upstream_path: skills/candidate-copy
        status: candidate
        confidence: medium
        match: public-catalog-candidate
        recommended_registry_source: external-git
      - local_id: missing-local-skill
        upstream_path: skills/missing-local-skill
        status: confirmed
        confidence: high
        match: exact-observed
        recommended_registry_source: external-git
      - local_id: local-fork-copy
        upstream_path: skills/local-fork-copy
        status: derived
        confidence: high
        match: local-overlay-observed
        recommended_registry_source: registry-local
YAML

json_output="$(run_audit "$fixture_dir" --json --source-root "public-source=$upstream_dir/public-source")"
assert_contains "$json_output" '"registry_provenance_conflicts": 1'
assert_contains "$json_output" '"stale_provenance_entries": 1'
assert_contains "$json_output" '"unregistered_external_imports": 1'
assert_contains "$json_output" '"unregistered_local_fork_provenance": 1'
assert_contains "$json_output" '"unregistered_provenance_candidates": 1'
assert_contains "$json_output" '"duplicate_local_skill_content": 1'
assert_contains "$json_output" '"duplicate_skill_names": 1'
assert_contains "$json_output" '"status": "exact"'
assert_contains "$json_output" '"path": "[source-root:public-source]/skills/external-copy/SKILL.md"'
assert_contains "$json_output" '"message": "missing-local-skill has checked-in provenance but no local skill folder"'
assert_contains "$json_output" '"message": "local-fork-copy has reviewed local-fork provenance but is not registry-covered"'
assert_not_contains "$json_output" "$tmp_dir"

markdown_output="$(run_audit "$fixture_dir" --markdown)"
assert_contains "$markdown_output" "# Skills Provenance Audit"
assert_contains "$markdown_output" "external-copy is registry-local but has reviewed external provenance"
assert_contains "$markdown_output" "missing-local-skill has checked-in provenance but no local skill folder"
assert_contains "$markdown_output" "unregistered-copy appears copied or derived from an external source"
assert_contains "$markdown_output" "local-fork-copy has reviewed local-fork provenance but is not registry-covered"
assert_contains "$markdown_output" "candidate-copy has an unresolved public provenance candidate"
assert_contains "$markdown_output" "duplicate-a, duplicate-b"
assert_not_contains "$markdown_output" "$tmp_dir"

conflict_failure="$(expect_failure run_audit "$fixture_dir" --json --fail-on-registry-conflict)"
assert_contains "$conflict_failure" "registry provenance conflicts found"
assert_contains "$conflict_failure" '"registry_provenance_conflicts": 1'

import_failure="$(expect_failure run_audit "$fixture_dir" --json --fail-on-unregistered-import)"
assert_contains "$import_failure" "unregistered external imports found"
assert_contains "$import_failure" '"unregistered_external_imports": 1'

non_mapping_dir="$tmp_dir/non-mapping"
mkdir -p "$non_mapping_dir"
write_skill "$non_mapping_dir" "example-skill"
cat >"$non_mapping_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
skills: []
YAML
cat >"$non_mapping_dir/provenance.sources.yaml" <<'YAML'
schema_version: 0.1
sources:
  - id: bad-source
    url: https://github.com/example/public-source.git
    skills:
      - not-a-mapping
YAML

non_mapping_output="$(expect_failure run_audit "$non_mapping_dir" --json)"
assert_contains "$non_mapping_output" "bad-source: skill entry #1 must be a mapping"
assert_not_contains "$non_mapping_output" "$tmp_dir"

invalid_yaml_dir="$tmp_dir/invalid-yaml"
mkdir -p "$invalid_yaml_dir"
write_skill "$invalid_yaml_dir" "example-skill"
cat >"$invalid_yaml_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
skills: []
YAML
cat >"$invalid_yaml_dir/provenance.sources.yaml" <<'YAML'
sources: [
YAML

invalid_yaml_output="$(expect_failure run_audit "$invalid_yaml_dir" --json)"
assert_contains "$invalid_yaml_output" "is not valid YAML"
assert_not_contains "$invalid_yaml_output" "$tmp_dir"

invalid_frontmatter_dir="$tmp_dir/invalid-frontmatter"
mkdir -p "$invalid_frontmatter_dir"
mkdir -p "$invalid_frontmatter_dir/example-skill"
cat >"$invalid_frontmatter_dir/example-skill/SKILL.md" <<'SKILL'
---
name: example-skill
description: "unterminated
---

# Example Skill
SKILL
cat >"$invalid_frontmatter_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
skills: []
YAML
cat >"$invalid_frontmatter_dir/provenance.sources.yaml" <<'YAML'
schema_version: 0.1
sources: []
YAML

invalid_frontmatter_output="$(run_audit "$invalid_frontmatter_dir" --json 2>&1)"
assert_contains "$invalid_frontmatter_output" "front matter is not valid YAML"
assert_not_contains "$invalid_frontmatter_output" "$tmp_dir"

bad_dir="$tmp_dir/bad"
mkdir -p "$bad_dir"
write_skill "$bad_dir" "example-skill"
cat >"$bad_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
skills: []
YAML
cat >"$bad_dir/provenance.sources.yaml" <<'YAML'
schema_version: 0.1
sources:
  - id: bad-source
    url: file:///Users/alice/private-source
    skills:
      - local_id: example-skill
        upstream_path: ../bad
        status: confirmed
        confidence: high
        match: exact-observed
        recommended_registry_source: external-git
YAML

bad_output="$(expect_failure run_audit "$bad_dir" --json)"
assert_contains "$bad_output" "bad-source: source url must be a public https URL"
assert_contains "$bad_output" "bad-source: example-skill: upstream_path must be a safe relative path"
assert_not_contains "$bad_output" "/Users/alice"

echo "skills_provenance_audit test ok"
