# Background Push Troubleshooting

Collect evidence in order. Do not rewrite app code until the failing boundary is
known.

## Evidence Ledger

Keep these states separate:

1. **Signed app:** capabilities, profile, and `aps-environment` are present.
2. **Registration:** the app received a current token and the provider accepted
   its topic and environment binding.
3. **APNs request:** APNs accepted or rejected one exact request and returned
   identifiers or an error reason.
4. **Delivery and execution:** APNs delivered, stored, or discarded the request,
   and the app callback did or did not run.

HTTP `200` means APNs accepted the request. It does not prove delivery, callback
execution, successful synchronization, or a visible state change.

## Inspect The Signed App

Set `APP_PATH` to the built `.app` bundle, then inspect the signed entitlements:

```bash
: "${APP_PATH:?Set APP_PATH to the signed app bundle}"
codesign -d --entitlements :- "$APP_PATH"
```

Confirm the iOS `aps-environment` key and its value. Do not substitute the macOS
key `com.apple.developer.aps-environment`.

If the app embeds a provisioning profile, inspect the profile separately:

```bash
PROFILE_PLIST="$(mktemp -t apns-profile).plist"
trap 'rm -f "$PROFILE_PLIST"' EXIT
security cms -D -i "$APP_PATH/embedded.mobileprovision" > "$PROFILE_PLIST"
plutil -extract Entitlements xml1 -o - "$PROFILE_PLIST"
```

Compare `aps-environment` and the application identifier with the signed app and
the provider's topic. Xcode source settings alone are not proof.

## Verify Registration

- Call `registerForRemoteNotifications()` on every launch.
- Observe both `didRegisterForRemoteNotificationsWithDeviceToken` and
  `didFailToRegisterForRemoteNotificationsWithError`.
- Forward every successful callback. Do not send only when a local cached token
  appears to change.
- Treat token bytes and length as opaque. Store tokens securely with their
  bundle topic and APNs environment.
- Do not log full production tokens. A request correlation ID and environment
  are safer operational evidence.

Common registration failures are missing signed entitlements, unreachable APNs,
or incorrect signing. Alert authorization is not a prerequisite for obtaining a
token used only for background notifications.

## Exercise App Handling Locally

For Simulator-only app-path testing, create a local payload:

```json
{
  "Simulator Target Bundle": "com.example.app",
  "aps": {
    "content-available": 1
  },
  "test-id": "local-background-handler"
}
```

Then run:

```bash
xcrun simctl push booted com.example.app background-test.apns
```

This verifies simulated notification handling. It does not verify provider
authentication, the APNs endpoint, token registration, APNs throttling, or
delivery diagnostics.

On a compatible Simulator, the app can also register with remote APNs and
receive through the sandbox endpoint. Verify the registration callback instead
of assuming all Simulators fail. Use a physical device for the production APNs
path.

## Isolate The Provider With Apple Tools

Use Push Notifications Console before building a one-off sender:

1. Select the exact bundle ID and environment.
2. Validate the device token for that environment and push type.
3. Choose background push, priority `5`, and the minimal payload.
4. Send the development test and retain its request identifiers.
5. Use **Get cURL Command** to compare Apple's request with provider output.

Do not commit generated commands because they may contain a token, JWT, or other
sensitive values. Production Console sends require an administrator role.

## Inspect Provider Evidence

For every test request, retain non-secret structured evidence:

- topic, APNs environment, push type, priority, expiration, and collapse ID;
- payload byte count and a safe request correlation ID;
- HTTP status, response `apns-id`, and error `reason`;
- development response `apns-unique-id`, when present.

Use `apns-unique-id`, not `apns-id`, to query a development Delivery Log in Push
Notifications Console. Delivery Logs are development-only and available for up
to seven days.

Handle provider responses deliberately:

Branch on the response body's `reason`, not only its HTTP status. In
particular, HTTP `429` can describe device-request pressure or provider JWT
rotation pressure, and those failures need different corrections.

| Evidence | Interpretation | Action |
| --- | --- | --- |
| `400 BadDeviceToken` | Token is invalid for the environment | Recheck signed environment and registration |
| `400 DeviceTokenNotForTopic` | Token and topic do not match | Recheck bundle ID and stored binding |
| `403` authentication reason | Provider credential or JWT is invalid | Fix authentication; do not change app code |
| `410 Unregistered` | Token is no longer active for the topic | Stop using it according to the returned timestamp |
| `413` | Payload exceeds the allowed size | Reduce the payload below 4 KB |
| `429 TooManyRequests` | Consecutive per-device request pressure targeted the same device token | Delay and back off per token; reduce or coalesce request pressure |
| `429 TooManyProviderTokenUpdates` | The provider JWT was replaced too frequently | Reuse the current JWT across requests; rotate no more often than once every 20 minutes and refresh before it is one hour old |
| `5xx` | APNs is temporarily unavailable | Retry later with backoff |
| `200` | APNs accepted the request | Continue to delivery and app evidence |

## Diagnose Accepted But Missing Delivery

For a development request, query the Console Delivery Log with the response's
`apns-unique-id`. For fleet behavior, use Metrics to compare aggregated,
rounded delivered, stored, and discarded states by push type and priority.

Then check:

- background payload, priority, topic, token environment, and expiration;
- whether the app was killed, Background App Refresh is unavailable, or the
  device has power or connectivity constraints;
- whether recent background-push volume exceeds Apple's guidance of two or
  three per hour;
- whether repeated updates were coalesced or only the newest stored update was
  retained;
- whether the callback ran, finished within 30 seconds, and called its
  completion handler exactly once.

Do not repeatedly resend a background notification to make it "reliable".
Choose expiration and collapse semantics that match freshness, and make the app
reconcile all missed state on foreground launch.
