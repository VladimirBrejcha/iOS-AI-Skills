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

fake_openai_key() {
  printf 'sk-%024d\n' 0
}

public_safety_cmd="$(
  ruby -ryaml -e '
    config = YAML.safe_load(File.read(ARGV.fetch(0)), aliases: false)
    command = config.fetch("commands").find { |entry| entry.fetch("id") == "public-safety-docs" }
    puts command.fetch("run")
  ' "$repo_root/.agents/verify/skills-registry.yaml"
)"

registry_yaml_cmd="$(
  ruby -ryaml -e '
    config = YAML.safe_load(File.read(ARGV.fetch(0)), aliases: false)
    command = config.fetch("commands").find { |entry| entry.fetch("id") == "registry-yaml" }
    puts command.fetch("run")
  ' "$repo_root/.agents/verify/skills-registry.yaml"
)"

skill_frontmatter_cmd="$(
  ruby -ryaml -e '
    config = YAML.safe_load(File.read(ARGV.fetch(0)), aliases: false)
    command = config.fetch("commands").find { |entry| entry.fetch("id") == "skill-frontmatter" }
    puts command.fetch("run")
  ' "$repo_root/.agents/verify/skills-registry.yaml"
)"

run_public_safety() {
  local fixture_root="$1"

  (
    cd "$fixture_root"
    eval "$public_safety_cmd"
  )
}

run_registry_yaml() {
  local fixture_root="$1"

  (
    cd "$fixture_root"
    eval "$registry_yaml_cmd"
  )
}

run_skill_frontmatter() {
  local fixture_root="$1"

  (
    cd "$fixture_root"
    eval "$skill_frontmatter_cmd"
  )
}

write_fixture_repo() {
  local root="$1"

  mkdir -p \
    "$root/.agents/manifests" \
    "$root/.agents/verify" \
    "$root/docs" \
    "$root/example-skill/assets" \
    "$root/profiles/machine" \
    "$root/scripts"

  cat >"$root/AGENTS.md" <<'EOF'
# Fixture
EOF

  cat >"$root/README.md" <<'EOF'
# Fixture
EOF

  cat >"$root/skills.lock.yaml" <<'EOF'
schema_version: 0.1
locks: []
EOF

  cat >"$root/skills.registry.yaml" <<'EOF'
schema_version: 0.1
skills: []
EOF

  cat >"$root/.agents/verify/skills-registry.yaml" <<'EOF'
id: fixture
commands: []
EOF

  cat >"$root/.agents/manifests/registry.yaml" <<'EOF'
id: fixture
globs: []
EOF

  cat >"$root/profiles/machine/example.yaml" <<'EOF'
schema_version: 0.1
profile:
  id: fixture
EOF

  cat >"$root/scripts/example.sh" <<'EOF'
#!/usr/bin/env bash
echo fixture
EOF

  cat >"$root/example-skill/SKILL.md" <<'EOF'
---
name: example-skill
description: Fixture skill.
---

# Example Skill
EOF

  cat >"$root/docs/guide.md" <<'EOF'
# Fixture Docs
EOF
}

ok_dir="$tmp_dir/ok"
write_fixture_repo "$ok_dir"
ok_registry_output="$(run_registry_yaml "$ok_dir")"
assert_contains "$ok_registry_output" "registry YAML parsed"
ok_frontmatter_output="$(run_skill_frontmatter "$ok_dir")"
assert_contains "$ok_frontmatter_output" "validated 1 skill entrypoints"
ok_output="$(run_public_safety "$ok_dir")"
assert_contains "$ok_output" "public-safety scan ok"

verify_requirements_output="$(
  ruby -ryaml -e '
    config = YAML.safe_load(File.read(ARGV.fetch(0)), aliases: false)
    required_artifacts = config.fetch("required_artifacts")
    required_pass_signals = config.fetch("required_pass_signals")
    missing = []
    missing << "required_artifact skills-provenance-audit.json" unless required_artifacts.include?("skills-provenance-audit.json")
    missing << "required_pass_signal registry-dispositions" unless required_pass_signals.include?("registry-dispositions")
    missing << "required_pass_signal skills-provenance-audit-test" unless required_pass_signals.include?("skills-provenance-audit-test")
    missing << "required_pass_signal provenance-audit" unless required_pass_signals.include?("provenance-audit")
    abort(missing.join("\n")) unless missing.empty?
    puts "verify requirements ok"
  ' "$repo_root/.agents/verify/skills-registry.yaml"
)"
assert_contains "$verify_requirements_output" "verify requirements ok"

unquoted_hash_dir="$tmp_dir/unquoted-hash"
cp -R "$ok_dir/." "$unquoted_hash_dir/"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Fixture skill.", "description: Uses @Test, #expect, and #require.")
  File.write(path, text)
' "$unquoted_hash_dir/example-skill/SKILL.md"
unquoted_hash_output="$(expect_failure run_skill_frontmatter "$unquoted_hash_dir")"
assert_contains "$unquoted_hash_output" "example-skill/SKILL.md: front matter description contains an unquoted #"

unquoted_tab_hash_dir="$tmp_dir/unquoted-tab-hash"
cp -R "$ok_dir/." "$unquoted_tab_hash_dir/"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Fixture skill.", "description: Uses @Test,\t#expect, and #require.")
  File.write(path, text)
' "$unquoted_tab_hash_dir/example-skill/SKILL.md"
unquoted_tab_hash_output="$(expect_failure run_skill_frontmatter "$unquoted_tab_hash_dir")"
assert_contains "$unquoted_tab_hash_output" "example-skill/SKILL.md: front matter description contains an unquoted #"

