---
name: swift-testing
description: "Writes, reviews, and improves Swift Testing code using modern APIs and best practices. Use when reading, writing, or reviewing projects that use Swift Testing, including @Test, #expect, #require, async tests, XCTest migration, traits, confirmations, exit tests, and Swift 6.2+ testing features."
---

Write and review Swift Testing code for correctness, modern API usage, and adherence to project conventions. Report only genuine problems - do not nitpick or invent issues.

Review process:

1. Ensure tests follow core Swift Testing conventions using `references/core-rules.md`.
1. Validate test structure, assertions, dependency injection, and other best practices using `references/writing-better-tests.md`.
1. Check async tests, confirmations, time limits, actor isolation, and networking mocks using `references/async-tests.md`.
1. Ensure new features like raw identifiers, test scopes, exit tests, and attachments are used correctly using `references/new-features.md`.
1. If migrating from XCTest, follow the conversion guidance in `references/migrating-from-xctest.md`.
1. Check oracle strength: the test must prove the intended behavior, not merely exercise a path or accept broad normalized output.

If doing partial work, load only the relevant reference files.


## Core Instructions

- Target Swift 6.2 or later, using modern Swift concurrency.
- As a Swift Testing developer, the user wants all new unit and integration tests to be written using Swift Testing, and they may ask for help migrating existing XCTest code to Swift Testing.
- Swift Testing does *not* support UI tests – XCTest must be used there.
- Use a consistent project structure, with folder layout determined by app features.
- Treat weak or vacuous assertions as correctness issues, even when the test uses the right Swift Testing APIs.

Swift Testing evolves with each Swift release, so expect three to four releases each year, each introducing new features. This means existing training data you have will naturally be outdated or missing key features.

This skill specifically draws upon the very latest Swift and Swift Testing code, which means it will suggest things you are not aware of. Treat the user’s installed toolchain as authoritative, but there's a fairly high chance Apple's *documentation* about the APIs will be stale, so treat them carefully.


## Output Format

If the user asks for a review, organize findings by file. For each issue:

1. State the file and relevant line(s).
2. Name the rule being violated.
3. Show a brief before/after code fix.

Skip files with no issues. End with a prioritized summary of the most impactful changes to make first.

If the user asks you to write or improve tests, follow the same rules above but make the changes directly instead of returning a findings report.

Example output:

### UserTests.swift

**Line 5: Use struct, not class, for test suites.**

```swift
// Before
class UserTests: XCTestCase {

// After
struct UserTests {
```

**Line 12: Use `#expect` instead of `XCTAssertEqual`.**

```swift
// Before
XCTAssertEqual(user.name, "Taylor")

// After
#expect(user.name == "Taylor")
```

**Line 30: Use `#require` for preconditions, not `#expect`.**

```swift
// Before
#expect(users.isEmpty == false)
let first = users.first!

// After
let first = try #require(users.first)
```

### Summary

1. **Fundamentals (high):** Test suite on line 5 should be a struct, not a class inheriting from `XCTestCase`.
2. **Migration (medium):** `XCTAssertEqual` on line 12 should be migrated to `#expect`.
3. **Assertions (medium):** Force-unwrap on line 30 should use `#require` to unwrap safely and stop the test early on failure.

End of example.

## Oracle strength checklist

Apply this before considering a new or changed test meaningful:

- The test has at least one assertion that would fail for the known or plausible regression.
- Boundary pairs cover both sides of the rule, not only the accepted case.
- Negative proofs reject forbidden values, duplicate records, stale identifiers, cancelled work, or invalid transitions.
- Collections assert ordering when order matters, and multiset/set equality when order must not matter.
- Snapshots are exact where output is contractual; normalization is explicit and does not erase the bug class.
- Identity handling covers stale IDs, regenerated IDs, canonical IDs, and crosswalk behavior when applicable.
- Paired edits assert both sides of a relationship, such as source and projection, model and persisted envelope, or request and emitted event.
- Path-to-suite or path-to-verifier mapping proves the changed source is actually covered by the test command.
- Helper verification methods preserve caller source location so failures point to the test that owns the oracle.


## References

- `references/core-rules.md` - core Swift Testing rules: structs over classes, `init`/`deinit` over setUp/tearDown, parallel execution, parameterized tests, `withKnownIssue`, and tags.
- `references/writing-better-tests.md` - test hygiene, structuring tests, hidden dependencies, `#expect` vs `#require`, `Issue.record()`, `#expect(throws:)`, and verification methods.
- `references/async-tests.md` - serialized tests, `confirmation()`, time limits, actor isolation, testing pre-concurrency code, and mocking networking.
- `references/new-features.md` - raw identifiers, range-based confirmations, test scoping traits, exit tests, attachments, `ConditionTrait.evaluate()`, and the updated `#expect(throws:)` return value.
- `references/migrating-from-xctest.md` - XCTest-to-Swift Testing conversion steps, assertion mappings, and floating-point tolerance via Swift Numerics.
