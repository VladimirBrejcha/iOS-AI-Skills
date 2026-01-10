# Apple documentation references

These are the primary sources for silent/background push implementation and APNs provider setup.

## Background (silent) pushes

- Pushing background updates to your app
  - https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app/
  - Key points:
    - Add Background Modes → Remote notifications.
    - Payload uses `aps` with `content-available: 1` and no alert/sound/badge keys.
    - Use `apns-push-type: background` and `apns-priority: 5` headers.
    - System may delay/coalesce or drop background pushes.

## Registering with APNs

- Registering your app with APNs
  - https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns/
  - Key points:
    - iOS entitlement key is `aps-environment` (macOS uses `com.apple.developer.aps-environment`).
    - Call `UIApplication.registerForRemoteNotifications()` to obtain the device token.
    - Implement `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.

## APNs provider request

- Sending notification requests to APNs
  - https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns/
  - Key points:
    - Use `api.sandbox.push.apple.com` for development and `api.push.apple.com` for production.
    - APNs can coalesce notifications; delivery is best‑effort.

## App delegate callback

- application(_:didReceiveRemoteNotification:fetchCompletionHandler:)
  - https://developer.apple.com/documentation/uikit/uiapplicationdelegate/application(_:didreceiveremotenotification:fetchcompletionhandler:)
  - Called for background notifications to fetch content in the background.
