# Catalog Disposition Review

Date: 2026-07-14

This review closes the initial source-review backlog. It records the public
origin, license, overlap, usefulness, and final disposition of every skill that
previously had `needs-source-review` or `needs-import-review` status. The sole
current disposition manifest remains `skills.registry.yaml`.

## Result

- All 42 registry entries are `active` and backed by lock metadata.
- Thirteen source folders remain checked in: ten previously reviewed
  registry-local skills and three newly confirmed repository-owned skills.
- Tagged third-party sources replace stale checked-in mirrors.
- No unresolved or legacy folder remains in the repository.
- A finalized registry status now fails doctor and catalog validation if a
  pending disposition is introduced without changing the registry review state.

`legacy` remains a supported lifecycle status, but none of the reviewed folders
had a compatibility or historical-use requirement strong enough to justify
retaining stale source bytes. Deleted content remains recoverable from Git
history and this decision record.

## Repository-Owned Promotions

| Skill | Evidence | Final decision |
| --- | --- | --- |
| `mechanism-audit` | Introduced directly in this repository at `79a7bfe`; no external source claim found. | Active registry-local source. |
| `screenshot-analyze-verification` | Introduced directly in this repository at `74c684d`; no external source claim found. | Active registry-local source. It complements the capture workflow with a strict visual-evidence gate. |
| `silent-pushes-setup` | Present from initial commit `46cd104`; the [full source review](silent-pushes-setup-source-review-2026-07-15.md) found no earlier public source and compared current alternatives. | Keep the exported name as an active registry-local source, narrowed to iOS background-push setup and diagnosis. |

## Tagged External Promotions

### Swift And Design

