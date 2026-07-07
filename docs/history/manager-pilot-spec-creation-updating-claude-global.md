# Claude Code Spec-Creation-Updating Proof - 2026-07-08

Related: [Manager Boundary](../manager-boundary.md),
[Setup And Update Workflow](../setup-update-workflow.md),
[proof profile](manager-pilot-spec-creation-updating-claude-global.profile.yaml)

## Purpose

This note records the checked-in audit trail for the narrow Claude Code
promotion in this PR. It is historical proof only; the active install/update
path remains the current example profile plus `scripts/skills_sync.rb --plan`.

## Observed Evidence

- Proof target: `spec-creation-updating` only, through
  `~/.claude/skills/spec-creation-updating`.
- The reviewed example profile emitted the reviewed pinned manager command on a
  pre-write sync plan:
  `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill spec-creation-updating --agent claude-code --global --yes`
- The reviewed example profile currently reports:

  ```text
  - keep | ok | claude_user/spec-creation-updating | target=~/.claude/skills/spec-creation-updating | source=./spec-creation-updating | lock=sha256:9a3cad891dd6 | client=supported | management=none | manager_reason=adapter already matches the reviewed plan | reason=manager-owned copy matches registry source digest
  ```

- Observed installed file set under
  `~/.claude/skills/spec-creation-updating`:
  - `SKILL.md`
  - `agents/openai.yaml`
  - `references/spec-must-have-checklist.md`
  - `references/spec-review-scorecard.md`
  - `references/spec-template.md`
- `diff -qr --exclude metadata.json spec-creation-updating ~/.claude/skills/spec-creation-updating`
  exited `0`.
- The pinned upstream manager global listing currently includes
  `spec-creation-updating` with `Claude Code` in its `agents` array.

## Scope Boundary

- This proof does not promote other Claude Code targets.
- This proof does not change the shared-root OpenCode/Codex baseline.
- Follow-up Claude Code expansion still needs one reviewed target at a time.
