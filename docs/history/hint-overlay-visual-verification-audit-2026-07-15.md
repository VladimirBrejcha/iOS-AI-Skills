# Hint Overlay Visual Verification Audit

Date: 2026-07-15

## Decision

Narrow and rename `screenshot-analyze-verification` to
`hint-overlay-visual-verification`.

Keep the fail-fast contract for in-app hint overlays, coach marks, spotlight
apertures, anchored callouts, theme parity, and safe-area geometry. Remove the
generic screenshot-review trigger and the App Store poster/composite rules.
Do not preserve the old exported name as an alias, because the alias would keep
the misleading broad trigger active.

This audit does not split out a marketing-composite skill. That material is too
small and context-dependent to justify a separate reusable package, while the
catalog already contains concrete capture, dimension, framing, review, and
upload workflows.

## Provenance

Repository history is the primary origin evidence:

- Commit
  [`74c684ddb1a53e516af56ac4e5321666a9b7d224`](https://github.com/fiveonecode/agent-skills/commit/74c684ddb1a53e516af56ac4e5321666a9b7d224)
  added the first repository occurrence on 2026-02-14. The commit added the
  skill and its README inventory row without an attribution or import claim.
- Commit
  [`bfbdd354573422c244927af528ee2963a89e11a9`](https://github.com/fiveonecode/agent-skills/commit/bfbdd354573422c244927af528ee2963a89e11a9)
  added the reference-poster, screen-masking, typography, and export-dimension
  rules on 2026-06-26. Those additions created the mixed overlay/marketing
  scope; they were not part of the original overlay checklist.
- The repository is not a fork and is MIT licensed. The former public slug
  `vladimirbrejcha/ios-ai-skills` redirects to
  `fiveonecode/agent-skills`.

Public GitHub code search on 2026-07-15 found no exact match for the original
description. The only public exact-name result was a later catalog dataset
entry in
[`RajVarsani/skill-builder`](https://github.com/RajVarsani/skill-builder/blob/dfe40e8fa9fead2cfb542c77d44be31494952716/dataset/skills-chunk-76.json)
that names `vladimirbrejcha/ios-ai-skills` as its source. That repository commit
postdates the source commit and points back to the former slug, so it is
redistribution evidence rather than an independent original source.

`provenance.sources.yaml` is intentionally unchanged. Its current contract is
to record public upstream observations for maintained local forks. This skill
is repository-authored, not a maintained external fork; the registry notes and
this dated review hold the relevant native-source evidence.

## Alternatives Reviewed

| Capability | Current alternative | Audit conclusion |
| --- | --- | --- |
| General image understanding | OpenAI [Images and vision](https://developers.openai.com/api/docs/guides/images-vision) accepts image inputs and supports high/original detail. | A generic screenshot-analysis skill does not provide a unique inspection capability. Vision limitations around small text, spatial localization, and accuracy still require explicit evidence boundaries. |
| Live browser/computer inspection | OpenAI [Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use) uses screenshot-first visual context and recommends original-detail screenshots for spatial tasks. | Built-in visual inspection owns obtaining and examining live UI state. A retained skill should define a specialized acceptance contract, not restate tool operation. |
| Deterministic web visual regression | Playwright [visual comparisons](https://playwright.dev/docs/test-snapshots) provides baseline screenshot comparison and configurable pixel-diff thresholds. | Pixel comparison is more credible than model-only inspection for repeatable web regression detection. It does not replace semantic review of spotlight intent or interaction evidence. |
| Native simulator capture | Catalog skill [`xcode-build`](../../xcode-build/SKILL.md) owns build, install, launch, and simulator screenshot commands. | Capture and build provenance remain outside the narrowed skill. |
| App Store screenshot pipeline | Pinned upstream [`asc-shots-pipeline`](https://github.com/rorkai/app-store-connect-cli-skills/blob/0ae3da2bf0a43300d3c994593f4df73f3e3da230/skills/asc-shots-pipeline/SKILL.md) owns capture plans, framing, generated review artifacts, and upload. | This is the concrete workflow for App Store screenshot production; it should not be duplicated in a visual-approval prompt. |
| App Store dimensions and file validation | Pinned upstream [`asc-screenshot-resize`](https://github.com/rorkai/app-store-connect-cli-skills/blob/0ae3da2bf0a43300d3c994593f4df73f3e3da230/skills/asc-screenshot-resize/SKILL.md) uses current CLI size data and validation. Apple publishes [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) and [product-page guidance](https://developer.apple.com/app-store/product-page/). | Dimensions, alpha, file format, resize, and product-page composition are distinct deterministic or marketing concerns. They are removed from the overlay skill. |

## Retained Contract

The retained skill is necessary only for a narrow reason: it converts a set of
overlay-specific failure modes into a consistent approval protocol.

- It fails closed on wrong context, missing capture provenance, incomplete
  target/callout state, spotlight leaks, unreadable copy, pointer detachment,
  safe-area clipping, and missing theme/device coverage.
- It distinguishes what still images can prove from interaction behavior,
  animation continuity, build freshness, and measured contrast.
- It requires a structured `VERIFIED` or `NOT VERIFIED` result tied to explicit
  evidence.

Those constraints are reusable across apps with coach marks or spotlight
overlays and are not supplied by capture or packaging tools alone.

## Manager Proof And Boundary

The renamed local source was exercised from the PR checkout with disposable
home, configuration, and package-cache roots:

```bash
HOME="$ISOLATED_HOME" \
XDG_CONFIG_HOME="$ISOLATED_HOME/.config" \
npm_config_cache="$ISOLATED_HOME/.npm" \
npx --yes skills@1.5.14 add "$CHECKOUT" \
  --skill hint-overlay-visual-verification \
  --agent codex opencode claude-code \
  --global --yes --copy
```

The manager discovered the renamed skill, produced the Codex/OpenCode shared
copy under `$HOME/.agents/skills` and the Claude Code copy under
`$HOME/.claude/skills`, and each produced skill tree matched the repository
source byte for byte. All manager and npm writes stayed inside the disposable
roots; no real user or repository consumer roots were written.

This proves local-source discovery and packaging, not a managed rollout or an
upgrade from the former exported name. All clients remain `planned` because
this PR neither selects the skill in a reviewed profile nor writes a real
consumer root. Unmanaged consumers of `screenshot-analyze-verification` fall
outside profile-controlled migration and require an explicit later migration
or removal. No compatibility alias is added.

## Catalog And Exposure Impact

- Rename the source directory, registry ID, source path, exported name, and
  generated catalog entry.
- Regenerate the local-source digest in `skills.lock.yaml` and both catalog
  artifacts.
- Keep all client states `planned` and leave the example profile unchanged.
  No managed profile migration is performed or required in this PR because the
  old skill was not profile-selected.
- Do not migrate unmanaged consumers of the old exported name in this PR; they
  require explicit later migration or removal.
- Do not add framework code, screenshot automation, image-processing scripts,
  or a second marketing skill.

## Limitations

- Manager discovery and isolated packaging prove that the renamed folder is a
  valid distributable skill; they do not prove that every client will select
  the skill for every natural-language prompt.
- Static catalog checks can verify the name, description, source digest, and
  exported trigger text. This repository has no semantic trigger-evaluation
  harness, and this audit does not add one speculatively.
- Model-based visual inspection can still miss small or spatial defects. The
  skill therefore requires original-detail review and fails closed when
  evidence is insufficient.
- A still screenshot cannot establish interaction semantics, animation
  correctness, build freshness, or exact contrast conformance. Separate
  evidence remains mandatory for those claims.
