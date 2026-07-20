# Agent Guide

This repository is a direct package of 51Code-owned skills. Each top-level
skill directory contains a `SKILL.md`; the front matter is the source of truth
for its name and description.

- Edit skill source here, never in installed consumer copies.
- Keep `bootstrap.sh` pinned to `skills@1.5.14`, explicit skill names, and
  explicit Git refs using `#ref` syntax.
- Do not add a registry, generated catalog, lock generator, sync planner, or
  backward-compatibility layer.
- When a skill is added or removed, update the owned list in `bootstrap.sh`
  and `README.md` in the same change.
- Keep public changes generic. Do not commit credentials, machine paths,
  internal task links, private context, or company-only notes.
