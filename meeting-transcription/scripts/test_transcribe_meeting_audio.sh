#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/meeting-transcription/scripts/transcribe_meeting_audio.sh"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/meeting-transcription-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

audio="$tmp_dir/fixture.m4a"
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'sine=frequency=440:duration=5.2' \
  -c:a aac "$audio"

prepare_dir="$tmp_dir/prepare"
"$script" \
  --input "$audio" \
  --work-dir "$prepare_dir" \
  --chunk-seconds 2 \
  --prepare-only >/dev/null

initial_count="$(find "$prepare_dir/chunks" -maxdepth 1 -name 'chunk_*.m4a' | wc -l | tr -d ' ')"
test "$initial_count" -gt 1
test "$(cat "$prepare_dir/chunks/.complete")" = "$initial_count"

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

managed_root="$tmp_dir/home/.agents/skills/gemini-files-api/scripts"
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
  process.stdout.write('{malformed response\n');
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
HOME="$tmp_dir/home" "$script" \
  --input "$audio" \
  --work-dir "$run_dir" \
  --chunk-seconds 10 \
  --retry-seconds 2 \
  --skip-smoke-test >/dev/null

test -f "$FAKE_GEMINI_BOOTSTRAP_MARKER"
rg -n $'chunk_000.json\t0\t0\tinvalid_json' "$run_dir/validation.tsv" >/dev/null
test ! -s "$run_dir/unresolved-parts.txt"
rg -n 'Managed wrapper retry transcript' "$run_dir/assembled-transcript-body.md" >/dev/null
test "$(jq -r '.malformedResponses' "$run_dir/usage.json")" = "1"

echo "meeting transcription test ok"
