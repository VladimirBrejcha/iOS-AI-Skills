# iOS-AI-Skills

A curated set of Codex skills for Apple platform development, mobile tooling, and adjacent services. Each skill is self-contained in a top-level directory with a `SKILL.md` that defines when and how to use it.

## Skills

| Directory | Skill Name | Purpose |
| --- | --- | --- |
| `app-store-optimisation` | `app-store-optimisation-codex` | App Store Optimization (ASO) workflows for the Apple App Store and Google Play Store, covering keyword research, metadata, competitor analysis, A/B tests, scoring, localization, and launch/update planning. |
| `apple-docs-research` | `apple-docs-research` | Research or implement anything related to Apple platforms, Swift/Objective-C APIs, Apple frameworks, WWDC sessions, or Apple Developer Documentation via the apple-docs MCP tools. |
| `apple-hig-designer` | `apple-hig-designer` | Design iOS apps following Apple's Human Interface Guidelines, generating native components, validating accessibility, and applying the clarity/deference/depth principles. |
| `cloudflare-d1` | `cloudflare-d1` | Build with Cloudflare's D1 serverless SQLite database: schema design, migrations, queries, and troubleshooting D1 errors from your Workers. |
| `cloudflare-queues` | `cloudflare-queues` | Build async message queues with Cloudflare Queues, handling producers, consumers, retries, dead-letter queues, and throughput tuning. |
| `cloudflare-worker-base` | `cloudflare-worker-base` | Set up Cloudflare Workers with Hono routing, the Vite plugin, and Static Assets while avoiding export syntax, routing, HMR, and asset rollout issues. |
| `ios-xcodegen` | `ios-xcodegen` | XcodeGen workflows for generating projects from `project.yml`/`project.yaml`, wiring assets, configuring test hosts, managing SwiftPM resolution in CI, and fixing packaging issues with static libraries. |
| `revenuecat` | `revenuecat` | Comprehensive assistance with RevenueCat in-app subscriptions and purchases across platforms. |
| `silent-pushes-setup` | `silent-pushes-setup` | Setup, debug, or validate iOS silent/background push notifications with APNs entitlements, device token registration, backend sending, and widget refresh. |
| `swift-concurrency` | `swift-concurrency` | Guide for building, auditing, and refactoring Swift concurrency (Swift 6+) code, covering async/await, Tasks, actors, MainActor, Sendable types, and migrations. |
| `swiftui-liquid-glass` | `swiftui-liquid-glass` | Implement, review, or improve SwiftUI features using the iOS 26+ Liquid Glass API. |
| `swiftui-performance-audit` | `swiftui-performance-audit` | Audit and improve SwiftUI runtime performance, diagnosing slow rendering, janky scrolling, and high CPU/memory usage while guiding tooling. |
| `swiftui-view-refactor` | `swiftui-view-refactor` | Refactor SwiftUI view files for consistent structure, dependency injection, and safe observation of view models. |
| `threads-api` | `threads-api` | Threads API Documentation for integrations, authentication, media uploads, analytics, webhooks, and troubleshooting. |
| `typescript` | `typescript` | Use when the user asks to configure TypeScript, fix type errors, use dayjs, add type definitions, set up React with TypeScript, or work with TypeScript-specific tooling. |
| `xcode-build` | `xcode-build` | Build and run iOS/macOS apps using `xcodebuild` and `xcrun simctl`, manage simulators, run tests, and automate UI interactions. |
| `xcode-cloud` | `xcode-cloud` | Set up, configure, or troubleshoot Xcode Cloud CI/CD workflows and custom scripts (ci_post_clone.sh, ci_pre_xcodebuild.sh, ci_post_xcodebuild.sh). |

## Contributing a new skill

1. Create a new top-level directory for the skill.
2. Add a `SKILL.md` with YAML front matter (`name`, `description`) and usage instructions.
3. Add any `assets/`, `scripts/`, or `references/` needed by the skill.
4. Update the skills table above.
