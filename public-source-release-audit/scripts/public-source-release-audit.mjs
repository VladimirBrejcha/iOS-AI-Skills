#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { auditPublicSafety, redactSensitivePath } from "./public-safety-audit-core.mjs";

const SCHEMA_VERSION = 1;
const MAX_OUTPUT_FINDINGS = 100;
const GITHUB_ACTIONS_APP_ID = 15368;
const FULL_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const IMMUTABLE_DOCKER_ACTION_PATTERN = /^docker:\/\/[^\s@]+(?:[:][^\s@]+)?@(?:sha256:[0-9a-f]{64}|sha512:[0-9a-f]{128})$/iu;
const WORKFLOW_PATH_PATTERN = /^\.github\/workflows\/[^/]+\.ya?ml$/iu;

main();

function main() {
  const argumentList = process.argv.slice(2);
  let options;
  try {
    options = parseArguments(argumentList);
  } catch (error) {
    reportRuntimeError(error, "usage-error", requestedOutputFormat(argumentList));
    return;
  }

  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  try {
    const repoRoot = resolveRepositoryRoot(options.repo);
    const sourceResult = auditPublicSafety({
      includeHistory: options.history,
      repoRoot,
    });
    const workflowFindings = auditWorkflowSources(repoRoot, {
      includeHistory: options.history,
    });
    const githubFindings = options.github || options.githubSnapshot
      ? auditGithubControls(loadGithubEvidence({
          repoRoot,
          repository: options.github,
          snapshotPath: options.githubSnapshot,
        }), options.requiredChecks)
      : [];
    const findings = uniqueSortedFindings([
      ...sourceResult.findings.map((finding) => ({ ...finding, severity: "error" })),
      ...workflowFindings,
      ...githubFindings,
    ]);

    if (sourceResult.omittedFindingCount > 0) {
      findings.push({
        message: "The source scanner omitted findings after its safe reporting limit.",
        ruleId: "source-findings-omitted",
        scope: "source",
        severity: "error",
      });
    }

    const errorCount = findings.filter((finding) => finding.severity === "error").length
      + sourceResult.omittedFindingCount;
    const warningCount = findings.filter((finding) => finding.severity === "warning").length;
    const findingCount = findings.length + sourceResult.omittedFindingCount;
    const omittedFindingCount = sourceResult.omittedFindingCount
      + Math.max(findings.length - MAX_OUTPUT_FINDINGS, 0);
    const reportedFindings = findings.slice(0, MAX_OUTPUT_FINDINGS);
    const passed = errorCount === 0 && (options.failOnWarning === false || warningCount === 0);
    const result = {
      errorCount,
      findingCount,
      findings: reportedFindings,
      githubChecked: Boolean(options.github || options.githubSnapshot),
      historyScanned: sourceResult.historyScanned,
      omittedFindingCount,
      passed,
      scannedHistoryCommitCount: sourceResult.scannedHistoryCommitCount,
      scannedTrackedFileCount: sourceResult.scannedTrackedFileCount,
      schemaVersion: SCHEMA_VERSION,
      warningCount,
    };

    printResult(result, options.format);
    if (passed === false) {
      process.exitCode = 1;
    }
  } catch (error) {
    reportRuntimeError(error, "audit-error", options.format);
  }
}

function requestedOutputFormat(args) {
  for (let index = args.length - 2; index >= 0; index -= 1) {
    if (args[index] === "--format" && args[index + 1] === "json") return "json";
  }
  return "text";
}

function parseArguments(args) {
  const options = {
    failOnWarning: false,
    format: "text",
    github: undefined,
    githubSnapshot: undefined,
    help: false,
    history: false,
    repo: ".",
    requiredChecks: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--history") {
      options.history = true;
    } else if (argument === "--fail-on-warning") {
      options.failOnWarning = true;
    } else if (["--repo", "--github", "--github-snapshot", "--required-check", "--format"].includes(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === "--repo") options.repo = value;
      if (argument === "--github") options.github = value;
      if (argument === "--github-snapshot") options.githubSnapshot = value;
      if (argument === "--required-check") options.requiredChecks.push(value);
      if (argument === "--format") options.format = value;
    } else {
      throw new Error(`Unsupported argument: ${argument ?? ""}`);
    }
  }

  if (options.github && options.githubSnapshot) {
    throw new Error("Use only one of --github or --github-snapshot.");
  }
  if (options.requiredChecks.length > 0 && !options.github && !options.githubSnapshot) {
    throw new Error("--required-check requires --github or --github-snapshot.");
  }
  if (!["json", "text"].includes(options.format)) {
    throw new Error("--format must be text or json.");
  }
  if (options.github && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(options.github)) {
    throw new Error("--github must use OWNER/REPO form.");
  }
  if (new Set(options.requiredChecks).size !== options.requiredChecks.length) {
    throw new Error("--required-check values must be unique.");
  }
  if (options.requiredChecks.some((value) => value.trim().length === 0)) {
    throw new Error("--required-check values must not be empty.");
  }

  return options;
}

