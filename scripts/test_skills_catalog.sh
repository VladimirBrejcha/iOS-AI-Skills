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
assert_contains "$markdown_output" "refresh \`skills.lock.yaml\` if source contents changed"
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

local_catalog_override_dir="$tmp_dir/local-catalog-override"
write_ok_fixture "$local_catalog_override_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }["catalog"] = {
    "name" => "stale-example-skill",
    "description" => "Stale registry-local override."
  }
  File.write(path, data.to_yaml)
' "$local_catalog_override_dir/skills.registry.yaml"
run_catalog "$local_catalog_override_dir" --write
ruby -rjson -e '
  parsed = JSON.parse(File.read(ARGV.fetch(0)))
  example = parsed.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }
  raise "registry-local catalog name override should be ignored" unless example.fetch("name") == "example-skill"
  raise "registry-local catalog description override should be ignored" unless example.fetch("description") == "Example fixture skill."
' "$local_catalog_override_dir/skills.catalog.json"

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

repo_only_scope_dir="$tmp_dir/repo-only-scope"
write_ok_fixture "$repo_only_scope_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }["scopes"] = ["repo"]
  File.write(path, data.to_yaml)
' "$repo_only_scope_dir/skills.registry.yaml"
run_catalog "$repo_only_scope_dir" --write
ruby -rjson -e '
  parsed = JSON.parse(File.read(ARGV.fetch(0)))
  example = parsed.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }
  raise "repo-only scope should not emit a global install command" if example.key?("install")
' "$repo_only_scope_dir/skills.catalog.json"

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
  data.fetch("consumer_roots")["codex_legacy_user"] = {
    "path" => "~/.codex/skills",
    "adapter" => "symlink"
  }
  selection = data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "example-skill" }
  selection["expose_to"] = ["codex_legacy_user"]
  selection.delete("consumer_overrides")
  File.write(path, data.to_yaml)
' "$not_exposed_dir/profiles/machine/example-local-skills.yaml"
run_catalog "$not_exposed_dir" --write
ruby -rjson -e '
  parsed = JSON.parse(File.read(ARGV.fetch(0)))
  example = parsed.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }
  raise "non-exposed skill should not emit install command" if example.key?("install")
' "$not_exposed_dir/skills.catalog.json"

root_level_manager_copy_dir="$tmp_dir/consumer-manager-copy-default"
write_ok_fixture "$root_level_manager_copy_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("consumer_roots").fetch("agents_user")["adapter"] = "manager-copy"
  data.fetch("consumer_roots").fetch("agents_user")["status"] = "proven-manager-copy"
  data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "example-skill" }.delete("consumer_overrides")
  File.write(path, data.to_yaml)
' "$root_level_manager_copy_dir/profiles/machine/example-local-skills.yaml"
run_catalog "$root_level_manager_copy_dir" --write
ruby -rjson -e '
  parsed = JSON.parse(File.read(ARGV.fetch(0)))
  example = parsed.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }
  install = example.fetch("install")
  raise "root-level manager-copy approval should emit install command" unless install.fetch("codex_global_command").include?("--skill example-skill")
' "$root_level_manager_copy_dir/skills.catalog.json"

trailing_slash_agents_root_dir="$tmp_dir/trailing-slash-agents-root"
write_ok_fixture "$trailing_slash_agents_root_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("consumer_roots").fetch("agents_user")["path"] = "~/.agents/skills/"
  File.write(path, data.to_yaml)
' "$trailing_slash_agents_root_dir/profiles/machine/example-local-skills.yaml"
trailing_slash_agents_root_output="$(run_catalog "$trailing_slash_agents_root_dir" --json)"
assert_contains "$trailing_slash_agents_root_output" '"codex_global_command": "npx --yes skills@1.5.14 add fixture/skills --skill example-skill --agent codex --global --yes"'

duplicate_active_agents_user_dir="$tmp_dir/duplicate-active-agents-user"
write_ok_fixture "$duplicate_active_agents_user_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  duplicate = Marshal.load(Marshal.dump(data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "example-skill" }))
  data.fetch("selected_skills") << duplicate
  File.write(path, data.to_yaml)
' "$duplicate_active_agents_user_dir/profiles/machine/example-local-skills.yaml"
duplicate_active_agents_user_output="$(expect_failure run_catalog "$duplicate_active_agents_user_dir" --json)"
assert_contains "$duplicate_active_agents_user_output" "profiles/machine/example-local-skills.yaml duplicate active agents_user selection for skill_id example-skill"

duplicate_active_and_planned_agents_user_dir="$tmp_dir/duplicate-active-and-planned-agents-user"
write_ok_fixture "$duplicate_active_and_planned_agents_user_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("selected_skills") << {
    "skill_id" => "example-skill",
    "expose_to" => ["agents_user"],
    "state" => "planned"
  }
  File.write(path, data.to_yaml)
' "$duplicate_active_and_planned_agents_user_dir/profiles/machine/example-local-skills.yaml"
duplicate_active_and_planned_agents_user_output="$(expect_failure run_catalog "$duplicate_active_and_planned_agents_user_dir" --json)"
assert_contains "$duplicate_active_and_planned_agents_user_output" "profiles/machine/example-local-skills.yaml duplicate selected target for skill_id example-skill and consumer agents_user"

duplicate_expose_to_dir="$tmp_dir/duplicate-expose-to"
write_ok_fixture "$duplicate_expose_to_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  selection = data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "example-skill" }
  selection["expose_to"] = ["agents_user", "agents_user"]
  File.write(path, data.to_yaml)
' "$duplicate_expose_to_dir/profiles/machine/example-local-skills.yaml"
duplicate_expose_to_output="$(expect_failure run_catalog "$duplicate_expose_to_dir" --json)"
assert_contains "$duplicate_expose_to_output" "profiles/machine/example-local-skills.yaml example-skill expose_to must not list duplicate consumers"

empty_expose_to_dir="$tmp_dir/empty-expose-to"
write_ok_fixture "$empty_expose_to_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  selection = data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "example-skill" }
  selection["expose_to"] = []
  File.write(path, data.to_yaml)
' "$empty_expose_to_dir/profiles/machine/example-local-skills.yaml"
empty_expose_to_output="$(expect_failure run_catalog "$empty_expose_to_dir" --json)"
assert_contains "$empty_expose_to_output" "profiles/machine/example-local-skills.yaml example-skill expose_to must list at least one consumer"

