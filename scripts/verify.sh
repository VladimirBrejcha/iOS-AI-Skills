#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile_path="$repo_root/.agents/verify/skills-registry.yaml"
artifacts_dir="$(mktemp -d "${TMPDIR:-/tmp}/agent-skills-verify.XXXXXX")"
trap 'rm -rf "$artifacts_dir"' EXIT

REPO_ROOT="$repo_root" \
PROFILE_PATH="$profile_path" \
ARTIFACTS_DIR="$artifacts_dir" \
ruby -ropen3 -ryaml <<'RUBY'
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

failure_patterns = profile.fetch("failure_patterns", []).map do |pattern|
  [pattern, Regexp.new(pattern, Regexp::IGNORECASE)]
rescue RegexpError => error
  abort "verification profile has invalid failure pattern #{pattern.inspect}: #{error.message}"
end

# The harness normally supplies this manifest. The standalone gate verifies the
# whole repository, so record that scope before checking the profile artifacts.
File.write(File.join(artifacts_dir, "paths.txt"), ".\n")

commands.each do |entry|
  id = entry.fetch("id")
  command = entry.fetch("run").to_s
  abort "verification command is blank: #{id}" if command.strip.empty?

  command = command.gsub("{artifactsDir}", artifacts_dir)
  puts "==> #{id}"
  $stdout.flush

  stdout, stderr, status = Open3.capture3(
    "/bin/bash", "-o", "errexit", "-o", "pipefail", "-c", command,
    chdir: repo_root
  )
  $stdout.write(stdout)
  $stderr.write(stderr)
  $stdout.flush
  $stderr.flush

  abort "verification failed: #{id}" unless status.success?

  output = "#{stdout}\n#{stderr}"
  failure_match = failure_patterns.find { |_pattern, regexp| regexp.match?(output) }
  if failure_match
    abort "verification failed: #{id} matched failure pattern #{failure_match.first.inspect}"
  end
end

artifact_files = Dir.glob("**/*", File::FNM_DOTMATCH, base: artifacts_dir).select do |path|
  File.file?(File.join(artifacts_dir, path))
end
required_artifacts = profile.fetch("required_artifacts", [])
missing_artifacts = required_artifacts.reject do |pattern|
  artifact_files.any? do |path|
    File.fnmatch?(pattern, path, File::FNM_PATHNAME | File::FNM_DOTMATCH | File::FNM_EXTGLOB)
  end
end
unless missing_artifacts.empty?
  abort "verification missing required artifacts: #{missing_artifacts.join(", ")}"
end

puts "agent-skills verification ok (#{commands.length} commands)"
RUBY
