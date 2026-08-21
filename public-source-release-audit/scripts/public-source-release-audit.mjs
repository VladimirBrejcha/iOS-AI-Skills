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
const ACTION_MANIFEST_PATH_PATTERN = /(?:^|\/)action\.ya?ml$/u;
const DOCKERFILE_PATH_PATTERN = /(?:^|\/)(?:Dockerfile|[^/]+\.dockerfile)$/iu;
const PRIVILEGED_WORKFLOW_TRIGGERS = new Set([
  "discussion",
  "discussion_comment",
  "issue_comment",
  "issues",
  "pull_request_target",
  "workflow_run",
]);
const WORKFLOW_PATH_PATTERN = /^\.github\/workflows\/[^/]+\.ya?ml$/u;

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
  const actionSources = [];
  const dockerfileSources = [];
  const workflowSources = [];

  for (const entry of entries) {
    if (entry.mode !== "100644" && entry.mode !== "100755") {
      findings.push(workflowFinding({
        message: "Workflow, local-action, and Dockerfile entrypoints must be regular tracked files.",
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
        message: "Workflow, local-action, and Dockerfile sources must be valid UTF-8 for deterministic review.",
        path: entry.path,
        ruleId: "workflow-non-utf8",
        severity: "error",
        source: entry.source,
      }));
      continue;
    }

    const source = { ...entry, text };
    if (WORKFLOW_PATH_PATTERN.test(entry.path)) {
      workflowSources.push(source);
      findings.push(...auditWorkflowText(entry.path, text, entry.source));
    } else if (ACTION_MANIFEST_PATH_PATTERN.test(entry.path)) {
      actionSources.push(source);
    } else {
      dockerfileSources.push(source);
    }
  }

  findings.push(...auditPrivilegedReusableWorkflowCalls(workflowSources));
  findings.push(...auditLocalCompositeActions(
    workflowSources,
    actionSources,
    dockerfileSources,
  ));

  return findings;
}

function reusableWorkflowGraph(workflowSources) {
  const sourceBySnapshotPath = new Map(workflowSources.map((source) => [
    `${source.snapshot}\0${source.path}`,
    source,
  ]));
  const analysisBySource = new Map();
  const analysisFor = (source) => {
    if (analysisBySource.has(source)) return analysisBySource.get(source);
    const syntax = workflowSyntax(source.text);
    const analysis = {
      isReusable: syntax.triggerNames.some((name) => name.toLowerCase() === "workflow_call"),
      localCalls: localReusableWorkflowCalls(syntax.uncommented, syntax.scalarAnchors),
      privileged: hasPrivilegedWorkflowTrigger(syntax.triggerNames),
      syntax,
    };
    analysisBySource.set(source, analysis);
    return analysis;
  };
  const taintedOutputMemo = new Map();
  const taintedOutputsFor = (
    source,
    inheritedTaintedBindings,
    depth = 0,
    active = new Set(),
  ) => {
    const stateKey = [
      source.snapshot,
      source.path,
      ...[...inheritedTaintedBindings].sort(),
    ].join("\0");
    if (depth > 10 || active.has(stateKey)) return new Set();
    if (taintedOutputMemo.has(stateKey)) return taintedOutputMemo.get(stateKey);
    const analysis = analysisFor(source);
    if (!analysis.isReusable) return new Set();
    const nestedReturnedBindings = new Set();
    let changed;
    let iteration = 0;
    do {
      changed = false;
      iteration += 1;
      const callerTaintedBindings = mergeTaintedBindings(
        inheritedTaintedBindings,
        nestedReturnedBindings,
      );
      for (const call of analysis.localCalls) {
        const callee = sourceBySnapshotPath.get(
          `${source.snapshot}\0${call.workflowPath}`,
        );
        if (!callee || !analysisFor(callee).isReusable) continue;
        const calleeInputs = reusableCallTaintedBindings(call, callerTaintedBindings);
        const calleeOutputs = taintedOutputsFor(
          callee,
          calleeInputs,
          depth + 1,
          new Set([...active, stateKey]),
        );
        for (const outputName of calleeOutputs) {
          const binding = `needs.${call.jobGroup.jobName}.outputs.${outputName}`;
          if (nestedReturnedBindings.has(binding)) continue;
          nestedReturnedBindings.add(binding);
          changed = true;
        }
      }
    } while (changed && iteration <= 10);
    const effectiveTaintedBindings = mergeTaintedBindings(
      inheritedTaintedBindings,
      nestedReturnedBindings,
    );
    const outputEvaluationBindings = mergeTaintedBindings(
      effectiveTaintedBindings,
      workflowJobOutputTaintedBindings(
        analysis.syntax.uncommented,
        analysis.syntax.scalarAnchors,
        effectiveTaintedBindings,
      ),
    );
    const outputs = new Set(reusableWorkflowOutputBindings(
      analysis.syntax.uncommented,
      analysis.syntax.scalarAnchors,
    ).filter((binding) => isUntrustedReusableValue(
      binding.value,
      outputEvaluationBindings,
    )).map((binding) => binding.name));
    taintedOutputMemo.set(stateKey, outputs);
    return outputs;
  };
  const returnedBindingsFor = (source, inheritedTaintedBindings) => {
    const analysis = analysisFor(source);
    const returnedBindings = new Set();
    let changed;
    let iteration = 0;
    do {
      changed = false;
      iteration += 1;
      const callerTaintedBindings = mergeTaintedBindings(
        inheritedTaintedBindings,
        returnedBindings,
      );
      for (const call of analysis.localCalls) {
        const callee = sourceBySnapshotPath.get(`${source.snapshot}\0${call.workflowPath}`);
        if (!callee || !analysisFor(callee).isReusable) continue;
        const calleeInputs = reusableCallTaintedBindings(call, callerTaintedBindings);
        for (const outputName of taintedOutputsFor(callee, calleeInputs)) {
          const binding = `needs.${call.jobGroup.jobName}.outputs.${outputName}`;
          if (returnedBindings.has(binding)) continue;
          returnedBindings.add(binding);
          changed = true;
        }
      }
    } while (changed && iteration <= 10);
    return returnedBindings;
  };
  return { analysisFor, returnedBindingsFor, sourceBySnapshotPath };
}

function auditPrivilegedReusableWorkflowCalls(workflowSources) {
  const { analysisFor, returnedBindingsFor, sourceBySnapshotPath } = reusableWorkflowGraph(
    workflowSources,
  );
  const findings = [];
  for (const caller of workflowSources) {
    const callerAnalysis = analysisFor(caller);
    if (!callerAnalysis.privileged) continue;
    const returnedBindings = returnedBindingsFor(caller, new Set());
    if (hasUntrustedPullRequestCheckout(
      callerAnalysis.syntax.uncommented,
      callerAnalysis.syntax.scalarAnchors,
      returnedBindings,
    )) {
      findings.push(workflowFinding({
        message: "A privileged workflow must not execute an untrusted checkout returned through a reusable workflow output.",
        path: caller.path,
        ruleId: "workflow-privileged-untrusted-checkout",
        severity: "error",
        source: caller.source,
      }));
    }
    const pending = callerAnalysis.localCalls.map((call) => ({
      depth: 1,
      taintedBindings: reusableCallTaintedBindings(call, returnedBindings),
      workflowPath: call.workflowPath,
    }));
    const visited = new Set();
    while (pending.length > 0) {
      const { depth, taintedBindings, workflowPath } = pending.pop();
      const stateKey = `${workflowPath}\0${[...taintedBindings].sort().join("\0")}`;
      if (depth > 10 || visited.has(stateKey)) continue;
      visited.add(stateKey);
      const callee = sourceBySnapshotPath.get(`${caller.snapshot}\0${workflowPath}`);
      if (!callee) continue;
      const calleeAnalysis = analysisFor(callee);
      if (!calleeAnalysis.isReusable) continue;
      if (hasUntrustedPullRequestCheckout(
        calleeAnalysis.syntax.uncommented,
        calleeAnalysis.syntax.scalarAnchors,
        taintedBindings,
      )) {
        findings.push(workflowFinding({
          message: "A reusable workflow called from a privileged trigger must not execute an untrusted checkout.",
          path: callee.path,
          ruleId: "workflow-privileged-untrusted-checkout",
          severity: "error",
          source: callee.source,
        }));
      }
      if (hasUntrustedWorkflowArtifactExecution(
        calleeAnalysis.syntax.uncommented,
        calleeAnalysis.syntax.scalarAnchors,
        taintedBindings,
      )) {
        findings.push(workflowFinding({
          message: "A reusable workflow called from a privileged trigger must not execute untrusted workflow artifacts.",
          path: callee.path,
          ruleId: "workflow-privileged-untrusted-artifact-execution",
          severity: "error",
          source: callee.source,
        }));
      }
      pending.push(...calleeAnalysis.localCalls.map((nestedCall) => ({
        depth: depth + 1,
        taintedBindings: reusableCallTaintedBindings(nestedCall, taintedBindings),
        workflowPath: nestedCall.workflowPath,
      })));
    }
  }
  return findings;
}

function workflowExecutionStates(workflowSources) {
  const { analysisFor, returnedBindingsFor, sourceBySnapshotPath } = reusableWorkflowGraph(
    workflowSources,
  );
  const pending = workflowSources.map((workflow) => ({
    depth: 0,
    privileged: analysisFor(workflow).privileged,
    taintedBindings: new Set(),
    workflow,
  }));
  const states = [];
  const visited = new Set();
  while (pending.length > 0) {
    const state = pending.pop();
    const effectiveTaintedBindings = mergeTaintedBindings(
      state.taintedBindings,
      returnedBindingsFor(state.workflow, state.taintedBindings),
    );
    const stateKey = [
      state.workflow.snapshot,
      state.workflow.path,
      state.privileged ? "privileged" : "unprivileged",
      ...[...effectiveTaintedBindings].sort(),
    ].join("\0");
    if (state.depth > 10 || visited.has(stateKey)) continue;
    visited.add(stateKey);
    states.push({ ...state, taintedBindings: effectiveTaintedBindings });
    const analysis = analysisFor(state.workflow);
    for (const call of analysis.localCalls) {
      const callee = sourceBySnapshotPath.get(
        `${state.workflow.snapshot}\0${call.workflowPath}`,
      );
      if (!callee || !analysisFor(callee).isReusable) continue;
      pending.push({
        depth: state.depth + 1,
        privileged: state.privileged,
        taintedBindings: reusableCallTaintedBindings(call, effectiveTaintedBindings),
        workflow: callee,
      });
    }
  }
  return states;
}

