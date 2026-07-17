---
name: xcode-cloud
description: Configure or troubleshoot Xcode Cloud workflows and lifecycle scripts using Apple's project-presence, dependency, environment, and fail-closed CI contracts. Use for Xcode Cloud setup, custom ci_scripts, build/test/archive diagnosis, or a separately reviewed XcodeGen regeneration exception.
---

# Xcode Cloud

## Overview

Use Apple documentation as the authority for Xcode Cloud lifecycle behavior.
Keep this skill focused on workflow configuration, custom scripts, dependency
policy, and CI diagnosis. Use `xcode-build` for local build and simulator work,
and `ios-xcodegen` for XcodeGen project-spec semantics.

## Quick Start

1. Identify the `.xcodeproj` or `.xcworkspace` selected by the workflow.
2. Confirm that project or workspace is continuously present in the repository
   before configuring Xcode Cloud. A generated and ignored project is not a
   safe default.
3. Confirm shared schemes, actions, Xcode version, dependency state, and the
   repository path used by the workflow.
4. Add only the custom lifecycle scripts the workflow needs. Place executable
   scripts in a top-level `ci_scripts` directory beside the selected project or
   workspace.
5. Make every script fail closed on missing inputs and verify the workflow in a
   disposable branch before rollout.

## Apple Lifecycle Contract

Apple recognizes these executable top-level lifecycle names under
`ci_scripts/`:

- `ci_post_clone.sh`
- `ci_pre_xcodebuild.sh`
- `ci_post_xcodebuild.sh`

The post-build script runs even when `xcodebuild` fails. Never infer success
from a missing exit code or action. Require the documented variables for the
selected action and reject missing, malformed, or failed state.

Keep logs free of secrets. Do not place credentials in remote URLs, command
arguments, or echoed environment dumps.

## XcodeGen Exception

Do not use post-clone generation to create the project or workspace Xcode Cloud
needs for initial configuration. Prefer committing the generated project when
the repository deliberately uses XcodeGen.

Use regeneration during a build only as a separately reviewed exception. The
repository must prove the selected Xcode and XcodeGen versions with a fixture,
own deterministic tool acquisition, and keep the expected project continuously
present. `assets/ci_pre_xcodebuild.sh` is an opt-in guard for that exception:

- it requires `ALLOW_XCODEGEN_REGENERATION=1`
- it requires relative `PROJECT_SPEC_PATH` and `EXPECTED_PROJECT_PATH` values
- it resolves the expected project's parent and project paths and requires both
  to remain inside the canonical repository root before deletion
- it requires `EXPECTED_PROJECT_PATH` to name an `.xcodeproj`; it rejects
  `.xcworkspace` paths because XcodeGen does not regenerate a selected workspace
  through this guard
- in Xcode Cloud, it resolves those paths from Apple's
  `CI_PRIMARY_REPOSITORY_PATH`; outside Xcode Cloud, it falls back to the
  directory that contains `ci_scripts`
- it requires `XCODEGEN_REQUIRED_VERSION` and verifies the exact installed tool
- it refuses to install a mutable package or create a previously absent project
- it preserves a shared `Package.resolved` stored inside the committed project
  container while regenerating that container

Copy it only after those project-specific conditions are reviewed, then run
`chmod +x ci_scripts/ci_pre_xcodebuild.sh`.

## External Publication

This skill does not include a tag-push template. Release tags and other remote
mutations need a separate authorization contract with a mandatory ref
allowlist, a known successful Archive action, least-privilege credentials that
are not embedded in URLs, remote-first idempotency, safe retry behavior, and
isolated failure fixtures.

## Notes

- Recheck official Apple sources for mutable platform behavior and record the
  retrieval date with project-specific conclusions.
- Treat missing projects, schemes, environment variables, dependency locks, or
  tool versions as configuration failures, not successful no-ops.
- Keep confirmed Apple behavior separate from project-specific inference.
- See `references/xcode-cloud-notes.md` for the reviewed source set and
  diagnostic checklist.
