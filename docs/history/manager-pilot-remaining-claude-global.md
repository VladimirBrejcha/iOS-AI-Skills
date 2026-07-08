# Claude Code Remaining Active Registry-Local Proof - 2026-07-08

Related: [Manager Boundary](../manager-boundary.md),
[Setup And Update Workflow](../setup-update-workflow.md),
[proof profile](manager-pilot-remaining-claude-global.profile.yaml)

## Purpose

This note records the checked-in audit trail for the reviewed batch promotion
of the remaining active registry-local skills to Claude Code. It is historical
proof only; the active install/update path remains the current example profile
plus `scripts/skills_sync.rb --plan`.

## Observed Evidence

- Proof targets:
  - `swift-concurrency` through `~/.claude/skills/swift-concurrency`
  - `swift-testing` through `~/.claude/skills/swift-testing`
  - `swiftui-view-refactor` through `~/.claude/skills/swiftui-view-refactor`
- The reviewed example profile emitted the reviewed pinned manager commands on
  a pre-write sync plan:
  - `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill swift-concurrency --agent claude-code --global --yes`
  - `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill swift-testing --agent claude-code --global --yes`
  - `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill swiftui-view-refactor --agent claude-code --global --yes`
- Those three manager commands were run successfully.
- The reviewed example profile currently reports:

  ```text
  - keep | ok | claude_user/swift-concurrency | target=~/.claude/skills/swift-concurrency | source=./swift-concurrency | lock=sha256:f23e7ef12daf | client=supported | management=none | manager_reason=adapter already matches the reviewed plan | reason=manager-owned copy matches registry source digest
  - keep | ok | claude_user/swift-testing | target=~/.claude/skills/swift-testing | source=./swift-testing | lock=sha256:f9a582f50e47 | client=supported | management=none | manager_reason=adapter already matches the reviewed plan | reason=manager-owned copy matches registry source digest
  - keep | ok | claude_user/swiftui-view-refactor | target=~/.claude/skills/swiftui-view-refactor | source=./swiftui-view-refactor | lock=sha256:26b824f6fca3 | client=supported | management=none | manager_reason=adapter already matches the reviewed plan | reason=manager-owned copy matches registry source digest
  ```

- Observed installed file sets under `~/.claude/skills`:
  - `swift-concurrency`:
    - `SKILL.md`
    - `references/common-mistakes.md`
    - `references/fundamentals.md`
    - `references/glossary.md`
    - `references/isolation.md`
    - `references/sendable.md`
  - `swift-testing`:
    - `SKILL.md`
  - `swiftui-view-refactor`:
    - `SKILL.md`
    - `references/mv-patterns.md`
- `diff -qr --exclude metadata.json` from each registry source directory to
  its matching `~/.claude/skills/<skill>` directory exited `0`.
- The pinned upstream manager global listing currently includes all three
  skills with `Claude Code` in their `agents` arrays.

## Scope Boundary

- This proof completes Claude Code support for the active registry-local skill
  set.
- This proof does not change the shared-root OpenCode/Codex baseline.
- This proof does not change legacy Codex symlink roots, repo-local consumers,
  external-git imports such as `swiftui-pro`, fallback-write behavior, or
  updater behavior.