function auditLocalCompositeActions(workflowSources, actionSources, dockerfileSources) {
  const actionBySnapshotPath = new Map(actionSources.map((source) => [
    `${source.snapshot}\0${source.path}`,
    source,
  ]));
  const dockerfileBySnapshotPath = new Map(dockerfileSources.map((source) => [
    `${source.snapshot}\0${source.path}`,
    source,
  ]));
  const analysisBySource = new Map();
  const analysisFor = (source) => {
    if (analysisBySource.has(source)) return analysisBySource.get(source);
    const syntax = workflowSyntax(source.text);
    const runGroups = workflowRootContainerGroups(
      syntax.uncommented,
      "runs",
      syntax.scalarAnchors,
    );
    const compositeRunGroups = runGroups.filter((group) => group.properties
      .filter(({ entry }) => entry.key.toLowerCase() === "using")
      .some(({ entry }) => resolveYamlScalarValue(
        entry.value,
        syntax.scalarAnchors,
      ).toLowerCase() === "composite"));
    const dockerRunGroups = runGroups.filter((group) => group.properties
      .filter(({ entry }) => entry.key.toLowerCase() === "using")
      .some(({ entry }) => resolveYamlScalarValue(
        entry.value,
        syntax.scalarAnchors,
      ).toLowerCase() === "docker"));
    const stepGroups = compositeRunGroups.flatMap((group) => mappingContainerStepPropertyGroups(
      group,
      syntax.scalarAnchors,
    ));
    const references = [
      ...stepGroups.flatMap((stepGroup) => stepGroup.properties
        .filter(({ entry }) => entry.key.toLowerCase() === "uses")
        .map(({ entry }) => resolveYamlScalarValue(entry.value, syntax.scalarAnchors))),
      ...dockerRunGroups.flatMap((group) => group.properties
        .filter(({ entry }) => entry.key.toLowerCase() === "image")
        .map(({ entry }) => resolveYamlScalarValue(entry.value, syntax.scalarAnchors))
        .filter((image) => image.startsWith("docker://"))),
    ];
    const dockerfilePaths = dockerRunGroups.flatMap((group) => group.properties
      .filter(({ entry }) => entry.key.toLowerCase() === "image")
      .map(({ entry }) => resolveYamlScalarValue(entry.value, syntax.scalarAnchors))
      .filter((image) => !image.startsWith("docker://"))
      .flatMap((image) => {
        const dockerfilePath = localDockerfilePath(source.path, image);
        return dockerfilePath ? [dockerfilePath] : [];
      }));
    const analysis = {
      dockerfilePaths,
      inputDefaultBindings: actionInputDefaultBindings(
        syntax.uncommented,
        syntax.scalarAnchors,
      ),
      references,
      stepGroups,
      syntax,
    };
    analysisBySource.set(source, analysis);
    return analysis;
  };
  const findings = [];
  for (const execution of workflowExecutionStates(workflowSources)) {
    const { privileged, taintedBindings: workflowTaintedBindings, workflow } = execution;
    const syntax = workflowSyntax(workflow.text);
    const resolveManifestPath = (reference) => localActionManifestPath(
      reference,
      (manifestPath) => actionBySnapshotPath.has(`${workflow.snapshot}\0${manifestPath}`),
    );
    const pending = workflowLocalActionCalls(
      syntax.uncommented,
      syntax.scalarAnchors,
      workflowTaintedBindings,
    ).flatMap((call) => {
      const manifestPath = resolveManifestPath(call.reference);
      return manifestPath ? [{ ...call, depth: 1, manifestPath }] : [];
    });
    const visited = new Set();
    while (pending.length > 0) {
      const { depth, manifestPath, providedBindings, taintedBindings } = pending.pop();
      if (depth > 10) continue;
      const action = actionBySnapshotPath.get(`${workflow.snapshot}\0${manifestPath}`);
      if (!action) continue;
      const analysis = analysisFor(action);
      const effectiveTaintedBindings = actionInputTaintedBindings(
        analysis.inputDefaultBindings,
        taintedBindings,
        providedBindings,
      );
      const stateKey = `${manifestPath}\0${[...effectiveTaintedBindings].sort().join("\0")}`;
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      for (const reference of analysis.references) {
        if (isMutableRemoteActionReference(reference)) {
          findings.push(workflowFinding({
            message: "Remote workflow dependencies should use reviewed immutable object IDs.",
            path: action.path,
            ruleId: "workflow-mutable-action-ref",
            severity: "warning",
            source: action.source,
          }));
        }
      }
      for (const dockerfilePath of analysis.dockerfilePaths) {
        const dockerfile = dockerfileBySnapshotPath.get(
          `${workflow.snapshot}\0${dockerfilePath}`,
        );
        if (!dockerfile) continue;
        if (dockerfileReferencedImages(dockerfile.text).some(isMutableDockerBaseImage)) {
          findings.push(workflowFinding({
            message: "Docker action image dependencies should use reviewed immutable digests.",
            path: dockerfile.path,
            ruleId: "workflow-mutable-action-ref",
            severity: "warning",
            source: dockerfile.source,
          }));
        }
      }
      pending.push(...compositeLocalActionCalls(
        analysis.stepGroups,
        analysis.syntax.scalarAnchors,
        effectiveTaintedBindings,
      ).flatMap((call) => {
        const nestedPath = resolveManifestPath(call.reference);
        return nestedPath ? [{
          ...call,
          depth: depth + 1,
          manifestPath: nestedPath,
        }] : [];
      }));
      const actionStepContexts = workflowStepTaintAnalysis(
        analysis.stepGroups,
        analysis.syntax.scalarAnchors,
        effectiveTaintedBindings,
      ).stepContexts;
      if (privileged && actionStepContexts.some(({ stepGroup, taintedBindings }) => (
        stepGroupHasUntrustedCheckout(
          stepGroup,
          analysis.syntax.scalarAnchors,
          taintedBindings,
        )
      ))) {
        findings.push(workflowFinding({
          message: "A local composite action called from a privileged workflow must not execute an untrusted checkout.",
          path: action.path,
          ruleId: "workflow-privileged-untrusted-checkout",
          severity: "error",
          source: action.source,
        }));
      }
      if (privileged && stepContextsHaveUntrustedArtifactExecution(
        actionStepContexts,
        analysis.syntax.scalarAnchors,
      )) {
        findings.push(workflowFinding({
          message: "A local composite action called from a privileged workflow must not execute untrusted workflow artifacts.",
          path: action.path,
          ruleId: "workflow-privileged-untrusted-artifact-execution",
          severity: "error",
          source: action.source,
        }));
      }
    }
  }
  return findings;
}

function localActionManifestPath(reference, manifestExists) {
  return localActionManifestCandidates(reference).find(manifestExists);
}

