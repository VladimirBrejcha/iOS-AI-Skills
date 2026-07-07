# Claude Code iOS-XcodeGen Proof - 2026-07-08

Related: [Manager Boundary](../manager-boundary.md),
[Setup And Update Workflow](../setup-update-workflow.md),
[proof profile](manager-pilot-ios-xcodegen-claude-global.profile.yaml)

## Purpose

This note records the checked-in audit trail for the narrow Claude Code
promotion in this PR. It is historical proof only; the active install/update
path remains the current example profile plus `scripts/skills_sync.rb --plan`.

## Observed Evidence

- Proof target: `ios-xcodegen` only, through `~/.claude/skills/ios-xcodegen`.
- The reviewed example profile emitted the reviewed pinned manager command on a
  pre-write sync plan:
  `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill ios-xcodegen --agent claude-code --global --yes`
- The reviewed example profile currently reports:

  ```text
  - keep | ok | claude_user/ios-xcodegen | target=~/.claude/skills/ios-xcodegen | source=./ios-xcodegen | lock=sha256:8cb369d77201 | client=supported | management=none | manager_reason=adapter already matches the reviewed plan | reason=manager-owned copy matches registry source digest
  ```

- Observed installed file set under `~/.claude/skills/ios-xcodegen`:
  - `SKILL.md`
- `diff -qr --exclude metadata.json ios-xcodegen ~/.claude/skills/ios-xcodegen`
  exited `0`.
- The pinned upstream manager global listing currently includes `ios-xcodegen`
  with `Claude Code` in its `agents` array.

## Scope Boundary

- This proof does not promote other Claude Code targets.
- This proof does not change the shared-root OpenCode/Codex baseline.
- Follow-up Claude Code expansion still needs one reviewed target at a time.
