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

expect_failure() {
  local output
  if output="$("$@" 2>&1)"; then
    echo "expected command to fail: $*" >&2
    exit 1
  fi

  printf '%s' "$output"
}

write_skill() {
  local dir="$1"
  local name="$2"
  local description="$3"

  mkdir -p "$dir"
  cat >"$dir/SKILL.md" <<SKILL
---
name: $name
description: $description
---

# $name
SKILL
}

write_example_profile() {
  local root="$1"

  mkdir -p "$root/profiles/machine"
  cat >"$root/profiles/machine/example-local-skills.yaml" <<'YAML'
schema_version: 0.1
profile:
  id: example-local-agent-skills
consumer_roots:
  agents_user:
    path: ~/.agents/skills
    adapter: symlink
selected_skills:
  - skill_id: example-skill
    expose_to:
      - agents_user
    state: active
    consumer_overrides:
      agents_user:
        adapter: manager-copy
        status: proven-manager-copy
  - skill_id: manual-review-skill
    expose_to:
      - agents_user
    state: active
  - skill_id: external-skill
    expose_to:
      - agents_user
    state: active
    consumer_overrides:
      agents_user:
        adapter: manager-copy
        status: proven-manager-copy
YAML
}

write_registry_local_digest() {
  local root="$1"
  local example_digest
  local manual_digest

  example_digest="$(ruby -rdigest -rfind -rpathname -e '
    dir = ARGV.fetch(0)
    digest = Digest::SHA256.new
    files = []
    Find.find(dir) do |entry|
      name = File.basename(entry)
      if File.directory?(entry) && [".git", "__pycache__", "__pypackages__"].include?(name)
        Find.prune
        next
      end
      next if File.directory?(entry)
      next if name == "metadata.json"

      files << entry
    end
    files.sort.each do |file|
      relative = Pathname.new(file).relative_path_from(Pathname.new(dir)).to_s
      digest.update(relative)
      digest.update("\0")
      digest.update(format("%03o", File.stat(file).mode & 0o111))
      digest.update("\0")
      digest.update(File.binread(file))
      digest.update("\0")
    end
    puts digest.hexdigest
  ' "$root/example-skill")"

  manual_digest="$(ruby -rdigest -rfind -rpathname -e '
    dir = ARGV.fetch(0)
    digest = Digest::SHA256.new
    files = []
    Find.find(dir) do |entry|
      name = File.basename(entry)
      if File.directory?(entry) && [".git", "__pycache__", "__pypackages__"].include?(name)
        Find.prune
        next
      end
      next if File.directory?(entry)
      next if name == "metadata.json"

      files << entry
    end
    files.sort.each do |file|
      relative = Pathname.new(file).relative_path_from(Pathname.new(dir)).to_s
      digest.update(relative)
      digest.update("\0")
      digest.update(format("%03o", File.stat(file).mode & 0o111))
      digest.update("\0")
      digest.update(File.binread(file))
      digest.update("\0")
    end
    puts digest.hexdigest
  ' "$root/manual-review-skill")"

  ruby -ryaml -e '
    path = ARGV.fetch(0)
    example_digest = ARGV.fetch(1)
    manual_digest = ARGV.fetch(2)
    data = YAML.safe_load(File.read(path), aliases: false)
    example = data.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }
    example["digest_sha256"] = example_digest
    manual = data.fetch("skills").find { |skill| skill.fetch("id") == "manual-review-skill" }
    manual["digest_sha256"] = manual_digest
    File.write(path, data.to_yaml)
  ' "$root/skills.lock.yaml" "$example_digest" "$manual_digest"
}

