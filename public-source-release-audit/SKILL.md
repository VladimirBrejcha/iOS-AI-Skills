---
name: public-source-release-audit
description: Audit a repository before public publication when committed files, Git history, workflow runner trust, credentials, private machine paths, or GitHub protection settings could leak or weaken the public source boundary. Use for public-repository launches, release readiness, repository visibility changes, or investigation of a suspected public-source leak; do not use it as a substitute for product security review.
---

# Public Source Release Audit

Use the bundled gate as the deterministic oracle, then apply judgment only to
the residual public meaning that a scanner cannot decide.

## Run The Gate

From the repository being audited, resolve this skill's installed directory
and run:

```bash
node <skill-directory>/scripts/public-source-release-audit.mjs --repo .
```

This scans `HEAD` and the Git index, not dirty working-tree replacements. Stage
the intended publication candidate before relying on the result.

Before a public launch or after a suspected leak, use a complete, non-shallow
clone with all public refs and Git LFS objects present, then add `--history`.
History mode fails closed for shallow or grafted repositories.

For live GitHub controls, add the canonical repository and every required check:

```bash
node <skill-directory>/scripts/public-source-release-audit.mjs \
  --repo . --github OWNER/REPO --required-check CHECK_NAME
```

The GitHub mode requires evidence for public visibility, secret scanning, push
protection, strict default-branch status checks bound to GitHub Actions,
deletion and force-push protection, zero ruleset bypass actors, and no
self-hosted runner available to the public repository. Inability to read
required evidence is a failure, not a clean result.

## Interpret Results

- Any error finding blocks publication. Do not bypass it by scanning a dirty
  replacement, dropping history, or weakening a rule.
- The gate never prints matched credential or path values. Preserve that
  redaction in reports, issues, logs, and review comments.
- Workflow advisories identify mutable action refs, `pull_request_target`, or
  dynamic runner selection that needs threat-model review. Use
  `--fail-on-warning` when the repository has adopted those stricter policies.
- A historical credential requires credential revocation and a decision about
  history remediation. Removing it only from the current tree is not closure.
- Fetch and verify missing Git LFS objects; do not allowlist an unaudited
  pointer.

## Finish The Human Audit

The gate detects high-confidence credentials, private-key blocks, non-generic
machine homes, sensitive filenames and symlink targets, encoding variants,
and mechanical repository controls. It cannot decide whether ordinary prose,
screenshots, customer facts, private repository links, internal task names, or
business context are approved for publication. Review the staged diff, commit
messages, workflows, generated artifacts, and public-facing metadata for those
semantic leaks before declaring the source safe.

Report the exact command, audited ref, whether history and live GitHub evidence
were included, error/advisory rule IDs, remediation, and remaining uncertainty.
Do not change GitHub settings, rewrite history, revoke credentials, push, or
publish without the authorization required for that separate action.
