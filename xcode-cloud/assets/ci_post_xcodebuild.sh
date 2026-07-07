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

# Require an explicit workflow opt-in before pushing tags.
if [ "${ENABLE_ARCHIVE_TAG_PUSH:-0}" != "1" ]; then
  echo "ENABLE_ARCHIVE_TAG_PUSH not set to 1. Skipping tag push."
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
TAG_ALLOWED_BRANCHES="${TAG_ALLOWED_BRANCHES:-}"

CURRENT_BRANCH="${CI_BRANCH:-$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)}"
if [ -n "${TAG_ALLOWED_BRANCHES}" ]; then
  if [ -z "${CURRENT_BRANCH}" ]; then
    echo "TAG_ALLOWED_BRANCHES is set, but the current branch is unknown. Skipping tag push."
    exit 0
  fi
  case ",${TAG_ALLOWED_BRANCHES}," in
    *,"${CURRENT_BRANCH}",*)
      ;;
    *)
      echo "Branch ${CURRENT_BRANCH} is not in TAG_ALLOWED_BRANCHES. Skipping tag push."
      exit 0
      ;;
  esac
fi

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

REMOTE_URL="$(git remote get-url origin)"

case "$REMOTE_URL" in
  https://github.com/*)
    AUTH_URL="$(printf "%s" "$REMOTE_URL" | sed "s#https://#https://x-access-token:${GITHUB_TOKEN}@#")"
    ;;
  git@github.com:*)
    HTTPS_URL="$(printf "%s" "$REMOTE_URL" | sed "s#git@github.com:#https://github.com/#")"
    AUTH_URL="$(printf "%s" "$HTTPS_URL" | sed "s#https://#https://x-access-token:${GITHUB_TOKEN}@#")"
    ;;
  https://*)
    echo "Origin is HTTPS but not github.com. Skipping tokenized tag push."
    exit 0
    ;;
  *)
    echo "Unsupported remote URL: ${REMOTE_URL}"
    exit 0
    ;;
esac

if git rev-parse --verify --quiet "refs/tags/${TAG_NAME}" >/dev/null; then
  echo "Tag ${TAG_NAME} already exists locally. Skipping tag push."
  exit 0
fi

if git ls-remote --exit-code --tags origin "refs/tags/${TAG_NAME}" >/dev/null 2>&1 || \
   git ls-remote --exit-code --tags "${AUTH_URL}" "refs/tags/${TAG_NAME}" >/dev/null 2>&1; then
  echo "Tag ${TAG_NAME} already exists on origin. Skipping tag push."
  exit 0
fi

echo "Creating tag: ${TAG_NAME}"
git tag -a "${TAG_NAME}" -m "Xcode Cloud archive build ${BUILD_NUMBER}"

echo "Pushing tag..."
git push "${AUTH_URL}" "refs/tags/${TAG_NAME}:refs/tags/${TAG_NAME}"

echo "=== tag push complete ==="
