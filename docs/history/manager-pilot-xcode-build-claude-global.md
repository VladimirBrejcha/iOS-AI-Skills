# Claude Code Xcode-Build Proof - 2026-07-08

Related: [Manager Boundary](../manager-boundary.md),
[Setup And Update Workflow](../setup-update-workflow.md),
[proof profile](manager-pilot-xcode-build-claude-global.profile.yaml)

## Purpose

This note records the checked-in audit trail for the narrow Claude Code
promotion in this PR. It is historical proof only; the active install/update
path remains the current example profile plus `scripts/skills_sync.rb --plan`.

## Observed Evidence

- Proof target: `xcode-build` only, through `~/.claude/skills/xcode-build`.
- The reviewed example profile emitted the reviewed pinned manager command on a
  pre-write sync plan:
  `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill xcode-build --agent claude-code --global --yes`
- The reviewed example profile currently reports:

  ```text
  - keep | ok | claude_user/xcode-build | target=~/.claude/skills/xcode-build | source=./xcode-build | lock=sha256:fcc1b4b8d9e0 | client=supported | management=none | manager_reason=adapter already matches the reviewed plan | reason=manager-owned copy matches registry source digest
  ```

- Observed installed file set under `~/.claude/skills/xcode-build`:
  - `references/CLI_REFERENCE.md`
  - `references/XCUITEST_GUIDE.md`
  - `SKILL.md`
- `diff -qr --exclude metadata.json xcode-build ~/.claude/skills/xcode-build`
  exited `0`.
- The pinned upstream manager global listing currently includes `xcode-build`
  with `Claude Code` in its `agents` array.

## Scope Boundary

- This proof does not promote other Claude Code targets.
- This proof does not change the shared-root OpenCode/Codex baseline.
- Follow-up Claude Code expansion still needs one reviewed target at a time.
