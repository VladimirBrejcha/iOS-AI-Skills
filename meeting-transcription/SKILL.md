---
name: meeting-transcription
description: Transcribe long local meeting audio into a validated rough transcript with bounded chunking, repetition and output-limit detection, targeted retries, optional stronger-model rescue, and auditable token usage. Use when a user provides an audio recording or asks for reliable multilingual meeting transcription.
---

# Meeting Transcription

## Purpose

Turn long local meeting audio into a validated transcript body without treating a successful model response as proof of quality. This skill owns media preparation, transcription, outlier detection, retry/rescue, assembly, and usage evidence. Downstream business summaries, CRM changes, knowledge-base updates, and customer communication remain the consuming repository's responsibility.

## Dependencies

- `ffmpeg` and `ffprobe`
- `node`, `jq`, `rg`, and `shasum`
- A Gemini Files API wrapper compatible with the CLI contract below
- Gemini authentication configured outside this skill

The script resolves the Gemini wrapper from:

1. `GEMINI_MM`, when set;
2. `${HOME}/.agents/skills/gemini-files-api/scripts/gemini-mm.mjs`;
3. `${HOME}/.claude/skills/gemini-files-api/scripts/gemini-mm.mjs`;
4. `${HOME}/.codex/skills/gemini-files-api/scripts/gemini-mm.mjs` for legacy installs.

The bootstrap script follows the same root order and can be overridden with
`GEMINI_MM_BOOTSTRAP`.

The wrapper must support `--model`, `--temperature`, `--thinking-level`, `--max-output-tokens`, `--json`, `--prompt`, and `--file`, and return JSON containing `text` plus `usageMetadata`.

## Canonical Command

Run the bundled script from the installed skill directory:

```bash
scripts/transcribe_meeting_audio.sh \
  --input /absolute/path/to/meeting.m4a \
  --work-dir /tmp/meeting-transcription-account-date
```

Defaults:

- `gemini-3.1-flash-lite` primary model;
- `300` second primary chunks;
- `60` second retry chunks;
- original spoken language preserved;
- temperature `0` and minimal thinking;
- no persistent Gemini file retention.

Use `--prepare-only` to verify source metadata, hashing, and chunking without API calls. Use `--resume` after an interrupted run; chunk sets are reused only when their completion marker matches the files on disk. Add `--rescue-model <model>` only when one-minute retries still fail validation.

## Validation Contract

The primary response is suspect when it has:

- empty text or invalid JSON;
- output tokens at the configured cap;
- long generated runs of `I`, `Yeah`, or `uh`;
- the same substantial line repeated at least five times.

Only suspect five-minute chunks are split into one-minute retries. The script exits non-zero before assembly while any retry remains unresolved. A stronger rescue model may process only those unresolved one-minute pieces.

## Outputs

The work directory contains:

- `source-metadata.json` and `source.sha256`;
- `chunks/`, `raw/`, `retry/`, and optional `rescue/` evidence;
- `validation.tsv`, `retry-validation.tsv`, and `unresolved-parts.txt`;
- `accepted-rescue-parts.txt`, which limits assembly to rescue outputs accepted
  by the current validation pass;
- `assembled-transcript-body.md` with global chunk anchors;
- `usage.json` with modality token counts;
- `run-manifest.json` with source and output identity.

Pricing is intentionally not hardcoded. Compare `usage.json` with current first-party pricing when cost reporting is required.

## Evidence Rules

- Treat output as a rough AI transcript, not certified verbatim evidence.
- Preserve original languages; do not silently translate.
- Use generic speaker labels unless identity is grounded independently.
- Prefer `[unclear]`, `[inaudible]`, or `[overlapping speech]` over invented content.
- Keep raw audio, chunks, and API envelopes outside downstream repositories unless the user explicitly requests approved retention.
- Create temporary evidence with owner-only permissions and repair restrictive
  permissions before resuming an existing work tree.
- Reconcile names, numbers, dates, prices, and commitments against the source before downstream use.

## Completion Gate

- `unresolved-parts.txt` is empty.
- `validation.tsv` and retry/rescue reports were reviewed.
- `assembled-transcript-body.md`, `usage.json`, and `run-manifest.json` exist.
- `bash -n scripts/transcribe_meeting_audio.sh` passes.
- `scripts/test_transcribe_meeting_audio.sh` passes, including managed-root
  dependency discovery, interrupted-split recovery, and malformed-response
  retry coverage.
- A short spoken fixture passes the normal path and an injected
  repetition/output-limit fixture reaches the retry path.
