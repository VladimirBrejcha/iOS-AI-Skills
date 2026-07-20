# 51Code Agent Skills

This repository is the source package for 13 skills maintained by 51Code and
the bootstrap for our reviewed machine-global skill baseline.

The repository intentionally has no catalog, registry, generated lock, sync
planner, or compatibility layer. The standard `skills` CLI installs the
package directly.

## Global baseline

The baseline contains these 15 skills:

- 51Code-owned: `code-review`, `gemini-files-api`, `harness-engineering`,
  `hint-overlay-visual-verification`, `ios-xcodegen`, `mechanism-audit`,
  `meeting-transcription`, `silent-pushes-setup`,
  `spec-creation-updating`, `swift-testing`, `swiftui-view-refactor`,
  `xcode-build`, and `xcode-cloud`
- Third-party: `impeccable` and `swift-concurrency`

Install or reconcile it from a checkout of the desired repository revision:

```bash
./bootstrap.sh
```

Run the same command again after pulling a reviewed repository revision. It is
idempotent. The script uses `skills@1.5.14`, explicit Git tags, and explicit
skill names. In this CLI, `#ref` selects a Git ref; `@name` selects a skill and
must not be used as a version pin. Before reporting success, the script verifies
all 15 entrypoints in the shared and Claude Code manager roots and bootstraps
the copied `gemini-files-api` dependencies in both roots. It also converts the
pinned manager's partial-install result into a non-zero bootstrap failure.

The script installs and reconciles the baseline names only. It does not remove
retired names or unrelated global skills installed outside this baseline.

## Updating the baseline

1. Update the 51Code-owned skill folders in this repository.
2. Change a third-party `#ref` in `bootstrap.sh` only after reviewing it.
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

The archived catalog system is preserved at Git tag
`archive/catalog-system-final`.

## Contributing

Each top-level skill directory contains a `SKILL.md` with `name` and
`description` front matter. Keep public changes generic and free of machine
paths, credentials, internal task links, or company-only context.
