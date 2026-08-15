# 51Code Agent Skills

This repository is the source package for 15 skills maintained by 51Code and
the bootstrap for our reviewed machine-global skill baseline.

The repository intentionally has no catalog, registry, generated lock, sync
planner, or compatibility layer. The standard `skills` CLI installs the
package directly.

## Global baseline

The global baseline supports Codex and Claude Code and contains these 38 skills:

- 51Code-owned: `code-review`, `gemini-files-api`, `harness-engineering`,
  `hint-overlay-visual-verification`, `ios-xcodegen`,
  `lifecycle-and-side-effects-correctness`, `local-model-serving`,
  `mechanism-audit`,
  `meeting-transcription`, `silent-pushes-setup`, `spec-creation-updating`,
  `swift-testing`, `swiftui-view-refactor`, `xcode-build`, and `xcode-cloud`

- Third-party: `swift-concurrency` and the 22 `asc-*` App Store Connect CLI
  skills from `rorkai/app-store-connect-cli-skills`

Install the global baseline from this repository and it becomes available to
agents on the machine. `local-model-serving` guides engine selection and the
one-engine-at-a-time memory rule for local LLM work; see its `SKILL.md`.

Install or reconcile it from a checkout of the desired repository revision:

```bash
./bootstrap.sh
```

Run the same command again after pulling a reviewed repository revision. It is
idempotent. The script uses `skills@1.5.14`, explicit Git tags or commits, and
explicit skill names. In this CLI, `#ref` selects a Git branch or tag; `@name`
selects a skill and must not be used as a version pin. Sources pinned to a raw
commit are checked out and verified before being passed to the manager as a
local source. Before reporting success, the script verifies all 37 entrypoints
in the shared and Claude Code manager roots and bootstraps the copied
`gemini-files-api` dependencies in both roots. The Claude Code root honors
`CLAUDE_CONFIG_DIR` when it is set. The script also converts the pinned
manager's partial-install result into a non-zero bootstrap failure.

The script installs and reconciles the baseline names only. It does not remove
retired names or unrelated global skills installed outside this baseline.

## Updating the baseline

1. Update the 51Code-owned skill folders in this repository.
2. Change a third-party tag or commit in `bootstrap.sh` only after reviewing it.
3. Run `./bootstrap.sh` twice and verify the second run is a no-op in content.
4. Commit the source and bootstrap change together.
5. On another machine, check out the same repository revision and run
   `./bootstrap.sh`.

Do not use `skills update` to define cross-machine state: it follows whatever
source metadata is already installed on that machine. The reviewed bootstrap
is the desired-state record.

## Project-local skills

Projects own their own committed skill folders and bootstrap. A project must
not commit a local folder with the same name as a global skill. External
project-only skills should be installed by that project's bootstrap from an
explicit `#ref`, which also produces its project `skills-lock.json`.

Projects that use Impeccable should install its reviewed version locally from
`pbakaus/impeccable#skill-v3.9.1` in their project bootstrap. For example:

```bash
npx --yes skills@1.5.14 add 'pbakaus/impeccable#skill-v3.9.1' \
  --skill impeccable --agent codex claude-code --yes --copy
```

## Automation

`WORKFLOW.md` keeps this repository usable by Autopilot and Symphony after the
old catalog harness is removed. Its validation command is the small,
non-mutating `scripts/verify.sh`; neither file is a registry or compatibility
layer.

The archived catalog system is preserved at Git tag
`archive/catalog-system-final`.

## Contributing

Each top-level skill directory contains a `SKILL.md` with `name` and
`description` front matter. Keep public changes generic and free of machine
paths, credentials, internal task links, or company-only context.
