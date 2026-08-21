import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

const AUDIT_SCRIPT = path.resolve(
  import.meta.dirname,
  "..",
  "scripts",
  "public-source-release-audit.mjs",
);
const temporaryRoots = new Set();

afterEach(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { force: true, recursive: true });
  }
  temporaryRoots.clear();
});

test("a safe committed repository passes", () => {
  const repoRoot = makeRepository();
  write(repoRoot, "docs/example.txt", [
    "Generic examples are allowed:",
    ["", "Users", "test", "project"].join("/"),
    ["", "home", "runner", "work"].join("/"),
    "https://example.invalid/users/me",
    "",
  ].join("\n"));
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe examples");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.passed, true);
  assert.deepEqual(audit.result.findings, []);
});

test("the staged candidate cannot be hidden by a clean working-tree replacement", () => {
  const repoRoot = makeRepository();
  const credential = classicToken("a");
  write(repoRoot, "candidate.txt", credential);
  git(repoRoot, ["add", "candidate.txt"]);
  write(repoRoot, "candidate.txt", "clean replacement\n");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "access-token", "candidate.txt");
  assert.doesNotMatch(audit.stdout, new RegExp(credential, "u"));
});

test("an unsafe HEAD cannot be hidden by a staged clean replacement", () => {
  const repoRoot = makeRepository();
  write(repoRoot, "published.txt", classicToken("b"));
  commitAll(repoRoot, "publish fixture");
  write(repoRoot, "published.txt", "clean replacement\n");
  git(repoRoot, ["add", "published.txt"]);

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "access-token", "published.txt");
});

test("credential and private-key formats are release-blocking", () => {
  const repoRoot = makeRepository();
  write(repoRoot, "classic.txt", classicToken("c"));
  write(repoRoot, "fine-grained.txt", fineGrainedToken("d"));
  write(repoRoot, "app-jwt.txt", githubAppJwt());
  write(repoRoot, "bearer.txt", ["Authorization:", "Bearer", "b".repeat(32)].join(" "));
  write(repoRoot, "private-key.txt", privateKeyBlock());
  commitAll(repoRoot, "add credential fixtures");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "access-token", "classic.txt");
  assertFinding(audit.result, "access-token", "fine-grained.txt");
  assertFinding(audit.result, "access-token", "app-jwt.txt");
  assertFinding(audit.result, "access-token", "bearer.txt");
  assertFinding(audit.result, "private-key", "private-key.txt");
});

test("private POSIX, Windows, and root machine paths are release-blocking", () => {
  const repoRoot = makeRepository();
  write(repoRoot, "posix.txt", ["", "Users", "private-person", "project"].join("/"));
  write(repoRoot, "windows.txt", ["C:", "Users", "private-person", "project"].join("\\"));
  write(repoRoot, "root.txt", ["", "root", "private-project"].join("/"));
  commitAll(repoRoot, "add private path fixtures");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "machine-home-path", "posix.txt");
  assertFinding(audit.result, "machine-home-path", "windows.txt");
  assertFinding(audit.result, "machine-home-path", "root.txt");
});

test("tracked filenames and symlink targets are scanned and redacted", () => {
  const repoRoot = makeRepository();
  const credential = classicToken("e");
  write(repoRoot, `backup-${credential}.txt`, "clean\n");
  write(repoRoot, `.github/workflows/${credential}.yml`, [
    "name: unsafe path",
    "on: push",
    "jobs:",
    "  test:",
    "    runs-on: self-hosted",
    "",
  ].join("\n"));
  const linkPath = path.join(repoRoot, "private-link");
  symlinkSync(["", "home", "private-person", "artifact"].join("/"), linkPath);
  commitAll(repoRoot, "add path fixtures");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "access-token", "backup-[REDACTED].txt");
  assertFinding(audit.result, "machine-home-path", "private-link");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/[REDACTED].yml");
  assert.doesNotMatch(audit.stdout, new RegExp(credential, "u"));
  assert.doesNotMatch(audit.stdout, /private-person/u);
});