invalid_selection_state_dir="$tmp_dir/invalid-selection-state"
write_ok_fixture "$invalid_selection_state_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  selection = data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "manual-review-skill" }
  selection["state"] = "bad/state"
  File.write(path, data.to_yaml)
' "$invalid_selection_state_dir/profiles/machine/example-local-skills.yaml"
invalid_selection_state_output="$(expect_failure run_catalog "$invalid_selection_state_dir" --json)"
assert_contains "$invalid_selection_state_output" "profiles/machine/example-local-skills.yaml manual-review-skill state must be a safe non-path identifier"

missing_selected_skill_dir="$tmp_dir/missing-selected-skill"
write_ok_fixture "$missing_selected_skill_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("selected_skills") << {
    "skill_id" => "missing-skill",
    "expose_to" => ["agents_user"],
    "state" => "active",
    "consumer_overrides" => {
      "agents_user" => {
        "adapter" => "manager-copy",
        "status" => "proven-manager-copy"
      }
    }
  }
  File.write(path, data.to_yaml)
' "$missing_selected_skill_dir/profiles/machine/example-local-skills.yaml"
missing_selected_skill_output="$(expect_failure run_catalog "$missing_selected_skill_dir" --json)"
assert_contains "$missing_selected_skill_output" "profiles/machine/example-local-skills.yaml selected skill missing-skill is not in registry"

unshared_agents_root_validation_dir="$tmp_dir/unshared-agents-root-validation"
write_ok_fixture "$unshared_agents_root_validation_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("consumer_roots").fetch("agents_user")["path"] = "./private-agents-skills"
  data.fetch("selected_skills") << {
    "skill_id" => "missing-skill",
    "expose_to" => ["agents_user"],
    "state" => "active"
  }
  File.write(path, data.to_yaml)
' "$unshared_agents_root_validation_dir/profiles/machine/example-local-skills.yaml"
unshared_agents_root_validation_output="$(expect_failure run_catalog "$unshared_agents_root_validation_dir" --json)"
assert_contains "$unshared_agents_root_validation_output" "profiles/machine/example-local-skills.yaml selected skill missing-skill is not in registry"

unsupported_agents_override_key_dir="$tmp_dir/unsupported-agents-override-key"
write_ok_fixture "$unsupported_agents_override_key_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  override = data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "example-skill" }
    .fetch("consumer_overrides").fetch("agents_user")
  override["path"] = "private-copy"
  File.write(path, data.to_yaml)
' "$unsupported_agents_override_key_dir/profiles/machine/example-local-skills.yaml"
unsupported_agents_override_key_output="$(expect_failure run_catalog "$unsupported_agents_override_key_dir" --json)"
assert_contains "$unsupported_agents_override_key_output" "profiles/machine/example-local-skills.yaml example-skill consumer_overrides.agents_user supports only adapter and status"

unsupported_non_agents_override_dir="$tmp_dir/unsupported-non-agents-override"
write_ok_fixture "$unsupported_non_agents_override_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "example-skill" }
    .fetch("consumer_overrides")["claude_user"] = { "adapter" => "manager-copy" }
  File.write(path, data.to_yaml)
' "$unsupported_non_agents_override_dir/profiles/machine/example-local-skills.yaml"
unsupported_non_agents_override_output="$(expect_failure run_catalog "$unsupported_non_agents_override_dir" --json)"
assert_contains "$unsupported_non_agents_override_output" "profiles/machine/example-local-skills.yaml example-skill consumer_overrides.claude_user must target an exposed consumer"

invalid_agents_root_adapter_dir="$tmp_dir/invalid-agents-root-adapter"
write_ok_fixture "$invalid_agents_root_adapter_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("consumer_roots").fetch("agents_user")["adapter"] = "bad/adapter"
  File.write(path, data.to_yaml)
' "$invalid_agents_root_adapter_dir/profiles/machine/example-local-skills.yaml"
invalid_agents_root_adapter_output="$(expect_failure run_catalog "$invalid_agents_root_adapter_dir" --json)"
assert_contains "$invalid_agents_root_adapter_output" "profiles/machine/example-local-skills.yaml consumer_roots.agents_user adapter must be a safe non-path identifier"

invalid_profile_id_dir="$tmp_dir/invalid-profile-id"
write_ok_fixture "$invalid_profile_id_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("profile")["id"] = "bad/id"
  File.write(path, data.to_yaml)
' "$invalid_profile_id_dir/profiles/machine/example-local-skills.yaml"
invalid_profile_id_output="$(expect_failure run_catalog "$invalid_profile_id_dir" --json)"
assert_contains "$invalid_profile_id_output" "profiles/machine/example-local-skills.yaml profile.id must be a safe non-path identifier"

invalid_profile_status_dir="$tmp_dir/invalid-profile-status"
write_ok_fixture "$invalid_profile_status_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data["status"] = ["bad"]
  File.write(path, data.to_yaml)
' "$invalid_profile_status_dir/profiles/machine/example-local-skills.yaml"
invalid_profile_status_output="$(expect_failure run_catalog "$invalid_profile_status_dir" --json)"
assert_contains "$invalid_profile_status_output" "profiles/machine/example-local-skills.yaml status must be a string when provided"

invalid_consumer_root_windows_dir="$tmp_dir/invalid-consumer-root-windows"
write_ok_fixture "$invalid_consumer_root_windows_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("consumer_roots")["codex_legacy_user"] = {
    "path" => "scratch/C:foo",
    "adapter" => "symlink"
  }
  data.fetch("consumer_roots")["claude_user"] = {
    "path" => "scratch\\\\copy",
    "adapter" => "symlink"
  }
  File.write(path, data.to_yaml)
' "$invalid_consumer_root_windows_dir/profiles/machine/example-local-skills.yaml"
invalid_consumer_root_windows_output="$(expect_failure run_catalog "$invalid_consumer_root_windows_dir" --json)"
assert_contains "$invalid_consumer_root_windows_output" "profiles/machine/example-local-skills.yaml consumer_roots.codex_legacy_user path must not be a local Windows path"
assert_contains "$invalid_consumer_root_windows_output" "profiles/machine/example-local-skills.yaml consumer_roots.claude_user path must not be a local Windows path"

