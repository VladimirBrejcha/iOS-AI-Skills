# agent-skills

A curated set of reusable agent skills for Apple platform development, mobile
tooling, engineering harnesses, marketing workflows, and adjacent services.
Checked-in local skills are self-contained in top-level directories with a
`SKILL.md`; registry-covered external skills point at their authoritative
upstream source and reviewed pin.

## Registry Contract

This repository is the public source, disposition, and policy registry for
reusable 51Code agent skills. Every top-level `SKILL.md` has exactly one entry
in `skills.registry.yaml`; every non-legacy resolved-source entry has reviewed
source ownership and lock/version metadata. Only `active` entries are eligible
for installation, and profile/client proof remains a separate rollout gate.
The current catalog has no pending or legacy dispositions; those lifecycle
states remain available for future reviewed intake. The shared
`~/.agents/skills` manager path and separate `~/.claude/skills` copies are
reviewed baselines only for profile-selected skills whose target client is
marked `supported`. Client/skill combinations marked `planned`, repo-local
consumers, external-git entries such as `swift-concurrency` and `swiftui-pro`,
and non-active entries remain manual-review until their consumer exposure is
proven through a reviewed decision.

The contract is documented in:

- [Registry Contract](docs/registry-contract.md) - source ownership, version
  policy, adapter rules, public-safety requirements, and acceptance criteria.
- [Usage](docs/usage.md) - copyable install, list, update, doctor, and sync-plan
  commands for public users and 51Code operators.
- [Setup And Update Workflow](docs/setup-update-workflow.md) - step-by-step
  new-machine setup, existing-machine update, repo-local setup, verification,
  failure recovery, and restart expectations.
- [Contributing](docs/contributing.md) - workflows for editing 51Code-owned
  skills, importing third-party updates, and turning modified upstream skills
  into maintained forks.
- [Manager Boundary](docs/manager-boundary.md) - the accepted split between
  this registry and the upstream `skills` CLI.

The registry files are:

- `skills.registry.yaml` - complete top-level disposition inventory plus source
  ownership, upstream source, update policy, supported clients, and scopes for
  reviewed entries.
- `skills.lock.yaml` - reviewed resolved source digests and external pins.
- `provenance.sources.yaml` - public-safe upstream provenance observations for
  local skill folders that may be copied, derived, or unresolved.
- `skills.catalog.json` - generated machine-readable public inventory and
  install catalog.
- `docs/skills-catalog.md` - generated human-readable public catalog.
- `profiles/machine/example-local-skills.yaml` - example desired machine-level
  exposure profile.
- `scripts/skills_catalog.rb` - generated catalog writer and drift checker.
- `scripts/skills_doctor.rb` - registry, profile, lock, upstream, manager, and
  adapter health checks.
- `scripts/skills_sync.rb` - read-only adapter sync planner.
- `scripts/skills_provenance_audit.rb` - read-only source-ownership and copied
  skill provenance reporter.
- `scripts/skills_upstream_updates.rb` - read-only stale external-pin reporter
  for third-party update PR preparation.
- `scripts/test_skills_setup_workflow_docs.sh` - guardrail for public-safe,
  pinned setup/update workflow docs.
- `.agents/manifests/*.yaml` - Autopilot path routing and ownership contract.
- `.agents/verify/*.yaml` - Autopilot verification profile definitions.

Historical drift reports and proof profiles live under `docs/history/`. They
are retained for audit context, not as the current onboarding path.

This repository is available under the [MIT License](LICENSE). Maintained
third-party forks retain their reviewed notices in
[Third-Party Notices](THIRD_PARTY_NOTICES.md).

## Quick Start

Install one skill into the reviewed shared global manager root:

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill code-review \
  --agent codex \
  --global \
  --yes
