#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  GoogleGenAI,
  createPartFromUri,
  createUserContent,
} from "@google/genai";

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const DEFAULT_KEYCHAIN_SERVICE =
  process.env.GEMINI_KEYCHAIN_SERVICE || "gemini_api_key";
const FILE_ACTIVE_TIMEOUT_MS = 60_000;
const FILE_ACTIVE_POLL_MS = 1_000;
const RETRY_ATTEMPTS = 3;
const INVOCATION_PATH = process.argv[1]
  ? path.resolve(process.argv[1])
  : "gemini-mm.mjs";

const MIME_TYPES = new Map([
  [".aac", "audio/aac"],
  [".csv", "text/csv"],
  [".flac", "audio/flac"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".m4a", "audio/mp4"],
  [".m4v", "video/x-m4v"],
  [".md", "text/markdown"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".txt", "text/plain"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
]);

function printUsage(exitCode = 0) {
  const usage = `Usage:
  node ${INVOCATION_PATH} --prompt "Describe this" [--file /abs/path]...
  node ${INVOCATION_PATH} --list-models

Options:
  --prompt, -p       Text prompt to send alongside the uploaded files.
  --file, -f         File to upload. Repeat for multiple files.
  --model, -m        Gemini model name. Default: ${DEFAULT_MODEL}
  --system           Optional system instruction.
  --config-file      Path to a JSON file merged into GenerateContent config.
  --schema-file      Path to a JSON Schema file used as responseJsonSchema.
  --temperature      Sampling temperature.
  --top-p            Top-p sampling value.
  --top-k            Top-k sampling value.
  --candidate-count  Number of candidates to request.
  --max-output-tokens  Max tokens in the response.
  --presence-penalty Presence penalty.
  --frequency-penalty  Frequency penalty.
  --seed             Deterministic seed hint.
  --stop-sequence    Stop sequence. Repeat to add multiple values.
  --response-mime-type  Ask Gemini for a specific response MIME type.
  --thinking-budget  Thinking budget in tokens. 0 disables, -1 auto.
  --thinking-level   minimal | low | medium | high
  --include-thoughts Include thought summaries when the model supports them.
  --tool             Enable a server-side tool. Repeatable:
                     google-search
                     google-search:web
                     google-search:image
                     google-search:web,image
                     code-execution
                     url-context
  --disable-tools    Clear tools, including tools supplied by --config-file.
  --show-tool-calls  Include server-side tool invocations in the response payload.
  --json             Emit structured JSON instead of plain text.
  --keep-files       Keep uploaded files in Gemini Files API instead of deleting them.
  --list-models      List available model names for the current API key.
  --help, -h         Show this help message.

Authentication:
  1. GEMINI_API_KEY environment variable
  2. GOOGLE_API_KEY environment variable
  3. macOS keychain service "${DEFAULT_KEYCHAIN_SERVICE}"
`;

  const output = exitCode === 0 ? process.stdout : process.stderr;
  output.write(usage);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const parsed = {
    files: [],
    configFile: "",
    responseSchemaFile: "",
    toolSpecs: [],
    disableTools: false,
    showToolCalls: false,
    json: false,
    keepFiles: false,
    listModels: false,
    model: DEFAULT_MODEL,
    prompt: "",
    system: "",
    temperature: undefined,
    topP: undefined,
    topK: undefined,
    candidateCount: undefined,
    maxOutputTokens: undefined,
    presencePenalty: undefined,
    frequencyPenalty: undefined,
    seed: undefined,
    stopSequences: [],
    responseMimeType: "",
    thinkingBudget: undefined,
    thinkingLevel: "",
    includeThoughts: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    switch (token) {
      case "--file":
      case "-f":
        index += 1;
        if (index >= argv.length) {
          throw new Error(`${token} requires a file path.`);
        }
        parsed.files.push(path.resolve(argv[index]));
        break;
      case "--help":
      case "-h":
        printUsage(0);
        break;
      case "--config-file":
        index += 1;
        if (index >= argv.length) {
          throw new Error(`${token} requires a file path.`);
        }
        parsed.configFile = path.resolve(argv[index]);
        break;
      case "--schema-file":
        index += 1;
        if (index >= argv.length) {
          throw new Error(`${token} requires a file path.`);
        }
        parsed.responseSchemaFile = path.resolve(argv[index]);
        break;
      case "--json":
        parsed.json = true;
        break;
      case "--keep-files":
        parsed.keepFiles = true;
        break;
      case "--disable-tools":
        parsed.disableTools = true;
        break;
      case "--show-tool-calls":
        parsed.showToolCalls = true;
        break;
      case "--include-thoughts":
        parsed.includeThoughts = true;
        break;
      case "--list-models":
        parsed.listModels = true;
        break;
      case "--model":
      case "-m":
        index += 1;
        if (index >= argv.length) {
          throw new Error(`${token} requires a model name.`);
        }
        parsed.model = argv[index];
        break;
      case "--prompt":
      case "-p":
        index += 1;
        if (index >= argv.length) {
          throw new Error(`${token} requires prompt text.`);
        }
        parsed.prompt = argv[index];
        break;
      case "--system":
        index += 1;
        if (index >= argv.length) {
          throw new Error(`${token} requires instruction text.`);
        }
        parsed.system = argv[index];
        break;
      case "--tool":
        index += 1;
        if (index >= argv.length) {
          throw new Error(`${token} requires a tool spec.`);
        }
        parsed.toolSpecs.push(argv[index]);
        break;
      case "--temperature":
        index += 1;
        parsed.temperature = parseNumberArg(token, argv, index);
        break;
      case "--top-p":
        index += 1;
        parsed.topP = parseNumberArg(token, argv, index);
        break;
      case "--top-k":
        index += 1;
        parsed.topK = parseIntegerArg(token, argv, index);
        break;
      case "--candidate-count":
        index += 1;
        parsed.candidateCount = parseIntegerArg(token, argv, index);
        break;
      case "--max-output-tokens":
        index += 1;
        parsed.maxOutputTokens = parseIntegerArg(token, argv, index);
        break;
      case "--presence-penalty":
        index += 1;
        parsed.presencePenalty = parseNumberArg(token, argv, index);
        break;
      case "--frequency-penalty":
        index += 1;
        parsed.frequencyPenalty = parseNumberArg(token, argv, index);
        break;
      case "--seed":
        index += 1;
        parsed.seed = parseIntegerArg(token, argv, index);
        break;
      case "--stop-sequence":
        index += 1;
        if (index >= argv.length) {
          throw new Error(`${token} requires a string value.`);
        }
        parsed.stopSequences.push(argv[index]);
        break;
      case "--response-mime-type":
        index += 1;
        if (index >= argv.length) {
          throw new Error(`${token} requires a MIME type.`);
        }
        parsed.responseMimeType = argv[index];
        break;
      case "--thinking-budget":
        index += 1;
        parsed.thinkingBudget = parseIntegerArg(token, argv, index);
        break;
      case "--thinking-level":
        index += 1;
        if (index >= argv.length) {
          throw new Error(`${token} requires a value.`);
        }
        parsed.thinkingLevel = normalizeThinkingLevel(argv[index]);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!parsed.listModels && parsed.prompt.length === 0) {
    throw new Error("A prompt is required unless --list-models is used.");
  }

  return parsed;
}

function parseNumberArg(flag, argv, index) {
  if (index >= argv.length) {
    throw new Error(`${flag} requires a numeric value.`);
  }

  const value = Number(argv[index]);
  if (!Number.isFinite(value)) {
    throw new Error(`${flag} expects a numeric value, got "${argv[index]}".`);
  }

  return value;
}

function parseIntegerArg(flag, argv, index) {
  const value = parseNumberArg(flag, argv, index);
  if (!Number.isInteger(value)) {
    throw new Error(`${flag} expects an integer, got "${argv[index]}".`);
  }

  return value;
}

function normalizeThinkingLevel(value) {
  const normalized = value.trim().toLowerCase();
  const allowed = new Set(["minimal", "low", "medium", "high"]);

  if (!allowed.has(normalized)) {
    throw new Error(
      `--thinking-level must be one of minimal, low, medium, high. Got "${value}".`,
    );
  }

  return normalized;
}

function keychainValue(service, account) {
  const args = ["find-generic-password", "-s", service, "-w"];
  if (account) {
    args.splice(1, 0, "-a", account);
  }

  return execFileSync("security", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function loadApiKey() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  if (process.env.GOOGLE_API_KEY) {
    return process.env.GOOGLE_API_KEY;
  }

  const service = DEFAULT_KEYCHAIN_SERVICE;
  const user = process.env.USER;

  try {
    if (user) {
      return keychainValue(service, user);
    }
  } catch {}

  try {
    return keychainValue(service);
  } catch {}

  throw new Error(
    [
      "Gemini API key not found.",
      `Set GEMINI_API_KEY or add a macOS keychain item named "${service}".`,
    ].join(" "),
  );
}

function guessMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES.get(extension);

  if (!mimeType) {
    throw new Error(
      `Unsupported file extension "${extension || "(none)"}" for ${filePath}.`,
    );
  }

  return mimeType;
}

async function ensureFileExists(filePath) {
  await access(filePath);
}

async function loadJsonFile(filePath, label) {
  await ensureFileExists(filePath);

  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown parse error";
    throw new Error(`Failed to parse ${label} JSON file ${filePath}: ${reason}`);
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label} file ${filePath} must contain a JSON object.`);
  }

  return parsed;
}

async function sleep(durationMs) {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function isRetryableError(error) {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return [
    "fetch failed",
    "429",
    "500",
    "502",
    "503",
    "504",
    "deadline exceeded",
    "econnreset",
    "etimedout",
    "resource exhausted",
    "temporarily unavailable",
  ].some((pattern) => message.includes(pattern));
}

async function withRetry(operation) {
  let attempt = 0;
  let lastError;

  while (attempt < RETRY_ATTEMPTS) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      attempt += 1;

      if (attempt >= RETRY_ATTEMPTS || !isRetryableError(error)) {
        throw error;
      }

      await sleep(attempt * 1_000);
    }
  }

  throw lastError;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(baseValue, overrideValue) {
  if (overrideValue === undefined) {
    return baseValue;
  }
  if (!isPlainObject(baseValue) || !isPlainObject(overrideValue)) {
    return overrideValue;
  }

  const merged = { ...baseValue };
  for (const [key, value] of Object.entries(overrideValue)) {
    merged[key] = deepMerge(merged[key], value);
  }
  return merged;
}

function parseToolSpec(spec) {
  const [name, modeRaw = ""] = spec.split(":", 2);
  const normalizedName = name.trim().toLowerCase();
  const mode = modeRaw.trim().toLowerCase();

  switch (normalizedName) {
    case "code-execution":
      return { codeExecution: {} };
    case "url-context":
      return { urlContext: {} };
    case "google-search": {
      if (!mode) {
        return { googleSearch: {} };
      }

      const requestedModes = new Set(
        mode
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      );

      const searchTypes = {};
      for (const requestedMode of requestedModes) {
        if (requestedMode === "web") {
          searchTypes.webSearch = {};
          continue;
        }
        if (requestedMode === "image") {
          searchTypes.imageSearch = {};
          continue;
        }
        throw new Error(
          `Unsupported google-search mode "${requestedMode}". Use web, image, or web,image.`,
        );
      }

      return { googleSearch: { searchTypes } };
    }
    default:
      throw new Error(
        `Unsupported tool "${spec}". Use google-search, code-execution, or url-context.`,
      );
  }
}

function compactObject(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => compactObject(entry))
      .filter((entry) => entry !== undefined);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  if (Object.keys(value).length === 0) {
    return {};
  }

  const compacted = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = compactObject(entry);
    if (normalized === undefined) {
      continue;
    }
    if (Array.isArray(normalized) && normalized.length === 0) {
      continue;
    }
    compacted[key] = normalized;
  }

  return Object.keys(compacted).length > 0 ? compacted : {};
}

async function buildRequestConfig(args) {
  let config = {};

  if (args.configFile) {
    config = deepMerge(config, await loadJsonFile(args.configFile, "config"));
  }

  if (args.responseSchemaFile) {
    config = deepMerge(config, {
      responseJsonSchema: await loadJsonFile(
        args.responseSchemaFile,
        "response schema",
      ),
    });
  }

  const overlay = {
    systemInstruction: args.system || undefined,
    temperature: args.temperature,
    topP: args.topP,
    topK: args.topK,
    candidateCount: args.candidateCount,
    maxOutputTokens: args.maxOutputTokens,
    presencePenalty: args.presencePenalty,
    frequencyPenalty: args.frequencyPenalty,
    seed: args.seed,
    stopSequences: args.stopSequences.length > 0 ? args.stopSequences : undefined,
    responseMimeType: args.responseMimeType || undefined,
    thinkingConfig:
      args.includeThoughts || args.thinkingBudget !== undefined || args.thinkingLevel
        ? compactObject({
            includeThoughts: args.includeThoughts || undefined,
            thinkingBudget: args.thinkingBudget,
            thinkingLevel: args.thinkingLevel
              ? args.thinkingLevel.toUpperCase()
              : undefined,
          })
        : undefined,
  };

  config = deepMerge(config, compactObject(overlay) ?? {});

  if (config.responseJsonSchema && !config.responseMimeType) {
    config.responseMimeType = "application/json";
  }

  if (args.disableTools) {
    config.tools = [];
  }

  if (args.toolSpecs.length > 0) {
    const cliTools = args.toolSpecs.map((toolSpec) => parseToolSpec(toolSpec));
    const baseTools = Array.isArray(config.tools) ? config.tools : [];
    config.tools = [...baseTools, ...cliTools];
  }

  if (args.showToolCalls) {
    config.toolConfig = deepMerge(config.toolConfig ?? {}, {
      includeServerSideToolInvocations: true,
    });
  }

  const normalizedConfig = compactObject(config);
  if (!normalizedConfig || Object.keys(normalizedConfig).length === 0) {
    return undefined;
  }

  return normalizedConfig;
}

function responseText(response) {
  return (
    response.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text)
      .filter(Boolean)
      .join("\n")
      .trim() ?? ""
  );
}

async function listModels(ai, jsonOutput) {
  const models = [];
  const pager = await ai.models.list();

  for await (const model of pager) {
    models.push({
      description: model.description ?? "",
      displayName: model.displayName ?? "",
      inputTokenLimit: model.inputTokenLimit ?? null,
      name: model.name ?? "",
      outputTokenLimit: model.outputTokenLimit ?? null,
      supportedActions: model.supportedActions ?? [],
    });
  }

  models.sort((left, right) => left.name.localeCompare(right.name));

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({ models }, null, 2)}\n`);
    return;
  }

  for (const model of models) {
    process.stdout.write(`${model.name}\n`);
  }
}