test("UTF-16 and UTF-32 encoded credentials are scanned", () => {
  const repoRoot = makeRepository();
  write(repoRoot, "utf16.bin", Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(classicToken("f"), "utf16le"),
  ]));
  write(repoRoot, "utf32.bin", encodeUtf32WithBom(fineGrainedToken("g")));
  commitAll(repoRoot, "add encoded fixtures");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "access-token", "utf16.bin");
  assertFinding(audit.result, "access-token", "utf32.bin");
});

test("an unavailable Git LFS object fails closed", () => {
  const repoRoot = makeRepository();
  write(repoRoot, "large.fixture", [
    "version https://git-lfs.github.com/spec/v1",
    `oid sha256:${"a".repeat(64)}`,
    "size 128",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add unavailable LFS fixture");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "git-lfs-pointer", "large.fixture");
});

test("history mode catches removed content and sensitive commit messages", () => {
  const repoRoot = makeRepository();
  write(repoRoot, "removed.txt", classicToken("h"));
  commitAll(repoRoot, "add removed fixture");
  rmSync(path.join(repoRoot, "removed.txt"));
  commitAll(repoRoot, "remove fixture");
  git(repoRoot, ["commit", "--allow-empty", "-m", `record ${githubAppJwt()}`]);

  const currentAudit = runAudit(repoRoot);
  const historyAudit = runAudit(repoRoot, ["--history"]);

  assert.equal(currentAudit.status, 0);
  assert.equal(historyAudit.status, 1);
  assertFinding(historyAudit.result, "access-token");
  assert.equal(historyAudit.result.historyScanned, true);
  assert.ok(historyAudit.result.scannedHistoryCommitCount >= 4);
});

test("history mode detects bearer credentials in commit messages", () => {
  const repoRoot = makeRepository();
  git(repoRoot, [
    "commit",
    "--allow-empty",
    "-m",
    ["Authorization:", "Bearer", "c".repeat(32)].join(" "),
  ]);

  const currentAudit = runAudit(repoRoot);
  const historyAudit = runAudit(repoRoot, ["--history"]);

  assert.equal(currentAudit.status, 0);
  assert.equal(historyAudit.status, 1);
  assertFinding(historyAudit.result, "access-token");
});

test("history mode scans workflows on every reachable branch", () => {
  const repoRoot = makeRepository();
  const defaultBranch = git(repoRoot, ["branch", "--show-current"]).stdout.trim();
  git(repoRoot, ["checkout", "--quiet", "-b", "public-alternate"]);
  write(repoRoot, ".github/workflows/alternate.yml", [
    "name: alternate",
    "on: push",
    "permissions: write-all",
    "jobs:",
    "  unsafe:",
    "    runs-on: self-hosted",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add alternate workflow");
  git(repoRoot, ["checkout", "--quiet", defaultBranch]);

  const currentAudit = runAudit(repoRoot);
  const historyAudit = runAudit(repoRoot, ["--history"]);

  assert.equal(currentAudit.status, 0);
  assert.equal(historyAudit.status, 1);
  assertFinding(historyAudit.result, "workflow-write-all", ".github/workflows/alternate.yml");
  assertFinding(historyAudit.result, "workflow-self-hosted-runner", ".github/workflows/alternate.yml");
});

test("workflow history ignores local Git replacement objects", () => {
  const repoRoot = makeRepository();
  const defaultBranch = git(repoRoot, ["branch", "--show-current"]).stdout.trim();
  git(repoRoot, ["checkout", "--quiet", "-b", "public-unsafe"]);
  write(repoRoot, ".github/workflows/replaced.yml", [
    "name: replaced",
    "on: push",
    "jobs:",
    "  unsafe:",
    "    runs-on: self-hosted",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add unsafe workflow");
  const unsafeCommit = git(repoRoot, ["rev-parse", "HEAD"]).stdout.trim();
  git(repoRoot, ["checkout", "--quiet", defaultBranch]);
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const safeCommit = git(repoRoot, ["rev-parse", "HEAD"]).stdout.trim();
  git(repoRoot, ["replace", unsafeCommit, safeCommit]);

  const currentAudit = runAudit(repoRoot);
  const historyAudit = runAudit(repoRoot, ["--history"]);

  assert.equal(currentAudit.status, 0);
  assert.equal(historyAudit.status, 1);
  assertFinding(historyAudit.result, "workflow-self-hosted-runner", ".github/workflows/replaced.yml");
});

test("history mode rejects shallow evidence", () => {
  const repoRoot = makeRepository();
  const head = git(repoRoot, ["rev-parse", "HEAD"]).stdout.trim();
  write(repoRoot, ".git/shallow", `${head}\n`);

  const audit = runAudit(repoRoot, ["--history"]);

  assert.equal(audit.status, 2);
  assert.equal(audit.result.passed, false);
  assert.equal(audit.result.error.code, "audit-error");
  assert.match(audit.result.error.message, /shallow/u);
});

test("workflow advisories can be promoted to failures", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/advisory.yml", [
    "name: advisory",
    "on: [pull_request_target]",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: example/action@v1",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add advisory workflow");

  const defaultAudit = runAudit(repoRoot);
  const strictAudit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(defaultAudit.status, 0);
  assert.equal(defaultAudit.result.warningCount, 2);
  assertFinding(defaultAudit.result, "workflow-pull-request-target", ".github/workflows/advisory.yml");
  assertFinding(defaultAudit.result, "workflow-mutable-action-ref", ".github/workflows/advisory.yml");
  assert.equal(strictAudit.status, 1);
  assert.equal(strictAudit.result.passed, false);
});

test("quoted self-hosted runner labels are release-blocking", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/quoted-scalar.yml", [
    "name: quoted scalar",
    "on: push",
    "jobs:",
    "  unsafe:",
    "    runs-on: \"self-hosted\"",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/quoted-array.yml", [
    "name: quoted array",
    "on: push",
    "jobs:",
    "  unsafe:",
    "    runs-on: ['self-hosted', macOS]",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add quoted runner workflows");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/quoted-scalar.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/quoted-array.yml");
});

test("quoted permissions keys and write-all values are release-blocking", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/quoted-permissions-value.yml", [
    "name: quoted permissions value",
    "on: push",
    "permissions: \"write-all\"",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/quoted-permissions-key.yml", [
    "name: quoted permissions key",
    "on: push",
    "\"permissions\": 'write-all'",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add quoted permissions workflows");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/quoted-permissions-value.yml");
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/quoted-permissions-key.yml");
});