function localDockerfilePath(actionManifestPath, image) {
  if (!image || /\$\{\{/u.test(image) || path.posix.isAbsolute(image)) return undefined;
  const dockerfilePath = path.posix.normalize(path.posix.join(
    path.posix.dirname(actionManifestPath),
    image,
  ));
  if (dockerfilePath === ".." || dockerfilePath.startsWith("../")) return undefined;
  return DOCKERFILE_PATH_PATTERN.test(dockerfilePath) ? dockerfilePath : undefined;
}

function dockerfileReferencedImages(text) {
  const logicalLines = text
    .replace(/\r\n?|\u0085|\u2028|\u2029/gu, "\n")
    .replace(/\\\n[ \t]*/gu, " ")
    .split("\n");
  const baseImages = [];
  const stageNames = new Set();
  for (const line of logicalLines) {
    if (/^\s*#/u.test(line)) continue;
    const from = /^\s*FROM\s+(?:(?:--[^\s=]+=[^\s]+)\s+)*(\S+)(?:\s+AS\s+(\S+))?/iu.exec(line);
    if (!from) continue;
    baseImages.push(from[1]);
    if (from[2]) stageNames.add(from[2].toLowerCase());
  }
  const copyImages = logicalLines.flatMap((line) => {
    if (/^\s*#/u.test(line) || !/^\s*COPY\b/iu.test(line)) return [];
    const from = /(?:^|\s)--from=(?:"([^"]+)"|'([^']+)'|([^\s]+))/iu.exec(line);
    const image = from?.[1] ?? from?.[2] ?? from?.[3];
    if (!image || /^\d+$/u.test(image) || stageNames.has(image.toLowerCase())) return [];
    return [image];
  });
  return [...baseImages, ...copyImages];
}

function isMutableDockerBaseImage(image) {
  if (image.toLowerCase() === "scratch") return false;
  return !/@(?:sha256:[0-9a-f]{64}|sha512:[0-9a-f]{128})$/iu.test(image);
}

function actionInputDefaultBindings(text, scalarAnchors) {
  return workflowRootContainerGroups(text, "inputs", scalarAnchors)
    .flatMap((group) => group.properties.flatMap((inputProperty) => (
      workflowPropertyMappingEntries(group, inputProperty, scalarAnchors)
        .filter(({ entry }) => entry.key.toLowerCase() === "default")
        .map(({ entry }) => ({
          name: resolveYamlScalarValue(inputProperty.entry.key, scalarAnchors).toLowerCase(),
          namespace: "inputs",
          value: resolveYamlScalarValue(entry.value, scalarAnchors),
        }))
    )));
}

function actionInputTaintedBindings(defaultBindings, callerTaintedBindings, providedBindings) {
  const taintedBindings = new Set(callerTaintedBindings);
  const defaults = defaultBindings.filter((binding) => (
    !providedBindings.has(`${binding.namespace}.${binding.name}`)
  ));
  let changed;
  do {
    changed = false;
    for (const binding of defaults) {
      const name = `${binding.namespace}.${binding.name}`;
      if (!taintedBindings.has(name)
        && isUntrustedReusableValue(binding.value, taintedBindings)) {
        taintedBindings.add(name);
        changed = true;
      }
    }
  } while (changed);
  return taintedBindings;
}

function localActionManifestCandidates(reference) {
  if (!reference.startsWith("./") || /\$\{\{/u.test(reference)) return [];
  const actionPath = path.posix.normalize(reference.slice(2));
  if (actionPath === ".") return ["action.yml", "action.yaml"];
  if (actionPath.length === 0 || actionPath === ".."
    || actionPath.startsWith("../") || path.posix.isAbsolute(actionPath)) {
    return [];
  }
  if (ACTION_MANIFEST_PATH_PATTERN.test(actionPath)) return [actionPath];
  return [`${actionPath}/action.yml`, `${actionPath}/action.yaml`];
}

function isMutableRemoteActionReference(actionRef) {
  if (actionRef.startsWith("./") || IMMUTABLE_DOCKER_ACTION_PATTERN.test(actionRef)) return false;
  const separator = actionRef.lastIndexOf("@");
  const revision = separator < 0 ? "" : actionRef.slice(separator + 1);
  return actionRef.startsWith("docker://") || !FULL_OBJECT_ID_PATTERN.test(revision);
}

function localReusableWorkflowCalls(text, scalarAnchors) {
  const calls = [];
  const workflowEnvBindings = workflowRootMappingBindings(
    text,
    "env",
    "env",
    scalarAnchors,
  );
  const jobGroups = workflowJobPropertyGroups(text, scalarAnchors);
  for (const group of jobGroups) {
    const bindings = [
      ...workflowMappingBindings(group, "with", "inputs", scalarAnchors),
      ...workflowMappingBindings(group, "secrets", "secrets", scalarAnchors),
    ];
    const inheritSecrets = group.properties
      .filter(({ entry }) => entry.key.toLowerCase() === "secrets")
      .some(({ entry }) => resolveYamlScalarValue(
        entry.inlineValue ?? entry.value,
        scalarAnchors,
      ).toLowerCase() === "inherit");
    for (const { entry } of group.properties) {
      if (entry.key.toLowerCase() !== "uses") continue;
      const uses = resolveYamlScalarValue(entry.value, scalarAnchors);
      if (!/^\.\/\.github\/workflows\/[^/]+\.ya?ml$/u.test(uses)) continue;
      calls.push({
        bindings,
        inheritSecrets,
        jobGroup: group,
        jobGroups,
        scalarAnchors,
        workflowEnvBindings,
        workflowPath: uses.slice(2),
      });
    }
  }
  return calls;
}

function reusableWorkflowOutputBindings(text, scalarAnchors) {
  const bindings = [];
  for (const onGroup of workflowRootContainerGroups(text, "on", scalarAnchors)) {
    for (const workflowCallProperty of onGroup.properties) {
      if (workflowCallProperty.entry.key.toLowerCase() !== "workflow_call") continue;
      const workflowCallGroup = { ...onGroup, properties: [workflowCallProperty] };
      for (const outputsProperty of workflowPropertyMappingEntries(
        workflowCallGroup,
        workflowCallProperty,
        scalarAnchors,
      )) {
        if (outputsProperty.entry.key.toLowerCase() !== "outputs") continue;
        const outputsGroup = { ...onGroup, properties: [outputsProperty] };
        for (const outputProperty of workflowPropertyMappingEntries(
          outputsGroup,
          outputsProperty,
          scalarAnchors,
        )) {
          const outputName = resolveYamlScalarValue(
            outputProperty.entry.key,
            scalarAnchors,
          ).toLowerCase();
          const outputGroup = { ...onGroup, properties: [outputProperty] };
          for (const valueProperty of workflowPropertyMappingEntries(
            outputGroup,
            outputProperty,
            scalarAnchors,
          )) {
            if (valueProperty.entry.key.toLowerCase() !== "value") continue;
            bindings.push({
              name: outputName,
              value: resolveYamlScalarValue(valueProperty.entry.value, scalarAnchors),
            });
          }
        }
      }
    }
  }
  return bindings;
}

function workflowJobOutputTaintedBindings(text, scalarAnchors, inheritedTaintedBindings) {
  const jobGroups = workflowJobPropertyGroups(text, scalarAnchors);
  const contexts = workflowJobTaintContexts(
    jobGroups,
    workflowRootMappingBindings(text, "env", "env", scalarAnchors),
    scalarAnchors,
    inheritedTaintedBindings,
  );
  const taintedBindings = new Set();
  for (const group of jobGroups) {
    if (!group.jobName) continue;
    const jobTaintedBindings = contexts.get(group) ?? inheritedTaintedBindings;
    for (const binding of workflowMappingBindings(
      group,
      "outputs",
      `needs.${group.jobName}.outputs`,
      scalarAnchors,
    )) {
      if (!isUntrustedReusableValue(binding.value, jobTaintedBindings)) continue;
      taintedBindings.add(`${binding.namespace}.${binding.name}`);
      taintedBindings.add(`jobs.${group.jobName}.outputs.${binding.name}`);
    }
  }
  return taintedBindings;
}

function workflowMappingBindings(group, propertyName, namespace, scalarAnchors) {
  const bindings = [];
  for (const property of group.properties) {
    if (property.entry.key.toLowerCase() !== propertyName) continue;
    const mappingEntries = workflowPropertyMappingEntries(group, property, scalarAnchors);
    for (const { entry } of mappingEntries) {
      bindings.push({
        name: resolveYamlScalarValue(entry.key, scalarAnchors).toLowerCase(),
        namespace,
        value: resolveYamlScalarValue(entry.value, scalarAnchors),
      });
    }
  }
  return bindings;
}

function workflowPropertyMappingEntries(group, property, scalarAnchors) {
  const inlineValue = property.entry.inlineValue ?? property.entry.value;
  return [
    ...yamlDirectFlowMappingEntries(resolveYamlScalarValue(inlineValue, scalarAnchors))
      .map((entry) => ({ entry })),
    ...(property.children ?? (group.entries && property.index !== undefined
      ? directBlockMappingChildren(group.entries, property.index)
      : [])),
    ...yamlBlockAliasMappingEntries(
      inlineValue,
      group.blockNodeAnchors,
      scalarAnchors,
    ),
  ];
}

function workflowJobMatrixBindings(group, scalarAnchors) {
  const bindings = [];
  for (const strategyProperty of group.properties) {
    if (strategyProperty.entry.key.toLowerCase() !== "strategy") continue;
    for (const matrixProperty of workflowPropertyMappingEntries(
      group,
      strategyProperty,
      scalarAnchors,
    )) {
      const matrixKey = resolveYamlScalarValue(matrixProperty.entry.key, scalarAnchors);
      if (matrixKey.toLowerCase() !== "matrix") continue;
      const matrixGroup = {
        ...group,
        properties: [{
          ...matrixProperty,
          entry: { ...matrixProperty.entry, key: matrixKey },
        }],
      };
      const matrixEntries = workflowPropertyMappingEntries(
        matrixGroup,
        matrixGroup.properties[0],
        scalarAnchors,
      );
      if (matrixEntries.length === 0) {
        bindings.push({
          name: "*",
          namespace: "matrix",
          value: resolveYamlScalarValue(
            matrixProperty.entry.inlineValue ?? matrixProperty.entry.value,
            scalarAnchors,
          ),
        });
      }
      for (const matrixEntry of matrixEntries) {
        const name = resolveYamlScalarValue(matrixEntry.entry.key, scalarAnchors).toLowerCase();
        if (name === "include") {
          bindings.push(...workflowMatrixIncludeBindings(
            matrixGroup,
            matrixEntry,
            scalarAnchors,
          ));
        } else if (name !== "exclude") {
          bindings.push({
            name,
            namespace: "matrix",
            value: resolveYamlScalarValue(matrixEntry.entry.value, scalarAnchors),
          });
        }
      }
    }
  }
  return bindings;
}

function workflowMatrixIncludeBindings(matrixGroup, includeProperty, scalarAnchors) {
  const itemGroups = [];
  const inlineValue = includeProperty.entry.inlineValue ?? includeProperty.entry.value;
  const flowItems = yamlFlowSequenceValues(resolveYamlScalarValue(inlineValue, scalarAnchors));
  if (flowItems) {
    for (const item of flowItems) {
      const itemGroup = workflowStepPropertyGroupFromValue(item, matrixGroup, scalarAnchors);
      if (itemGroup) itemGroups.push(itemGroup);
    }
  }
  if (matrixGroup.entries && includeProperty.index !== undefined) {
    itemGroups.push(...workflowBlockStepPropertyGroups(
      matrixGroup,
      includeProperty.entry,
      scalarAnchors,
    ));
  }
  return itemGroups.flatMap((itemGroup) => itemGroup.properties.map(({ entry }) => ({
    name: resolveYamlScalarValue(entry.key, scalarAnchors).toLowerCase(),
    namespace: "matrix",
    value: resolveYamlScalarValue(entry.value, scalarAnchors),
  })));
}

function workflowRootMappingBindings(text, propertyName, namespace, scalarAnchors) {
  const entries = yamlBlockMappingEntries(text, scalarAnchors);
  const blockNodeAnchors = yamlBlockNodeAnchors(entries);
  const groups = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.indentation === 0 && entry.key.toLowerCase() === propertyName) {
      groups.push({ blockNodeAnchors, entries, properties: [{ entry, index }], text });
    }
  }
  for (const value of yamlRootFlowMappingValues(text, propertyName, scalarAnchors)) {
    groups.push({
      blockNodeAnchors,
      entries: undefined,
      properties: [{ entry: { key: propertyName, value } }],
      text,
    });
  }
  return groups.flatMap((group) => workflowMappingBindings(
    group,
    propertyName,
    namespace,
    scalarAnchors,
  ));
}

function reusableCallTaintedBindings(call, callerTaintedBindings) {
  const callSiteTaintedBindings = workflowJobTaintContexts(
    call.jobGroups,
    call.workflowEnvBindings,
    call.scalarAnchors,
    callerTaintedBindings,
  ).get(call.jobGroup) ?? new Set(callerTaintedBindings);
  const taintedBindings = new Set();
  for (const binding of call.bindings) {
    if (isUntrustedReusableValue(binding.value, callSiteTaintedBindings)) {
      taintedBindings.add(`${binding.namespace}.${binding.name}`);
    }
  }
  if (call.inheritSecrets) {
    for (const binding of callSiteTaintedBindings) {
      if (binding.startsWith("secrets.")) taintedBindings.add(binding);
    }
  }
  return taintedBindings;
}

function workflowJobTaintContexts(
  jobGroups,
  workflowEnvBindings,
  scalarAnchors,
  inheritedTaintedBindings,
) {
  return new Map([...workflowJobTaintAnalyses(
    jobGroups,
    workflowEnvBindings,
    scalarAnchors,
    inheritedTaintedBindings,
  )].map(([group, analysis]) => [group, analysis.taintedBindings]));
}

function workflowJobTaintAnalyses(
  jobGroups,
  workflowEnvBindings,
  scalarAnchors,
  inheritedTaintedBindings,
) {
  const workflowTaintedBindings = contextTaintedBindings(
    workflowEnvBindings,
    inheritedTaintedBindings,
  );
  const outputTaintedBindings = new Set();
  let changed;
  do {
    changed = false;
    const jobInheritedBindings = mergeTaintedBindings(
      workflowTaintedBindings,
      outputTaintedBindings,
    );
    for (const group of jobGroups) {
      if (!group.jobName) continue;
      const jobTaintedBindings = workflowJobTaintedBindings(
        group,
        scalarAnchors,
        jobInheritedBindings,
      );
      for (const binding of workflowMappingBindings(
        group,
        "outputs",
        `needs.${group.jobName}.outputs`,
        scalarAnchors,
      )) {
        const name = `${binding.namespace}.${binding.name}`;
        if (!outputTaintedBindings.has(name)
          && isUntrustedReusableValue(binding.value, jobTaintedBindings)) {
          outputTaintedBindings.add(name);
          changed = true;
        }
      }
    }
  } while (changed);

  const jobInheritedBindings = mergeTaintedBindings(
    workflowTaintedBindings,
    outputTaintedBindings,
  );
  return new Map(jobGroups.map((group) => [
    group,
    workflowJobTaintAnalysis(group, scalarAnchors, jobInheritedBindings),
  ]));
}

function workflowJobTaintedBindings(group, scalarAnchors, inheritedTaintedBindings) {
  return workflowJobTaintAnalysis(
    group,
    scalarAnchors,
    inheritedTaintedBindings,
  ).taintedBindings;
}

function workflowJobTaintAnalysis(group, scalarAnchors, inheritedTaintedBindings) {
  const jobTaintedBindings = contextTaintedBindings(
    workflowMappingBindings(group, "env", "env", scalarAnchors),
    inheritedTaintedBindings,
  );
  const matrixTaintedBindings = contextTaintedBindings(
    workflowJobMatrixBindings(group, scalarAnchors),
    jobTaintedBindings,
  );
  const stepAnalysis = workflowStepTaintAnalysis(
    mappingContainerStepPropertyGroups(group, scalarAnchors),
    scalarAnchors,
    matrixTaintedBindings,
  );
  return {
    stepContexts: stepAnalysis.stepContexts,
    taintedBindings: mergeTaintedBindings(
      matrixTaintedBindings,
      stepAnalysis.derivedTaintedBindings,
    ),
  };
}

function workflowStepTaintAnalysis(stepGroups, scalarAnchors, inheritedTaintedBindings) {
  const derivedTaintedBindings = new Set();
  const stepContexts = [];
  for (const stepGroup of stepGroups) {
    const accumulatedTaintedBindings = mergeTaintedBindings(
      inheritedTaintedBindings,
      derivedTaintedBindings,
    );
    const stepId = stepGroup.properties
      .filter(({ entry }) => entry.key.toLowerCase() === "id")
      .map(({ entry }) => resolveYamlScalarValue(entry.value, scalarAnchors).toLowerCase())
      .find(Boolean);
    const stepTaintedBindings = contextTaintedBindings(
      workflowMappingBindings(stepGroup, "env", "env", scalarAnchors),
      accumulatedTaintedBindings,
    );
    stepContexts.push({ stepGroup, taintedBindings: stepTaintedBindings });
    const runSources = stepGroup.properties
      .filter(({ entry }) => entry.key.toLowerCase() === "run")
      .map(({ entry }) => resolveYamlScalarValue(entry.value, scalarAnchors));
    for (const runSource of runSources) {
      for (const binding of githubEnvironmentWriteBindings(runSource, stepTaintedBindings)) {
        derivedTaintedBindings.add(`env.${binding}`);
      }
      if (shellRunTaintsFetchHead(runSource, stepTaintedBindings)) {
        derivedTaintedBindings.add("git.fetch_head");
      }
    }
    if (!stepId) continue;
    const outputSources = [
      ...runSources,
      ...workflowMappingBindings(stepGroup, "with", "with", scalarAnchors)
        .map((binding) => binding.value),
    ];
    if (outputSources.some((value) => isUntrustedReusableValue(
      value,
      stepTaintedBindings,
    ))) {
      derivedTaintedBindings.add(`steps.${stepId}.outputs.*`);
    }
  }
  return { derivedTaintedBindings, stepContexts };
}

function githubEnvironmentWriteBindings(runSource, taintedBindings) {
  const taintedEnvironmentVariables = new Set([...taintedBindings].flatMap((binding) => (
    binding.startsWith("env.") && binding !== "env.*"
      ? [binding.slice("env.".length).toLowerCase()]
      : []
  )));
  if (!isUntrustedReusableValue(runSource, taintedBindings)
    && !shellSourceReferencesTaintedVariable(
      runSource,
      taintedEnvironmentVariables,
      taintedBindings.has("env.*"),
    )) return [];
  const writeLines = runSource
    .replace(/\r\n?|\u0085|\u2028|\u2029/gu, "\n")
    .replace(/\\\n[ \t]*/gu, " ")
    .split("\n")
    .filter((line) => /GITHUB_ENV/iu.test(line)
      && /(?:>>?|\b(?:Add-Content|Out-File|Set-Content|tee)\b)/iu.test(line));
  if (writeLines.length === 0) return [];
  const names = new Set(writeLines.flatMap((line) => [
    ...line.matchAll(/(?:^|[\s"'`])([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|<<)/gu),
  ].map((match) => match[1].toLowerCase())));
  return names.size > 0 ? [...names] : ["*"];
}

function mergeTaintedBindings(...bindingSets) {
  return new Set(bindingSets.flatMap((bindings) => [...bindings]));
}

function workflowLocalActionCalls(text, scalarAnchors, inheritedTaintedBindings) {
  const jobGroups = workflowJobPropertyGroups(text, scalarAnchors);
  const analyses = workflowJobTaintAnalyses(
    jobGroups,
    workflowRootMappingBindings(text, "env", "env", scalarAnchors),
    scalarAnchors,
    inheritedTaintedBindings,
  );
  return jobGroups.flatMap((group) => (
    analyses.get(group)?.stepContexts ?? []
  ).flatMap(({ stepGroup, taintedBindings }) => localActionCallsFromStepGroup(
    stepGroup,
    scalarAnchors,
    taintedBindings,
  )));
}

function compositeLocalActionCalls(stepGroups, scalarAnchors, inheritedTaintedBindings) {
  return workflowStepTaintAnalysis(
    stepGroups,
    scalarAnchors,
    inheritedTaintedBindings,
  ).stepContexts.flatMap(({ stepGroup, taintedBindings }) => (
    localActionCallsFromStepGroup(stepGroup, scalarAnchors, taintedBindings)
  ));
}

function localActionCallsFromStepGroup(stepGroup, scalarAnchors, stepTaintedBindings) {
  const inputBindings = workflowMappingBindings(stepGroup, "with", "inputs", scalarAnchors);
  const providedBindings = new Set(inputBindings.map((binding) => (
    `${binding.namespace}.${binding.name}`
  )));
  const taintedBindings = new Set();
  for (const binding of inputBindings) {
    if (isUntrustedReusableValue(binding.value, stepTaintedBindings)) {
      taintedBindings.add(`${binding.namespace}.${binding.name}`);
    }
  }
  return stepGroup.properties
    .filter(({ entry }) => entry.key.toLowerCase() === "uses")
    .map(({ entry }) => resolveYamlScalarValue(entry.value, scalarAnchors))
    .filter((reference) => localActionManifestCandidates(reference).length > 0)
    .map((reference) => ({ providedBindings, reference, taintedBindings }));
}

function isUntrustedReusableValue(value, taintedBindings) {
  return isUntrustedPullRequestRef(value)
    || /(?:pull_request\.head\.repo|workflow_run\.head_repository)(?:\.|\b)/iu
      .test(normalizeExpressionPropertyAccess(value))
    || valueReferencesTaintedBinding(value, taintedBindings);
}

function valueReferencesTaintedBinding(value, taintedBindings) {
  for (const binding of taintedBindings) {
    if (binding.endsWith(".*")) {
      const pathPattern = binding.slice(0, -2).split(".")
        .map((segment) => escapeRegExp(segment))
        .join(String.raw`\s*\.\s*`);
      if (new RegExp(
        String.raw`\b${pathPattern}\s*\.\s*[A-Za-z0-9_-]+`,
        "iu",
      ).test(normalizeExpressionPropertyAccess(value))) return true;
      continue;
    }
    const separator = binding.indexOf(".");
    const namespace = binding.slice(0, separator);
    const name = binding.slice(separator + 1);
    const reference = new RegExp(
      String.raw`\b${escapeRegExp(namespace)}\s*(?:\.\s*${escapeRegExp(name)}(?![A-Za-z0-9_-])|\[\s*["']${escapeRegExp(name)}["']\s*\])`,
      "iu",
    );
    if (reference.test(value)) return true;
  }
  return false;
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
          ["ls-tree", "-r", "-z", "--full-tree", tree],
          { cwd: repoRoot, encoding: null },
        ).stdout).map((record) => ({ ...record, snapshot: tree, source: "history" })));
      }
    }
    const headTree = resolveTreeObjectId(repoRoot, "HEAD");
    records.push(...parseTreeRecords(runCommand("git", ["ls-tree", "-r", "-z", "--full-tree", "HEAD"], {
      cwd: repoRoot,
      encoding: null,
    }).stdout).map((record) => ({ ...record, snapshot: headTree ?? "HEAD", source: "tracked-file" })));
  }
  records.push(...parseIndexRecords(runCommand("git", ["ls-files", "--stage", "-z"], {
    cwd: repoRoot,
    encoding: null,
  }).stdout).map((record) => ({ ...record, snapshot: "index", source: "tracked-file" })));

  const unique = new Map();
  for (const record of records) {
    if (WORKFLOW_PATH_PATTERN.test(record.path)
      || ACTION_MANIFEST_PATH_PATTERN.test(record.path)
      || DOCKERFILE_PATH_PATTERN.test(record.path)) {
      const key = `${record.snapshot}\0${record.path}\0${record.objectId}\0${record.mode}`;
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

function workflowSyntax(text) {
  const normalized = text
    .replace(/\r\n?|\u0085|\u2028|\u2029/gu, "\n")
    .replace(/^\ufeff/u, "");
  const uncommented = stripYamlComments(normalized);
  const scalarAnchors = yamlScalarAnchors(uncommented);
  const blockNodeAnchors = yamlBlockNodeAnchors(yamlBlockMappingEntries(uncommented, scalarAnchors));
  return {
    blockNodeAnchors,
    scalarAnchors,
    triggerNames: workflowTriggerNames(uncommented, scalarAnchors, blockNodeAnchors),
    uncommented,
  };
}

function auditWorkflowText(workflowPath, text, source = "tracked-file") {
  const findings = [];
  const { scalarAnchors, triggerNames, uncommented } = workflowSyntax(text);
  const hasPullRequestTarget = triggerNames
    .some((eventName) => eventName.toLowerCase() === "pull_request_target");
  const hasPrivilegedTrigger = hasPrivilegedWorkflowTrigger(triggerNames);
  const hasWriteAll = [
    ...workflowRootValues(uncommented, "permissions", scalarAnchors),
    ...workflowJobValues(uncommented, "permissions", scalarAnchors),
  ]
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

  for (const runnerLabels of workflowJobRunnerLabelSets(uncommented, scalarAnchors)) {
    if (runnerLabels.some((label) => yamlScalarValue(label).toLowerCase() === "self-hosted")) {
      findings.push(workflowFinding({
        message: "Public workflows must not select a persistent self-hosted runner.",
        path: workflowPath,
        ruleId: "workflow-self-hosted-runner",
        severity: "error",
        source,
      }));
    } else if (runnerLabels.some((label) => /\$\{\{|^\s*\*/u.test(label)
      || yamlValueContainsToken(label, "group")
      || !isKnownGithubHostedRunnerLabel(yamlScalarValue(label)))) {
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

  }

  if (hasPrivilegedTrigger
    && hasUntrustedPullRequestCheckout(uncommented, scalarAnchors)) {
    findings.push(workflowFinding({
      message: "A privileged workflow must not execute an untrusted checkout.",
      path: workflowPath,
      ruleId: "workflow-privileged-untrusted-checkout",
      severity: "error",
      source,
    }));
  }

  if (hasPrivilegedTrigger
    && hasUntrustedWorkflowArtifactExecution(uncommented, scalarAnchors)) {
    findings.push(workflowFinding({
      message: "A privileged workflow must not execute artifacts produced by an untrusted triggering run.",
      path: workflowPath,
      ruleId: "workflow-privileged-untrusted-artifact-execution",
      severity: "error",
      source,
    }));
  }

  for (const actionRef of actionReferences(uncommented, scalarAnchors)) {
    if (isMutableRemoteActionReference(actionRef)) {
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

function hasPrivilegedWorkflowTrigger(triggerNames) {
  return triggerNames.some((name) => PRIVILEGED_WORKFLOW_TRIGGERS.has(name.toLowerCase()));
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

function stripYamlComments(text) {
  const lines = text.split("\n");
  const blockScalarBodyLines = yamlBlockScalarBodyLineIndexes(lines.map(stripYamlComment));
  let singleQuoted = false;
  let doubleQuoted = false;
  return lines.map((line, lineIndex) => {
    if (blockScalarBodyLines.has(lineIndex)) {
      singleQuoted = false;
      doubleQuoted = false;
      return line;
    }
    let uncommented = "";
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (singleQuoted) {
        uncommented += character;
        if (character === "'" && line[index + 1] === "'") {
          uncommented += line[index + 1];
          index += 1;
        } else if (character === "'") {
          singleQuoted = false;
        }
        continue;
      }
      if (doubleQuoted) {
        uncommented += character;
        if (character === "\\" && line[index + 1] !== undefined) {
          uncommented += line[index + 1];
          index += 1;
        } else if (character === "\"") {
          doubleQuoted = false;
        }
        continue;
      }
      if (character === "'") singleQuoted = true;
      if (character === "\"") doubleQuoted = true;
      if (character === "#" && (index === 0 || /\s/u.test(line[index - 1]))) break;
      uncommented += character;
    }
    return uncommented;
  }).join("\n");
}

function parseYamlKeyLine(line) {
  const match = /^(\s*)(?:(?:&[^\s]+|![^\s]+)\s+)*(?:"((?:\\[^\r\n]|[^"\\\r\n])*)"|'((?:''|[^'\r\n])*)'|(\*[^\s:,{}\[\]]+)|([A-Za-z0-9_-]+))\s*:\s*(.*)$/u.exec(line);
  if (!match) return undefined;
  return {
    indentation: match[1].length,
    key: match[2] !== undefined
      ? decodeYamlDoubleQuotedScalar(match[2])
      : (match[3]?.replaceAll("''", "'") ?? match[4] ?? match[5]),
    value: match[6],
  };
}

function parseYamlMappingEntryAt(lines, index) {
  const directEntry = parseYamlKeyLine(lines[index]);
  if (directEntry) return { entry: directEntry, valueLineIndex: index };

  const explicitKey = /^(\s*)\?\s+(.+?)\s*$/u.exec(lines[index]);
  if (!explicitKey) return undefined;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor].trim().length === 0) continue;
    const explicitValue = /^(\s*):\s*(.*)$/u.exec(lines[cursor]);
    if (!explicitValue || explicitValue[1].length !== explicitKey[1].length) return undefined;
    const key = yamlScalarValue(explicitKey[2]);
    if (key.length === 0) return undefined;
    return {
      entry: {
        indentation: explicitKey[1].length,
        key,
        value: explicitValue[2],
      },
      valueLineIndex: cursor,
    };
  }
  return undefined;
}

function workflowRootValues(text, key, scalarAnchors) {
  return [
    ...yamlBlockMappingEntries(text, scalarAnchors)
      .filter((entry) => entry.indentation === 0 && entry.key.toLowerCase() === key.toLowerCase())
      .map((entry) => entry.value),
    ...yamlRootFlowMappingValues(text, key, scalarAnchors),
  ];
}

function workflowRootContainerGroups(text, key, scalarAnchors) {
  const entries = yamlBlockMappingEntries(text, scalarAnchors);
  const blockNodeAnchors = yamlBlockNodeAnchors(entries);
  const groups = [];
  for (let index = 0; index < entries.length; index += 1) {
    const rootEntry = entries[index];
    if (rootEntry.indentation !== 0 || rootEntry.key.toLowerCase() !== key.toLowerCase()) {
      continue;
    }
    const properties = directBlockMappingChildren(entries, index);
    if (properties.length > 0) {
      groups.push({ blockNodeAnchors, entries, properties, text });
    }
    const aliasProperties = yamlBlockAliasMappingEntries(
      rootEntry.inlineValue,
      blockNodeAnchors,
      scalarAnchors,
    );
    if (aliasProperties.length > 0) {
      groups.push({ blockNodeAnchors, entries, properties: aliasProperties, text });
    }
    const flowProperties = yamlDirectFlowMappingEntries(
      resolveYamlScalarValue(rootEntry.value, scalarAnchors),
    ).map((entry) => ({
      entry: { ...entry, key: resolveYamlScalarValue(entry.key, scalarAnchors) },
    }));
    if (flowProperties.length > 0) {
      groups.push({ blockNodeAnchors, entries: undefined, properties: flowProperties, text });
    }
  }
  for (const rootValue of yamlRootFlowMappingValues(text, key, scalarAnchors)) {
    const properties = yamlDirectFlowMappingEntries(
      resolveYamlScalarValue(rootValue, scalarAnchors),
    ).map((entry) => ({
      entry: { ...entry, key: resolveYamlScalarValue(entry.key, scalarAnchors) },
    }));
    if (properties.length > 0) {
      groups.push({ blockNodeAnchors, entries: undefined, properties, text });
    }
  }
  return groups;
}

function workflowJobValues(text, key, scalarAnchors) {
  return workflowJobPropertyGroups(text, scalarAnchors).flatMap(({ properties }) => properties
    .filter(({ entry }) => entry.key.toLowerCase() === key.toLowerCase())
    .map(({ entry }) => entry.value));
}

function workflowJobPropertyGroups(text, scalarAnchors) {
  const entries = yamlBlockMappingEntries(text, scalarAnchors);
  const blockNodeAnchors = yamlBlockNodeAnchors(entries);
  const groups = [];
  for (let index = 0; index < entries.length; index += 1) {
    const jobsEntry = entries[index];
    if (jobsEntry.indentation !== 0 || jobsEntry.key.toLowerCase() !== "jobs") continue;
    const blockJobs = [
      ...directBlockMappingChildren(entries, index),
      ...yamlBlockAliasMappingEntries(
        jobsEntry.inlineValue,
        blockNodeAnchors,
        scalarAnchors,
      ),
    ];
    groups.push(...workflowJobPropertyGroupsFromBlockJobs(
      blockJobs,
      entries,
      scalarAnchors,
      blockNodeAnchors,
      text,
    ));
    groups.push(...workflowJobPropertyGroupsFromFlowJobs(
      jobsEntry.value,
      scalarAnchors,
      blockNodeAnchors,
      text,
    ));
  }
  for (const jobsValue of yamlRootFlowMappingValues(text, "jobs", scalarAnchors)) {
    groups.push(...workflowJobPropertyGroupsFromFlowJobs(
      jobsValue,
      scalarAnchors,
      blockNodeAnchors,
      text,
    ));
  }
  return groups;
}

function workflowJobPropertyGroupsFromBlockJobs(
  jobs,
  entries,
  scalarAnchors,
  blockNodeAnchors,
  text,
) {
  const groups = [];
  for (const job of jobs) {
    const jobName = resolveYamlScalarValue(job.entry.key, scalarAnchors).toLowerCase();
    const properties = directBlockMappingChildren(entries, job.index);
    if (properties.length > 0) {
      groups.push({ blockNodeAnchors, entries, jobName, properties, text });
    }
    const aliasProperties = yamlBlockAliasMappingEntries(
      job.entry.inlineValue,
      blockNodeAnchors,
      scalarAnchors,
    );
    if (aliasProperties.length > 0) {
      groups.push({ blockNodeAnchors, entries, jobName, properties: aliasProperties, text });
    }
    const flowProperties = yamlDirectFlowMappingEntries(
      resolveYamlScalarValue(job.entry.inlineValue, scalarAnchors),
    ).map((entry) => ({
      entry: { ...entry, key: resolveYamlScalarValue(entry.key, scalarAnchors) },
    }));
    if (flowProperties.length > 0) {
      groups.push({ blockNodeAnchors, entries: undefined, jobName, properties: flowProperties, text });
    }
  }
  return groups;
}

function yamlBlockNodeAnchors(entries) {
  const anchors = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const anchorName = yamlBlockNodeAnchorName(entries[index].inlineValue);
    if (!anchorName) continue;
    const children = directBlockMappingChildren(entries, index);
    if (children.length > 0) anchors.set(anchorName, children);
  }
  return anchors;
}

function yamlBlockNodeAnchorName(value) {
  let remaining = value.trim();
  let anchorName;
  while (true) {
    const property = /^(&([^\s]+)|![^\s]+)(?:\s+|$)/u.exec(remaining);
    if (!property) return anchorName;
    if (property[2]) anchorName = property[2];
    remaining = remaining.slice(property[0].length);
  }
}

function yamlBlockAliasMappingEntries(value, blockNodeAnchors, scalarAnchors) {
  const visited = new Set();
  let current = yamlScalarValue(value);
  while (true) {
    const alias = /^\*([^\s]+)$/u.exec(current);
    if (!alias || visited.has(alias[1])) return [];
    visited.add(alias[1]);
    const blockNode = blockNodeAnchors.get(alias[1]);
    if (blockNode) return blockNode;
    if (!scalarAnchors.has(alias[1])) return [];
    current = yamlScalarValue(scalarAnchors.get(alias[1]));
  }
}

function yamlBlockSequenceAliasParentEntry(value, entries, scalarAnchors) {
  const visited = new Set();
  let current = yamlScalarValue(value);
  while (true) {
    const alias = /^\*([^\s]+)$/u.exec(current);
    if (!alias || visited.has(alias[1])) return undefined;
    visited.add(alias[1]);
    const parent = entries.find((entry) => yamlBlockNodeAnchorName(entry.inlineValue) === alias[1]);
    if (parent) return parent;
    if (!scalarAnchors.has(alias[1])) return undefined;
    current = yamlScalarValue(scalarAnchors.get(alias[1]));
  }
}

function directBlockMappingChildren(entries, parentIndex) {
  const parent = entries[parentIndex];
  const descendants = [];
  for (let index = parentIndex + 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.indentation <= parent.indentation) break;
    descendants.push({ entry, index });
  }
  if (descendants.length === 0) return [];
  const childIndentation = Math.min(...descendants.map(({ entry }) => entry.indentation));
  return descendants.filter(({ entry }) => entry.indentation === childIndentation);
}

function workflowJobPropertyGroupsFromFlowJobs(value, scalarAnchors, blockNodeAnchors, text) {
  const jobsValue = resolveYamlScalarValue(value, scalarAnchors);
  return yamlDirectFlowMappingEntries(jobsValue).flatMap((jobEntry) => {
    const jobName = resolveYamlScalarValue(jobEntry.key, scalarAnchors).toLowerCase();
    const jobValue = resolveYamlScalarValue(jobEntry.value, scalarAnchors);
    const properties = yamlDirectFlowMappingEntries(jobValue).map((entry) => ({
      entry: { ...entry, key: resolveYamlScalarValue(entry.key, scalarAnchors) },
    }));
    return properties.length > 0
      ? [{ blockNodeAnchors, entries: undefined, jobName, properties, text }]
      : [];
  });
}

function workflowTriggerNames(text, scalarAnchors, blockNodeAnchors) {
  const lines = maskYamlBlockScalarBodies(text).split("\n");
  const names = [];
  for (let index = 0; index < lines.length; index += 1) {
    const parsedEntry = parseYamlMappingEntryAt(lines, index);
    const entry = parsedEntry?.entry;
    if (entry) entry.key = resolveYamlScalarValue(entry.key, scalarAnchors);
    if (!entry || entry.indentation !== 0 || entry.key.toLowerCase() !== "on") continue;
    if (entry.value.trim().length > 0 && !yamlValueHasOnlyProperties(entry.value)) {
      names.push(...workflowTriggerNamesFromValue(
        entry.value,
        scalarAnchors,
        blockNodeAnchors,
        text,
      ));
      continue;
    }
    let childIndentation;
    for (let cursor = parsedEntry.valueLineIndex + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim().length === 0) continue;
      const indentation = /^\s*/u.exec(line)[0].length;
      if (indentation <= entry.indentation) break;
      if (childIndentation === undefined) childIndentation = indentation;
      if (indentation !== childIndentation) continue;
      if (/^[\[{]/u.test(line.trim())) {
        let flowValue = line.trim();
        for (let continuation = cursor + 1; continuation < lines.length; continuation += 1) {
          const continuationLine = lines[continuation];
          if (continuationLine.trim().length === 0) continue;
          if (/^\s*/u.exec(continuationLine)[0].length <= entry.indentation) break;
          flowValue += " " + continuationLine.trim();
        }
        names.push(...workflowTriggerNamesFromValue(
          flowValue,
          scalarAnchors,
          blockNodeAnchors,
          text,
        ));
        break;
      }
      const sequenceItem = /^(\s*)-\s*(.*)$/u.exec(line);
      if (sequenceItem) {
        names.push(...workflowTriggerNamesFromValue(
          sequenceItem[2],
          scalarAnchors,
          blockNodeAnchors,
          text,
        ));
        continue;
      }
      const parsedEvent = parseYamlMappingEntryAt(lines, cursor);
      if (parsedEvent) {
        names.push(resolveYamlScalarValue(parsedEvent.entry.key, scalarAnchors));
        cursor = parsedEvent.valueLineIndex;
      }
    }
  }
  for (const onValue of yamlRootFlowMappingValues(text, "on", scalarAnchors)) {
    names.push(...workflowTriggerNamesFromValue(
      onValue,
      scalarAnchors,
      blockNodeAnchors,
      text,
    ));
  }
  return names;
}

function yamlValueHasOnlyProperties(value) {
  return /^(?:(?:&[^\s]+|![^\s]+)\s*)+$/u.test(value.trim());
}

function workflowTriggerNamesFromValue(value, scalarAnchors, blockNodeAnchors, text) {
  const blockAliasEntries = yamlBlockAliasMappingEntries(
    value,
    blockNodeAnchors,
    scalarAnchors,
  );
  if (blockAliasEntries.length > 0) {
    return blockAliasEntries.map(({ entry }) => resolveYamlScalarValue(entry.key, scalarAnchors));
  }
  const blockSequenceParent = yamlBlockSequenceAliasParentEntry(
    value,
    yamlBlockMappingEntries(text, scalarAnchors),
    scalarAnchors,
  );
  const blockSequenceValues = blockSequenceParent
    ? yamlBlockSequenceValues(text, blockSequenceParent)
    : undefined;
  if (blockSequenceValues) {
    return blockSequenceValues.flatMap((item) => workflowTriggerNamesFromValue(
      item,
      scalarAnchors,
      blockNodeAnchors,
      text,
    ));
  }
  const resolved = resolveYamlScalarValue(value, scalarAnchors);
  const mappingEntries = yamlDirectFlowMappingEntries(resolved);
  if (resolved.trimStart().startsWith("{")) {
    return mappingEntries.map((entry) => resolveYamlScalarValue(entry.key, scalarAnchors));
  }
  const sequenceValues = yamlFlowSequenceValues(resolved);
  if (sequenceValues) {
    return sequenceValues.flatMap((item) => workflowTriggerNamesFromValue(
      item,
      scalarAnchors,
      blockNodeAnchors,
      text,
    ));
  }
  return [resolved];
}

function yamlBlockMappingEntries(text, scalarAnchors) {
  const lines = text.split("\n");
  const blockScalarBodyLines = yamlBlockScalarBodyLineIndexes(lines);
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (blockScalarBodyLines.has(index)) continue;
    const parsedEntry = parseYamlMappingEntryAt(lines, index);
    if (!parsedEntry) continue;
    const { entry, valueLineIndex } = parsedEntry;
    let value = entry.value;
    for (let cursor = valueLineIndex + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim().length === 0) continue;
      const nextIndentation = /^\s*/u.exec(line)[0].length;
      if (nextIndentation <= entry.indentation) break;
      if (yamlDoubleQuotedScalarContinues(value)) {
        value = value.slice(0, -1) + line.trimStart();
      } else {
        value += " " + line.trim();
      }
    }
    entries.push({
      ...entry,
      inlineValue: entry.value.trim(),
      key: scalarAnchors
        ? resolveYamlScalarValue(entry.key, scalarAnchors)
        : entry.key,
      lineIndex: index,
      value: value.trim(),
      valueLineIndex,
    });
  }
  return entries;
}

function yamlDoubleQuotedScalarContinues(value) {
  if (!value.endsWith("\\")) return false;
  let normalized = value.trimStart();
  let property = /^(?:&[^\s]+|![^\s]+)\s+/u.exec(normalized);
  while (property) {
    normalized = normalized.slice(property[0].length);
    property = /^(?:&[^\s]+|![^\s]+)\s+/u.exec(normalized);
  }
  if (!normalized.startsWith("\"")) return false;
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index] === "\\") {
      if (index === normalized.length - 1) return true;
      index += 1;
    } else if (normalized[index] === "\"") {
      return false;
    }
  }
  return false;
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
    const parsedEntry = parseYamlMappingEntryAt(lines, index);
    const structuralEntry = parsedEntry?.entry ?? parseYamlStructuralKeyLine(line);
    if (structuralEntry && isYamlBlockScalarHeader(structuralEntry.value)) {
      scalarIndentation = structuralEntry.indentation;
      if (parsedEntry) index = parsedEntry.valueLineIndex;
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
  if (quote === "\"" && normalized.at(-1) === quote) {
    return decodeYamlDoubleQuotedScalar(normalized.slice(1, -1));
  }
  if (quote === "'" && normalized.at(-1) === quote) {
    return normalized.slice(1, -1).replaceAll("''", "'");
  }
  return normalized;
}