```

List installed global skills:

```bash
npx --yes skills@1.5.14 ls --global --json
```

Run registry validation from a clone of this repo:

```bash
scripts/skills_doctor.rb
scripts/skills_doctor.rb --check-upstream
scripts/skills_doctor.rb --check-manager
scripts/skills_catalog.rb --check
scripts/skills_provenance_audit.rb --markdown
scripts/skills_upstream_updates.rb --markdown
scripts/skills_sync.rb --plan --json
```

`scripts/skills_sync.rb` is intentionally plan-only. Do not add local
install/update/remove behavior to it; use pinned upstream `npx skills` commands
where supported and keep unsupported actions in manual review.

For full workflows, see [Setup And Update Workflow](docs/setup-update-workflow.md)
and [Usage](docs/usage.md).

## Provenance Audit

Run the read-only provenance audit before registering backlog skills,
promoting copied skills into profiles, or deciding whether a local copy is an
external pin or a maintained fork:

```bash
scripts/skills_provenance_audit.rb --markdown
scripts/skills_provenance_audit.rb --json
```

The audit uses `provenance.sources.yaml` plus local `*/SKILL.md` inventory to
flag registry-local skills with reviewed external provenance, unresolved
external imports, unresolved public-source candidates, duplicate local skill
content, and duplicate front matter names. It does not fetch from GitHub,
update skill content, edit registry/lock files, or write consumer adapters.

When you have a local clone of a candidate upstream, add fresh comparison
evidence without enabling network access:

```bash
scripts/skills_provenance_audit.rb --markdown \
  --source-root pzep1-xcode-build-skill=path/to/xcode-build-skill
```

The fail flags are available for cleanup gates after the known backlog is
resolved:

```bash
scripts/skills_provenance_audit.rb --fail-on-registry-conflict
scripts/skills_provenance_audit.rb --fail-on-unregistered-import
```

## External Update Checks

Third-party skills stay pinned until 51Code reviews the upstream diff and lands
a registry/lock/catalog update PR. Run the read-only update report to detect
stale external pins:

```bash
scripts/skills_upstream_updates.rb --markdown
scripts/skills_upstream_updates.rb --json
scripts/skills_upstream_updates.rb --fail-on-stale
```

`--fail-on-stale` is intended for scheduled monitors or manual readiness
checks. It reports stale or missing external tags, but it does not edit
`skills.registry.yaml`, `skills.lock.yaml`, catalog artifacts, or consumer
adapters.

## Public Catalog

The registry-covered skill set is also published as generated catalog artifacts:

- [skills.catalog.json](skills.catalog.json) for websites, automation, and
  agent-host integrations.
- [Skills Catalog](docs/skills-catalog.md) for a readable list and current
  pinned reviewed install commands.

Do not edit those artifacts directly. Change `skills.registry.yaml`,
`skills.lock.yaml`, or the relevant `SKILL.md` front matter, then run:

```bash
tmp_lock="$(mktemp "${TMPDIR:-/tmp}/skills.lock.yaml.XXXXXX")"
scripts/skills_doctor.rb --print-lock >"$tmp_lock" &&
  mv "$tmp_lock" skills.lock.yaml
scripts/skills_catalog.rb --write
scripts/skills_catalog.rb --check
```

## Skills

The finalized catalog currently contains 42 active skills:

- 13 registry-local sources maintained in this repository
- 29 tagged external sources owned by their authoritative upstreams
- 0 pending or legacy dispositions

Use the generated [Skills Catalog](docs/skills-catalog.md) for names,
descriptions, source pins, client status, and install metadata. The dated
[Catalog Disposition Review](docs/history/catalog-disposition-review-2026-07-14.md)
records every keep, replacement, merge, and removal decision that closed the
initial review backlog.

## Contributing

Use [Contributing](docs/contributing.md) for the full workflow. At minimum,
skill changes must update the owning source, registry metadata, lock/version
metadata when needed, README/catalog-facing descriptions, generated catalog
artifacts, and verification
evidence in the same PR.