function helpText() {
  return `Usage: public-source-release-audit [options]\n\nOptions:\n  --repo PATH                 Git repository to audit (default: .)\n  --history                   Audit all locally reachable refs and fail on shallow/grafted history\n  --github OWNER/REPO         Audit live GitHub repository controls with gh\n  --github-snapshot PATH      Audit a captured GitHub evidence fixture instead of the network\n  --required-check NAME       Require a strict GitHub Actions check with GitHub evidence; repeat as needed\n  --fail-on-warning           Treat workflow advisories as failures\n  --format text|json          Output format (default: text)\n  --help                      Show this help\n`;
}

function resolveRepositoryRoot(inputPath) {
  const candidate = path.resolve(inputPath);
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd: candidate });
  return result.stdout.trim();
}

function auditWorkflowSources(repoRoot, { includeHistory = false } = {}) {
  const entries = trackedWorkflowEntries(repoRoot, { includeHistory });
  const findings = [];

  for (const entry of entries) {
    if (entry.mode !== "100644" && entry.mode !== "100755") {
      findings.push(workflowFinding({
        message: "Workflow entrypoints must be regular tracked files.",
        path: entry.path,
        ruleId: "workflow-entrypoint-not-regular",
        severity: "error",
        source: entry.source,
      }));
      continue;
    }

    const blob = runCommand("git", ["cat-file", "blob", entry.objectId], {
      cwd: repoRoot,
      encoding: null,
    }).stdout;
    const text = blob.toString("utf8");
    if (Buffer.from(text, "utf8").equals(blob) === false) {
      findings.push(workflowFinding({
        message: "Workflow YAML must be valid UTF-8 for deterministic review.",
        path: entry.path,
        ruleId: "workflow-non-utf8",
        severity: "error",
        source: entry.source,
      }));
      continue;
    }

    findings.push(...auditWorkflowText(entry.path, text, entry.source));
  }

  return findings;
}

function trackedWorkflowEntries(repoRoot, { includeHistory = false } = {}) {
  const records = [];
  if (hasHead(repoRoot)) {
    if (includeHistory) {
      const refs = runCommand("git", ["for-each-ref", "--format=%(refname)"], {
        cwd: repoRoot,
      }).stdout.split(/\r?\n/u).filter(Boolean);
      const scannedTrees = new Set();
      for (const ref of refs) {
        const tree = resolveTreeObjectId(repoRoot, ref);
        if (!tree || scannedTrees.has(tree)) continue;
        scannedTrees.add(tree);
        records.push(...parseTreeRecords(runCommand(
          "git",
          ["ls-tree", "-r", "-z", "--full-tree", tree, "--", ".github/workflows"],
          { cwd: repoRoot, encoding: null },
        ).stdout).map((record) => ({ ...record, source: "history" })));
      }
    }
    records.push(...parseTreeRecords(runCommand("git", ["ls-tree", "-r", "-z", "--full-tree", "HEAD"], {
      cwd: repoRoot,
      encoding: null,
    }).stdout).map((record) => ({ ...record, source: "tracked-file" })));
  }
  records.push(...parseIndexRecords(runCommand("git", ["ls-files", "--stage", "-z"], {
    cwd: repoRoot,
    encoding: null,
  }).stdout).map((record) => ({ ...record, source: "tracked-file" })));

  const unique = new Map();
  for (const record of records) {
    if (WORKFLOW_PATH_PATTERN.test(record.path)) {
      const key = `${record.path}\0${record.objectId}\0${record.mode}`;
      if (unique.has(key) === false || record.source === "tracked-file") {
        unique.set(key, record);
      }
    }
  }
  return [...unique.values()].sort((left, right) => left.path.localeCompare(right.path) || left.objectId.localeCompare(right.objectId));
}

function resolveTreeObjectId(repoRoot, ref) {
  const result = spawnSync("git", ["rev-parse", "--verify", ref + "^{tree}"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: auditGitEnvironment(),
  });
  if (result.status !== 0) return undefined;
  const objectId = result.stdout.trim();
  return FULL_OBJECT_ID_PATTERN.test(objectId) ? objectId : undefined;
}

function parseTreeRecords(buffer) {
  return splitNulRecords(buffer).flatMap((record) => {
    const tab = record.indexOf("\t");
    if (tab < 0) return [];
    const [mode, type, objectId] = record.slice(0, tab).split(" ");
    const recordPath = record.slice(tab + 1);
    if (!mode || type !== "blob" || !FULL_OBJECT_ID_PATTERN.test(objectId ?? "") || !recordPath) return [];
    return [{ mode, objectId, path: recordPath }];
  });
}

function parseIndexRecords(buffer) {
  return splitNulRecords(buffer).flatMap((record) => {
    const tab = record.indexOf("\t");
    if (tab < 0) return [];
    const [mode, objectId, stage] = record.slice(0, tab).split(" ");
    const recordPath = record.slice(tab + 1);
    if (!mode || stage !== "0" || !FULL_OBJECT_ID_PATTERN.test(objectId ?? "") || !recordPath) return [];
    return [{ mode, objectId, path: recordPath }];
  });
}