async function uploadFiles(ai, filePaths, uploads) {
  for (const filePath of filePaths) {
    await ensureFileExists(filePath);
    const mimeType = guessMimeType(filePath);
    const uploaded = await withRetry(() =>
      ai.files.upload({
        file: filePath,
        config: { mimeType },
      }),
    );

    const upload = {
      file: uploaded,
      localPath: filePath,
      mimeType: uploaded.mimeType || mimeType,
    };
    uploads.push(upload);
    upload.file = await waitForActiveFile(ai, uploaded);
  }
}

async function waitForActiveFile(ai, file) {
  if (!file.name) {
    return file;
  }

  const startedAt = Date.now();
  let current = file;

  while (
    current.state &&
    current.state !== "ACTIVE" &&
    current.state !== "FAILED"
  ) {
    if (Date.now() - startedAt > FILE_ACTIVE_TIMEOUT_MS) {
      throw new Error(
        `Timed out waiting for ${file.name} to become ACTIVE. Last state: ${current.state}.`,
      );
    }

    await sleep(FILE_ACTIVE_POLL_MS);
    current = await withRetry(() => ai.files.get({ name: file.name }));
  }

  if (current.state === "FAILED") {
    const errorMessage =
      current.error?.message || `File ${file.name} failed during processing.`;
    throw new Error(errorMessage);
  }

  return current;
}