duplicate_non_agents_target_dir="$tmp_dir/duplicate-non-agents-target"
write_ok_fixture "$duplicate_non_agents_target_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("consumer_roots")["claude_user"] = {
    "path" => "~/.claude/skills",
    "adapter" => "symlink"
  }
  selection = data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "manual-review-skill" }
  selection["expose_to"] = ["claude_user"]
  duplicate = Marshal.load(Marshal.dump(selection))
  data.fetch("selected_skills") << duplicate
  File.write(path, data.to_yaml)
' "$duplicate_non_agents_target_dir/profiles/machine/example-local-skills.yaml"
duplicate_non_agents_target_output="$(expect_failure run_catalog "$duplicate_non_agents_target_dir" --json)"
assert_contains "$duplicate_non_agents_target_output" "profiles/machine/example-local-skills.yaml duplicate selected target for skill_id manual-review-skill and consumer claude_user"

same_root_alias_target_dir="$tmp_dir/same-root-alias-target"
write_ok_fixture "$same_root_alias_target_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("consumer_roots")["codex_legacy_user"] = {
    "path" => "~/.agents/skills/",
    "adapter" => "symlink"
  }
  selection = data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "example-skill" }
  selection["expose_to"] = ["agents_user", "codex_legacy_user"]
  File.write(path, data.to_yaml)
' "$same_root_alias_target_dir/profiles/machine/example-local-skills.yaml"
same_root_alias_target_output="$(expect_failure run_catalog "$same_root_alias_target_dir" --json)"
assert_contains "$same_root_alias_target_output" "profiles/machine/example-local-skills.yaml duplicate selected target for skill_id example-skill because consumers agents_user and codex_legacy_user share the same expanded root"

same_root_symlink_alias_target_dir="$tmp_dir/same-root-symlink-alias-target"
write_ok_fixture "$same_root_symlink_alias_target_dir"
same_root_symlink_alias_home="$tmp_dir/same-root-symlink-alias-home"
mkdir -p "$same_root_symlink_alias_home/.agents" "$same_root_symlink_alias_home/real-skills"
ln -s "$same_root_symlink_alias_home/real-skills" "$same_root_symlink_alias_home/.agents/skills"
ln -s "$same_root_symlink_alias_home/.agents/skills" "$same_root_symlink_alias_home/alias-skills"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("consumer_roots")["codex_legacy_user"] = {
    "path" => "~/alias-skills",
    "adapter" => "symlink"
  }
  selection = data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "example-skill" }
  selection["expose_to"] = ["agents_user", "codex_legacy_user"]
  File.write(path, data.to_yaml)
' "$same_root_symlink_alias_target_dir/profiles/machine/example-local-skills.yaml"
same_root_symlink_alias_target_output="$(HOME="$same_root_symlink_alias_home" expect_failure run_catalog "$same_root_symlink_alias_target_dir" --json)"
assert_contains "$same_root_symlink_alias_target_output" "profiles/machine/example-local-skills.yaml duplicate selected target for skill_id example-skill because consumers agents_user and codex_legacy_user share the same expanded root"

bad_client_status_dir="$tmp_dir/bad-client-status"
write_ok_fixture "$bad_client_status_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "example-skill" }
    .fetch("clients")["claude"] = "bad/status"
  File.write(path, data.to_yaml)
' "$bad_client_status_dir/skills.registry.yaml"
bad_client_status_output="$(expect_failure run_catalog "$bad_client_status_dir" --json)"
assert_contains "$bad_client_status_output" "example-skill: clients values must be safe non-path identifiers"

missing_profile_dir="$tmp_dir/missing-profile"
write_ok_fixture "$missing_profile_dir"
rm -rf "$missing_profile_dir/profiles"
missing_profile_output="$(expect_failure run_catalog "$missing_profile_dir" --json)"
assert_contains "$missing_profile_output" "profiles/machine/example-local-skills.yaml does not exist"

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

unquoted_description_hash_dir="$tmp_dir/unquoted-description-hash"
write_ok_fixture "$unquoted_description_hash_dir"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Example fixture skill.", "description: Uses @Test, #expect, and #require.")
  File.write(path, text)
' "$unquoted_description_hash_dir/example-skill/SKILL.md"
unquoted_description_hash_output="$(expect_failure run_catalog "$unquoted_description_hash_dir" --json)"
assert_contains "$unquoted_description_hash_output" "example-skill/SKILL.md front matter description contains an unquoted #"

unquoted_description_tab_hash_dir="$tmp_dir/unquoted-description-tab-hash"
write_ok_fixture "$unquoted_description_tab_hash_dir"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Example fixture skill.", "description: Uses @Test,\t#expect, and #require.")
  File.write(path, text)
' "$unquoted_description_tab_hash_dir/example-skill/SKILL.md"
unquoted_description_tab_hash_output="$(expect_failure run_catalog "$unquoted_description_tab_hash_dir" --json)"
assert_contains "$unquoted_description_tab_hash_output" "example-skill/SKILL.md front matter description contains an unquoted #"

quoted_key_unquoted_description_hash_dir="$tmp_dir/quoted-key-unquoted-description-hash"
write_ok_fixture "$quoted_key_unquoted_description_hash_dir"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Example fixture skill.", "\"description\": Uses @Test, #expect, and #require.")
  File.write(path, text)
' "$quoted_key_unquoted_description_hash_dir/example-skill/SKILL.md"
quoted_key_unquoted_description_hash_output="$(expect_failure run_catalog "$quoted_key_unquoted_description_hash_dir" --json)"
assert_contains "$quoted_key_unquoted_description_hash_output" "example-skill/SKILL.md front matter description contains an unquoted #"

spaced_key_unquoted_description_hash_dir="$tmp_dir/spaced-key-unquoted-description-hash"
write_ok_fixture "$spaced_key_unquoted_description_hash_dir"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Example fixture skill.", "description : Uses @Test, #expect, and #require.")
  File.write(path, text)
' "$spaced_key_unquoted_description_hash_dir/example-skill/SKILL.md"
spaced_key_unquoted_description_hash_output="$(expect_failure run_catalog "$spaced_key_unquoted_description_hash_dir" --json)"
assert_contains "$spaced_key_unquoted_description_hash_output" "example-skill/SKILL.md front matter description contains an unquoted #"

