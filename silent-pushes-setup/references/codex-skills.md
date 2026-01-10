# Codex skills references

Official references for the Agent Skills format and locations:

- Agent Skills overview
  - https://developers.openai.com/codex/skills
  - Skills are folders with `SKILL.md` plus optional `scripts/`, `references/`, and `assets/`.
  - Codex loads repo‑scoped skills from `.codex/skills` and user‑scoped skills from `~/.codex/skills`.

- Custom skills / create skill
  - https://developers.openai.com/codex/skills/create-skill/
  - `SKILL.md` requires YAML frontmatter with `name` and `description` on single lines.
  - Keep skills focused and use narrow triggers.
