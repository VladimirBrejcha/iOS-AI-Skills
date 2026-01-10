---
name: silent-pushes-setup
description: Setup, debug, or validate iOS silent (background) push notifications with APNs, including entitlements, device token registration, backend APNs sending, and widget refresh. Use for silent push setup or troubleshooting (aps-environment errors, token registration, background delivery, APNs headers).
---

# Silent Pushes Setup (iOS + APNs + Backend)

## When to use

Use this skill when the user asks about:
- Silent/background push notifications on iOS
- APNs device token registration
- `aps-environment` entitlement errors
- Backend APNs sending (headers, payloads, JWT)
- Widget refresh triggered by pushes
- Debugging push delivery, throttling, or missing pushes

## Quick path (agent)

1. **Confirm environment**
   - Real device vs simulator, Debug vs Release/TestFlight.
   - Bundle ID + Team ID.
   - Backend environment (prod vs dev) and APNs host.

2. **Verify entitlements in the signed app**
   - Inspect entitlements in the built app binary (`codesign -d --entitlements :- ...`).
   - Ensure `aps-environment` exists and matches build (`development` for Debug, `production` for Release).

3. **Verify registration flow**
   - App calls `registerForRemoteNotifications()` at launch.
   - Token is received in delegate and sent to backend.
   - Backend stores token + environment.

4. **Verify APNs request**
   - Host: `api.sandbox.push.apple.com` (Debug) or `api.push.apple.com` (Release).
   - Headers: `apns-push-type: background`, `apns-priority: 5`, `apns-topic: <bundle-id>`.
   - Payload: `{ "aps": { "content-available": 1 } }` with no alert/sound/badge keys.

5. **Verify background handling**
   - Implement `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)`.
   - Trigger incremental sync and `WidgetCenter.shared.reloadAllTimelines()`.

6. **Validate throttling behavior**
   - Background pushes are best‑effort and may be delayed or coalesced.

## Manual steps (human)

1. **Apple Developer**
   - Enable Push Notifications capability on the App ID.
   - Token‑based APNs key (p8) is sufficient; no APNs certificate required.

2. **Xcode**
   - Add **Push Notifications** capability to app target.
   - Add **Background Modes → Remote notifications**.
   - Use entitlements with explicit `aps-environment` per build config.

3. **Install & test**
   - Build and run on a physical device.
   - Confirm device token registration success in logs.
   - Trigger backend change and verify push + widget refresh.

## Validation checklist

- [ ] Signed entitlements include `aps-environment`.
- [ ] Device token is stored on backend with environment.
- [ ] APNs request returns 200 and backend records `last_push_at`.
- [ ] App receives background push and updates widget.

## Common issues and fixes (from recent work)

- **Error: “no valid aps‑environment entitlement string found”**
  - Root cause: wrong entitlement key or profile stripping it.
  - Fix: use `aps-environment` (iOS) not `com.apple.developer.aps-environment` (macOS), and ensure it exists in the *signed* app entitlements.

- **Push capability shows in Xcode but still failing**
  - XcodeGen projects can ignore UI toggles. Ensure entitlements are correct in source and the signed app contains `aps-environment`.

- **Duplicate push token registration (UNIQUE constraint)**
  - Backend should treat `/v1/device/push/register` as idempotent (upsert + update timestamp).

- **No push after manual refresh**
  - Pushes are only sent when data changes and when the backend path actually triggers `sendPushes` (often cron). This is expected.

- **Posts show on previous day**
  - Cause: local cache normalized to UTC. Fix: store/display days using local day boundary.

- **Wrangler tail error on close**
  - Tail session deletion can fail; this is a Wrangler cleanup issue, not a backend bug.

## References

- Apple docs (background pushes, APNs registration, APNs requests): see `references/apple-docs.md`.
- Codex skill format/reference: see `references/codex-skills.md`.
- Troubleshooting details and commands: see `references/troubleshooting.md`.