function splitNulRecords(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

function hasHead(repoRoot) {
  return spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: repoRoot,
    env: auditGitEnvironment(),
    stdio: "ignore",
  }).status === 0;
}

function auditWorkflowText(workflowPath, text, source = "tracked-file") {
  const findings = [];
  const uncommented = text.split(/\r?\n/u).map(stripYamlComment).join("\n");
  const scalarAnchors = yamlScalarAnchors(uncommented);
  const hasPullRequestTarget = yamlKeyValues(uncommented, "on", { indentation: 0 })
    .some((value) => yamlValueContainsToken(
      resolveYamlScalarValue(value, scalarAnchors),
      "pull_request_target",
    ));
  const hasWriteAll = yamlKeyValues(uncommented, "permissions")
    .some((value) => resolveYamlScalarValue(value, scalarAnchors).toLowerCase() === "write-all");

  if (hasWriteAll) {
    findings.push(workflowFinding({
      message: "Public workflows must not grant write-all permissions.",
      path: workflowPath,
      ruleId: "workflow-write-all",
      severity: "error",
      source,
    }));
  }

  for (const runner of yamlKeyValues(uncommented, "runs-on")) {
    const resolvedRunner = resolveYamlScalarValue(runner, scalarAnchors);
    if (/(?:^|[\s,[{'"])self-hosted(?:$|[\s,\]}'"])/iu.test(resolvedRunner)) {
      findings.push(workflowFinding({
        message: "Public workflows must not select a persistent self-hosted runner.",
        path: workflowPath,
        ruleId: "workflow-self-hosted-runner",
        severity: "error",
        source,
      }));
    } else if (/\$\{\{|^\s*\*/u.test(resolvedRunner)
      || yamlValueContainsToken(resolvedRunner, "group")
      || !isKnownGithubHostedRunnerLabel(yamlScalarValue(resolvedRunner))) {
      findings.push(workflowFinding({
        message: "Dynamic or runner-group selection requires proof that it cannot resolve to self-hosted.",
        path: workflowPath,
        ruleId: "workflow-dynamic-runner",
        severity: "warning",
        source,
      }));
    }
  }

  if (hasPullRequestTarget) {
    findings.push(workflowFinding({
      message: "pull_request_target requires an explicit trusted-base and untrusted-head threat-model review.",
      path: workflowPath,
      ruleId: "workflow-pull-request-target",
      severity: "warning",
      source,
    }));

    if (hasUntrustedPullRequestCheckout(uncommented, scalarAnchors)) {
      findings.push(workflowFinding({
        message: "A privileged pull_request_target workflow must not execute an untrusted PR checkout.",
        path: workflowPath,
        ruleId: "workflow-privileged-untrusted-checkout",
        severity: "error",
        source,
      }));
    }
  }

  for (const actionRef of actionReferences(uncommented, scalarAnchors)) {
    if (actionRef.startsWith("./") || IMMUTABLE_DOCKER_ACTION_PATTERN.test(actionRef)) continue;
    const separator = actionRef.lastIndexOf("@");
    const revision = separator < 0 ? "" : actionRef.slice(separator + 1);
    if (actionRef.startsWith("docker://") || !FULL_OBJECT_ID_PATTERN.test(revision)) {
      findings.push(workflowFinding({
        message: "Remote workflow dependencies should use reviewed immutable object IDs.",
        path: workflowPath,
        ruleId: "workflow-mutable-action-ref",
        severity: "warning",
        source,
      }));
    }
  }

  return findings;
}

function stripYamlComment(line) {
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'" && !doubleQuoted) singleQuoted = !singleQuoted;
    if (character === '"' && !singleQuoted && line[index - 1] !== "\\") doubleQuoted = !doubleQuoted;
    if (character === "#" && !singleQuoted && !doubleQuoted && (index === 0 || /\s/u.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseYamlKeyLine(line) {
  const match = /^(\s*)(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([A-Za-z0-9_-]+))\s*:\s*(.*)$/u.exec(line);
  if (!match) return undefined;
  return {
    indentation: match[1].length,
    key: match[2] ?? match[3] ?? match[4],
    value: match[5],
  };
}

function yamlKeyValues(text, key, { indentation: requiredIndentation } = {}) {
  const values = yamlBlockMappingEntries(text)
    .filter((entry) => entry.key.toLowerCase() === key.toLowerCase()
      && (requiredIndentation === undefined || entry.indentation === requiredIndentation))
    .map((entry) => entry.value);
  const flowValues = requiredIndentation === 0
    ? yamlRootFlowMappingValues(text, key)
    : yamlFlowMappingValues(text, key);
  return [...values, ...flowValues];
}

function yamlBlockMappingEntries(text) {
  const lines = text.split("\n");
  const blockScalarBodyLines = yamlBlockScalarBodyLineIndexes(lines);
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (blockScalarBodyLines.has(index)) continue;
    const entry = parseYamlKeyLine(lines[index]);
    if (!entry) continue;
    let value = entry.value;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim().length === 0) continue;
      const nextIndentation = /^\s*/u.exec(line)[0].length;
      if (nextIndentation <= entry.indentation) break;
      value += " " + line.trim();
    }
    entries.push({ ...entry, value: value.trim() });
  }
  return entries;
}

function yamlBlockScalarBodyLineIndexes(lines) {
  const bodyLines = new Set();
  let scalarIndentation;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indentation = /^\s*/u.exec(line)[0].length;
    if (scalarIndentation !== undefined) {
      if (line.trim().length === 0 || indentation > scalarIndentation) {
        bodyLines.add(index);
        continue;
      }
      scalarIndentation = undefined;
    }
    const entry = parseYamlStructuralKeyLine(line);
    if (entry && isYamlBlockScalarHeader(entry.value)) {
      scalarIndentation = entry.indentation;
    }
  }
  return bodyLines;
}

function parseYamlStructuralKeyLine(line) {
  const directEntry = parseYamlKeyLine(line);
  if (directEntry) return directEntry;
  const sequenceItem = /^(\s*)-\s*(.*)$/u.exec(line);
  if (!sequenceItem) return undefined;
  return parseYamlKeyLine(" ".repeat(sequenceItem[1].length + 2) + sequenceItem[2]);
}

function isYamlBlockScalarHeader(value) {
  let normalized = value.trim();
  let property = /^(?:&[^\s]+|![^\s]+)\s+/u.exec(normalized);
  while (property) {
    normalized = normalized.slice(property[0].length);
    property = /^(?:&[^\s]+|![^\s]+)\s+/u.exec(normalized);
  }
  return /^[>|](?:[1-9]?[+-]?|[+-]?[1-9]?)?\s*$/u.test(normalized);
}

function maskYamlBlockScalarBodies(text) {
  const lines = text.split("\n");
  const bodyLines = yamlBlockScalarBodyLineIndexes(lines);
  return lines.map((line, index) => bodyLines.has(index) ? "" : line).join("\n");
}

function yamlScalarValue(value) {
  let normalized = value.trim();
  let property = /^(?:&[^\s]+|![^\s]+)\s+/u.exec(normalized);
  while (property) {
    normalized = normalized.slice(property[0].length);
    property = /^(?:&[^\s]+|![^\s]+)\s+/u.exec(normalized);
  }
  const blockScalar = /^[>|](?:[1-9]?[+-]?|[+-]?[1-9]?)?(?:\s+|$)([\s\S]*)$/u.exec(normalized);
  if (blockScalar) return blockScalar[1].trim();
  const quote = normalized[0];
  return (quote === "\"" || quote === "'") && normalized.at(-1) === quote
    ? normalized.slice(1, -1)
    : normalized;
}

function yamlScalarAnchors(text) {
  const anchors = new Map();
  const entries = [
    ...yamlBlockMappingEntries(text),
    ...maskYamlBlockScalarBodies(text).split("\n").flatMap((line) => {
      if (!/^(\s*)-\s*/u.test(line)) return [];
      const entry = parseYamlStructuralKeyLine(line);
      return entry ? [entry] : [];
    }),
    ...yamlFlowMappings(text).flat(),
  ];
  for (const entry of entries) {
    let value = entry.value.trim();
    while (/^![^\s]+\s+/u.test(value)) {
      value = value.replace(/^![^\s]+\s+/u, "");
    }
    const anchor = /^&([^\s]+)\s+([\s\S]*)$/u.exec(value);
    if (anchor) anchors.set(anchor[1], anchor[2].trim());
  }
  return anchors;
}

function resolveYamlScalarValue(value, anchors) {
  const visited = new Set();
  let currentValue = value;
  while (true) {
    const scalar = yamlScalarValue(currentValue);
    const alias = /^\*([^\s]+)$/u.exec(scalar);
    if (!alias || !anchors.has(alias[1]) || visited.has(alias[1])) return scalar;
    visited.add(alias[1]);
    currentValue = anchors.get(alias[1]);
  }
}

function isKnownGithubHostedRunnerLabel(value) {
  return /^(?:ubuntu-(?:slim|latest|\d{2}\.\d{2})(?:-arm)?|windows-(?:latest|\d{4}(?:-vs\d{4})?|\d{2}(?:-vs\d{4})?-arm)|macos-(?:latest|\d{2})(?:-(?:intel|large|xlarge))?|xcode-\d{2}(?:-xlarge)?)$/iu.test(value);
}

function yamlValueContainsToken(value, expectedToken) {
  return (value.match(/[A-Za-z0-9_-]+/gu) ?? [])
    .some((token) => token.toLowerCase() === expectedToken.toLowerCase());
}

function yamlFlowMappingValues(text, key) {
  return yamlFlowMappings(text)
    .flat()
    .filter((entry) => entry.key.toLowerCase() === key.toLowerCase())
    .map((entry) => entry.value);
}

function yamlFlowMappings(text) {
  text = maskYamlBlockScalarBodies(text);
  const mappings = [];
  let quote;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (quote === "'" && character === "'" && text[index + 1] === "'") {
        index += 1;
      } else if (quote === "\"" && character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }
    if (character !== "{" || !isYamlFlowMappingStart(text, index)) continue;
    mappings.push(yamlFlowMappingEntriesAt(text, index));
  }
  return mappings;
}

function yamlFlowMappingValue(value, key) {
  return yamlFlowMappingValues(value, key)[0];
}

function yamlRootFlowMappingValues(text, key) {
  const openingBraceIndex = text.search(/\S/u);
  if (openingBraceIndex < 0 || text[openingBraceIndex] !== "{") return [];
  return yamlFlowMappingEntriesAt(text, openingBraceIndex)
    .filter((entry) => entry.key.toLowerCase() === key.toLowerCase())
    .map((entry) => entry.value);
}

function yamlFlowMappingHasKey(value, key) {
  return yamlFlowMappingValues(value, key).length > 0;
}

function isYamlFlowMappingStart(text, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (/\s/u.test(text[cursor])) continue;
    return [":", ",", "[", "{", "-"].includes(text[cursor]);
  }
  return true;
}

function yamlFlowMappingEntriesAt(text, openingBraceIndex) {
  const entries = [];
  let cursor = openingBraceIndex + 1;
  while (cursor < text.length) {
    while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
    if (text[cursor] === "}") break;
    const keyResult = readYamlFlowKey(text, cursor);
    if (!keyResult) break;
    cursor = keyResult.nextIndex;
    while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
    if (text[cursor] !== ":") break;
    cursor += 1;
    const valueStart = cursor;
    let braces = 0;
    let brackets = 0;
    let quote;
    while (cursor < text.length) {
      const character = text[cursor];
      if (quote) {
        if (quote === "'" && character === "'" && text[cursor + 1] === "'") {
          cursor += 2;
          continue;
        }
        if (quote === "\"" && character === "\\") {
          cursor += 2;
          continue;
        }
        if (character === quote) quote = undefined;
        cursor += 1;
        continue;
      }
      if (character === "'" || character === "\"") {
        quote = character;
      } else if (character === "{") {
        braces += 1;
      } else if (character === "}") {
        if (braces === 0 && brackets === 0) break;
        braces -= 1;
      } else if (character === "[") {
        brackets += 1;
      } else if (character === "]") {
        brackets -= 1;
      } else if (character === "," && braces === 0 && brackets === 0) {
        break;
      }
      cursor += 1;
    }
    entries.push({
      key: keyResult.key,
      value: text.slice(valueStart, cursor).trim(),
    });
    if (text[cursor] === ",") {
      cursor += 1;
      continue;
    }
    break;
  }
  return entries;
}

function readYamlFlowKey(text, startIndex) {
  const quote = text[startIndex];
  if (quote === "'" || quote === "\"") {
    let cursor = startIndex + 1;
    while (cursor < text.length) {
      if (quote === "'" && text[cursor] === "'" && text[cursor + 1] === "'") {
        cursor += 2;
        continue;
      }
      if (quote === "\"" && text[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (text[cursor] === quote) {
        return {
          key: text.slice(startIndex + 1, cursor),
          nextIndex: cursor + 1,
        };
      }
      cursor += 1;
    }
    return undefined;
  }
  let cursor = startIndex;
  while (cursor < text.length && !/[:,{}]/u.test(text[cursor])) cursor += 1;
  const key = text.slice(startIndex, cursor).trim();
  return key.length > 0 ? { key, nextIndex: cursor } : undefined;
}

function hasUntrustedPullRequestCheckout(text, scalarAnchors) {
  text = maskYamlBlockScalarBodies(text);
  for (const entries of yamlFlowMappings(text)) {
    const usesEntry = entries.find((entry) => entry.key.toLowerCase() === "uses");
    const withEntry = entries.find((entry) => entry.key.toLowerCase() === "with");
    if (!usesEntry || !withEntry
      || !/^actions\/checkout@/iu.test(resolveYamlScalarValue(usesEntry.value, scalarAnchors))) {
      continue;
    }
    const refs = yamlFlowMappingValues(withEntry.value, "ref");
    if (refs.some((ref) => isUntrustedPullRequestRef(yamlScalarValue(ref)))) {
      return true;
    }
  }
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const sequenceItem = /^(\s*)-\s*(.*)$/u.exec(lines[index]);
    if (!sequenceItem) continue;
    const itemIndentation = sequenceItem[1].length;
    const flowUses = yamlFlowMappingValue(sequenceItem[2], "uses");
    if (flowUses && /^actions\/checkout@/iu.test(resolveYamlScalarValue(flowUses, scalarAnchors))
      && yamlFlowMappingHasKey(sequenceItem[2], "ref")
      && isUntrustedPullRequestRef(sequenceItem[2])) {
      return true;
    }
    const entries = [];
    if (sequenceItem[2].trim().length > 0) {
      const inlineEntry = parseYamlKeyLine(" ".repeat(itemIndentation + 2) + sequenceItem[2]);
      if (inlineEntry) entries.push(inlineEntry);
    }
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim().length === 0) continue;
      const indentation = /^\s*/u.exec(line)[0].length;
      if (indentation <= itemIndentation) break;
      const entry = parseYamlKeyLine(line);
      if (entry) entries.push(entry);
    }
    if (entries.length === 0) continue;
    const mappingIndentation = Math.min(...entries.map((entry) => entry.indentation));
    const usesEntry = entries.find((entry) => entry.indentation === mappingIndentation
      && entry.key.toLowerCase() === "uses");
    if (!usesEntry
      || !/^actions\/checkout@/iu.test(resolveYamlScalarValue(usesEntry.value, scalarAnchors))) continue;
    const withIndex = entries.findIndex((entry) => entry.indentation === mappingIndentation
      && entry.key.toLowerCase() === "with");
    if (withIndex < 0) continue;
    const withEntry = entries[withIndex];
    if (yamlValueContainsToken(withEntry.value, "ref") && isUntrustedPullRequestRef(withEntry.value)) {
      return true;
    }
    for (let entryIndex = withIndex + 1; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      if (entry.indentation <= mappingIndentation) break;
      if (entry.key.toLowerCase() === "ref" && isUntrustedPullRequestRef(entry.value)) {
        return true;
      }
    }
  }
  return false;
}

function isUntrustedPullRequestRef(value) {
  return /(?:github\.head_ref|pull_request\.(?:head|merge_commit_sha)|head\.sha|refs\/pull\/)/iu.test(value);
}

function actionReferences(text, scalarAnchors) {
  text = maskYamlBlockScalarBodies(text);
  return text.split("\n").flatMap((line) => {
    const sequenceItem = /^(\s*)-\s*(.*)$/u.exec(line);
    const flowReference = yamlFlowMappingValue(sequenceItem?.[2] ?? line.trim(), "uses");
    if (flowReference !== undefined) {
      return [resolveYamlScalarValue(flowReference, scalarAnchors)];
    }
    const candidate = sequenceItem
      ? " ".repeat(sequenceItem[1].length + 2) + sequenceItem[2]
      : line;
    const entry = parseYamlKeyLine(candidate);
    return entry?.key.toLowerCase() === "uses"
      ? [resolveYamlScalarValue(entry.value, scalarAnchors)]
      : [];
  });
}

function workflowFinding({ message, path: workflowPath, ruleId, severity, source = "tracked-file" }) {
  return {
    message,
    path: redactSensitivePath(workflowPath),
    ruleId,
    scope: "workflow",
    severity,
    source,
  };
}

function loadGithubEvidence({ repoRoot, repository, snapshotPath }) {
  if (snapshotPath) {
    const snapshot = JSON.parse(readFileSync(path.resolve(snapshotPath), "utf8"));
    return validateGithubEvidence(snapshot);
  }

  const repositoryData = ghApiJson(repoRoot, `repos/${repository}`);
  const rulesetSummaries = ghApiPaginatedArray(repoRoot, `repos/${repository}/rulesets?includes_parents=true&per_page=100`);
  const rulesets = rulesetSummaries.map((ruleset) => ghApiJson(repoRoot, `repos/${repository}/rulesets/${ruleset.id}`));
  const runners = ghApiJson(repoRoot, `repos/${repository}/actions/runners`);
  const defaultBranch = repositoryData.default_branch;
  const branchProtection = ghApiJson(
    repoRoot,
    `repos/${repository}/branches/${encodeURIComponent(defaultBranch)}/protection`,
    { allowNotFound: true },
  );

  return validateGithubEvidence({
    branchProtection,
    repository: repositoryData,
    rulesets,
    runners,
  });
}

function ghApiPaginatedArray(repoRoot, endpoint) {
  const result = spawnSync("gh", ["api", "--paginate", "--slurp", endpoint], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`GitHub evidence is unavailable for ${safeEndpointLabel(endpoint)}.`);
  }
  try {
    const pages = JSON.parse(result.stdout);
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
      throw new Error("GitHub returned non-array paginated evidence.");
    }
    return pages.flat();
  } catch {
    throw new Error(`GitHub returned invalid evidence for ${safeEndpointLabel(endpoint)}.`);
  }
}

