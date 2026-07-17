# Xcode Cloud Reviewed Sources

Retrieved: 2026-07-16

Use these primary sources for the catalog guidance, then recheck them when a
project depends on mutable platform behavior:

- Apple, Setting up your project to use Xcode Cloud:
  <https://developer.apple.com/documentation/xcode/setting-up-your-project-to-use-xcode-cloud>
- Apple, Writing custom build scripts:
  <https://developer.apple.com/documentation/xcode/writing-custom-build-scripts>
- Apple, Environment variable reference:
  <https://developer.apple.com/documentation/xcode/environment-variable-reference>
- Apple, Making dependencies available to Xcode Cloud:
  <https://developer.apple.com/documentation/xcode/making-dependencies-available-to-xcode-cloud>
- XcodeGen 2.45.4 project specification:
  <https://github.com/yonaskolb/XcodeGen/blob/2.45.4/Docs/ProjectSpec.md>

## Confirmed Catalog Baseline

- Xcode Cloud expects a consistent project or workspace that is continuously
  present; dynamically creating or editing it with a third-party generator can
  break configuration or later builds.
- The recognized custom lifecycle scripts are `ci_post_clone.sh`,
  `ci_pre_xcodebuild.sh`, and `ci_post_xcodebuild.sh` under top-level
  `ci_scripts`, with a shebang and executable bit.
- The post-build script runs after the corresponding `xcodebuild` action even
  when that action fails. Build result and action variables must therefore be
  checked explicitly before any success-only behavior.

## Project-Specific Inference

Tool acquisition, generated-project regeneration, dependency-lock location,
release publication, and credential handling depend on the repository. Keep
those claims fixture-backed and fail closed when the selected version or path
cannot be proved. Resolve repository-relative inputs from Apple's
`CI_PRIMARY_REPOSITORY_PATH`; `ci_scripts` may sit beside a project or workspace
below the repository root.
