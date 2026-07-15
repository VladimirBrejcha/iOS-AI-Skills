# Silent Pushes Setup Source Review

Reviewed on 2026-07-15 as the first full provenance, alternatives, technical,
and packaging audit of `silent-pushes-setup`.

## Decision

Keep the exported `silent-pushes-setup` name as an active `registry-local`
skill, but narrow its contract to iOS background-notification setup and
diagnosis.

The colloquial name remains useful for discovery. The content now uses Apple's
"background notification" terminology and excludes visible notifications, Live
Activities, PushKit, provider-specific SDKs, widgets, and product data stores.
Those adjacent domains need different payload, entitlement, delivery, or
product-policy decisions.

The narrow skill remains necessary because the failure path crosses signed app
state, registration, provider requests, APNs acceptance, APNs delivery, and app
execution. Apple's first-party documentation is authoritative but intentionally
split across those surfaces. A concise evidence ladder prevents the common and
costly mistake of treating HTTP `200` as proof that the app ran.

## Provenance And Original Source

Repository history establishes this public repository as the original source:

- The repository was created on 2026-01-10 at 17:10 UTC and is MIT licensed.
- `SKILL.md` and all three original references first appeared together in
  initial commit [`46cd104`](https://github.com/fiveonecode/agent-skills/commit/46cd104dc53b4850af74362cb5c036c327a73bcf)
  five minutes later. `git log --follow`, blame, and content-pickaxe history show
  no earlier local revision or attribution.
- Exact public searches for the title, exported name, description opening, and
  distinctive troubleshooting phrases found no result predating that commit.
- The older Axiom repository is a credible independent comparator, but its last
  tree before this repository's initial commit,
  [`fed1b87`](https://github.com/CharlesWiltgen/Axiom/tree/fed1b87755253798772846c0ff301a67ef89e8d4),
  contained no path matching push or notification. Its current push material
  entered the later suite history.
- `dpearson2699/swift-ios-skills` was created in March 2026. A
  [later June 2026 public iOS suite](https://github.com/Emasoft/emasoft-complete-ios-app-authoring/blob/b18a3dc6b1dbafc55358b6b968d6121b6811cc03/skills/ios-essentials/references/silent-push-apns.md)
  published similar widget-oriented background-push wording; its later date is
  propagation evidence, not an upstream ownership claim.

There is therefore no external source to add to `provenance.sources.yaml`. That
manifest is reserved for actual maintained-fork or upstream relationships, not
independent alternatives or later copies. Registry-local ownership remains the
honest disposition.

## Alternatives Reviewed

| Alternative | Evidence | Decision |
| --- | --- | --- |
| [Apple User Notifications documentation](https://developer.apple.com/documentation/usernotifications) | First-party and current, but distributed across signing, registration, transport, Console, Metrics, and Xcode release notes. | Normative source for every claim, not a packaged end-to-end diagnostic workflow. |
| [CharlesWiltgen/Axiom at `8eec4b9`](https://github.com/CharlesWiltgen/Axiom/tree/8eec4b97f491635b0735c8d805efe06e9d9c9e8e) | Mature MIT suite with broad notification coverage. Its generated push guidance says Simulator cannot register with APNs, uses `apns-id` for Delivery Log lookup, and says oversized payloads are silently rejected. Current Apple docs instead document sandbox Simulator registration, `apns-unique-id`, and HTTP `413`. | Do not replace. The suite is broader, packaged differently, and would import inaccurate claims into this narrow workflow. |
| [dpearson2699/swift-ios-skills at `90c9573`](https://github.com/dpearson2699/swift-ios-skills/tree/90c9573272531337962fbb3505036d61ed23389a/skills/push-notifications) | Popular and comprehensive, but covers all notification types, repeats the outdated no-Simulator-registration claim, points technical references through a non-Apple mirror, and uses the PolyForm Perimeter license rather than MIT. | Do not replace or derive from it. Scope, accuracy, source policy, and license are worse fits for this registry entry. |

## Apple Claim Verification

Every retained platform claim was checked against current first-party Apple
documentation:

| Area | Verified contract | Apple source |
| --- | --- | --- |
| Payload and headers | Strict background payload uses `content-available: 1`, no interaction keys, push type `background`, and priority `5`; device payload limit is 4 KB. | [Background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app), [payloads](https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification), [requests](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns) |
| Delivery and throttling | Delivery is low priority and not guaranteed; Apple advises no more than two or three per hour, may retain only a newer update, and gives the handler up to 30 seconds. | [Background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app), [troubleshooting](https://developer.apple.com/documentation/usernotifications/troubleshooting-push-notifications) |
| Entitlements and modes | Push Notifications adds `aps-environment`; its value comes from provisioning, while background delivery separately requires Remote notifications background mode. | [Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/aps-environment), [registration](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns) |
| Simulator boundaries | Local `.apns` simulation supports background fetch but bypasses APNs. Compatible Simulators can register with APNs sandbox, and their tokens are variable-length and hardware-bound. | [Xcode 11.4](https://developer.apple.com/documentation/xcode-release-notes/xcode-11_4-release-notes), [Xcode 14](https://developer.apple.com/documentation/xcode-release-notes/xcode-14-release-notes) |
| Provider testing | Push Notifications Console sends tests, validates JWTs and tokens, and generates a cURL request. | [Console testing](https://developer.apple.com/documentation/usernotifications/testing-notifications-using-the-push-notification-console) |
| Diagnostics and metrics | HTTP responses expose status, reason, and `apns-id`; development responses add `apns-unique-id` for seven-day Delivery Logs. Metrics are aggregated and rounded delivered, stored, and discarded states. | [Responses](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns), [Metrics](https://developer.apple.com/documentation/usernotifications/viewing-the-status-of-push-notifications-using-metrics-and-apns) |

## Registry And Packaging Impact

- The skill remains `registry-local`, active, and MIT licensed.
- The exported name, source path, update policy, and client states do not change.
- `provenance.sources.yaml` does not change because no upstream relationship was
  found.
- All clients remain `planned`. This audit does not add a real machine or repo
  profile and does not write any real consumer root.
- A focused deterministic test locks the verified Apple contract and rejects
  stale Simulator, widget, Cloudflare, D1, and unofficial-doc wording.

## Manager Proof And Boundary

Manager discovery and copy packaging were proven with `skills@1.5.14` from the
local repository source while `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, the
npm cache, and the working directory all pointed into one disposable root. The
command shape was:

```bash
HOME="$PROOF_HOME" \
XDG_CONFIG_HOME="$PROOF_HOME/.config" \
XDG_CACHE_HOME="$PROOF_HOME/.cache" \
npm_config_cache="$PROOF_HOME/.npm-cache" \
npx --yes skills@1.5.14 add "$LOCAL_SOURCE" \
  --skill silent-pushes-setup \
  --agent codex opencode claude-code \
  --global --yes --copy
```

The same isolated environment first ran `add "$LOCAL_SOURCE" --list` and found
the skill, then ran `list --global --json` and found the installed entry. The
copy command produced exactly two roots:

- `$HOME/.agents/skills/silent-pushes-setup`, shared by Codex and OpenCode;
- `$HOME/.claude/skills/silent-pushes-setup`, for Claude Code.

Both roots were exact `diff -qr` matches to the registry source. That source
matches lock digest
`1e843f08071c4bc8883cc76a13ca352405f0e955823595ca3ce23ef4290dbb72`.
The recorded proof wrote only inside the disposable root, which was removed.
It did not write any real global or repository consumer root, and no
manager-generated proof state is committed.

Clients remain `planned` because discovery and byte-for-byte packaging prove
manager compatibility, not reviewed profile selection. The registry contract
requires a separate rollout decision before a shared global or Claude copy is
a supported baseline; repo-local consumers also remain manual review.

## Limitation

This documentation audit does not send a live production notification. That
would require an app-specific production token and provider credential and
would not be appropriate for a public catalog audit. The Push Notifications
Console and layered workflow are the prescribed project-level proof path.