test("block-scalar write-all permissions are release-blocking", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/block-permissions.yml", [
    "name: block permissions",
    "on: push",
    "permissions: >-",
    "  write-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add block permissions workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/block-permissions.yml");
});

test("anchored write-all permissions are release-blocking", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/anchored-permissions.yml", [
    "name: anchored permissions",
    "on: push",
    "permissions: &all write-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add anchored permissions workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/anchored-permissions.yml");
});

test("quoted runs-on keys cannot hide self-hosted labels", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/quoted-runner-key.yml", [
    "name: quoted runner key",
    "on: push",
    "jobs:",
    "  unsafe:",
    "    \"runs-on\": \"self-hosted\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add quoted runner key workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/quoted-runner-key.yml");
});

test("block-list privileged triggers detect reordered checkout inputs", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/reordered-checkout.yml", [
    "name: reordered checkout",
    "on:",
    "  - pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: inspect",
    "        with:",
    ["          ref: ", "$", "{{ github.event.pull_request.head.sha }}"].join(""),
    "        \"uses\": \"actions/checkout@" + "a".repeat(40) + "\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add reordered checkout workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-pull-request-target", ".github/workflows/reordered-checkout.yml");
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/reordered-checkout.yml");
});

test("github head_ref is an untrusted privileged checkout source", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/head-ref-checkout.yml", [
    "name: head ref checkout",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - { uses: actions/checkout@" + "a".repeat(40) + ", with: { ref: " + expression + " } }",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add head ref checkout workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/head-ref-checkout.yml");
});