| Final skill | Authoritative source | Pin | Previous local state | Decision |
| --- | --- | --- | --- | --- |
| `swiftui-pro` | [twostraws/SwiftUI-Agent-Skill](https://github.com/twostraws/SwiftUI-Agent-Skill) | `1.1.0` / `be297ff80dddec529af1f9b1f1f114aab6c9d11c` | Registry entry was pinned but awaiting import review. | Active external-git source; MIT license reviewed. |
| `apple-hig-designer` | [jamesrochabrun/skills](https://github.com/jamesrochabrun/skills) | `2.1.1` / `2482c176372299c92af01f8414a67172f324e8db` | Exact stale mirror. | Active external-git source; local mirror removed; MIT license reviewed. |
| `design-brief-generator` | [jamesrochabrun/skills](https://github.com/jamesrochabrun/skills) | `2.1.1` / `2482c176372299c92af01f8414a67172f324e8db` | Exact stale mirror. | Active external-git source; local mirror removed; MIT license reviewed. |
| `swiftui-animation` | [jamesrochabrun/skills](https://github.com/jamesrochabrun/skills) | `2.1.1` / `2482c176372299c92af01f8414a67172f324e8db` | Exact stale mirror. | Active external-git source; local mirror removed; MIT license reviewed. |

[AvdLee/SwiftUI-Agent-Skill](https://github.com/AvdLee/SwiftUI-Agent-Skill)
`4.0.0` was reviewed as a strong broad SwiftUI alternative. Its local folder
matched that upstream's `1.0.0` release, but keeping it alongside `swiftui-pro`
would create overlapping broad triggers. The stale local copy was removed;
specialized `swiftui-view-refactor`, `swiftui-animation`, `swift-concurrency`,
and `xcode-build` skills cover the narrower workflows.

### Marketing And Growth

The existing marketing folders came from
[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills),
which is MIT licensed and now publishes a tagged, consolidated catalog. All
retained capabilities are pinned to `v2.6.0` at
`2815104d5459357d44c5f9031fcca0525b00c991`. Current upstream names replace
the stale local names so the source package remains authoritative.
Catalog-facing descriptions omit cross-links to capabilities outside this
registry; generated catalog validation requires explicit `see skill-id`
references to resolve to active entries.

| Final skill | Replaces |
| --- | --- |
| `ab-testing` | `ab-test-setup` |
| `ads` | `paid-ads` |
| `analytics` | `analytics-tracking` |
| `aso` | duplicate `app-store-optimisation` and `app-store-optimisation-codex` folders |
| `competitors` | `competitor-alternatives` |
| `copy-editing` | stale local `copy-editing` mirror |
| `copywriting` | stale local `copywriting` mirror |
| `cro` | merged `form-cro` and `page-cro` capabilities |
| `emails` | `email-sequence` |
| `free-tools` | `free-tool-strategy` |
| `launch` | `launch-strategy` |
| `marketing-ideas` | stale local `marketing-ideas` mirror |
| `marketing-psychology` | stale local `marketing-psychology` mirror |
| `onboarding` | `onboarding-cro` |
| `paywalls` | `paywall-upgrade-cro` |
| `popups` | `popup-cro` |
| `pricing` | `pricing-strategy` |
| `programmatic-seo` | stale local `programmatic-seo` mirror |
| `referrals` | `referral-program` |
| `schema` | `schema-markup` |
| `seo-audit` | stale local `seo-audit` mirror |
| `signup` | `signup-flow-cro` |
| `social` | `social-content` |

The current upstream `cro` package includes the former standalone form
workflow, so retaining both `form-cro` and `page-cro` would duplicate trigger
coverage. The current upstream `aso` package was preferred over the duplicate
local ASO toolkit and the separately reviewed
[alirezarezvani/claude-code-aso-skill](https://github.com/alirezarezvani/claude-code-aso-skill)
because it is current, tagged, and part of the same maintained marketing source.

### RevenueCat

| Final skill | Authoritative source | Pin | Decision |
| --- | --- | --- | --- |
| `revenuecat` | [RevenueCat/ai-toolkit](https://github.com/RevenueCat/ai-toolkit) | `v2.1.0` / `b34f9bebe02ceb7e3f32e6d7d081cdfb2e7c37a6` | Active external-git source; the unlicensed marketplace copy was removed. |

RevenueCat's official MIT-licensed toolkit is the preferred source. Codex and
Claude Code should use the official plugin so the skill and OAuth MCP server
stay together. Other consumers can install the skills and configure the
official MCP server separately.

## Removed Without Active Replacement

| Removed folders | Origin or alternative reviewed | Reason |
| --- | --- | --- |
| `apple-doc-research`, `apple-docs-research` | Official Apple Developer Documentation | Duplicate malformed files tied to a nonstandard MCP tool name. Agents should retrieve current official Apple sources through their available documentation path instead of a broken static router. |
| `asc-metadata-sync`, `asc-ppp-pricing`, `asc-shots-pipeline`, `asc-subscription-localization` | [rudrankriyam/app-store-connect-cli-skills](https://github.com/rudrankriyam/app-store-connect-cli-skills), observed at `ae57034c` | Useful upstream, MIT licensed, but it has no exact tag and local mirrors were stale. Reconsider after commit-only external pins are supported. |
| `cloudflare-d1`, `cloudflare-queues`, `cloudflare-worker-base`, `wrangler` | Official [cloudflare/skills](https://github.com/cloudflare/skills), observed at `70215303` | Official Apache-2.0 source is the clear replacement and supports Codex, Claude Code, and OpenCode, but it has no exact tag. Stale local copies were removed rather than falsely claimed as registry-owned. |
| `replicate-cli`, `threads-api` | `rawveg/skillsforge-marketplace` | The detected source has no repository license, the copies were stale, and neither capability is required by the curated baseline. |
| `swiftui-liquid-glass`, `swiftui-performance-audit` | [Dimillian/Skills](https://github.com/Dimillian/Skills), observed at `05ba982b` | Untagged external source and substantial overlap with the selected broad and specialized SwiftUI skills. |
| `swiftui-simulator-ui` | Repository-authored | Superseded by the managed `xcode-build` simulator/capture workflow plus `screenshot-analyze-verification` for visual approval. |
| `typescript` | [PaulRBerg/dot-claude](https://github.com/PaulRBerg/dot-claude), observed at `f226c687` | MIT licensed but untagged, no longer present at the prior path, highly opinionated, and outside the curated baseline. |

## Deferred Contract Work

The official Cloudflare and App Store Connect sources demonstrate a real need
for immutable commit-only external pins. This review does not weaken the
tag-only contract or create registry-local mirrors to work around it. A later
contract PR should add commit-pin support across doctor, lock generation,
catalog, updater, sync planning, tests, and public documentation before either
untagged source is admitted.

External-git entries remain profile-planned. Their source and lock decisions
are final, but each consumer rollout still requires the established pre-write
manager command and post-write doctor/sync proof.

## Follow-up

Commit-pin support was subsequently added without weakening immutable source
identity. The deferred official Cloudflare source was admitted in the
[Cloudflare Source Review](cloudflare-source-review-2026-07-15.md), and the
App Store Connect candidates were re-reviewed as a complete upstream suite in
the [App Store Connect Source Review](app-store-connect-source-review-2026-07-15.md).
