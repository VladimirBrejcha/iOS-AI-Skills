#!/usr/bin/env bash
set -euo pipefail

skill_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$skill_root/SKILL.md"
apple_docs="$skill_root/references/apple-docs.md"
troubleshooting="$skill_root/references/troubleshooting.md"

require_text() {
  local file="$1"
  local text="$2"

  if ! grep -F -q -- "$text" "$file"; then
    printf 'missing required contract text in %s: %s\n' "$file" "$text" >&2
    exit 1
  fi
}

reject_tree_text() {
  local text="$1"
  local file

  for file in "$skill_file" "$apple_docs" "$troubleshooting"; do
    if grep -F -q -- "$text" "$file"; then
      printf 'stale or out-of-scope text found in %s: %s\n' "$file" "$text" >&2
      exit 1
    fi
  done
}

require_text "$skill_file" 'name: silent-pushes-setup'
require_text "$skill_file" 'Do not infer the APNs environment from a scheme or'
require_text "$skill_file" '`apns-push-type: background`'
require_text "$skill_file" '`apns-priority` | `5`; priority `10` is invalid for this push type'
require_text "$skill_file" '"content-available": 1'
require_text "$skill_file" 'HTTP `200` means APNs accepted the request'
require_text "$skill_file" '`apns-unique-id`'
require_text "$skill_file" 'two or three per hour'
require_text "$skill_file" 'up to 30 seconds'
require_text "$troubleshooting" '"Simulator Target Bundle"'
require_text "$troubleshooting" 'Use `apns-unique-id`, not `apns-id`'
require_text "$apple_docs" 'https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app'
require_text "$apple_docs" 'https://developer.apple.com/documentation/usernotifications/testing-notifications-using-the-push-notification-console'
require_text "$apple_docs" 'https://developer.apple.com/documentation/usernotifications/viewing-the-status-of-push-notifications-using-metrics-and-apns'
require_text "$apple_docs" 'https://developer.apple.com/documentation/xcode-release-notes/xcode-14-release-notes'

for stale_text in \
  'WidgetCenter' \
  'wrangler' \
  'Cloudflare' \
  'D1 verification' \
  'last_push_at' \
  'Day off by one' \
  'Simulator cannot register' \
  'Simulator does not register' \
  'sosumi.ai' \
  'Codex skill format'; do
  reject_tree_text "$stale_text"
done

while IFS= read -r url; do
  case "$url" in
    https://developer.apple.com/*) ;;
    *)
      printf 'non-Apple technical source in apple-docs.md: %s\n' "$url" >&2
      exit 1
      ;;
  esac
done < <(grep -E -o 'https://[^ )]+' "$apple_docs")

if LC_ALL=C grep -R -n '[^	 -~]' "$skill_root"; then
  echo 'silent-pushes-setup must remain ASCII-only' >&2
  exit 1
fi

echo 'silent-pushes-setup contract ok'