test("pull-request merge refs are untrusted privileged checkout sources", () => {
  const repoRoot = makeRepository();
  const numberExpression = ["$", "{{ github.event.pull_request.number }}"].join("");
  write(repoRoot, ".github/workflows/merge-ref-checkout.yml", [
    "name: merge ref checkout",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: refs/pull/" + numberExpression + "/merge",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add merge ref checkout workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/merge-ref-checkout.yml");
});

test("mutable Docker actions warn while digest-pinned actions pass", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/mutable-docker.yml", [
    "name: mutable docker",
    "on: push",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: docker://alpine:latest",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/pinned-docker.yml", [
    "name: pinned docker",
    "on: push",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - uses: docker://alpine@sha256:${"a".repeat(64)}`,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add Docker action workflows");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.warningCount, 1);
  assertFinding(audit.result, "workflow-mutable-action-ref", ".github/workflows/mutable-docker.yml");
  assert.equal(audit.result.findings.some((finding) => finding.path === ".github/workflows/pinned-docker.yml"), false);
});

test("flow-style mutable action references emit an advisory", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/flow-action.yml", [
    "name: flow action",
    "on: push",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - { name: inspect, uses: example/action@main }",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add flow action workflow");

  const defaultAudit = runAudit(repoRoot);
  const strictAudit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(defaultAudit.status, 0);
  assertFinding(defaultAudit.result, "workflow-mutable-action-ref", ".github/workflows/flow-action.yml");
  assert.equal(strictAudit.status, 1);
});

test("runner-group selectors require proof of hosted isolation", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/flow-runner-group.yml", [
    "name: flow runner group",
    "on: push",
    "jobs:",
    "  inspect:",
    "    runs-on: { group: private-runners }",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/block-runner-group.yml", [
    "name: block runner group",
    "on: push",
    "jobs:",
    "  inspect:",
    "    runs-on:",
    "      group: private-runners",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add runner group workflows");

  const defaultAudit = runAudit(repoRoot);
  const strictAudit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(defaultAudit.status, 0);
  assertFinding(defaultAudit.result, "workflow-dynamic-runner", ".github/workflows/flow-runner-group.yml");
  assertFinding(defaultAudit.result, "workflow-dynamic-runner", ".github/workflows/block-runner-group.yml");
  assert.equal(strictAudit.status, 1);
});

test("unknown static runner labels require proof of hosted isolation", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/custom-runner-label.yml", [
    "name: custom runner label",
    "on: push",
    "jobs:",
    "  inspect:",
    "    runs-on: production-runner",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add custom runner label workflow");

  const defaultAudit = runAudit(repoRoot);
  const strictAudit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(defaultAudit.status, 0);
  assertFinding(defaultAudit.result, "workflow-dynamic-runner", ".github/workflows/custom-runner-label.yml");
  assert.equal(strictAudit.status, 1);
});

test("standard GitHub-hosted runner labels remain trusted", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/hosted-runner-labels.yml", [
    "name: hosted runner labels",
    "on: push",
    "jobs:",
    "  slim:",
    "    runs-on: ubuntu-slim",
    "  linux-arm:",
    "    runs-on: ubuntu-26.04-arm",
    "  windows:",
    "    runs-on: windows-2025-vs2026",
    "  windows-arm:",
    "    runs-on: windows-11-vs2026-arm",
    "  mac-intel:",
    "    runs-on: macos-15-intel",
    "  xcode:",
    "    runs-on: xcode-27",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add hosted runner label workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.warningCount, 0);
});

