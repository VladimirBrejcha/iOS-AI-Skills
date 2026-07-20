---
tracker:
  kind: 51code
  project: agent-skills
workspace:
  repo_path: .
  base_ref: refs/remotes/origin/main
codex:
  command: codex app-server --listen stdio://
validation:
  command: ./scripts/verify.sh
  evidence_path: .symphony/evidence.json
  log: .symphony/validation.log
handoff:
  default_push: false
  default_pr: false
  require_explicit_pr_handoff: true
  local_commit: true
  final_acceptance: human
agent:
  max_repair_turns: 2
safety:
  require_clean_base_repo: true
  stop_after_validated_local_handoff: true
---

# Agent Skills Workflow

Maintain the direct skill package and its pinned global bootstrap.

- Read `AGENTS.md` before editing.
- Edit checked-in skill sources, never installed consumer copies.
- Keep the repository free of registry, generated catalog, sync-planner, and
  backward-compatibility machinery.
- Keep public files free of credentials, local machine paths, private context,
  internal task links, and company-only notes.
- Run `./scripts/verify.sh` before handoff.
- Do not push or open a pull request from the default Symphony run path.
- Leave validated source changes for the runner to commit and stop at the
  validated local handoff boundary.