function decodeYamlDoubleQuotedScalar(value) {
  const simpleEscapes = new Map([
    ["0", "\0"],
    ["a", "\x07"],
    ["b", "\b"],
    ["t", "\t"],
    ["n", "\n"],
    ["v", "\v"],
    ["f", "\f"],
    ["r", "\r"],
    ["e", "\x1b"],
    [" ", " "],
    ["\"", "\""],
    ["/", "/"],
    ["\\", "\\"],
    ["N", "\u0085"],
    ["_", "\u00a0"],
    ["L", "\u2028"],
    ["P", "\u2029"],
  ]);
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\" || index + 1 >= value.length) {
      decoded += character;
      continue;
    }
    const escape = value[index + 1];
    if (escape === "\n") {
      index += 1;
      while (index + 1 < value.length && /[ \t]/u.test(value[index + 1])) index += 1;
      continue;
    }
    if (simpleEscapes.has(escape)) {
      decoded += simpleEscapes.get(escape);
      index += 1;
      continue;
    }
    const width = escape === "x" ? 2 : escape === "u" ? 4 : escape === "U" ? 8 : 0;
    const digits = value.slice(index + 2, index + 2 + width);
    if (width > 0 && digits.length === width && /^[0-9a-f]+$/iu.test(digits)) {
      const codePoint = Number.parseInt(digits, 16);
      if (codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        decoded += String.fromCodePoint(codePoint);
        index += width + 1;
        continue;
      }
    }
    decoded += `\\${escape}`;
    index += 1;
  }
  return decoded;
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

