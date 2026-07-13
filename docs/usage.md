# Usage

Status: active-partial
Last updated: 2026-07-08

Related: [README](../README.md), [Registry Contract](registry-contract.md),
[Setup And Update Workflow](setup-update-workflow.md),
[Contributing](contributing.md), [Manager Boundary](manager-boundary.md)

## Prerequisites

- Node.js `>=18`
- Ruby with the standard `yaml` library available via `ruby -ryaml`
- Git
- `npx` available on `PATH`
- A clone of this repo for doctor/sync validation:

```bash
git clone https://github.com/fiveonecode/agent-skills.git
cd agent-skills
```

## Public Install Commands

Registry coverage is currently active-partial. Only skills listed in
`skills.registry.yaml` are registry-covered; other top-level skill folders stay
in backlog until a follow-up coverage PR registers them.

Install one skill into the reviewed shared global manager root:

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill code-review \
  --agent codex \
  --global \
  --yes
```

`meeting-transcription` requires the separately owned `gemini-files-api`
wrapper. Install both into the same manager root, then bootstrap the pinned npm
dependencies. This pair requires Node.js 20 or newer:

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill gemini-files-api \
  --agent codex \
  --global \
  --yes
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill meeting-transcription \
  --agent codex \
  --global \
  --yes
bash ~/.agents/skills/gemini-files-api/scripts/bootstrap.sh
```

Install one skill into a consumer repo for Codex. Run this from the product
repo, not from the `agent-skills` clone:

```bash
cd path/to/product-repo
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill code-review \
  --agent codex \
  --yes
```

OpenCode support for the reviewed global skills currently comes through the
same manager-owned `~/.agents/skills` root used by the pinned Codex command;
verify it with `npx --yes skills@1.5.14 list --global --json` before treating a
skill as installed for OpenCode. Claude Code support is currently proven for
every active registry-local skill through the separate `~/.claude/skills`
root. External-git entries such as `swift-concurrency` and `swiftui-pro`,
repo-local consumers, and unclassified top-level skills remain manual-review
until they move to reviewed support in the registry and profile examples.

Install a reviewed Claude Code target:

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill code-review \
  --agent claude-code \
  --global \
  --yes
```

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill harness-engineering \
  --agent claude-code \
  --global \
  --yes
```

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill gemini-files-api \
  --agent claude-code \
  --global \
  --yes
```

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill meeting-transcription \
  --agent claude-code \
  --global \
  --yes
```

After installing or updating the Claude Code dependency, run:

```bash
bash ~/.claude/skills/gemini-files-api/scripts/bootstrap.sh
```

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill spec-creation-updating \
  --agent claude-code \
  --global \
  --yes
```

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill ios-xcodegen \
  --agent claude-code \
  --global \
  --yes
```

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill xcode-build \
  --agent claude-code \
  --global \
  --yes
```

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill xcode-cloud \
  --agent claude-code \
  --global \
  --yes
```

List the current reviewed global install ids from this clone:

```bash
scripts/skills_catalog.rb --json | ruby -rjson -e '
  catalog = JSON.parse($stdin.read)
  catalog.fetch("skills")
    .select { |skill| skill["install"].is_a?(Hash) }
    .sort_by { |skill| skill.fetch("id") }
    .each { |skill| puts skill.fetch("id") }
'
```

This list is derived from the same catalog generator path that emits reviewed
global install commands for the current example profile, so renamed exports and
other manual-review cases stay out of the list until a follow-up
coverage/profile PR promotes them.

Do not use `npx --yes skills@1.5.14 add fiveonecode/agent-skills --list` as a
registry coverage list. It enumerates every top-level skill folder in the
repository, including backlog entries outside the active-partial contract.

Use the generated catalog for the reviewed public registry-covered set:

```bash
scripts/skills_catalog.rb --check
ruby -rjson -e '
  catalog = JSON.parse(File.read("skills.catalog.json"))
  catalog.fetch("skills").each do |skill|
    puts "#{skill.fetch("id")}\t#{skill.fetch("status")}\t#{skill.fetch("description")}"
  end
'
```

The same data is available as readable Markdown in
[`docs/skills-catalog.md`](skills-catalog.md). Both files are generated from
registry, lock, the checked-in example profile, and `SKILL.md` metadata.

List installed global skills:

```bash
npx --yes skills@1.5.14 ls --global --json
```

List installed project skills:

```bash
npx --yes skills@1.5.14 ls --json
```

## 51Code Operator Workflow

For a step-by-step new-machine, existing-machine, repo-local setup, failure
recovery, and restart runbook, use
[Setup And Update Workflow](setup-update-workflow.md). This section remains a
compact command reference.

Start from a clean clone:

```bash
cd path/to/agent-skills
git switch main
git pull --ff-only
git status --short --branch
```

Run source and policy checks:

```bash
scripts/skills_doctor.rb
scripts/skills_doctor.rb --check-upstream
scripts/skills_doctor.rb --check-manager
scripts/skills_catalog.rb --check
scripts/skills_provenance_audit.rb --markdown
scripts/skills_upstream_updates.rb --markdown
```

Generate a reviewable adapter plan:

```bash
scripts/skills_sync.rb --plan
scripts/skills_sync.rb --plan --json
```

Audit unregistered or copied-source backlog before promoting skills or
changing source ownership:

```bash
scripts/skills_provenance_audit.rb --markdown
scripts/skills_provenance_audit.rb --json
```

