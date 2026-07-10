# Swift Testing Source Review

Reviewed on 2026-07-10 while resolving the remaining registry provenance
conflicts.

## Decision

`swift-testing` remains a registry-local maintained fork for now.

- Source: `https://github.com/johnrogers/claude-swift-engineering.git`
- Path: `plugins/swift-engineering/skills/swift-testing`
- Observed commit: `1dc2cf4d020bd524168f20bec95104da6cb2888c`
- Content-introducing commit reviewed: `798c5366070b7f0633765483f61ffbbd76a2d194`
- License: MIT
- Upstream tag status: no exact release tag observed on 2026-07-10

The checked-in skill body matches the public upstream at the observed commit.
The local fork keeps one intentional front-matter patch: the description is
quoted so YAML preserves `#expect` and `#require` instead of treating them as
comments.

## Alternative Review

Better Swift Testing skill packages exist, but they are replacement candidates,
not the exact source owner for this checked-in baseline:

- `https://github.com/twostraws/Swift-Testing-Agent-Skill.git` has a tagged
  `1.0.0` package with broader Swift 6.2-oriented guidance and multi-file
  references.
- `https://github.com/AvdLee/Swift-Testing-Agent-Skill.git` has tagged
  releases through `1.2.0` with strong migration, traits, parallelism, and
  Xcode workflow references.

Those packages should be evaluated in a separate skill replacement PR if the
registry wants a richer Swift Testing source. This PR does not silently replace
the exported `swift-testing` baseline with a different third-party package.

## Registry Impact

Because the exact source owner has no release tag, this PR does not convert the
skill to `external-git`. Instead, registry metadata keeps `swift-testing` as
`registry-local`, records upstream provenance, and explains the fork reason.

Future work can promote this skill to `external-git` after either:

- the upstream publishes an exact release tag for the reviewed content, or
- the registry contract supports commit-only external pins across doctor,
  catalog, sync, and profile generation.

## Product Need

The skill stays active because Swift Testing is the default unit/integration
test direction for modern Swift projects, while XCTest remains necessary for
UI automation, performance metrics, and Objective-C-only test code.
