# Apple Documentation Source Map

Reviewed on 2026-07-15. These are first-party Apple sources for the technical
contract in this skill.

## Background Notification Contract

- [Pushing background updates to your app](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)
  - Requires Background Modes > Remote notifications.
  - Uses `content-available: 1`, `apns-push-type: background`, and
    `apns-priority: 5` with no user-interaction keys in `aps`.
  - Calls the iOS background notification handler with up to 30 seconds of
    runtime.
  - Delivery is low-priority and not guaranteed. Apple advises not trying to
    send more than two or three background notifications per hour.
- [Generating a remote notification](https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification)
  - Defines the `aps` keys, custom-key placement, and 4 KB device-notification
    payload limit.

## Signing And Registration

- [APS Environment Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/aps-environment)
  - The iOS key is `aps-environment`; Xcode derives its value from the current
    provisioning profile.
  - Development profiles use `development`. Production profiles and beta
    distribution use `production`.
- [Registering your app with APNs](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns)
  - Enable Push Notifications, request a current token each launch, handle both
    callbacks, and do not cache device tokens as local truth.
- [`registerForRemoteNotifications()`](https://developer.apple.com/documentation/uikit/uiapplication/registerforremotenotifications%28%29)
  - Alert, sound, and badge authorization is separate from remote registration;
    without user-interaction authorization, remote notifications are delivered
    silently.

## Provider Requests And Responses

- [Sending notification requests to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)
  - Documents the sandbox and production hosts, request headers, storage,
    expiration, collapse behavior, and background priority requirements.
- [Handling notification responses from APNs](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns)
  - A response contains status and `apns-id`; errors include a `reason`.
  - Development responses also include `apns-unique-id` for Delivery Log lookup.
  - Oversized device payloads return HTTP `413`; HTTP `200` is request success,
    not proof that the app ran.
  - HTTP `429` has distinct `TooManyRequests` and
    `TooManyProviderTokenUpdates` reasons that require different corrections.
- [Establishing a token-based connection to APNs](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns)
  - Reuse a provider JWT across requests. Refresh it no more often than once
    every 20 minutes and at least once every 60 minutes.
  - APNs rejects a token whose issued-at timestamp is more than one hour old.
- [Troubleshooting push notifications](https://developer.apple.com/documentation/usernotifications/troubleshooting-push-notifications)
  - Covers token, topic, environment, provider errors, silent-push throttling,
    device power budgets, and the fact that Xcode testing disables some limits.

## Testing And Delivery Diagnostics

- [Testing notifications using the Push Notification Console](https://developer.apple.com/documentation/usernotifications/testing-notifications-using-the-push-notification-console)
  - Sends test notifications, validates JWTs and device tokens, and generates a
    cURL request.
  - Development Delivery Logs use `apns-unique-id` and remain available for up
    to seven days. Production sends require an administrator role.
- [Viewing the status of push notifications using Metrics and APNs](https://developer.apple.com/documentation/usernotifications/viewing-the-status-of-push-notifications-using-metrics-and-apns)
  - Metrics are aggregated and rounded. They distinguish delivered, stored, and
    discarded states and explain delivery factors.
- [Push Notifications Console](https://developer.apple.com/notifications/push-notifications-console/)
  - Console overview for sends, token tools, delivery logs, and aggregate
    metrics.

## Simulator Boundaries

- [Xcode 11.4 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-11_4-release-notes)
  - `.apns` files and `simctl push` simulate remote notifications, including
    background content fetch, without exercising a provider or APNs.
- [Xcode 14 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-14-release-notes)
  - Compatible iOS 16 Simulators can register with the APNs sandbox. The token
    is unique to the Simulator and Mac hardware and may be longer than a
    physical-device token.
  - Remote APNs delivery exercises more behavior than local `.apns` simulation.
    Simulator remote registration remains a sandbox path, not production proof.
