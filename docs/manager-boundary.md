# Manager Boundary

Status: accepted
Last verified: 2026-07-08

Related: [README](../README.md), [Registry Contract](registry-contract.md),
[Usage](usage.md), [Setup And Update Workflow](setup-update-workflow.md),
[Contributing](contributing.md),
[registry manifest](../skills.registry.yaml),
[example local profile](../profiles/machine/example-local-skills.yaml)

## Decision

Use the upstream `skills` CLI as the normal write engine for skill
install/update/remove operations. Keep this repository focused on public skill
sources, registry policy, reviewable pins, doctor checks, and planning output.

This repository must not become a competing package manager.

## Source Of Truth Split

`fiveonecode/agent-skills` owns:

- reusable public skill source folders
- `skills.registry.yaml` source ownership and update policy
- `skills.lock.yaml` reviewed resolved pins and digests
- profile examples that describe intended consumer exposure
- `scripts/skills_doctor.rb` policy, source-health, and drift checks
- `scripts/skills_sync.rb --plan` reviewable adapter planning output

The upstream `skills` CLI owns:

- fetching skill sources from GitHub, GitLab, git URLs, HTTP(S) endpoints, or
  local paths
- normal `add`, `remove`, `list`, `find`, and `update` behavior
- agent path mapping for supported agents
- symlink versus copy installation mechanics
- project `skills-lock.json` writes
- global skill lock state under `$XDG_STATE_HOME/skills/.skill-lock.json` or
  `~/.agents/.skill-lock.json`

Consumer folders such as `.agents/skills`, `.claude/skills`, `~/.codex/skills`,
`~/.claude/skills`, and shared agent roots are adapter outputs. Do not hand-edit
imported copies there when the source belongs to this registry or to an external
upstream.

## Reviewed Commands

Pin the CLI version in documented and automated commands so local package cache
state does not silently change behavior:

```bash
npx --yes skills@1.5.14 --version
```

Install one skill for Codex in the current project. Run this from the product
repo, not from the `agent-skills` clone:

```bash
cd path/to/product-repo
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill code-review \
  --agent codex \
  --yes
```

Install one skill into the reviewed shared global manager root:

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill code-review \
  --agent codex \
  --global \
  --yes
