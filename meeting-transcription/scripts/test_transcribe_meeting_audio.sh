#!/usr/bin/env bash
set -euo pipefail

for command in ffmpeg ffprobe; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "meeting transcription test skipped: missing $command"
    exit 0
  fi
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/meeting-transcription/scripts/transcribe_meeting_audio.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/meeting-transcription-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

mode_of() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

audio="$tmp_dir/fixture.m4a"
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'sine=frequency=440:duration=5.2' \
  -c:a aac "$audio"

prepare_dir="$tmp_dir/prepare"
mkdir -p "$prepare_dir"
chmod 755 "$prepare_dir"
(
  umask 022
  "$script" \
    --input "$audio" \
    --work-dir "$prepare_dir" \
    --chunk-seconds 2 \
    --prepare-only >/dev/null
)

initial_count="$(find "$prepare_dir/chunks" -maxdepth 1 -name 'chunk_*.m4a' | wc -l | tr -d ' ')"
test "$initial_count" -gt 1
test "$(cat "$prepare_dir/chunks/.complete")" = "$initial_count"
test "$(mode_of "$prepare_dir")" = "700"
test "$(mode_of "$prepare_dir/source-metadata.json")" = "600"

original_source_sha="$(cat "$prepare_dir/source.sha256")"
original_metadata_sha="$(shasum -a 256 "$prepare_dir/source-metadata.json" | awk '{print $1}')"
other_audio="$tmp_dir/other-fixture.m4a"
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'sine=frequency=880:duration=3.1' \
  -c:a aac "$other_audio"
if "$script" \
  --input "$other_audio" \
  --work-dir "$prepare_dir" \
  --chunk-seconds 2 \
  --prepare-only \
  --resume >/dev/null 2>&1; then
  echo "expected mismatched resume to fail" >&2
  exit 1
fi
test "$(cat "$prepare_dir/source.sha256")" = "$original_source_sha"
test "$(shasum -a 256 "$prepare_dir/source-metadata.json" | awk '{print $1}')" = "$original_metadata_sha"

first_chunk="$(find "$prepare_dir/chunks" -maxdepth 1 -name 'chunk_*.m4a' | sort | head -1)"
for chunk in "$prepare_dir"/chunks/chunk_*.m4a; do
  if test "$chunk" != "$first_chunk"; then
    rm -f "$chunk"
  fi
done
rm -f "$prepare_dir/chunks/.complete"

"$script" \
  --input "$audio" \
  --work-dir "$prepare_dir" \
  --chunk-seconds 2 \
  --prepare-only \
  --resume >/dev/null

resumed_count="$(find "$prepare_dir/chunks" -maxdepth 1 -name 'chunk_*.m4a' | wc -l | tr -d ' ')"
test "$resumed_count" = "$initial_count"
test "$(cat "$prepare_dir/chunks/.complete")" = "$resumed_count"

managed_home="$tmp_dir/managed-root"
managed_root="$managed_home/.agents/skills/gemini-files-api/scripts"
mkdir -p "$managed_root"

cat > "$managed_root/bootstrap.sh" <<'BOOTSTRAP'
#!/usr/bin/env bash
set -euo pipefail
printf 'bootstrap ok\n' > "${FAKE_GEMINI_BOOTSTRAP_MARKER:?}"
BOOTSTRAP
chmod +x "$managed_root/bootstrap.sh"

cat > "$managed_root/gemini-mm.mjs" <<'WRAPPER'
import fs from 'node:fs';

const counterPath = process.env.FAKE_GEMINI_COUNTER;
const count = fs.existsSync(counterPath)
  ? Number(fs.readFileSync(counterPath, 'utf8'))
  : 0;
fs.writeFileSync(counterPath, `${count + 1}\n`);

