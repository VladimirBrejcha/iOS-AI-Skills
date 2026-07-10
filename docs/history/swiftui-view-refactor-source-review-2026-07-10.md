# SwiftUI View Refactor Source Review

Reviewed on 2026-07-10 while resolving the remaining registry provenance
conflicts.

## Decision

`swiftui-view-refactor` remains a registry-local maintained fork for now.

- Source: `https://github.com/Dimillian/Skills.git`
- Path: `swiftui-view-refactor`
- Previous exact local source commit: `ad1bb92d3e9ce8f42c993164d1048e949f520dca`
- Refreshed upstream commit: `05ba982bfeb0d77d3c97d4542b0ee15034d05f84`
- License: MIT
- Upstream tag status: no exact release tag observed on 2026-07-10

The previous checked-in folder matched Dimillian commit
`ad1bb92d3e9ce8f42c993164d1048e949f520dca`. Current upstream later refined the
skill to prefer dedicated subview types, extract side effects out of `body`,
avoid top-level branch swapping, clarify Observation wrapper guidance, and
replace the long article-style MV reference with a distilled practical
reference.

This PR refreshes the checked-in registry-local fork from current upstream and
keeps one small public wording cleanup in `references/mv-patterns.md`.

## Alternative Review

The strongest narrow source remains `Dimillian/Skills`.

Other reviewed options were not better as the exact source for this registry
entry:

- Broad SwiftUI skills such as `AvdLee/SwiftUI-Agent-Skill` and
  `twostraws/SwiftUI-Agent-Skill` are useful companions but are not focused
  replacements for this view-refactor workflow.
- Marketplace or aggregator mirrors are discovery aids, not source owners.
- Public skill sets with non-permissive or unclear licensing are not suitable
  for this public registry without a separate policy decision.

## Registry Impact

Because the exact source owner has no release tag, this PR does not convert the
skill to `external-git`. Instead, registry metadata keeps
`swiftui-view-refactor` as `registry-local`, records upstream provenance, and
explains the fork reason.

Future work can promote this skill to `external-git` after either:

- the upstream publishes an exact release tag for the reviewed content, or
- the registry contract supports commit-only external pins across doctor,
  catalog, sync, and profile generation.

## Product Need

The skill stays active because SwiftUI view cleanup is a recurring workflow
across Apple-platform projects. Its narrow scope complements broader SwiftUI
skills by focusing specifically on view structure, dependency injection,
Observation usage, and behavior-preserving refactors.
