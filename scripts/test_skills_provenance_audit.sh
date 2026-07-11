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
write_skill "$fixture_dir" "drifted-external-copy" "drifted-external-copy" "# Drifted Local Reviewed Copy"
write_skill "$fixture_dir" "alias-copy" "alias-copy" "# Registry Alias Copy"
write_skill "$fixture_dir" "external-fork-copy" "external-fork-copy" "# External Registered Local Fork Copy"
write_skill "$fixture_dir" "unregistered-copy" "unregistered-copy" "# Unregistered Copy"
write_skill "$fixture_dir" "unknown-copy" "unknown-copy" "# Unknown Recommendation Copy"
write_skill "$fixture_dir" "missing-upstream-copy" "missing-upstream-copy" "# Missing Upstream Copy"
write_skill "$fixture_dir" "candidate-copy" "candidate-copy" "# Candidate Copy"
write_skill "$fixture_dir" "local-fork-copy" "local-fork-copy" "# Local Fork Copy"
write_skill "$fixture_dir" "local-owned" "local-owned" "# Local Owned"
write_skill "$fixture_dir" "unresolved-external-copy" "unresolved-external-copy" "# Unresolved External Copy"
write_skill "$fixture_dir" "duplicate-a" "duplicate-skill" "# Duplicate"
mkdir -p "$fixture_dir/duplicate-b"
cp "$fixture_dir/duplicate-a/SKILL.md" "$fixture_dir/duplicate-b/SKILL.md"

for skill_id in external-copy alias-copy external-fork-copy unregistered-copy unknown-copy candidate-copy local-fork-copy unresolved-external-copy; do
  mkdir -p "$upstream_dir/public-source/skills/$skill_id"
  cp "$fixture_dir/$skill_id/SKILL.md" "$upstream_dir/public-source/skills/$skill_id/SKILL.md"
done
mkdir -p "$upstream_dir/public-source/skills/drifted-external-copy"
cat >"$upstream_dir/public-source/skills/drifted-external-copy/SKILL.md" <<'SKILL'
---
name: drifted-external-copy
description: Upstream copy rewritten with unrelated words.
---

# Upstream unrelated source text alpha beta gamma delta epsilon zeta eta theta
SKILL

cat >"$fixture_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
status: active-partial
skills:
  - id: external-copy
    status: active
    source:
      type: registry-local
      path: external-copy
  - id: drifted-external-copy
    status: active
    source:
      type: registry-local
      path: drifted-external-copy
  - id: missing-registry-source
    status: active
    source:
      type: registry-local
      path: missing-registry-source
  - id: registry-alias-copy
    status: active
    source:
      type: registry-local
      path: alias-copy
  - id: external-fork-copy
    status: active
    source:
      type: external-git
      path: external-fork-copy
  - id: local-owned
    status: active
    source:
      type: registry-local
      path: local-owned
  - id: unresolved-external-copy
    status: needs-source-review
    source:
      type: unresolved-local
      path: unresolved-external-copy
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
      - local_id: drifted-external-copy
        upstream_path: skills/drifted-external-copy
        status: confirmed
        confidence: high
        match: exact-observed
        recommended_registry_source: external-git
      - local_id: alias-copy
        upstream_path: skills/alias-copy
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
      - local_id: unknown-copy
        upstream_path: skills/unknown-copy
        status: derived
        confidence: high
        match: upstream-drift-observed
      - local_id: external-fork-copy
        upstream_path: skills/external-fork-copy
        status: derived
        confidence: high
        match: local-overlay-observed
        recommended_registry_source: registry-local
      - local_id: missing-upstream-copy
        upstream_path: skills/missing-upstream-copy
        status: confirmed
        confidence: high
        match: exact-observed
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
      - local_id: unresolved-external-copy
        upstream_path: skills/unresolved-external-copy
        status: confirmed
        confidence: high
        match: exact-observed
        recommended_registry_source: external-git
YAML