multiline_unquoted_description_hash_dir="$tmp_dir/multiline-unquoted-description-hash"
write_ok_fixture "$multiline_unquoted_description_hash_dir"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Example fixture skill.", "description: Uses @Test,\n  #expect, and #require.")
  File.write(path, text)
' "$multiline_unquoted_description_hash_dir/example-skill/SKILL.md"
multiline_unquoted_description_hash_output="$(expect_failure run_catalog "$multiline_unquoted_description_hash_dir" --json)"
assert_contains "$multiline_unquoted_description_hash_output" "example-skill/SKILL.md front matter description contains an unquoted #"

continuation_only_unquoted_description_hash_dir="$tmp_dir/continuation-only-unquoted-description-hash"
write_ok_fixture "$continuation_only_unquoted_description_hash_dir"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Example fixture skill.", "description:\n  Uses @Test,\n  #expect, and #require.")
  File.write(path, text)
' "$continuation_only_unquoted_description_hash_dir/example-skill/SKILL.md"
continuation_only_unquoted_description_hash_output="$(expect_failure run_catalog "$continuation_only_unquoted_description_hash_dir" --json)"
assert_contains "$continuation_only_unquoted_description_hash_output" "example-skill/SKILL.md front matter description contains an unquoted #"

quoted_prefix_comment_description_hash_dir="$tmp_dir/quoted-prefix-comment-description-hash"
write_ok_fixture "$quoted_prefix_comment_description_hash_dir"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Example fixture skill.", "description: \"Uses @Test,\" #expect, and #require.")
  File.write(path, text)
' "$quoted_prefix_comment_description_hash_dir/example-skill/SKILL.md"
quoted_prefix_comment_description_hash_output="$(expect_failure run_catalog "$quoted_prefix_comment_description_hash_dir" --json)"
assert_contains "$quoted_prefix_comment_description_hash_output" "example-skill/SKILL.md front matter description contains an unquoted #"

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

private_url_description_dir="$tmp_dir/private-url-description"
write_ok_fixture "$private_url_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  description = "Uses http://127.0.0.1/private/repo before import."
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = description
  File.write(path, data.to_yaml)
' "$private_url_description_dir/skills.registry.yaml"
private_url_description_output="$(expect_failure run_catalog "$private_url_description_dir" --json)"
assert_contains "$private_url_description_output" "generated catalog JSON contains private or loopback URL"

scp_private_url_description_dir="$tmp_dir/scp-private-url-description"
write_ok_fixture "$scp_private_url_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  description = "Uses git@localhost:private/repo before import."
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = description
  File.write(path, data.to_yaml)
' "$scp_private_url_description_dir/skills.registry.yaml"
scp_private_url_description_output="$(expect_failure run_catalog "$scp_private_url_description_dir" --json)"
assert_contains "$scp_private_url_description_output" "generated catalog JSON contains private or loopback URL"

scp_private_ip_url_description_dir="$tmp_dir/scp-private-ip-url-description"
write_ok_fixture "$scp_private_ip_url_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  description = "Uses git@10.0.0.1:private/repo before import."
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = description
  File.write(path, data.to_yaml)
' "$scp_private_ip_url_description_dir/skills.registry.yaml"
scp_private_ip_url_description_output="$(expect_failure run_catalog "$scp_private_ip_url_description_dir" --json)"
assert_contains "$scp_private_ip_url_description_output" "generated catalog JSON contains private or loopback URL"

bearer_token_description_dir="$tmp_dir/bearer-token-description"
write_ok_fixture "$bearer_token_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  description = "Uses Bearer abcdefghijklmnopqrstuvwxyz1234567890 during setup."
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = description
  File.write(path, data.to_yaml)
' "$bearer_token_description_dir/skills.registry.yaml"
bearer_token_description_output="$(expect_failure run_catalog "$bearer_token_description_dir" --json)"
assert_contains "$bearer_token_description_output" "generated catalog JSON contains Bearer token"

posix_description_dir="$tmp_dir/posix-description"
write_ok_fixture "$posix_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  description = "Uses " + "/" + "tmp/private-repo before import."
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = description
  File.write(path, data.to_yaml)
' "$posix_description_dir/skills.registry.yaml"
posix_description_output="$(expect_failure run_catalog "$posix_description_dir" --json)"
assert_contains "$posix_description_output" "generated catalog JSON contains POSIX local path"

home_relative_description_dir="$tmp_dir/home-relative-description"
write_ok_fixture "$home_relative_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses ~/private-skill."
  File.write(path, data.to_yaml)
' "$home_relative_description_dir/skills.registry.yaml"
home_relative_description_output="$(expect_failure run_catalog "$home_relative_description_dir" --json)"
assert_contains "$home_relative_description_output" "generated catalog JSON contains home-relative local path"

named_user_home_relative_description_dir="$tmp_dir/named-user-home-relative-description"
write_ok_fixture "$named_user_home_relative_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses ~alice/private-skill."
  File.write(path, data.to_yaml)
' "$named_user_home_relative_description_dir/skills.registry.yaml"
named_user_home_relative_description_output="$(expect_failure run_catalog "$named_user_home_relative_description_dir" --json)"
assert_contains "$named_user_home_relative_description_output" "generated catalog JSON contains home-relative local path"

backslash_home_relative_description_dir="$tmp_dir/backslash-home-relative-description"
write_ok_fixture "$backslash_home_relative_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses ~\\\\private-skill."
  File.write(path, data.to_yaml)
' "$backslash_home_relative_description_dir/skills.registry.yaml"
backslash_home_relative_description_output="$(expect_failure run_catalog "$backslash_home_relative_description_dir" --json)"
assert_contains "$backslash_home_relative_description_output" "generated catalog JSON contains home-relative local path"

lowercase_macos_path_description_dir="$tmp_dir/lowercase-macos-path-description"
write_ok_fixture "$lowercase_macos_path_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses /users/alice/private."
  File.write(path, data.to_yaml)
' "$lowercase_macos_path_description_dir/skills.registry.yaml"
lowercase_macos_path_description_output="$(expect_failure run_catalog "$lowercase_macos_path_description_dir" --json)"
assert_contains "$lowercase_macos_path_description_output" "generated catalog JSON contains macOS user path"

