# Xcode Build Source Review

Reviewed on 2026-07-09 while deciding whether `xcode-build` should move from
`registry-local` to `external-git`.

## Decision

`xcode-build` remains a registry-local maintained fork for now.

- Source: `https://github.com/pzep1/xcode-build-skill.git`
- Path: `skills/xcode-build`
- Observed commit: `9b5c31392971116b207f79525eeb8a3e57fbf227`
- License: MIT
- Upstream tag status: no exact release tag observed on 2026-07-09

The local checked-in `SKILL.md` and `references/` content matched the public
upstream folder before this PR applied local positioning edits. After those
edits, the checked-in copy is treated as a maintained registry-local fork. The
registry contract currently requires external-git skills to use an exact pinned
tag plus observed commit, and commit-only external pins are not supported
end-to-end.

## Registry Impact

Because the upstream has no exact release tag, this PR does not convert the
skill to `external-git`. Instead, registry metadata keeps `xcode-build` as
`registry-local`, records the upstream provenance, and explains the fork reason.

Future work can promote this skill to `external-git` after either:

- the upstream publishes an exact release tag for the reviewed content, or
- the registry contract supports commit-only external pins across doctor,
  catalog, sync, and profile generation.

## Product Positioning

The skill stays active because it provides a portable, native Xcode/macOS CLI
baseline for Xcode builds, simulator control, tests, logs, and screenshots.
Richer project-specific tooling, such as XcodeBuildMCP, simulator automation,
or repo-local harnesses, can still be used when configured and proven for the
current project.
