---
name: ios-xcodegen
description: "Use for repositories that already use or explicitly evaluate XcodeGen: maintain project.yml/project.yaml as source of truth, diagnose generated projects, configure resources and test hosts, manage SwiftPM state, and verify binary packaging without replacing general Xcode build guidance."
---

# XcodeGen iOS workflow

Use this skill only when a repository already uses XcodeGen or is explicitly
evaluating it. XcodeGen spec semantics belong here; local builds, simulators,
launches, and test execution belong to `xcode-build`, and Xcode Cloud lifecycle
policy belongs to `xcode-cloud`.

The mutable claims below were reviewed against XcodeGen 2.45.4 and current
Apple documentation retrieved on 2026-07-16. Read
[`references/primary-sources.md`](references/primary-sources.md) before changing
toolchain, asset, destination, Swift package, or packaging guidance.

## Establish the project contract

1. Treat `project.yml` or `project.yaml` as the source of truth. Do not edit a
   generated `.xcodeproj` as the durable fix.
2. Read the repository's existing XcodeGen pin and run `xcodegen --version`.
   Preserve stricter project requirements. Do not silently install or update to
   an unreviewed latest release.
3. Require the spec to declare `minimumXcodeGenVersion` for the schema features
   it uses. The fixtures use the reviewed `2.45.4` baseline. A minimum-version
   guard does not replace the repository's tool-installation pin.
4. Confirm the spec captures every target, scheme, package, build setting, and
   resource before replacing an existing generated project. Generate with an
   explicit spec path, for example `xcodegen generate --spec project.yml`.
5. Review the generated project diff and build phases. Generation success alone
   does not prove that resources, hosts, packages, or binary embedding are
   correct.

## Resources and asset symbols

- Put asset catalogs, storyboards, and other resources in a resources build
  phase. In an XcodeGen `sources` entry, use `buildPhase: resources` where the
  path is not otherwise classified correctly.
- When code relies on Xcode-generated asset symbols, use the current build
  settings:

  ```yaml
  ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS: "YES"
  ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS: "YES"
  ```

- Current Xcode-generated Swift resource types include `ColorResource` and
  `ImageResource`. Inspect the generated interface for the active Xcode before
  changing call sites; do not assume legacy wrapper type names.

## Tests and host applications

- Add every test target to the generated scheme or test plan. If discovery
  reports zero tests, inspect the generated scheme and selected test plan first.
- For a hosted unit-test target, add a target dependency on the application in
  the XcodeGen spec, then verify the generated `TEST_HOST` and `BUNDLE_LOADER`
  settings. For UI tests, verify the generated target-under-test relationship
  instead of copying unit-test host settings.
- If `@testable import` fails, confirm the product module name, target
  membership, and that the test target and host build for the same discovered
  destination.

## Discover destinations

Generate the project before asking the active Xcode installation for supported
destinations:

```sh
xcodebuild -project path/to/App.xcodeproj -scheme App -showdestinations
```

Use `-workspace` instead when the generated build container is a workspace.
Choose a destination returned for that exact scheme and toolchain, preferably
by its returned `id` when repeatability matters. `My Mac (Designed for iPad)` is
available only for eligible apps and hosts; do not hard-code a command-line
variant or assume it appears. Choose an iOS Simulator or device destination
that is also compatible with every selected vendor binary slice.

## Swift packages and CI

- Keep package requirements in the XcodeGen spec and use the repository's
  reviewed pinning policy. The fixture uses an exact version only to make the
  contract deterministic.
- Generate the project or workspace, let the selected Xcode resolve packages,
  and then locate the shared `Package.resolved` relative to the actual generated
  container. Project and workspace layouts differ; there is no universal path.
  From a repository root, a scoped diagnostic is:

  ```sh
  find . -path '*/xcshareddata/swiftpm/Package.resolved' -print
  ```

- If CI disables automatic resolution, verify that the discovered shared file
  is committed or restored at the same generated-container-relative path before
  the build. Confirm regeneration does not remove it. Package resolution may
  require network access or credentials; obtain authorization before adding
  either.

## Binary dependencies and archive inspection

Classify the selected product, not just its filename or outer XCFramework
wrapper, and then inspect the generated Link Binary and Embed/Copy phases.

- Raw static archive (`.a`): link it, but never copy or embed the archive into
  an app bundle. XcodeGen 2.45.4 does not document a `library:` dependency, and
  its documented `framework:` dependency covers frameworks and XCFrameworks,
  not a raw-archive recipe. Do not invent either form. Preserve an existing
  project-owned recipe only after the generated project proves a link phase and
  no copy phase; otherwise stop for a reviewed project-specific solution.
- Static framework without resources: normally link without embedding, then
  verify the generated phases and archive.
- Resource-bearing static framework: on current Xcode, embedding can be valid
  so the bundle resources are copied while the already-linked static archive is
  omitted. Do not force `embed: false` solely because the framework is static.
- Static XCFramework variant: inspect the platform-selected contained product
  and its resources. The wrapper does not establish one universal embed value.
- Dynamic framework: link and embed/sign it when the app needs it at runtime,
  unless the platform supplies it. Verify the selected slice supports the
  chosen destination.

After archiving, inspect the explicit app under
`path/to/App.xcarchive/Products/Applications/` and its `Frameworks` directory.
A copied raw `.a` is always a packaging error. A dynamic framework or a
resource-bearing static framework bundle can be expected, so validate each
entry against its classified product and the current Apple rules instead of
requiring the directory to contain only dynamic code.

## Scoped cleanup

- Before removing a generated project, confirm its exact path, confirm the spec
  is complete, and check whether the repository intentionally commits generated
  output. Never delete the only authoritative project representation.
- Do not delete the global Derived Data root. If the build already uses an
  explicit `-derivedDataPath`, confirm and clean only that project-specific
  path. Otherwise identify the exact project child first and keep cleanup
  separate from the source-of-truth fix.
- Avoid recursive deletion through variables, globs, or unresolved paths.
  Regenerate only the named project and re-run the focused checks after cleanup.

## Contract fixtures

Run the public-safe structural contract check after editing this skill:

```sh
sh ios-xcodegen/scripts/test_contract.sh
```

The check parses the resource/test/package fixture, validates the binary and
destination decision fixture, rejects the stale claims corrected by this
review, and confirms the dated primary-source map remains linked.
