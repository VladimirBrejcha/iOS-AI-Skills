#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage:
  scripts/transcribe_meeting_audio.sh --input /absolute/path/meeting.m4a [options]

Options:
  --work-dir PATH            Temporary working directory. Default: /tmp/meeting-transcription-<audio-name>
  --model MODEL              Primary Gemini model. Default: gemini-3.1-flash-lite
  --rescue-model MODEL       Optional stronger model for unresolved one-minute retries.
  --chunk-seconds N          Primary chunk length. Default: 300
  --retry-seconds N          Retry chunk length. Default: 60
  --max-output-tokens N      Primary response cap. Default: 7000
  --retry-output-tokens N    Retry response cap. Default: 1800
  --rescue-output-tokens N   Rescue response cap. Default: 2400
  --resume                   Reuse valid outputs in an existing matching work directory.
  --prepare-only             Inspect and split audio without calling Gemini.
  --skip-bootstrap           Do not run the Gemini wrapper bootstrap script.
  --skip-smoke-test          Do not run the Gemini connectivity smoke test.
  --help                     Show this help.

The script writes temporary evidence and an assembled transcript body. It does not
create downstream business records or commit repository changes.
EOF
}

die() {
  echo "meeting-transcription: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

input=""
work_dir=""
model="${TRANSCRIPTION_MODEL:-gemini-3.1-flash-lite}"
rescue_model=""
chunk_seconds=300
retry_seconds=60
max_output_tokens=7000
retry_output_tokens=1800
rescue_output_tokens=2400
resume=0
prepare_only=0
skip_bootstrap=0
skip_smoke_test=0

while (($#)); do
  case "$1" in
    --input)
      test $# -ge 2 || die "--input requires a value"
      input="$2"
      shift 2
      ;;
    --work-dir)
      test $# -ge 2 || die "--work-dir requires a value"
      work_dir="$2"
      shift 2
      ;;
    --model)
      test $# -ge 2 || die "--model requires a value"
      model="$2"
      shift 2
      ;;
    --rescue-model)
      test $# -ge 2 || die "--rescue-model requires a value"
      rescue_model="$2"
      shift 2
      ;;
    --chunk-seconds)
      test $# -ge 2 || die "--chunk-seconds requires a value"
      chunk_seconds="$2"
      shift 2
      ;;
    --retry-seconds)
      test $# -ge 2 || die "--retry-seconds requires a value"
      retry_seconds="$2"
      shift 2
      ;;
    --max-output-tokens)
      test $# -ge 2 || die "--max-output-tokens requires a value"
      max_output_tokens="$2"
      shift 2
      ;;
    --retry-output-tokens)
      test $# -ge 2 || die "--retry-output-tokens requires a value"
      retry_output_tokens="$2"
      shift 2
      ;;
    --rescue-output-tokens)
      test $# -ge 2 || die "--rescue-output-tokens requires a value"
      rescue_output_tokens="$2"
      shift 2
      ;;
    --resume)
      resume=1
      shift
      ;;
    --prepare-only)
      prepare_only=1
      shift
      ;;
    --skip-bootstrap)
      skip_bootstrap=1
      shift
      ;;
    --skip-smoke-test)
      skip_smoke_test=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

test -n "$input" || die "--input is required"
test -f "$input" || die "input file does not exist: $input"

for value in "$chunk_seconds" "$retry_seconds" "$max_output_tokens" "$retry_output_tokens" "$rescue_output_tokens"; do
  case "$value" in
    ''|*[!0-9]*) die "numeric options must be positive integers" ;;
    0) die "numeric options must be greater than zero" ;;
  esac
done

require_command ffmpeg
require_command ffprobe
require_command jq
require_command node
require_command shasum

input_dir="$(cd "$(dirname "$input")" && pwd -P)"
input="$input_dir/$(basename "$input")"
base_name="$(basename "${input%.*}" | sed 's/[^A-Za-z0-9._-]/_/g; s/^_*//; s/_*$//')"
test -n "$base_name" || base_name="meeting"

if test -z "$work_dir"; then
  work_dir="/tmp/meeting-transcription-$base_name"
fi

while test "$work_dir" != "/" && test "${work_dir%/}" != "$work_dir"; do
  work_dir="${work_dir%/}"
done
while :; do
  normalized_work_dir="${work_dir//\/\.\//\/}"
  case "$normalized_work_dir" in
    /.) normalized_work_dir="/" ;;
    */.) normalized_work_dir="${normalized_work_dir%/.}" ;;
  esac
  test "$normalized_work_dir" != "$work_dir" || break
  work_dir="$normalized_work_dir"
