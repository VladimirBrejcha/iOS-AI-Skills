#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"

cli=(npx --yes skills@1.5.14)
agents=(codex claude-code opencode)

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

retired_impeccable_skills=(
  adapt
  animate
  audit
  bolder
  clarify
  colorize
  critique
  delight
  distill
  layout
  optimize
  overdrive
  polish
  quieter
  shape
  typeset
)

"${cli[@]}" remove "${retired_impeccable_skills[@]}" \
  --global --agent "${agents[@]}" --yes

"${cli[@]}" add . \
  --global --agent "${agents[@]}" --skill "${owned_skills[@]}" --yes --copy

"${cli[@]}" add 'pbakaus/impeccable#skill-v3.9.1' \
  --global --agent "${agents[@]}" --skill impeccable --yes --copy

"${cli[@]}" add 'jamesrochabrun/skills#2.1.1' \
  --global --agent "${agents[@]}" --skill swift-concurrency --yes --copy

echo "Installed the 15-skill global baseline. Restart agent clients to reload skills."
