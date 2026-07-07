# Claude Code Code-Review Proof - 2026-07-07

Related: [Manager Boundary](../manager-boundary.md),
[Setup And Update Workflow](../setup-update-workflow.md),
[proof profile](manager-pilot-code-review-claude-global.profile.yaml)

## Purpose

This note records the checked-in audit trail for the narrow Claude Code
promotion in this PR. It is historical proof only; the active install/update
path remains the current example profile plus `scripts/skills_sync.rb --plan`.

## Observed Evidence

- Proof target: `code-review` only, through `~/.claude/skills/code-review`.
- The historical proof profile emits the reviewed pinned manager command on a
  pre-write sync plan:
  `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill code-review --agent claude-code --global --yes`
- The reviewed example profile currently reports:

  ```text
  - keep | ok | claude_user/code-review | target=~/.claude/skills/code-review | source=./code-review | lock=sha256:f4edb7ea8b8e | client=supported | management=none | manager_reason=adapter already matches the reviewed plan | reason=manager-owned copy matches registry source digest
  ```

- Observed installed file set under `~/.claude/skills/code-review`:
  - `SKILL.md`
  - `references/review-checklists.md`
- `diff -qr --exclude metadata.json code-review ~/.claude/skills/code-review`
  exited `0`.
- The pinned upstream manager global listing currently includes `code-review`
  with `Claude Code` in its `agents` array. On this machine that global listing
  resolves the visible entry through the shared `~/.agents/skills/code-review`
  path, while the separate `~/.claude/skills/code-review` copy above remains
  the digest-checked proof target for this reviewed slice.

## Scope Boundary

- This proof does not promote other Claude Code targets.
- This proof does not change the shared-root OpenCode/Codex baseline.
- Follow-up Claude Code expansion still needs one reviewed target at a time.