lowercase_windows_path_description_dir="$tmp_dir/lowercase-windows-path-description"
write_ok_fixture "$lowercase_windows_path_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses C:/users/alice/private."
  File.write(path, data.to_yaml)
' "$lowercase_windows_path_description_dir/skills.registry.yaml"
lowercase_windows_path_description_output="$(expect_failure run_catalog "$lowercase_windows_path_description_dir" --json)"
assert_contains "$lowercase_windows_path_description_output" "generated catalog JSON contains Windows local path"

drive_relative_windows_path_description_dir="$tmp_dir/drive-relative-windows-path-description"
write_ok_fixture "$drive_relative_windows_path_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses C:Users\\\\alice\\\\private."
  File.write(path, data.to_yaml)
' "$drive_relative_windows_path_description_dir/skills.registry.yaml"
drive_relative_windows_path_description_output="$(expect_failure run_catalog "$drive_relative_windows_path_description_dir" --json)"
assert_contains "$drive_relative_windows_path_description_output" "generated catalog JSON contains Windows local path"

windows_drive_path_description_dir="$tmp_dir/windows-drive-path-description"
write_ok_fixture "$windows_drive_path_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses D:\\\\secret\\\\repo."
  File.write(path, data.to_yaml)
' "$windows_drive_path_description_dir/skills.registry.yaml"
windows_drive_path_description_output="$(expect_failure run_catalog "$windows_drive_path_description_dir" --json)"
assert_contains "$windows_drive_path_description_output" "generated catalog JSON contains Windows local path"

windows_unc_path_description_dir="$tmp_dir/windows-unc-path-description"
write_ok_fixture "$windows_unc_path_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses \\\\server\\share\\private."
  File.write(path, data.to_yaml)
' "$windows_unc_path_description_dir/skills.registry.yaml"
windows_unc_path_description_output="$(expect_failure run_catalog "$windows_unc_path_description_dir" --json)"
assert_contains "$windows_unc_path_description_output" "generated catalog JSON contains Windows local path"

non_http_credential_description_dir="$tmp_dir/non-http-credential-description"
write_ok_fixture "$non_http_credential_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses ssh://user:pass@example.com/repo."
  File.write(path, data.to_yaml)
' "$non_http_credential_description_dir/skills.registry.yaml"
non_http_credential_description_output="$(expect_failure run_catalog "$non_http_credential_description_dir" --json)"
assert_contains "$non_http_credential_description_output" "generated catalog JSON contains non-HTTP URL password"

encoded_non_http_credential_description_dir="$tmp_dir/encoded-non-http-credential-description"
write_ok_fixture "$encoded_non_http_credential_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses ssh://user%3Apass@example.com/repo."
  File.write(path, data.to_yaml)
' "$encoded_non_http_credential_description_dir/skills.registry.yaml"
encoded_non_http_credential_description_output="$(expect_failure run_catalog "$encoded_non_http_credential_description_dir" --json)"
assert_contains "$encoded_non_http_credential_description_output" "generated catalog JSON contains non-HTTP URL password"

scheme_agnostic_credential_description_dir="$tmp_dir/scheme-agnostic-credential-description"
write_ok_fixture "$scheme_agnostic_credential_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses svn://user:pass@example.com/repo."
  File.write(path, data.to_yaml)
' "$scheme_agnostic_credential_description_dir/skills.registry.yaml"
scheme_agnostic_credential_description_output="$(expect_failure run_catalog "$scheme_agnostic_credential_description_dir" --json)"
assert_contains "$scheme_agnostic_credential_description_output" "generated catalog JSON contains non-HTTP URL password"

scp_credential_description_dir="$tmp_dir/scp-credential-description"
write_ok_fixture "$scp_credential_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses user:pass@example.com:repo."
  File.write(path, data.to_yaml)
' "$scp_credential_description_dir/skills.registry.yaml"
scp_credential_description_output="$(expect_failure run_catalog "$scp_credential_description_dir" --json)"
assert_contains "$scp_credential_description_output" "generated catalog JSON contains scp-like URL password"

uppercase_file_url_description_dir="$tmp_dir/uppercase-file-url-description"
write_ok_fixture "$uppercase_file_url_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses FILE://server/share."
  File.write(path, data.to_yaml)
' "$uppercase_file_url_description_dir/skills.registry.yaml"
uppercase_file_url_description_output="$(expect_failure run_catalog "$uppercase_file_url_description_dir" --json)"
assert_contains "$uppercase_file_url_description_output" "generated catalog JSON contains file URL"

single_slash_file_url_description_dir="$tmp_dir/single-slash-file-url-description"
write_ok_fixture "$single_slash_file_url_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses file:/private/repo."
  File.write(path, data.to_yaml)
' "$single_slash_file_url_description_dir/skills.registry.yaml"
single_slash_file_url_description_output="$(expect_failure run_catalog "$single_slash_file_url_description_dir" --json)"
assert_contains "$single_slash_file_url_description_output" "generated catalog JSON contains file URL"

relative_file_url_description_dir="$tmp_dir/relative-file-url-description"
write_ok_fixture "$relative_file_url_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Uses file:private/repo."
  File.write(path, data.to_yaml)
' "$relative_file_url_description_dir/skills.registry.yaml"
relative_file_url_description_output="$(expect_failure run_catalog "$relative_file_url_description_dir" --json)"
assert_contains "$relative_file_url_description_output" "generated catalog JSON contains file URL"

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
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("selected_skills").find { |entry| entry.fetch("skill_id") == "example-skill" }["state"] = "planned"
  File.write(path, data.to_yaml)
' "$missing_manager_source_dir/profiles/machine/example-local-skills.yaml"
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

private_host_manager_source_dir="$tmp_dir/private-host-manager-source"
write_ok_fixture "$private_host_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "http://127.0.0.1/private/repo"
  File.write(path, data.to_yaml)
' "$private_host_manager_source_dir/skills.registry.yaml"
private_host_manager_source_output="$(expect_failure run_catalog "$private_host_manager_source_dir" --json)"
assert_contains "$private_host_manager_source_output" "registry.manager_source must be a public-safe skills source"

shared_address_manager_source_dir="$tmp_dir/shared-address-manager-source"
write_ok_fixture "$shared_address_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "https://100.64.0.1/fiveonecode/agent-skills"
  File.write(path, data.to_yaml)
