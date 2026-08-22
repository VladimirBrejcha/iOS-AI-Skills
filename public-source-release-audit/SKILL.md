---
name: public-source-release-audit
description: Check a Git repository's current candidate for high-confidence credential, private-key, and machine-home leaks, then perform a bounded public-release review. Use before publishing source or opening a public PR; do not use it to claim complete history or workflow-execution safety.
---

# Public-Source Release Audit

Use this skill to answer a narrow question honestly: does the current source
candidate contain a supported high-confidence leak, and have the separate
human and GitHub-native release checks been confirmed?

## Automated Current-Source Check

Run the repository's own verifier when it exists. Then run:

```bash
ruby <skill-directory>/scripts/check_current_source.rb <repository>
```

The checker reads exact Git-index blobs so an unstaged replacement cannot hide
the candidate. It also scans tracked and non-ignored untracked worktree files
for early feedback. It reports only paths and finding categories, never the
matched content.

The supported categories are deliberately small:

- private-key headers;
- GitHub, AWS, and OpenAI credential formats;
- explicit bearer credentials; and
- absolute macOS, Linux, and Windows user-home paths.

Stage all intended release changes before relying on the candidate result.
Ignored files and submodule contents are outside this check. The checker does
not inspect Git history. Git LFS pointers fail the check because their external
objects require separate review. Missing index blobs, including unavailable
partial-clone objects, fail without network fetching. A symlink's own target
text is scanned, while a symlinked parent component fails without reading
outside the repository.

## Semantic Review

Automation cannot decide whether prose, filenames, images, or other assets
contain customer information, internal links, personal data, or company-only
context. Inspect the complete tree before first publication and the exact diff
for later releases. Mark this check unconfirmed unless a reviewer actually
performed it.

## GitHub-Native Controls

For an existing public GitHub repository, use read-only GitHub commands to
confirm the live state rather than recreating GitHub policy logic locally:

```bash
gh repo view OWNER/REPO --json visibility,defaultBranchRef
gh api repos/OWNER/REPO --jq '{visibility,security_and_analysis}'
gh ruleset check --default --repo OWNER/REPO
gh ruleset list --repo OWNER/REPO --parents --limit 100
gh ruleset view RULESET-ID --repo OWNER/REPO
gh api repos/OWNER/REPO/branches/DEFAULT-BRANCH/protection
gh api 'repos/OWNER/REPO/actions/runners?per_page=100' \
  --jq '{total_count,runners:[.runners[] | {name,status,busy}]}'
```

Inspect applicable rulesets and classic branch protection when necessary to
confirm the required hosted check, update strictness, and bypass actors. A 404
from the classic endpoint means no classic rule is configured; it does not
invalidate an applicable ruleset. If authorization cannot expose a setting,
report it as unconfirmed. Do not weaken or mutate settings unless the user
separately authorizes that action.

## Result

Report these fields separately:

- repository verifier: `passed`, `failed`, or `not available`;
- automated current-source check: `passed` or `failed`;
- semantic context review: `confirmed` or `unconfirmed`;
- GitHub-native controls: `confirmed`, `unconfirmed`, or `not applicable`;
- history review: normally `not performed`;
- bounded verdict: `ready` only when every check required for this release is
  passed or confirmed.

Do not summarize the bounded verdict as “the repository is safe.” Full-history
investigation is a separate, exceptional workflow using established tooling.
Publishing, rewriting history, revoking credentials, and changing repository
settings remain separate actions requiring their own authorization.