function ghApiJson(repoRoot, endpoint, { allowNotFound = false } = {}) {
  const result = spawnSync("gh", ["api", endpoint], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (allowNotFound && /HTTP 404|"status"\s*:\s*"?404"?/iu.test(result.stderr ?? "")) return null;
    throw new Error(`GitHub evidence is unavailable for ${safeEndpointLabel(endpoint)}.`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`GitHub returned invalid evidence for ${safeEndpointLabel(endpoint)}.`);
  }
}

function safeEndpointLabel(endpoint) {
  return endpoint.replace(/[?#].*$/u, "").replace(/\/rulesets\/\d+$/u, "/rulesets/[id]");
}

function validateGithubEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") throw new Error("GitHub evidence must be an object.");
  if (!evidence.repository || typeof evidence.repository !== "object") throw new Error("GitHub evidence is missing repository metadata.");
  if (!Array.isArray(evidence.rulesets)) throw new Error("GitHub evidence is missing ruleset details.");
  if (!evidence.runners || typeof evidence.runners !== "object" || !Array.isArray(evidence.runners.runners)) {
    throw new Error("GitHub evidence is missing runner access details.");
  }
  return evidence;
}

function auditGithubControls(evidence, requiredChecks) {
  const findings = [];
  const repository = evidence.repository;
  const security = repository.security_and_analysis ?? {};
  const defaultBranch = repository.default_branch;

  if (repository.private !== false || repository.visibility !== "public") {
    findings.push(githubFinding("github-repository-not-public", "The audited GitHub repository is not confirmed public."));
  }
  if (security.secret_scanning?.status !== "enabled") {
    findings.push(githubFinding("github-secret-scanning-disabled", "GitHub secret scanning must be enabled."));
  }
  if (security.secret_scanning_push_protection?.status !== "enabled") {
    findings.push(githubFinding("github-push-protection-disabled", "GitHub push protection must be enabled."));
  }
  if (typeof defaultBranch !== "string" || defaultBranch.length === 0) {
    findings.push(githubFinding("github-default-branch-missing", "GitHub default-branch evidence is missing."));
    return findings;
  }

  const applicableRulesets = evidence.rulesets.filter((ruleset) => ruleset.enforcement === "active"
    && ruleset.target === "branch"
    && rulesetAppliesToDefaultBranch(ruleset, defaultBranch));
  const rules = applicableRulesets.flatMap((ruleset) => Array.isArray(ruleset.rules) ? ruleset.rules : []);
  const statusRules = rules.filter((rule) => rule.type === "required_status_checks");
  const rulesetChecks = statusRules.flatMap((rule) => rule.parameters?.required_status_checks ?? []);
  const classicChecks = classicStatusChecks(evidence.branchProtection);
  const requiredContexts = new Set([...rulesetChecks, ...classicChecks]
    .map((check) => check.context)
    .filter((context) => typeof context === "string"));
  const classic = evidence.branchProtection;
  const githubActionsContexts = new Set([
    ...rulesetChecks
      .filter((check) => check.integration_id === GITHUB_ACTIONS_APP_ID),
    ...classicChecks
      .filter((check) => check.app_id === GITHUB_ACTIONS_APP_ID),
  ].map((check) => check.context).filter((context) => typeof context === "string"));

  const strictStatusChecks = statusRules.some((rule) => rule.parameters?.strict_required_status_checks_policy === true)
    || classic?.required_status_checks?.strict === true;
  const forcePushProtected = rules.some((rule) => rule.type === "non_fast_forward")
    || classic?.allow_force_pushes?.enabled === false;
  const deletionProtected = rules.some((rule) => rule.type === "deletion")
    || classic?.allow_deletions?.enabled === false;
  const bypassActors = applicableRulesets.flatMap((ruleset) => ruleset.bypass_actors ?? []);

  if (requiredContexts.size === 0) {
    findings.push(githubFinding("github-required-check-missing", "The default branch has no required status check."));
  } else if (githubActionsContexts.size === 0) {
    findings.push(githubFinding("github-required-check-not-github-actions", "The default branch has no required check bound to GitHub Actions."));
  }
  for (const requiredCheck of requiredChecks) {
    if (!requiredContexts.has(requiredCheck)) {
      findings.push(githubFinding(
        "github-required-check-missing",
        `Required status check ${requiredCheck} is not enforced.`,
        requiredCheck,
      ));
    } else if (!githubActionsContexts.has(requiredCheck)) {
      findings.push(githubFinding(
        "github-required-check-not-github-actions",
        `Required status check ${requiredCheck} is not bound to GitHub Actions.`,
        requiredCheck,
      ));
    }
  }
  if (strictStatusChecks === false) {
    findings.push(githubFinding("github-required-check-not-strict", "Required checks must enforce an up-to-date default branch."));
  }
  if (forcePushProtected === false) {
    findings.push(githubFinding("github-force-push-unprotected", "The default branch must reject non-fast-forward updates."));
  }
  if (deletionProtected === false) {
    findings.push(githubFinding("github-deletion-unprotected", "The default branch must reject deletion."));
  }
  if (bypassActors.length > 0 || (classic && classic.enforce_admins?.enabled !== true)) {
    findings.push(githubFinding("github-protection-bypass", "Default-branch protection must not expose bypass actors."));
  }
  if (evidence.runners.total_count !== 0 || evidence.runners.runners.length !== 0) {
    findings.push(githubFinding("github-self-hosted-runner-access", "A public repository must not have an available self-hosted runner."));
  }

  return findings;
}

function classicStatusChecks(branchProtection) {
  const checks = [...(branchProtection?.required_status_checks?.checks ?? [])];
  const checksWithContexts = new Set(checks
    .map((check) => check.context)
    .filter((context) => typeof context === "string"));
  for (const context of branchProtection?.required_status_checks?.contexts ?? []) {
    if (typeof context === "string" && checksWithContexts.has(context) === false) {
      checks.push({ app_id: undefined, context });
    }
  }
  return checks;
}

function githubFinding(ruleId, message, check) {
  return {
    ...(check === undefined ? {} : { check }),
    message,
    ruleId,
    scope: "github",
    severity: "error",
  };
}

function rulesetAppliesToDefaultBranch(ruleset, defaultBranch) {
  const condition = ruleset.conditions?.ref_name;
  if (!condition) return true;
  const reference = `refs/heads/${defaultBranch}`;
  const includes = Array.isArray(condition.include) ? condition.include : [];
  const excludes = Array.isArray(condition.exclude) ? condition.exclude : [];
  const included = includes.length === 0 || includes.some((pattern) => refPatternMatches(pattern, reference, defaultBranch));
  const excluded = excludes.some((pattern) => refPatternMatches(pattern, reference, defaultBranch));
  return included && !excluded;
}

function refPatternMatches(pattern, reference, defaultBranch) {
  if (pattern === "~ALL" || pattern === "~DEFAULT_BRANCH") return true;
  if (pattern === defaultBranch || pattern === reference) return true;
  const expression = refGlobExpression(pattern);
  return new RegExp(expression, "u").test(reference) || new RegExp(expression, "u").test(defaultBranch);
}

function refGlobExpression(pattern) {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else if (character === "[") {
      const characterClass = refGlobCharacterClass(pattern, index);
      if (characterClass) {
        expression += characterClass.expression;
        index = characterClass.closingIndex;
      } else {
        expression += "\\[";
      }
    } else {
      expression += escapeRegExp(character);
    }
  }
  return expression + "$";
}