Read `management.owner` before doing anything:

- `upstream-manager`: run the emitted pinned command when the PR/task has
  reviewed that exact write.
- `manual-review`: do not write; document the missing manager support or profile
  gap.
- `none`: no manager write is needed.

After any reviewed upstream-manager write, rerun:

```bash
npx --yes skills@1.5.14 ls --global --json
scripts/skills_doctor.rb --check-manager
scripts/skills_sync.rb --plan --json
```

Expected outcome: the changed adapter reports `keep | ok` or equivalent JSON
state, and doctor reports the manager-owned copy or symlink as matching the
registry source/lock policy.

## Updating Installed Skills

Use manager updates only for skills already installed by the upstream manager
and only after reviewing registry/lock state. The upstream `update` command has
no `--agent` filter, so keep unreviewed mixed-agent global installs in manual
review.

Inspect the current global install entry for the skill id first:

```bash
npx --yes skills@1.5.14 ls --global --json | ruby -rjson -e '
  skill = ARGV.fetch(0)
  entries = JSON.parse(STDIN.read).select { |entry| entry["name"] == skill }
  puts JSON.pretty_generate(entries)
' code-review
```

Continue only when every matching entry is covered by the reviewed profile
surfaces you intend to update. If the same skill id is also installed for an
unreviewed agent or root, do not run `update --global <skill>` from this
workflow.

Update one reviewed global skill only after confirming every installed manager
surface for that skill is in the reviewed profile:

```bash
npx --yes skills@1.5.14 update --global --yes code-review
```

Project-installed skills stay manual-review for this registry while upstream
issues #1519 and #1530 remain open for update failure signaling and project
source handling. Inspect current project state first instead of treating
`update --project` as a default workflow:

```bash
npx --yes skills@1.5.14 ls --json
scripts/skills_doctor.rb --check-manager
scripts/skills_sync.rb --plan --json
```

Do not run an unscoped global update command from this workflow. If a reviewed
task needs a full global sweep, first confirm the installed global set:

```bash
npx --yes skills@1.5.14 ls --global --json
```

Then update only the reviewed `fiveonecode/agent-skills` skill ids one at a
time with the scoped command above.

Do not use `update` as a discovery command. Use the top-level help command when
checking CLI syntax:

```bash
npx --yes skills@1.5.14 --help
```

## Editing A 51Code-Owned Skill

```bash
cd path/to/agent-skills
git switch -c codex/edit-skill-name
# Edit skill-name/SKILL.md and any references/scripts/assets.
# Commit or clean reviewed source/registry edits before refreshing the lock.
tmp_lock="$(mktemp "${TMPDIR:-/tmp}/skills.lock.yaml.XXXXXX")"
scripts/skills_doctor.rb --print-lock >"$tmp_lock" &&
  mv "$tmp_lock" skills.lock.yaml
scripts/skills_catalog.rb --write
scripts/skills_doctor.rb
scripts/skills_catalog.rb --check
scripts/skills_sync.rb --plan --json
git diff --check
```

Update the README skills table if top-level skill inventory changed. Regenerate
the catalog if the public name, description, folder, supported clients, or
registry-covered source metadata changed.

## Importing A Third-Party Update

1. Run the stale-pin report:

   ```bash
   scripts/skills_upstream_updates.rb --markdown
   scripts/skills_upstream_updates.rb --json
   scripts/skills_upstream_updates.rb --fail-on-stale
   ```

   Expected outcome: the report lists whether external pins are `current`,
   `stale`, `missing-current-tag`, or `pin-mismatch`. Use `--fail-on-stale`
   in scheduled checks or before starting a third-party update PR.

2. For a stale pin, review the upstream diff, license, skill instructions, and
   generated adapter impact before editing this registry.
3. Update `skills.registry.yaml` with the new upstream tag and
   `source.observed_commit`. Record the reviewed date in `source.observed_at`.
4. Regenerate `skills.lock.yaml`:

   ```bash
   tmp_lock="$(mktemp "${TMPDIR:-/tmp}/skills.lock.yaml.XXXXXX")"
   scripts/skills_doctor.rb --check-upstream --print-lock >"$tmp_lock" &&
     mv "$tmp_lock" skills.lock.yaml
   ```

5. Regenerate the catalog:

   ```bash
   scripts/skills_catalog.rb --write
   scripts/skills_catalog.rb --check
   ```

6. Run doctor and sync-plan checks:

   ```bash
   scripts/skills_doctor.rb --check-upstream
   scripts/skills_doctor.rb --check-manager
   scripts/skills_sync.rb --plan --json
   ```

7. Open a PR that includes registry diff, lock diff, catalog diff, observed
   commit, reviewed date evidence, license review result, and validation
   output.

If the third-party skill is modified locally, convert the maintained copy to
`registry-local` and keep the upstream provenance in `notes` or the PR
description, or create a separate registry-owned wrapper skill.

## Troubleshooting

If a skill does not appear in an agent:

1. Confirm the upstream manager sees it:

   ```bash
   npx --yes skills@1.5.14 ls --global --json
   ```

2. Confirm the registry policy sees it:

   ```bash
   scripts/skills_doctor.rb --check-manager
   scripts/skills_sync.rb --plan --json
   ```

3. Restart the agent app or CLI if the adapter exists but the current session
   has not loaded the new skill.

If sync-plan says `manual-review`, do not hand-edit consumer folders. The
action needs either upstream manager support, profile changes, or a documented
exception.