function workflowRunnerLabels(value, scalarAnchors) {
  const resolved = resolveYamlScalarValue(value, scalarAnchors);
  const constantExpression = githubConstantExpressionValue(resolved);
  if (typeof constantExpression === "string") return [constantExpression];
  const sequenceValues = yamlFlowSequenceValues(resolved);
  return sequenceValues
    ? sequenceValues.flatMap((item) => workflowRunnerLabels(item, scalarAnchors))
    : [resolved];
}

function githubConstantExpressionValue(value) {
  const expression = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/u.exec(value.trim());
  return expression ? evaluateGithubConstantExpression(expression[1]) : undefined;
}

function evaluateGithubConstantExpression(expression) {
  const normalized = expression.trim();
  const singleQuoted = /^'((?:''|[^'])*)'$/u.exec(normalized);
  if (singleQuoted) return singleQuoted[1].replaceAll("''", "'");
  const doubleQuoted = /^"((?:\\.|[^"\\])*)"$/u.exec(normalized);
  if (doubleQuoted) return decodeYamlDoubleQuotedScalar(doubleQuoted[1]);
  const call = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/u.exec(normalized);
  if (!call) return undefined;
  const argumentSources = splitGithubExpressionArguments(call[2]);
  if (!argumentSources) return undefined;
  const arguments_ = argumentSources.map(evaluateGithubConstantExpression);
  if (arguments_.some((argument) => argument === undefined)) return undefined;
  if (call[1].toLowerCase() === "fromjson" && arguments_.length === 1
    && typeof arguments_[0] === "string") {
    try {
      return JSON.parse(arguments_[0]);
    } catch {
      return undefined;
    }
  }
  if (call[1].toLowerCase() === "join" && arguments_.length >= 1
    && Array.isArray(arguments_[0])) {
    const separator = arguments_[1] === undefined ? "," : String(arguments_[1]);
    return arguments_[0].map(String).join(separator);
  }
  if (call[1].toLowerCase() !== "format" || arguments_.length === 0
    || typeof arguments_[0] !== "string") return undefined;
  const openBrace = "\u0000OPEN_BRACE\u0000";
  const closeBrace = "\u0000CLOSE_BRACE\u0000";
  return arguments_[0]
    .replaceAll("{{", openBrace)
    .replaceAll("}}", closeBrace)
    .replace(/\{(\d+)\}/gu, (placeholder, index) => (
      arguments_[Number(index) + 1] === undefined
        ? placeholder
        : String(arguments_[Number(index) + 1])
    ))
    .replaceAll(openBrace, "{")
    .replaceAll(closeBrace, "}");
}