json_output="$(run_audit "$fixture_dir" --json --source-root "public-source=$upstream_dir/public-source")"
assert_contains "$json_output" '"registry_provenance_conflicts": 3'
assert_contains "$json_output" '"registry_external_local_fork_conflicts": 1'
assert_contains "$json_output" '"registry_external_local_folders": 1'
assert_contains "$json_output" '"registry_local_source_missing": 1'
assert_contains "$json_output" '"stale_provenance_entries": 1'
assert_contains "$json_output" '"unregistered_external_imports": 3'
assert_contains "$json_output" '"unregistered_local_fork_provenance": 1'
assert_contains "$json_output" '"unregistered_provenance_candidates": 1'
assert_contains "$json_output" '"unresolved_provenance_recommendations": 1'
assert_contains "$json_output" '"source_root_missing": 1'
assert_contains "$json_output" '"source_root_mismatches": 1'
assert_contains "$json_output" '"duplicate_local_skill_content": 1'
assert_contains "$json_output" '"duplicate_skill_names": 1'
assert_contains "$json_output" '"status": "exact"'
assert_contains "$json_output" '"path": "[source-root:public-source]/skills/external-copy/SKILL.md"'
assert_contains "$json_output" '"message": "alias-copy is registry-local but has reviewed external provenance"'
assert_contains "$json_output" '"message": "drifted-external-copy is registry-local but has reviewed external provenance"'
assert_contains "$json_output" '"message": "drifted-external-copy no longer resembles the provided source-root copy"'
assert_contains "$json_output" '"message": "external-fork-copy is external-git but has reviewed local-fork provenance"'
assert_contains "$json_output" '"message": "external-fork-copy has a local skill folder but registry source is external-git"'
assert_contains "$json_output" '"message": "missing-upstream-copy points at a missing source-root SKILL.md"'
assert_contains "$json_output" '"message": "missing-registry-source points at missing local source path missing-registry-source"'
assert_contains "$json_output" '"message": "missing-local-skill has checked-in provenance but no local skill folder"'
assert_contains "$json_output" '"message": "local-fork-copy has reviewed local-fork provenance but is not registry-covered"'
assert_contains "$json_output" '"message": "unresolved-external-copy has reviewed external provenance but remains unresolved-local"'
assert_contains "$json_output" '"message": "unknown-copy has reviewed provenance without a registry source recommendation"'
assert_not_contains "$json_output" '"message": "alias-copy appears copied or derived from an external source but is not registry-covered"'
assert_not_contains "$json_output" '"message": "unknown-copy is not registry-covered and has no checked-in provenance candidate"'
assert_not_contains "$json_output" "$tmp_dir"

alias_registry_output="$(
  JSON_INPUT="$json_output" ruby -rjson -e '
    payload = JSON.parse(ENV.fetch("JSON_INPUT"))
    skill = payload.fetch("skills").find { |entry| entry.fetch("id") == "alias-copy" }
    puts [skill.fetch("registry_source_type"), skill.fetch("registry_source_path")].join(" ")
  '
)"
assert_contains "$alias_registry_output" "registry-local alias-copy"

markdown_output="$(run_audit "$fixture_dir" --markdown --source-root "public-source=$upstream_dir/public-source")"
assert_contains "$markdown_output" "# Skills Provenance Audit"
assert_contains "$markdown_output" "alias-copy is registry-local but has reviewed external provenance"
assert_contains "$markdown_output" "external-copy is registry-local but has reviewed external provenance"
assert_contains "$markdown_output" "external-fork-copy is external-git but has reviewed local-fork provenance"
assert_contains "$markdown_output" "external-fork-copy has a local skill folder but registry source is external-git"
assert_contains "$markdown_output" "missing-registry-source points at missing local source path missing-registry-source"
assert_contains "$markdown_output" "missing-local-skill has checked-in provenance but no local skill folder"
assert_contains "$markdown_output" "unregistered-copy appears copied or derived from an external source"
assert_contains "$markdown_output" "missing-upstream-copy points at a missing source-root SKILL.md"
assert_contains "$markdown_output" "drifted-external-copy no longer resembles the provided source-root copy"
assert_contains "$markdown_output" "local-fork-copy has reviewed local-fork provenance but is not registry-covered"
assert_contains "$markdown_output" "unresolved-external-copy has reviewed external provenance but remains unresolved-local"
assert_contains "$markdown_output" "unknown-copy has reviewed provenance without a registry source recommendation"
assert_contains "$markdown_output" "candidate-copy has an unresolved public provenance candidate"
assert_contains "$markdown_output" "duplicate-a, duplicate-b"
assert_not_contains "$markdown_output" "$tmp_dir"