if (count === 0) {
  process.stdout.write(`${JSON.stringify({
    text: '[00:00:00] Response without required output token metadata.',
    modelVersion: 'fixture-model',
    usageMetadata: {},
  })}\n`);
} else {
  process.stdout.write(`${JSON.stringify({
    text: '[00:00:00] Managed wrapper retry transcript.',
    modelVersion: 'fixture-model',
    usageMetadata: {
      candidatesTokenCount: 8,
      totalTokenCount: 16,
      promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 8 }],
    },
  })}\n`);
}
WRAPPER

export FAKE_GEMINI_COUNTER="$tmp_dir/gemini-counter"
export FAKE_GEMINI_BOOTSTRAP_MARKER="$tmp_dir/bootstrap-marker"
run_dir="$tmp_dir/run"
HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test >/dev/null

test -f "$FAKE_GEMINI_BOOTSTRAP_MARKER"
rg -n $'chunk_000.json\t0\t[0-9]+\tmissing_output_tokens' "$run_dir/validation.tsv" >/dev/null
test ! -s "$run_dir/unresolved-parts.txt"
rg -n 'Managed wrapper retry transcript' "$run_dir/assembled-transcript-body.md" >/dev/null
test "$(jq -r '.malformedResponses' "$run_dir/usage.json")" = "1"

mkdir -p "$run_dir/rescue/000"
printf '{stale rescue response\n' > "$run_dir/rescue/000/part_00.json"
HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test \
  --resume >/dev/null
test ! -s "$run_dir/accepted-rescue-parts.txt"
test ! -e "$run_dir/rescue/000/part_00.json"
rg -n 'Managed wrapper retry transcript' "$run_dir/assembled-transcript-body.md" >/dev/null

retry_response="$run_dir/retry/000/part_00.json"
jq '.text = ("Yeah " * 25)' "$retry_response" > "$retry_response.tmp"
mv "$retry_response.tmp" "$retry_response"
HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --rescue-model fixture-rescue \
  --skip-smoke-test \
  --resume >/dev/null
test "$(jq -r '.rescueModel' "$run_dir/run-config.json")" = "fixture-rescue"
test "$(jq -r '.rescueModel' "$run_dir/run-manifest.json")" = "fixture-rescue"
rg -n '^000/part_00$' "$run_dir/accepted-rescue-parts.txt" >/dev/null

accepted_rescue_sha="$(shasum -a 256 "$run_dir/accepted-rescue-parts.txt" | awk '{print $1}')"
rescue_response_sha="$(shasum -a 256 "$run_dir/rescue/000/part_00.json" | awk '{print $1}')"
if HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test \
  --resume >/dev/null 2>&1; then
  echo "expected plain resume with accepted rescues to require --rescue-model" >&2
  exit 1
fi
test "$(shasum -a 256 "$run_dir/accepted-rescue-parts.txt" | awk '{print $1}')" = "$accepted_rescue_sha"
test "$(shasum -a 256 "$run_dir/rescue/000/part_00.json" | awk '{print $1}')" = "$rescue_response_sha"
test "$(jq -r '.rescueModel' "$run_dir/run-config.json")" = "fixture-rescue"

HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --rescue-model fixture-rescue \
  --rescue-output-tokens 5000 \
  --skip-smoke-test \
  --resume >/dev/null
test "$(jq -r '.rescueOutputTokens' "$run_dir/run-config.json")" = "5000"

unsafe_dir="$tmp_dir/unsafe-resume"
mkdir -p "$unsafe_dir/unrelated"
chmod 755 "$unsafe_dir" "$unsafe_dir/unrelated"
if "$script" \
  --input "$audio" \
  --work-dir "$unsafe_dir" \
  --chunk-seconds 10 \
  --prepare-only \
  --resume >/dev/null 2>&1; then
  echo "expected unvalidated resume work directory to fail" >&2
  exit 1
fi
test "$(mode_of "$unsafe_dir")" = "755"
test "$(mode_of "$unsafe_dir/unrelated")" = "755"

echo "meeting transcription test ok"
