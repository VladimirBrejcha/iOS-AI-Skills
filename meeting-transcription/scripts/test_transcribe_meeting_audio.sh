#!/usr/bin/env bash
set -euo pipefail

missing_commands=()
for command in ffmpeg ffprobe; do
  if ! command -v "$command" >/dev/null 2>&1; then
    missing_commands+=("$command")
  fi
done
if [[ ${#missing_commands[@]} -gt 0 ]]; then
  echo "meeting transcription test skipped: missing runtime commands: ${missing_commands[*]}"
  exit 0
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/meeting-transcription/scripts/transcribe_meeting_audio.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/meeting-transcription-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

bootstrap_fixture="$tmp_dir/bootstrap-fixture"
mkdir -p "$bootstrap_fixture/scripts" "$bootstrap_fixture/fake-bin"
cp "$repo_root/gemini-files-api/scripts/bootstrap.sh" "$bootstrap_fixture/scripts/bootstrap.sh"
cp "$repo_root/gemini-files-api/scripts/package-lock.json" "$bootstrap_fixture/scripts/package-lock.json"
cat > "$bootstrap_fixture/fake-bin/npm" <<'NPM'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "${FAKE_NPM_ARGS:?}"
mkdir -p node_modules
NPM
chmod +x "$bootstrap_fixture/fake-bin/npm"
FAKE_NPM_ARGS="$bootstrap_fixture/npm-args.txt" \
PATH="$bootstrap_fixture/fake-bin:$PATH" \
  bash "$bootstrap_fixture/scripts/bootstrap.sh" >/dev/null
test "$(cat "$bootstrap_fixture/npm-args.txt")" = "ci --ignore-scripts"
test -f "$bootstrap_fixture/scripts/node_modules/.gemini-files-api-lock-sha256"

if grep -F 'require_command rg' "$script" >/dev/null; then
  echo "meeting transcription runtime must not require unused ripgrep" >&2
  exit 1
fi

mode_of() {
  local mode
  if mode="$(stat -f '%Lp' "$1" 2>/dev/null)"; then
    printf '%s\n' "$mode"
  else
    stat -c '%a' "$1"
  fi
}

audio="$tmp_dir/fixture.m4a"
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'sine=frequency=440:duration=5.2' \
  -c:a aac "$audio"

symlink_target="$tmp_dir/symlink-target"
symlink_work_dir="$tmp_dir/symlink-work"
mkdir -p "$symlink_target"
chmod 755 "$symlink_target"
printf 'preserve me\n' > "$symlink_target/existing.txt"
ln -s "$symlink_target" "$symlink_work_dir"
for symlink_work_path in "$symlink_work_dir/" "$symlink_work_dir/."; do
  if "$script" \
    --input "$audio" \
    --work-dir "$symlink_work_path" \
    --prepare-only >/dev/null 2>&1; then
    echo "expected symlinked work directory path to fail: $symlink_work_path" >&2
    exit 1
  fi
  test "$(mode_of "$symlink_target")" = "755"
  test "$(cat "$symlink_target/existing.txt")" = "preserve me"
done

symlink_parent_target="$tmp_dir/symlink-parent-target"
symlink_parent="$tmp_dir/symlink-parent"
mkdir -p "$symlink_parent_target"
ln -s "$symlink_parent_target" "$symlink_parent"
physical_work_dir="$(cd "$symlink_parent_target" && pwd -P)/nested/work"
reported_work_dir="$($script \
  --input "$audio" \
  --work-dir "$symlink_parent/nested/work" \
  --chunk-seconds 10 \
  --prepare-only | sed -n 's/^meeting-transcription: work directory: //p')"
test "$reported_work_dir" = "$physical_work_dir"
test -f "$physical_work_dir/run-config.json"

managed_symlink_source="$tmp_dir/managed-symlink-source"
"$script" \
  --input "$audio" \
  --work-dir "$managed_symlink_source" \
  --chunk-seconds 10 \
  --prepare-only >/dev/null
for managed_subdir in chunks raw text retry rescue; do
  managed_symlink_work="$tmp_dir/managed-symlink-$managed_subdir"
  managed_symlink_target="$tmp_dir/managed-symlink-target-$managed_subdir"
  cp -R "$managed_symlink_source" "$managed_symlink_work"
  rm -rf "$managed_symlink_work/$managed_subdir"
  mkdir -p "$managed_symlink_target"
  chmod 755 "$managed_symlink_target"
  printf 'preserve me\n' > "$managed_symlink_target/existing.txt"
  ln -s "$managed_symlink_target" "$managed_symlink_work/$managed_subdir"
  if "$script" \
    --input "$audio" \
    --work-dir "$managed_symlink_work" \
    --chunk-seconds 10 \
    --prepare-only \
    --resume >/dev/null 2>&1; then
    echo "expected symlinked managed directory to fail: $managed_subdir" >&2
    exit 1
  fi
  test "$(mode_of "$managed_symlink_target")" = "755"
  test "$(cat "$managed_symlink_target/existing.txt")" = "preserve me"
done

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
evidence_symlink_target="$tmp_dir/evidence-symlink-target"
metadata_symlink_target="$tmp_dir/metadata-symlink-target"
printf 'preserve source target\n' > "$evidence_symlink_target"
printf 'preserve metadata target\n' > "$metadata_symlink_target"
ln -s "$evidence_symlink_target" "$prepare_dir/source.sha256.tmp"
ln -s "$metadata_symlink_target" "$prepare_dir/source-metadata.json.tmp"
"$script" \
  --input "$audio" \
  --work-dir "$prepare_dir" \
  --chunk-seconds 2 \
  --prepare-only \
  --resume >/dev/null
test "$(cat "$evidence_symlink_target")" = "preserve source target"
test "$(cat "$metadata_symlink_target")" = "preserve metadata target"
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

rm -f "$prepare_dir/chunks/chunk_001.m4a"
cp "$prepare_dir/chunks/chunk_000.m4a" "$prepare_dir/chunks/chunk_999.m4a"
"$script" \
  --input "$audio" \
  --work-dir "$prepare_dir" \
  --chunk-seconds 2 \
  --prepare-only \
  --resume >/dev/null
for ((chunk_index = 0; chunk_index < initial_count; chunk_index += 1)); do
  test -f "$(printf '%s/chunk_%03d.m4a' "$prepare_dir/chunks" "$chunk_index")"
done
test ! -e "$prepare_dir/chunks/chunk_999.m4a"
test "$(cat "$prepare_dir/chunks/.complete")" = "$initial_count"

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
if (process.env.FAKE_GEMINI_ARG_LOG) {
  fs.appendFileSync(process.env.FAKE_GEMINI_ARG_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
}

const fileIndex = process.argv.indexOf('--file');
const inputFile = fileIndex >= 0 ? process.argv[fileIndex + 1] : '';
const shouldFail = process.env.FAKE_GEMINI_FAIL_FILE
  && inputFile.endsWith(process.env.FAKE_GEMINI_FAIL_FILE);

if (count === 0) {
  process.stdout.write(`${JSON.stringify({
    text: '[00:00:00] Response without required prompt token details.',
    modelVersion: 'fixture-model',
    candidates: [{ finishReason: process.env.FAKE_GEMINI_FINISH_REASON || 'STOP' }],
    usageMetadata: {
      candidatesTokenCount: process.env.FAKE_GEMINI_BAD_TOKEN_COUNT
        ? Number(process.env.FAKE_GEMINI_BAD_TOKEN_COUNT)
        : 8,
      totalTokenCount: 16,
      ...(process.env.FAKE_GEMINI_INVALID_PROMPT_DETAILS
        ? { promptTokensDetails: [{ modality: 'AUDIO' }] }
        : process.env.FAKE_GEMINI_UNKNOWN_MODALITY
          ? { promptTokensDetails: [{ modality: 'audio', tokenCount: 8 }] }
          : process.env.FAKE_GEMINI_BAD_TOKEN_COUNT || process.env.FAKE_GEMINI_FINISH_REASON
            ? { promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 8 }] }
        : {}),
    },
  })}\n`);
} else {
  process.stdout.write(`${JSON.stringify({
    text: shouldFail ? 'Yeah '.repeat(25) : '[00:00:00] Managed wrapper retry transcript.',
    modelVersion: 'fixture-model',
    candidates: [{ finishReason: 'STOP' }],
    requestOrdinal: count,
    usageMetadata: {
      candidatesTokenCount: 8,
      totalTokenCount: 16,
      promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 8 }],
    },
  })}\n`);
}
WRAPPER

repo_local_root="$tmp_dir/product-repo/.agents/skills"
repo_local_meeting_scripts="$repo_local_root/meeting-transcription/scripts"
repo_local_gemini_scripts="$repo_local_root/gemini-files-api/scripts"
mkdir -p "$repo_local_meeting_scripts" "$repo_local_gemini_scripts"
cp "$script" "$repo_local_meeting_scripts/transcribe_meeting_audio.sh"
cp "$managed_root/bootstrap.sh" "$repo_local_gemini_scripts/bootstrap.sh"
cp "$managed_root/gemini-mm.mjs" "$repo_local_gemini_scripts/gemini-mm.mjs"

repo_local_home="$tmp_dir/repo-local-home"
repo_local_run="$tmp_dir/repo-local-run"
mkdir -p "$repo_local_home"
HOME="$repo_local_home" \
FAKE_GEMINI_COUNTER="$tmp_dir/repo-local-counter" \
FAKE_GEMINI_BOOTSTRAP_MARKER="$tmp_dir/repo-local-bootstrap-marker" \
FAKE_GEMINI_INVALID_PROMPT_DETAILS=1 \
  "$repo_local_meeting_scripts/transcribe_meeting_audio.sh" \
  --input "$audio" \
  --work-dir "$repo_local_run" \
  --chunk-seconds 10 \
  --skip-smoke-test >/dev/null
test -f "$tmp_dir/repo-local-bootstrap-marker"
rg -n $'chunk_000.json\t8\t[0-9]+\tinvalid_prompt_token_details' "$repo_local_run/validation.tsv" >/dev/null
rg -n 'Managed wrapper retry transcript' "$repo_local_run/assembled-transcript-body.md" >/dev/null
test "$(jq -r '.malformedResponses' "$repo_local_run/usage.json")" = "1"

unknown_modality_run="$tmp_dir/unknown-modality-run"
HOME="$repo_local_home" \
FAKE_GEMINI_COUNTER="$tmp_dir/unknown-modality-counter" \
FAKE_GEMINI_BOOTSTRAP_MARKER="$tmp_dir/unknown-modality-bootstrap-marker" \
FAKE_GEMINI_UNKNOWN_MODALITY=1 \
  "$repo_local_meeting_scripts/transcribe_meeting_audio.sh" \
  --input "$audio" \
  --work-dir "$unknown_modality_run" \
  --chunk-seconds 10 \
  --skip-smoke-test >/dev/null
rg -n $'chunk_000.json\t8\t[0-9]+\tinvalid_prompt_token_details' "$unknown_modality_run/validation.tsv" >/dev/null
test "$(jq -r '.malformedResponses' "$unknown_modality_run/usage.json")" = "1"

finish_reason_run="$tmp_dir/finish-reason-run"
HOME="$repo_local_home" \
FAKE_GEMINI_COUNTER="$tmp_dir/finish-reason-counter" \
FAKE_GEMINI_BOOTSTRAP_MARKER="$tmp_dir/finish-reason-bootstrap-marker" \
FAKE_GEMINI_FINISH_REASON=SAFETY \
  "$repo_local_meeting_scripts/transcribe_meeting_audio.sh" \
  --input "$audio" \
  --work-dir "$finish_reason_run" \
  --chunk-seconds 10 \
  --skip-smoke-test >/dev/null
rg -n $'chunk_000.json\t8\t[0-9]+\tfinish_reason_safety' "$finish_reason_run/validation.tsv" >/dev/null
rg -n 'Managed wrapper retry transcript' "$finish_reason_run/assembled-transcript-body.md" >/dev/null

for bad_token_count in -1 1.5; do
  safe_bad_token_count="${bad_token_count//./_}"
  bad_token_run="$tmp_dir/bad-token-$safe_bad_token_count-run"
  HOME="$repo_local_home" \
  FAKE_GEMINI_COUNTER="$tmp_dir/bad-token-$safe_bad_token_count-counter" \
  FAKE_GEMINI_BOOTSTRAP_MARKER="$tmp_dir/bad-token-$safe_bad_token_count-bootstrap-marker" \
  FAKE_GEMINI_BAD_TOKEN_COUNT="$bad_token_count" \
    "$repo_local_meeting_scripts/transcribe_meeting_audio.sh" \
    --input "$audio" \
    --work-dir "$bad_token_run" \
    --chunk-seconds 10 \
    --skip-smoke-test >/dev/null
  rg -n $'chunk_000.json\t0\t[0-9]+\tmissing_output_tokens' "$bad_token_run/validation.tsv" >/dev/null
  test "$(jq -r '.malformedResponses' "$bad_token_run/usage.json")" = "1"
  test "$(jq -r '.outputTokens' "$bad_token_run/usage.json")" = "8"
done

export FAKE_GEMINI_COUNTER="$tmp_dir/gemini-counter"
export FAKE_GEMINI_BOOTSTRAP_MARKER="$tmp_dir/bootstrap-marker"
export FAKE_GEMINI_ARG_LOG="$tmp_dir/gemini-args.jsonl"
export GEMINI_MM="$managed_root/gemini-mm.mjs"
export GEMINI_MM_BOOTSTRAP="$managed_root/bootstrap.sh"
run_dir="$tmp_dir/run"
HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test >/dev/null

test -f "$FAKE_GEMINI_BOOTSTRAP_MARKER"
rg -n $'chunk_000.json\t8\t[0-9]+\tmissing_prompt_token_details' "$run_dir/validation.tsv" >/dev/null
test ! -s "$run_dir/unresolved-parts.txt"
rg -n 'Managed wrapper retry transcript' "$run_dir/assembled-transcript-body.md" >/dev/null
test "$(jq -r '.malformedResponses' "$run_dir/usage.json")" = "1"
test "$(jq -r '.requests' "$run_dir/usage.json")" -gt 0
test "$(jq -r '.audioInputTokens' "$run_dir/usage.json")" -gt 0
if rg -n -- '--thinking-level' "$FAKE_GEMINI_ARG_LOG" >/dev/null; then
  echo "meeting transcription requests must not force a model-specific thinking level" >&2
  exit 1
fi

printf '{stale response\n' > "$run_dir/raw/chunk_999.json"
HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test \
  --resume >/dev/null
if rg -n 'chunk_999' "$run_dir/suspect-chunks.txt" >/dev/null; then
  echo "expected stale raw response to be excluded from resume validation" >&2
  exit 1
fi

cp "$run_dir/retry/000/part_00.m4a" "$run_dir/retry/000/scratch.m4a"
HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test \
  --resume >/dev/null
rm "$run_dir/retry/000/scratch.m4a"

for state_file in validation.tsv suspect-chunks.txt retry-validation.tsv unresolved-parts.txt; do
  state_symlink_work="$tmp_dir/state-symlink-${state_file//[^A-Za-z0-9]/-}"
  state_symlink_target="$tmp_dir/state-symlink-target-${state_file//[^A-Za-z0-9]/-}"
  cp -R "$run_dir" "$state_symlink_work"
  printf 'preserve state target\n' > "$state_symlink_target"
  rm -f "$state_symlink_work/$state_file"
  ln -s "$state_symlink_target" "$state_symlink_work/$state_file"
  if HOME="$managed_home" "$script" \
    --input "$audio" \
    --work-dir "$state_symlink_work" \
    --chunk-seconds 10 \
    --retry-seconds 2 \
    --skip-smoke-test \
    --resume >/dev/null 2>&1; then
    echo "expected symlinked managed state file to fail: $state_file" >&2
    exit 1
  fi
  test "$(cat "$state_symlink_target")" = "preserve state target"
done

retry_shard_symlink_work="$tmp_dir/retry-shard-symlink-work"
retry_shard_symlink_target="$tmp_dir/retry-shard-symlink-target"
cp -R "$run_dir" "$retry_shard_symlink_work"
rm -rf "$retry_shard_symlink_work/retry/000"
mkdir -p "$retry_shard_symlink_target"
chmod 755 "$retry_shard_symlink_target"
printf 'preserve retry shard target\n' > "$retry_shard_symlink_target/existing.txt"
ln -s "$retry_shard_symlink_target" "$retry_shard_symlink_work/retry/000"
if HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$retry_shard_symlink_work" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test \
  --resume >/dev/null 2>&1; then
  echo "expected symlinked retry shard directory to fail" >&2
  exit 1
fi
test "$(mode_of "$retry_shard_symlink_target")" = "755"
test "$(cat "$retry_shard_symlink_target/existing.txt")" = "preserve retry shard target"

rescue_shard_symlink_work="$tmp_dir/rescue-shard-symlink-work"
rescue_shard_symlink_target="$tmp_dir/rescue-shard-symlink-target"
cp -R "$run_dir" "$rescue_shard_symlink_work"
rm -rf "$rescue_shard_symlink_work/rescue/000"
mkdir -p "$rescue_shard_symlink_target"
chmod 755 "$rescue_shard_symlink_target"
printf 'preserve rescue shard target\n' > "$rescue_shard_symlink_target/existing.txt"
ln -s "$rescue_shard_symlink_target" "$rescue_shard_symlink_work/rescue/000"
if HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$rescue_shard_symlink_work" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test \
  --resume >/dev/null 2>&1; then
  echo "expected symlinked rescue shard directory to fail" >&2
  exit 1
fi
test "$(mode_of "$rescue_shard_symlink_target")" = "755"
test "$(cat "$rescue_shard_symlink_target/existing.txt")" = "preserve rescue shard target"

cached_response_symlink_work="$tmp_dir/cached-response-symlink-work"
cached_response_symlink_target="$tmp_dir/cached-response-symlink-target"
cp -R "$run_dir" "$cached_response_symlink_work"
printf 'preserve cached response target\n' > "$cached_response_symlink_target"
rm "$cached_response_symlink_work/raw/chunk_000.json"
ln -s "$cached_response_symlink_target" "$cached_response_symlink_work/raw/chunk_000.json"
if HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$cached_response_symlink_work" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test \
  --resume >/dev/null 2>&1; then
  echo "expected symlinked cached response to fail" >&2
  exit 1
fi
test "$(cat "$cached_response_symlink_target")" = "preserve cached response target"

raw_tmp_target="$tmp_dir/raw-response-tmp-target"
printf 'preserve raw target\n' > "$raw_tmp_target"
ln -s "$raw_tmp_target" "$run_dir/raw/chunk_000.json.tmp"
rm -f "$run_dir/raw/chunk_000.json"
HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test \
  --resume >/dev/null
test "$(cat "$raw_tmp_target")" = "preserve raw target"
rm -f "$run_dir/raw/chunk_000.json.tmp"

retry_tmp_target="$tmp_dir/retry-response-tmp-target"
printf 'preserve retry target\n' > "$retry_tmp_target"
printf '{invalid primary response\n' > "$run_dir/raw/chunk_000.json"
rm -f "$run_dir/retry/000/part_00.json"
ln -s "$retry_tmp_target" "$run_dir/retry/000/part_00.json.tmp"
HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test \
  --resume >/dev/null
test "$(cat "$retry_tmp_target")" = "preserve retry target"
rm -f "$run_dir/retry/000/part_00.json.tmp"

mv "$run_dir/retry/000/part_01.m4a" "$run_dir/retry/000/part_99.m4a"
HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test \
  --resume >/dev/null
test -f "$run_dir/retry/000/part_01.m4a"
test ! -e "$run_dir/retry/000/part_99.m4a"

for ((index = 3; index <= 100; index += 1)); do
  number="$(printf '%02d' "$index")"
  : > "$run_dir/retry/000/part_$number.m4a"
  jq --arg text "Synthetic retry part $index." '.text = $text' \
    "$run_dir/retry/000/part_02.json" > "$run_dir/retry/000/part_$number.json"
done
printf '101\n' > "$run_dir/retry/000/.complete"
HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test \
  --resume >/dev/null
part_99_line="$(rg -n 'Synthetic retry part 99\.' "$run_dir/assembled-transcript-body.md" | cut -d: -f1)"
part_100_line="$(rg -n 'Synthetic retry part 100\.' "$run_dir/assembled-transcript-body.md" | cut -d: -f1)"
test "$part_99_line" -lt "$part_100_line"

real_ffprobe="$(command -v ffprobe)"
fake_bin="$tmp_dir/fake-bin"
mkdir -p "$fake_bin"
cat > "$fake_bin/ffprobe" <<EOF
#!/usr/bin/env bash
set -euo pipefail
"$real_ffprobe" "\$@" | jq '.format.duration = "N/A"'
EOF
chmod +x "$fake_bin/ffprobe"

nonnumeric_duration_run="$tmp_dir/nonnumeric-duration-run"
PATH="$fake_bin:$PATH" \
HOME="$managed_home" \
FAKE_GEMINI_COUNTER="$tmp_dir/nonnumeric-duration-counter" \
  "$script" \
  --input "$audio" \
  --work-dir "$nonnumeric_duration_run" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test >/dev/null
rg -n '^## Chunk 000 - 00:00:00 to 00:00:10$' "$nonnumeric_duration_run/assembled-transcript-body.md" >/dev/null
if rg -n 'NaN' "$nonnumeric_duration_run/assembled-transcript-body.md" >/dev/null; then
  echo "expected nonnumeric duration to use the chunk-count fallback" >&2
  exit 1
fi

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
second_retry_response="$run_dir/retry/000/part_01.json"
jq '.text = ("Yeah " * 25)' "$second_retry_response" > "$second_retry_response.tmp"
mv "$second_retry_response.tmp" "$second_retry_response"
if FAKE_GEMINI_FAIL_FILE="part_01.m4a" HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --rescue-model fixture-rescue \
  --skip-smoke-test \
  --resume >/dev/null 2>&1; then
  echo "expected partially unresolved rescue run to fail" >&2
  exit 1
fi
test "$(jq -r '.rescueModel' "$run_dir/run-config.json")" = "fixture-rescue"
rg -n '^000/part_00$' "$run_dir/accepted-rescue-parts.txt" >/dev/null
test "$(wc -l < "$run_dir/accepted-rescue-parts.txt" | tr -d ' ')" = "1"
rg -n '^000/part_01$' "$run_dir/unresolved-parts.txt" >/dev/null

accepted_rescue_sha="$(shasum -a 256 "$run_dir/accepted-rescue-parts.txt" | awk '{print $1}')"
rescue_response_sha="$(shasum -a 256 "$run_dir/rescue/000/part_00.json" | awk '{print $1}')"
if HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --rescue-model fixture-rescue-v2 \
  --skip-smoke-test \
  --resume >/dev/null 2>&1; then
  echo "expected rescue-model change with accepted rescues to fail" >&2
  exit 1
fi
test "$(shasum -a 256 "$run_dir/accepted-rescue-parts.txt" | awk '{print $1}')" = "$accepted_rescue_sha"
test "$(shasum -a 256 "$run_dir/rescue/000/part_00.json" | awk '{print $1}')" = "$rescue_response_sha"
test "$(jq -r '.rescueModel' "$run_dir/run-config.json")" = "fixture-rescue"

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

if HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --rescue-model fixture-rescue \
  --rescue-output-tokens 5000 \
  --skip-smoke-test \
  --resume >/dev/null 2>&1; then
  echo "expected rescue-output-tokens change with accepted rescues to fail" >&2
  exit 1
fi
test "$(jq -r '.rescueOutputTokens' "$run_dir/run-config.json")" = "2400"
test "$(shasum -a 256 "$run_dir/accepted-rescue-parts.txt" | awk '{print $1}')" = "$accepted_rescue_sha"

HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --rescue-model fixture-rescue \
  --skip-smoke-test \
  --resume >/dev/null
test "$(jq -r '.rescueModel' "$run_dir/run-manifest.json")" = "fixture-rescue"
test ! -s "$run_dir/unresolved-parts.txt"
rg -n '^000/part_00$' "$run_dir/accepted-rescue-parts.txt" >/dev/null
rg -n '^000/part_01$' "$run_dir/accepted-rescue-parts.txt" >/dev/null
test "$(shasum -a 256 "$run_dir/rescue/000/part_00.json" | awk '{print $1}')" = "$rescue_response_sha"

for retry_response in "$run_dir/retry/000/part_00.json" "$run_dir/retry/000/part_01.json"; do
  jq '.text = "A valid retry response retained beside accepted rescue evidence."' \
    "$retry_response" > "$retry_response.tmp"
  mv "$retry_response.tmp" "$retry_response"
done
printf '{truncated accepted rescue\n' > "$run_dir/rescue/000/part_00.json"
HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test \
  --resume >/dev/null
test "$(jq -r '.rescueModel' "$run_dir/run-config.json")" = "fixture-rescue"
test "$(jq -r '.rescueModel' "$run_dir/run-manifest.json")" = "fixture-rescue"
if rg -n '^000/part_00$' "$run_dir/accepted-rescue-parts.txt" >/dev/null; then
  echo "expected invalid accepted rescue to fall back to the valid retry" >&2
  exit 1
fi
rg -n '^000/part_01$' "$run_dir/accepted-rescue-parts.txt" >/dev/null
rg -n 'A valid retry response retained beside accepted rescue evidence\.' "$run_dir/assembled-transcript-body.md" >/dev/null
for retry_response in "$run_dir/retry/000/part_00.json" "$run_dir/retry/000/part_01.json"; do
  jq '.text = ("Yeah " * 25)' "$retry_response" > "$retry_response.tmp"
  mv "$retry_response.tmp" "$retry_response"
done

rm "$run_dir/rescue/000/part_00.json"
HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --rescue-model fixture-rescue \
  --skip-smoke-test \
  --resume >/dev/null
test -f "$run_dir/rescue/000/part_00.json"
rg -n '^000/part_00$' "$run_dir/accepted-rescue-parts.txt" >/dev/null
rg -n '^000/part_01$' "$run_dir/accepted-rescue-parts.txt" >/dev/null
test ! -s "$run_dir/unresolved-parts.txt"

printf '{truncated accepted rescue\n' > "$run_dir/rescue/000/part_00.json"
if HOME="$managed_home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --rescue-model fixture-rescue \
  --skip-smoke-test \
  --resume >/dev/null 2>&1; then
  echo "expected resume with an invalid accepted rescue to fail" >&2
  exit 1
fi
test ! -e "$run_dir/accepted-rescue-parts.txt.tmp"
if rg -n '^000/part_00$' "$run_dir/accepted-rescue-parts.txt" >/dev/null; then
  echo "expected invalid accepted rescue to be removed from the accepted set" >&2
  exit 1
fi
rg -n '^000/part_01$' "$run_dir/accepted-rescue-parts.txt" >/dev/null
rg -n '^000/part_00$' "$run_dir/unresolved-parts.txt" >/dev/null

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