conflict_failure="$(expect_failure run_audit "$fixture_dir" --json --fail-on-registry-conflict)"
assert_contains "$conflict_failure" "registry provenance conflicts found"
assert_contains "$conflict_failure" "registry external/local-fork conflicts found"
assert_contains "$conflict_failure" '"registry_provenance_conflicts": 3'
assert_contains "$conflict_failure" '"registry_external_local_fork_conflicts": 1'

import_failure="$(expect_failure run_audit "$fixture_dir" --json --fail-on-unregistered-import)"
assert_contains "$import_failure" "unregistered external imports found"
assert_contains "$import_failure" "unregistered local-fork provenance found"
assert_contains "$import_failure" '"unregistered_external_imports": 3'
assert_contains "$import_failure" '"unregistered_local_fork_provenance": 1'

non_mapping_source_dir="$tmp_dir/non-mapping-source"
mkdir -p "$non_mapping_source_dir"
write_skill "$non_mapping_source_dir" "example-skill"
cat >"$non_mapping_source_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
skills: []
YAML
cat >"$non_mapping_source_dir/provenance.sources.yaml" <<'YAML'
schema_version: 0.1
sources:
  - not-a-mapping
YAML

non_mapping_source_output="$(expect_failure run_audit "$non_mapping_source_dir" --json)"
assert_contains "$non_mapping_source_output" "source entry #1 must be a mapping"
assert_not_contains "$non_mapping_source_output" "$tmp_dir"

missing_source_id_dir="$tmp_dir/missing-source-id"
mkdir -p "$missing_source_id_dir" "$missing_source_id_dir/source-roots"
write_skill "$missing_source_id_dir" "example-skill"
cat >"$missing_source_id_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
skills: []
YAML
cat >"$missing_source_id_dir/provenance.sources.yaml" <<'YAML'
schema_version: 0.1
sources:
  - url: https://github.com/example/public-source.git
    skills:
      - local_id: example-skill
        upstream_path: skills/example-skill
        status: confirmed
        confidence: high
        match: exact-observed
        recommended_registry_source: external-git
YAML

missing_source_id_output="$(expect_failure run_audit "$missing_source_id_dir" --json --source-root-dir "$missing_source_id_dir/source-roots")"
assert_contains "$missing_source_id_output" "provenance source id must be a safe path segment"
assert_not_contains "$missing_source_id_output" "TypeError"
assert_not_contains "$missing_source_id_output" "$tmp_dir"

unsafe_source_id_dir="$tmp_dir/unsafe-source-id"
mkdir -p "$unsafe_source_id_dir/source-roots" "$tmp_dir/other/skills/example-skill"
write_skill "$unsafe_source_id_dir" "example-skill"
cp "$unsafe_source_id_dir/example-skill/SKILL.md" "$tmp_dir/other/skills/example-skill/SKILL.md"
cat >"$unsafe_source_id_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
skills: []
YAML
cat >"$unsafe_source_id_dir/provenance.sources.yaml" <<'YAML'
schema_version: 0.1
sources:
  - id: ../other
    url: https://github.com/example/public-source.git
    skills:
      - local_id: example-skill
        upstream_path: skills/example-skill
        status: confirmed
        confidence: high
        match: exact-observed
        recommended_registry_source: external-git
YAML

