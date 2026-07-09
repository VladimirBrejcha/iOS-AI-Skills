# Swift Concurrency Source Review

Reviewed on 2026-07-09 while reclassifying `swift-concurrency` from
`registry-local` to `external-git`.

## Decision

`swift-concurrency` is an external-git skill pinned to:

- Source: `https://github.com/jamesrochabrun/skills.git`
- Path: `skills/swift-concurrency`
- Tag: `2.1.1`
- Commit: `2482c176372299c92af01f8414a67172f324e8db`
- License: MIT

The local checked-in folder matched that upstream folder exactly at tag
`2.1.1`, so the local folder was removed and the registry/lock now point at the
external source owner.

## Original-Source Review

The earlier provenance entry was not accepted blindly. Review also found
`tuist/fuckingapproachableswiftconcurrency` and the public
`fuckingapproachableswiftconcurrency.com/SKILL.md` as a deeper source-material
origin for the mental model and AI-agent skill concept.

That Tuist source is not the exact source owner for the checked-in
`swift-concurrency` package:

- its `src/SKILL.md` differs from the checked-in folder;
- it does not include the checked-in `references/` files;
- it has no exact git tag compatible with the current registry contract.

Because the current public contract requires external-git skills to use an
exact pinned tag plus observed commit, the reviewed source owner for this PR is
the tagged `jamesrochabrun/skills` package. The Tuist project remains recorded
as source-material evidence in this review note, not as the registry pin.

## Adapter Impact

The example machine profile now leaves `swift-concurrency` in `manual-review`.
Future Codex, OpenCode, and Claude Code writes need an upstream-manager or
import path that materializes the external-git source directly. The old
`fiveonecode/agent-skills` local-folder manager command is no longer the
current write path for this skill.