write_ok_fixture() {
  local root="$1"

  mkdir -p "$root/docs"
  write_skill "$root/example-skill" "example-skill" "Example fixture skill."
  write_skill "$root/manual-review-skill" "manual-review-skill" "Manual review fixture skill."
  write_example_profile "$root"

  cat >"$root/skills.registry.yaml" <<'YAML'
schema_version: 0.1
status: active-partial
registry:
  id: fixture-skills
  name: Fixture Skills
  manager_source: fixture/skills
skills:
  - id: example-skill
    status: active
    source:
      type: registry-local
      path: example-skill
    exported_names:
      - example-skill
    clients:
      codex: supported
      claude: planned
    scopes:
      - machine
      - repo
    update_policy: internal-reviewed
  - id: manual-review-skill
    status: active
    source:
      type: registry-local
      path: manual-review-skill
    exported_names:
      - manual-review-skill
    clients:
      codex: supported
      claude: planned
    scopes:
      - machine
      - repo
    update_policy: internal-reviewed
  - id: external-skill
    status: active
    source:
      type: external-git
      url: https://github.com/example/agent-skill.git
      path: external-skill
      pinned_tag: 1.2.3
      observed_commit: "1111111111111111111111111111111111111111"
      observed_at: "2026-07-02"
    exported_names:
      - external-skill
    clients:
      codex: supported
      claude: planned
    scopes:
      - machine
      - repo
    update_policy: external-reviewed
    catalog:
      description: External fixture skill awaiting import review.
YAML

  cat >"$root/skills.lock.yaml" <<'YAML'
schema_version: 0.1
skills:
  - id: example-skill
    source_type: registry-local
    path: example-skill
    digest_sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    exported_names:
      - example-skill
  - id: manual-review-skill
    source_type: registry-local
    path: manual-review-skill
    digest_sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
    exported_names:
      - manual-review-skill
  - id: external-skill
    source_type: external-git
    url: https://github.com/example/agent-skill.git
    path: external-skill
    pinned_tag: 1.2.3
    observed_commit: "1111111111111111111111111111111111111111"
    exported_names:
      - external-skill
YAML

  write_registry_local_digest "$root"
}

run_catalog() {
  local root="$1"
  shift

  ruby "$repo_root/scripts/skills_catalog.rb" \
    --registry "$root/skills.registry.yaml" \
    --lock "$root/skills.lock.yaml" \
    --json-output "$root/skills.catalog.json" \
    --markdown-output "$root/docs/skills-catalog.md" \
    "$@"
}

run_catalog_relative() {
  local root="$1"
  shift

  (
    cd "$root"
    ruby "$repo_root/scripts/skills_catalog.rb" \
      --registry "skills.registry.yaml" \
      --lock "skills.lock.yaml" \
      --json-output "skills.catalog.json" \
      --markdown-output "docs/skills-catalog.md" \
      "$@"
  )
}

ok_dir="$tmp_dir/ok"
write_ok_fixture "$ok_dir"
run_catalog "$ok_dir" --write
run_catalog "$ok_dir" --check

json_output="$(run_catalog "$ok_dir" --json)"
assert_contains "$json_output" '"id": "example-skill"'
assert_contains "$json_output" '"description": "Example fixture skill."'
assert_contains "$json_output" '"codex_global_command": "npx --yes skills@1.5.14 add fixture/skills --skill example-skill --agent codex --global --yes"'
assert_contains "$json_output" '"id": "manual-review-skill"'
assert_contains "$json_output" '"id": "external-skill"'
assert_contains "$json_output" '"pinned_tag": "1.2.3"'
assert_contains "$json_output" '"profiles/machine/example-local-skills.yaml"'

markdown_output="$(run_catalog "$ok_dir" --markdown)"
assert_contains "$markdown_output" "# Skills Catalog"
assert_contains "$markdown_output" "## Registry-Covered Skills"
assert_contains "$markdown_output" "## Installable Active Skills"
assert_contains "$markdown_output" "for the current reviewed example profile."

ruby -rjson -e '
  parsed = JSON.parse(File.read(ARGV.fetch(0)))
  raise "wrong schema" unless parsed.fetch("schema_version") == "0.1"
  raise "wrong skill count" unless parsed.fetch("skills").length == 3
  manual = parsed.fetch("skills").find { |skill| skill.fetch("id") == "manual-review-skill" }
  raise "manual-review skill should not emit install command" if manual.key?("install")
  external = parsed.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }
  raise "external should not emit install command" if external.key?("install")
