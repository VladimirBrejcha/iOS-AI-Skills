#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

doc="docs/setup-update-workflow.md"

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_text() {
  local needle="$1"
  grep -Fq -- "$needle" "$doc" || fail "$doc missing required text: $needle"
}

reject_regex() {
  local label="$1"
  local pattern="$2"
  if ruby -e 'text = File.read(ARGV[0]); pattern = Regexp.new(ARGV[1]); exit(text.match?(pattern) ? 0 : 1)' "$doc" "$pattern"; then
    fail "$doc contains forbidden pattern: $label"
  fi
}

[[ -f "$doc" ]] || fail "$doc is missing"

require_text "Status: active-partial"
require_text "Last updated: 2026-07-06"
require_text "git clone https://github.com/fiveonecode/agent-skills.git"
require_text "git pull --ff-only"
require_text "npx --yes skills@1.5.14 --version"
require_text "npx --yes skills@1.5.14 add fiveonecode/agent-skills"
require_text "npx --yes skills@1.5.14 ls --global --json"
require_text "npx --yes skills@1.5.14 ls --json"
require_text "scripts/skills_catalog.rb --check"
require_text "scripts/skills_doctor.rb --check-upstream"
require_text "scripts/skills_doctor.rb --check-manager"
require_text "scripts/skills_upstream_updates.rb --fail-on-stale"
require_text "scripts/skills_sync.rb --plan --json"
require_text "--manager-project-lock path/to/product-repo/skills-lock.json"
require_text "manual-review"
require_text "upstream-manager"
require_text "Restart any already-running app or CLI session"

expected_count="$(grep -c "Expected outcome:" "$doc")"
if [[ "$expected_count" -lt 10 ]]; then
  fail "$doc should state expected outcomes for setup/update steps; found $expected_count"
fi

reject_regex "unpinned npx skills command" 'npx[[:space:]]+skills([^@[:alnum:]_.-]|$)'
reject_regex "skills latest tag" 'skills@latest'
reject_regex "sync apply fallback" 'scripts/skills_sync\.rb[[:space:]]+--apply'
reject_regex "experimental restore path" 'experimental_install'
reject_regex "destructive adapter deletion" 'rm[[:space:]]+-rf'
reject_regex "manual symlink creation" 'ln[[:space:]]+-s'
reject_regex "manual recursive copy" 'cp[[:space:]]+-R'
mac_user_path='/Us''ers/[A-Za-z0-9._-]+'
linux_user_path='/ho''me/[A-Za-z0-9._-]+'
file_url_pattern='file:''//'
github_token_pattern='github_''pat_|gh''p_|gh''o_|gh''u_|gh''s_|gh''r_'

reject_regex "macOS personal path" "$mac_user_path"
reject_regex "Linux personal path" "$linux_user_path"
reject_regex "Windows personal path" '[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s]+'
reject_regex "file URL" "$file_url_pattern"
reject_regex "GitHub token" "$github_token_pattern"
reject_regex "OpenAI key" 'sk-[A-Za-z0-9_-]{20,}'
reject_regex "bearer token" 'Authorization:[[:space:]]*Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{20,}'

echo "skills setup/update workflow docs test ok"