' "$shared_address_manager_source_dir/skills.registry.yaml"
shared_address_manager_source_output="$(expect_failure run_catalog "$shared_address_manager_source_dir" --json)"
assert_contains "$shared_address_manager_source_output" "registry.manager_source must be a public-safe skills source"

special_use_case_index=1
for special_use_manager_source in \
  "https://0.1.2.3/fiveonecode/agent-skills" \
  "https://198.18.0.1/fiveonecode/agent-skills" \
  "https://192.0.2.1/fiveonecode/agent-skills" \
  "https://[2001:db8::1]/fiveonecode/agent-skills"; do
  special_use_manager_source_dir="$tmp_dir/special-use-manager-source-$special_use_case_index"
  write_ok_fixture "$special_use_manager_source_dir"
  ruby -ryaml -e '
    path = ARGV.fetch(0)
    source = ARGV.fetch(1)
    data = YAML.safe_load(File.read(path), aliases: false)
    data.fetch("registry")["manager_source"] = source
    File.write(path, data.to_yaml)
  ' "$special_use_manager_source_dir/skills.registry.yaml" "$special_use_manager_source"
  special_use_manager_source_output="$(expect_failure run_catalog "$special_use_manager_source_dir" --json)"
  assert_contains "$special_use_manager_source_output" "registry.manager_source must be a public-safe skills source"
  special_use_case_index=$((special_use_case_index + 1))
done

cleartext_manager_source_dir="$tmp_dir/cleartext-manager-source"
write_ok_fixture "$cleartext_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "http://example.com/fiveonecode/agent-skills"
  File.write(path, data.to_yaml)
' "$cleartext_manager_source_dir/skills.registry.yaml"
cleartext_manager_source_output="$(expect_failure run_catalog "$cleartext_manager_source_dir" --json)"
assert_contains "$cleartext_manager_source_output" "registry.manager_source must be a public-safe skills source"

for encoded_host in 2130706433 0177.0.0.1 127.1; do
  encoded_manager_source_dir="$tmp_dir/encoded-manager-source-${encoded_host//./-}"
  write_ok_fixture "$encoded_manager_source_dir"
  ruby -ryaml -e '
    path = ARGV.fetch(0)
    host = ARGV.fetch(1)
    data = YAML.safe_load(File.read(path), aliases: false)
    data.fetch("registry")["manager_source"] = "http://#{host}/fiveonecode/agent-skills"
    File.write(path, data.to_yaml)
  ' "$encoded_manager_source_dir/skills.registry.yaml" "$encoded_host"
  encoded_manager_source_output="$(expect_failure run_catalog "$encoded_manager_source_dir" --json)"
  assert_contains "$encoded_manager_source_output" "registry.manager_source must be a public-safe skills source"
done

percent_encoded_manager_source_dir="$tmp_dir/percent-encoded-manager-source"
write_ok_fixture "$percent_encoded_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "https://%31%32%37.0.0.1/fiveonecode/agent-skills"
  File.write(path, data.to_yaml)
' "$percent_encoded_manager_source_dir/skills.registry.yaml"
percent_encoded_manager_source_output="$(expect_failure run_catalog "$percent_encoded_manager_source_dir" --json)"
assert_contains "$percent_encoded_manager_source_output" "registry.manager_source must be a public-safe skills source"

trailing_dot_manager_source_dir="$tmp_dir/trailing-dot-manager-source"
write_ok_fixture "$trailing_dot_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "https://localhost./fiveonecode/agent-skills"
  File.write(path, data.to_yaml)
' "$trailing_dot_manager_source_dir/skills.registry.yaml"
trailing_dot_manager_source_output="$(expect_failure run_catalog "$trailing_dot_manager_source_dir" --json)"
assert_contains "$trailing_dot_manager_source_output" "registry.manager_source must be a public-safe skills source"

fragment_manager_source_dir="$tmp_dir/fragment-manager-source"
write_ok_fixture "$fragment_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "https://github.com/fiveonecode/agent-skills#main"
  File.write(path, data.to_yaml)
' "$fragment_manager_source_dir/skills.registry.yaml"
fragment_manager_source_output="$(expect_failure run_catalog "$fragment_manager_source_dir" --json)"
assert_contains "$fragment_manager_source_output" "registry.manager_source must be a public-safe skills source"

non_string_manager_source_dir="$tmp_dir/non-string-manager-source"
write_ok_fixture "$non_string_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = ["bad"]
  File.write(path, data.to_yaml)
' "$non_string_manager_source_dir/skills.registry.yaml"
non_string_manager_source_output="$(expect_failure run_catalog "$non_string_manager_source_dir" --json)"
assert_contains "$non_string_manager_source_output" "registry.manager_source must be a string"

dot_only_manager_source_dir="$tmp_dir/dot-only-manager-source"
write_ok_fixture "$dot_only_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "https://github.com/example/.."
  File.write(path, data.to_yaml)
' "$dot_only_manager_source_dir/skills.registry.yaml"
dot_only_manager_source_output="$(expect_failure run_catalog "$dot_only_manager_source_dir" --json)"
assert_contains "$dot_only_manager_source_output" "registry.manager_source must be a public-safe skills source"

encoded_dot_segment_manager_source_dir="$tmp_dir/encoded-dot-segment-manager-source"
write_ok_fixture "$encoded_dot_segment_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "https://github.com/fiveonecode/%2e%2e"
  File.write(path, data.to_yaml)
' "$encoded_dot_segment_manager_source_dir/skills.registry.yaml"
encoded_dot_segment_manager_source_output="$(expect_failure run_catalog "$encoded_dot_segment_manager_source_dir" --json)"
assert_contains "$encoded_dot_segment_manager_source_output" "registry.manager_source must be a public-safe skills source"

repo_changing_dot_segment_manager_source_dir="$tmp_dir/repo-changing-dot-segment-manager-source"
write_ok_fixture "$repo_changing_dot_segment_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "https://github.com/fiveonecode/agent-skills/../other"
  File.write(path, data.to_yaml)
' "$repo_changing_dot_segment_manager_source_dir/skills.registry.yaml"
repo_changing_dot_segment_manager_source_output="$(expect_failure run_catalog "$repo_changing_dot_segment_manager_source_dir" --json)"
assert_contains "$repo_changing_dot_segment_manager_source_output" "registry.manager_source must be a public-safe skills source"