function splitGithubExpressionArguments(source) {
  if (source.trim().length === 0) return [];
  const arguments_ = [];
  let argumentStart = 0;
  let depth = 0;
  let quote;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (quote === "'" && character === "'" && source[index + 1] === "'") {
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
    } else if (["(", "[", "{"].includes(character)) {
      depth += 1;
    } else if ([")", "]", "}"].includes(character)) {
      depth -= 1;
      if (depth < 0) return undefined;
    } else if (character === "," && depth === 0) {
      arguments_.push(source.slice(argumentStart, index).trim());
      argumentStart = index + 1;
    }
  }
  if (quote || depth !== 0) return undefined;
  arguments_.push(source.slice(argumentStart).trim());
  return arguments_.every((argument) => argument.length > 0) ? arguments_ : undefined;
}

function workflowJobRunnerLabelSets(text, scalarAnchors) {
  const runnerLabelSets = [];
  for (const group of workflowJobPropertyGroups(text, scalarAnchors)) {
    for (const property of group.properties) {
      if (property.entry.key.toLowerCase() !== "runs-on") continue;
      const inlineValue = property.entry.inlineValue ?? property.entry.value;
      const mappingEntries = workflowPropertyMappingEntries(
        group,
        property,
        scalarAnchors,
      );
      if (mappingEntries.length > 0) {
        const mappingRunnerValues = mappingEntries.flatMap((mappingEntry) => {
          const key = resolveYamlScalarValue(
            mappingEntry.entry.key,
            scalarAnchors,
          ).toLowerCase();
          if (key === "group") {
            return [`group: ${resolveYamlScalarValue(
              mappingEntry.entry.value,
              scalarAnchors,
            )}`];
          }
          if (key !== "labels") return [];
          const labelInlineValue = mappingEntry.entry.inlineValue
            ?? mappingEntry.entry.value;
          const blockLabels = group.entries
            && mappingEntry.index !== undefined
            && (labelInlineValue.length === 0 || yamlValueHasOnlyProperties(labelInlineValue))
            ? yamlBlockSequenceValues(group.text, mappingEntry.entry)
            : undefined;
          return (blockLabels ?? [mappingEntry.entry.value]).flatMap((value) => (
            workflowRunnerLabels(value, scalarAnchors)
          ));
        });
        if (mappingRunnerValues.length > 0) {
          runnerLabelSets.push(mappingRunnerValues);
          continue;
        }
      }
      const blockValues = group.entries
        && property.index !== undefined
        && (inlineValue.length === 0 || yamlValueHasOnlyProperties(inlineValue))
        ? yamlBlockSequenceValues(group.text, property.entry)
        : undefined;
      const runnerValues = blockValues ?? [property.entry.value];
      runnerLabelSets.push(runnerValues.flatMap((value) => workflowRunnerLabels(
        value,
        scalarAnchors,
      )));
    }
  }
  return runnerLabelSets;
}

function yamlBlockSequenceValues(text, parentEntry) {
  const lines = text.split("\n");
  const values = [];
  for (let index = parentEntry.valueLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) continue;
    const indentation = /^\s*/u.exec(line)[0].length;
    if (indentation <= parentEntry.indentation) break;
    const sequenceItem = /^(\s*)-\s*(.*)$/u.exec(line);
    if (sequenceItem) {
      values.push({ indentation: sequenceItem[1].length, value: sequenceItem[2] });
    }
  }
  if (values.length === 0) return undefined;
  const itemIndentation = Math.min(...values.map((item) => item.indentation));
  return values
    .filter((item) => item.indentation === itemIndentation)
    .map((item) => item.value);
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

function yamlDirectFlowMappingEntries(value) {
  const openingBraceIndex = value.search(/\S/u);
  if (openingBraceIndex < 0 || value[openingBraceIndex] !== "{") return [];
  return yamlFlowMappingEntriesAt(value, openingBraceIndex);
}

function yamlDirectFlowMappingValues(value, key) {
  return yamlDirectFlowMappingEntries(value)
    .filter((entry) => entry.key.toLowerCase() === key.toLowerCase())
    .map((entry) => entry.value);
}

function yamlFlowSequenceValues(value) {
  const normalized = value.trim();
  if (!normalized.startsWith("[")) return undefined;
  const values = [];
  let braces = 0;
  let brackets = 0;
  let itemStart = 1;
  let quote;
  for (let cursor = 1; cursor < normalized.length; cursor += 1) {
    const character = normalized[cursor];
    if (quote) {
      if (quote === "'" && character === "'" && normalized[cursor + 1] === "'") {
        cursor += 1;
      } else if (quote === "\"" && character === "\\") {
        cursor += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
    } else if (character === "{") {
      braces += 1;
    } else if (character === "}") {
      braces -= 1;
    } else if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      if (braces === 0 && brackets === 0) {
        const item = normalized.slice(itemStart, cursor).trim();
        if (item.length > 0) values.push(item);
        return normalized.slice(cursor + 1).trim().length === 0 ? values : undefined;
      }
      brackets -= 1;
    } else if (character === "," && braces === 0 && brackets === 0) {
      const item = normalized.slice(itemStart, cursor).trim();
      if (item.length > 0) values.push(item);
      itemStart = cursor + 1;
    }
  }
  return undefined;
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

function yamlRootFlowMappingValues(text, key, scalarAnchors = new Map()) {
  const openingBraceIndex = yamlDocumentContentStart(text);
  if (openingBraceIndex < 0 || text[openingBraceIndex] !== "{") return [];
  return yamlFlowMappingEntriesAt(text, openingBraceIndex)
    .filter((entry) => resolveYamlScalarValue(entry.key, scalarAnchors).toLowerCase() === key.toLowerCase())
    .map((entry) => entry.value);
}

function yamlDocumentContentStart(text) {
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/u.test(text[index])) index += 1;
    if (text[index] === "\ufeff") {
      index += 1;
      continue;
    }
    if (text[index] === "%") {
      const lineEnd = text.indexOf("\n", index);
      if (lineEnd < 0) return -1;
      index = lineEnd + 1;
      continue;
    }
    if (text.startsWith("---", index)
      && (text[index + 3] === undefined || /\s/u.test(text[index + 3]))) {
      index += 3;
      continue;
    }
    return index;
  }
  return -1;
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
  let keyStart = startIndex;
  if (text[keyStart] === "?" && /\s/u.test(text[keyStart + 1] ?? "")) {
    keyStart += 1;
    while (/\s/u.test(text[keyStart] ?? "")) keyStart += 1;
  }
  const quote = text[keyStart];
  if (quote === "'" || quote === "\"") {
    let cursor = keyStart + 1;
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
          key: quote === "\""
            ? decodeYamlDoubleQuotedScalar(text.slice(keyStart + 1, cursor))
            : text.slice(keyStart + 1, cursor).replaceAll("''", "'"),
          nextIndex: cursor + 1,
        };
      }
      cursor += 1;
    }
    return undefined;
  }
  let cursor = keyStart;
  while (cursor < text.length && !/[:,{}]/u.test(text[cursor])) cursor += 1;
  const key = text.slice(keyStart, cursor).trim();
  return key.length > 0 ? { key, nextIndex: cursor } : undefined;
}