test("unsafe public workflow execution is release-blocking", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/unsafe.yml", [
    "name: unsafe",
    "on:",
    "  pull_request_target:",
    "permissions: write-all",
    "jobs:",
    "  execute:",
    "    runs-on: [self-hosted, macOS]",
    "    steps:",
    `      - uses: "actions/checkout@${"a".repeat(40)}"`,
    "        with:",
    "          ref: ${{ github.event.pull_request.head.sha }}",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add unsafe workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/unsafe.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/unsafe.yml");
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/unsafe.yml");
});

test("a protected public GitHub snapshot passes", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const snapshotPath = writeSnapshot(githubSnapshot());

  const audit = runAudit(repoRoot, [
    "--github-snapshot", snapshotPath,
    "--required-check", "verify",
  ]);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.githubChecked, true);
  assert.equal(audit.result.passed, true);

  const unboundSnapshot = githubSnapshot();
  unboundSnapshot.rulesets[0].rules[2].parameters.required_status_checks[0].integration_id = 999;
  const unboundAudit = runAudit(repoRoot, [
    "--github-snapshot", writeSnapshot(unboundSnapshot),
    "--required-check", "verify",
  ]);
  assert.equal(unboundAudit.status, 1);
  assertFinding(unboundAudit.result, "github-required-check-not-github-actions");
});

test("each missing requested status check remains a distinct finding", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const audit = runAudit(repoRoot, [
    "--github-snapshot", writeSnapshot(githubSnapshot()),
    "--required-check", "first-check",
    "--required-check", "second-check",
  ]);

  const missingChecks = audit.result.findings
    .filter((finding) => finding.ruleId === "github-required-check-missing");
  assert.equal(audit.status, 1);
  assert.equal(audit.result.errorCount, 2);
  assert.equal(audit.result.findingCount, 2);
  assert.deepEqual(missingChecks.map((finding) => finding.check).sort(), ["first-check", "second-check"]);
});

test("the all-branches ruleset selector protects the default branch", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const snapshot = githubSnapshot();
  snapshot.rulesets[0].conditions.ref_name.include = ["~ALL"];

  const audit = runAudit(repoRoot, [
    "--github-snapshot", writeSnapshot(snapshot),
    "--required-check", "verify",
  ]);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.passed, true);
});

test("ruleset question globs do not cross branch separators", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const snapshot = githubSnapshot();
  snapshot.repository.default_branch = "release/main";
  snapshot.rulesets[0].conditions.ref_name.include = ["refs/heads/release?main"];

  const audit = runAudit(repoRoot, [
    "--github-snapshot", writeSnapshot(snapshot),
    "--required-check", "verify",
  ]);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "github-required-check-missing");
});

test("live GitHub evidence consumes every ruleset page", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const snapshot = githubSnapshot();
  const laterRuleset = {
    bypass_actors: [{ actor_id: 1, actor_type: "OrganizationAdmin" }],
    conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
    enforcement: "active",
    rules: [],
    target: "branch",
  };
  const fakeGhDirectory = writeFakeGh({
    branchProtection: null,
    repository: snapshot.repository,
    rulesetPages: [[{ id: 1 }], [{ id: 2 }]],
    rulesets: { 1: snapshot.rulesets[0], 2: laterRuleset },
    runners: snapshot.runners,
  });

  const audit = runAudit(repoRoot, [
    "--github", "example/public",
    "--required-check", "verify",
  ], {
    env: { ...process.env, PATH: `${fakeGhDirectory}:${process.env.PATH}` },
  });

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "github-protection-bypass");
});

test("wrapper counts source findings omitted by the core scanner", () => {
  const repoRoot = makeRepository();
  for (let index = 0; index < 30; index += 1) {
    write(repoRoot, `credential-${index}.txt`, classicToken(String.fromCharCode(97 + (index % 26))));
  }
  commitAll(repoRoot, "add many credential fixtures");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assert.equal(audit.result.findingCount, 31);
  assert.equal(audit.result.errorCount, 31);
  assert.equal(audit.result.warningCount, 0);
  assert.equal(audit.result.omittedFindingCount, 5);
  assertFinding(audit.result, "source-findings-omitted");
});