function refGlobCharacterClass(pattern, openingIndex) {
  let closingIndex = openingIndex + 1;
  if (pattern[closingIndex] === "]") closingIndex += 1;
  while (closingIndex < pattern.length && pattern[closingIndex] !== "]") closingIndex += 1;
  if (closingIndex >= pattern.length) return undefined;
  const content = pattern.slice(openingIndex + 1, closingIndex);
  if (content.length === 0) return undefined;
  let expression = "";
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\\" || character === "]" || character === "[" || character === "^") {
      expression += `\\${character}`;
    } else if (character === "-" && (index === 0 || index === content.length - 1
      || content.codePointAt(index - 1) > content.codePointAt(index + 1))) {
      expression += "\\-";
    } else {
      expression += character;
    }
  }
  return {
    closingIndex,
    expression: `(?=[^/])[${expression}]`,
  };
}

function uniqueSortedFindings(findings) {
  const unique = new Map();
  for (const finding of findings) {
    const key = [
      finding.severity,
      finding.scope,
      finding.ruleId,
      finding.commit ?? "",
      finding.path ?? "",
      finding.source ?? "",
      finding.check ?? "",
    ].join("\0");
    unique.set(key, finding);
  }
  const severityRank = { error: 0, warning: 1 };
  return [...unique.values()].sort((left, right) => {
    return severityRank[left.severity] - severityRank[right.severity]
      || left.scope.localeCompare(right.scope)
      || left.ruleId.localeCompare(right.ruleId)
      || (left.path ?? "").localeCompare(right.path ?? "")
      || (left.commit ?? "").localeCompare(right.commit ?? "")
      || (left.check ?? "").localeCompare(right.check ?? "");
  });
}

