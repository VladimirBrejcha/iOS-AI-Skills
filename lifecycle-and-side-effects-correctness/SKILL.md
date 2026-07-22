---
name: lifecycle-and-side-effects-correctness
description: Audit and design lifecycle side-effect correctness for async UI, purchase, analytics, retry, cancellation, presentation, and session flows. Use when reviewing SwiftUI or other UI lifecycle code, paywalls, subscription or purchase flows, analytics emission, async tasks, retries, reloads, sheet dismissal, remount behavior, or any change where user-visible state and side effects must stay consistent across lifecycle transitions.
---

# Lifecycle And Side Effects Correctness

## Overview

Use this skill to prevent duplicate, stale, missing, or misattributed side effects across lifecycle transitions. Treat analytics, purchases, network retries, persistence, and callbacks as contract-bearing effects, not incidental code inside a view or async closure.

## Workflow

### 1. Identify the owner

- Name the durable owner for each effect: service, coordinator, store, view model, view task, or external SDK.
- Keep one-shot effects out of view identity when remounts, `.id(...)`, previews, or sheet recreation can run the code again.
- Separate view-local state from session, purchase, analytics, or persisted state.

### 2. Map lifecycle transitions

List the transitions that can start, repeat, cancel, or complete work:

- appear, disappear, dismiss, remount, reload, retry, background, foreground;
- task start, cancellation, timeout, success, failure, fallback;
- purchase start, product/offering reload, checkout, restore, completion;
- analytics impression, dismiss, branch, conversion, error, and retry.

For each transition, write the expected state and allowed side effects.

### 3. Enforce side-effect invariants

- No duplicate side effects from view remount, `.task` restart, `.onAppear`, `.id(...)`, or sheet recreation.
- No stale completion side effects after cancellation, dismissal, navigation away, or superseded input.
- No false dismiss/present, impression, purchase, or retry analytics caused by view identity churn.
- In-flight purchase or mutation actions are idempotent, disabled, or otherwise guarded.
- Retry paths emit required lifecycle events exactly as specified and preserve session attribution.
- Failure paths either emit the required failure effect or explicitly suppress it under a documented rule.
- Persisted state, analytics properties, and user-visible copy derive from the same canonical source when they describe the same decision.

### 4. Check identity and attribution

- Define the stable session, impression, request, purchase, or operation ID before work starts.
- Preserve attribution through retries, slow loads, fallback, and personalized copy refresh.
- Do not derive experiment, package, offering, campaign, or branch attribution from display text when a canonical ID exists.
- Normalize stale IDs only at the boundary that owns the crosswalk; do not let tests erase identity bugs through broad normalization.

### 5. Verify cancellation and retry

- Prefer lifecycle-bound tasks such as `.task(id:)` when the effect should cancel with the view.
- Move effects to a longer-lived owner when they must survive view dismissal.
- After `await`, check cancellation, current identity, or generation token before emitting effects.
- Bound retries and state what happens to analytics, user-visible errors, and persisted state on each retry.
- Treat silent discard as invalid unless the spec names it and defines observability.

### 6. Design tests

Use focused tests around lifecycle edges:

- remount does not duplicate impression or purchase effects;
- dismissal cancels or suppresses stale completion effects;
- retry preserves the same session attribution when required;
- checkout disables plan changes or makes plan changes explicitly safe;
- failure, fallback, and cancellation emit the required event sequence;
- stale async completion cannot overwrite newer state.

Use exact event sequences when order is contractual. Use multiset checks only when order is intentionally irrelevant.

## Review output

When reviewing a lifecycle-sensitive change, report:

- `Effect owners`: which component owns each side effect.
- `Lifecycle transitions`: starts, repeats, cancellations, completions, and retries.
- `Risk findings`: duplicate, stale, missing, or misattributed effects.
- `Required tests`: the smallest tests that prove the lifecycle boundary.
- `Residual risk`: any behavior that still depends on manual QA, live SDK behavior, or product policy.