test("missing GitHub protections and runner isolation fail together", () => {
  const repoRoot = makeRepository();
  const snapshot = githubSnapshot();
  snapshot.repository.private = true;
  snapshot.repository.visibility = "private";
  snapshot.repository.security_and_analysis.secret_scanning.status = "disabled";
  snapshot.repository.security_and_analysis.secret_scanning_push_protection.status = "disabled";
  snapshot.rulesets[0].bypass_actors = [{ actor_id: 1, actor_type: "OrganizationAdmin" }];
  snapshot.rulesets[0].rules = [{
    type: "required_status_checks",
    parameters: {
      required_status_checks: [{ context: "other" }],
      strict_required_status_checks_policy: false,
    },
  }];
  snapshot.runners = { runners: [{ id: 1, name: "persistent-runner" }], total_count: 1 };
  const snapshotPath = writeSnapshot(snapshot);

  const audit = runAudit(repoRoot, [
    "--github-snapshot", snapshotPath,
    "--required-check", "verify",
  ]);

  assert.equal(audit.status, 1);
  for (const ruleId of [
    "github-repository-not-public",
    "github-secret-scanning-disabled",
    "github-push-protection-disabled",
    "github-required-check-missing",
    "github-required-check-not-github-actions",
    "github-required-check-not-strict",
    "github-force-push-unprotected",
    "github-deletion-unprotected",
    "github-protection-bypass",
    "github-self-hosted-runner-access",
  ]) {
    assertFinding(audit.result, ruleId);
  }
});

test("incomplete GitHub evidence fails closed", () => {
  const repoRoot = makeRepository();
  const snapshotPath = writeSnapshot({ repository: {}, rulesets: [] });

  const audit = runAudit(repoRoot, ["--github-snapshot", snapshotPath]);

  assert.equal(audit.status, 2);
  assert.equal(audit.result.passed, false);
  assert.equal(audit.result.error.code, "audit-error");
});

test("required checks cannot be requested without GitHub evidence", () => {
  const repoRoot = makeRepository();

  const audit = runAudit(repoRoot, ["--required-check", "verify"]);

  assert.equal(audit.status, 2);
  assert.equal(audit.result.passed, false);
  assert.equal(audit.result.error.code, "usage-error");
});

test("invalid arguments return a distinct usage failure", () => {
  const repoRoot = makeRepository();

  const audit = runAudit(repoRoot, ["--unsupported"]);

  assert.equal(audit.status, 2);
  assert.equal(audit.result.passed, false);
  assert.equal(audit.result.error.code, "usage-error");
});

function makeRepository() {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "public-source-audit-"));
  temporaryRoots.add(repoRoot);
  git(repoRoot, ["init", "--quiet"]);
  git(repoRoot, ["config", "user.name", "Audit Fixture"]);
  git(repoRoot, ["config", "user.email", "fixture@example.invalid"]);
  write(repoRoot, "README.md", "fixture repository\n");
  commitAll(repoRoot, "initial fixture");
  return repoRoot;
}

