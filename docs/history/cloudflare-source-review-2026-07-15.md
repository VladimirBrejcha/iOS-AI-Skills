# Cloudflare Commit-Pin Source Review

Reviewed on 2026-07-15 as the first real no-tag source admitted after exact
commit-pin support merged.

## Decision

Register the broad `cloudflare` skill as an active `external-git` source with
no checked-in mirror and no profile expansion in this change.

- Source owner: [cloudflare/skills](https://github.com/cloudflare/skills)
- Source path: `skills/cloudflare`
- Immutable pin: `70215303d44a81a0db3219428f4825b604fc6061`
- Update-discovery ref: `refs/heads/main`
- License: Apache-2.0
- Release tags observed: none

The repository belongs to the official Cloudflare organization and describes
these packages as skills for building on Cloudflare. The umbrella package
covers Workers, Pages, D1, Queues, Wrangler, storage, AI, networking, security,
and infrastructure as code. It restores the useful coverage represented by
the stale Cloudflare mirrors removed during catalog review without recreating
several overlapping local skills.

## Pin And Content Proof

GitHub repository metadata and `git ls-remote` both resolved `main` to the
reviewed commit. The repository exposed no tags at review time. The full
`pinned_commit` is therefore the source and lock identity; `refs/heads/main` is
only the comparison target for future update review.

At that commit, `skills/cloudflare` contains 320 files. Every tree entry is a
regular `100644` Markdown file. There are no scripts, executable modes,
symlinks, or binary files. The `SKILL.md` front matter exports `cloudflare` and
the catalog description recorded in `skills.registry.yaml`. A focused scan
found no private machine paths, private keys, access-token patterns, or bearer
tokens.

The skill explicitly directs agents to retrieve current Cloudflare
documentation before relying on limits, prices, API signatures, or static
reference material. This is preferable to reviving old local product-specific
copies.

## Manager Proof And Boundary

The pinned manager recognizes the source repository, commit, and skill path,
but its direct GitHub clone path passes the raw commit to `git clone --branch`.
The immutable remote command therefore fails with `Remote branch ... not
found` under `skills@1.5.14`; using `main` instead would violate the registry
contract.

```bash
HOME="$PROOF_HOME" XDG_CONFIG_HOME="$PROOF_HOME/.config" \
  npx --yes skills@1.5.14 add \
  'cloudflare/skills#70215303d44a81a0db3219428f4825b604fc6061' \
  --skill cloudflare \
  --agent codex opencode claude-code \
  --global \
  --yes \
  --copy
```

Compatibility was proven without touching real consumer roots by checking out
the exact commit and using an isolated home:

```bash
git -C "$SOURCE_CHECKOUT" checkout --detach \
  70215303d44a81a0db3219428f4825b604fc6061

HOME="$PROOF_HOME" XDG_CONFIG_HOME="$PROOF_HOME/.config" \
  npx --yes skills@1.5.14 add \
  "$SOURCE_CHECKOUT/skills/cloudflare" \
  --skill cloudflare \
  --agent codex opencode claude-code \
  --global \
  --yes \
  --copy
```

The manager found one skill and wrote the shared Codex/OpenCode copy plus the
Claude Code copy. Both installed folders matched the exact source checkout
with `diff -qr`.

This proves package discovery and adapter compatibility, not a supported
repeatable remote install. All clients remain `planned`; no profile or machine
adapter changes in this source-review slice. Sync must keep the entry in
manual review until the manager can install the immutable remote commit, or a
separately reviewed manager capability provides equivalent exact-source proof.

## Repository Proof

- Upstream doctor resolution reports `refs/heads/main` at pinned commit
  `70215303d44a` and confirms that the generated lock matches.
- The upstream update report covers 30 external skills: 30 current, zero
  updates required, and zero check failures. The `cloudflare` entry reports
  pin mode `commit` and lock state `ok`.
- The generated lock contains `pinned_commit` plus `tracking_ref` and no tag
  fields for `cloudflare`.
- The generated catalog contains 43 active skills and exposes the commit pin
  without install metadata because every client remains planned.
- A dedicated two-root sync plan reports two blocked `manual-review` actions,
  the exact commit/ref lock label, and `changed_filesystem: false`. It emits no
  mutable-branch manager command.
- All 20 commands in `.agents/verify/skills-registry.yaml` passed, including
  provenance, public-safety, YAML, front matter, generated-artifact, doctor,
  sync, upstream-update, and full regression checks.
- The read-only live manager check also completed without a Cloudflare write;
  existing unrelated adapter and lock warnings remain outside this source
  review.
