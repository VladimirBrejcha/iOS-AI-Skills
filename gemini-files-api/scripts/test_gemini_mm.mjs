#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const wrapper = path.join(scriptDir, "gemini-mm.mjs");
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "gemini-mm-test-"));

async function waitForFile(file, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`wrapper exited before reaching generation: ${child.exitCode ?? child.signalCode}`);
    }
    try {
      await access(file);
      return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for fixture marker: ${file}`);
}

async function runSignalCase(signal, expectedExitCode) {
  const caseRoot = path.join(fixtureRoot, signal.toLowerCase());
  const fixtureScript = path.join(caseRoot, "scripts", "gemini-mm.mjs");
  const packageRoot = path.join(caseRoot, "scripts", "node_modules", "@google", "genai");
  const input = path.join(caseRoot, "fixture.m4a");
  const generationMarker = path.join(caseRoot, "generation-started");
  const deleteMarker = path.join(caseRoot, "upload-deleted");

  await mkdir(packageRoot, { recursive: true });
  await cp(wrapper, fixtureScript);
  await writeFile(input, "fixture audio");
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "@google/genai", type: "module", exports: "./index.js" }),
  );
  await writeFile(
    path.join(packageRoot, "index.js"),
    `import { writeFile } from "node:fs/promises";
export class GoogleGenAI {
  constructor() {
    this.files = {
      upload: async () => ({ name: "files/fixture", uri: "fixture://upload", state: "ACTIVE", mimeType: "audio/mp4" }),
      get: async () => ({ name: "files/fixture", uri: "fixture://upload", state: "ACTIVE", mimeType: "audio/mp4" }),
      delete: async () => { await writeFile(process.env.DELETE_MARKER, "deleted"); },
    };
    this.models = {
      generateContent: async () => {
        await writeFile(process.env.GENERATION_MARKER, "started");
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        return { text: "late response" };
      },
    };
  }
}
export const createPartFromUri = (uri, mimeType) => ({ fileData: { fileUri: uri, mimeType } });
export const createUserContent = (parts) => ({ role: "user", parts });
`,
  );

  const child = spawn(
    process.execPath,
    [fixtureScript, "--file", input, "--prompt", "fixture"],
    {
      env: {
        ...process.env,
        GEMINI_API_KEY: "fixture-key",
        GENERATION_MARKER: generationMarker,
        DELETE_MARKER: deleteMarker,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  await waitForFile(generationMarker, child);
  assert.equal(child.kill(signal), true);
  const result = await new Promise((resolve) => {
    child.once("close", (code, exitSignal) => resolve({ code, exitSignal }));
  });
  assert.deepEqual(result, { code: expectedExitCode, exitSignal: null }, stderr);
  await access(deleteMarker);
}

async function runCleanupFailureCase() {
  const caseRoot = path.join(fixtureRoot, "cleanup-failure");
  const fixtureScript = path.join(caseRoot, "scripts", "gemini-mm.mjs");
  const packageRoot = path.join(caseRoot, "scripts", "node_modules", "@google", "genai");
  const input = path.join(caseRoot, "fixture.m4a");

  await mkdir(packageRoot, { recursive: true });
  await cp(wrapper, fixtureScript);
  await writeFile(input, "fixture audio");
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "@google/genai", type: "module", exports: "./index.js" }),
  );
  await writeFile(
    path.join(packageRoot, "index.js"),
    `export class GoogleGenAI {
  constructor() {
    this.files = {
      upload: async () => ({ name: "files/fixture", uri: "fixture://upload", state: "ACTIVE", mimeType: "audio/mp4" }),
      get: async () => ({ name: "files/fixture", uri: "fixture://upload", state: "ACTIVE", mimeType: "audio/mp4" }),
      delete: async () => { throw new Error("permission denied"); },
    };
    this.models = {
      generateContent: async () => ({ text: "fixture response" }),
    };
  }
}
export const createPartFromUri = (uri, mimeType) => ({ fileData: { fileUri: uri, mimeType } });
export const createUserContent = (parts) => ({ role: "user", parts });
`,
  );

  const child = spawn(
    process.execPath,
    [fixtureScript, "--file", input, "--prompt", "fixture"],
    {
      env: { ...process.env, GEMINI_API_KEY: "fixture-key" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const result = await new Promise((resolve) => {
    child.once("close", (code, exitSignal) => resolve({ code, exitSignal }));
  });
  assert.deepEqual(result, { code: 1, exitSignal: null }, stderr);
  assert.match(
    stderr,
    /Failed to delete uploaded Gemini file files\/fixture: permission denied/,
  );
}

async function runMissingUploadStateCase() {
  const caseRoot = path.join(fixtureRoot, "missing-upload-state");
  const fixtureScript = path.join(caseRoot, "scripts", "gemini-mm.mjs");
  const packageRoot = path.join(caseRoot, "scripts", "node_modules", "@google", "genai");
  const input = path.join(caseRoot, "fixture.m4a");

  await mkdir(packageRoot, { recursive: true });
  await cp(wrapper, fixtureScript);
  await writeFile(input, "fixture audio");
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "@google/genai", type: "module", exports: "./index.js" }),
  );
  await writeFile(
    path.join(packageRoot, "index.js"),
    `let activeFileChecked = false;
export class GoogleGenAI {
  constructor() {
    this.files = {
      upload: async () => ({ name: "files/fixture", uri: "fixture://upload", mimeType: "audio/mp4" }),
      get: async () => {
        activeFileChecked = true;
        return { name: "files/fixture", uri: "fixture://upload", state: "ACTIVE", mimeType: "audio/mp4" };
      },
      delete: async () => {},
    };
    this.models = {
      generateContent: async () => {
        if (!activeFileChecked) throw new Error("generation started before upload state was checked");
        return { candidates: [{ content: { parts: [{ text: "fixture response" }] } }] };
      },
    };
  }
}
export const createPartFromUri = (uri, mimeType) => ({ fileData: { fileUri: uri, mimeType } });
export const createUserContent = (parts) => ({ role: "user", parts });
`,
  );

  const child = spawn(
    process.execPath,
    [fixtureScript, "--file", input, "--prompt", "fixture"],
    {
      env: { ...process.env, GEMINI_API_KEY: "fixture-key" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const result = await new Promise((resolve) => {
    child.once("close", (code, exitSignal) => resolve({ code, exitSignal }));
  });
  assert.deepEqual(result, { code: 0, exitSignal: null }, stderr);
  assert.equal(stdout, "fixture response\n");
}

async function runActivationTimeoutCase() {
  const caseRoot = path.join(fixtureRoot, "activation-timeout");
  const fixtureScript = path.join(caseRoot, "scripts", "gemini-mm.mjs");
  const packageRoot = path.join(caseRoot, "scripts", "node_modules", "@google", "genai");
  const input = path.join(caseRoot, "fixture.m4a");

  await mkdir(packageRoot, { recursive: true });
  await cp(wrapper, fixtureScript);
  await writeFile(input, "fixture audio");
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "@google/genai", type: "module", exports: "./index.js" }),
  );
  await writeFile(
    path.join(packageRoot, "index.js"),
    `export class GoogleGenAI {
  constructor() {
    this.files = {
      upload: async () => ({ name: "files/fixture", uri: "fixture://upload", state: "PROCESSING", mimeType: "audio/mp4" }),
      get: async () => ({ name: "files/fixture", uri: "fixture://upload", state: "PROCESSING", mimeType: "audio/mp4" }),
      delete: async () => {},
    };
    this.models = {
      generateContent: async () => ({ text: "unexpected response" }),
    };
  }
}
export const createPartFromUri = (uri, mimeType) => ({ fileData: { fileUri: uri, mimeType } });
export const createUserContent = (parts) => ({ role: "user", parts });
`,
  );

  const child = spawn(
    process.execPath,
    [fixtureScript, "--file", input, "--prompt", "fixture"],
    {
      env: {
        ...process.env,
        GEMINI_API_KEY: "fixture-key",
        GEMINI_FILE_ACTIVE_TIMEOUT_MS: "20",
        GEMINI_FILE_ACTIVE_POLL_MS: "5",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("configurable activation timeout was not honored"));
    }, 2_000);
    child.once("close", (code, exitSignal) => {
      clearTimeout(timer);
      resolve({ code, exitSignal });
    });
  });
  assert.deepEqual(result, { code: 1, exitSignal: null }, stderr);
  assert.match(stderr, /Timed out waiting for files\/fixture to become ACTIVE/);
}

try {
  await runSignalCase("SIGINT", 130);
  await runSignalCase("SIGTERM", 143);
  await runCleanupFailureCase();
  await runMissingUploadStateCase();
  await runActivationTimeoutCase();
  process.stdout.write("gemini files cleanup test ok\n");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
