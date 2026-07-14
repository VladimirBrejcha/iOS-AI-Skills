# Registry Contract

Status: catalog-dispositions-finalized
Last updated: 2026-07-14

Related: [README](../README.md), [Usage](usage.md),
[Setup And Update Workflow](setup-update-workflow.md),
[Contributing](contributing.md), [Manager Boundary](manager-boundary.md),
[registry manifest](../skills.registry.yaml), [lock file](../skills.lock.yaml),
[provenance source map](../provenance.sources.yaml),
[generated catalog](../skills.catalog.json), [readable catalog](skills-catalog.md),
[example machine profile](../profiles/machine/example-local-skills.yaml)

## Objective

`fiveonecode/agent-skills` is the public source and policy registry for
reusable 51Code agent skills. The registry exists so one reviewed skill source
can be exposed into multiple agent surfaces without copied-source drift.

The non-negotiable contract is:

- active reusable skills have one source owner
- active reusable skills have lock/version metadata
- active reusable skills have generated adapter views for Codex,
  OpenCode, Claude Code, and repo-local consumers
- every checked-in top-level skill has exactly one registry disposition, even
  before source ownership is resolved or after it becomes legacy

## Coverage State

The registry is the complete disposition inventory. The initial source review
is complete; installation coverage remains intentionally narrower and is
expanded through separately proven consumer profiles.

- The current baseline contains 42 active, reviewed entries and no pending or
  legacy dispositions.
- `catalog-dispositions-finalized` is mechanically incompatible with
  `needs-source-review` or `needs-import-review`; doctor and catalog generation
  fail if the declared review state and entries disagree.

- Every top-level `*/SKILL.md` folder must appear exactly once in
  `skills.registry.yaml` as `registry-local` or `unresolved-local`.
- Only `active` entries are installable. `needs-source-review`,
  `needs-import-review`, and `legacy` entries remain visible but cannot emit
  manager install commands.
- `unresolved-local` entries do not claim source ownership and do not receive
  lock records, exported adapter names, client support, scopes, or installable
  profile exposure.
- `provenance.sources.yaml` can record reviewed public-source observations and
  unresolved candidates as supporting evidence; it is not a competing
  disposition manifest.
- The doctor and catalog verifier fail when a top-level skill has no registry
  disposition or when an inventory-only entry leaks into the lock/install path.

## Scope

In scope:

- public reusable skill source folders in this repository
- `skills.registry.yaml` source ownership and update policy
- `skills.lock.yaml` reviewed resolved pins and digests
- generated public catalog artifacts derived from registry, lock, the checked-in
  example profile, and `SKILL.md` front matter
- machine and repo profile examples that describe intended exposure
- doctor checks for source, lock, profile, upstream, manager, and adapter drift
- stale external-pin reporting that compares reviewed tags with upstream
  release-like tags before update PRs
- sync-plan output that generates reviewable adapter actions and pinned manager
  commands where the upstream manager can own the write
- setup/update workflows for new machines, existing machines, repo-local
  installs, verification, failure recovery, and restart expectations
- read-only provenance audits that flag registry-local external-derived
  skills, unresolved external imports, unresolved public-source candidates,
  and duplicate local skill folders
- public docs that let external users install skills without private 51Code
  context

Out of scope:

- private 51Code client context
- secrets, browser profiles, transcripts, runtime state, or machine-local paths
- a custom package manager
- local install/update/remove fallback code in `scripts/skills_sync.rb`
- unattended cleanup of stale adapter folders
- broad bootstrap automation before the contract, catalog, and update workflow
  are validated

## Source Ownership

Each registry-covered reusable skill must have exactly one active source owner.

| Source type | Meaning | Required metadata |
| --- | --- | --- |
| `registry-local` | 51Code owns and edits the skill in this repository, including maintained local forks of upstream skills. | `source.path`, exported names, supported clients, scopes, update policy, lock digest. Preserve upstream provenance and fork reason in `notes` or adjacent docs when relevant. |
| `external-git` | A third-party upstream remains authoritative. | Upstream URL, path, exact pinned tag, observed commit, observed date, update policy, lock digest. Record current license review status in `notes` or the PR body until the registry schema grows a dedicated field. |
| `unresolved-local` | A checked-in folder exists, but source ownership, license, alternatives, or lifecycle has not been reviewed, or the folder is retained as legacy. This is a disposition, not an ownership claim. | Top-level `source.path` and status `needs-source-review` or `legacy`. No lock, exports, clients, scopes, or install metadata. |

Allowed lifecycle statuses are:

| Status | Installable | Meaning |
| --- | --- | --- |
| `active` | Yes, when source/client/profile requirements also pass. | Reviewed source ownership and supported reusable-skill contract. |
| `needs-import-review` | No. | A resolved external source is pinned, but import or adapter exposure is not approved. |
| `needs-source-review` | No. | Checked-in content still needs origin, license, alternatives, and keep/replace/fork review. |
| `legacy` | No. | Retained for history or compatibility but excluded from new installs. |

Do not edit consumer copies as source. Consumer roots such as
`~/.codex/skills`, `~/.agents/skills`, `~/.claude/skills`, `.agents/skills`,
and `.claude/skills` are adapter views.

If a PR modifies a third-party skill's content, it must either reclassify that
maintained copy as `registry-local` and preserve upstream provenance in
`notes` or adjacent docs, or move the customization into a separate
registry-owned wrapper skill.

If `scripts/skills_provenance_audit.rb` reports reviewed external provenance
for a `registry-local` skill, the next source-ownership PR must either
reclassify the skill as `external-git` or explicitly keep it `registry-local`
as a maintained fork with upstream provenance and fork reason recorded.
Unregistered external imports must not be promoted into profiles until the
source owner, license review, update policy, supported clients, scopes, and
lock/version metadata are decided.

## Version And Lock Policy

`skills.registry.yaml` records the intended source and update policy.
`skills.lock.yaml` records the reviewed resolved state used by doctor and sync
planning.

Every non-legacy resolved-source entry must be backed by lock/version metadata:

- registry-local skills require a digest of the source folder
- external-git skills require an exact pinned tag plus observed commit
- unresolved-local entries must not appear in `skills.lock.yaml`
- external-git update PRs must keep `source.observed_commit` aligned with the
  reviewed tag
- `source.observed_at` is review evidence for that tag and should stay aligned
  in the registry entry or PR body until doctor/sync/lock enforcement supports
  it end-to-end
- lock regeneration must be explicit and reviewed
- update PRs must show registry diff, lock diff, catalog-facing description
  impact, and verification output

Commit-only external pins are not yet part of the supported public contract.
`scripts/skills_doctor.rb` and `scripts/skills_sync.rb` still require
`source.pinned_tag`, so contract docs must stay tag-based until that tooling
support exists end-to-end.

"Latest" means latest approved on `main` or a tagged release of this registry,
not unreviewed latest from an arbitrary upstream source.

## Upstream Update Checks

External skills are not silently updated. `scripts/skills_upstream_updates.rb`
is the read-only reporter for stale third-party pins. It compares each
`external-git` registry entry against release-like upstream tags, checks that
the lock entry still matches the registry entry, and emits the evidence needed
for a reviewed update PR.

Normal output is advisory:

```bash
scripts/skills_upstream_updates.rb --markdown
scripts/skills_upstream_updates.rb --json
```

Scheduled monitors or manual gates can fail when an update needs review:

```bash
scripts/skills_upstream_updates.rb --fail-on-stale
```

The script must not mutate `skills.registry.yaml`, `skills.lock.yaml`,
generated catalog artifacts, or consumer adapters. A human-reviewed update PR
is still required to review upstream diff, license state, skill instructions,
registry metadata, lock metadata, catalog impact, doctor proof, and sync-plan
impact.

`scripts/skills_provenance_audit.rb` is the complementary read-only reporter
for skills that are not yet correctly represented as external pins. It reads
`provenance.sources.yaml` and local `*/SKILL.md` inventory, can optionally
compare against operator-supplied local upstream clones through `--source-root`,
and must not fetch from the network or mutate source, registry, lock, catalog,
or adapter files.

## Generated Public Catalog

`skills.catalog.json` and `docs/skills-catalog.md` are generated views for
public users, future `51code.com` publishing, and agent-host integrations. They
are not source files.

The generator reads:

- `skills.registry.yaml` for source ownership, status, clients, scopes, update
  policy, external pins, and external catalog descriptions
- `skills.lock.yaml` for reviewed resolved lock metadata
- checked-in local `SKILL.md` front matter for public names and descriptions

External skills without a local `SKILL.md` must include a non-empty
catalog-facing description in registry metadata before they can appear in the
catalog. The generator fails on stale catalog artifacts, private paths, missing
descriptions, missing dispositions, missing lock entries for resolved sources,
locks for unresolved sources, stale locks, and unpinned external metadata.
An explicit `see skill-id` cross-skill reference in a catalog-facing
description must resolve to an active entry in this registry. Omit upstream
cross-links to skills outside the curated registry instead of publishing a
dangling route.

Do not edit generated catalog artifacts by hand:

