---
name: xcode-cloud
description: Set up, configure, or troubleshoot Xcode Cloud CI/CD workflows and custom build scripts, especially for iOS apps using XcodeGen. Use for requests about Xcode Cloud setup, ci_scripts (ci_post_clone.sh/ci_pre_xcodebuild.sh/ci_post_xcodebuild.sh), build/test/archive automation, or tag-pushing after archives.
---

# Xcode Cloud

## Overview

Provide a repeatable setup for Xcode Cloud custom scripts, with ready-to-copy templates for XcodeGen generation and post-archive Git tagging.

## Quick Start

1. Identify the folder that contains the `.xcodeproj` or `.xcworkspace`.
2. Check whether the `.xcodeproj`/`.xcworkspace` is tracked in git. If it is generated and
   ignored, you must use `ci_post_clone.sh` (or commit the generated project).
3. Create `ci_scripts/` in that folder if missing.
4. Copy templates from `assets/`.
5. Customize variables noted in the templates.
6. `chmod +x ci_scripts/*.sh`.
7. In Xcode Cloud, add required secrets (for tagging) and ensure an Archive action exists.

## Workflow: XcodeGen + Tagging

### 1) Place scripts where Xcode Cloud expects them
Create `ci_scripts/` at the same level as the `.xcodeproj`/`.xcworkspace`. Xcode Cloud only recognizes the three official filenames; use `ci_pre_xcodebuild.sh` (or `ci_post_clone.sh`) for XcodeGen and `ci_post_xcodebuild.sh` for tagging.

### 2) XcodeGen project generation
Use `ci_post_clone.sh` if your `.xcodeproj`/`.xcworkspace` is generated and not committed.
Xcode Cloud validates the project path and schemes before `ci_pre_xcodebuild.sh` runs, so
pre-xcodebuild is too late in that setup.
Copy `assets/ci_post_clone.sh` to `ci_scripts/ci_post_clone.sh`.
Use `ci_pre_xcodebuild.sh` only when the project already exists in the repo.
Adjust the root detection if your `project.yml` is not at repo root.

### 3) Tagging after successful archives
Copy `assets/ci_post_xcodebuild.sh` to `ci_scripts/ci_post_xcodebuild.sh`.
Set `INFO_PLIST_PATH` (or provide it as an Xcode Cloud env var).
Set `TAG_PREFIX` if you want a custom prefix.
Ensure the workflow includes an Archive action; otherwise the script will no-op.
Add `GITHUB_TOKEN` as a secret environment variable in Xcode Cloud.

### 4) Make scripts executable
Run `chmod +x ci_scripts/*.sh` after adding or editing scripts.

## Template Assets

- `assets/ci_pre_xcodebuild.sh`: XcodeGen install + project generation (two-script setup)
- `assets/ci_post_clone.sh`: XcodeGen install + project generation (alternative)
- `assets/ci_post_xcodebuild.sh`: archive-only tag push using `GITHUB_TOKEN`

## Notes

- Use the `apple-docs-research` skill when you need official Apple documentation on Xcode Cloud behavior or environment variables.
- Keep logs free of secrets; use Xcode Cloud secret environment variables for tokens.
- Reference `references/xcode-cloud-notes.md` for quick reminders about doc lookups.
- If you see `Project <Name>.xcodeproj does not exist at <path>`, Xcode Cloud validated the
  project before your script ran. Fix by switching to `ci_post_clone.sh` or committing the
  generated project.