function hasUntrustedPullRequestCheckout(text, scalarAnchors, taintedBindings = new Set()) {
  const jobGroups = workflowJobPropertyGroups(text, scalarAnchors);
  const jobTaintAnalyses = workflowJobTaintAnalyses(
    jobGroups,
    workflowRootMappingBindings(text, "env", "env", scalarAnchors),
    scalarAnchors,
    taintedBindings,
  );
  for (const jobGroup of jobGroups) {
    for (const { stepGroup, taintedBindings: stepTaintedBindings } of (
      jobTaintAnalyses.get(jobGroup)?.stepContexts ?? []
    )) {
      if (stepGroupHasUntrustedCheckout(
        stepGroup,
        scalarAnchors,
        stepTaintedBindings,
      )) {
        return true;
      }
    }
  }
  return false;
}

function hasUntrustedWorkflowArtifactExecution(
  text,
  scalarAnchors,
  taintedBindings = new Set(),
) {
  const jobGroups = workflowJobPropertyGroups(text, scalarAnchors);
  const jobTaintAnalyses = workflowJobTaintAnalyses(
    jobGroups,
    workflowRootMappingBindings(text, "env", "env", scalarAnchors),
    scalarAnchors,
    taintedBindings,
  );
  return jobGroups.some((jobGroup) => stepContextsHaveUntrustedArtifactExecution(
    jobTaintAnalyses.get(jobGroup)?.stepContexts ?? [],
    scalarAnchors,
  ));
}

function stepContextsHaveUntrustedArtifactExecution(stepContexts, scalarAnchors) {
  const artifactPaths = [];
  for (const { stepGroup, taintedBindings } of stepContexts) {
    if (stepDownloadsUntrustedWorkflowArtifact(
      stepGroup,
      scalarAnchors,
      taintedBindings,
    )) {
      artifactPaths.push(downloadedArtifactPath(stepGroup, scalarAnchors));
      continue;
    }
    if (artifactPaths.some((artifactPath) => stepExecutesArtifactPath(
      stepGroup,
      scalarAnchors,
      artifactPath,
    ))) return true;
  }
  return false;
}

function stepDownloadsUntrustedWorkflowArtifact(
  stepGroup,
  scalarAnchors,
  taintedBindings,
) {
  const downloadsArtifact = stepGroup.properties
    .filter(({ entry }) => entry.key.toLowerCase() === "uses")
    .some(({ entry }) => /^actions\/download-artifact@/iu.test(
      resolveYamlScalarValue(entry.value, scalarAnchors),
    ));
  if (!downloadsArtifact) return false;
  return workflowMappingBindings(stepGroup, "with", "with", scalarAnchors)
    .filter((binding) => binding.name === "run-id")
    .some((binding) => isUntrustedReusableValue(binding.value, taintedBindings));
}