' "$ok_dir/skills.catalog.json"

planned_state_dir="$tmp_dir/planned-state"
write_ok_fixture "$planned_state_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  selection = data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "example-skill" }
  selection["state"] = "planned"
  File.write(path, data.to_yaml)
' "$planned_state_dir/profiles/machine/example-local-skills.yaml"
run_catalog "$planned_state_dir" --write
ruby -rjson -e '
  parsed = JSON.parse(File.read(ARGV.fetch(0)))
  example = parsed.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }
  raise "planned skill should not emit install command" if example.key?("install")
' "$planned_state_dir/skills.catalog.json"

multi_export_dir="$tmp_dir/multi-export"
write_ok_fixture "$multi_export_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }["exported_names"] = ["example-skill", "alias-review"]
  File.write(path, data.to_yaml)
' "$multi_export_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }["exported_names"] = ["example-skill", "alias-review"]
  File.write(path, data.to_yaml)
' "$multi_export_dir/skills.lock.yaml"
run_catalog "$multi_export_dir" --write
ruby -rjson -e '
  parsed = JSON.parse(File.read(ARGV.fetch(0)))
  example = parsed.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }
  raise "multi-export skill should not emit install command" if example.key?("install")
' "$multi_export_dir/skills.catalog.json"

not_exposed_dir="$tmp_dir/not-exposed"
write_ok_fixture "$not_exposed_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  selection = data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "example-skill" }
  selection["expose_to"] = ["codex_legacy_user"]
  File.write(path, data.to_yaml)
' "$not_exposed_dir/profiles/machine/example-local-skills.yaml"
run_catalog "$not_exposed_dir" --write
ruby -rjson -e '
  parsed = JSON.parse(File.read(ARGV.fetch(0)))
  example = parsed.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }
  raise "non-exposed skill should not emit install command" if example.key?("install")
' "$not_exposed_dir/skills.catalog.json"

missing_profile_dir="$tmp_dir/missing-profile"
write_ok_fixture "$missing_profile_dir"
rm -rf "$missing_profile_dir/profiles"
run_catalog "$missing_profile_dir" --write
ruby -rjson -e '
  parsed = JSON.parse(File.read(ARGV.fetch(0)))
  example = parsed.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }
  raise "missing profile should suppress install command" if example.key?("install")
  source_files = parsed.fetch("registry").fetch("source_files")
  raise "missing profile should not emit example profile source file" if source_files.any? { |path| path.include?("example-local-skills.yaml") }
' "$missing_profile_dir/skills.catalog.json"

renamed_export_dir="$tmp_dir/renamed-export"
write_ok_fixture "$renamed_export_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }["exported_names"] = ["exported-example-skill"]
  File.write(path, data.to_yaml)
' "$renamed_export_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }["exported_names"] = ["exported-example-skill"]
  File.write(path, data.to_yaml)
' "$renamed_export_dir/skills.lock.yaml"
run_catalog "$renamed_export_dir" --write
ruby -rjson -e '
  parsed = JSON.parse(File.read(ARGV.fetch(0)))
  example = parsed.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }
  raise "renamed export should stay manual review for install commands" if example.key?("install")
' "$renamed_export_dir/skills.catalog.json"

missing_name_dir="$tmp_dir/missing-name"
write_ok_fixture "$missing_name_dir"
ruby -e '
  path = ARGV.fetch(0)
  lines = File.readlines(path)
  File.write(path, lines.reject { |line| line.start_with?("name: ") }.join)
' "$missing_name_dir/example-skill/SKILL.md"
write_registry_local_digest "$missing_name_dir"
missing_name_output="$(expect_failure run_catalog "$missing_name_dir" --json)"
assert_contains "$missing_name_output" "example-skill: registry-local SKILL.md front matter name is required"

missing_local_description_dir="$tmp_dir/missing-local-description"
write_ok_fixture "$missing_local_description_dir"
ruby -e '
  path = ARGV.fetch(0)
  lines = File.readlines(path)
  File.write(path, lines.reject { |line| line.start_with?("description: ") }.join)