dot_segment_manager_source_dir="$tmp_dir/dot-segment-manager-source"
write_ok_fixture "$dot_segment_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "fiveonecode/."
  File.write(path, data.to_yaml)
' "$dot_segment_manager_source_dir/skills.registry.yaml"
dot_segment_manager_source_output="$(expect_failure run_catalog "$dot_segment_manager_source_dir" --json)"
assert_contains "$dot_segment_manager_source_output" "registry.manager_source must be a public-safe skills source"

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

invalid_observed_at_dir="$tmp_dir/invalid-observed-at"
write_ok_fixture "$invalid_observed_at_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  source = data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")
  source["observed_at"] = "not a date"
  File.write(path, data.to_yaml)
' "$invalid_observed_at_dir/skills.registry.yaml"
invalid_observed_at_output="$(expect_failure run_catalog "$invalid_observed_at_dir" --json)"
assert_contains "$invalid_observed_at_output" "external-skill: external-git source.observed_at must be an ISO date (YYYY-MM-DD)"

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

encoded_credential_external_url_dir="$tmp_dir/encoded-credential-external-url"
write_ok_fixture "$encoded_credential_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "ssh://user%3Apass@github.com/example/agent-skill.git"
  File.write(path, data.to_yaml)
' "$encoded_credential_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "ssh://user%3Apass@github.com/example/agent-skill.git"
  File.write(path, data.to_yaml)
' "$encoded_credential_external_url_dir/skills.lock.yaml"
encoded_credential_external_url_output="$(expect_failure run_catalog "$encoded_credential_external_url_dir" --json)"
assert_contains "$encoded_credential_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

encoded_scp_password_description_dir="$tmp_dir/encoded-scp-password-description"
write_ok_fixture "$encoded_scp_password_description_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("catalog")["description"] = "Mirror user%3Apass@example.com:repo before install."
  File.write(path, data.to_yaml)
' "$encoded_scp_password_description_dir/skills.registry.yaml"
encoded_scp_password_description_output="$(expect_failure run_catalog "$encoded_scp_password_description_dir" --json)"
assert_contains "$encoded_scp_password_description_output" "generated catalog JSON contains scp-like URL password"

host_only_external_url_dir="$tmp_dir/host-only-external-url"
write_ok_fixture "$host_only_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "https://github.com"
  File.write(path, data.to_yaml)
' "$host_only_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "https://github.com"
  File.write(path, data.to_yaml)
' "$host_only_external_url_dir/skills.lock.yaml"
host_only_external_url_output="$(expect_failure run_catalog "$host_only_external_url_dir" --json)"
assert_contains "$host_only_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

host_only_scheme_external_url_dir="$tmp_dir/host-only-scheme-external-url"
write_ok_fixture "$host_only_scheme_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "ssh://github.com"
  File.write(path, data.to_yaml)
' "$host_only_scheme_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "ssh://github.com"
  File.write(path, data.to_yaml)
' "$host_only_scheme_external_url_dir/skills.lock.yaml"
host_only_scheme_external_url_output="$(expect_failure run_catalog "$host_only_scheme_external_url_dir" --json)"
assert_contains "$host_only_scheme_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

private_ip_external_url_dir="$tmp_dir/private-ip-external-url"
write_ok_fixture "$private_ip_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "http://10.0.0.5/private/repo.git"
  File.write(path, data.to_yaml)
' "$private_ip_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "http://10.0.0.5/private/repo.git"
  File.write(path, data.to_yaml)
' "$private_ip_external_url_dir/skills.lock.yaml"
private_ip_external_url_output="$(expect_failure run_catalog "$private_ip_external_url_dir" --json)"
assert_contains "$private_ip_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

localhost_external_url_dir="$tmp_dir/localhost-external-url"
write_ok_fixture "$localhost_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "ssh://localhost/org/repo.git"
  File.write(path, data.to_yaml)
' "$localhost_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "ssh://localhost/org/repo.git"
  File.write(path, data.to_yaml)
' "$localhost_external_url_dir/skills.lock.yaml"
localhost_external_url_output="$(expect_failure run_catalog "$localhost_external_url_dir" --json)"
assert_contains "$localhost_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

valid_scp_external_url_dir="$tmp_dir/valid-scp-external-url"
write_ok_fixture "$valid_scp_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "git@example.com:org/repo.git"
  File.write(path, data.to_yaml)
' "$valid_scp_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "git@example.com:org/repo.git"
  File.write(path, data.to_yaml)
' "$valid_scp_external_url_dir/skills.lock.yaml"
run_catalog "$valid_scp_external_url_dir" --write
run_catalog "$valid_scp_external_url_dir" --check

mailto_external_url_dir="$tmp_dir/mailto-external-url"
write_ok_fixture "$mailto_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "mailto:user@example.com"
  File.write(path, data.to_yaml)
' "$mailto_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "mailto:user@example.com"
  File.write(path, data.to_yaml)
' "$mailto_external_url_dir/skills.lock.yaml"
mailto_external_url_output="$(expect_failure run_catalog "$mailto_external_url_dir" --json)"
assert_contains "$mailto_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

dot_only_external_url_dir="$tmp_dir/dot-only-external-url"
write_ok_fixture "$dot_only_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "https://github.com/example/.."
  File.write(path, data.to_yaml)
' "$dot_only_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "https://github.com/example/.."
  File.write(path, data.to_yaml)
' "$dot_only_external_url_dir/skills.lock.yaml"
dot_only_external_url_output="$(expect_failure run_catalog "$dot_only_external_url_dir" --json)"
assert_contains "$dot_only_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

encoded_dot_segment_external_url_dir="$tmp_dir/encoded-dot-segment-external-url"
write_ok_fixture "$encoded_dot_segment_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "https://github.com/example/%2e%2e"
  File.write(path, data.to_yaml)
' "$encoded_dot_segment_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "https://github.com/example/%2e%2e"
  File.write(path, data.to_yaml)
' "$encoded_dot_segment_external_url_dir/skills.lock.yaml"
encoded_dot_segment_external_url_output="$(expect_failure run_catalog "$encoded_dot_segment_external_url_dir" --json)"
assert_contains "$encoded_dot_segment_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

