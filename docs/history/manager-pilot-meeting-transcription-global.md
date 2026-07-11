# Meeting Transcription Manager Proof - 2026-07-11

Related: [Manager Boundary](../manager-boundary.md),
[Setup And Update Workflow](../setup-update-workflow.md),
[Codex proof profile](manager-pilot-meeting-transcription-codex-global.profile.yaml),
[Claude Code proof profile](manager-pilot-meeting-transcription-claude-global.profile.yaml)

## Purpose

This note records the checked-in audit trail for promoting
`meeting-transcription` to `proven-manager-copy` for the shared agents root and
the separate Claude Code root. It is historical proof only; the active
install/update path remains the current example profile plus
`scripts/skills_sync.rb --plan`.

## Observed Evidence

- The reviewed pre-write sync plan emitted one `upstream-manager` create action
  for `~/.agents/skills/meeting-transcription` and one for
  `~/.claude/skills/meeting-transcription`.
- The reviewed manager commands are:

  ```text
  npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill meeting-transcription --agent codex --global --yes
  npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill meeting-transcription --agent claude-code --global --yes
  ```

- Before PR #42 is merged, the same pinned manager version was run against the
  reviewed PR checkout so the exact proposed source could be verified without
  claiming it already existed on `main`.
- Installed file sets under both manager roots contained `SKILL.md`,
  `agents/openai.yaml`, and `scripts/transcribe_meeting_audio.sh`.
- `scripts/skills_doctor.rb --check-manager` reported both targets as
  manager-owned copies matching the registry source digest.
- `npx --yes skills@1.5.14 ls --global --json` reported
  `meeting-transcription` for Codex, OpenCode, and Claude Code through the
  reviewed global roots.
- The standard GitHub manager commands above remain the required post-merge
  refresh path; the proof does not claim that a local-checkout install updates
  the manager's global GitHub source lock.

## Scope Boundary

- This proof promotes only `meeting-transcription`.
- It does not promote the legacy `~/.codex/skills` adapter.
- It does not hand-edit either installed copy.
- It does not treat a private downstream company-memory overlay as public skill
  source.
