#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

bash -n bootstrap.sh

node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const bootstrap = fs.readFileSync("bootstrap.sh", "utf8");

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
if (owned.length !== 13 || asc.length !== 23) {
  fail(`Expected 13 owned and 23 ASC skills; found ${owned.length} and ${asc.length}`);
}

const managed = [...owned, "swift-concurrency", ...asc];
if (managed.length !== 37 || new Set(managed).size !== managed.length) {
  fail("The 37-skill global baseline contains a missing or duplicate name");
}

for (const skill of checkedIn) {
  const file = path.join(skill, "SKILL.md");
  const source = fs.readFileSync(file, "utf8");
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) fail(`${file}: missing YAML front matter`);

  const name = frontmatter[1].match(/^name:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1]?.trim();
  if (name !== skill) fail(`${file}: name must match its directory`);

  const description = frontmatter[1].match(/^description:\s*(.*)$/m)?.[1]?.trim();
  if (description === undefined || description === "") {
    fail(`${file}: missing description`);
  }
}

console.log("validated direct package contract");
NODE

while IFS= read -r script; do
  bash -n "$script"
done < <(find . -path './.git' -prune -o -type f -name '*.sh' -print | LC_ALL=C sort)

silent-pushes-setup/scripts/test_skill_contract.sh
ios-xcodegen/scripts/test_contract.sh
xcode-cloud/scripts/test_skill_contract.sh
meeting-transcription/scripts/test_transcribe_meeting_audio.sh
node gemini-files-api/scripts/test_gemini_mm.mjs

echo "agent-skills verification passed"
