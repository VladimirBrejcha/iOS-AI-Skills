# iOS-AI-Skills

A curated set of Codex skills for Apple platform development, mobile tooling, and adjacent services. Each skill is self-contained in a top-level directory with a `SKILL.md` that defines when and how to use it.

## Skills

| Directory | Skill Name | Purpose |
| --- | --- | --- |
| `app-store-optimisation` | `app-store-optimisation-codex` | App Store Optimization (ASO) workflows for Apple App Store and Google Play Store. Use when Codex is asked to research keywords, optimize app metadata (titles, subtitles, descriptions, keywords), analyze competitors, plan A/B tests, compute ASO scores, analyze reviews, plan localization, or build launch/update checklists for mobile apps. |
| `apple-docs-research` | `apple-docs-research` | Use when researching or implementing anything related to Apple platforms (iOS, iPadOS, macOS, watchOS, tvOS, visionOS), Swift/Objective-C APIs, Apple frameworks, WWDC sessions, or Apple Developer Documentation. Triggers include: "find Apple's docs", "latest API guidance", "WWDC session", "platform availability", "SwiftUI/UIKit/AppKit/Combine/AVFoundation/etc.", or any Apple SDK coding question where authoritative docs are needed. Always use the apple-docs MCP tools for discovery and citations instead of general web search. |
| `cloudflare-d1` | `cloudflare-d1` | Build with D1 serverless SQLite database on Cloudflare's edge. Use when: creating databases, writing SQL migrations, querying D1 from Workers, handling relational data, or troubleshooting D1_ERROR, statement too long, migration failures, or query performance issues. |
| `cloudflare-queues` | `cloudflare-queues` | Build async message queues with Cloudflare Queues for background processing. Use when: handling async tasks, batch processing, implementing retries, configuring dead letter queues, managing consumer concurrency, or troubleshooting queue timeout, batch retry, message loss, or throughput exceeded. |
| `cloudflare-worker-base` | `cloudflare-worker-base` | Set up Cloudflare Workers with Hono routing, Vite plugin, and Static Assets using production-tested patterns. Prevents 8 errors: export syntax, routing conflicts, HMR crashes, gradual rollout asset mismatches, and free tier 429s. |
| `revenuecat` | `revenuecat` | Comprehensive assistance with RevenueCat in-app subscriptions and purchases |
| `silent-pushes-setup` | `silent-pushes-setup` | Setup, debug, or validate iOS silent (background) push notifications with APNs, including entitlements, device token registration, backend APNs sending, and widget refresh. Use for silent push setup or troubleshooting (aps-environment errors, token registration, background delivery, APNs headers). |
| `swift-concurrency-expert` | `swift-concurrency-expert` | Swift Concurrency review and remediation for Swift 6.2+. Use when asked to review Swift Concurrency usage, improve concurrency compliance, or fix Swift concurrency compiler errors in a feature or file. |
| `swiftui-liquid-glass` | `swiftui-liquid-glass` | Implement, review, or improve SwiftUI features using the iOS 26+ Liquid Glass API. Use when asked to adopt Liquid Glass in new SwiftUI UI, refactor an existing feature to Liquid Glass, or review Liquid Glass usage for correctness, performance, and design alignment. |
| `swiftui-performance-audit` | `swiftui-performance-audit` | Audit and improve SwiftUI runtime performance from code review and architecture. Use for requests to diagnose slow rendering, janky scrolling, high CPU/memory usage, excessive view updates, or layout thrash in SwiftUI apps, and to provide guidance for user-run Instruments profiling when code review alone is insufficient. |
| `swiftui-view-refactor` | `swiftui-view-refactor` | Refactor and review SwiftUI view files for consistent structure, dependency injection, and Observation usage. Use when asked to clean up a SwiftUI view’s layout/ordering, handle view models safely (non-optional when possible), or standardize how dependencies and @Observable state are initialized and passed. |
| `threads-api` | `threads-api` | Threads API Documentation |
| `typescript` | `typescript` | This skill should be used when the user asks to "configure TypeScript", "fix type errors", "use dayjs", "add type definitions", "set up React with TypeScript", mentions ".ts" or ".tsx" files, or asks about TypeScript best practices or TypeScript-specific tooling. |
| `xcode-build` | `xcode-build` | Build and run iOS/macOS apps using xcodebuild and xcrun simctl directly. Use when building Xcode projects, running iOS simulators, managing devices, compiling Swift code, running UI tests, or automating iOS app interactions. Replaces XcodeBuildMCP with native CLI tools. |
| `xcode-cloud` | `xcode-cloud` | Set up, configure, or troubleshoot Xcode Cloud CI/CD workflows and custom build scripts, especially for iOS apps using XcodeGen. Use for requests about Xcode Cloud setup, ci_scripts (ci_post_clone.sh/ci_pre_xcodebuild.sh/ci_post_xcodebuild.sh), build/test/archive automation, or tag-pushing after archives. |

## Contributing a new skill

1. Create a new top-level directory for the skill.
2. Add a `SKILL.md` with YAML front matter (`name`, `description`) and usage instructions.
3. Add any `assets/`, `scripts/`, or `references/` needed by the skill.
4. Update the skills table above.