repo_changing_dot_segment_external_url_dir="$tmp_dir/repo-changing-dot-segment-external-url"
write_ok_fixture "$repo_changing_dot_segment_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "https://github.com/example/agent-skill/../other"
  File.write(path, data.to_yaml)
' "$repo_changing_dot_segment_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "https://github.com/example/agent-skill/../other"
  File.write(path, data.to_yaml)
' "$repo_changing_dot_segment_external_url_dir/skills.lock.yaml"
repo_changing_dot_segment_external_url_output="$(expect_failure run_catalog "$repo_changing_dot_segment_external_url_dir" --json)"
assert_contains "$repo_changing_dot_segment_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

owner_only_scheme_external_url_dir="$tmp_dir/owner-only-scheme-external-url"
write_ok_fixture "$owner_only_scheme_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "https://github.com/fiveonecode"
  File.write(path, data.to_yaml)
' "$owner_only_scheme_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "https://github.com/fiveonecode"
  File.write(path, data.to_yaml)
' "$owner_only_scheme_external_url_dir/skills.lock.yaml"
owner_only_scheme_external_url_output="$(expect_failure run_catalog "$owner_only_scheme_external_url_dir" --json)"
assert_contains "$owner_only_scheme_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

owner_only_scp_external_url_dir="$tmp_dir/owner-only-scp-external-url"
write_ok_fixture "$owner_only_scp_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "git@github.com:fiveonecode"
  File.write(path, data.to_yaml)
' "$owner_only_scp_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "git@github.com:fiveonecode"
  File.write(path, data.to_yaml)
' "$owner_only_scp_external_url_dir/skills.lock.yaml"
owner_only_scp_external_url_output="$(expect_failure run_catalog "$owner_only_scp_external_url_dir" --json)"
assert_contains "$owner_only_scp_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

host_only_scheme_manager_source_dir="$tmp_dir/host-only-scheme-manager-source"
write_ok_fixture "$host_only_scheme_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "git://github.com"
  File.write(path, data.to_yaml)
' "$host_only_scheme_manager_source_dir/skills.registry.yaml"
host_only_scheme_manager_source_output="$(expect_failure run_catalog "$host_only_scheme_manager_source_dir" --json)"
assert_contains "$host_only_scheme_manager_source_output" "registry.manager_source must be a public-safe skills source"

mailto_manager_source_dir="$tmp_dir/mailto-manager-source"
write_ok_fixture "$mailto_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "mailto:user@example.com"
  File.write(path, data.to_yaml)
' "$mailto_manager_source_dir/skills.registry.yaml"
mailto_manager_source_output="$(expect_failure run_catalog "$mailto_manager_source_dir" --json)"
assert_contains "$mailto_manager_source_output" "registry.manager_source must be a public-safe skills source"

owner_only_scheme_manager_source_dir="$tmp_dir/owner-only-scheme-manager-source"
write_ok_fixture "$owner_only_scheme_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "https://github.com/fiveonecode"
  File.write(path, data.to_yaml)
' "$owner_only_scheme_manager_source_dir/skills.registry.yaml"
owner_only_scheme_manager_source_output="$(expect_failure run_catalog "$owner_only_scheme_manager_source_dir" --json)"
assert_contains "$owner_only_scheme_manager_source_output" "registry.manager_source must be a public-safe skills source"

owner_only_scp_manager_source_dir="$tmp_dir/owner-only-scp-manager-source"
write_ok_fixture "$owner_only_scp_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "git@github.com:fiveonecode"
  File.write(path, data.to_yaml)
' "$owner_only_scp_manager_source_dir/skills.registry.yaml"
owner_only_scp_manager_source_output="$(expect_failure run_catalog "$owner_only_scp_manager_source_dir" --json)"
assert_contains "$owner_only_scp_manager_source_output" "registry.manager_source must be a public-safe skills source"

owner_only_manager_source_dir="$tmp_dir/owner-only-manager-source"
write_ok_fixture "$owner_only_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "fiveonecode/"
  File.write(path, data.to_yaml)
' "$owner_only_manager_source_dir/skills.registry.yaml"
owner_only_manager_source_output="$(expect_failure run_catalog "$owner_only_manager_source_dir" --json)"
assert_contains "$owner_only_manager_source_output" "registry.manager_source must be a public-safe skills source"

host_root_scp_external_url_dir="$tmp_dir/host-root-scp-external-url"
write_ok_fixture "$host_root_scp_external_url_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }.fetch("source")["url"] = "git@github.com:/"
  File.write(path, data.to_yaml)
' "$host_root_scp_external_url_dir/skills.registry.yaml"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("skills").find { |skill| skill.fetch("id") == "external-skill" }["url"] = "git@github.com:/"
  File.write(path, data.to_yaml)
' "$host_root_scp_external_url_dir/skills.lock.yaml"
host_root_scp_external_url_output="$(expect_failure run_catalog "$host_root_scp_external_url_dir" --json)"
assert_contains "$host_root_scp_external_url_output" "external-skill: external-git source.url must be a public, credential-free URL"

host_root_scp_manager_source_dir="$tmp_dir/host-root-scp-manager-source"
write_ok_fixture "$host_root_scp_manager_source_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["manager_source"] = "git@github.com:/"
  File.write(path, data.to_yaml)
' "$host_root_scp_manager_source_dir/skills.registry.yaml"
host_root_scp_manager_source_output="$(expect_failure run_catalog "$host_root_scp_manager_source_dir" --json)"
assert_contains "$host_root_scp_manager_source_output" "registry.manager_source must be a public-safe skills source"

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

unsafe_registry_id_dir="$tmp_dir/unsafe-registry-id"
write_ok_fixture "$unsafe_registry_id_dir"
ruby -ryaml -e '
  path = ARGV.fetch(0)
  data = YAML.safe_load(File.read(path), aliases: false)
  data.fetch("registry")["id"] = "bad/id"
  File.write(path, data.to_yaml)
' "$unsafe_registry_id_dir/skills.registry.yaml"
unsafe_registry_id_output="$(expect_failure run_catalog "$unsafe_registry_id_dir" --json)"
assert_contains "$unsafe_registry_id_output" "registry.id must be a safe non-path identifier"

echo "skills_catalog test ok"