function downloadedArtifactPath(stepGroup, scalarAnchors) {
  const value = workflowMappingBindings(stepGroup, "with", "with", scalarAnchors)
    .find((binding) => binding.name === "path")?.value;
  if (!value || /\$|%/u.test(value) || path.posix.isAbsolute(value)) return ".";
  const normalized = path.posix.normalize(value).replace(/^\.\//u, "");
  return normalized === ".." || normalized.startsWith("../") ? "." : normalized;
}

function stepExecutesArtifactPath(stepGroup, scalarAnchors, artifactPath) {
  const localActionReference = stepGroup.properties
    .filter(({ entry }) => entry.key.toLowerCase() === "uses")
    .map(({ entry }) => resolveYamlScalarValue(entry.value, scalarAnchors))
    .find((reference) => reference.startsWith("./"));
  if (localActionReference && artifactSourceMatchesPath(localActionReference, artifactPath)) {
    return true;
  }
  return stepGroup.properties
    .filter(({ entry }) => entry.key.toLowerCase() === "run")
    .map(({ entry }) => resolveYamlScalarValue(entry.value, scalarAnchors))
    .some((runSource) => shellRunExecutesArtifactPath(runSource, artifactPath));
}

function shellRunExecutesArtifactPath(runSource, artifactPath) {
  const executableCommand = /(?:^|[;&|]\s*)(?:sudo\s+|command\s+)?(?:(?:bash|deno|node|perl|php|python\d*|ruby|sh|zsh)\s+(?:-[^\s]+\s+)*|(?:source|\.)\s+|\.\.?\/)([^\s;&|]+)/iu;
  return runSource
    .replace(/\r\n?|\u0085|\u2028|\u2029/gu, "\n")
    .replace(/\\\n[ \t]*/gu, " ")
    .split("\n")
    .filter((line) => !/^\s*#/u.test(line))
    .some((line) => {
      const execution = executableCommand.exec(line);
      return execution && artifactSourceMatchesPath(execution[1], artifactPath);
    });
}

function artifactSourceMatchesPath(source, artifactPath) {
  const normalized = source.replace(/^["']|["']$/gu, "").replace(/^\.\//u, "");
  if (artifactPath === ".") return !path.posix.isAbsolute(normalized);
  return normalized === artifactPath || normalized.startsWith(`${artifactPath}/`);
}

function stepGroupHasUntrustedCheckout(stepGroup, scalarAnchors, stepTaintedBindings) {
  const hasUntrustedShellCheckout = stepGroup.properties
    .filter(({ entry }) => entry.key.toLowerCase() === "run")
    .map(({ entry }) => resolveYamlScalarValue(entry.value, scalarAnchors))
    .some((runSource) => shellRunHasUntrustedCheckout(runSource, stepTaintedBindings));
  if (hasUntrustedShellCheckout) return true;
  const usesCheckout = stepGroup.properties
    .filter(({ entry }) => entry.key.toLowerCase() === "uses")
    .some(({ entry }) => /^actions\/checkout@/iu.test(
      resolveYamlScalarValue(entry.value, scalarAnchors),
    ));
  if (!usesCheckout) return false;
  return workflowMappingBindings(stepGroup, "with", "with", scalarAnchors)
    .some((input) => isUntrustedCheckoutInput(
      input.name,
      input.value,
      stepTaintedBindings,
    ));
}

function shellRunHasUntrustedCheckout(runSource, taintedBindings) {
  return shellRunGitTaintAnalysis(runSource, taintedBindings).hasUntrustedCheckout;
}

function shellRunTaintsFetchHead(runSource, taintedBindings) {
  return shellRunGitTaintAnalysis(runSource, taintedBindings).taintsFetchHead;
}

function shellRunGitTaintAnalysis(runSource, taintedBindings) {
  const checkoutCommand = /\b(?:gh\s+repo\s+clone|git(?:\s+--?[^\s]+(?:[=\s][^\s]+)?)*\s+(?:checkout|clone|pull|reset|switch|worktree))\b/iu;
  const fetchCommand = /\bgit(?:\s+--?[^\s]+(?:[=\s][^\s]+)?)*\s+fetch\b/iu;
  const taintedVariables = new Set([...taintedBindings].flatMap((binding) => (
    binding.startsWith("env.") && binding !== "env.*"
      ? [binding.slice("env.".length).toLowerCase()]
      : []
  )));
  taintedVariables.add("github_head_ref");
  const anyEnvironmentVariableTainted = taintedBindings.has("env.*");
  const lines = runSource
    .replace(/\r\n?|\u0085|\u2028|\u2029/gu, "\n")
    .replace(/\\\n[ \t]*/gu, " ")
    .split("\n")
    .filter((line) => !/^\s*#/u.test(line));
  let fetchedHeadTainted = taintedBindings.has("git.fetch_head");
  let taintsFetchHead = false;
  for (const line of lines) {
    const assignment = /^\s*(?:(?:export|local|readonly)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=|^\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*=/iu.exec(line);
    if (assignment && (isUntrustedReusableValue(line, taintedBindings)
      || shellSourceReferencesTaintedVariable(
        line,
        taintedVariables,
        anyEnvironmentVariableTainted,
      ))) {
      taintedVariables.add((assignment[1] ?? assignment[2]).toLowerCase());
    }
    const lineIsTainted = isUntrustedReusableValue(line, taintedBindings)
      || shellSourceReferencesTaintedVariable(
        line,
        taintedVariables,
        anyEnvironmentVariableTainted,
      );
    if (fetchCommand.test(line) && lineIsTainted) {
      fetchedHeadTainted = true;
      taintsFetchHead = true;
    }
    if (checkoutCommand.test(line) && (lineIsTainted
      || (fetchedHeadTainted && /\bFETCH_HEAD\b/iu.test(line)))) {
      return { hasUntrustedCheckout: true, taintsFetchHead };
    }
  }
  return { hasUntrustedCheckout: false, taintsFetchHead };
}

function shellSourceReferencesTaintedVariable(source, taintedVariables, anyTainted) {
  const references = [
    ...source.matchAll(/\$(?:env:)?(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/giu),
    ...source.matchAll(/%([A-Za-z_][A-Za-z0-9_]*)%/gu),
  ].map((match) => (match[1] ?? match[2]).toLowerCase());
  return references.some((name) => anyTainted || taintedVariables.has(name));
}

function contextTaintedBindings(bindings, inheritedTaintedBindings) {
  const taintedBindings = new Set(inheritedTaintedBindings);
  for (const binding of bindings) {
    taintedBindings.delete(binding.namespace + "." + binding.name);
  }
  let changed;
  do {
    changed = false;
    for (const binding of bindings) {
      const name = binding.namespace + "." + binding.name;
      if (!taintedBindings.has(name)
        && isUntrustedReusableValue(binding.value, taintedBindings)) {
        taintedBindings.add(name);
        changed = true;
      }
    }
  } while (changed);
  return taintedBindings;
}

function isUntrustedCheckoutInput(key, value, taintedBindings = new Set()) {
  if (!["ref", "repository"].includes(key.toLowerCase())) return false;
  if (valueReferencesTaintedBinding(value, taintedBindings)) return true;
  if (/github\.event\.(?:comment\.body|discussion\.(?:body|title)|issue\.(?:body|title))(?:\.|\b)/iu.test(
    normalizeExpressionPropertyAccess(value),
  )) return true;
  if (key.toLowerCase() === "repository") {
    return /(?:pull_request\.head\.repo|workflow_run\.head_repository)(?:\.|\b)/iu
      .test(normalizeExpressionPropertyAccess(value));
  }
  return isUntrustedPullRequestRef(value);
}

function isUntrustedPullRequestRef(value) {
  return /(?:github\.head_ref|github\.event\.(?:comment\.body|discussion\.(?:body|title)|issue\.(?:body|number|title))|pull_request\.(?:head|merge_commit_sha)|head\.sha|refs\/pull\/|workflow_run\.(?:head_sha|id))/iu
    .test(normalizeExpressionPropertyAccess(value));
}

function normalizeExpressionPropertyAccess(value) {
  let normalized = value;
  let previous;
  do {
    previous = normalized;
    normalized = normalized.replace(
      /\[\s*(["'])([A-Za-z0-9_-]+)\1\s*\]/gu,
      ".$2",
    );
  } while (normalized !== previous);
  return normalized;
}

function actionReferences(text, scalarAnchors) {
  text = maskYamlBlockScalarBodies(text);
  return [
    ...workflowJobValues(text, "uses", scalarAnchors),
    ...workflowStepUsesValues(text, scalarAnchors),
  ].map((value) => resolveYamlScalarValue(value, scalarAnchors));
}

function workflowStepUsesValues(text, scalarAnchors) {
  return workflowStepPropertyGroups(text, scalarAnchors).flatMap(({ stepGroup }) => (
    stepGroup.properties
      .filter(({ entry }) => entry.key.toLowerCase() === "uses")
      .map(({ entry }) => entry.value)
  ));
}

function workflowStepPropertyGroups(text, scalarAnchors) {
  const stepGroups = [];
  for (const jobGroup of workflowJobPropertyGroups(text, scalarAnchors)) {
    stepGroups.push(...mappingContainerStepPropertyGroups(jobGroup, scalarAnchors)
      .map((stepGroup) => ({ jobGroup, stepGroup })));
  }
  return stepGroups;
}

function mappingContainerStepPropertyGroups(containerGroup, scalarAnchors) {
  const stepGroups = [];
  for (const property of containerGroup.properties) {
    if (property.entry.key.toLowerCase() !== "steps") continue;
    const inlineValue = property.entry.inlineValue ?? property.entry.value;
    const resolvedValue = resolveYamlScalarValue(inlineValue, scalarAnchors);
    const flowSteps = yamlFlowSequenceValues(resolvedValue);
    if (flowSteps) {
      for (const step of flowSteps) {
        const stepGroup = workflowStepPropertyGroupFromValue(
          step,
          containerGroup,
          scalarAnchors,
        );
        if (stepGroup) stepGroups.push(stepGroup);
      }
    }
    if (containerGroup.entries && property.index !== undefined) {
      stepGroups.push(...workflowBlockStepPropertyGroups(
        containerGroup,
        property.entry,
        scalarAnchors,
      ));
    }
    const entries = containerGroup.entries
      ?? yamlBlockMappingEntries(containerGroup.text, scalarAnchors);
    const aliasParent = yamlBlockSequenceAliasParentEntry(
      inlineValue,
      entries,
      scalarAnchors,
    );
    if (aliasParent) {
      stepGroups.push(...workflowBlockStepPropertyGroups(
        { ...containerGroup, entries },
        aliasParent,
        scalarAnchors,
      ));
    }
  }
  return stepGroups;
}

function workflowStepPropertyGroupFromValue(value, parentGroup, scalarAnchors) {
  const aliasProperties = yamlBlockAliasMappingEntries(
    value,
    parentGroup.blockNodeAnchors,
    scalarAnchors,
  );
  if (aliasProperties.length > 0) {
    return {
      blockNodeAnchors: parentGroup.blockNodeAnchors,
      entries: parentGroup.entries,
      properties: aliasProperties,
      text: parentGroup.text,
    };
  }
  const resolvedValue = resolveYamlScalarValue(value, scalarAnchors);
  const flowProperties = yamlDirectFlowMappingEntries(resolvedValue)
    .map((entry) => ({
      children: [],
      entry: { ...entry, key: resolveYamlScalarValue(entry.key, scalarAnchors) },
    }));
  return flowProperties.length > 0
    ? {
        blockNodeAnchors: parentGroup.blockNodeAnchors,
        entries: undefined,
        properties: flowProperties,
        text: parentGroup.text,
      }
    : undefined;
}

function workflowBlockStepPropertyGroups(jobGroup, stepsEntry, scalarAnchors) {
  const { entries, text } = jobGroup;
  const lines = text.split("\n");
  const startLine = stepsEntry.valueLineIndex + 1;
  let endLine = lines.length;
  for (let index = startLine; index < lines.length; index += 1) {
    if (lines[index].trim().length === 0) continue;
    if (/^\s*/u.exec(lines[index])[0].length <= stepsEntry.indentation) {
      endLine = index;
      break;
    }
  }
  const sequenceItems = [];
  for (let index = startLine; index < endLine; index += 1) {
    const match = /^(\s*)-\s*(.*)$/u.exec(lines[index]);
    if (match) sequenceItems.push({ indentation: match[1].length, lineIndex: index, value: match[2] });
  }
  if (sequenceItems.length === 0) return [];
  const stepIndentation = Math.min(...sequenceItems.map((item) => item.indentation));
  const steps = sequenceItems.filter((item) => item.indentation === stepIndentation);
  const groups = [];
  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex];
    const nextLine = steps[stepIndex + 1]?.lineIndex ?? endLine;
    const valueGroup = workflowStepPropertyGroupFromValue(step.value, jobGroup, scalarAnchors);
    if (valueGroup) {
      groups.push(valueGroup);
      continue;
    }

    const inlineEntry = parseYamlKeyLine(" ".repeat(step.indentation + 2) + step.value);
    const continuationEntries = entries.flatMap((entry, index) => entry.lineIndex > step.lineIndex
      && entry.lineIndex < nextLine
      && entry.indentation > step.indentation
      ? [{ entry, index }]
      : []);
    const mappingIndentation = inlineEntry?.indentation
      ?? (continuationEntries.length > 0
        ? Math.min(...continuationEntries.map(({ entry }) => entry.indentation))
        : undefined);
    if (mappingIndentation === undefined) continue;
    const properties = continuationEntries
      .filter(({ entry }) => entry.indentation === mappingIndentation);
    if (inlineEntry) {
      const inlineValue = inlineEntry.value.trim();
      let value = inlineValue;
      if (isYamlBlockScalarHeader(inlineValue)) {
        for (let lineIndex = step.lineIndex + 1; lineIndex < nextLine; lineIndex += 1) {
          const line = lines[lineIndex];
          if (line.trim().length > 0
            && /^\s*/u.exec(line)[0].length <= inlineEntry.indentation) break;
          value += "\n" + line.trimStart();
        }
      }
      properties.unshift({
        entry: {
          ...inlineEntry,
          inlineValue,
          lineIndex: step.lineIndex,
          value,
          valueLineIndex: step.lineIndex,
        },
      });
    }
    const scopedProperties = properties.map((property, propertyIndex) => {
      const nextPropertyLine = properties[propertyIndex + 1]?.entry.lineIndex ?? nextLine;
      const descendants = continuationEntries.filter(({ entry }) => (
        entry.lineIndex > property.entry.lineIndex
        && entry.lineIndex < nextPropertyLine
        && entry.indentation > property.entry.indentation
      ));
      const childIndentation = descendants.length > 0
        ? Math.min(...descendants.map(({ entry }) => entry.indentation))
        : undefined;
      return {
        ...property,
        children: childIndentation === undefined
          ? []
          : descendants.filter(({ entry }) => entry.indentation === childIndentation),
      };
    });
    groups.push({
      blockNodeAnchors: jobGroup.blockNodeAnchors,
      entries,
      properties: scopedProperties,
      text,
    });
  }
  return groups;
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
  const result = spawnSync("gh", [
    "api",
    "--hostname",
    "github.com",
    "--paginate",
    "--slurp",
    endpoint,
  ], {
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
  const result = spawnSync("gh", ["api", "--hostname", "github.com", endpoint], {
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
  const rulesetChecks = statusRules.flatMap((rule) => (
    rule.parameters?.required_status_checks ?? []
  ).map((check) => ({
    ...check,
    strict: rule.parameters?.strict_required_status_checks_policy === true,
  })));
  const classic = evidence.branchProtection;
  const classicChecks = classicStatusChecks(classic).map((check) => ({
    ...check,
    strict: classic?.required_status_checks?.strict === true,
  }));
  const requiredContexts = new Set([...rulesetChecks, ...classicChecks]
    .map((check) => check.context)
    .filter((context) => typeof context === "string"));
  const githubActionsContexts = new Set([
    ...rulesetChecks
      .filter((check) => check.integration_id === GITHUB_ACTIONS_APP_ID),
    ...classicChecks
      .filter((check) => check.app_id === GITHUB_ACTIONS_APP_ID),
  ].map((check) => check.context).filter((context) => typeof context === "string"));
  const strictGithubActionsContexts = new Set([...rulesetChecks, ...classicChecks]
    .filter((check) => check.strict
      && (check.integration_id === GITHUB_ACTIONS_APP_ID
        || check.app_id === GITHUB_ACTIONS_APP_ID))
    .map((check) => check.context)
    .filter((context) => typeof context === "string"));
  const forcePushProtected = rules.some((rule) => rule.type === "non_fast_forward")
    || classic?.allow_force_pushes?.enabled === false;
  const deletionProtected = rules.some((rule) => rule.type === "deletion")
    || classic?.allow_deletions?.enabled === false;
  const missingBypassEvidence = applicableRulesets
    .some((ruleset) => !Array.isArray(ruleset.bypass_actors));
  const bypassActors = applicableRulesets.flatMap((ruleset) => (
    Array.isArray(ruleset.bypass_actors) ? ruleset.bypass_actors : []
  ));
  const unbypassableRules = applicableRulesets
    .filter((ruleset) => Array.isArray(ruleset.bypass_actors)
      && ruleset.bypass_actors.length === 0)
    .flatMap((ruleset) => Array.isArray(ruleset.rules) ? ruleset.rules : []);
  const unbypassableStatusChecks = unbypassableRules
    .filter((rule) => rule.type === "required_status_checks")
    .flatMap((rule) => (rule.parameters?.required_status_checks ?? []).map((check) => ({
      ...check,
      strict: rule.parameters?.strict_required_status_checks_policy === true,
    })));
  if (classic?.enforce_admins?.enabled === true) {
    unbypassableStatusChecks.push(...classicChecks);
  }
  const unbypassableStrictGithubActionsContexts = new Set(unbypassableStatusChecks
    .filter((check) => check.strict
      && (check.integration_id === GITHUB_ACTIONS_APP_ID
        || check.app_id === GITHUB_ACTIONS_APP_ID))
    .map((check) => check.context)
    .filter((context) => typeof context === "string"));
  const statusChecksAreUnbypassable = requiredChecks.length > 0
    ? requiredChecks.every((context) => unbypassableStrictGithubActionsContexts.has(context))
    : unbypassableStrictGithubActionsContexts.size > 0;
  const forcePushProtectionIsUnbypassable = unbypassableRules
    .some((rule) => rule.type === "non_fast_forward")
    || (classic?.enforce_admins?.enabled === true
      && classic?.allow_force_pushes?.enabled === false);
  const deletionProtectionIsUnbypassable = unbypassableRules
    .some((rule) => rule.type === "deletion")
    || (classic?.enforce_admins?.enabled === true
      && classic?.allow_deletions?.enabled === false);
  const requiredProtectionIsUnbypassable = statusChecksAreUnbypassable
    && forcePushProtectionIsUnbypassable
    && deletionProtectionIsUnbypassable;

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
    } else if (!strictGithubActionsContexts.has(requiredCheck)) {
      findings.push(githubFinding(
        "github-required-check-not-strict",
        `Required status check ${requiredCheck} does not enforce an up-to-date default branch as a GitHub Actions check.`,
        requiredCheck,
      ));
    }
  }
  if (strictGithubActionsContexts.size === 0
    && (requiredChecks.length === 0
      || !requiredChecks.some((context) => requiredContexts.has(context)
        && githubActionsContexts.has(context)))) {
    findings.push(githubFinding("github-required-check-not-strict", "Required checks must enforce an up-to-date default branch."));
  }
  if (forcePushProtected === false) {
    findings.push(githubFinding("github-force-push-unprotected", "The default branch must reject non-fast-forward updates."));
  }
  if (deletionProtected === false) {
    findings.push(githubFinding("github-deletion-unprotected", "The default branch must reject deletion."));
  }
  const protectionHasPotentialBypass = bypassActors.length > 0
    || (classic && classic.enforce_admins?.enabled !== true);
  if (missingBypassEvidence
    || (protectionHasPotentialBypass && !requiredProtectionIsUnbypassable)) {
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
  const rawContent = pattern.slice(openingIndex + 1, closingIndex);
  if (rawContent.length === 0) return undefined;
  const negated = rawContent.startsWith("!") && rawContent.length > 1;
  const content = negated ? rawContent.slice(1) : rawContent;
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
    expression: `(?=[^/])[${negated ? "^" : ""}${expression}]`,
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
  const environment = { ...process.env };
  for (const name of [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
    "GIT_DIR",
    "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE",
    "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_REPLACE_REF_BASE",
    "GIT_SHALLOW_FILE",
    "GIT_WORK_TREE",
  ]) {
    delete environment[name];
  }
  for (const name of Object.keys(environment)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(name)) delete environment[name];
  }
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  return environment;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
