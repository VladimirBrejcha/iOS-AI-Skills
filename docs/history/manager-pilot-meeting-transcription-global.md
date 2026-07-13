# Meeting Transcription Dependency Manager Proof - 2026-07-13

Related: [Manager Boundary](../manager-boundary.md),
[Setup And Update Workflow](../setup-update-workflow.md),
[Codex proof profile](manager-pilot-meeting-transcription-codex-global.profile.yaml),
[Claude Code proof profile](manager-pilot-meeting-transcription-claude-global.profile.yaml)

## Purpose

This note records the checked-in audit trail for promoting
`meeting-transcription` together with its separately owned `gemini-files-api`
runtime dependency. It implements
[Autopilot decision AD-20260713-001](https://github.com/fiveonecode/agent-skills/pull/42#issuecomment-4957166508):
the wrapper is a distinct registry-local skill and is not vendored into
`meeting-transcription`.

This is historical proof only. The active install/update path remains the
current example profile plus `scripts/skills_sync.rb --plan`.

## Fresh-Install Evidence

- The proof started with an empty isolated home, cache, config, data, and temp
  root. Neither managed skill nor wrapper dependencies existed there.
- The pinned `skills@1.5.14` manager installed `gemini-files-api` and
  `meeting-transcription` from the reviewed PR checkout into both the shared
  Codex/OpenCode root and the separate Claude Code root.
- Before bootstrap, neither managed wrapper copy contained `node_modules`.
- Each managed `gemini-files-api/scripts/bootstrap.sh` restored dependencies
  from `package-lock.json` with `npm ci`.
- `node --check` passed for both installed wrapper copies, and `bash -n` passed
  for both installed transcription scripts.
- `npm audit` reported zero vulnerabilities for the reviewed lock.
- The historical Codex and Claude Code profiles each selected both skills.
  `scripts/skills_doctor.rb` reported four manager-owned copies matching their
  registry source digests: the dependency and consumer in both roots.
- The proof retained redacted installed-file inventory, install/bootstrap logs,
  audit JSON, and doctor output in the controller task session.

## Reviewed Manager Commands

Run the dependency command before the consumer command for each target:

```text
npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill gemini-files-api --agent codex --global --yes
npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill meeting-transcription --agent codex --global --yes
npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill gemini-files-api --agent claude-code --global --yes
npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill meeting-transcription --agent claude-code --global --yes
```

After each dependency install or update, run the installed wrapper's
`scripts/bootstrap.sh` before transcription.

Before PR #42 is merged, the same pinned manager version was run against the
reviewed PR checkout. The commands above remain the required post-merge refresh
path and do not claim that a local-checkout proof updates the manager's global
GitHub source lock.

## Scope Boundary

- This proof promotes `gemini-files-api` and `meeting-transcription` as two
  separately owned registry-local skills that must be installed together.
- It does not promote the legacy `~/.codex/skills` adapter.
- It does not hand-edit either installed copy.
- Generated `node_modules` is excluded from source and adapter digest checks;
  `package-lock.json` remains the reviewed dependency pin.
- It does not treat Gemini credentials, transcripts, or a private downstream
  company-memory overlay as public skill source.
