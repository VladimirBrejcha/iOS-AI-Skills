# Setup And Update Workflow

Status: active-partial
Last updated: 2026-07-06

Related: [README](../README.md), [Usage](usage.md),
[Registry Contract](registry-contract.md), [Manager Boundary](manager-boundary.md),
[Contributing](contributing.md), [generated catalog](../skills.catalog.json),
[example machine profile](../profiles/machine/example-local-skills.yaml)

This runbook is the public-safe operating path for using this registry on a
new machine, refreshing an existing machine, and adding reviewed skills to a
repo. It uses the upstream `skills` manager for writes and this repository for
source policy, lock metadata, catalog output, doctor checks, and sync planning.

Do not hand-edit consumer folders. Paths such as `~/.agents/skills`,
`~/.codex/skills`, `~/.claude/skills`, `.agents/skills`, and `.claude/skills`
are adapter views, not sources.

## Outcomes

Use this workflow when you need one of these outcomes:

- A new machine has the reviewed registry clone, prerequisites, and approved
  global Codex skills installed or verified.
- An existing machine pulls the latest approved registry state and refreshes
  only manager-owned adapters.
- A product repo gets a reviewed repo-local skill install without creating a
  hidden fork.
- A stale third-party pin turns into a reviewed registry update PR instead of a
  silent local update.

## Preflight

Run this before any setup or update work:

```bash
git --version
node --version
npm --version
npx --yes skills@1.5.14 --version
ruby -ryaml -e 'puts "ruby yaml ok"'
```

Expected outcome: every command exits successfully. If `npx --yes
skills@1.5.14 --version` fails, fix Node/npm access before continuing. Do not
switch to an unpinned manager command.

## New Machine Setup

Clone the registry and start from current `main`:

```bash
git clone https://github.com/fiveonecode/agent-skills.git
cd agent-skills
git switch main
git pull --ff-only
git status --short --branch
```

Expected outcome: the checkout is on `main` and has no local changes.

Verify the approved source state:

```bash
scripts/skills_catalog.rb --check
scripts/skills_doctor.rb
scripts/skills_doctor.rb --check-upstream
scripts/skills_upstream_updates.rb --markdown
scripts/skills_sync.rb --plan --json
```

Expected outcome: catalog and doctor checks complete without errors. Warnings
about planned, blocked, or manual-review adapters are not install permission;
they identify work that needs a follow-up registry/profile PR or an upstream
manager fix.

Print the reviewed global Codex install commands from the generated catalog:

```bash
ruby -rjson -e '
  catalog = JSON.parse(File.read("skills.catalog.json"))
  catalog.fetch("skills").each do |skill|
    command = skill.dig("install", "codex_global_command")
    puts command if command
  end
'
```

Review the printed commands. Run only the commands you intend to install. A
printed command is expected to use the pinned manager package and this registry
source, for example:

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill code-review \
  --agent codex \
  --global \
  --yes
```

Expected outcome: each selected command completes through the upstream
manager. The command may create or update a manager-owned copied directory in
the manager's global Codex target.

Verify the install:

```bash
npx --yes skills@1.5.14 ls --global --json
scripts/skills_doctor.rb --check-manager
scripts/skills_sync.rb --plan --json
```

Expected outcome: installed manager-owned skills report `keep` and `ok`, or
the sync plan reports no manager action needed for that adapter. If the sync
plan reports `manual-review`, stop instead of editing adapter folders.

Restart any already-running app or CLI session that needs to load newly
installed skills. A currently running agent session may not discover a new
adapter until it starts again.

## Existing Machine Update

Pull the latest approved registry state:

```bash
cd path/to/agent-skills
git switch main
git pull --ff-only
git status --short --branch
```

Expected outcome: the checkout is on current `main` with no local changes.

Check source, upstream, manager, and adapter state:

```bash
scripts/skills_catalog.rb --check
scripts/skills_upstream_updates.rb --markdown
scripts/skills_upstream_updates.rb --fail-on-stale
scripts/skills_doctor.rb --check-upstream
scripts/skills_doctor.rb --check-manager
scripts/skills_sync.rb --plan --json
```

Expected outcome: `--fail-on-stale` exits successfully when all external pins
are current. If it fails, prepare a third-party update PR; do not install
unreviewed upstream latest directly on the machine.

Print any manager-owned update/install commands recommended by the sync plan:

```bash
scripts/skills_sync.rb --plan --json | ruby -rjson -e '
  plan = JSON.parse(STDIN.read)
  plan.fetch("actions").each do |action|
    management = action.fetch("management", {})
    command = management["command"]
    next unless management["owner"] == "upstream-manager" && command
    puts command
  end
'
```

Expected outcome: commands are printed only for reviewed actions that the
upstream manager can own. Run those commands one at a time only after reading
the related action, skill id, target, and reason. If no commands are printed,
the machine is either already in the reviewed state or remaining actions are
manual-review.

After any manager write, verify again:

```bash
npx --yes skills@1.5.14 ls --global --json
scripts/skills_doctor.rb --check-manager
scripts/skills_sync.rb --plan --json
```

Expected outcome: the changed adapter reports `keep` and `ok`, or the manager
state is otherwise explained by the plan. If the same action remains
`manual-review`, document the upstream manager gap instead of adding a local
writer.

## Repo-Local Setup

Run repo-local manager commands from the product repo that should receive the
skill:

```bash
cd path/to/product-repo
npx --yes skills@1.5.14 add fiveonecode/agent-skills \
  --skill code-review \
  --agent codex \
  --yes
npx --yes skills@1.5.14 ls --json
```

Expected outcome: the product repo has a manager-owned project install and a
project `skills-lock.json` entry for the selected skill. Commit project skill
lock changes only when that product repo wants reproducible repo-local skill
state.

From the registry clone, verify the project lock when a repo-local install or
update is part of the reviewed task:

```bash
cd path/to/agent-skills
scripts/skills_doctor.rb --check-manager \
  --manager-project-lock path/to/product-repo/skills-lock.json
scripts/skills_sync.rb --plan --json
```

Expected outcome: doctor can read the project lock and the sync plan remains
read-only. Project updates stay manual-review in this registry until upstream
project update behavior is stable enough for a broader default workflow.

## Failure Recovery

Use these rules when setup or update output is not clean:

- `manual-review`: stop. Do not copy, edit, remove, or symlink adapter folders
  by hand.
- `upstream-manager`: run only the exact pinned command printed by the sync
  plan, then rerun doctor and sync-plan verification.
- `none`: no manager write is needed for that action.
- Stale external pin: open a registry/lock/catalog update PR after reviewing
  upstream diff, license state, and skill instructions.
- Missing manager state: rerun the exact reviewed `add` command for that skill
  and scope, then verify with `ls`, doctor, and sync plan.
- Mixed global installs: do not run broad `update --global`; inspect the
  installed global set and update reviewed skill ids one at a time.
- Claude Code or repo-local planned support: keep it manual-review unless the
  registry, profile, and manager boundary docs explicitly promote that target.
- Current agent session does not see a newly installed skill: restart the app
  or CLI session after verification succeeds.

## Review Checklist

Before merging setup/update workflow changes, confirm:

- documented manager commands use `npx --yes skills@1.5.14`
- the workflow never recommends a local sync apply mode
- the workflow never recommends experimental manager restore paths
- source updates go through registry/lock/catalog PRs
- consumer folders are described as adapter views, not source folders
- expected outcomes are stated for every write or verification step
- examples use placeholders such as `path/to/product-repo`, not personal paths
