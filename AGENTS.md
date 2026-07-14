# Agent Guide

This repo is a collection of Codex skills. Checked-in local skills live in
top-level directories with `SKILL.md` files; registry-covered external skills
point to their authoritative upstream sources through `skills.registry.yaml` and
`skills.lock.yaml`.

## Structure
- One folder per checked-in local skill at repo root.
- Every skill folder must include `SKILL.md` with YAML front matter (`name`, `description`).
- Optional folders: `assets/`, `scripts/`, `references/`.
- `skills.registry.yaml` is the sole disposition, source-ownership, and
  update-policy manifest. Every top-level `SKILL.md` must appear exactly once.
- `skills.lock.yaml` is reviewed lock/version metadata for resolved sources;
  unresolved and legacy inventory-only entries must not appear there.
- `provenance.sources.yaml` records public-safe upstream provenance
  observations and unresolved candidates for local skill folders.
- `skills.catalog.json` and `docs/skills-catalog.md` are generated public
  catalog views derived from registry, lock, the checked-in example profile,
  and `SKILL.md` metadata.
- `docs/registry-contract.md` is the public contract for source ownership,
  lock/version metadata, generated adapter views, public-safety requirements,
  and completion criteria.
- `docs/usage.md` contains public and 51Code operator workflows.
- `docs/setup-update-workflow.md` contains the public-safe new-machine,
  existing-machine, repo-local setup, verification, failure recovery, and
  restart workflow.
- `docs/contributing.md` contains skill editing, third-party update, fork, and
  validation workflows.
- `docs/manager-boundary.md` defines the accepted boundary between this public
  registry and the upstream `skills` CLI.
- `profiles/` may contain desired machine or repo exposure profiles for sync
  planning.
- `docs/` may contain public registry workflows and historical reports.
- `scripts/` may contain inventory, verification, doctor, and sync helpers.
- `scripts/skills_catalog.rb` generates and checks public catalog artifacts.
- `scripts/skills_sync.rb --plan` previews adapter create/update/remove actions
  without changing Codex, Claude, machine, or repo-local consumer folders.
- `scripts/skills_upstream_updates.rb` reports stale external-git pins and the
  evidence needed for reviewed update PRs; it does not mutate registry, lock,
  catalog, or adapter files.
- `scripts/skills_provenance_audit.rb` reports source-ownership drift,
  unregistered external imports, unresolved provenance candidates, and local
  duplicate skills; it does not fetch from the network or mutate sources.

## Local Operator Context

Use local operator-provided context if available. Do not commit private/local context files, machine paths, credentials, internal task links, or company-only notes.

## How to work in this repo
- If a task mentions a checked-in local skill, open that skill's `SKILL.md` and
  follow its workflow. If it mentions a registry-covered external skill, use the
  registry and lock metadata to find the reviewed upstream source instead of
  assuming a local `SKILL.md` exists.
- Use the front matter in `SKILL.md` as the source of truth for name/description.
- Use `skills.registry.yaml` as the source of truth for ownership, upstream
  source, update policy, and intended consumer exposure.
- Use `skills.lock.yaml` as the reviewed resolved-version input for sync plans.
- Do not edit generated catalog artifacts by hand. Update registry, lock, the
  checked-in example profile, or skill front matter, then run
  `scripts/skills_catalog.rb --write`.
- Active reusable skills must have one source owner, lock/version metadata, and
  generated adapter views for Codex, Claude Code, OpenCode, and repo-local
  consumers.
- Only active entries may emit install commands. Use `unresolved-local` with
  `needs-source-review` or `legacy` to record checked-in non-installable folders
  without making an ownership claim.
- Keep edits scoped to the requested skill(s); avoid cross-skill changes unless asked.
- When adding/removing a skill, update the README skills list and regenerate
  the catalog if registry-covered metadata changed.
- Do not edit imported consumer copies in `~/.codex/skills`, `~/.agents/skills`,
  `~/.claude/skills`, or product repo `.agents/skills`; update the owning skill
  source or registry manifest instead.