unsafe_source_id_output="$(expect_failure run_audit "$unsafe_source_id_dir" --json --source-root-dir "$unsafe_source_id_dir/source-roots")"
assert_contains "$unsafe_source_id_output" "provenance source id must be a safe path segment"
assert_not_contains "$unsafe_source_id_output" '"status": "exact"'
assert_not_contains "$unsafe_source_id_output" "$tmp_dir"

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

non_list_skills_dir="$tmp_dir/non-list-skills"
mkdir -p "$non_list_skills_dir"
write_skill "$non_list_skills_dir" "example-skill"
cat >"$non_list_skills_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
skills: []
YAML
cat >"$non_list_skills_dir/provenance.sources.yaml" <<'YAML'
schema_version: 0.1
sources:
  - id: bad-source
    url: https://github.com/example/public-source.git
    skills: not-a-list
YAML

non_list_skills_output="$(expect_failure run_audit "$non_list_skills_dir" --json)"
assert_contains "$non_list_skills_output" "bad-source: skills must be a list"
assert_not_contains "$non_list_skills_output" "undefined method"
assert_not_contains "$non_list_skills_output" "$tmp_dir"

path_like_local_id_dir="$tmp_dir/path-like-local-id"
mkdir -p "$path_like_local_id_dir"
write_skill "$path_like_local_id_dir" "example-skill"
cat >"$path_like_local_id_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
skills: []
YAML
cat >"$path_like_local_id_dir/provenance.sources.yaml" <<'YAML'
schema_version: 0.1
sources:
  - id: bad-source
    url: https://github.com/example/public-source.git
    skills:
      - local_id: /tmp/private-skill
        upstream_path: skills/example-skill
        status: confirmed
        confidence: high
        match: exact-observed
        recommended_registry_source: external-git
YAML

path_like_local_id_output="$(expect_failure run_audit "$path_like_local_id_dir" --json)"
assert_contains "$path_like_local_id_output" "bad-source: skill local_id must be a safe top-level skill id"
assert_not_contains "$path_like_local_id_output" "/tmp/private-skill"
assert_not_contains "$path_like_local_id_output" "$tmp_dir"

top_level_registry_dir="$tmp_dir/top-level-registry"
mkdir -p "$top_level_registry_dir"
write_skill "$top_level_registry_dir" "example-skill"
cat >"$top_level_registry_dir/skills.registry.yaml" <<'YAML'
- not-a-mapping
YAML
cat >"$top_level_registry_dir/provenance.sources.yaml" <<'YAML'
schema_version: 0.1
sources: []
YAML

top_level_registry_output="$(expect_failure run_audit "$top_level_registry_dir" --json)"
assert_contains "$top_level_registry_output" "top level must be a mapping"
assert_not_contains "$top_level_registry_output" "TypeError"
assert_not_contains "$top_level_registry_output" "$tmp_dir"

top_level_provenance_dir="$tmp_dir/top-level-provenance"
mkdir -p "$top_level_provenance_dir"
write_skill "$top_level_provenance_dir" "example-skill"
cat >"$top_level_provenance_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
skills: []
YAML
cat >"$top_level_provenance_dir/provenance.sources.yaml" <<'YAML'
- not-a-mapping
YAML

top_level_provenance_output="$(expect_failure run_audit "$top_level_provenance_dir" --json)"
assert_contains "$top_level_provenance_output" "top level must be a mapping"
assert_not_contains "$top_level_provenance_output" "TypeError"
assert_not_contains "$top_level_provenance_output" "$tmp_dir"

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

space_yaml_dir="$tmp_dir/path with space"
mkdir -p "$space_yaml_dir"
write_skill "$space_yaml_dir" "example-skill"
cat >"$space_yaml_dir/skills.registry.yaml" <<'YAML'
schema_version: 0.1
skills: []
YAML
cat >"$space_yaml_dir/provenance.sources.yaml" <<'YAML'
sources: [
YAML

space_yaml_output="$(expect_failure run_audit "$space_yaml_dir" --json)"
assert_contains "$space_yaml_output" "is not valid YAML"
assert_not_contains "$space_yaml_output" "path with space"
assert_not_contains "$space_yaml_output" "$tmp_dir"

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
