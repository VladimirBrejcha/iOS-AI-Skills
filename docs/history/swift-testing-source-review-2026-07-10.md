# Swift Testing Source Review

Reviewed and superseded on 2026-07-10 while resolving the Swift Testing source
decision.

## Decision

`swift-testing` now uses the TwoStraws Swift Testing package as the reviewed
source owner, stored as a registry-local maintained fork to preserve the
existing exported skill name.

- Source: `https://github.com/twostraws/Swift-Testing-Agent-Skill.git`
- Upstream package path: `swift-testing-pro`
- Reviewed release: `1.0.0`
- Reviewed commit: `29921fb187f1165cb8975791c7e11fbb23d03398`
- License: MIT
- Upstream author metadata: Paul Hudson

The previous johnrogers-derived single-file baseline was removed rather than
patched in place. The imported package keeps the richer TwoStraws structure:
`SKILL.md`, `references/`, `agents/openai.yaml`, and icon assets.

## Local Adaptations

The local fork intentionally differs from upstream only where the registry
contract requires it:

- `SKILL.md` front matter uses `name: swift-testing` so the manager-selected
  skill name remains stable for existing consumers.
- `SKILL.md` front matter contains only `name` and `description`, matching the
  local skill authoring contract.
- `agents/openai.yaml` uses `$swift-testing` in `default_prompt`.
- The source remains `registry-local` until external-git aliases and manager
  installs can preserve the public `swift-testing` surface end-to-end.

## Alternative Review

`https://github.com/AvdLee/Swift-Testing-Agent-Skill.git` remains a strong
alternative and had tags through `1.2.0` during review. It was not selected for
this replacement because the chosen direction is to standardize on the
TwoStraws package while preserving the existing `swift-testing` export.

## Registry Impact

The registry keeps `swift-testing` active for Codex, Claude Code, OpenCode,
machine, and repo-local consumers. After merge, managed global Codex and Claude
Code copies should be refreshed from `fiveonecode/agent-skills` so installed
roots match the new lock digest.

## Product Need

The skill stays active because Swift Testing is the default unit and
integration test direction for modern Swift projects, while XCTest remains
necessary for UI automation, performance metrics, and Objective-C-only test
code.