quoted_key_unquoted_hash_dir="$tmp_dir/quoted-key-unquoted-hash"
cp -R "$ok_dir/." "$quoted_key_unquoted_hash_dir/"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Fixture skill.", "\"description\": Uses @Test, #expect, and #require.")
  File.write(path, text)
' "$quoted_key_unquoted_hash_dir/example-skill/SKILL.md"
quoted_key_unquoted_hash_output="$(expect_failure run_skill_frontmatter "$quoted_key_unquoted_hash_dir")"
assert_contains "$quoted_key_unquoted_hash_output" "example-skill/SKILL.md: front matter description contains an unquoted #"

spaced_key_unquoted_hash_dir="$tmp_dir/spaced-key-unquoted-hash"
cp -R "$ok_dir/." "$spaced_key_unquoted_hash_dir/"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Fixture skill.", "description : Uses @Test, #expect, and #require.")
  File.write(path, text)
' "$spaced_key_unquoted_hash_dir/example-skill/SKILL.md"
spaced_key_unquoted_hash_output="$(expect_failure run_skill_frontmatter "$spaced_key_unquoted_hash_dir")"
assert_contains "$spaced_key_unquoted_hash_output" "example-skill/SKILL.md: front matter description contains an unquoted #"

multiline_unquoted_hash_dir="$tmp_dir/multiline-unquoted-hash"
cp -R "$ok_dir/." "$multiline_unquoted_hash_dir/"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Fixture skill.", "description: Uses @Test,\n  #expect, and #require.")
  File.write(path, text)
' "$multiline_unquoted_hash_dir/example-skill/SKILL.md"
multiline_unquoted_hash_output="$(expect_failure run_skill_frontmatter "$multiline_unquoted_hash_dir")"
assert_contains "$multiline_unquoted_hash_output" "example-skill/SKILL.md: front matter description contains an unquoted #"

quoted_prefix_comment_hash_dir="$tmp_dir/quoted-prefix-comment-hash"
cp -R "$ok_dir/." "$quoted_prefix_comment_hash_dir/"
ruby -e '
  path = ARGV.fetch(0)
  text = File.read(path).sub("description: Fixture skill.", "description: \"Uses @Test,\" #expect, and #require.")
  File.write(path, text)
' "$quoted_prefix_comment_hash_dir/example-skill/SKILL.md"
quoted_prefix_comment_hash_output="$(expect_failure run_skill_frontmatter "$quoted_prefix_comment_hash_dir")"
assert_contains "$quoted_prefix_comment_hash_output" "example-skill/SKILL.md: front matter description contains an unquoted #"

invalid_agents_manifest_dir="$tmp_dir/invalid-agents-manifest"
cp -R "$ok_dir/." "$invalid_agents_manifest_dir/"
cat >"$invalid_agents_manifest_dir/.agents/manifests/registry.yaml" <<'EOF'
id: [
EOF
invalid_agents_manifest_output="$(expect_failure run_registry_yaml "$invalid_agents_manifest_dir")"
assert_contains "$invalid_agents_manifest_output" ".agents/manifests/registry.yaml"

gitignore_leak_dir="$tmp_dir/gitignore-leak"
cp -R "$ok_dir/." "$gitignore_leak_dir/"
printf 'token=%s\n' "$(fake_openai_key)" >"$gitignore_leak_dir/.gitignore"
gitignore_leak_output="$(expect_failure run_public_safety "$gitignore_leak_dir")"
assert_contains "$gitignore_leak_output" ".gitignore: OpenAI key"

docs_leak_dir="$tmp_dir/docs-leak"
cp -R "$ok_dir/." "$docs_leak_dir/"
printf 'token=%s\n' "$(fake_openai_key)" >"$docs_leak_dir/docs/leak.txt"
docs_leak_output="$(expect_failure run_public_safety "$docs_leak_dir")"
assert_contains "$docs_leak_output" "docs/leak.txt: OpenAI key"

profile_artifact_leak_dir="$tmp_dir/profile-artifact-leak"
cp -R "$ok_dir/." "$profile_artifact_leak_dir/"
printf 'token=%s\n' "$(fake_openai_key)" >"$profile_artifact_leak_dir/profiles/.env"
profile_artifact_output="$(expect_failure run_public_safety "$profile_artifact_leak_dir")"
assert_contains "$profile_artifact_output" "profiles/.env: OpenAI key"

aws_leak_dir="$tmp_dir/aws-leak"
cp -R "$ok_dir/." "$aws_leak_dir/"
printf '%s\n' 'aws_access_key_id = AKIA1234567890ABCDEF' >"$aws_leak_dir/docs/aws.txt"
aws_leak_output="$(expect_failure run_public_safety "$aws_leak_dir")"
assert_contains "$aws_leak_output" "docs/aws.txt: AWS access key"

bearer_leak_dir="$tmp_dir/bearer-leak"
cp -R "$ok_dir/." "$bearer_leak_dir/"
printf '%s\n' 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' >"$bearer_leak_dir/docs/bearer.txt"
bearer_leak_output="$(expect_failure run_public_safety "$bearer_leak_dir")"
assert_contains "$bearer_leak_output" "docs/bearer.txt: Bearer token"

hidden_skill_leak_dir="$tmp_dir/hidden-skill-leak"
cp -R "$ok_dir/." "$hidden_skill_leak_dir/"
printf 'token=%s\n' "$(fake_openai_key)" >"$hidden_skill_leak_dir/example-skill/assets/.env"
hidden_skill_output="$(expect_failure run_public_safety "$hidden_skill_leak_dir")"
assert_contains "$hidden_skill_output" "example-skill/assets/.env: OpenAI key"

echo "skills_registry_verify test ok"
