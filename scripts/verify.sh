#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile_path="$repo_root/.agents/verify/skills-registry.yaml"
artifacts_dir="$(mktemp -d "${TMPDIR:-/tmp}/agent-skills-verify.XXXXXX")"
trap 'rm -rf "$artifacts_dir"' EXIT

REPO_ROOT="$repo_root" \
PROFILE_PATH="$profile_path" \
ARTIFACTS_DIR="$artifacts_dir" \
ruby -ryaml <<'RUBY'
repo_root = ENV.fetch("REPO_ROOT")
profile_path = ENV.fetch("PROFILE_PATH")
artifacts_dir = ENV.fetch("ARTIFACTS_DIR")

unless artifacts_dir.match?(%r{\A[[:alnum:]_/.\-]+\z})
  abort "temporary artifact path contains unsupported characters"
end

profile = YAML.safe_load(
  File.read(profile_path),
  aliases: false,
  filename: profile_path
)
commands = profile.fetch("commands")
command_ids = commands.map { |entry| entry.fetch("id") }
duplicate_ids = command_ids.group_by { |id| id }.select { |_id, values| values.length > 1 }.keys
abort "verification profile has duplicate command ids: #{duplicate_ids.join(", ")}" unless duplicate_ids.empty?

required_ids = profile.fetch("required_pass_signals")
missing_ids = required_ids - command_ids
abort "verification profile is missing required commands: #{missing_ids.join(", ")}" unless missing_ids.empty?

commands.each do |entry|
  id = entry.fetch("id")
  command = entry.fetch("run").to_s
  abort "verification command is blank: #{id}" if command.strip.empty?

  command = command.gsub("{artifactsDir}", artifacts_dir)
  puts "==> #{id}"
  $stdout.flush

  passed = system("/bin/bash", "-o", "pipefail", "-c", command, chdir: repo_root)
  abort "verification failed: #{id}" unless passed
end

puts "agent-skills verification ok (#{commands.length} commands)"
RUBY
