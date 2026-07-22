# Harness Engineering Principles

## Table of contents

1. Human role shift
2. Repository as system of record
3. Agent legibility checklist
4. Constraints and guardrails
5. Verifier integrity
6. Merge and autonomy patterns
7. Entropy management loop
8. Anti-patterns and fixes

## 1. Human role shift

- Move humans up-stack: set architecture, constraints, and review bars.
- Push agents down-stack: implement, refactor, test, and maintain.
- Avoid spending human time on deterministic boilerplate that agents can do.

## 2. Repository as system of record

- Store decisions in versioned files, not chat logs.
- Prefer discoverable conventions:
  - `AGENTS.md` for operational rules.
  - `README.md` for onboarding and canonical commands.
  - Checked-in templates for issues, PRs, and specs.
- Remove duplicate documents that disagree on process.

## 3. Agent legibility checklist

- Use one canonical way to run tests and linters.
- Keep naming consistent across modules and folders.
- Keep dependency direction explicit and documented.
- Keep "where to edit" obvious from file structure.
- Keep task instructions concrete and file-scoped.

## 4. Constraints and guardrails

- Encode quality bars mechanically whenever possible.
- Add fast local checks:
  - Formatting.
  - Type checks.
  - Focused test suites.
- Add merge-time checks:
  - Full tests.
  - Security and policy scanning.
  - Required code-owner reviews for sensitive paths.
- Prefer deterministic scripts over free-form command sequences.

## 5. Verifier integrity

A verifier is not trustworthy just because it exits successfully. Review its truth model:

- Oracle truth: the assertion proves the intended behavior and includes meaningful negative or boundary cases.
- Coverage truth: the command actually runs the files, generated artifacts, profiles, rows, or paths it claims to cover.
- Artifact truth: summaries and persisted QA output cannot report success after completeness or source evidence fails.
- Failure-signal truth: broken contracts fail loudly with actionable diagnostics instead of being skipped, normalized away, or hidden in logs.
- Binding truth: every verifier is tied to the requirement or contract it proves, and every required contract has a named verifier.

For generated pipelines, require source/runtime inventory alignment, output validation after generation, redaction before persistence, idempotent retries, and fail-closed handling when generated storage cannot build.

## 6. Merge and autonomy patterns

- Split work into small, reviewable increments.
- Run independent tracks for unrelated files.
- Merge frequently to avoid long divergence windows.
- Grant high autonomy where guardrails are strong.
- Reduce autonomy where risk is high or constraints are incomplete.

## 7. Entropy management loop

- Run recurring cleanup tasks:
  - Remove dead files and stale configs.
  - Fix flaky tests and non-actionable alerts.
  - Prune obsolete docs and prompts.
- Convert repeated failures into explicit rules or checks.
- Keep maintenance ownership explicit by directory or subsystem.

## 8. Anti-patterns and fixes

| Anti-pattern | Symptom | Correction |
| --- | --- | --- |
| Prompt-only process | Different outcomes for same task | Move rules into repo files and scripts |
| Too many patterns | Agents pick inconsistent approaches | Publish one default per task type |
| Manual quality gates | Reviews become bottlenecks | Automate checks in local and CI flows |
| Large branch batches | Frequent merge conflicts | Break work into smaller merges |
| No cleanup cycle | Docs and scripts drift quickly | Schedule recurring maintenance sweeps |
| False-pass verifier | QA artifact says pass while required evidence is missing | Add oracle, coverage, artifact, failure-signal, and binding checks |