done
test ! -L "$work_dir" || die "work directory must not be a symlink: $work_dir"
work_dir="$(node - "$work_dir" <<'NODE'
const fs = require('fs');
const path = require('path');

const suffix = [];
let existing = path.resolve(process.argv[2]);
while (!fs.existsSync(existing)) {
  const parent = path.dirname(existing);
  if (parent === existing) break;
  suffix.unshift(path.basename(existing));
  existing = parent;
}
process.stdout.write(path.join(fs.realpathSync(existing), ...suffix));
NODE
)"

for managed_state_file in \
  run-config.json source.sha256 source-metadata.json \
  validation.tsv suspect-chunks.txt retry-validation.tsv unresolved-parts.txt \
  accepted-rescue-parts.txt accepted-rescue-parts.txt.tmp \
  accepted-rescue-parts.txt.tmp.existing \
  rescue-requested-parts.txt rescue-current-parts.txt \
  rescue-validation.tsv still-unresolved-parts.txt \
  requested-still-unresolved-parts.txt accepted-still-unresolved-parts.txt \
  assembled-transcript-body.md usage.json run-manifest.json; do
  managed_state_path="$work_dir/$managed_state_file"
  if test -e "$managed_state_path" || test -L "$managed_state_path"; then
    test -f "$managed_state_path" && test ! -L "$managed_state_path" \
      || die "managed state path must be a regular file: $managed_state_path"
  fi
done

if test -d "$work_dir" && test "$(find "$work_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" != "" && test "$resume" -ne 1; then
  die "work directory is not empty; choose another path or pass --resume: $work_dir"
fi

sha256="$(shasum -a 256 "$input" | awk '{print $1}')"
config_tmp="$(mktemp "${TMPDIR:-/tmp}/meeting-transcription-run-config.XXXXXX")"
source_sha_tmp=""
source_metadata_tmp=""
trap 'rm -f "$config_tmp" "$source_sha_tmp" "$source_metadata_tmp"' EXIT
jq -n \
  --arg input "$input" \
  --arg sha256 "$sha256" \
  --arg model "$model" \
  --arg rescueModel "$rescue_model" \
  --argjson chunkSeconds "$chunk_seconds" \
  --argjson retrySeconds "$retry_seconds" \
  --argjson maxOutputTokens "$max_output_tokens" \
  --argjson retryOutputTokens "$retry_output_tokens" \
  --argjson rescueOutputTokens "$rescue_output_tokens" \
  '{input:$input,sha256:$sha256,model:$model,rescueModel:$rescueModel,chunkSeconds:$chunkSeconds,retrySeconds:$retrySeconds,maxOutputTokens:$maxOutputTokens,retryOutputTokens:$retryOutputTokens,rescueOutputTokens:$rescueOutputTokens}' \
  > "$config_tmp"

if test "$resume" -eq 1; then
  test -d "$work_dir" || die "--resume work directory does not exist: $work_dir"
  test -f "$work_dir/run-config.json" || die "--resume work directory is missing run-config.json: $work_dir"
  if ! cmp -s \
    <(jq -S 'del(.rescueModel, .rescueOutputTokens)' "$work_dir/run-config.json") \
    <(jq -S 'del(.rescueModel, .rescueOutputTokens)' "$config_tmp"); then
    die "--resume configuration does not match the existing run-config.json"
  fi
  if test -z "$rescue_model" && test -s "$work_dir/accepted-rescue-parts.txt"; then
    jq \
      --arg rescueModel "$(jq -r '.rescueModel // ""' "$work_dir/run-config.json")" \
      --argjson rescueOutputTokens "$(jq -r '.rescueOutputTokens' "$work_dir/run-config.json")" \
      '.rescueModel = $rescueModel | .rescueOutputTokens = $rescueOutputTokens' \
      "$config_tmp" > "$config_tmp.preserved-rescue"
    mv "$config_tmp.preserved-rescue" "$config_tmp"
  fi
  if test -n "$rescue_model" \
    && test -s "$work_dir/accepted-rescue-parts.txt" \
    && { test "$rescue_model" != "$(jq -r '.rescueModel // ""' "$work_dir/run-config.json")" \
      || test "$rescue_output_tokens" != "$(jq -r '.rescueOutputTokens' "$work_dir/run-config.json")"; }; then
    die "--resume cannot change --rescue-model or --rescue-output-tokens while reusing accepted rescue outputs"
  fi
fi

for managed_subdir in chunks raw text retry rescue; do
  test ! -L "$work_dir/$managed_subdir" \
    || die "managed work directory must not be a symlink: $work_dir/$managed_subdir"