function write(repoRoot, relativePath, content) {
  const destination = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

function commitAll(repoRoot, message) {
  git(repoRoot, ["add", "--all"]);
  git(repoRoot, ["commit", "--quiet", "-m", message]);
}

function git(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(result.status, 0, `git ${args[0]} failed: ${result.stderr}`);
  return result;
}

function runAudit(repoRoot, args = [], { appendJsonFormat = true, env = process.env } = {}) {
  const commandArguments = [AUDIT_SCRIPT, "--repo", repoRoot, ...args];
  if (appendJsonFormat) commandArguments.push("--format", "json");
  else if (!args.includes("--format")) commandArguments.push("--format", "json");
  const result = spawnSync(process.execPath, commandArguments, {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.notEqual(result.status, null, `audit did not exit: ${result.error?.message ?? "unknown error"}`);
  assert.doesNotMatch(result.stderr, /credential|private-person/iu);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`audit returned invalid JSON: ${error.message}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return { result: parsed, status: result.status, stderr: result.stderr, stdout: result.stdout };
}

function assertFinding(result, ruleId, findingPath) {
  assert.ok(result.findings.some((finding) => finding.ruleId === ruleId
    && (findingPath === undefined || finding.path === findingPath)),
  `missing ${ruleId}${findingPath ? ` at ${findingPath}` : ""}: ${JSON.stringify(result.findings)}`);
}

function classicToken(character) {
  return ["ghp_", character.repeat(36)].join("");
}

function fineGrainedToken(character) {
  return ["github_", "pat_", character.repeat(32)].join("");
}

function githubAppJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: 1_700_000_300, iat: 1_700_000_000, iss: "123456" })).toString("base64url");
  const signature = Buffer.from("fixture-signature-material").toString("base64url");
  return [header, payload, signature].join(".");
}

function privateKeyBlock() {
  const boundary = (verb) => [["-----", verb].join(""), "PRIVATE KEY-----"].join(" ");
  return [boundary("BEGIN"), "A".repeat(64), boundary("END"), ""].join("\n");
}

function encodeUtf32WithBom(source) {
  const body = Buffer.alloc([...source].length * 4);
  [...source].forEach((character, index) => {
    body.writeUInt32LE(character.codePointAt(0), index * 4);
  });
  return Buffer.concat([Buffer.from([0xff, 0xfe, 0, 0]), body]);
}

function writeSafeWorkflow(repoRoot) {
  write(repoRoot, ".github/workflows/verify.yml", [
    "name: verify",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  verify:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - uses: actions/checkout@${"a".repeat(40)}`,
    "",
  ].join("\n"));
}

function githubSnapshot() {
  return {
    branchProtection: null,
    repository: {
      default_branch: "main",
      private: false,
      security_and_analysis: {
        secret_scanning: { status: "enabled" },
        secret_scanning_push_protection: { status: "enabled" },
      },
      visibility: "public",
    },
    rulesets: [{
      bypass_actors: [],
      conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
      enforcement: "active",
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          parameters: {
            required_status_checks: [{ context: "verify", integration_id: 15368 }],
            strict_required_status_checks_policy: true,
          },
          type: "required_status_checks",
        },
      ],
      target: "branch",
    }],
    runners: { runners: [], total_count: 0 },
  };
}

function writeSnapshot(snapshot) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "public-source-github-"));
  temporaryRoots.add(directory);
  const snapshotPath = path.join(directory, "snapshot.json");
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`);
  return snapshotPath;
}

function writeFakeGh(fixture) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "public-source-fake-gh-"));
  temporaryRoots.add(directory);
  const executablePath = path.join(directory, "gh");
  const script = [
    "#!/usr/bin/env node",
    `const fixture = ${JSON.stringify(fixture)};`,
    "const args = process.argv.slice(2);",
    "const endpoint = args.find((argument) => argument.startsWith('repos/'));",
    "let response;",
    "if (endpoint === 'repos/example/public') response = fixture.repository;",
    "else if (endpoint === 'repos/example/public/rulesets?includes_parents=true&per_page=100') {",
    "  if (!args.includes('--paginate') || !args.includes('--slurp')) process.exit(3);",
    "  response = fixture.rulesetPages;",
    "}",
    "else if (endpoint?.startsWith('repos/example/public/rulesets/')) {",
    "  response = fixture.rulesets[endpoint.split('/').at(-1)];",
    "}",
    "else if (endpoint === 'repos/example/public/actions/runners') response = fixture.runners;",
    "else if (endpoint === 'repos/example/public/branches/main/protection') response = fixture.branchProtection;",
    "else process.exit(4);",
    "process.stdout.write(JSON.stringify(response) + '\\n');",
    "",
  ].join("\n");
  writeFileSync(executablePath, script);
  chmodSync(executablePath, 0o755);
  return directory;
}