async function cleanupUploads(ai, uploads) {
  for (const upload of uploads) {
    if (!upload.file.name) {
      continue;
    }

    try {
      await ai.files.delete({ name: upload.file.name });
    } catch {}
  }
}

async function analyze(ai, args) {
  const uploads = [];

  try {
    await uploadFiles(ai, args.files, uploads);

    const parts = [args.prompt];
    for (const upload of uploads) {
      parts.push(createPartFromUri(upload.file.uri, upload.mimeType));
    }

    const request = {
      model: args.model,
      contents: createUserContent(parts),
    };
    const requestConfig = await buildRequestConfig(args);
    if (requestConfig) {
      request.config = requestConfig;
    }

    const response = await withRetry(() => ai.models.generateContent(request));
    const text = responseText(response);

    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            model: args.model,
            prompt: args.prompt,
            requestConfig: request.config ?? null,
            text,
            uploadedFiles: uploads.map((upload) => ({
              localPath: upload.localPath,
              mimeType: upload.mimeType,
              name: upload.file.name ?? null,
              uri: upload.file.uri ?? null,
            })),
            responseId: response.responseId ?? null,
            modelVersion: response.modelVersion ?? null,
            promptFeedback: response.promptFeedback ?? null,
            candidates: response.candidates ?? null,
            usageMetadata: response.usageMetadata ?? null,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    process.stdout.write(`${text}\n`);
  } finally {
    if (!args.keepFiles) {
      await cleanupUploads(ai, uploads);
    }
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const apiKey = loadApiKey();
    const ai = new GoogleGenAI({ apiKey });

    if (args.listModels) {
      await listModels(ai, args.json);
      return;
    }

    await analyze(ai, args);
  } catch (error) {
    const message = formatErrorMessage(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

function formatErrorMessage(error) {
  const rawMessage =
    error instanceof Error ? error.message : "Unknown Gemini tool error.";

  const lowered = rawMessage.toLowerCase();
  if (lowered.includes("tool call context circulation is not enabled")) {
    return [
      rawMessage,
      "Hint: rerun without --show-tool-calls, or switch to a model/tier that supports server-side tool invocation visibility.",
    ].join("\n");
  }

  if (
    lowered.includes("quota exceeded") ||
    lowered.includes("resource_exhausted")
  ) {
    return [
      rawMessage,
      "Hint: wait for quota reset, switch to a lower-cost model such as models/gemini-2.5-flash, or upgrade the Gemini API plan.",
    ].join("\n");
  }

  if (lowered.includes("unsupported file extension")) {
    return [
      rawMessage,
      "Hint: convert the file to a supported type such as png, jpg, pdf, wav, mp3, mp4, mov, webm, txt, md, json, or csv.",
    ].join("\n");
  }

  return rawMessage;
}

await main();