```bash
scripts/skills_catalog.rb --write
scripts/skills_catalog.rb --check
```

## Adapter Views

Adapter views are generated from registry, lock, and profile data. The normal
write engine is the upstream `skills` CLI where it can safely target the
requested agent and scope.

Generated adapter views must cover these consumer classes:

| Consumer class | Typical roots | Current policy |
| --- | --- | --- |
| Codex | `.agents/skills`, `~/.agents/skills`, `~/.codex/skills` | Use pinned upstream manager commands where proven; verify manager-owned copies by digest. |
| OpenCode | `~/.agents/skills` | Use the proven shared manager-owned root where the upstream manager reports OpenCode visibility; verify copied skills by digest. |
| Claude Code | `.claude/skills`, `~/.claude/skills` | Use pinned upstream manager commands where supported; keep unsupported adapter shapes in manual review. |
| Repo-local consumers | repo `.agents/skills`, repo `.claude/skills` | Generate from repo profiles; do not commit copied reusable skills as hidden forks. |

`scripts/skills_sync.rb --plan --json` is the local generator for reviewable
adapter plans. It never writes files. Actions include `management.owner`:

- `upstream-manager`: run the emitted pinned `npx skills@1.5.14` command
- `manual-review`: no safe manager command can be emitted yet
- `none`: no manager write is needed

`manager-copy` means this registry verifies a copied directory owned by the
upstream manager. It does not authorize local copy/install code.

## Manager Boundary

Use the upstream `skills` CLI for normal install/update/remove behavior,
supported agent path mapping, and upstream lock writes. Use this repository for
source folders, registry policy, reviewed pins, doctor checks, sync planning,
and public catalog metadata.

Do not add local install/update/remove behavior to `scripts/skills_sync.rb`.
Unsupported writes stay in manual review until the upstream manager supports
the target or a narrow, reviewed exception is approved.

## Public-Safety Requirements

This is a public repository. Public docs, generated artifacts, and examples
must not include:

- private 51Code client data
- personal tokens, passwords, API keys, or bearer secrets
- browser profiles, transcripts, or runtime artifacts
- absolute user-specific filesystem paths
- machine names or account names presented as required state
- private repo URLs unless explicitly intended as public examples

Use placeholders such as `path/to/product-repo` for examples. Local diagnostic
tools must keep paths redacted by default.

## Completion Criteria For Registry Changes

A registry-contract PR is ready only when:

- source ownership remains unique for every registry-covered reusable skill
- provenance audit findings are acknowledged when a PR registers backlog
  skills, promotes copied skills, or edits source ownership
- registry and lock/version metadata are consistent
- generated public catalog artifacts are current and public-safe
- stale external-pin reports identify whether third-party pins need review
- public docs use pinned manager commands for reproducible workflows
- setup/update workflows describe expected outcomes and stop conditions
- adapter plans cover Codex, OpenCode, Claude Code, and repo-local consumers
  without hand-editing consumer copies
- historical proof artifacts are not the primary onboarding path
- `scripts/skills_sync.rb` remains plan-only
- public-safety scans show no local path, secret, or private-context leaks
- repository verification commands pass

## Verification

Run these checks before opening or updating a PR:

```bash
for file in scripts/skills_drift_report.sh scripts/test_skills_catalog.sh scripts/test_skills_doctor.sh scripts/test_skills_provenance_audit.sh scripts/test_skills_registry_verify.sh scripts/test_skills_setup_workflow_docs.sh scripts/test_skills_sync.sh scripts/test_skills_upstream_updates.sh; do
  bash -n "$file"
done
ruby -c scripts/skills_catalog.rb
ruby -c scripts/skills_doctor.rb
ruby -c scripts/skills_provenance_audit.rb
ruby -c scripts/skills_sync.rb
ruby -c scripts/skills_upstream_updates.rb
scripts/test_skills_provenance_audit.sh
scripts/skills_provenance_audit.rb --markdown
scripts/test_skills_upstream_updates.sh
scripts/skills_upstream_updates.rb --markdown
scripts/test_skills_catalog.sh
scripts/test_skills_doctor.sh
scripts/test_skills_registry_verify.sh
scripts/test_skills_setup_workflow_docs.sh
scripts/test_skills_sync.sh
scripts/skills_catalog.rb --check
scripts/skills_sync.rb --plan --json
scripts/skills_doctor.rb --check-upstream
scripts/skills_doctor.rb --check-manager
git diff --check
```

Use the Autopilot `skills-registry` verify profile when available.

## History

Historical proof profiles and drift reports are retained in `docs/history/` for
auditability. They are not the active workflow for installing or updating
skills.
