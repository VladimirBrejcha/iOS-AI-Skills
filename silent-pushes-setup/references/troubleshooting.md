# Troubleshooting & verification

## Verify entitlements in signed app

```bash
codesign -d --entitlements :- /path/to/DerivedData/.../Build/Products/Debug-iphoneos/App.app
```

You must see:

```
aps-environment = development
```

If it’s missing:
- Ensure the entitlements file uses `aps-environment` (not `com.apple.developer.aps-environment`).
- Confirm the entitlement is present in the *signed* app, not just the source file.

## Inspect embedded provisioning profile (optional)

```bash
openssl smime -inform der -verify -noverify -in /path/to/App.app/embedded.mobileprovision -out /tmp/profile.plist
plutil -p /tmp/profile.plist | rg -n "Entitlements|aps-environment|application-identifier"
```

## App side: token registration

- Call `registerForRemoteNotifications()` at launch.
- Handle:
  - `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`
  - `application(_:didFailToRegisterForRemoteNotificationsWithError:)`

## Backend: APNs request

Checklist:
- Host: `api.sandbox.push.apple.com` for Debug, `api.push.apple.com` for Release.
- Headers:
  - `apns-push-type: background`
  - `apns-priority: 5`
  - `apns-topic: <bundle-id>`
- Payload:
  - `{ "aps": { "content-available": 1 } }`

## D1 verification (Cloudflare)

```bash
npx wrangler d1 execute dailysquares --remote --command "SELECT device_id, environment, substr(apns_token,1,8) AS token_prefix, last_push_at, updated_at FROM device_push_tokens ORDER BY updated_at DESC LIMIT 5;"
```

## Known issues and fixes

- **“No valid aps-environment entitlement string found”**
  - Use `aps-environment` key for iOS.
  - Ensure entitlements exist in the signed app.

- **UNIQUE constraint on device_push_tokens**
  - Make `/v1/device/push/register` idempotent (upsert + update timestamp).

- **Day off by one**
  - Avoid normalizing local daily data to UTC; use local day boundary.

- **`wrangler tail` errors on exit**
  - Safe to ignore; tail cleanup may fail due to expired session.
