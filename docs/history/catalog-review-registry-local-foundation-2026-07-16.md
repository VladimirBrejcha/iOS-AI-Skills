# Registry-local foundation review: mechanism audit and Xcode tooling

Review date and source retrieval date: 2026-07-16

Repository baseline: [`95ba6ab45920d1b7269ef4d49e30f9df0583601d`](https://github.com/fiveonecode/agent-skills/commit/95ba6ab45920d1b7269ef4d49e30f9df0583601d)

This is a research record, not an integration change. It reviews the current
`mechanism-audit`, `ios-xcodegen`, and `xcode-cloud` folders against repository
history, current primary sources, manager behavior, and the checked-in registry
contract. No recommendation below changes a skill, registry entry, lock,
profile, generated catalog, or consumer root.

## Decisions

| Skill | Disposition | Decision | Required before the decision is integrated |
| --- | --- | --- | --- |
| `mechanism-audit` | **retain** | The bounded enforcement-chain audit is necessary and distinct from general harness design or code review. The canonical source and one downstream runtime have diverged, so current rollout must remain planned. | Reconcile the structured result contract, add path-scoped audit selection and tests, refresh the lock and generated catalog, reconcile the downstream copy in its owning repository, then prove manager rollout in isolation. |
| `ios-xcodegen` | **retain** | A narrow XcodeGen source-of-truth and troubleshooting skill remains useful for repositories that already use XcodeGen. It must not be treated as general iOS build guidance. | Correct the asset-symbol, raw archive, static framework, and destination claims; add current XcodeGen and Apple references plus fixture coverage; refresh the lock/catalog and materialized copies. |
| `xcode-cloud` | **replace** | Xcode Cloud guidance is necessary, but the current template-first implementation conflicts with Apple's current project-presence requirement and contains unsafe external-mutation defaults. Replace the content in place while retaining the skill ID and its Xcode Cloud boundary. | Rewrite against current Apple lifecycle rules, remove or redesign the tag-push template, pin tool acquisition, add fail-closed fixture tests and shell checks, then refresh registry-derived state and re-materialize only after review. |

## Shared registry and manager facts

### Confirmed facts

- All three folders are registry-local and covered by the repository's
  [MIT license](https://github.com/fiveonecode/agent-skills/blob/95ba6ab45920d1b7269ef4d49e30f9df0583601d/LICENSE).
  No external skill source or copied third-party implementation was found for
  these folders. References to Apple documentation and XcodeGen do not make
  those sources the owner of the skill text.
- [`skills.registry.yaml`](https://github.com/fiveonecode/agent-skills/blob/95ba6ab45920d1b7269ef4d49e30f9df0583601d/skills.registry.yaml)
  is the disposition and source owner. The
  [lock](https://github.com/fiveonecode/agent-skills/blob/95ba6ab45920d1b7269ef4d49e30f9df0583601d/skills.lock.yaml)
  records the current registry-local tree digest rather than an upstream
  version. The checked-in
  [example profile](https://github.com/fiveonecode/agent-skills/blob/95ba6ab45920d1b7269ef4d49e30f9df0583601d/profiles/machine/example-local-skills.yaml)
  selects both Xcode skills but not `mechanism-audit`:

  | Skill | Registry clients | Profile state | Lock digest |
  | --- | --- | --- | --- |
  | `mechanism-audit` | Codex, OpenCode, Claude: planned | not selected | `bdf2a2c41e20f46500724712df95da4cfa80d550a32b00d850d91e2bca5dc919` |
  | `ios-xcodegen` | Codex, OpenCode, Claude: supported | selected for shared and Claude manager copies | `8cb369d77201d30bdd79cba8cdb8886675a6cfc3962d34469203d76f590fdec9` |
  | `xcode-cloud` | Codex, OpenCode, Claude: supported | selected for shared and Claude manager copies | `9ca461291d4d748ee6fc9c3f99fc89a4e51cd923e03051530337141321dbb431` |

- The package manager pin remains
  [`skills@1.5.14`](https://www.npmjs.com/package/skills/v/1.5.14). Network
  package resolution did not complete in the restricted review environment, so
  the proof invoked `bin/cli.mjs` from the exact cached 1.5.14 package and
  supplied its declared `yaml` dependency from the installed package tree.
  `node "$SKILLS_CLI" --version` printed exactly `1.5.14`.
- Each skill/client pair used a new `mktemp -d` home and was deleted after the
  check. The exact proof shape was:

  ```sh
  SKILLS_CLI=<extracted-skills-1.5.14>/bin/cli.mjs
  REPO=<repo-checkout>
  isolated_home="$(mktemp -d)"
  HOME="$isolated_home" node "$SKILLS_CLI" add "$REPO" \
    --skill <skill> --agent <agent> --global --yes
  HOME="$isolated_home" node "$SKILLS_CLI" ls --global --json
  diff -qr --exclude metadata.json "$REPO/<skill>" "<materialized-target>"
  rm -rf "$isolated_home"
  ```

  The observed result matrix was:

  | Skill | Agent | Materialized target under isolated `HOME` | `add` | Byte comparison | `ls --global --json` `agents` field |
  | --- | --- | --- | --- | --- | --- |
  | `ios-xcodegen` | `codex` | `.agents/skills/ios-xcodegen` | exit 0 | no differences | `[]` |
  | `ios-xcodegen` | `opencode` | `.agents/skills/ios-xcodegen` | exit 0 | no differences | `[]` |
  | `ios-xcodegen` | `claude-code` | `.claude/skills/ios-xcodegen` | exit 0 | no differences | `["Claude Code"]` |
  | `xcode-cloud` | `codex` | `.agents/skills/xcode-cloud` | exit 0 | no differences | `[]` |
  | `xcode-cloud` | `opencode` | `.agents/skills/xcode-cloud` | exit 0 | no differences | `[]` |
  | `xcode-cloud` | `claude-code` | `.claude/skills/xcode-cloud` | exit 0 | no differences | `["Claude Code"]` |

  `metadata.json` was excluded because it is manager-owned. Empty command
  output from `diff -qr` plus exit 0 established source-byte equivalence.
  Codex and OpenCode therefore have file-materialization proof in the shared
  root, but not manager-label or end-to-end runtime-discovery proof. Claude Code
  has both materialization and manager-label proof in this isolated check.
- No real consumer root was written or repaired. The existing historical
  `xcode-cloud` manager proof is stale relative to the current lock, so this
  isolated result is packaging evidence only; it does not authorize rollout.
- `mechanism-audit` did not need materialization proof in this lane because all
  clients remain planned and it is absent from the checked-in example profile.

### Native agent behavior and inference

The current [Codex skill documentation](https://developers.openai.com/codex/skills),
[Claude Code skill documentation](https://code.claude.com/docs/en/skills), and
[OpenCode skill documentation](https://opencode.ai/docs/skills/) all describe
skills as discoverable instruction packages. Claude also documents hooks for
deterministic enforcement. OpenCode documents loading from the shared
`.agents/skills` root.

Inference: native skill loading can distribute these workflows, but it cannot
make a mutable Apple/Xcode assertion correct or turn advisory text into a
repository gate. Deterministic guarantees still require manifests, tests,
verifier commands, and controller-side artifact checks.

## `mechanism-audit`

### Source, license, and version

Confirmed facts:

- The folder first appeared in repository commit
  [`79a7bfee2b41209c797438a1233d3625c78b3e04`](https://github.com/fiveonecode/agent-skills/commit/79a7bfee2b41209c797438a1233d3625c78b3e04)
  on 2026-04-30. Its content is unchanged at the reviewed baseline. This is the
  earliest defensible source and the current canonical source.
- The current immutable source is
  [`mechanism-audit/SKILL.md` at the baseline commit](https://github.com/fiveonecode/agent-skills/blob/95ba6ab45920d1b7269ef4d49e30f9df0583601d/mechanism-audit/SKILL.md).
  There is no upstream tag to compare. The registry-local lock digest matches
  the folder.
- The top-level MIT license covers the folder. No additional attribution is
  required by the evidence found.

### Necessity, alternatives, and overlap

Confirmed facts:

- The skill turns one promised guarantee into an enforcement-chain audit with
  fixed verdicts and P0/P1 fixes. Its output is narrower than
  `harness-engineering`, which designs and improves agent harnesses;
  `spec-creation-updating`, which makes specifications implementation-ready;
  and `code-review`, which reviews a change for defects and merge risk.
- A public downstream controller imported the canonical skill in
  [`fiveonecode/autopilot` commit `2689e344`](https://github.com/fiveonecode/autopilot/commit/2689e34478c1475d3221885a36e9c31e5d1c847a),
  then added a JSON sidecar in
  [commit `6ef4b629`](https://github.com/fiveonecode/autopilot/commit/6ef4b629e7ed86f7ac147300fe2640dc28c34682)
  and hardened P0 routing in
  [commit `d09bc613`](https://github.com/fiveonecode/autopilot/commit/d09bc613cd486be6e75609339d2d09b056aa3f3e).
  Its current [runtime contract](https://github.com/fiveonecode/autopilot/blob/ce3bbab119358267319aff8173603ec818a5155a/spec/agents.md)
  and [tests](https://github.com/fiveonecode/autopilot/blob/ce3bbab119358267319aff8173603ec818a5155a/agent-harness/tests/mechanism-audit.test.ts)
  consume `verdict`, `p0Fixes`, and `needsHumanDecision` from adjacent JSON.
  The canonical skill still documents only `mechanism-audit.md`.

Inference: merging this workflow into a broader skill would make runtime
selection and artifact routing less precise. Retaining it is justified, but a
downstream product copy must not silently become a second source owner.

### Content and runtime safety

| Area | Finding |
| --- | --- |
| Commands and dependencies | None. The workflow is an instruction-only checklist. |
| Files and side effects | It conditionally writes `<session-dir>/mechanism-audit.md` when the harness requires it. It does not otherwise request a durable write. |
| Network and credentials | None. |
| Destructive behavior | None. |
| Mutable assumptions | Its Markdown-only artifact contract is already stale relative to the public controller that consumes it. |

### Mechanism audit of the current catalog promise

Promise:

- Registry and harness contract changes receive mechanically selected
  verification and required audit evidence, while reusable skills retain one
  canonical source.

Enforcement chain:

- `.agents/manifests/registry.yaml` selects the `harness-engineering` skill and
  the `skills-registry` verification profile for registry-owned paths.
- `skills.registry.yaml` owns disposition and source; `skills.lock.yaml` owns
  resolved digests; generated catalog checks catch most registry/lock drift.
- `./scripts/verify.sh` runs the checked-in 21-command profile, including tests,
  digest checks, catalog checks, provenance audit, sync planning, and public
  safety scanning.

Bypass paths:

- The registry manifest declares no `mechanism_audits` rule, so contract and
  verifier changes do not mechanically require the controller's audit artifact.
- The canonical skill omits the JSON sidecar required by the current downstream
  completion gate.
- `provenance.sources.yaml`, `skills.catalog.json`, `THIRD_PARTY_NOTICES.md`,
  and `LICENSE` are not matched by a checked-in manifest.
- The canonical shell-syntax command omits `xcode-cloud/assets/*.sh`.
- Standalone verification uses the whole checkout as its path set, so it does
  not prove a task-specific one-file ownership boundary.
- The verification profile declares no scenario or boundary identifiers.

Verification coverage:

- The current verifier catches registry, lock, profile, generated catalog,
  provenance, and many public-safety failures. It does not catch all of the
  bypasses above. All three Xcode Cloud assets pass a direct `sh -n` check, but
  that check is not in the canonical profile.

Verdict:

- `partially holds`

Fixes:

- P0: Add the conditional JSON-sidecar contract to the canonical skill; add
  path-scoped `mechanism_audits` selection and controller regression tests;
  cover unmatched governance files; reconcile the downstream copy through its
  owning repository.
- P1: Add scenario and boundary identifiers, add the Xcode Cloud assets to
  syntax verification, and add an explicit exact-changed-file assertion where
  the runner does not already enforce it.

### Integration changes for `retain`

1. Update the canonical output contract to describe both Markdown and the
   conditional adjacent JSON result consumed by an enforcing harness.
2. Add path-scoped manifest triggers and fixture tests for mechanism-audit
   selection, verdict validation, P0 routing, and missing/stale artifacts.
3. Expand manifest and verification coverage as listed in the audit.
4. Refresh the registry-local lock digest and generated catalog artifacts.
5. Reconcile the downstream copy in a separate authorized change; do not edit
   its imported consumer folder from this repository.
6. Keep clients planned until isolated manager writes, digest verification,
   runtime discovery, and rollback behavior are proven.

## `ios-xcodegen`

### Source, license, and version

Confirmed facts:

- The folder first appeared in repository commit
  [`d3af1725bac22fe5710d992ba90795f5ef59c729`](https://github.com/fiveonecode/agent-skills/commit/d3af1725bac22fe5710d992ba90795f5ef59c729)
  on 2026-01-17 and is unchanged at the reviewed baseline. This is the earliest
  defensible and current skill source.
- The current immutable source is
  [`ios-xcodegen/SKILL.md` at the baseline commit](https://github.com/fiveonecode/agent-skills/blob/95ba6ab45920d1b7269ef4d49e30f9df0583601d/ios-xcodegen/SKILL.md).
  The registry-local lock digest matches it; there is no upstream skill tag.
- The folder is MIT under the repository license. It references, but does not
  copy, [XcodeGen](https://github.com/yonaskolb/XcodeGen), which is also
  [MIT-licensed](https://github.com/yonaskolb/XcodeGen/blob/2.45.4/LICENSE).
- The current XcodeGen release retrieved on 2026-07-16 is
  [tag `2.45.4`](https://github.com/yonaskolb/XcodeGen/releases/tag/2.45.4),
  commit
  [`8d3d3476a69ae3e5d68e1adccc701c410c05eb36`](https://github.com/yonaskolb/XcodeGen/commit/8d3d3476a69ae3e5d68e1adccc701c410c05eb36).
  The skill has no XcodeGen version or installation contract, and does not tell
  a project to use XcodeGen's documented `minimumXcodeGenVersion` guard.

### Necessity, alternatives, and overlap

Confirmed facts:

- XcodeGen's current project specification is YAML or JSON and its normal
  command is `xcodegen generate`, matching the skill's source-of-truth boundary.
  See the [2.45.4 project specification](https://github.com/yonaskolb/XcodeGen/blob/2.45.4/Docs/ProjectSpec.md).
- Xcode's native project editor is the official baseline. XcodeGen is a
  maintained generator for repositories that intentionally own a spec instead
  of a checked-in project. [Tuist](https://github.com/tuist/tuist) is a
  maintained, broader project-generation and automation alternative, but is
  not a drop-in interpreter for an XcodeGen spec.
- The retained boundary is: `ios-xcodegen` owns XcodeGen spec generation and
  XcodeGen-specific diagnosis; `xcode-build` owns local `xcodebuild`, simulator,
  launch, and test operations; `xcode-cloud` owns Xcode Cloud lifecycle and
  CI-specific policy.

Inference: the skill is necessary only when a repository already chooses
XcodeGen or is explicitly evaluating it. Native agents and Xcode itself do not
need this extra layer for ordinary project builds.

### Current-source fact check

Confirmed facts:

- The 2.45.4 XcodeGen spec documents dependency types including `target`,
  `framework`, `carthage`, `sdk`, `package`, and `bundle`; it does not document
  a `library:` key. It documents `framework:` for a framework or XCFramework,
  not as a raw `.a` recipe. The skill specifically instructs
  `framework: path/to/libSomething.a`.
- Apple's current [build settings reference](https://developer.apple.com/documentation/xcode/build-settings-reference)
  documents `ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS` and
  `ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS`. The skill's
  `ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOLS` name is not the current
  documented setting. Apple's [Xcode 15 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-15-release-notes)
  describe generated `ColorResource` and `ImageResource` types; the skill's
  `ColorAsset` and `ImageAsset` examples are not the current documented names.
- Apple documents raw static archives as linked code. An embedded raw `.a`
  should not be copied into an app's `Frameworks` directory. See Apple's
  [multiplatform binary framework guidance](https://developer.apple.com/documentation/xcode/creating-a-multi-platform-binary-framework-bundle)
  and archived [TN2435](https://developer.apple.com/library/archive/technotes/tn2435/_index.html).
- In Xcode 15 and later, Apple's
  [static framework guidance](https://developer.apple.com/documentation/xcode/creating-a-static-framework)
  permits a resource-bearing static framework to be embedded; Xcode omits its
  already-linked static archive while retaining bundle resources. The skill
  says XCFrameworks containing static libraries should be linked only with
  `embed: false`.
- Apple confirms `My Mac (Designed for iPad)` as a destination for eligible
  iPad apps on Apple silicon. The reviewed Apple sources do not specify the
  exact command-line selector stated by the skill. See
  [Apple silicon guidance](https://developer.apple.com/documentation/apple-silicon/providing-an-edge-to-edge-full-screen-experience-in-your-ipad-app-running-on-a-mac).
- Apple's [dependency guidance](https://developer.apple.com/documentation/xcode/making-dependencies-available-to-xcode-cloud)
  documents current Swift package resolution requirements. It does not make
  the skill's stated `Package.resolved` path universal across every generated
  project and workspace layout.

Inferences from those facts:

- The raw `.a` recipe is not established by the current XcodeGen source and
  needs either a 2.45.4 fixture or removal.
- The blanket `embed: false` advice is too broad for current resource-bearing
  static framework bundles.
- The exact Designed-for-iPad selector should be discovered with
  `xcodebuild -showdestinations` for the active Xcode, project, and scheme.
- CI guidance should verify the generated project/workspace layout instead of
  promising one `Package.resolved` path.

### Content and runtime safety

| Area | Finding |
| --- | --- |
| Commands and dependencies | `xcodegen generate`, Derived Data cleanup, archive inspection, and implicitly Xcode/XcodeGen. No installation or version check is specified. |
| Files and side effects | Generates or replaces `.xcodeproj`; advises deleting generated projects and cleaning Derived Data; inspects archive contents. These are local writes and scoped deletion of generated state. |
| Network and credentials | The skill itself requests neither, but installation and Swift package resolution may require network access. No credential handling is specified. |
| Destructive behavior | Deleting a generated project or Derived Data is recoverable only if the spec is complete and the cleanup target is correctly scoped. The workflow needs explicit confirmation and path checks. |
| Mutable assumptions | XcodeGen schema, Xcode build settings, Apple packaging rules, Package.resolved layout, and destination strings can change with toolchain versions. Several current claims are already stale or unverified. |

### Integration changes for `retain`

1. Pin the reviewed XcodeGen source in the references and require the project
   to declare or verify `minimumXcodeGenVersion`; do not silently install latest.
2. Replace the incorrect asset-symbol setting and update generated type names.
3. Remove the unverified raw `.a` dependency recipe unless a 2.45.4 fixture
   proves the generated link and copy phases.
4. Distinguish raw archives, static frameworks with resources, static
   XCFramework variants, and dynamic frameworks. Base embed advice on the
   generated product and current Apple rules, not the word `static` alone.
5. Discover active destinations with `xcodebuild -showdestinations`; do not
   promise one hard-coded Designed-for-iPad selector.
6. Make project deletion and Derived Data cleanup explicitly scoped and
   confirm the spec is complete before deletion.
7. Add small fixtures for resources, tests/host app, SwiftPM state, raw archive
   linking, and framework embedding. Link every mutable assertion to the
   reviewed XcodeGen tag or current Apple page.
8. Refresh the lock digest and generated catalogs, then re-run isolated manager
   and runtime proof before updating supported materialized copies.

## `xcode-cloud`

### Source, license, and version

Confirmed facts:

- The folder first appeared in the repository's initial commit
  [`46cd104dc53b4850af74362cb5c036c327a73bcf`](https://github.com/fiveonecode/agent-skills/commit/46cd104dc53b4850af74362cb5c036c327a73bcf)
  on 2026-01-11. Material changes followed in
  [`af6bc5880f77a3bbbdf6bcc99ca399fb1ec5e92a`](https://github.com/fiveonecode/agent-skills/commit/af6bc5880f77a3bbbdf6bcc99ca399fb1ec5e92a)
  and
  [`8259014b1d526b3f0df504043b631d508150ac43`](https://github.com/fiveonecode/agent-skills/commit/8259014b1d526b3f0df504043b631d508150ac43).
  Repository history is the earliest defensible source; no external skill
  upstream was found.
- The current immutable source is
  [`xcode-cloud` at the baseline commit](https://github.com/fiveonecode/agent-skills/tree/95ba6ab45920d1b7269ef4d49e30f9df0583601d/xcode-cloud).
  The registry-local lock digest matches the source. There is no upstream skill
  tag or commit to pin.
- The skill and its three shell templates are MIT under the repository license.
  Apple documentation is paraphrased and linked, not copied as source code.

### Necessity, alternatives, and overlap

Confirmed facts:

- [Xcode Cloud](https://developer.apple.com/documentation/xcode/xcode-cloud)
  is Apple's native CI/CD service for building, testing, and distributing Apple
  platform software. Its official documentation is the primary authority for
  lifecycle, environment, project, and workflow behavior.

Inferences from that fact and the repository overlap review:

- A small skill remains useful for mapping Apple rules to a repository's owned
  scripts and validation. Apple documentation alone is the safer alternative
  when no project-specific policy is needed. XcodeGen is an optional external
  project generator, not a prerequisite for Xcode Cloud.
- The Xcode Cloud boundary should end at workflow configuration, lifecycle
  scripts, CI dependency policy, and diagnosis. Local builds belong to
  `xcode-build`; XcodeGen spec semantics belong to `ios-xcodegen`; release tag
  publication should be separate release automation unless it has its own
  credential, idempotency, and authorization contract.
- The skill ID should remain because the Xcode Cloud domain is real, but the
  current content should be replaced rather than incrementally promoted.

### Current Apple fact check

Confirmed facts:

- Apple's [project setup requirements](https://developer.apple.com/documentation/xcode/setting-up-your-project-to-use-xcode-cloud)
  require a consistent Xcode project or workspace that is continuously present.
  Apple warns that a third-party tool that dynamically generates or edits it can
  cause initial configuration and later builds to fail. The skill generally
  recommends generating an ignored project in `ci_post_clone.sh`.
- Apple recognizes `ci_post_clone.sh`, `ci_pre_xcodebuild.sh`, and
  `ci_post_xcodebuild.sh` as the three custom lifecycle names. They are
  top-level executable scripts under `ci_scripts` with a shebang. The post-build
  script runs even when `xcodebuild` fails. See
  [Writing custom build scripts](https://developer.apple.com/documentation/xcode/writing-custom-build-scripts).
- Apple's [environment variable reference](https://developer.apple.com/documentation/xcode/environment-variable-reference)
  says `CI_XCODEBUILD_EXIT_CODE` is available after the corresponding action
  and `0` means success. `CI_XCODEBUILD_ACTION` identifies the action. The
  current tag template defaults a missing exit code to `0` and permits a
  missing action value.
- Apple makes Homebrew available in the temporary build environment and permits
  third-party dependency setup after clone. The current generation templates
  run unpinned `brew install xcodegen`. See
  [Making dependencies available to Xcode Cloud](https://developer.apple.com/documentation/xcode/making-dependencies-available-to-xcode-cloud).

Inferences from those facts:

- General post-clone generation conflicts with Apple's current continuously
  present project/workspace requirement and cannot be a safe catalog default.
- Defaulting a missing exit code to success and permitting a missing action do
  not establish a successful archive; external mutation should fail closed.
- Availability of Homebrew does not make an unpinned install deterministic.

### Content and runtime safety

| Area | Finding |
| --- | --- |
| Commands and dependencies | `chmod`, `brew install xcodegen`, `xcodegen generate`, `git config`, `git ls-remote`, `git tag`, `git push`, `sed`, and `PlistBuddy`. Dependencies include Xcode Cloud, Homebrew, XcodeGen, Git, a GitHub remote, and a correctly located Info.plist. |
| Files and side effects | Generates an Xcode project; mutates repository-local Git identity; creates a local annotated tag; reads the network; pushes a remote tag. |
| Credentials | Requires `GITHUB_TOKEN` for tag publication and constructs an authenticated HTTPS URL containing the token. That can expose the secret in process arguments or error output. GitHub advises against passing tokens as plain-text command-line arguments in its [credential security guidance](https://docs.github.com/en/rest/authentication/keeping-your-api-credentials-secure); Git documents safer [credential helper interfaces](https://git-scm.com/docs/gitcredentials.html). |
| Destructive behavior | It does not delete files or tags. It performs an externally visible, hard-to-reverse publication. A failed push leaves the local tag, and the next run skips whenever that local tag exists, so retry can be permanently suppressed. |
| Authorization and fail-closed behavior | Publication is opt-in, but the branch allowlist is optional. Missing build exit code defaults to success and a missing action passes. Neither proves a successful authorized archive. |
| Determinism | Both generation hooks install the mutable current Homebrew XcodeGen when absent. No version, checksum, or project-level minimum is enforced. |
| Verification | All three assets pass `sh -n` on the review baseline. The canonical verification profile does not syntax-check them and there are no behavior fixtures. |

### Integration changes for `replace`

1. Keep the `xcode-cloud` ID and registry-local ownership, but replace the
   current workflow with an Apple-source-first guide. State the continuously
   present project/workspace requirement before discussing any generator.
2. Remove the blanket post-clone XcodeGen recommendation. Treat generated
   project use as an explicit, separately proven exception with configuration
   and build fixtures for the selected Xcode/XcodeGen versions.
3. Replace bare `brew install xcodegen` with a reviewed version contract and a
   deterministic acquisition method. Verify the installed version before use.
4. Remove the tag-push template from the default skill. If a reviewed release
   workflow still needs it, move it behind a separate authorization contract
   and require: a known successful archive action, a mandatory branch/ref
   allowlist, least-privilege credentials supplied without a URL argument,
   remote-first idempotency, and safe recovery from a failed push or local-only
   tag.
5. Add shell syntax checks and isolated fixtures for missing CI variables,
   failed builds, non-archive actions, unauthorized refs, existing remote/local
   tags, push failure, redacted logs, and pinned XcodeGen generation.
6. Update mutable Apple and XcodeGen references with retrieval dates. Keep
   confirmed facts separate from project-specific inference.
7. Refresh the lock digest and generated catalogs. Mark current materialized
   copies for reviewed replacement, then prove exact-byte manager writes,
   client discovery, doctor status, and rollback in isolated homes before any
   real consumer update.

## Integration boundary

This record authorizes no implementation. A later serialized integration must
choose the accepted subset, change source owners rather than imported consumer
copies, regenerate catalog artifacts instead of hand-editing them, run the full
registry verifier, and separately authorize any consumer write. Source or
runtime behavior that cannot be proven by the cited current documentation must
remain a fixture-backed project-specific claim rather than a catalog promise.