```

List observed global state in machine-readable form:

```bash
npx --yes skills@1.5.14 ls --global --json
```

Run this repository's policy checks after any manager write:

```bash
scripts/skills_doctor.rb
scripts/skills_doctor.rb --check-upstream
scripts/skills_doctor.rb --check-manager
scripts/skills_sync.rb --plan --json
```

`--check-manager` is explicitly read-only. It reads the pinned manager list,
global manager lock state, and project `skills-lock.json` files as evidence; it
does not run `skills add`, `skills update`, `skills remove`, or any adapter
rewrite.

`scripts/skills_sync.rb --plan --json` is also read-only. Each action includes
`management.owner`. `upstream-manager` actions include a pinned command to run
for one reviewed skill and agent. `manual-review` actions are not safe
upstream-manager writes without more review. `none` means no manager write is
needed.

Unsupported adapters, shared roots such as `~/.agents/skills`, and stale
adapter cleanup stay `manual-review` until the planner can prove an upstream
manager command will verify clean on the next doctor/sync pass. The only
exception is an explicit reviewed `manager-copy` profile: it models a copied
folder owned by the upstream manager and verifies the copy by digest instead of
expecting a symlink.

OpenCode support uses the same reviewed shared `~/.agents/skills` manager root
where the upstream global list reports OpenCode visibility. Claude Code targets
stay manual-review unless the relevant skills move from
`clients.claude: planned` to reviewed support in the registry and example
profiles.

There is no local `--apply` fallback in this repository. If the upstream manager
cannot express a safe write, document the concrete upstream gap and keep the
action in manual review instead of adding a competing local installer.

## Non-Goals

Do not add custom code here for:

- broad multi-skill install/update/remove workflows
- local install/update/remove fallbacks that duplicate the upstream manager
- lock restore that duplicates upstream `skills-lock.json` behavior
- automatic stale adapter deletion
- unattended bootstrap across every consumer root
- hidden unpinned `npx skills` usage
- direct mutation of consumer folders before a plan has been reviewed

Those features belong upstream unless a concrete upstream gap is documented with
a primary source or reproducible failure.

## Proven Manager-Owned Targets

Ten shared global manager-copy targets are already proven on the default
example profile. The command currently uses `--agent codex` because that is the
reviewed manager write path for `~/.agents/skills`; the upstream manager reports
that same shared-root install as visible to OpenCode. Claude Code has ten
separate proven global targets through `~/.claude/skills`, matching the active
registry-local set. External-git entries such as `swift-concurrency` and
`swiftui-pro`, repo-local consumers, and unclassified top-level skills remain
planned/manual-review until equivalent proof exists.

| Skill | Manager command | Adapter target | Lock key |
| --- | --- | --- | --- |
| `code-review` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill code-review --agent codex --global --yes` | `~/.agents/skills/code-review` | `skills.code-review` |
| `gemini-files-api` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill gemini-files-api --agent codex --global --yes` | `~/.agents/skills/gemini-files-api` | `skills.gemini-files-api` |
| `harness-engineering` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill harness-engineering --agent codex --global --yes` | `~/.agents/skills/harness-engineering` | `skills.harness-engineering` |
| `meeting-transcription` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill meeting-transcription --agent codex --global --yes` | `~/.agents/skills/meeting-transcription` | `skills.meeting-transcription` |
| `spec-creation-updating` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill spec-creation-updating --agent codex --global --yes` | `~/.agents/skills/spec-creation-updating` | `skills.spec-creation-updating` |
| `ios-xcodegen` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill ios-xcodegen --agent codex --global --yes` | `~/.agents/skills/ios-xcodegen` | `skills.ios-xcodegen` |
| `xcode-build` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill xcode-build --agent codex --global --yes` | `~/.agents/skills/xcode-build` | `skills.xcode-build` |
| `xcode-cloud` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill xcode-cloud --agent codex --global --yes` | `~/.agents/skills/xcode-cloud` | `skills.xcode-cloud` |
| `swift-testing` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill swift-testing --agent codex --global --yes` | `~/.agents/skills/swift-testing` | `skills.swift-testing` |
| `swiftui-view-refactor` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill swiftui-view-refactor --agent codex --global --yes` | `~/.agents/skills/swiftui-view-refactor` | `skills.swiftui-view-refactor` |

Ten separate Claude Code global manager-copy targets are proven on the default
example profile:

| Skill | Manager command | Adapter target | Lock key |
| --- | --- | --- | --- |
| `code-review` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill code-review --agent claude-code --global --yes` | `~/.claude/skills/code-review` | `skills.code-review` |
| `gemini-files-api` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill gemini-files-api --agent claude-code --global --yes` | `~/.claude/skills/gemini-files-api` | `skills.gemini-files-api` |
| `harness-engineering` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill harness-engineering --agent claude-code --global --yes` | `~/.claude/skills/harness-engineering` | `skills.harness-engineering` |
| `meeting-transcription` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill meeting-transcription --agent claude-code --global --yes` | `~/.claude/skills/meeting-transcription` | `skills.meeting-transcription` |
| `spec-creation-updating` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill spec-creation-updating --agent claude-code --global --yes` | `~/.claude/skills/spec-creation-updating` | `skills.spec-creation-updating` |
| `ios-xcodegen` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill ios-xcodegen --agent claude-code --global --yes` | `~/.claude/skills/ios-xcodegen` | `skills.ios-xcodegen` |
| `xcode-build` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill xcode-build --agent claude-code --global --yes` | `~/.claude/skills/xcode-build` | `skills.xcode-build` |
| `xcode-cloud` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill xcode-cloud --agent claude-code --global --yes` | `~/.claude/skills/xcode-cloud` | `skills.xcode-cloud` |
| `swift-testing` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill swift-testing --agent claude-code --global --yes` | `~/.claude/skills/swift-testing` | `skills.swift-testing` |
| `swiftui-view-refactor` | `npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill swiftui-view-refactor --agent claude-code --global --yes` | `~/.claude/skills/swiftui-view-refactor` | `skills.swiftui-view-refactor` |

