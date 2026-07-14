---
name: gemini-files-api
description: Use Google Gemini through a managed Files API wrapper for multimodal local files, configurable generation parameters, structured JSON output, optional Gemini tools, and reproducible authentication setup.
---

# Gemini Files API

## Purpose

Provide one managed wrapper for Gemini requests that need local audio, video,
images, PDFs, or other supported files. This repository owns the wrapper source;
installed Codex, OpenCode, Claude Code, and repo-local copies are consumer views.

## Setup

Install dependencies once after the skill is installed or updated:

```bash
scripts/bootstrap.sh
```

The wrapper requires Node.js 20 or newer. Authentication is resolved in this
order:

1. `GEMINI_API_KEY`;
2. `GOOGLE_API_KEY`;
3. the macOS Keychain service named by `GEMINI_KEYCHAIN_SERVICE`, defaulting to
   `gemini_api_key`.

Do not store API keys in this skill directory.

## Canonical Commands

Run a text-only smoke request:

```bash
node scripts/gemini-mm.mjs --prompt "Reply with exactly: OK"
```

Analyze a local file and return the response envelope used by dependent skills:

```bash
node scripts/gemini-mm.mjs \
  --file path/to/input.m4a \
  --prompt "Transcribe the spoken audio." \
  --json
```

Use `node scripts/gemini-mm.mjs --help` for model, sampling, token, schema,
tool, upload-retention, and file options.

## Packaging Rules

- `node_modules` is never committed or copied as source.
- `scripts/package-lock.json` is the reviewed dependency pin.
- `scripts/bootstrap.sh` recreates dependencies with `npm ci --ignore-scripts` so reviewed packages cannot execute lifecycle scripts during setup.
- Uploaded Gemini Files API objects are deleted after each run unless
  `--keep-files` is explicitly passed.
- `node scripts/test_gemini_mm.mjs` verifies that SIGINT and SIGTERM wait for
  uploaded-file cleanup before the wrapper exits.
- Consumer copies must be refreshed through the pinned skills manager; do not
  edit installed copies by hand.

## Dependent Skills

`meeting-transcription` resolves this wrapper from the same repo-local skill
root or the reviewed global Codex/OpenCode and Claude Code manager roots. Install
both managed skills before running the canonical transcription command.
