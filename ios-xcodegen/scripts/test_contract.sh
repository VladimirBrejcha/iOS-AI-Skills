#!/bin/sh
set -eu

skill_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

ruby - "$skill_root" <<'RUBY'
require "yaml"

root = ARGV.fetch(0)

def assert(condition, message)
  raise message unless condition
end

def load_yaml(path)
  YAML.safe_load(File.read(path), permitted_classes: [], aliases: false)
end

project = load_yaml(File.join(root, "examples/project.yml"))
diagnostic = load_yaml(File.join(root, "examples/diagnostic-contract.yml"))
skill = File.read(File.join(root, "SKILL.md"))
references = File.read(File.join(root, "references/primary-sources.md"))

assert(project.fetch("options").fetch("minimumXcodeGenVersion") == "2.45.4",
       "fixture must guard the reviewed XcodeGen version")

app = project.fetch("targets").fetch("FixtureApp")
resources = app.fetch("sources").find do |source|
  source.is_a?(Hash) && source["path"] == "Resources"
end
assert(resources && resources["buildPhase"] == "resources",
       "resource fixture must use the resources build phase")

settings = app.fetch("settings").fetch("base")
assert(settings["ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS"] == "YES",
       "asset symbol generation setting is missing")
assert(settings["ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS"] == "YES",
       "asset symbol extension setting is missing")

tests = project.fetch("targets").fetch("FixtureTests")
assert(!tests.key?("hostApplication"),
       "test fixture must not use an undocumented hostApplication key")
host_dependency = tests.fetch("dependencies").find do |dependency|
  dependency["target"] == "FixtureApp"
end
assert(host_dependency,
       "hosted test fixture must depend on the application target")
test_targets = project.fetch("schemes").fetch("FixtureApp")
                      .fetch("test").fetch("targets")
assert(test_targets.include?("FixtureTests"),
       "scheme fixture must select the test target")

package = project.fetch("packages").fetch("FixturePackage")
assert(package["exactVersion"] == "1.2.3",
       "package fixture must use a deterministic requirement")
assert(package["url"] == "https://example.invalid/FixturePackage.git",
       "fixture package URL must remain non-routable")
package_dependency = app.fetch("dependencies").find do |dependency|
  dependency["package"] == "FixturePackage"
end
assert(package_dependency && package_dependency["product"] == "FixtureLibrary",
       "app fixture must consume the package product")

destination = diagnostic.fetch("destination")
assert(destination["discoveryCommand"].end_with?("-showdestinations"),
       "destination fixture must use active-toolchain discovery")
assert(destination["hardCodedVariant"] == false,
       "destination fixture must reject a hard-coded variant")

swiftpm = diagnostic.fetch("swiftpm")
assert(swiftpm["universalPackageResolvedPath"] == false,
       "SwiftPM fixture must reject a universal Package.resolved path")
assert(swiftpm["restoreRelativeTo"] == "generated-container",
       "SwiftPM state must be restored relative to the generated container")

packaging = diagnostic.fetch("binaryPackaging")
raw = packaging.fetch("rawArchive")
assert(raw["documentedXcodeGenDependencyRecipe"].nil?,
       "raw archive fixture must not invent an XcodeGen dependency recipe")
assert(raw["link"] == "required" && raw["embedOrCopy"] == "forbidden",
       "raw archive must link without embed/copy")
assert(packaging.fetch("staticFrameworkWithResources")["embed"] ==
       "allowed-when-resources-are-required",
       "resource-bearing static framework must not be blanket link-only")
assert(packaging.fetch("staticXCFrameworkVariant")["inspectSelectedContainedProduct"] == true,
       "static XCFramework fixture must inspect the selected product")
assert(packaging.fetch("dynamicFramework")["embed"] ==
       "required-when-app-needs-it-at-runtime",
       "dynamic runtime framework must be embedded")

required_skill_text = [
  "ASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS",
  "ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS",
  "ColorResource",
  "ImageResource",
  "minimumXcodeGenVersion",
  "-showdestinations",
  "there is no universal path",
  "documented `framework:` dependency covers frameworks and XCFrameworks",
  "Do not delete the global Derived Data root",
  "references/primary-sources.md"
]
required_skill_text.each do |text|
  assert(skill.include?(text), "SKILL.md missing contract text: #{text}")
end

forbidden_skill_text = [
  "ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOLS=YES",
  "`ColorAsset`",
  "`ImageAsset`",
  "framework: path/to/libSomething.a",
  "variant=Designed for iPad",
  ".xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
]
forbidden_skill_text.each do |text|
  assert(!skill.include?(text), "SKILL.md retains stale contract text: #{text}")
end

assert(references.include?("Reviewed and retrieved: 2026-07-16."),
       "primary sources must retain their retrieval date")
[
  "github.com/yonaskolb/XcodeGen/blob/2.45.4/Docs/ProjectSpec.md",
  "developer.apple.com/documentation/xcode/build-settings-reference",
  "developer.apple.com/documentation/xcode/creating-a-static-framework",
  "developer.apple.com/documentation/xcode/making-dependencies-available-to-xcode-cloud"
].each do |url|
  assert(references.include?(url), "primary source map missing: #{url}")
end

Dir.glob(File.join(root, "**/*"), File::FNM_DOTMATCH).each do |path|
  next unless File.file?(path)

  bytes = File.binread(path).bytes
  assert(bytes.all? { |byte| byte < 128 }, "non-ASCII content: #{path}")
end

puts "ios-xcodegen contract fixtures: ok"
RUBY
