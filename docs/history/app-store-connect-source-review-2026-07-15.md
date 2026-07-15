# App Store Connect Source Review (2026-07-15)

## Outcome

Admit 22 operational skills from the canonical
[`rorkai/app-store-connect-cli-skills`](https://github.com/rorkai/app-store-connect-cli-skills)
repository as active `external-git` catalog entries. Every entry resolves to
the same immutable commit and keeps Codex, OpenCode, and Claude Code in
`planned` state. This change adds catalog metadata only: it does not vendor
upstream content, change a managed profile, write a consumer directory,
install the `asc` CLI, or configure App Store Connect credentials.

The one excluded upstream skill is `asc-wall-submit`. It publishes an app to
the CLI project's public showcase rather than operating App Store Connect, so
it is outside this repository's curated App Store workflow baseline.

## Source Identity

| Field | Reviewed value |
| --- | --- |
| Source owner | `rorkai/app-store-connect-cli-skills` |
| Source paths | `skills/<skill-id>` |
| Version mode | `pinned_commit` plus update-only `tracking_ref` |
| Immutable commit | [`0ae3da2bf0a43300d3c994593f4df73f3e3da230`](https://github.com/rorkai/app-store-connect-cli-skills/commit/0ae3da2bf0a43300d3c994593f4df73f3e3da230) |
| Tracking ref | `refs/heads/main` |
| Observed | `2026-07-15` |
| License | MIT |
| Release state | No tags or GitHub releases at review time |

The repository is the authoritative source published for the `asc` CLI skill
suite. It is community-maintained and unofficial; it is not an Apple-owned
skill collection. The immutable commit is the install identity. The mutable
tracking ref exists only so the updater can report upstream movement.

## Source And Content Audit

The exact source tree contains 23 skill entrypoints and 29 regular tracked
files: 28 Markdown files and the MIT license. Every tracked file has mode
`100644`. The reviewed commit contains no scripts, executables, symlinks,
submodules, or binary payloads. The audit also found no credentials, private
machine paths, or private company context.

The review covered all 23 upstream skills before selecting the curated set;
it did not infer safety from folder names or review only the four skills that
previously existed as stale local copies.

## Selected Skills

| Capability | Skills |
| --- | --- |
| CLI foundation and automation | `asc-cli-usage`, `asc-id-resolver`, `asc-workflow` |
| App setup, signing, and builds | `asc-app-create-ui`, `asc-signing-setup`, `asc-xcode-build`, `asc-build-lifecycle`, `asc-notarization` |
| Release, review, and beta operations | `asc-release-flow`, `asc-submission-health`, `asc-testflight-orchestration`, `asc-crash-triage` |
| Metadata, localization, and pricing | `asc-metadata-sync`, `asc-localize-metadata`, `asc-subscription-localization`, `asc-whats-new-writer`, `asc-ppp-pricing` |
| Screenshots and store optimization | `asc-screenshot-resize`, `asc-shots-pipeline`, `asc-aso-audit` |
| Connected commercial services | `asc-revenuecat-catalog-sync`, `asc-apple-ads` |

## Overlap Decisions

| Existing capability | Decision |
| --- | --- |
| `xcode-build` | Keep both. `xcode-build` owns native build, test, simulator, and launch work; `asc-xcode-build` owns release archive, export, upload, and version/build-number flow. |
| `asc-release-flow` and `asc-submission-health` | Keep both. The first is readiness-first end-to-end orchestration; the second provides detailed validation, submission monitoring, cancellation, and recovery. `asc-xcode-build` also refers to `asc-submission-health`. |
| `aso` | Keep both. The existing skill covers broad cross-store strategy; `asc-aso-audit` evaluates metadata pulled through the concrete ASC workflow. |
| `revenuecat` | Keep both. The existing skill owns RevenueCat operations; `asc-revenuecat-catalog-sync` reconciles the two product catalogs. |
| `ads` | Keep both. The existing skill is generic advertising guidance; `asc-apple-ads` covers authenticated Apple Ads CLI operations. |
| `screenshot-analyze-verification` | Keep both. The existing skill owns visual approval; the ASC skills own resize, capture, framing, and upload preparation. |
| App creation | Keep `asc-app-create-ui`. App Store Connect has no public app-record creation API, and the skill requires a visible browser and final confirmation. |

## Safety Review

The source review inspected the high-impact workflows rather than treating all
Markdown as harmless:

- Apple Ads starts read-first, requires the intended organization to be
  confirmed, and makes live mutations explicit.
- Browser-based app creation keeps the browser visible, requires final
  confirmation, and forbids automatic retries after submission.
- Workflow execution says to trust the workflow file, validate it, and use a
  dry run before a real release or TestFlight operation.
- RevenueCat reconciliation is audit-first, requires confirmation for writes,
  and does not delete catalog objects.
- Metadata, localization, pricing, signing, notarization, and submission
  workflows expose their review or confirmation boundaries before mutations.

## CLI Contract Proof

The paired
[`rorkai/App-Store-Connect-CLI`](https://github.com/rorkai/App-Store-Connect-CLI)
repository links this skill suite. Its published `2.8.2` macOS arm64 artifact
reported version `2.8.2` at review time. A static extraction found 144 unique
documented `asc` command paths in the selected skills. Of those, 142 resolved
directly through the CLI's `--help` tree. The remaining two were examples of
`asc workflow run <workflow-name>` where the parser interpreted the positional
workflow name as a subcommand; `asc workflow run --help` itself resolved.
No App Store Connect credentials were supplied and no live operation ran.

## Manager Proof And Boundary

The pinned `skills@1.5.14` manager was tested from a detached checkout at the
exact source commit inside an isolated home directory. One command selected
all 22 admitted skills for Codex, OpenCode, and Claude Code. It produced the
shared Codex/OpenCode root and the separate Claude Code root, and 44 source to
installed-tree comparisons were byte-identical. The excluded skill was not
materialized.

Direct remote installation using `repository#<raw-commit>` failed because
this manager version passes the raw commit to Git as a branch name. A mutable
`main` install is not an acceptable fallback for an immutable registry pin.
Consequently all three clients remain `planned`, generated catalog entries
must not advertise install commands, and sync must leave these entries in
manual review. A later managed-profile PR needs its own pre-write manager
command and post-write doctor/sync proof.

The skills also require the `asc` executable and its authentication to be
installed and configured separately. This registry does not manage either.

## Repository Proof

- The upstream doctor resolved `refs/heads/main` to the pinned commit for all
  22 selected skills and matched every generated lock entry.
- The upstream update report covered 52 external skills: 52 current, zero
  updates required, and zero check failures. Every selected ASC entry reported
  pin mode `commit` and lock state `ok`.
- The generated lock contains `pinned_commit` plus `tracking_ref`, and no tag
  fields, for all 22 entries.
- The generated catalog contains 65 active skills, including 23 commit-pinned
  external sources. It contains no install metadata for the planned ASC
  clients, and `asc-wall-submit` is absent from registry, lock, and catalog.
- A disposable two-root sync profile produced 44 blocked `manual-review`
  actions with lock label
  `commit:0ae3da2bf0a4 ref:refs/heads/main` and
  `changed_filesystem: false`. Neither target root was created.
- All 20 commands in `.agents/verify/skills-registry.yaml` passed, including
  registry, lock, catalog, provenance, setup-workflow, sync, public-safety,
  YAML, front matter, and regression checks.
- The read-only live manager check completed without an ASC write. Its
  unrelated existing adapter, lock-source, and duplicate-copy warnings remain
  outside this catalog decision.