The Claude Code proofs use the same standard as the shared-root proofs:
pre-write sync emitted the exact pinned manager command, the command created a
manager-owned copy under `~/.claude/skills`, the installed file set matched
the registry source, the post-write sync plan reported `keep`/`ok`, and the
manager global list reported each skill for Claude Code.

The checked-in proof artifacts and initial drift report are historical records
under `docs/history/`:

- `docs/history/manager-pilot-code-review-codex-global.profile.yaml`
- `docs/history/manager-pilot-code-review-claude-global.profile.yaml`
- `docs/history/manager-pilot-code-review-claude-global.md`
- `docs/history/manager-pilot-harness-engineering-codex-global.profile.yaml`
- `docs/history/manager-pilot-harness-engineering-claude-global.profile.yaml`
- `docs/history/manager-pilot-harness-engineering-claude-global.md`
- `docs/history/manager-pilot-meeting-transcription-codex-global.profile.yaml`
- `docs/history/manager-pilot-meeting-transcription-claude-global.profile.yaml`
- `docs/history/manager-pilot-meeting-transcription-global.md`
- `docs/history/manager-pilot-ios-xcodegen-claude-global.profile.yaml`
- `docs/history/manager-pilot-ios-xcodegen-claude-global.md`
- `docs/history/manager-pilot-spec-creation-updating-claude-global.profile.yaml`
- `docs/history/manager-pilot-spec-creation-updating-claude-global.md`
- `docs/history/manager-pilot-xcode-build-claude-global.profile.yaml`
- `docs/history/manager-pilot-xcode-build-claude-global.md`
- `docs/history/manager-pilot-xcode-cloud-claude-global.profile.yaml`
- `docs/history/manager-pilot-xcode-cloud-claude-global.md`
- `docs/history/manager-pilot-remaining-claude-global.profile.yaml`
- `docs/history/manager-pilot-remaining-claude-global.md`
- `docs/history/skill-registry-drift-report-2026-06-26.md`

New managed targets should be introduced through the setup/update workflow,
with the pre-write sync plan showing exact pinned manager commands and the
post-write doctor/sync plan proving matching manager-owned copies.

## Current Upstream Limits To Respect

As of `2026-06-30`, do not treat upstream lock restore as a stable bootstrap
contract. The `skills` CLI exposes `experimental_install` for restoring from
`skills-lock.json`, and open upstream issues track restore/update edge cases.

Known limits that should keep local automation conservative:

- stable lock restore is still requested in upstream issues
  [#283](https://github.com/vercel-labs/skills/issues/283) and
  [#549](https://github.com/vercel-labs/skills/issues/549)
- update failure handling is tracked in
  [#1519](https://github.com/vercel-labs/skills/issues/1519)
- project update source handling is tracked in
  [#1530](https://github.com/vercel-labs/skills/issues/1530)
- root-level `SKILL.md` sibling-file handling is tracked in
  [#1517](https://github.com/vercel-labs/skills/issues/1517)
- stale project lock entries after remove are tracked in
  [#977](https://github.com/vercel-labs/skills/issues/977)

## Primary Sources

- Vercel Agent Skills documentation:
  <https://vercel.com/docs/agent-resources/skills>
- `skills` package:
  <https://www.npmjs.com/package/skills>
- `skills` upstream README and source:
  <https://github.com/vercel-labs/skills>
- Pinned upstream source audited for this decision:
  <https://github.com/vercel-labs/skills/tree/2adcfe5a4cce0ce5f4d5547a997b2a161ec5d127>
- Codex Skills documentation:
  <https://developers.openai.com/codex/skills>
- Claude Code Skills documentation:
  <https://code.claude.com/docs/en/skills>

## Next Local Slices

1. Continue managed-profile expansion only when the pre-write sync plan emits
   exact pinned manager commands and the post-write proof can verify manager
   ownership by digest.
2. Keep legacy Codex symlink roots, repo-local updates, unclassified skills,
   and external-git imports in manual review until their own evidence exists.
   Keep OpenCode tied to proven shared-root manager evidence rather than adding
   a separate local writer.
