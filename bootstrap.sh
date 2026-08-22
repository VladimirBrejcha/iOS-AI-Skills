#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_dir"

cli=(npx --yes skills@1.5.14)
agents=(codex claude-code)
managed_skill_roots=(
  "${HOME}/.agents/skills"
  "${CLAUDE_CONFIG_DIR:-${HOME}/.claude}/skills"
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
  lifecycle-and-side-effects-correctness
  local-model-serving
  mechanism-audit
  meeting-transcription
  public-source-release-audit
  silent-pushes-setup
  spec-creation-updating
  swift-testing
  swiftui-view-refactor
  xcode-build
  xcode-cloud
)

run_add . \
  --global --agent "${agents[@]}" --skill "${owned_skills[@]}" --yes --copy

standalone_skills=(
  swift-concurrency
)

run_add 'jamesrochabrun/skills#2.1.1' \
  --global --agent "${agents[@]}" --skill "${standalone_skills[@]}" --yes --copy

asc_skills=(
  asc-app-create-ui
  asc-apple-ads
  asc-aso-audit
  asc-build-lifecycle
  asc-cli-usage
  asc-crash-triage
  asc-id-resolver
  asc-localize-metadata
  asc-metadata-sync
  asc-notarization
  asc-ppp-pricing
  asc-release-flow
  asc-revenuecat-catalog-sync
  asc-screenshot-resize
  asc-shots-pipeline
  asc-signing-setup
  asc-submission-health
  asc-subscription-localization
  asc-testflight-orchestration
  asc-whats-new-writer
  asc-workflow
  asc-xcode-build
)

asc_commit='c77169ab1a9595bbd426ec943797b36072ccf8e3'
asc_source_dir="$(mktemp -d "${TMPDIR:-/tmp}/asc-skills-source.XXXXXX")"
cleanup_asc_source() {
  rm -rf -- "$asc_source_dir"
}
trap cleanup_asc_source EXIT

git -C "$asc_source_dir" init --quiet
git -C "$asc_source_dir" remote add origin \
  'https://github.com/rorkai/app-store-connect-cli-skills.git'
git -C "$asc_source_dir" fetch --quiet --depth 1 origin "$asc_commit"
git -C "$asc_source_dir" checkout --quiet --detach FETCH_HEAD

if [[ "$(git -C "$asc_source_dir" rev-parse HEAD)" != "$asc_commit" ]]; then
  echo "ASC skill source did not resolve to the reviewed commit." >&2
  exit 1
fi

run_add "$asc_source_dir" \
  --global --agent "${agents[@]}" --skill "${asc_skills[@]}" --yes --copy

cleanup_asc_source
trap - EXIT

managed_skills=(
  "${owned_skills[@]}"
  "${standalone_skills[@]}"
  "${asc_skills[@]}"
)

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

echo "Installed the ${#managed_skills[@]}-skill global baseline. Restart agent clients to reload skills."
