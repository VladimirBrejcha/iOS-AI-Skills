#!/bin/sh
# Xcode Cloud post-xcodebuild script: tag successful archives

set -e

echo "=== post-xcodebuild: tag archive ==="

# Skip on failures when exit code is available.
if [ "${CI_XCODEBUILD_EXIT_CODE:-0}" != "0" ]; then
  echo "Build failed (exit code: ${CI_XCODEBUILD_EXIT_CODE}). Skipping tag."
  exit 0
fi

# Only tag archive actions (if action is set).
if [ -n "${CI_XCODEBUILD_ACTION:-}" ] && [ "${CI_XCODEBUILD_ACTION}" != "archive" ]; then
  echo "Not an archive action (${CI_XCODEBUILD_ACTION}). Skipping tag."
  exit 0
fi

# Require a token to push tags.
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "GITHUB_TOKEN not set. Skipping tag push."
  exit 0
fi

# Configure these per project (or set them as Xcode Cloud env vars).
INFO_PLIST_PATH="${INFO_PLIST_PATH:-Info.plist}"
TAG_PREFIX="${TAG_PREFIX:-v}"

if [ ! -f "$INFO_PLIST_PATH" ]; then
  echo "Info.plist not found at $INFO_PLIST_PATH. Skipping tag."
  exit 0
fi

MARKETING_VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$INFO_PLIST_PATH" 2>/dev/null || true)
BUILD_NUMBER=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$INFO_PLIST_PATH" 2>/dev/null || true)

if [ -z "$MARKETING_VERSION" ] || [ -z "$BUILD_NUMBER" ]; then
  echo "Version/build missing in Info.plist. Skipping tag."
  exit 0
fi

TAG_NAME="${TAG_PREFIX}${MARKETING_VERSION}-build-${BUILD_NUMBER}"

git config user.email "xcode-cloud@yourdomain.example"
git config user.name "Xcode Cloud"

echo "Creating tag: ${TAG_NAME}"
git tag -a "${TAG_NAME}" -m "Xcode Cloud archive build ${BUILD_NUMBER}"

REMOTE_URL="$(git remote get-url origin)"

case "$REMOTE_URL" in
  https://*)
    AUTH_URL="$(printf "%s" "$REMOTE_URL" | sed "s#https://#https://x-access-token:${GITHUB_TOKEN}@#")"
    ;;
  git@github.com:*)
    HTTPS_URL="$(printf "%s" "$REMOTE_URL" | sed "s#git@github.com:#https://github.com/#")"
    AUTH_URL="$(printf "%s" "$HTTPS_URL" | sed "s#https://#https://x-access-token:${GITHUB_TOKEN}@#")"
    ;;
  *)
    echo "Unsupported remote URL: ${REMOTE_URL}"
    exit 0
    ;;
esac

echo "Pushing tag..."
git push "$AUTH_URL" "$TAG_NAME"

echo "=== tag push complete ==="
