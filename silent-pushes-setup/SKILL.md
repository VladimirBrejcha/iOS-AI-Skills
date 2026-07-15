---
name: silent-pushes-setup
description: "Set up, audit, or diagnose iOS background (silent) notifications end to end: signed entitlements, APNs registration and environment, provider headers and payload, throttling, Simulator and device testing, and Apple delivery diagnostics. Use for content-available pushes or missing background delivery; not for visible alerts, Live Activities, PushKit, or provider-specific SDK setup."
---

# iOS Background Push Setup And Diagnosis

Apple calls these background notifications. "Silent push" is the common name
for an APNs device notification that wakes the app without an alert, sound, or
badge.

## Scope

Use this skill for an iOS or iPadOS app that receives
`apns-push-type: background` notifications. Keep these adjacent concerns out of
scope:

- visible alerts, local notifications, notification service extensions, and
  authorization UX;
- Live Activity, PushKit, VoIP, File Provider, and broadcast push types;
- Firebase, other provider SDKs, provider credential provisioning, and widget
  refresh policy.

Do not use background push for urgent, guaranteed, or periodic execution. The
app must reconcile current server state when it next runs because delivery may
be delayed, coalesced, throttled, or dropped.

## Audit Workflow

### 1. Establish The Signed Environment

Record the app bundle ID, signed `aps-environment` value, device-token source,
and provider endpoint. Do not infer the APNs environment from a scheme or
configuration name.

- `development` uses `api.sandbox.push.apple.com`.
- `production`, including prerelease and beta distribution, uses
  `api.push.apple.com`.
- Xcode derives `aps-environment` from the provisioning profile. Verify the
  signed app, not only the source entitlement file or Xcode UI.

### 2. Verify Capabilities And Registration

The app target needs both:

- **Push Notifications**, which adds the iOS `aps-environment` entitlement;
- **Background Modes > Remote notifications**, which permits background
  notification handling.

Call `registerForRemoteNotifications()` on each launch. Handle both registration
callbacks and forward every successful token callback to the provider. Treat
the token as opaque and variable-length; do not cache it locally as truth or
assume a fixed size. Bind provider records to the token, topic, and APNs
environment.

Alert authorization is separate. `registerForRemoteNotifications()` can obtain
a token for background delivery without first requesting permission for alerts,
sounds, or badges.

### 3. Verify The Background Handler

Implement
`application(_:didReceiveRemoteNotification:fetchCompletionHandler:)`. Perform
bounded, idempotent reconciliation and call the completion handler exactly once
with `.newData`, `.noData`, or `.failed`. iOS gives the app up to 30 seconds for
this work; a push is a signal to fetch current state, not the state itself.

### 4. Verify The APNs Request

For a strictly background notification, use:

| Field | Required value or rule |
| --- | --- |
| Host | Match the token's signed `aps-environment` |
| `apns-push-type` | `background` |
| `apns-priority` | `5`; priority `10` is invalid for this push type |
| `apns-topic` | The receiving app's bundle ID |
| `apns-expiration` | Choose explicitly from the update's useful lifetime |
| `apns-collapse-id` | Optional; use only when a newer update supersedes an older one |

The payload's `aps` dictionary contains only `content-available`. Put small
custom routing data beside `aps`, not inside it, and keep the whole payload at
or below 4 KB.

```json
{
  "aps": {
    "content-available": 1
  },
  "revision": "opaque-server-revision"
}
```

Do not add `alert`, `sound`, or `badge`; that is no longer a strictly background
notification and requires a different push-type decision.

### 5. Test In Layers

1. Use an `.apns` file with `simctl push` to test local app handling. This
   bypasses provider authentication and APNs delivery.
2. On a compatible Simulator, remote APNs registration uses the sandbox only.
   Simulator tokens are valid for that Simulator and Mac combination and may
   differ in length from device tokens.
3. Use Apple's Push Notifications Console to send a development test before
   blaming provider code. It can validate tokens and JWTs and generate a cURL
   request without requiring a custom test sender.
4. Test the production environment on a physical device with a production
   token. Never commit or paste provider keys, JWTs, or complete production
   tokens into logs or review evidence.

### 6. Separate Acceptance From Delivery

An APNs HTTP `200` means APNs accepted the request; it does not prove delivery
or app execution. Record the response status, error `reason`, `apns-id`, and, in
development, `apns-unique-id`.

- Query a development delivery log in Push Notifications Console with
  `apns-unique-id`; development logs are available for up to seven days.
- Use Console Metrics for aggregated, rounded delivered, stored, and discarded
  states. Metrics are trend evidence, not a per-device receipt.
- Confirm the app callback and its completion result separately.

### 7. Apply Apple's Delivery Limits

Background notifications are low priority and never guaranteed. Apple says the
allowance varies with current conditions and advises not trying to send more
than two or three per hour. Device power state, connectivity, app state, and
Background App Refresh settings affect delivery. Testing from Xcode disables
some silent-push limits, so a development success is not production frequency
proof.

APNs or the device may hold only the newest update, and a held notification is
discarded if the app is killed. Design the next app launch or foreground refresh
to recover all missed state.

## Exit Criteria

- Signed entitlements and provisioning profile agree on `aps-environment`.
- Registration succeeds and the provider stores the current token with topic
  and environment.
- Payload, push type, priority, topic, endpoint, and expiration semantics agree.
- APNs acceptance evidence is not reported as delivery evidence.
- A development delivery log or app callback isolates the failing layer.
- Product behavior remains correct when notifications are delayed or dropped.

## References

- Apple source map and verified claims: `references/apple-docs.md`.
- Commands and layered triage: `references/troubleshooting.md`.