' "$missing_local_description_dir/example-skill/SKILL.md"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }["catalog"] = {
    "description" => "Registry override should not satisfy local front matter."
  }
  File.write(path, data.to_yaml)
' "$missing_local_description_dir/skills.registry.yaml"
write_registry_local_digest "$missing_local_description_dir"
missing_local_description_output="$(expect_failure run_catalog "$missing_local_description_dir" --json)"
assert_contains "$missing_local_description_output" "example-skill: registry-local SKILL.md front matter description is required"

ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("Example fixture skill.", "Changed fixture skill.")
  File.write(path, text)
' "$ok_dir/skills.catalog.json"
drift_output="$(expect_failure run_catalog "$ok_dir" --check)"
assert_contains "$drift_output" "catalog drift"

missing_description_dir="$tmp_dir/missing-description"
write_ok_fixture "$missing_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.delete("catalog")
  File.write(path, data.to_yaml)
' "$missing_description_dir/skills.registry.yaml"
missing_description_output="$(expect_failure run_catalog "$missing_description_dir" --json)"
assert_contains "$missing_description_output" "external-skill: catalog description is required"

unpinned_dir="$tmp_dir/unpinned"
write_ok_fixture "$unpinned_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  source = data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")
  source.delete("pinned_tag")
  File.write(path, data.to_yaml)
' "$unpinned_dir/skills.registry.yaml"
unpinned_output="$(expect_failure run_catalog "$unpinned_dir" --json)"
assert_contains "$unpinned_output" "external-skill: external-git source.pinned_tag is required"

invalid_tag_dir="$tmp_dir/invalid-tag"
write_ok_fixture "$invalid_tag_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  source = data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")
  source["pinned_tag"] = "refs/heads/main"
  File.write(path, data.to_yaml)
' "$invalid_tag_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  entry = data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }
  entry["pinned_tag"] = "refs/heads/main"
  File.write(path, data.to_yaml)
' "$invalid_tag_dir/skills.lock.yaml"
invalid_tag_output="$(expect_failure run_catalog "$invalid_tag_dir" --json)"
assert_contains "$invalid_tag_output" "external-skill: external-git source.pinned_tag must be an exact tag name"
assert_contains "$invalid_tag_output" "external-skill: lock pinned_tag must be an exact tag name"

private_path_dir="$tmp_dir/private-path"
write_ok_fixture "$private_path_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  source = data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")
  source["url"] = "file:///Users/alice/private-skill"
  File.write(path, data.to_yaml)
' "$private_path_dir/skills.registry.yaml"
private_path_output="$(expect_failure run_catalog "$private_path_dir" --json)"
assert_contains "$private_path_output" "external-skill: external-git source.url must be a public, credential-free URL"

unsafe_description_dir="$tmp_dir/unsafe-description"
write_ok_fixture "$unsafe_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses /Users/alice/private."
  File.write(path, data.to_yaml)
' "$unsafe_description_dir/skills.registry.yaml"
unsafe_description_output="$(expect_failure run_catalog "$unsafe_description_dir" --json)"
assert_contains "$unsafe_description_output" "generated catalog JSON contains macOS user path"

relative_paths_dir="$tmp_dir/relative-paths"
write_ok_fixture "$relative_paths_dir"
run_catalog_relative "$relative_paths_dir" --write
run_catalog_relative "$relative_paths_dir" --check
relative_json_output="$(run_catalog_relative "$relative_paths_dir" --json)"
assert_contains "$relative_json_output" '"source_files": ['
assert_contains "$relative_json_output" '"skills.registry.yaml"'
assert_contains "$relative_json_output" '"skills.lock.yaml"'
assert_contains "$relative_json_output" '"profiles/machine/example-local-skills.yaml"'

non_mapping_registry_dir="$tmp_dir/non-mapping-registry"
write_ok_fixture "$non_mapping_registry_dir"
cat >"$non_mapping_registry_dir/skills.registry.yaml" <<'YAML'
- fixture
YAML
non_mapping_registry_output="$(expect_failure run_catalog "$non_mapping_registry_dir" --json)"
assert_contains "$non_mapping_registry_output" "top-level YAML document must be a mapping"

