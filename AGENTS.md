# Agent Guide

This repository is a direct package of 51Code-owned skills. Each top-level
skill directory contains a `SKILL.md`; the front matter is the source of truth
for its name and description.

- Edit skill source here, never in installed consumer copies.
- Keep `bootstrap.sh` pinned to `skills@1.5.14` and explicit skill names. Use
  `#ref` for reviewed tags; when upstream has no stable tag and the manager
  cannot resolve a raw commit, fetch and verify that exact commit before
  passing its local checkout to the manager.
- Do not add a registry, generated catalog, lock generator, sync planner, or
  backward-compatibility layer.
- Keep `WORKFLOW.md` and `scripts/verify.sh` as the small, non-mutating
  Autopilot and Symphony integration boundary.
- When a skill is added or removed, update the owned list in `bootstrap.sh`
  and `README.md` in the same change.
- Keep public changes generic. Do not commit credentials, machine paths,
  internal task links, private context, or company-only notes.