done
for retry_dir in "$work_dir/retry"/*; do
  test ! -L "$retry_dir" \
    || die "retry shard directory must not be a symlink: $retry_dir"
done
for rescue_dir in "$work_dir/rescue"/*; do
  test ! -L "$rescue_dir" \
    || die "rescue shard directory must not be a symlink: $rescue_dir"
done

mkdir -p "$work_dir" "$work_dir/chunks" "$work_dir/raw" "$work_dir/text" "$work_dir/retry" "$work_dir/rescue"
chmod -R go-rwx "$work_dir"

source_sha_tmp="$(mktemp "$work_dir/.source.sha256.XXXXXX")"
source_metadata_tmp="$(mktemp "$work_dir/.source-metadata.json.XXXXXX")"
printf '%s\n' "$sha256" > "$source_sha_tmp"
ffprobe -v error \
  -show_entries format=filename,duration,size,bit_rate:format_tags=creation_time \
  -show_entries stream=codec_name,sample_rate,channels,channel_layout \
  -of json "$input" > "$source_metadata_tmp"

mv "$source_sha_tmp" "$work_dir/source.sha256"
mv "$source_metadata_tmp" "$work_dir/source-metadata.json"
mv "$config_tmp" "$work_dir/run-config.json"

chunks_complete="$work_dir/chunks/.complete"
recorded_chunk_count=""
actual_chunk_count="$(find "$work_dir/chunks" -maxdepth 1 -name 'chunk_*.m4a' | wc -l | tr -d ' ')"
test ! -L "$chunks_complete" \
  || die "completion marker must not be a symlink: $chunks_complete"
if test -f "$chunks_complete"; then
  recorded_chunk_count="$(cat "$chunks_complete")"
fi

chunk_set_complete=0
if test "$resume" -eq 1 \
  && test -n "$recorded_chunk_count" \
  && test "$recorded_chunk_count" = "$actual_chunk_count" \
  && test "$actual_chunk_count" -gt 0; then
  chunk_set_complete=1
  for ((chunk_index = 0; chunk_index < recorded_chunk_count; chunk_index += 1)); do
    expected_chunk="$(printf '%s/chunk_%03d.m4a' "$work_dir/chunks" "$chunk_index")"
    if test ! -f "$expected_chunk" || test -L "$expected_chunk"; then
      chunk_set_complete=0
      break
    fi
  done
fi

if test "$chunk_set_complete" -ne 1; then
  rm -f "$chunks_complete"
  rm -f "$work_dir/chunks"/chunk_*.m4a
  rm -rf "$work_dir/raw" "$work_dir/text" "$work_dir/retry" "$work_dir/rescue"
  mkdir -p "$work_dir/raw" "$work_dir/text" "$work_dir/retry" "$work_dir/rescue"
  rm -f \
    "$work_dir/validation.tsv" "$work_dir/suspect-chunks.txt" \
    "$work_dir/retry-validation.tsv" "$work_dir/unresolved-parts.txt" \
    "$work_dir/accepted-rescue-parts.txt" \
    "$work_dir/accepted-rescue-parts.txt.tmp" \
    "$work_dir/accepted-rescue-parts.txt.tmp.existing" \
    "$work_dir/rescue-requested-parts.txt" \
    "$work_dir/rescue-current-parts.txt" \
    "$work_dir/rescue-validation.tsv" \
    "$work_dir/still-unresolved-parts.txt" \
    "$work_dir/requested-still-unresolved-parts.txt" \
    "$work_dir/accepted-still-unresolved-parts.txt" \
    "$work_dir/assembled-transcript-body.md" \
    "$work_dir/usage.json" "$work_dir/run-manifest.json"
  ffmpeg -hide_banner -loglevel error -i "$input" \
    -ac 1 -ar 16000 -c:a aac -b:a 48k \
    -f segment -segment_time "$chunk_seconds" -reset_timestamps 1 \
    "$work_dir/chunks/chunk_%03d.m4a"
  actual_chunk_count="$(find "$work_dir/chunks" -maxdepth 1 -name 'chunk_*.m4a' | wc -l | tr -d ' ')"
  test "$actual_chunk_count" -gt 0 || die "audio split produced no chunks"
  printf '%s\n' "$actual_chunk_count" > "$chunks_complete"
fi

chunk_count="$actual_chunk_count"
test "$chunk_count" -gt 0 || die "audio split produced no chunks"

if test "$prepare_only" -eq 1; then
  echo "meeting-transcription: prepared $chunk_count chunks"
  echo "meeting-transcription: work directory: $work_dir"
  exit 0
fi

resolve_dependency_file() {
  relative_path="$1"
  explicit_path="$2"
  if test -n "$explicit_path"; then
    printf '%s\n' "$explicit_path"
    return
  fi

  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  for skill_root in \
    "$script_dir/../../gemini-files-api" \
    "$PWD/.agents/skills/gemini-files-api" \
    "$PWD/.claude/skills/gemini-files-api" \
    "$PWD/.codex/skills/gemini-files-api" \
    "${HOME}/.agents/skills/gemini-files-api" \
    "${HOME}/.claude/skills/gemini-files-api" \
    "${HOME}/.codex/skills/gemini-files-api"; do
    candidate="$skill_root/$relative_path"
    if test -f "$candidate"; then
      printf '%s\n' "$candidate"
      return
    fi
  done
}

wrapper="$(resolve_dependency_file scripts/gemini-mm.mjs "${GEMINI_MM:-}")"
bootstrap="$(resolve_dependency_file scripts/bootstrap.sh "${GEMINI_MM_BOOTSTRAP:-}")"
test -f "$wrapper" || die "Gemini wrapper not found: $wrapper"

if test "$skip_bootstrap" -ne 1; then
  test -f "$bootstrap" || die "Gemini bootstrap not found: $bootstrap"
  bash "$bootstrap"
fi

if test "$skip_smoke_test" -ne 1; then
  smoke="$(node "$wrapper" --model "$model" --prompt 'Reply with exactly: Gemini connection OK')"
  test "$smoke" = "Gemini connection OK" || die "Gemini smoke test returned unexpected output: $smoke"
fi

primary_prompt='Faithfully transcribe every audible spoken utterance in this audio. Preserve the original language (Mandarin Chinese, Taiwanese, English, or mixed language) and do not translate or summarize. Use generic speaker labels only when a change is reasonably clear. Add approximate timestamps at natural intervals. Mark uncertain words as [unclear] and inaudible spans as [inaudible]. Do not invent names, facts, or speech. If the audio is mostly silence or overlapping background conversation, state that briefly instead of fabricating a transcript.'
retry_prompt='Transcribe this short audio faithfully in its original spoken language. Preserve meaningful English, Chinese, Taiwanese, or mixed speech. Use generic speaker labels only when clear and add approximate timestamps. Do not translate or summarize. Do not repeat filler words more times than audibly spoken; if a span is repetitive, overlapping, or unclear, mark it [unclear] or [overlapping speech]. Never invent content.'

run_request() {
  request_model="$1"
  request_tokens="$2"
  request_prompt="$3"
  request_input="$4"
  request_output="$5"
  request_tmp="$(mktemp "$request_output.tmp.XXXXXX")"

  if ! node "$wrapper" \
    --model "$request_model" \
    --temperature 0 \
    --max-output-tokens "$request_tokens" \
    --json \
    --prompt "$request_prompt" \
    --file "$request_input" > "$request_tmp"; then
    rm -f "$request_tmp"
    die "Gemini request failed: $request_input"
  fi
  mv "$request_tmp" "$request_output"
}

for chunk in "$work_dir"/chunks/chunk_*.m4a; do
  chunk_name="$(basename "$chunk" .m4a)"
  output="$work_dir/raw/$chunk_name.json"
  test ! -L "$output" || die "cached response must not be a symlink: $output"
  if test "$resume" -eq 1 && test -f "$output"; then
    echo "meeting-transcription: reuse $chunk_name"
    continue
  fi
  echo "meeting-transcription: transcribe $chunk_name"
  run_request "$model" "$max_output_tokens" "$primary_prompt" "$chunk" "$output"
done

validate_json_dir() {
  validation_dir="$1"
  validation_limit="$2"
  validation_report="$3"
  validation_suspects="$4"
  validation_scope="${5:-all}"
  validation_scope_arg="${6:-0}"

  node - "$validation_dir" "$validation_limit" "$validation_report" "$validation_suspects" "$validation_scope" "$validation_scope_arg" <<'NODE'
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const limit = Number(process.argv[3]);
const reportPath = process.argv[4];
const suspectPath = process.argv[5];
const scope = process.argv[6];
const scopeArg = process.argv[7];
const knownPromptModalities = new Set(['AUDIO', 'TEXT']);
const isTokenCount = (value) => Number.isInteger(value) && value >= 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const rows = [];
const suspects = [];
let files = walk(root).filter((item) => item.endsWith('.json'));
if (scope === 'raw') {
  const expectedCount = Number(scopeArg);
  const expected = new Set(
    Array.from({ length: expectedCount }, (_, index) => `chunk_${String(index).padStart(3, '0')}.json`)
  );
  files = files.filter((file) => expected.has(path.relative(root, file).replace(/\\/g, '/')));
} else if (scope === 'retry') {
  const expected = new Set();
  const currentChunks = fs.readFileSync(scopeArg, 'utf8').split(/\n/).filter(Boolean);
  for (const chunkName of currentChunks) {
    if (!/^chunk_\d+$/.test(chunkName)) continue;
    const shard = chunkName.replace(/^chunk_/, '');
    const shardDir = path.join(root, shard);
    if (!fs.existsSync(shardDir)) continue;
    for (const entry of fs.readdirSync(shardDir, { withFileTypes: true })) {
      if (entry.isFile() && /^part_\d+\.m4a$/.test(entry.name)) {
        expected.add(`${shard}/${entry.name.replace(/\.m4a$/, '.json')}`);
      }
    }
  }
  files = files.filter((file) => expected.has(path.relative(root, file).replace(/\\/g, '/')));
} else if (scope === 'manifest') {
  const expected = new Set(
    fs.readFileSync(scopeArg, 'utf8')
      .split(/\n/)
      .filter((relative) => /^\d+\/part_\d+$/.test(relative))
      .map((relative) => `${relative}.json`)
  );
  files = files.filter((file) => expected.has(path.relative(root, file).replace(/\\/g, '/')));
}
for (const file of files.sort()) {
  const relative = path.relative(root, file).replace(/\\/g, '/');
  const reasons = [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    rows.push([relative, 0, 0, 'invalid_json'].join('\t'));
    suspects.push(relative.replace(/\.json$/, ''));
    continue;
  }

  const text = typeof data.text === 'string' ? data.text.trim() : '';
  const hasUsageMetadata = data.usageMetadata
    && typeof data.usageMetadata === 'object'
    && !Array.isArray(data.usageMetadata);
  const hasOutputTokens = hasUsageMetadata
    && isTokenCount(data.usageMetadata.candidatesTokenCount);
  const hasTotalTokens = hasUsageMetadata
    && isTokenCount(data.usageMetadata.totalTokenCount);
  const promptTokenDetails = hasUsageMetadata
    ? data.usageMetadata.promptTokensDetails
    : null;
  const hasPromptTokenDetails = Array.isArray(promptTokenDetails)
    && promptTokenDetails.length > 0;
  const hasValidPromptTokenDetails = hasPromptTokenDetails
    && promptTokenDetails.every((detail) => detail
      && typeof detail === 'object'
      && !Array.isArray(detail)
      && typeof detail.modality === 'string'
      && knownPromptModalities.has(detail.modality)
      && isTokenCount(detail.tokenCount));
  const hasAudioInputTokens = hasValidPromptTokenDetails
    && promptTokenDetails.some((detail) => detail.modality === 'AUDIO'
      && detail.tokenCount > 0);
  const outputTokens = hasOutputTokens ? data.usageMetadata.candidatesTokenCount : 0;
  const hasFinishReasons = Array.isArray(data.candidates)
    && data.candidates.length > 0
    && data.candidates.every((candidate) => candidate
      && typeof candidate === 'object'
      && !Array.isArray(candidate)
      && typeof candidate.finishReason === 'string'
      && candidate.finishReason.length > 0);
  const finishReasons = hasFinishReasons
    ? data.candidates
      .map((candidate) => candidate.finishReason)
    : [];
  if (!text) reasons.push('empty_text');
  if (!hasUsageMetadata) reasons.push('missing_usage_metadata');
  if (hasUsageMetadata && !hasOutputTokens) reasons.push('missing_output_tokens');
  if (hasUsageMetadata && !hasTotalTokens) reasons.push('missing_total_tokens');
  if (hasUsageMetadata && !hasPromptTokenDetails) reasons.push('missing_prompt_token_details');
  if (hasPromptTokenDetails && !hasValidPromptTokenDetails) reasons.push('invalid_prompt_token_details');
  if (hasValidPromptTokenDetails && !hasAudioInputTokens) reasons.push('missing_audio_input_tokens');
  if (!hasFinishReasons) reasons.push('missing_finish_reasons');
  for (const finishReason of new Set(finishReasons)) {
    if (finishReason !== 'STOP') reasons.push(`finish_reason_${finishReason.toLowerCase()}`);
  }
  if (outputTokens >= limit - 4) reasons.push('output_limit');
  if (/(?:\bI\b[\s,.]*){12,}/i.test(text)) reasons.push('repeated_i');
  if (/(?:\bYeah\b[\s,.]*){20,}/i.test(text)) reasons.push('repeated_yeah');
  if (/(?:\buh\b[\s,.]*){20,}/i.test(text)) reasons.push('repeated_uh');

  const counts = new Map();
  for (const line of text.split(/\n+/)) {
    const normalized = line.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    if (normalized.length >= 30) counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  if ([...counts.values()].some((count) => count >= 5)) reasons.push('repeated_line');

  rows.push([relative, outputTokens, text.length, reasons.join(',') || 'ok'].join('\t'));
  if (reasons.length) suspects.push(relative.replace(/\.json$/, ''));
}

fs.writeFileSync(reportPath, `file\toutput_tokens\ttext_chars\tstatus\n${rows.join('\n')}\n`);
fs.writeFileSync(suspectPath, suspects.length ? `${suspects.join('\n')}\n` : '');
NODE
}

validate_json_dir "$work_dir/raw" "$max_output_tokens" "$work_dir/validation.tsv" "$work_dir/suspect-chunks.txt" raw "$chunk_count"

if test -s "$work_dir/suspect-chunks.txt"; then
  while IFS= read -r chunk_name; do
    test -n "$chunk_name" || continue
    retry_dir="$work_dir/retry/${chunk_name#chunk_}"
    test ! -L "$retry_dir" || die "retry shard directory must not be a symlink: $retry_dir"
    mkdir -p "$retry_dir"
    retry_complete="$retry_dir/.complete"
    recorded_retry_count=""
    actual_retry_count="$(find "$retry_dir" -maxdepth 1 -name 'part_*.m4a' | wc -l | tr -d ' ')"
    test ! -L "$retry_complete" \
      || die "completion marker must not be a symlink: $retry_complete"
    if test -f "$retry_complete"; then
      recorded_retry_count="$(cat "$retry_complete")"
    fi
    retry_set_complete=0
    case "$recorded_retry_count" in
      ''|*[!0-9]*) ;;
      *)
        if test "$resume" -eq 1 \
          && test "$recorded_retry_count" = "$actual_retry_count" \
          && test "$actual_retry_count" -gt 0; then
          retry_set_complete=1
          for ((retry_index = 0; retry_index < recorded_retry_count; retry_index += 1)); do
            expected_part="$(printf '%s/part_%02d.m4a' "$retry_dir" "$retry_index")"
            if test ! -f "$expected_part" || test -L "$expected_part"; then
              retry_set_complete=0
              break
            fi
          done
        fi
        ;;
    esac
    if test "$retry_set_complete" -ne 1; then
      rm -f "$retry_complete"
      rm -f "$retry_dir"/part_*.m4a "$retry_dir"/part_*.json
      ffmpeg -hide_banner -loglevel error -i "$work_dir/chunks/$chunk_name.m4a" \
        -c copy -f segment -segment_time "$retry_seconds" -reset_timestamps 1 \
        "$retry_dir/part_%02d.m4a"
      actual_retry_count="$(find "$retry_dir" -maxdepth 1 -name 'part_*.m4a' | wc -l | tr -d ' ')"
      test "$actual_retry_count" -gt 0 || die "retry split produced no chunks: $chunk_name"
      printf '%s\n' "$actual_retry_count" > "$retry_complete"
    fi
    for part in "$retry_dir"/part_*.m4a; do
      output="${part%.m4a}.json"
      test ! -L "$output" || die "cached response must not be a symlink: $output"
      if test "$resume" -eq 1 && test -f "$output"; then
        continue
      fi
      echo "meeting-transcription: retry ${part#"$work_dir/"}"
      run_request "$model" "$retry_output_tokens" "$retry_prompt" "$part" "$output"
    done
  done < "$work_dir/suspect-chunks.txt"

  validate_json_dir "$work_dir/retry" "$retry_output_tokens" "$work_dir/retry-validation.tsv" "$work_dir/unresolved-parts.txt" retry "$work_dir/suspect-chunks.txt"
else
  printf 'file\toutput_tokens\ttext_chars\tstatus\n' > "$work_dir/retry-validation.tsv"
  : > "$work_dir/unresolved-parts.txt"
fi

accepted_rescue_parts="$work_dir/accepted-rescue-parts.txt"
accepted_rescue_parts_tmp="$work_dir/accepted-rescue-parts.txt.tmp"
if test "$resume" -eq 1 && test -s "$accepted_rescue_parts"; then
  sort -u "$accepted_rescue_parts" > "$accepted_rescue_parts_tmp"
  while IFS= read -r relative; do
    test -n "$relative" || continue
    if [[ "$relative" =~ ^[0-9]+/part_[0-9]+$ ]] \
      && test -f "$work_dir/rescue/$relative.json" \
      && test ! -L "$work_dir/rescue/$relative.json"; then
      printf '%s\n' "$relative"
    fi
  done < "$accepted_rescue_parts_tmp" > "$accepted_rescue_parts_tmp.existing"
  mv "$accepted_rescue_parts_tmp.existing" "$accepted_rescue_parts_tmp"
else
  : > "$accepted_rescue_parts_tmp"
  rm -rf "$work_dir/rescue"
fi
mkdir -p "$work_dir/rescue"

rescue_requested_parts="$work_dir/rescue-requested-parts.txt"
: > "$rescue_requested_parts"
if test -s "$work_dir/unresolved-parts.txt" && test -n "$rescue_model"; then
  comm -23 \
    <(sort -u "$work_dir/unresolved-parts.txt") \
    "$accepted_rescue_parts_tmp" \
    > "$rescue_requested_parts"
  while IFS= read -r relative; do
    test -n "$relative" || continue
    input_part="$work_dir/retry/$relative.m4a"
    output_part="$work_dir/rescue/$relative.json"
    mkdir -p "$(dirname "$output_part")"
    echo "meeting-transcription: rescue $relative with $rescue_model"
    run_request "$rescue_model" "$rescue_output_tokens" "$retry_prompt" "$input_part" "$output_part"
  done < "$rescue_requested_parts"
fi

rescue_current_parts="$work_dir/rescue-current-parts.txt"
sort -u -m \
  "$accepted_rescue_parts_tmp" \
  "$rescue_requested_parts" \
  > "$rescue_current_parts"
validate_json_dir \
  "$work_dir/rescue" \
  "$rescue_output_tokens" \
  "$work_dir/rescue-validation.tsv" \
  "$work_dir/still-unresolved-parts.txt" \
  manifest \
  "$rescue_current_parts"
comm -23 \
  "$rescue_current_parts" \
  <(sort -u "$work_dir/still-unresolved-parts.txt") \
  > "$accepted_rescue_parts"
comm -23 \
  <(sort -u "$work_dir/unresolved-parts.txt") \
  "$accepted_rescue_parts" \
  > "$work_dir/requested-still-unresolved-parts.txt"
mv "$work_dir/requested-still-unresolved-parts.txt" "$work_dir/unresolved-parts.txt"
rm -f "$accepted_rescue_parts_tmp"

if test -s "$work_dir/unresolved-parts.txt"; then
  echo "meeting-transcription: unresolved retry outliers:" >&2
  sed 's/^/  - /' "$work_dir/unresolved-parts.txt" >&2
  die "review or rerun these parts with --rescue-model before assembling the transcript"
fi

node - "$work_dir" "$chunk_seconds" "$retry_seconds" "$chunk_count" <<'NODE'
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const chunkSeconds = Number(process.argv[3]);
const retrySeconds = Number(process.argv[4]);
const chunkCount = Number(process.argv[5]);
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'source-metadata.json'), 'utf8'));
const parsedDuration = Number(metadata.format?.duration);
const duration = Number.isFinite(parsedDuration) && parsedDuration >= 0
  ? parsedDuration
  : chunkCount * chunkSeconds;
const suspects = new Set(
  fs.readFileSync(path.join(root, 'suspect-chunks.txt'), 'utf8').split(/\n/).filter(Boolean)
);
const acceptedRescues = new Set(
  fs.readFileSync(path.join(root, 'accepted-rescue-parts.txt'), 'utf8').split(/\n/).filter(Boolean)
);

function hms(value) {
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((item) => String(item).padStart(2, '0')).join(':');
}

function responseText(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return String(data.text || '').trim();
}

function compareRetryParts(left, right) {
  const leftMatch = left.match(/^part_(\d+)\.m4a$/);
  const rightMatch = right.match(/^part_(\d+)\.m4a$/);
  if (leftMatch && rightMatch) return Number(leftMatch[1]) - Number(rightMatch[1]);
  return left.localeCompare(right);
}

const output = [];
for (let index = 0; index < chunkCount; index += 1) {
  const number = String(index).padStart(3, '0');
  const chunkName = `chunk_${number}`;
  const start = index * chunkSeconds;
  const end = Math.min((index + 1) * chunkSeconds, duration);
  output.push(`## Chunk ${number} - ${hms(start)} to ${hms(end)}\n`);

  if (!suspects.has(chunkName)) {
    output.push(`${responseText(path.join(root, 'raw', `${chunkName}.json`))}\n`);
    continue;
  }

  const retryDir = path.join(root, 'retry', number);
  const parts = fs.readdirSync(retryDir)
    .filter((name) => /^part_\d+\.m4a$/.test(name))
    .sort(compareRetryParts);
  parts.forEach((part, partIndex) => {
    const stem = part.replace(/\.m4a$/, '');
    const rescue = path.join(root, 'rescue', number, `${stem}.json`);
    const retry = path.join(retryDir, `${stem}.json`);
    const selected = acceptedRescues.has(`${number}/${stem}`) ? rescue : retry;
    output.push(`### Retry part ${partIndex + 1} - ${hms(start + partIndex * retrySeconds)}\n\n${responseText(selected)}\n`);
  });
}

fs.writeFileSync(path.join(root, 'assembled-transcript-body.md'), output.join('\n'));
NODE

node - "$work_dir" "$chunk_count" <<'NODE'
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const chunkCount = Number(process.argv[3]);
const knownPromptModalities = new Set(['AUDIO', 'TEXT']);
const suspects = new Set(
  fs.readFileSync(path.join(root, 'suspect-chunks.txt'), 'utf8').split(/\n/).filter(Boolean)
);
const acceptedRescues = new Set(
  fs.readFileSync(path.join(root, 'accepted-rescue-parts.txt'), 'utf8').split(/\n/).filter(Boolean)
);

const responseFiles = [];
for (let index = 0; index < chunkCount; index += 1) {
  const number = String(index).padStart(3, '0');
  const chunkName = `chunk_${number}`;
  responseFiles.push(path.join(root, 'raw', `${chunkName}.json`));
  if (!suspects.has(chunkName)) continue;

  const retryDir = path.join(root, 'retry', number);
  const parts = fs.readdirSync(retryDir)
    .filter((name) => /^part_\d+\.m4a$/.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  for (const part of parts) {
    const stem = part.replace(/\.m4a$/, '');
    responseFiles.push(path.join(retryDir, `${stem}.json`));
    if (acceptedRescues.has(`${number}/${stem}`)) {
      responseFiles.push(path.join(root, 'rescue', number, `${stem}.json`));
    }
  }
}

const usage = {
  requests: 0,
  malformedResponses: 0,
  audioInputTokens: 0,
  textInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  byModel: {},
};
const isTokenCount = (value) => Number.isInteger(value) && value >= 0;

for (const file of responseFiles) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    usage.malformedResponses += 1;
    continue;
  }
  if (!data.usageMetadata
    || typeof data.usageMetadata !== 'object'
    || Array.isArray(data.usageMetadata)
    || !isTokenCount(data.usageMetadata.candidatesTokenCount)
    || !isTokenCount(data.usageMetadata.totalTokenCount)
    || !Array.isArray(data.usageMetadata.promptTokensDetails)
    || data.usageMetadata.promptTokensDetails.length === 0
    || data.usageMetadata.promptTokensDetails.some((detail) => !detail
      || typeof detail !== 'object'
      || Array.isArray(detail)
      || typeof detail.modality !== 'string'
      || !knownPromptModalities.has(detail.modality)
      || !isTokenCount(detail.tokenCount))
    || !data.usageMetadata.promptTokensDetails.some((detail) => detail.modality === 'AUDIO'
      && detail.tokenCount > 0)) {
    usage.malformedResponses += 1;
    continue;
  }
  const metadata = data.usageMetadata;
  const model = data.modelVersion || data.model || 'unknown';
  usage.requests += 1;
  usage.outputTokens += Number(metadata.candidatesTokenCount || 0);
  usage.totalTokens += Number(metadata.totalTokenCount || 0);
  usage.byModel[model] = (usage.byModel[model] || 0) + 1;
  for (const detail of metadata.promptTokensDetails) {
    if (detail.modality === 'AUDIO') usage.audioInputTokens += detail.tokenCount;
    if (detail.modality === 'TEXT') usage.textInputTokens += detail.tokenCount;
  }
}

fs.writeFileSync(path.join(root, 'usage.json'), `${JSON.stringify(usage, null, 2)}\n`);
NODE

generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
duration="$(jq -r '.format.duration // "unknown"' "$work_dir/source-metadata.json")"
jq -n \
  --arg generatedAt "$generated_at" \
  --arg input "$input" \
  --arg sha256 "$sha256" \
  --arg duration "$duration" \
  --arg model "$model" \
  --arg rescueModel "$(jq -r '.rescueModel // ""' "$work_dir/run-config.json")" \
  --arg workDir "$work_dir" \
  --arg transcriptBody "$work_dir/assembled-transcript-body.md" \
  --argjson chunkCount "$chunk_count" \
  --slurpfile usage "$work_dir/usage.json" \
  '{generatedAt:$generatedAt,input:$input,sha256:$sha256,durationSeconds:$duration,model:$model,rescueModel:$rescueModel,chunkCount:$chunkCount,workDir:$workDir,transcriptBody:$transcriptBody,usage:$usage[0]}' \
  > "$work_dir/run-manifest.json"

echo "meeting-transcription: complete"
echo "meeting-transcription: transcript body: $work_dir/assembled-transcript-body.md"
echo "meeting-transcription: validation: $work_dir/validation.tsv"
echo "meeting-transcription: usage: $work_dir/usage.json"
echo "meeting-transcription: manifest: $work_dir/run-manifest.json"