non_mapping_lock_dir="$tmp_dir/non-mapping-lock"
write_ok_fixture "$non_mapping_lock_dir"
cat >"$non_mapping_lock_dir/skills.lock.yaml" <<'YAML'
- fixture
YAML
non_mapping_lock_output="$(expect_failure run_catalog "$non_mapping_lock_dir" --json)"
assert_contains "$non_mapping_lock_output" "top-level YAML document must be a mapping"

missing_manager_source_dir="$tmp_dir/missing-manager-source"
write_ok_fixture "$missing_manager_source_dir"
rm -rf "$missing_manager_source_dir/profiles"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry").delete("manager_source")
  File.write(path, data.to_yaml)
' "$missing_manager_source_dir/skills.registry.yaml"
run_catalog "$missing_manager_source_dir" --write
ruby -rjson -e '
  parsed = JSON.parse(File.read(ARGV.fetch(0)))
  raise "missing manager_source should be omitted when no installs are emitted" if parsed.fetch("registry").key?("manager_source")
  raise "missing profile should suppress install commands" if parsed.fetch("skills").any? { |skill| skill.key?("install") }
' "$missing_manager_source_dir/skills.catalog.json"
missing_manager_source_markdown="$(run_catalog "$missing_manager_source_dir" --markdown)"
assert_contains "$missing_manager_source_markdown" "Manager source: not required for this catalog"

unsafe_manager_source_dir="$tmp_dir/unsafe-manager-source"
write_ok_fixture "$unsafe_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "~/private"
  File.write(path, data.to_yaml)
' "$unsafe_manager_source_dir/skills.registry.yaml"
unsafe_manager_source_output="$(expect_failure run_catalog "$unsafe_manager_source_dir" --json)"
assert_contains "$unsafe_manager_source_output" "registry.manager_source must be a public-safe skills source"

uppercase_commit_dir="$tmp_dir/uppercase-commit"
write_ok_fixture "$uppercase_commit_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  source = data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")
  source["observed_commit"] = "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
  File.write(path, data.to_yaml)
' "$uppercase_commit_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  entry = data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }
  entry["observed_commit"] = "abcdef0123456789abcdef0123456789abcdef01"
  File.write(path, data.to_yaml)
' "$uppercase_commit_dir/skills.lock.yaml"
run_catalog "$uppercase_commit_dir" --write
run_catalog "$uppercase_commit_dir" --check

quoted_command_dir="$tmp_dir/quoted-command"
write_ok_fixture "$quoted_command_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }["exported_names"] = ["example skill;touch"]
  File.write(path, data.to_yaml)
' "$quoted_command_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }["exported_names"] = ["example skill;touch"]
  File.write(path, data.to_yaml)
' "$quoted_command_dir/skills.lock.yaml"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("name: example-skill", "name: example skill;touch")
  File.write(path, text)
' "$quoted_command_dir/example-skill/SKILL.md"
write_registry_local_digest "$quoted_command_dir"
quoted_command_output="$(run_catalog "$quoted_command_dir" --json)"
assert_contains "$quoted_command_output" '"codex_global_command": "npx --yes skills@1.5.14 add fixture/skills --skill example\\ skill\\;touch --agent codex --global --yes"'

local_external_url_dir="$tmp_dir/local-external-url"
write_ok_fixture "$local_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "private-skill"
  File.write(path, data.to_yaml)
' "$local_external_url_dir/skills.registry.yaml"
local_external_url_output="$(expect_failure run_catalog "$local_external_url_dir" --json)"
assert_contains "$local_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

digest_drift_dir="$tmp_dir/digest-drift"
write_ok_fixture "$digest_drift_dir"
run_catalog "$digest_drift_dir" --write
ruby -e '
  path = ARGV.fetch(0)
  File.write(path, File.read(path) + "\nMore body text.\n")
