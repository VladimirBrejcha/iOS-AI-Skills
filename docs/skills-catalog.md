# Skills Catalog

This file is generated. Edit `skills.registry.yaml`,
`profiles/machine/example-local-skills.yaml`, or registered `SKILL.md`
front matter, refresh `skills.lock.yaml` if source contents changed, then run
`scripts/skills_catalog.rb --write`.

- Registry: Agent Skills (`agent-skills`)
- Status: `active-partial`
- Manager source: `fiveonecode/agent-skills`
- Covered skills: 8

## Registry-Covered Skills

| Skill | Status | Source | Exports | Clients | Scopes | Update Policy | Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `code-review` | `active` | `registry-local:code-review` | `code-review` | claude=planned, codex=supported | `machine`, `repo` | `internal-reviewed` | Review pull requests, commits, or diffs for high-signal engineering issues and merge risk. Use when asked to review code, audit a patch, find bugs, or provide merge readiness feedback. Focus on defects introduced by the proposed changes (correctness, security, performance, reliability, and maintainability) and report actionable findings with severity, confidence, and precise code locations. |
| `harness-engineering` | `active` | `registry-local:harness-engineering` | `harness-engineering` | claude=planned, codex=supported | `machine`, `repo` | `internal-reviewed` | Build and improve agent-first engineering harnesses where AI agents perform most implementation work and humans steer architecture, constraints, and review. Use when defining or upgrading AGENTS.md rules, repository conventions, task decomposition, CI guardrails, merge strategy, quality gates, or cleanup loops to increase autonomous coding throughput and reliability. |
| `spec-creation-updating` | `active` | `registry-local:spec-creation-updating` | `spec-creation-updating` | claude=planned, codex=supported | `machine`, `repo` | `internal-reviewed` | Create, update, review, and improve technical specification documents so they are complete, testable, and implementation-ready. Use when defining new features/systems/APIs, updating existing specs, restructuring documents, auditing missing requirements, or converting vague plans into concrete, verifiable requirements and acceptance criteria. |
| `ios-xcodegen` | `active` | `registry-local:ios-xcodegen` | `ios-xcodegen` | claude=planned, codex=supported | `machine`, `repo` | `internal-reviewed` | XcodeGen workflows for iOS/iPadOS apps: generate projects from project.yml/project.yaml, fix build/test destination issues, wire asset catalogs, configure test hosts, manage SwiftPM resolution in CI, and resolve App Store packaging errors related to embedded static libraries. |
| `xcode-build` | `active` | `registry-local:xcode-build` | `xcode-build` | claude=planned, codex=supported | `machine`, `repo` | `internal-reviewed` | Build and run iOS/macOS apps using xcodebuild and xcrun simctl directly. Use when building Xcode projects, running iOS simulators, managing devices, compiling Swift code, running UI tests, or automating iOS app interactions. Replaces XcodeBuildMCP with native CLI tools. |
| `swift-concurrency` | `active` | `registry-local:swift-concurrency` | `swift-concurrency` | claude=planned, codex=supported | `machine`, `repo` | `internal-reviewed` | Guide for building, auditing, and refactoring Swift code using modern concurrency patterns (Swift 6+). This skill should be used when working with async/await, Tasks, actors, MainActor, Sendable types, isolation domains, or when migrating legacy callback/Combine code to structured concurrency. Covers Approachable Concurrency settings, isolated parameters, and common pitfalls. |
| `swift-testing` | `active` | `registry-local:swift-testing` | `swift-testing` | claude=planned, codex=supported | `machine`, `repo` | `internal-reviewed` | Use when writing tests with Swift Testing (@Test, #expect, #require), migrating from XCTest, implementing async tests, or parameterizing tests. |
| `swiftui-pro` | `needs-import-review` | `external-git:swiftui-pro@1.1.0` | `swiftui-pro` | claude=planned, codex=planned | `machine`, `repo` | `external-reviewed` | SwiftUI Agent Skill workflows for SwiftUI app development, pinned to a reviewed upstream tag before import or adapter rollout. |

## Installable Active Skills

The commands below use the pinned upstream skills manager package
for the current reviewed example profile.

```bash
npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill code-review --agent codex --global --yes
npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill harness-engineering --agent codex --global --yes
npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill spec-creation-updating --agent codex --global --yes
npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill ios-xcodegen --agent codex --global --yes
npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill xcode-build --agent codex --global --yes
npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill swift-concurrency --agent codex --global --yes
npx --yes skills@1.5.14 add fiveonecode/agent-skills --skill swift-testing --agent codex --global --yes
```
