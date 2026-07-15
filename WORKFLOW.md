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

Implement one reviewed catalog or harness task in this repository.

- Read `AGENTS.md`, the matched `.agents/manifests/*.yaml` files, and their
  linked registry documentation before editing.
- Keep `skills.registry.yaml` as the only source and disposition manifest.
- Do not hand-edit generated catalog files or imported consumer copies.
- Keep public files free of private context, local machine paths, credentials,
  internal task links, and company-only notes.
- Research-only tasks may write only their explicitly assigned evidence files.
  Tasks that change registry, lock, generated catalog, profile, or consumer
  state must follow the serialized integration boundary in their task contract.
- Run `./scripts/verify.sh` before handoff.
- Do not push, open a pull request, merge, update planner state, or write real
  consumer roots from the default run path.
- Do not run `git add` or `git commit`; leave validated source changes for the
  runner to commit, then stop at the validated local handoff boundary.