' "$digest_drift_dir/example-skill/SKILL.md"
digest_drift_output="$(expect_failure run_catalog "$digest_drift_dir" --check)"
assert_contains "$digest_drift_output" "example-skill: lock digest_sha256 differs from registry-local source contents"

duplicate_skill_id_dir="$tmp_dir/duplicate-skill-id"
write_ok_fixture "$duplicate_skill_id_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  duplicate = Marshal.load(Marshal.dump(data.fetch("skills").find { |skill| skill.fetch("id") == "manual-review-skill" }))
  duplicate["id"] = "example-skill"
  data.fetch("skills") << duplicate
  File.write(path, data.to_yaml)
' "$duplicate_skill_id_dir/skills.registry.yaml"
duplicate_skill_id_output="$(expect_failure run_catalog "$duplicate_skill_id_dir" --json)"
assert_contains "$duplicate_skill_id_output" "duplicate skill id example-skill"

duplicate_export_name_dir="$tmp_dir/duplicate-export-name"
write_ok_fixture "$duplicate_export_name_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "manual-review-skill" }["exported_names"] = ["example-skill"]
  File.write(path, data.to_yaml)
' "$duplicate_export_name_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "manual-review-skill" }["exported_names"] = ["example-skill"]
  File.write(path, data.to_yaml)
' "$duplicate_export_name_dir/skills.lock.yaml"
duplicate_export_name_output="$(expect_failure run_catalog "$duplicate_export_name_dir" --json)"
assert_contains "$duplicate_export_name_output" "manual-review-skill: exported adapter name example-skill is duplicated"

duplicate_source_owner_dir="$tmp_dir/duplicate-source-owner"
write_ok_fixture "$duplicate_source_owner_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "manual-review-skill" }.fetch("source")["path"] = "example-skill"
  File.write(path, data.to_yaml)
' "$duplicate_source_owner_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  example = data.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }
  manual = data.fetch("skills").find { |skill| skill.fetch("id") == "manual-review-skill" }
  manual["path"] = example.fetch("path")
  manual["digest_sha256"] = example.fetch("digest_sha256")
  File.write(path, data.to_yaml)
' "$duplicate_source_owner_dir/skills.lock.yaml"
duplicate_source_owner_output="$(expect_failure run_catalog "$duplicate_source_owner_dir" --json)"
assert_contains "$duplicate_source_owner_output" "manual-review-skill: registry-local source.path example-skill is already declared by example-skill"

drive_letter_source_dir="$tmp_dir/drive-letter-source"
write_ok_fixture "$drive_letter_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  skill = data.fetch("skills").find { |entry| entry.fetch("id") == "example-skill" }
  skill.fetch("source")["path"] = "C:foo"
  skill["catalog"] = {
    "description" => "Catalog override should not make a drive-letter path valid."
  }
  File.write(path, data.to_yaml)
' "$drive_letter_source_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  skill = data.fetch("skills").find { |entry| entry.fetch("id") == "example-skill" }
  skill["path"] = "C:foo"
  File.write(path, data.to_yaml)
' "$drive_letter_source_dir/skills.lock.yaml"
drive_letter_source_output="$(expect_failure run_catalog "$drive_letter_source_dir" --json)"
assert_contains "$drive_letter_source_output" "example-skill: registry-local source.path must name a top-level skill directory"

unsafe_skill_id_dir="$tmp_dir/unsafe-skill-id"
write_ok_fixture "$unsafe_skill_id_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").first["id"] = "C:foo"
  File.write(path, data.to_yaml)
' "$unsafe_skill_id_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").first["id"] = "C:foo"
  File.write(path, data.to_yaml)
' "$unsafe_skill_id_dir/skills.lock.yaml"
unsafe_skill_id_output="$(expect_failure run_catalog "$unsafe_skill_id_dir" --json)"
assert_contains "$unsafe_skill_id_output" "skills[0].id must be a safe non-path identifier"
assert_contains "$unsafe_skill_id_output" "skills.lock.yaml entries must use safe non-path identifiers"

echo "skills_catalog test ok"
