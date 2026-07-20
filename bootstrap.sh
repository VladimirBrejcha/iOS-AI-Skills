#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"

cli=(npx --yes skills@1.5.14)
agents=(codex claude-code opencode)
managed_skill_roots=(
  "${HOME}/.agents/skills"
  "${HOME}/.claude/skills"
)

run_add() {
  local add_log
  add_log="$(mktemp "${TMPDIR:-/tmp}/agent-skills-add.XXXXXX")"

  if ! "${cli[@]}" add "$@" 2>&1 | tee "$add_log"; then
    rm -f "$add_log"
    return 1
  fi

  if grep -Fq "Failed to install" "$add_log"; then
    echo "skills@1.5.14 reported a partial installation." >&2
    rm -f "$add_log"
    return 1
  fi

  rm -f "$add_log"
}

owned_skills=(
  code-review
  gemini-files-api
  harness-engineering
  hint-overlay-visual-verification
  ios-xcodegen
  mechanism-audit
  meeting-transcription
  silent-pushes-setup
  spec-creation-updating
  swift-testing
  swiftui-view-refactor
  xcode-build
  xcode-cloud
)

run_add . \
  --global --agent "${agents[@]}" --skill "${owned_skills[@]}" --yes --copy

run_add 'pbakaus/impeccable#skill-v3.9.1' \
  --global --agent "${agents[@]}" --skill impeccable --yes --copy

run_add 'jamesrochabrun/skills#2.1.1' \
  --global --agent "${agents[@]}" --skill swift-concurrency --yes --copy

managed_skills=("${owned_skills[@]}" impeccable swift-concurrency)

for skill_root in "${managed_skill_roots[@]}"; do
  missing=false
  for skill in "${managed_skills[@]}"; do
    if [[ ! -f "$skill_root/$skill/SKILL.md" ]]; then
      echo "Missing managed skill entrypoint: $skill_root/$skill/SKILL.md" >&2
      missing=true
    fi
  done
  if [[ "$missing" == true ]]; then
    exit 1
  fi
done

for skill_root in "${managed_skill_roots[@]}"; do
  bash "$skill_root/gemini-files-api/scripts/bootstrap.sh"
  if [[ ! -f "$skill_root/gemini-files-api/scripts/node_modules/@google/genai/package.json" ]]; then
    echo "Gemini dependency bootstrap did not complete in $skill_root." >&2
    exit 1
  fi
done

echo "Installed the 15-skill global baseline. Restart agent clients to reload skills."