- Use pinned upstream `npx skills` commands for normal install/update/remove
  behavior when supported. Keep local scripts focused on policy checks,
  planning, and post-write verification.
- Run `scripts/skills_provenance_audit.rb --markdown` before resolving an
  unreviewed skill disposition or promoting a copied skill into a profile. Treat
  registry-local skills with reviewed external provenance as follow-up
  reclassification or fork decisions, not as silent source ownership.
- Use `scripts/skills_upstream_updates.rb --fail-on-stale` for scheduled or
  manual stale external-pin detection before preparing third-party update PRs.
- Use `docs/setup-update-workflow.md` as the canonical setup/update runbook;
  keep commands pinned, expected outcomes explicit, and unsupported adapter
  writes in manual review.
- Use `adapter: manager-copy` only in explicit reviewed profiles for targets
  proven to be owned by the upstream manager. It means "verify the manager's
  copied folder by digest"; it does not authorize local copy/install code.
- Use selected-skill `consumer_overrides` only for narrow proven exceptions,
  such as one manager-owned copied skill inside a root whose other skills still
  follow the root-level adapter contract.
- Do not add local apply/install/update/remove fallback behavior to
  `scripts/skills_sync.rb`; upstream-manager actions should emit pinned
  commands, while unsafe or unsupported writes stay manual-review.
- Keep historical proof profiles and drift reports under `docs/history/`; do not
  make them the primary onboarding path.

## Conventions
- Keep docs concise and ASCII-only.
- Prefer small, focused changes and avoid reformatting unrelated files.

## Codex Cloud Environment

Recommended environment description:

```text
Lightweight Codex Cloud review environment for fiveonecode/agent-skills. Used for skill docs/review edits and SKILL.md structure checks; no secrets and agent internet off by default.
```

- Use the `universal` image with container caching on.
- No secrets are required by default.
- Keep agent-phase internet access off by default; enable it only for a task that explicitly needs external source lookup.
- Setup can stay lightweight: generate a sorted `SKILL.md` inventory or run the registry verifier once it is available in the selected branch.
- Do not add a maintenance script unless cached containers repeatedly show stale generated state.

## Review Guidelines

For Codex GitHub code review, flag only high-impact issues:

- missing `SKILL.md` entrypoints for skill directories
- invalid or missing YAML front matter `name` or `description`
- README skills list drift when skills are added, renamed, or removed
- generated catalog drift or hand-edited catalog artifacts
- edits to imported consumer copies instead of the owning skill source or registry
- registry ownership, upstream source, update policy, or exposure profile drift
- provenance source-map drift, missing upstream attribution, or external
  copies marked as registry-local without a fork reason
- committed secrets, private credentials, local machine paths that should be templated, or accidental binary/editor junk
- scripts or assets that make skill usage non-reproducible
- missing required registry verification evidence for `.agents`, `skills.registry.yaml`, `profiles`, `scripts`, `AGENTS.md`, or README changes

Do not block on style nits, broad rewrites, or speculative skill packaging ideas.

## New Skills
- `apple-hig-designer`: Design iOS apps following Apple's HIG, including native components, accessibility validation, and the clarity/deference/depth principles. Use its registry and lock entries to locate the reviewed upstream workflow; this repository does not keep a local mirror.
- `ios-xcodegen`: Manage XcodeGen projects—regenerate `project.yml`, wire assets, configure tests, and resolve packaging issues without editing the generated `.xcodeproj`. Read `ios-xcodegen/SKILL.md` before touching builds.
- `xcode-build`: Run native `xcodebuild`/`xcrun simctl` commands to build, launch, and test iOS/macOS apps; the skill enforces command-line patterns defined in `xcode-build/SKILL.md`.
- `xcode-cloud`: Configure and debug Xcode Cloud workflows, especially around XcodeGen projects and custom `ci_scripts`. Use the templates and guidance stored in `xcode-cloud/SKILL.md`.
