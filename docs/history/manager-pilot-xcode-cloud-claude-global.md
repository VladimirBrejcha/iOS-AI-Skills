# Claude Code Xcode-Cloud Proof - 2026-07-08

Related: [Manager Boundary](../manager-boundary.md),
[Setup And Update Workflow](../setup-update-workflow.md),
[proof profile](manager-pilot-xcode-cloud-claude-global.profile.yaml)

## Purpose

This note records the checked-in audit trail for the narrow Claude Code
promotion in this PR. It is historical proof only; the active install/update
path remains the current example profile plus `scripts/skills_sync.rb --plan`.

## Superseded Status

This proof predates the 2026-07-16 replacement of the `xcode-cloud` source and
does not prove the replacement content. The checked-in example profile keeps
`xcode-cloud` in `manual-review` until a fresh manager write and digest check
are recorded. The companion historical proof profile is also blocked in
`manual-review` and must not be reused as an install path.

## Observed Evidence

- Proof target: `xcode-cloud` only, through `~/.claude/skills/xcode-cloud`.
- The reviewed example profile emitted the reviewed pinned manager command on a
  pre-write sync plan:
  `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill xcode-cloud --agent claude-code --global --yes`
- The reviewed example profile currently reports:

  ```text
  - keep | ok | claude_user/xcode-cloud | target=~/.claude/skills/xcode-cloud | source=./xcode-cloud | lock=sha256:64807117128a | client=supported | management=none | manager_reason=adapter already matches the reviewed plan | reason=manager-owned copy matches registry source digest
  ```

- Observed installed file set under `~/.claude/skills/xcode-cloud`:
  - `SKILL.md`
  - `assets/ci_post_clone.sh`
  - `assets/ci_post_xcodebuild.sh`
  - `assets/ci_pre_xcodebuild.sh`
  - `references/xcode-cloud-notes.md`
- `diff -qr --exclude metadata.json xcode-cloud ~/.claude/skills/xcode-cloud`
  exited `0`.
- The pinned upstream manager global listing currently includes `xcode-cloud`
  with `Claude Code` in its `agents` array.

## Scope Boundary

- This proof does not promote other Claude Code targets.
- This proof does not change the shared-root OpenCode/Codex baseline.
- Follow-up Claude Code expansion still needs one reviewed target at a time.
