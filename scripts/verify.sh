#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

bash -n bootstrap.sh

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const bootstrap = fs.readFileSync("bootstrap.sh", "utf8");
const readme = fs.readFileSync("README.md", "utf8");

function fail(message) {
  throw new Error(message);
}

function parseArray(name) {
  const match = bootstrap.match(new RegExp(`^${name}=\\(\\n([\\s\\S]*?)^\\)`, "m"));
  if (!match) fail(`Missing ${name} array in bootstrap.sh`);
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

if (!bootstrap.includes("npx --yes skills@1.5.14")) {
  fail("bootstrap.sh must remain pinned to skills@1.5.14");
}
if (!bootstrap.includes("agents=(codex claude-code)")) {
  fail("The global baseline must target Codex and Claude Code only");
}
if (!bootstrap.includes('${CLAUDE_CONFIG_DIR:-${HOME}/.claude}/skills')) {
  fail("The Claude Code root must honor CLAUDE_CONFIG_DIR");
}
if (bootstrap.includes("pbakaus/impeccable") || /agents=\([^\n]*opencode/.test(bootstrap)) {
  fail("Impeccable must remain project-local and OpenCode must remain outside this baseline");
}

const owned = parseArray("owned_skills");
const asc = parseArray("asc_skills");
const checkedIn = fs.readdirSync(".", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(entry.name, "SKILL.md")))
  .map((entry) => entry.name)
  .sort();

if (JSON.stringify([...owned].sort()) !== JSON.stringify(checkedIn)) {
  fail(`owned_skills does not match checked-in skills: ${checkedIn.join(", ")}`);
}

const documentedOwnedSection = readme.match(/^- 51Code-owned:([\s\S]*?)^- Third-party:/m)?.[1];
if (!documentedOwnedSection) fail("README.md is missing the 51Code-owned skill list");
const documentedOwned = [...documentedOwnedSection.matchAll(/`([^`]+)`/g)]
  .map((match) => match[1])
  .sort();
if (JSON.stringify(documentedOwned) !== JSON.stringify([...owned].sort())) {
  fail("README.md owned skill list does not match bootstrap.sh");
}

if (owned.length !== 15 || asc.length !== 22) {
  fail(`Expected 15 owned and 22 ASC skills; found ${owned.length} and ${asc.length}`);
}

const managed = [...owned, "swift-concurrency", ...asc];
if (managed.length !== 38 || new Set(managed).size !== managed.length) {
  fail("The 38-skill global baseline contains a missing or duplicate name");
}

console.log("validated direct package contract");
NODE

ruby -ryaml <<'RUBY'
Dir.glob("*/SKILL.md").sort.each do |file|
  lines = File.readlines(file, chomp: true)
  abort "#{file}: missing YAML front matter" unless lines.first == "---"

  closing = lines[1..]&.index("---")
  abort "#{file}: unterminated YAML front matter" unless closing

  begin
    metadata = YAML.safe_load(
      lines[1, closing].join("\n"),
      aliases: false,
      filename: file
    )
  rescue Psych::SyntaxError => error
    abort "#{file}: invalid YAML front matter: #{error.problem}"
  end

  abort "#{file}: front matter must be a mapping" unless metadata.is_a?(Hash)
  abort "#{file}: name must match its directory" unless metadata["name"] == File.dirname(file)
  abort "#{file}: missing description" unless metadata["description"].is_a?(String) && !metadata["description"].strip.empty?
end

puts "validated skill front matter YAML"
RUBY

ruby <<'RUBY'
patterns = {
  "machine-local home path" => %r{/(?:Users|home)/[A-Za-z0-9._-]+(?:/|\b)},
  "AWS access key" => /AKIA[0-9A-Z]{16}/,
  "bearer credential" => /Authorization:\s*Bearer\s+[A-Za-z0-9._~-]{16,}/i,
  "GitHub token" => /gh[pousr]_[A-Za-z0-9]{20,}/,
  "API secret" => /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
  "private key" => /-----BEGIN (?:RSA )?PRIVATE KEY-----/
}

files = IO.popen(["git", "ls-files", "-co", "--exclude-standard", "-z"], &:read).split("\0")
failures = files.sort.filter_map do |file|
  next unless File.file?(file) && !File.symlink?(file)

  content = File.binread(file)
  next if content.include?("\0")

  text = content.force_encoding(Encoding::UTF_8)
  next unless text.valid_encoding?

  labels = patterns.filter_map { |label, pattern| label if text.match?(pattern) }
  "#{file}: #{labels.join(", ")}" unless labels.empty?
end

abort "public-safety scan failed:\n#{failures.join("\n")}" unless failures.empty?
puts "public-safety scan passed"
RUBY

while IFS= read -r -d '' script; do
  [[ "$script" == *.sh && -f "$script" && ! -L "$script" ]] || continue
  bash -n "$script"
done < <(git ls-files -co --exclude-standard -z)

grep -Fx 'npm ci --ignore-scripts' gemini-files-api/scripts/bootstrap.sh >/dev/null

silent-pushes-setup/scripts/test_skill_contract.sh
ios-xcodegen/scripts/test_contract.sh
xcode-cloud/scripts/test_skill_contract.sh
meeting-transcription/scripts/test_transcribe_meeting_audio.sh
node gemini-files-api/scripts/test_gemini_mm.mjs
ruby scripts/test_check_project_skill_ownership.rb

echo "agent-skills verification passed"