function printResult(result, format) {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const status = result.passed ? "passed" : "failed";
  process.stdout.write(`public-source release audit ${status}: ${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.scannedTrackedFileCount} tracked file(s), ${result.scannedHistoryCommitCount} history commit(s)\n`);
  for (const finding of result.findings) {
    const location = finding.path
      ? ` path:${displayTextValue(finding.path)}`
      : finding.commit
        ? ` commit:${displayTextValue(finding.commit)}`
        : finding.check
          ? ` check:${displayTextValue(finding.check)}`
          : "";
    process.stdout.write(`- [${finding.severity}] ${finding.ruleId} (${finding.scope})${location}\n`);
  }
  if (result.omittedFindingCount > 0) {
    process.stdout.write(`- ${result.omittedFindingCount} additional finding(s) omitted\n`);
  }
}

function reportRuntimeError(error, code, format) {
  const message = sanitizeMessage(error instanceof Error ? error.message : String(error));
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({
      error: { code, message },
      passed: false,
      schemaVersion: SCHEMA_VERSION,
    }, null, 2)}\n`);
  } else {
    process.stderr.write(`public-source release audit error: ${message}\n`);
  }
  process.exitCode = 2;
}

function sanitizeMessage(message) {
  return redactSensitivePath(message);
}

function displayTextValue(value) {
  return JSON.stringify(value).slice(1, -1);
}

function runCommand(command, args, { cwd, encoding = "utf8" }) {
  const result = spawnSync(command, args, {
    cwd,
    encoding,
    env: command === "git" ? auditGitEnvironment() : process.env,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} could not provide required audit evidence.`);
  }
  return result;
}

function auditGitEnvironment() {
  return {
    ...process.env,
    GIT_NO_REPLACE_OBJECTS: "1",
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
