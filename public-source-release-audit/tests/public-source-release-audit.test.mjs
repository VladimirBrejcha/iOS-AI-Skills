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

test("Git environment variables cannot redirect the audited index", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  write(repoRoot, "candidate.txt", classicToken("z"));
  git(repoRoot, ["add", "candidate.txt"]);
  const alternateDirectory = mkdtempSync(path.join(os.tmpdir(), "public-source-index-"));
  temporaryRoots.add(alternateDirectory);
  const alternateIndex = path.join(alternateDirectory, "index");
  const readTree = spawnSync("git", ["read-tree", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, GIT_INDEX_FILE: alternateIndex },
  });
  assert.equal(readTree.status, 0, readTree.stderr);

  const audit = runAudit(repoRoot, [], {
    env: { ...process.env, GIT_INDEX_FILE: alternateIndex },
  });

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "access-token", "candidate.txt");
});

test("staged blob versions do not inflate the tracked path count", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  write(repoRoot, "README.md", "updated fixture repository\n");
  git(repoRoot, ["add", "README.md"]);

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.scannedTrackedFileCount, 2);
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
  write(repoRoot, "bearer-symbols.txt", ["Authorization: Bearer AAAA+", "BBBB/CCCC=DDDD\n"].join(""));
  write(repoRoot, "refresh.txt", ["ghr_", "r".repeat(76)].join(""));
  write(repoRoot, "private-key.txt", privateKeyBlock());
  commitAll(repoRoot, "add credential fixtures");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "access-token", "classic.txt");
  assertFinding(audit.result, "access-token", "fine-grained.txt");
  assertFinding(audit.result, "access-token", "app-jwt.txt");
  assertFinding(audit.result, "access-token", "bearer.txt");
  assertFinding(audit.result, "access-token", "bearer-symbols.txt");
  assertFinding(audit.result, "access-token", "refresh.txt");
  assertFinding(audit.result, "private-key", "private-key.txt");
});

test("CR-only private-key blocks are detected by buffered and streaming scans", () => {
  const repoRoot = makeRepository();
  const crOnlyKey = privateKeyBlock().replaceAll("\n", "\r");
  write(repoRoot, "cr-private-key.txt", crOnlyKey);
  write(repoRoot, "large-cr-private-key.txt", Buffer.concat([
    Buffer.alloc(64 * 1024 * 1024, 0x78),
    Buffer.from("\r" + crOnlyKey),
  ]));
  commitAll(repoRoot, "add CR-only private-key fixtures");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "private-key", "cr-private-key.txt");
  assertFinding(audit.result, "private-key", "large-cr-private-key.txt");
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

test("partial clones fail before the audit can lazily fetch objects", () => {
  const sourceRoot = makeRepository();
  write(sourceRoot, "source-only.txt", "source-only fixture\n");
  commitAll(sourceRoot, "add source-only fixture");
  git(sourceRoot, ["config", "uploadpack.allowFilter", "true"]);
  git(sourceRoot, ["config", "uploadpack.allowAnySHA1InWant", "true"]);
  const cloneParent = mkdtempSync(path.join(os.tmpdir(), "public-source-partial-clone-"));
  temporaryRoots.add(cloneParent);
  const cloneRoot = path.join(cloneParent, "clone");
  const clone = spawnSync("git", [
    "clone", "--quiet", "--filter=blob:none", "--no-checkout",
    `file://${sourceRoot}`, cloneRoot,
  ], {
    encoding: "utf8",
    env: process.env,
  });
  assert.equal(clone.status, 0, clone.stderr);
  const missingBefore = missingGitObjectIds(cloneRoot);
  assert.ok(missingBefore.length > 0, "fixture partial clone must omit at least one object");

  const audit = runAudit(cloneRoot);

  assert.equal(audit.status, 2);
  assert.equal(audit.result.passed, false);
  assert.equal(audit.result.error.code, "audit-error");
  assert.match(audit.result.error.message, /partial clone/u);
  assert.deepEqual(missingGitObjectIds(cloneRoot), missingBefore);
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

test("only workflow and job permissions grant token access", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/action-inputs.yml", [
    "name: action inputs",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - { uses: 'example/action@" + "a".repeat(40) + "', with: { permissions: write-all, runs-on: self-hosted } }",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/job-permissions.yml", [
    "name: job permissions",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    permissions: write-all",
    "    runs-on: ubuntu-latest",
    "",
  ].join("\n"));
  write(
    repoRoot,
    ".github/workflows/flow-job-permissions.yml",
    "{name: flow job permissions, on: push, permissions: read-all, jobs: {inspect: {permissions: write-all, runs-on: ubuntu-latest}}}\n",
  );
  commitAll(repoRoot, "add scoped permission workflows");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/job-permissions.yml");
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/flow-job-permissions.yml");
  assert.equal(audit.result.findings.some((finding) => finding.path === ".github/workflows/action-inputs.yml"), false);
});

test("explicit YAML mapping keys preserve guarded workflow settings", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/explicit-keys.yml", [
    "name: explicit keys",
    "on: push",
    "? permissions",
    ": write-all",
    "jobs:",
    "  build:",
    "    ? runs-on",
    "    : self-hosted",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add explicit key workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/explicit-keys.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/explicit-keys.yml");
});

test("YAML node properties preceding keys preserve guarded workflow settings", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/key-properties.yml", [
    "name: key properties",
    "on: push",
    "&permission-key permissions: write-all",
    "jobs:",
    "  build:",
    "    &runner-key runs-on: self-hosted",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add key property workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/key-properties.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/key-properties.yml");
});

test("scalar aliases used as keys preserve guarded workflow settings", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/aliased-keys.yml", [
    "name: &permission-key permissions",
    "x-runner: &runner-key runs-on",
    "on: push",
    "*permission-key: write-all",
    "jobs:",
    "  build:",
    "    *runner-key: self-hosted",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add aliased key workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/aliased-keys.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/aliased-keys.yml");
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

test("block-scalar public triggers remain privileged", () => {
  const repoRoot = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  write(repoRoot, ".github/workflows/block-trigger.yml", [
    "name: block trigger",
    "on: >-",
    "  issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo \"comment=" + bodyExpression + "\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add block scalar trigger");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/block-trigger.yml",
  );
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

test("aliased write-all permissions are release-blocking", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/aliased-permissions.yml", [
    "name: aliased permissions",
    "on: push",
    "x-all: &all write-all",
    "permissions: *all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add aliased permissions workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/aliased-permissions.yml");
});

test("aliased privileged triggers remain guarded", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/aliased-trigger.yml", [
    "name: &event pull_request_target",
    "on: *event",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add aliased trigger workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-pull-request-target", ".github/workflows/aliased-trigger.yml");
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/aliased-trigger.yml");
});

test("block-node aliases used as triggers remain guarded", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/block-aliased-trigger.yml", [
    "name: block aliased trigger",
    "x-events: &events",
    "  pull_request_target:",
    "on: *events",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add block aliased trigger workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-pull-request-target", ".github/workflows/block-aliased-trigger.yml");
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/block-aliased-trigger.yml");
});

test("block-sequence aliases used as triggers remain guarded", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/sequence-aliased-trigger.yml", [
    "name: sequence aliased trigger",
    "x-events: &events",
    "  - pull_request_target",
    "on: *events",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add sequence aliased trigger workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-pull-request-target", ".github/workflows/sequence-aliased-trigger.yml");
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/sequence-aliased-trigger.yml");
});

test("flow-style workflow mappings preserve guarded key checks", () => {
  const repoRoot = makeRepository();
  write(
    repoRoot,
    ".github/workflows/flow-document.yml",
    "{name: unsafe, on: push, \"permissions\": write-all, jobs: {build: {'runs-on': self-hosted}}}\n",
  );
  commitAll(repoRoot, "add flow workflow document");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/flow-document.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/flow-document.yml");
});

test("explicit keys in flow mappings preserve guarded workflow settings", () => {
  const repoRoot = makeRepository();
  write(
    repoRoot,
    ".github/workflows/explicit-flow-keys.yml",
    "{on: push, ? permissions: write-all, jobs: {build: {? runs-on: self-hosted}}}\n",
  );
  commitAll(repoRoot, "add explicit flow key workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/explicit-flow-keys.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/explicit-flow-keys.yml");
});

test("indented flow job mappings preserve guarded key checks", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/indented-flow-jobs.yml", [
    "name: indented flow jobs",
    "on: push",
    "jobs:",
    "  {build: {permissions: write-all, runs-on: self-hosted}}",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add indented flow jobs workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/indented-flow-jobs.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/indented-flow-jobs.yml");
});

test("flow-style step sequences preserve privileged checkout checks", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  const workflow = "{on: pull_request_target, permissions: read-all, jobs: {build: {runs-on: ubuntu-latest, steps: ["
    + "{uses: actions/checkout@" + "a".repeat(40) + ", with: {ref: '" + expression + "'}}, "
    + "{run: ./script.sh}]}}}\n";
  write(repoRoot, ".github/workflows/flow-steps.yml", workflow);
  commitAll(repoRoot, "add flow steps workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/flow-steps.yml");
});

test("aliased checkout actions remain guarded", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/aliased-checkout.yml", [
    "name: aliased checkout",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: &checkout actions/checkout@" + "a".repeat(40),
    "      - uses: *checkout",
    "        with:",
    "          ref: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add aliased checkout workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/aliased-checkout.yml");
  assert.equal(audit.result.findings.some((finding) => finding.ruleId === "workflow-mutable-action-ref"), false);
});

test("aliased checkout refs remain guarded", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/aliased-checkout-ref.yml", [
    "name: aliased checkout ref",
    "on: pull_request_target",
    "permissions: read-all",
    "env:",
    "  PR_HEAD: &pr-head " + expression,
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: *pr-head",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add aliased checkout ref workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/aliased-checkout-ref.yml");
});

test("untrusted checkout repository inputs remain guarded", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.event.pull_request.head.repo.full_name }}"].join("");
  write(repoRoot, ".github/workflows/fork-repository-checkout.yml", [
    "name: fork repository checkout",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          repository: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add fork repository checkout workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/fork-repository-checkout.yml");
});

test("block-node aliases used as jobs preserve guarded properties", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/aliased-job.yml", [
    "name: aliased job",
    "on: push",
    "x-job: &unsafe-job",
    "  permissions: write-all",
    "  runs-on: self-hosted",
    "jobs:",
    "  build: *unsafe-job",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add aliased job workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/aliased-job.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/aliased-job.yml");
});

test("block-node aliases used as the complete jobs mapping remain guarded", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/aliased-jobs.yml", [
    "name: aliased jobs",
    "on: push",
    "x-jobs: &unsafe-jobs",
    "  build:",
    "    permissions: write-all",
    "    runs-on: self-hosted",
    "jobs: *unsafe-jobs",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add aliased jobs workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/aliased-jobs.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/aliased-jobs.yml");
});

test("block-node aliases used as complete steps remain guarded", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/aliased-step.yml", [
    "name: aliased step",
    "on: pull_request_target",
    "permissions: read-all",
    "x-step: &unsafe-step",
    "  uses: actions/checkout@" + "a".repeat(40),
    "  with:",
    "    ref: " + expression,
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - *unsafe-step",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add aliased checkout step");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/aliased-step.yml");
});

test("block-node aliases used as the complete steps sequence remain guarded", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/aliased-steps.yml", [
    "name: aliased steps",
    "on: pull_request_target",
    "permissions: read-all",
    "x-steps: &unsafe-steps",
    "  - uses: actions/checkout@" + "a".repeat(40),
    "    with:",
    "      ref: " + expression,
    "  - run: ./execute-reviewed-tree",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps: *unsafe-steps",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add aliased steps workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/aliased-steps.yml");
});

test("block scalar script bodies are not parsed as workflow mappings", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/generated-yaml.yml", [
    "name: generated yaml",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: |",
    "          permissions: write-all",
    "          uses: example/action@main",
    "          echo '{permissions: write-all, uses: example/action@main}'",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add generated yaml workflow");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.findingCount, 0);
});

test("nested trigger filters are not treated as enabled events", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/push-filter.yml", [
    "name: push filter",
    "on:",
    "  push:",
    "    branches: [pull_request_target]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add nested trigger filter workflow");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.findingCount, 0);
});

test("mapping properties do not hide privileged trigger keys", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/anchored-trigger-map.yml", [
    "name: anchored trigger map",
    "on: &events",
    "  pull_request_target:",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add anchored trigger mapping workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/anchored-trigger-map.yml");
});

test("indented flow sequences preserve privileged trigger names", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/indented-flow-trigger.yml", [
    "name: indented flow trigger",
    "on:",
    "  [pull_request_target]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add indented flow trigger workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/indented-flow-trigger.yml");
});

test("YAML double-quoted escapes cannot hide guarded values", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github\\u002ehead_ref }}"].join("");
  write(repoRoot, ".github/workflows/escaped-values.yml", [
    "name: escaped values",
    "\"o\\u006e\": \"pull\\u005frequest_target\"",
    "\"permiss\\u0069ons\": \"write\\u002dall\"",
    "jobs:",
    "  inspect:",
    "    \"runs\\u002don\": \"self\\u002dhosted\"",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          \"r\\u0065f\": \"" + expression + "\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add escaped guarded values workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/escaped-values.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/escaped-values.yml");
  assertFinding(audit.result, "workflow-pull-request-target", ".github/workflows/escaped-values.yml");
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/escaped-values.yml");
});

test("escaped multiline YAML scalars cannot hide guarded values", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/multiline-values.yml", [
    "name: multiline values",
    "on: push",
    ["permissions: \"write-", "\\"].join(""),
    "  all\" # folded permission",
    "jobs:",
    "  inspect:",
    ["    runs-on: \"self-", "\\"].join(""),
    "      hosted\" # folded runner",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add multiline guarded values workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/multiline-values.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/multiline-values.yml");
});

test("CR-only workflow lines preserve guarded mappings", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/cr-only.yml", [
    "name: cr only",
    "on: push",
    "permissions: write-all",
    "jobs:",
    "  inspect:",
    "    runs-on: self-hosted",
    "",
  ].join("\r"));
  commitAll(repoRoot, "add CR-only workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/cr-only.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/cr-only.yml");
});

test("a UTF-8 BOM cannot hide root block mappings", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/bom.yml", [
    "\ufeffpermissions: write-all",
    "on: push",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add BOM workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/bom.yml");
});

test("document markers preserve root flow workflow checks", () => {
  const repoRoot = makeRepository();
  write(
    repoRoot,
    ".github/workflows/document-flow.yml",
    "%YAML 1.2\n--- {name: document flow, on: push, permissions: write-all, jobs: {build: {runs-on: self-hosted}}}\n",
  );
  commitAll(repoRoot, "add marked flow workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-write-all", ".github/workflows/document-flow.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/document-flow.yml");
});

test("workflow entrypoint paths are case-sensitive", () => {
  const directoryRepo = makeRepository();
  write(directoryRepo, ".GITHUB/workflows/lookalike.yml", [
    "on: push",
    "permissions: write-all",
    "jobs: { unsafe: { runs-on: self-hosted } }",
    "",
  ].join("\n"));
  commitAll(directoryRepo, "add lookalike workflow directory");

  const extensionRepo = makeRepository();
  write(extensionRepo, ".github/workflows/lookalike.YML", [
    "on: push",
    "permissions: write-all",
    "jobs: { unsafe: { runs-on: self-hosted } }",
    "",
  ].join("\n"));
  commitAll(extensionRepo, "add lookalike workflow extension");

  assert.equal(runAudit(directoryRepo, ["--fail-on-warning"]).status, 0);
  assert.equal(runAudit(extensionRepo, ["--fail-on-warning"]).status, 0);
});

test("privileged context propagates through local reusable workflows", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/caller.yml", [
    "name: caller",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  call:",
    "    uses: ./.github/workflows/middle.yml",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/middle.yml", [
    "name: middle",
    "on: workflow_call",
    "permissions: read-all",
    "jobs:",
    "  call:",
    "    uses: ./.github/workflows/reusable.yml",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/reusable.yml", [
    "name: reusable",
    "on: workflow_call",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add privileged reusable workflow chain");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/reusable.yml");
});

test("privileged reusable workflows propagate into local composite actions", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/action-caller.yml", [
    "name: action caller",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  call:",
    "    uses: ./.github/workflows/action-callee.yml",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/action-callee.yml", [
    "name: action callee",
    "on: workflow_call",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/reusable-checkout",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/reusable-checkout/action.yml", [
    "name: reusable checkout",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: actions/checkout@" + "a".repeat(40),
    "      with:",
    "        ref: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add reusable composite checkout chain");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/actions/reusable-checkout/action.yml",
  );
});

test("untrusted inputs propagate through local reusable workflows", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const inputExpression = ["$", "{{ inputs.ref }}"].join("");
  write(repoRoot, ".github/workflows/input-caller.yml", [
    "name: input caller",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  call:",
    "    uses: ./.github/workflows/input-callee.yml",
    "    with:",
    "      ref: " + headExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/input-callee.yml", [
    "name: input callee",
    "on:",
    "  workflow_call:",
    "    inputs:",
    "      ref:",
    "        required: true",
    "        type: string",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + inputExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add untrusted reusable input chain");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/input-callee.yml");
});

test("caller matrix taint propagates into reusable workflow inputs", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const matrixExpression = ["$", "{{ matrix.revision }}"].join("");
  const inputExpression = ["$", "{{ inputs.ref }}"].join("");
  write(repoRoot, ".github/workflows/matrix-caller.yml", [
    "name: matrix caller",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  call:",
    "    strategy:",
    "      matrix:",
    "        revision: [" + headExpression + "]",
    "    uses: ./.github/workflows/matrix-callee.yml",
    "    with:",
    "      ref: " + matrixExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/matrix-callee.yml", [
    "name: matrix callee",
    "on: workflow_call",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + inputExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add reusable matrix checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/matrix-callee.yml");
});

test("reusable workflow outputs propagate taint back to callers", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const jobOutputExpression = ["$", "{{ jobs.source.outputs.ref }}"].join("");
  const returnedExpression = ["$", "{{ needs.source.outputs.ref }}"].join("");
  write(repoRoot, ".github/workflows/output-caller.yml", [
    "name: output caller",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  source:",
    "    uses: ./.github/workflows/output-callee.yml",
    "  inspect:",
    "    needs: source",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + returnedExpression,
    "  inspect-action:",
    "    needs: source",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/returned-output-checkout",
    "        with:",
    "          ref: " + returnedExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/output-callee.yml", [
    "name: output callee",
    "on:",
    "  workflow_call:",
    "    outputs:",
    "      ref:",
    "        value: " + jobOutputExpression,
    "permissions: read-all",
    "jobs:",
    "  source:",
    "    runs-on: ubuntu-latest",
    "    outputs:",
    "      ref: " + headExpression,
    "    steps:",
    "      - run: echo source",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/returned-output-checkout/action.yml", [
    "name: returned output checkout",
    "inputs:",
    "  ref:",
    "    required: true",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: actions/checkout@" + "a".repeat(40),
    "      with:",
    "        ref: ${{ inputs.ref }}",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add reusable output checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/output-caller.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/actions/returned-output-checkout/action.yml",
  );
});

test("nested reusable outputs taint sinks in intermediate workflows", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const jobOutputExpression = ["$", "{{ jobs.source.outputs.ref }}"].join("");
  const nestedOutputExpression = ["$", "{{ needs.nested.outputs.ref }}"].join("");
  write(repoRoot, ".github/workflows/nested-output-root.yml", [
    "name: nested output root",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  call:",
    "    uses: ./.github/workflows/nested-output-middle.yml",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/nested-output-middle.yml", [
    "name: nested output middle",
    "on: workflow_call",
    "permissions: read-all",
    "jobs:",
    "  nested:",
    "    uses: ./.github/workflows/nested-output-leaf.yml",
    "  inspect:",
    "    needs: nested",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + nestedOutputExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/nested-output-leaf.yml", [
    "name: nested output leaf",
    "on:",
    "  workflow_call:",
    "    outputs:",
    "      ref:",
    "        value: " + jobOutputExpression,
    "permissions: read-all",
    "jobs:",
    "  source:",
    "    runs-on: ubuntu-latest",
    "    outputs:",
    "      ref: " + headExpression,
    "    steps:",
    "      - run: echo source",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add nested reusable output checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/nested-output-middle.yml",
  );
});

test("untrusted refs propagate through workflow job and step environments", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const envExpression = ["$", "{{ env.PR_REF }}"].join("");
  const scopes = ["workflow", "job", "step"];
  for (const scope of scopes) {
    const workflowEnv = scope === "workflow"
      ? ["env:", "  PR_REF: " + headExpression]
      : [];
    const jobEnv = scope === "job"
      ? ["    env:", "      PR_REF: " + headExpression]
      : [];
    const stepEnv = scope === "step"
      ? ["        env:", "          PR_REF: " + headExpression]
      : [];
    write(repoRoot, `.github/workflows/${scope}-env.yml`, [
      "name: " + scope + " env",
      "on: pull_request_target",
      "permissions: read-all",
      ...workflowEnv,
      "jobs:",
      "  inspect:",
      "    runs-on: ubuntu-latest",
      ...jobEnv,
      "    steps:",
      "      - uses: actions/checkout@" + "a".repeat(40),
      ...stepEnv,
      "        with:",
      "          ref: " + envExpression,
      "",
    ].join("\n"));
  }
  commitAll(repoRoot, "add environment checkout workflows");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  for (const scope of scopes) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-checkout",
      `.github/workflows/${scope}-env.yml`,
    );
  }
});

test("untrusted refs persisted through GITHUB_ENV reach later steps", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const envExpression = ["$", "{{ env.PR_REF }}"].join("");
  write(repoRoot, ".github/workflows/github-env-ref.yml", [
    "name: GITHUB_ENV ref",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          SOURCE_REF: " + headExpression,
    "        run: |",
    "          echo \"PR_REF=$SOURCE_REF\" >> \"$GITHUB_ENV\"",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + envExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/github-env-heredoc-ref.yml", [
    "name: GITHUB_ENV heredoc ref",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          SOURCE_REF: " + headExpression,
    "        run: |",
    "          cat >> \"$GITHUB_ENV\" <<EOF",
    "          PR_REF=$SOURCE_REF",
    "          EOF",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + envExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/github-env-alias-ref.yml", [
    "name: GITHUB_ENV alias ref",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          SOURCE_REF: " + headExpression,
    "        run: |",
    "          DESTINATION=\"$GITHUB_ENV\"",
    "          echo \"PR_REF=$SOURCE_REF\" >> \"$DESTINATION\"",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + envExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/github-env-group-eval.yml", [
    "name: GITHUB_ENV grouped evaluator",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          CODE: " + ["$", "{{ github.event.comment.body }}"].join(""),
    "        run: |",
    "          { echo \"PAYLOAD=$CODE\"; } >> \"$GITHUB_ENV\"",
    "      - run: eval \"$PAYLOAD\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add persisted environment checkout workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/github-env-ref.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/github-env-heredoc-ref.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/github-env-alias-ref.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/github-env-group-eval.yml",
  );
});

test("GITHUB_ENV taint does not flow backward to earlier steps", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const envExpression = ["$", "{{ env.PR_REF }}"].join("");
  write(repoRoot, ".github/workflows/github-env-order.yml", [
    "name: GITHUB_ENV order",
    "on: pull_request_target",
    "permissions: read-all",
    "env:",
    "  PR_REF: main",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + envExpression,
    "      - env:",
    "          SOURCE_REF: " + headExpression,
    "        run: |",
    "          echo \"PR_REF=$SOURCE_REF\" >> \"$GITHUB_ENV\"",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/github-env-constant-write.yml", [
    "name: GITHUB_ENV constant write",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          SOURCE_REF: " + headExpression,
    "        run: |",
    "          printf '%s\\n' \"$SOURCE_REF\"",
    "          echo \"SAFE_REF=main\" >> \"$GITHUB_ENV\"",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: ${{ env.SAFE_REF }}",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/github-env-tainted-overwrite.yml", [
    "name: GITHUB_ENV tainted overwrite",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          CODE: " + ["$", "{{ github.event.comment.body }}"].join(""),
    "        run: echo \"PAYLOAD=$CODE\" >> \"$GITHUB_ENV\"",
    "      - run: echo \"PAYLOAD=echo fixed\" >> \"$GITHUB_ENV\"",
    "      - run: eval \"$PAYLOAD\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add ordered environment workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.findings.some((finding) => (
    finding.ruleId === "workflow-privileged-untrusted-checkout"
  )), false);
});

test("untrusted refs propagate through job outputs", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const outputExpression = ["$", "{{ needs.source.outputs.revision }}"].join("");
  write(repoRoot, ".github/workflows/job-output-ref.yml", [
    "name: job output ref",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  source:",
    "    runs-on: ubuntu-latest",
    "    outputs:",
    "      revision: " + headExpression,
    "    steps:",
    "      - run: echo source",
    "  inspect:",
    "    needs: source",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + outputExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add job output checkout workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/job-output-ref.yml");
});

test("untrusted refs propagate through step and job outputs", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const outputExpression = ["$", "{{ needs.source.outputs.revision }}"].join("");
  write(repoRoot, ".github/workflows/step-output-ref.yml", [
    "name: step output ref",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  source:",
    "    runs-on: ubuntu-latest",
    "    outputs:",
    "      revision: ${{ steps.ref.outputs.revision }}",
    "    steps:",
    "      - id: ref",
    "        run: |",
    "          echo \"revision=" + headExpression + "\" >> \"$GITHUB_OUTPUT\"",
    "  inspect:",
    "    needs: source",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + outputExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add step output checkout workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/step-output-ref.yml");
});

test("untrusted refs propagate through job matrix bindings", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const matrixExpression = ["$", "{{ matrix.revision }}"].join("");
  write(repoRoot, ".github/workflows/matrix-ref.yml", [
    "name: matrix ref",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    strategy:",
    "      matrix:",
    "        revision: [" + headExpression + "]",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + matrixExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add matrix checkout workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/matrix-ref.yml");
});

test("matrix include objects propagate untrusted checkout refs", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const matrixExpression = ["$", "{{ matrix.revision }}"].join("");
  write(repoRoot, ".github/workflows/matrix-include.yml", [
    "name: matrix include",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    strategy:",
    "      matrix:",
    "        include: [{revision: " + headExpression + "}]",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + matrixExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add matrix include checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/matrix-include.yml");
});

test("expression-defined matrices propagate untrusted checkout coordinates", () => {
  const repoRoot = makeRepository();
  const matrixExpression = [
    "$",
    "{{ fromJSON(github.event.comment.body) }}",
  ].join("");
  const repositoryExpression = ["$", "{{ matrix.repository }}"].join("");
  const refExpression = ["$", "{{ matrix.ref }}"].join("");
  write(repoRoot, ".github/workflows/expression-matrix.yml", [
    "name: expression matrix",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    strategy:",
    "      matrix: " + matrixExpression,
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          repository: " + repositoryExpression,
    "          ref: " + refExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add expression matrix checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/expression-matrix.yml",
  );
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

test("literal runner expressions preserve blocking self-hosted labels", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/literal-runner-expression.yml", [
    "name: literal runner expression",
    "on: push",
    "jobs:",
    "  unsafe:",
    "    runs-on: ${{ 'self-hosted' }}",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add literal runner expression workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-self-hosted-runner",
    ".github/workflows/literal-runner-expression.yml",
  );
});

test("constructed constant runner expressions preserve blocking labels", () => {
  const repoRoot = makeRepository();
  const runnerExpression = [
    "$",
    "{{ format('{0}-{1}', 'self', 'hosted') }}",
  ].join("");
  write(repoRoot, ".github/workflows/formatted-runner-expression.yml", [
    "name: formatted runner expression",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: " + runnerExpression,
    "    steps:",
    "      - run: echo inspect",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add formatted runner expression");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-self-hosted-runner",
    ".github/workflows/formatted-runner-expression.yml",
  );
});

test("aliased self-hosted runner labels remain release-blocking", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/aliased-runner.yml", [
    "name: &runner self-hosted",
    "on: push",
    "jobs:",
    "  unsafe:",
    "    runs-on: *runner",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add aliased runner workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/aliased-runner.yml");
});

test("aliases inside runner label sequences remain release-blocking", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/aliased-runner-sequence.yml", [
    "name: &runner self-hosted",
    "on: push",
    "jobs:",
    "  unsafe:",
    "    runs-on: [*runner, linux]",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add aliased runner sequence workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/aliased-runner-sequence.yml");
});

test("block-sequence runner labels remain release-blocking", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/block-runner-sequence.yml", [
    "name: block runner sequence",
    "on: push",
    "jobs:",
    "  unsafe:",
    "    runs-on:",
    "      - self-hosted",
    "      - linux",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add block runner sequence workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/block-runner-sequence.yml");
});

test("runs-on mappings preserve blocking self-hosted labels", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/flow-runner-mapping.yml", [
    "name: flow runner mapping",
    "on: push",
    "jobs:",
    "  unsafe:",
    "    runs-on: { group: public-runners, labels: self-hosted }",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/block-runner-mapping.yml", [
    "name: block runner mapping",
    "on: push",
    "jobs:",
    "  unsafe:",
    "    runs-on:",
    "      group: public-runners",
    "      labels:",
    "        - self-hosted",
    "        - linux",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add runner mapping workflows");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/flow-runner-mapping.yml");
  assertFinding(audit.result, "workflow-self-hosted-runner", ".github/workflows/block-runner-mapping.yml");
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

test("bracket notation preserves untrusted GitHub checkout sources", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github['head_ref'] }}"].join("");
  write(repoRoot, ".github/workflows/bracket-head-ref.yml", [
    "name: bracket head ref",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add bracket checkout source");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/bracket-head-ref.yml");
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

test("workflow_run head checkouts are privileged and untrusted", () => {
  const repoRoot = makeRepository();
  const repositoryExpression = ["$", "{{ github.event.workflow_run.head_repository.full_name }}"].join("");
  const shaExpression = ["$", "{{ github.event.workflow_run.head_sha }}"].join("");
  write(repoRoot, ".github/workflows/workflow-run-checkout.yml", [
    "name: workflow run checkout",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: write-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          repository: " + repositoryExpression,
    "          ref: " + shaExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add workflow run checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/workflow-run-checkout.yml");
});

test("workflow_run pull-request repositories remain untrusted", () => {
  const repoRoot = makeRepository();
  const repositoryExpression = [
    "$",
    "{{ github.event.workflow_run.pull_requests[0].head.repo.full_name }}",
  ].join("");
  write(repoRoot, ".github/workflows/workflow-run-pr-repository.yml", [
    "name: workflow run PR repository",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          repository: " + repositoryExpression,
    "          ref: main",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add workflow run PR repository checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/workflow-run-pr-repository.yml",
  );
});

test("workflow_run artifacts remain untrusted when later executed", () => {
  const repoRoot = makeRepository();
  const runIdExpression = ["$", "{{ github.event.workflow_run.id }}"].join("");
  write(repoRoot, ".github/workflows/workflow-run-artifact.yml", [
    "name: workflow run artifact",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions:",
    "  contents: write",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: payload",
    "      - run: bash payload/run.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/workflow-run-gh-artifact.yml", [
    "name: workflow run gh artifact",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          RUN_ID: " + runIdExpression,
    "        run: gh run download \"$RUN_ID\" --dir payload",
    "      - run: bash payload/run.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/workflow-run-gh-global-artifact.yml", [
    "name: workflow run gh global artifact",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          RUN_ID: " + runIdExpression,
    "        run: gh -R example/public run download \"$RUN_ID\" --dir payload",
    "      - run: bash payload/run.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/workflow-run-gh-repository-artifact.yml", [
    "name: workflow run gh repository artifact",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: gh run download -n payload --dir payload",
    "      - run: bash payload/run.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/workflow-download-composite-execute.yml", [
    "name: workflow download composite execute",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: payload",
    "      - uses: ./.github/actions/run-downloaded-artifact",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/run-downloaded-artifact/action.yml", [
    "name: run downloaded artifact",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - shell: bash",
    "      run: bash payload/run.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/composite-download-workflow-execute.yml", [
    "name: composite download workflow execute",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/download-untrusted-artifact",
    "      - run: bash payload/run.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/download-untrusted-artifact/action.yml", [
    "name: download untrusted artifact",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: actions/download-artifact@" + "a".repeat(40),
    "      with:",
    "        run-id: " + runIdExpression,
    "        path: payload",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add workflow artifact execution");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-artifact-execution",
    ".github/workflows/workflow-run-artifact.yml",
  );
  for (const workflowName of [
    "workflow-run-gh-artifact",
    "workflow-run-gh-global-artifact",
    "workflow-run-gh-repository-artifact",
    "workflow-download-composite-execute",
    "composite-download-workflow-execute",
  ]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-artifact-execution",
      `.github/workflows/${workflowName}.yml`,
    );
  }
});

test("workflow_run artifact provenance survives current-run reuploads", () => {
  const repoRoot = makeRepository();
  const runIdExpression = ["$", "{{ github.event.workflow_run.id }}"].join("");
  write(repoRoot, ".github/workflows/workflow-run-reuploaded-artifact.yml", [
    "name: workflow run reuploaded artifact",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  relay:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: inbound",
    "      - uses: actions/upload-artifact@" + "b".repeat(40),
    "        with:",
    "          name: forwarded-payload",
    "          path: inbound",
    "  execute:",
    "    needs: relay",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          name: forwarded-payload",
    "          path: payload",
    "      - run: bash payload/run.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/workflow-run-multiline-reuploaded-artifact.yml", [
    "name: workflow run multiline reuploaded artifact",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  relay:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: inbound",
    "      - uses: actions/upload-artifact@" + "b".repeat(40),
    "        with:",
    "          name: forwarded-multiline-payload",
    "          path: |",
    "            trusted",
    "            inbound",
    "  execute:",
    "    needs: relay",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          name: forwarded-multiline-payload",
    "          path: payload",
    "      - run: bash payload/run.sh",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add reuploaded workflow artifact execution");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-artifact-execution",
    ".github/workflows/workflow-run-reuploaded-artifact.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-artifact-execution",
    ".github/workflows/workflow-run-multiline-reuploaded-artifact.yml",
  );
});

test("artifact execution resolves step working directories", () => {
  const repoRoot = makeRepository();
  const runIdExpression = ["$", "{{ github.event.workflow_run.id }}"].join("");
  write(repoRoot, ".github/workflows/workflow-run-artifact-directory.yml", [
    "name: workflow run artifact directory",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: payload",
    "      - working-directory: payload",
    "        run: bash run.sh",
    "",
  ].join("\n"));
  for (const scope of ["job", "workflow"]) {
    write(repoRoot, `.github/workflows/workflow-run-artifact-${scope}-default.yml`, [
      `name: workflow run artifact ${scope} default`,
      "on:",
      "  workflow_run:",
      "    workflows: [verify]",
      "    types: [completed]",
      "permissions: read-all",
      ...(scope === "workflow" ? [
        "defaults:",
        "  run:",
        "    working-directory: payload",
      ] : []),
      "jobs:",
      "  inspect:",
      "    runs-on: ubuntu-latest",
      ...(scope === "job" ? [
        "    defaults:",
        "      run:",
        "        working-directory: payload",
      ] : []),
      "    steps:",
      "      - uses: actions/download-artifact@" + "a".repeat(40),
      "        with:",
      "          run-id: " + runIdExpression,
      "          path: payload",
      "      - run: bash run.sh",
      "",
    ].join("\n"));
  }
  commitAll(repoRoot, "add artifact working directory execution");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-artifact-execution",
    ".github/workflows/workflow-run-artifact-directory.yml",
  );
  for (const scope of ["job", "workflow"]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-artifact-execution",
      `.github/workflows/workflow-run-artifact-${scope}-default.yml`,
    );
  }
});

test("artifact execution tracks inline shell directory changes", () => {
  const repoRoot = makeRepository();
  const runIdExpression = ["$", "{{ github.event.workflow_run.id }}"].join("");
  write(repoRoot, ".github/workflows/workflow-run-artifact-cd.yml", [
    "name: workflow run artifact cd",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: payload",
    "      - run: cd payload && bash run.sh",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add inline artifact directory execution");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-artifact-execution",
    ".github/workflows/workflow-run-artifact-cd.yml",
  );
});

test("artifact execution recognizes common command wrappers and paths", () => {
  const repoRoot = makeRepository();
  const runIdExpression = ["$", "{{ github.event.workflow_run.id }}"].join("");
  for (const [name, command] of [
    ["exec", "cd payload && exec bash run.sh"],
    ["absolute-interpreter", "cd payload && /bin/bash run.sh"],
    ["direct-path", "payload/run.sh"],
    ["shell-group", "(bash payload/run.sh)"],
    ["shell-group-chain", "(cd payload && bash run.sh)"],
    ["python-option", "python -W ignore payload/run.py"],
    ["node-require", "node --require payload/hook.js trusted.js"],
    ["node-import", "node --import=payload/hook.mjs trusted.js"],
    ["node-loader", "node --loader payload/loader.mjs trusted.js"],
    ["make-file", "make -f payload/Makefile"],
    ["make-nested-directory", "make -C payload -C nested"],
    ["awk-file", "awk -f payload/run.awk /dev/null"],
    ["timeout", "timeout 10 bash payload/run.sh"],
    ["shell-command-string", "bash -c 'source payload/run.sh'"],
    ["npm-prefix", "npm --prefix payload test"],
    ["pip-local-project", "pip install ./payload"],
    ["python-pip-local-project", "python -m pip install ./payload"],
  ]) {
    write(repoRoot, `.github/workflows/workflow-run-artifact-${name}.yml`, [
      `name: workflow run artifact ${name}`,
      "on:",
      "  workflow_run:",
      "    workflows: [verify]",
      "    types: [completed]",
      "permissions: read-all",
      "jobs:",
      "  inspect:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/download-artifact@" + "a".repeat(40),
      "        with:",
      "          run-id: " + runIdExpression,
      "          path: payload",
      "      - run: " + command,
      "",
    ].join("\n"));
  }
  write(repoRoot, ".github/workflows/workflow-run-artifact-node-options.yml", [
    "name: workflow run artifact Node options",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: payload",
    "      - env:",
    "          NODE_OPTIONS: --require ./payload/hook.js",
    "        run: node trusted.js",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/workflow-run-artifact-env-node-options.yml", [
    "name: workflow run artifact env Node options",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: payload",
    "      - run: env NODE_OPTIONS='--require payload/hook.js' node trusted.js",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/workflow-run-artifact-bash-env.yml", [
    "name: workflow run artifact Bash environment",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: payload",
    "      - env:",
    "          BASH_ENV: payload/hook.sh",
    "        run: echo fixed",
    "",
  ].join("\n"));
  for (const scope of ["workflow", "job", "step", "shell"]) {
    write(repoRoot, `.github/workflows/workflow-run-artifact-${scope}-alias.yml`, [
      `name: workflow run artifact ${scope} alias`,
      "on:",
      "  workflow_run:",
      "    workflows: [verify]",
      "    types: [completed]",
      "permissions: read-all",
      ...(scope === "workflow" ? ["env:", "  SCRIPT: payload/run.sh"] : []),
      "jobs:",
      "  inspect:",
      "    runs-on: ubuntu-latest",
      ...(scope === "job" ? ["    env:", "      SCRIPT: payload/run.sh"] : []),
      "    steps:",
      "      - uses: actions/download-artifact@" + "a".repeat(40),
      "        with:",
      "          run-id: " + runIdExpression,
      "          path: payload",
      ...(scope === "step" ? [
        "      - env:",
        "          SCRIPT: payload/run.sh",
        "        run: bash \"$SCRIPT\"",
      ] : scope === "shell" ? [
        "      - run: |",
        "          SCRIPT=payload/run.sh",
        "          bash \"$SCRIPT\"",
      ] : ["      - run: bash \"$SCRIPT\""]),
      "",
    ].join("\n"));
  }
  commitAll(repoRoot, "add common artifact execution commands");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  for (const name of [
    "exec",
    "absolute-interpreter",
    "direct-path",
    "shell-group",
    "shell-group-chain",
    "python-option",
    "node-require",
    "node-import",
    "node-loader",
    "make-file",
    "make-nested-directory",
    "awk-file",
    "timeout",
    "shell-command-string",
    "npm-prefix",
    "pip-local-project",
    "python-pip-local-project",
    "node-options",
    "env-node-options",
    "bash-env",
    "workflow-alias",
    "job-alias",
    "step-alias",
    "shell-alias",
  ]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-artifact-execution",
      `.github/workflows/workflow-run-artifact-${name}.yml`,
    );
  }
});

test("artifact execution recognizes interpreter input redirection", () => {
  const repoRoot = makeRepository();
  const runIdExpression = ["$", "{{ github.event.workflow_run.id }}"].join("");
  write(repoRoot, ".github/workflows/workflow-run-artifact-redirect.yml", [
    "name: workflow run artifact redirect",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: payload",
    "      - run: bash < payload/run.sh",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add redirected artifact execution");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-artifact-execution",
    ".github/workflows/workflow-run-artifact-redirect.yml",
  );
});

test("artifact execution follows archive extraction destinations", () => {
  const repoRoot = makeRepository();
  const runIdExpression = ["$", "{{ github.event.workflow_run.id }}"].join("");
  write(repoRoot, ".github/workflows/workflow-run-artifact-tar-same-step.yml", [
    "name: workflow run artifact tar same step",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: payload",
    "      - run: |",
    "          tar -xf payload/code.tar -C extracted",
    "          bash extracted/run.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/workflow-run-artifact-tar-cross-step.yml", [
    "name: workflow run artifact tar cross step",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: payload",
    "      - run: tar --extract --file=payload/code.tar --directory=extracted",
    "      - run: bash extracted/run.sh",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add extracted artifact execution");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  for (const name of ["same-step", "cross-step"]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-artifact-execution",
      `.github/workflows/workflow-run-artifact-tar-${name}.yml`,
    );
  }
});

test("issue_comment pull-request checkouts are privileged and untrusted", () => {
  const repoRoot = makeRepository();
  const issueExpression = ["$", "{{ github.event.issue.number }}"].join("");
  write(repoRoot, ".github/workflows/issue-comment-checkout.yml", [
    "name: issue comment checkout",
    "on: issue_comment",
    "permissions:",
    "  contents: write",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: refs/pull/" + issueExpression + "/head",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add issue comment checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", ".github/workflows/issue-comment-checkout.yml");
});

test("constructed issue_comment pull-request refs remain untrusted", () => {
  const repoRoot = makeRepository();
  const expression = [
    "$",
    "{{ format('refs/{0}/{1}/head', 'pull', github.event.issue.number) }}",
  ].join("");
  write(repoRoot, ".github/workflows/constructed-issue-comment-checkout.yml", [
    "name: constructed issue comment checkout",
    "on: issue_comment",
    "permissions:",
    "  contents: write",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add constructed issue comment checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/constructed-issue-comment-checkout.yml",
  );
});

test("issue-comment bodies are untrusted checkout coordinates", () => {
  const repoRoot = makeRepository();
  const repositoryExpression = [
    "$",
    "{{ fromJSON(github.event.comment.body).repository }}",
  ].join("");
  const refExpression = [
    "$",
    "{{ fromJSON(github.event.comment.body).ref }}",
  ].join("");
  write(repoRoot, ".github/workflows/comment-body-checkout.yml", [
    "name: comment body checkout",
    "on: issue_comment",
    "permissions:",
    "  contents: write",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          repository: " + repositoryExpression,
    "          ref: " + refExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add comment body checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/comment-body-checkout.yml",
  );
});

test("issue bodies are privileged untrusted checkout coordinates", () => {
  const repoRoot = makeRepository();
  const repositoryExpression = [
    "$",
    "{{ fromJSON(github.event.issue.body).repository }}",
  ].join("");
  const refExpression = [
    "$",
    "{{ fromJSON(github.event.issue.body).ref }}",
  ].join("");
  write(repoRoot, ".github/workflows/issue-body-checkout.yml", [
    "name: issue body checkout",
    "on: issues",
    "permissions:",
    "  contents: write",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          repository: " + repositoryExpression,
    "          ref: " + refExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add issue body checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/issue-body-checkout.yml",
  );
});

test("issue titles are privileged untrusted checkout coordinates", () => {
  const repoRoot = makeRepository();
  const repositoryExpression = [
    "$",
    "{{ fromJSON(github.event.issue.title).repository }}",
  ].join("");
  const refExpression = [
    "$",
    "{{ fromJSON(github.event.issue.title).ref }}",
  ].join("");
  write(repoRoot, ".github/workflows/issue-title-checkout.yml", [
    "name: issue title checkout",
    "on: issues",
    "permissions:",
    "  contents: write",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          repository: " + repositoryExpression,
    "          ref: " + refExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add issue title checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/issue-title-checkout.yml",
  );
});

test("discussion bodies are privileged untrusted checkout coordinates", () => {
  const repoRoot = makeRepository();
  const repositoryExpression = [
    "$",
    "{{ fromJSON(github.event.discussion.body).repository }}",
  ].join("");
  const refExpression = [
    "$",
    "{{ fromJSON(github.event.discussion.body).ref }}",
  ].join("");
  write(repoRoot, ".github/workflows/discussion-checkout.yml", [
    "name: discussion checkout",
    "on: discussion",
    "permissions:",
    "  contents: write",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          repository: " + repositoryExpression,
    "          ref: " + refExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add discussion checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/discussion-checkout.yml",
  );
});

test("privileged scripts require environment indirection for untrusted values", () => {
  const unsafeRepo = makeRepository();
  const safeRepo = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  const roundTripExpression = [
    "$",
    "{{ fromJSON(toJSON(github.event.comment)).body }}",
  ].join("");
  write(unsafeRepo, ".github/workflows/direct-comment-script.yml", [
    "name: direct comment script",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo \"comment=" + bodyExpression + "\"",
    "",
  ].join("\n"));
  write(safeRepo, ".github/workflows/environment-comment-script.yml", [
    "name: environment comment script",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMENT_BODY: " + bodyExpression,
    "        run: printf '%s\\n' \"$COMMENT_BODY\"",
    "",
  ].join("\n"));
  write(unsafeRepo, ".github/workflows/roundtrip-comment-script.yml", [
    "name: roundtrip comment script",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo \"comment=" + roundTripExpression + "\"",
    "",
  ].join("\n"));
  commitAll(unsafeRepo, "add direct comment interpolation");
  commitAll(safeRepo, "add environment comment handling");

  const unsafeAudit = runAudit(unsafeRepo);
  const safeAudit = runAudit(safeRepo);

  assert.equal(unsafeAudit.status, 1);
  assertFinding(
    unsafeAudit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/direct-comment-script.yml",
  );
  assertFinding(
    unsafeAudit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/roundtrip-comment-script.yml",
  );
  assert.equal(safeAudit.status, 0);
});

test("pull-request title and body values are untrusted script inputs", () => {
  const repoRoot = makeRepository();
  for (const field of ["title", "body"]) {
    const valueExpression = ["$", `{{ github.event.pull_request.${field} }}`].join("");
    write(repoRoot, `.github/workflows/pull-request-${field}-script.yml`, [
      `name: pull request ${field} script`,
      "on: pull_request_target",
      "permissions: read-all",
      "jobs:",
      "  inspect:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      `      - run: echo "value=${valueExpression}"`,
      "",
    ].join("\n"));
  }
  commitAll(repoRoot, "add pull request text scripts");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  for (const field of ["title", "body"]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-script-interpolation",
      `.github/workflows/pull-request-${field}-script.yml`,
    );
  }
});

test("tainted environment values cannot reach shell evaluators", () => {
  const repoRoot = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  write(repoRoot, ".github/workflows/comment-eval.yml", [
    "name: comment eval",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: eval \"$COMMAND\"",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-background-eval.yml", [
    "name: comment background eval",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: echo ready & eval \"$COMMAND\"",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-indirect-eval.yml", [
    "name: comment indirect eval",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          CODE: " + bodyExpression,
    "        run: |",
    "          NAME=CODE",
    "          eval \"${!NAME}\"",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-nameref-eval.yml", [
    "name: comment nameref eval",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          CODE: " + bodyExpression,
    "        run: |",
    "          declare -n REF=CODE",
    "          eval \"$REF\"",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-positional-eval.yml", [
    "name: comment positional eval",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          CODE: " + bodyExpression,
    "        run: |",
    "          set -- \"$CODE\"",
    "          eval \"$1\"",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-command-alias-eval.yml", [
    "name: comment command alias eval",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          CODE: " + bodyExpression,
    "        run: |",
    "          RUNNER=eval",
    "          \"$RUNNER\" \"$CODE\"",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-substitution-assignment-eval.yml", [
    "name: comment substitution assignment eval",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          CODE: " + bodyExpression,
    "        run: |",
    "          VALUE=$(printf '%s' \"$CODE\")",
    "          eval \"$VALUE\"",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-command-position-eval.yml", [
    "name: comment command position eval",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          CODE: " + bodyExpression,
    "        run: $CODE",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-read-eval.yml", [
    "name: comment read eval",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          CODE: " + bodyExpression,
    "        run: |",
    "          read -r VALUE <<< \"$CODE\"",
    "          eval \"$VALUE\"",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-overwritten-eval.yml", [
    "name: comment overwritten eval",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          CODE: " + bodyExpression,
    "        run: |",
    "          VALUE=\"$CODE\"",
    "          VALUE='echo fixed'",
    "          eval \"$VALUE\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add tainted shell evaluator");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-eval.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-background-eval.yml",
  );
  for (const form of [
    "indirect", "nameref", "positional", "command-alias", "substitution-assignment",
    "command-position", "read",
  ]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-script-interpolation",
      `.github/workflows/comment-${form}-eval.yml`,
    );
  }
  assert.equal(audit.result.findings.some((finding) => (
    finding.ruleId === "workflow-privileged-untrusted-script-interpolation"
    && finding.path === ".github/workflows/comment-overwritten-eval.yml"
  )), false);
});

test("tainted shell values cannot hide in parameter operators or command substitutions", () => {
  const repoRoot = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  for (const [form, command] of [
    ["parameter-operator", "eval \"${CODE:-}\""],
    ["parameter-substring", "eval \"${CODE:1}\""],
    ["parameter-replacement", "eval \"${CODE//x/}\""],
    ["command-substitution", "echo \"$(eval \"$CODE\")\""],
    ["unquoted-command-substitution", "echo $(eval \"$CODE\")"],
    ["nested-command-substitution", "echo \"$(printf '%s' \"$(eval \"$CODE\")\")\""],
    ["backtick-substitution", "echo \"`eval \\\"$CODE\\\"`\""],
    ["nested-backtick-substitution", "echo `echo \\`eval \"$CODE\"\\``"],
    ["process-substitution", "cat <(eval \"$CODE\")"],
    ["process-substitution-script", "bash <(printf '%s' \"$CODE\")"],
  ]) {
    write(repoRoot, `.github/workflows/comment-${form}-eval.yml`, [
      `name: comment ${form} eval`,
      "on: issue_comment",
      "permissions: read-all",
      "jobs:",
      "  inspect:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - env:",
      "          CODE: " + bodyExpression,
      "        run: |",
      "          " + command,
      "",
    ].join("\n"));
  }
  commitAll(repoRoot, "add hidden tainted shell evaluators");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  for (const form of [
    "parameter-operator",
    "parameter-substring",
    "parameter-replacement",
    "command-substitution",
    "unquoted-command-substitution",
    "nested-command-substitution",
    "backtick-substitution",
    "nested-backtick-substitution",
    "process-substitution",
    "process-substitution-script",
  ]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-script-interpolation",
      `.github/workflows/comment-${form}-eval.yml`,
    );
  }
});

test("tainted Git SSH command templates are implicit shell evaluators", () => {
  const unsafeRepo = makeRepository();
  const safeRepo = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  write(unsafeRepo, ".github/workflows/comment-git-ssh-command.yml", [
    "name: comment Git SSH command",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          GIT_SSH_COMMAND: " + bodyExpression,
    "        run: git ls-remote ssh://example.invalid/repository",
    "",
  ].join("\n"));
  write(unsafeRepo, ".github/workflows/comment-inline-git-ssh-command.yml", [
    "name: comment inline Git SSH command",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: GIT_SSH_COMMAND=\"$COMMAND\" git fetch origin",
    "",
  ].join("\n"));
  write(unsafeRepo, ".github/workflows/comment-env-git-ssh-command.yml", [
    "name: comment env Git SSH command",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: env GIT_SSH_COMMAND=\"$COMMAND\" git ls-remote ssh://example.invalid/repository",
    "",
  ].join("\n"));
  write(unsafeRepo, ".github/workflows/comment-git-core-ssh-command.yml", [
    "name: comment Git core SSH command",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: git -c core.sshCommand=\"$COMMAND\" ls-remote ssh://example.invalid/repository",
    "",
  ].join("\n"));
  write(unsafeRepo, ".github/workflows/comment-git-config-env-ssh-command.yml", [
    "name: comment Git config env SSH command",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          SSH_COMMAND: " + bodyExpression,
    "        run: git --config-env=core.sshCommand=SSH_COMMAND ls-remote ssh://example.invalid/repository",
    "",
  ].join("\n"));
  write(unsafeRepo, ".github/workflows/comment-timeout-git-ssh-command.yml", [
    "name: comment timeout Git SSH command",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          GIT_SSH_COMMAND: " + bodyExpression,
    "        run: timeout 10 git ls-remote ssh://example.invalid/repository",
    "",
  ].join("\n"));
  write(safeRepo, ".github/workflows/comment-git-message.yml", [
    "name: comment Git message",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          MESSAGE: " + bodyExpression,
    "        run: git ls-remote https://example.invalid/repository",
    "",
  ].join("\n"));
  commitAll(unsafeRepo, "add tainted Git SSH commands");
  commitAll(safeRepo, "add safe Git command");

  const unsafeAudit = runAudit(unsafeRepo);
  const safeAudit = runAudit(safeRepo);

  assert.equal(unsafeAudit.status, 1);
  for (const form of [
    "comment-git-ssh-command",
    "comment-inline-git-ssh-command",
    "comment-env-git-ssh-command",
    "comment-git-core-ssh-command",
    "comment-git-config-env-ssh-command",
    "comment-timeout-git-ssh-command",
  ]) {
    assertFinding(
      unsafeAudit.result,
      "workflow-privileged-untrusted-script-interpolation",
      `.github/workflows/${form}.yml`,
    );
  }
  assert.equal(safeAudit.status, 0);
});

test("tainted script text cannot be piped into shell interpreters", () => {
  const repoRoot = makeRepository();
  const safeRepo = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  write(repoRoot, ".github/workflows/comment-pipe-shell.yml", [
    "name: comment pipe shell",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: printf '%s' \"$COMMAND\" | bash",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-combined-pipe-shell.yml", [
    "name: comment combined pipe shell",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: printf '%s' \"$COMMAND\" |& bash",
    "",
  ].join("\n"));
  for (const runtime of ["node", "perl", "php", "python3", "ruby"]) {
    write(repoRoot, `.github/workflows/comment-pipe-${runtime}.yml`, [
      `name: comment pipe ${runtime}`,
      "on: issue_comment",
      "permissions: read-all",
      "jobs:",
      "  inspect:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - env:",
      "          COMMAND: " + bodyExpression,
      `        run: printf '%s' "$COMMAND" | ${runtime}`,
      "",
    ].join("\n"));
  }
  write(repoRoot, ".github/workflows/comment-pipe-php-options.yml", [
    "name: comment pipe PHP options",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: printf '%s' \"$COMMAND\" | php -d display_errors=1",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-pipe-xargs-shell.yml", [
    "name: comment pipe xargs shell",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: printf '%s' \"$COMMAND\" | xargs bash -c",
    "",
  ].join("\n"));
  write(safeRepo, ".github/workflows/comment-pipe-shell-script.yml", [
    "name: comment pipe shell script",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          DATA: " + bodyExpression,
    "        run: printf '%s' \"$DATA\" | bash trusted.sh",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add tainted shell pipeline");
  commitAll(safeRepo, "add shell script data pipeline");

  const audit = runAudit(repoRoot);
  const safeAudit = runAudit(safeRepo);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-pipe-shell.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-combined-pipe-shell.yml",
  );
  for (const runtime of ["node", "perl", "php", "python3", "ruby"]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-script-interpolation",
      `.github/workflows/comment-pipe-${runtime}.yml`,
    );
  }
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-pipe-php-options.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-pipe-xargs-shell.yml",
  );
  assert.equal(safeAudit.status, 0);
});

test("tainted here-strings cannot feed shell interpreters", () => {
  const repoRoot = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  write(repoRoot, ".github/workflows/comment-here-shell.yml", [
    "name: comment here shell",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: bash <<< \"$COMMAND\"",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-heredoc-shell.yml", [
    "name: comment heredoc shell",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: |",
    "          bash <<EOF",
    "          $COMMAND",
    "          EOF",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-here-source.yml", [
    "name: comment here source",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: source /dev/stdin <<< \"$COMMAND\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add tainted shell here-string");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-here-shell.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-heredoc-shell.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-here-source.yml",
  );
});

test("privileged workflows reject attacker-selected shell templates", () => {
  const repoRoot = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  write(repoRoot, ".github/workflows/comment-shell-template.yml", [
    "name: comment shell template",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - shell: " + bodyExpression,
    "        run: echo trusted",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add attacker-selected shell template");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-shell-template.yml",
  );
});

test("privileged workflows reject tainted executable action inputs", () => {
  const repoRoot = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  write(repoRoot, ".github/workflows/comment-github-script.yml", [
    "name: comment github script",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/github-script@" + "a".repeat(40),
    "        with:",
    "          script: " + bodyExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add tainted github script input");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-github-script.yml",
  );
});

test("privileged workflows reject attacker-controlled failure handling", () => {
  const repoRoot = makeRepository();
  const bodyExpression = ["$", "{{ fromJSON(github.event.comment.body) }}"].join("");
  write(repoRoot, ".github/workflows/comment-continue-error.yml", [
    "name: comment continue error",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  verify:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - continue-on-error: " + bodyExpression,
    "        run: exit 1",
    "      - run: echo deploy",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add attacker-controlled failure handling");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-control-flow",
    ".github/workflows/comment-continue-error.yml",
  );
});

test("public event author identities are untrusted checkout coordinates", () => {
  const repoRoot = makeRepository();
  const issueAuthorExpression = [
    "$",
    "{{ github.event.issue.user.login }}",
  ].join("");
  const actorExpression = ["$", "{{ github.actor }}"].join("");
  for (const [name, trigger, ownerExpression] of [
    ["issue-author", "issues", issueAuthorExpression],
    ["watch-actor", "watch", actorExpression],
  ]) {
    write(repoRoot, `.github/workflows/${name}-checkout.yml`, [
      "name: " + name + " checkout",
      "on: " + trigger,
      "permissions: read-all",
      "jobs:",
      "  inspect:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@" + "a".repeat(40),
      "        with:",
      "          repository: " + ownerExpression + "/public-payload",
      "          ref: main",
      "",
    ].join("\n"));
  }
  commitAll(repoRoot, "add public author checkouts");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  for (const name of ["issue-author", "watch-actor"]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-checkout",
      `.github/workflows/${name}-checkout.yml`,
    );
  }
});

test("fork events are privileged and expose untrusted repositories", () => {
  const repoRoot = makeRepository();
  const repositoryExpression = ["$", "{{ github.event.forkee.full_name }}"].join("");
  write(repoRoot, ".github/workflows/fork-checkout.yml", [
    "name: fork checkout",
    "on: fork",
    "permissions:",
    "  contents: write",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          repository: " + repositoryExpression,
    "          ref: main",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add fork checkout workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/fork-checkout.yml",
  );
});

test("privileged workflows reject shell-based untrusted checkouts", () => {
  const repoRoot = makeRepository();
  const repositoryExpression = [
    "$",
    "{{ github.event.pull_request.head.repo.full_name }}",
  ].join("");
  const refExpression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/shell-checkout.yml", [
    "name: shell checkout",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: |",
    "          REF=\"" + refExpression + "\"",
    "          git clone \"https://github.com/" + repositoryExpression + "\" source",
    "          git -C source checkout \"$REF\"",
    "          ./source/verify.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/shell-append-checkout.yml", [
    "name: shell append checkout",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          PR_REF: " + refExpression,
    "        run: |",
    "          REF=refs/heads/",
    "          REF+=\"$PR_REF\"",
    "          git checkout \"$REF\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add shell checkout workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/shell-checkout.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/shell-append-checkout.yml",
  );
});

test("tainted fetch state propagates through FETCH_HEAD checkouts", () => {
  const repoRoot = makeRepository();
  const refExpression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/fetched-head-checkout.yml", [
    "name: fetched head checkout",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: git fetch origin \"" + refExpression + "\"",
    "      - run: |",
    "          git checkout FETCH_HEAD",
    "          ./verify.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/fetched-head-update-ref.yml", [
    "name: fetched head update ref",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          PR_SHA: " + refExpression,
    "        run: |",
    "          git fetch origin \"$PR_SHA\"",
    "          git update-ref HEAD FETCH_HEAD",
    "          git reset --hard",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/fetched-head-branch.yml", [
    "name: fetched head branch",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          PR_SHA: " + refExpression,
    "        run: |",
    "          git fetch origin \"$PR_SHA\"",
    "          git branch review-head FETCH_HEAD",
    "          git checkout review-head",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/fetched-head-archive.yml", [
    "name: fetched head archive",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          PR_SHA: " + refExpression,
    "        run: |",
    "          git fetch origin \"$PR_SHA\"",
    "          git archive FETCH_HEAD | tar -x",
    "          ./verify.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/fetched-head-archive-get.yml", [
    "name: fetched head archive get",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          PR_SHA: " + refExpression,
    "        run: |",
    "          git fetch origin \"$PR_SHA\"",
    "          git archive FETCH_HEAD | tar --get",
    "          ./verify.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/fetched-head-restore.yml", [
    "name: fetched head restore",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          PR_SHA: " + refExpression,
    "        run: |",
    "          git fetch origin \"$PR_SHA\"",
    "          git restore --source FETCH_HEAD -- .",
    "          ./verify.sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/fetched-head-append.yml", [
    "name: fetched head append",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          PR_SHA: " + refExpression,
    "        run: |",
    "          git fetch origin \"$PR_SHA\"",
    "          git fetch --append origin refs/heads/main",
    "          git checkout FETCH_HEAD",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add fetched head checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/fetched-head-checkout.yml",
  );
  for (const form of [
    "update-ref", "branch", "archive", "archive-get", "restore", "append",
  ]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-checkout",
      `.github/workflows/fetched-head-${form}.yml`,
    );
  }
});

test("untrusted shell values unrelated to a fixed checkout do not block", () => {
  const repoRoot = makeRepository();
  const refExpression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/fixed-shell-checkout.yml", [
    "name: fixed shell checkout",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          FETCH_REF: " + refExpression,
    "        run: |",
    "          git fetch origin \"$FETCH_REF\"",
    "          git checkout main",
    "          echo \"requested ref: $FETCH_REF\"",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/trusted-fetch-overwrite.yml", [
    "name: trusted fetch overwrite",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          FETCH_REF: " + refExpression,
    "        run: |",
    "          git fetch origin \"$FETCH_REF\"",
    "          git fetch origin refs/heads/main",
    "          git checkout FETCH_HEAD",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/trusted-fetch-cross-step-overwrite.yml", [
    "name: trusted fetch cross-step overwrite",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          FETCH_REF: " + refExpression,
    "        run: git fetch origin \"$FETCH_REF\"",
    "      - run: git fetch origin refs/heads/main",
    "      - run: git checkout FETCH_HEAD",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add fixed shell checkout workflow");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.findings.some((finding) => (
    finding.ruleId === "workflow-privileged-untrusted-checkout"
  )), false);
});

test("workflow container and service images require immutable digests", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/mutable-containers.yml", [
    "name: mutable containers",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    container:",
    "      image: alpine:latest",
    "    services:",
    "      database:",
    "        image: postgres:latest",
    "    steps:",
    "      - run: echo inspect",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/pinned-containers.yml", [
    "name: pinned containers",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    `    container: alpine@sha256:${"a".repeat(64)}`,
    "    services:",
    "      database:",
    `        image: postgres@sha256:${"b".repeat(64)}`,
    "    steps:",
    "      - run: echo inspect",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add workflow container fixtures");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-mutable-container-image",
    ".github/workflows/mutable-containers.yml",
  );
  assert.equal(audit.result.findings.some((finding) => (
    finding.path === ".github/workflows/pinned-containers.yml"
  )), false);
});

test("privileged workflows reject attacker-selected container images", () => {
  const repoRoot = makeRepository();
  const matrixExpression = ["$", "{{ fromJSON(github.event.comment.body) }}"].join("");
  const imageExpression = ["$", "{{ matrix.image }}"].join("");
  for (const [name, imageConfiguration] of [
    ["job", ["    container: " + imageExpression]],
    ["service", [
      "    services:",
      "      payload:",
      "        image: " + imageExpression,
    ]],
  ]) {
    write(repoRoot, `.github/workflows/dynamic-${name}-container.yml`, [
      `name: dynamic ${name} container`,
      "on: issue_comment",
      "permissions: read-all",
      "jobs:",
      "  inspect:",
      "    strategy:",
      "      matrix: " + matrixExpression,
      "    runs-on: ubuntu-latest",
      ...imageConfiguration,
      "    steps:",
      "      - run: echo inspect",
      "",
    ].join("\n"));
  }
  commitAll(repoRoot, "add attacker-selected containers");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  for (const name of ["job", "service"]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-container-image",
      `.github/workflows/dynamic-${name}-container.yml`,
    );
  }
});

test("privileged workflows reject attacker-selected runners", () => {
  const repoRoot = makeRepository();
  const matrixExpression = ["$", "{{ fromJSON(github.event.comment.body) }}"].join("");
  const runnerExpression = ["$", "{{ matrix.runner }}"].join("");
  write(repoRoot, ".github/workflows/dynamic-public-runner.yml", [
    "name: dynamic public runner",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    strategy:",
    "      matrix: " + matrixExpression,
    "    runs-on: " + runnerExpression,
    "    steps:",
    "      - run: echo inspect",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add attacker-selected runner");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-runner",
    ".github/workflows/dynamic-public-runner.yml",
  );
});

test("privileged workflows reject attacker-selected deployment environments", () => {
  const repoRoot = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  write(repoRoot, ".github/workflows/comment-environment.yml", [
    "name: comment environment",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  deploy:",
    "    runs-on: ubuntu-latest",
    "    environment: " + bodyExpression,
    "    steps:",
    "      - run: echo deploy",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add attacker-selected environment");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-environment",
    ".github/workflows/comment-environment.yml",
  );
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

test("quoted immutable flow-style action references remain trusted", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/quoted-flow-actions.yml", [
    "name: quoted flow actions",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - { uses: './local-action' }",
    "      - { uses: 'example/action@" + "a".repeat(40) + "' }",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add quoted flow action workflow");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.warningCount, 0);
});

test("action inputs named uses are not dependency references", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/uses-input.yml", [
    "name: uses input",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: example/action@" + "a".repeat(40),
    "        with: { uses: arbitrary-input-value }",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add uses action input workflow");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.warningCount, 0);
});

test("local composite action dependencies are audited recursively", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/local-action.yml", [
    "name: local action",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/outer",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/outer/action.yml", [
    "name: outer",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: ./.github/actions/inner",
    "    - uses: example/action@main",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/inner/action.yml", [
    "name: inner",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: actions/checkout@" + "a".repeat(40),
    "      with:",
    "        ref: " + expression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add recursive composite actions");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/actions/inner/action.yml",
  );
  assertFinding(
    audit.result,
    "workflow-mutable-action-ref",
    ".github/actions/outer/action.yml",
  );
});

test("local action references cannot traverse tracked symlinks", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/symlink-action.yml", [
    "name: symlink action",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/link",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/target/action.yml", [
    "name: symlink target",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: actions/checkout@" + "a".repeat(40),
    "      with:",
    "        ref: " + headExpression,
    "",
  ].join("\n"));
  symlinkSync("target", path.join(repoRoot, ".github/actions/link"));
  commitAll(repoRoot, "add symlinked local action");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-local-action-symlink",
    ".github/workflows/symlink-action.yml",
  );
});

test("repository-root local actions are audited", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/root-action.yml", [
    "name: root action",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./",
    "",
  ].join("\n"));
  write(repoRoot, "action.yml", [
    "name: root action",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: actions/checkout@" + "a".repeat(40),
    "      with:",
    "        ref: " + expression,
    "    - uses: example/action@main",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add repository root action");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "workflow-privileged-untrusted-checkout", "action.yml");
  assertFinding(audit.result, "workflow-mutable-action-ref", "action.yml");
});

test("flow-style composite runs expand block sequence aliases", () => {
  const repoRoot = makeRepository();
  const expression = ["$", "{{ github.head_ref }}"].join("");
  write(repoRoot, ".github/workflows/flow-composite-alias.yml", [
    "name: flow composite alias",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/flow-composite-alias",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/flow-composite-alias/action.yml", [
    "name: flow composite alias",
    "x-steps: &unsafe-steps",
    "  - uses: actions/checkout@" + "a".repeat(40),
    "    with:",
    "      ref: " + expression,
    "runs: { using: composite, steps: *unsafe-steps }",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add flow composite sequence alias");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/actions/flow-composite-alias/action.yml",
  );
});

test("caller taint propagates into local composite action inputs", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const inputExpression = ["$", "{{ inputs.ref }}"].join("");
  write(repoRoot, ".github/workflows/composite-input.yml", [
    "name: composite input",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/input-checkout",
    "        with:",
    "          ref: " + headExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/input-checkout/action.yml", [
    "name: input checkout",
    "inputs:",
    "  ref:",
    "    required: true",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: actions/checkout@" + "a".repeat(40),
    "      with:",
    "        ref: " + inputExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add composite input checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/actions/input-checkout/action.yml",
  );
});

test("GITHUB_ENV taint propagates across local composite action steps", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const inputExpression = ["$", "{{ inputs.ref }}"].join("");
  const envExpression = ["$", "{{ env.PR_REF }}"].join("");
  write(repoRoot, ".github/workflows/composite-environment.yml", [
    "name: composite environment",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/environment-checkout",
    "        with:",
    "          ref: " + headExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/environment-checkout/action.yml", [
    "name: environment checkout",
    "inputs:",
    "  ref:",
    "    required: true",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - shell: bash",
    "      env:",
    "        SOURCE_REF: " + inputExpression,
    "      run: |",
    "        echo \"PR_REF=$SOURCE_REF\" >> \"$GITHUB_ENV\"",
    "    - uses: actions/checkout@" + "a".repeat(40),
    "      with:",
    "        ref: " + envExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add composite environment checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/actions/environment-checkout/action.yml",
  );
});

test("local actions inherit caller environment taint", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const envExpression = ["$", "{{ env.PR_REF }}"].join("");
  write(repoRoot, ".github/workflows/inherited-action-environment.yml", [
    "name: inherited action environment",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          SOURCE_REF: " + headExpression,
    "        run: echo \"PR_REF=$SOURCE_REF\" >> \"$GITHUB_ENV\"",
    "      - uses: ./.github/actions/inherited-environment-checkout",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/inherited-environment-checkout/action.yml", [
    "name: inherited environment checkout",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: actions/checkout@" + "a".repeat(40),
    "      with:",
    "        ref: " + envExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add inherited composite environment checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/actions/inherited-environment-checkout/action.yml",
  );
});

test("local composite outputs return inherited taint to callers", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const outputExpression = ["$", "{{ steps.source.outputs.ref }}"].join("");
  const actionOutputExpression = ["$", "{{ steps.export.outputs.ref }}"].join("");
  write(repoRoot, ".github/workflows/composite-output.yml", [
    "name: composite output",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          SOURCE_REF: " + headExpression,
    "        run: echo \"PR_REF=$SOURCE_REF\" >> \"$GITHUB_ENV\"",
    "      - id: source",
    "        uses: ./.github/actions/output-ref",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + outputExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/output-ref/action.yml", [
    "name: output ref",
    "outputs:",
    "  ref:",
    "    value: " + actionOutputExpression,
    "runs:",
    "  using: composite",
    "  steps:",
    "    - id: export",
    "      shell: bash",
    "      run: |",
    "        declare REF=\"$PR_REF\"",
    "        typeset OUTPUT_REF=\"$REF\"",
    "        echo \"ref=$OUTPUT_REF\" >> \"$GITHUB_OUTPUT\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add composite output checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/composite-output.yml",
  );
});

test("composite input defaults are tainted unless callers override them", () => {
  const unsafeRepo = makeRepository();
  const safeRepo = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const inputExpression = ["$", "{{ inputs.ref }}"].join("");
  for (const [repoRoot, override] of [[unsafeRepo, false], [safeRepo, true]]) {
    write(repoRoot, ".github/workflows/composite-default.yml", [
      "name: composite default",
      "on: pull_request_target",
      "permissions: read-all",
      "jobs:",
      "  inspect:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: ./.github/actions/default-checkout",
      ...(override ? ["        with:", "          ref: main"] : []),
      "",
    ].join("\n"));
    write(repoRoot, ".github/actions/default-checkout/action.yml", [
      "name: default checkout",
      "inputs:",
      "  ref:",
      "    default: " + headExpression,
      "runs:",
      "  using: composite",
      "  steps:",
      "    - uses: actions/checkout@" + "a".repeat(40),
      "      with:",
      "        ref: " + inputExpression,
      "",
    ].join("\n"));
    commitAll(repoRoot, "add composite default checkout");
  }

  const unsafeAudit = runAudit(unsafeRepo);
  const safeAudit = runAudit(safeRepo);

  assert.equal(unsafeAudit.status, 1);
  assertFinding(
    unsafeAudit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/actions/default-checkout/action.yml",
  );
  assert.equal(safeAudit.status, 0);
});

test("action.yml takes precedence while action.yaml remains a fallback", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/action-manifest-precedence.yml", [
    "name: action manifest precedence",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/preferred",
    "      - uses: ./.github/actions/yaml-only",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/preferred/action.yml", [
    "name: preferred",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: example/action@" + "a".repeat(40),
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/preferred/action.yaml", [
    "name: unused fallback",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: example/action@main",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/yaml-only/action.yaml", [
    "name: yaml fallback",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - uses: example/action@main",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add action manifest precedence fixtures");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-mutable-action-ref",
    ".github/actions/yaml-only/action.yaml",
  );
  assert.equal(audit.result.findings.some((finding) => (
    finding.path === ".github/actions/preferred/action.yaml"
  )), false);
});

test("local Docker action images require immutable digests", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/local-docker-actions.yml", [
    "name: local Docker actions",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/mutable-image",
    "      - uses: ./.github/actions/pinned-image",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/mutable-image/action.yml", [
    "name: mutable image",
    "runs:",
    "  using: docker",
    "  image: docker://alpine:latest",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/pinned-image/action.yml", [
    "name: pinned image",
    "runs:",
    "  using: docker",
    `  image: docker://alpine@sha256:${"a".repeat(64)}`,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add local Docker action fixtures");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-mutable-action-ref",
    ".github/actions/mutable-image/action.yml",
  );
  assert.equal(audit.result.findings.some((finding) => (
    finding.path === ".github/actions/pinned-image/action.yml"
  )), false);
});

test("Dockerfile-backed local actions require immutable base images", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/dockerfile-actions.yml", [
    "name: Dockerfile actions",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/mutable-base",
    "      - uses: ./.github/actions/pinned-base",
    "",
  ].join("\n"));
  for (const actionName of ["mutable-base", "pinned-base"]) {
    write(repoRoot, `.github/actions/${actionName}/action.yml`, [
      "name: " + actionName,
      "runs:",
      "  using: docker",
      "  image: Dockerfile",
      "",
    ].join("\n"));
  }
  write(
    repoRoot,
    ".github/actions/mutable-base/Dockerfile",
    "FROM alpine:latest\n",
  );
  write(
    repoRoot,
    ".github/actions/pinned-base/Dockerfile",
    `FROM alpine@sha256:${"a".repeat(64)}\n`,
  );
  commitAll(repoRoot, "add Dockerfile action fixtures");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-mutable-action-ref",
    ".github/actions/mutable-base/Dockerfile",
  );
  assert.equal(audit.result.findings.some((finding) => (
    finding.path === ".github/actions/pinned-base/Dockerfile"
  )), false);
});

test("Dockerfile-backed actions require immutable external COPY images", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/dockerfile-copy-actions.yml", [
    "name: Dockerfile COPY actions",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/mutable-copy",
    "      - uses: ./.github/actions/pinned-copy",
    "      - uses: ./.github/actions/staged-copy",
    "",
  ].join("\n"));
  for (const actionName of ["mutable-copy", "pinned-copy", "staged-copy"]) {
    write(repoRoot, `.github/actions/${actionName}/action.yml`, [
      "name: " + actionName,
      "runs:",
      "  using: docker",
      "  image: Dockerfile",
      "",
    ].join("\n"));
  }
  write(repoRoot, ".github/actions/mutable-copy/Dockerfile", [
    "FROM scratch",
    "COPY --from=alpine:latest /bin/sh /bin/sh",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/pinned-copy/Dockerfile", [
    "FROM scratch",
    `COPY --from=alpine@sha256:${"a".repeat(64)} /bin/sh /bin/sh`,
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/staged-copy/Dockerfile", [
    `FROM alpine@sha256:${"b".repeat(64)} AS builder`,
    "FROM scratch",
    "COPY --from=builder /bin/sh /bin/sh",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add Dockerfile COPY fixtures");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-mutable-action-ref",
    ".github/actions/mutable-copy/Dockerfile",
  );
  for (const actionName of ["pinned-copy", "staged-copy"]) {
    assert.equal(audit.result.findings.some((finding) => (
      finding.path === `.github/actions/${actionName}/Dockerfile`
    )), false);
  }
});

test("Dockerfile-backed actions require immutable external RUN mount images", () => {
  const repoRoot = makeRepository();
  write(repoRoot, ".github/workflows/dockerfile-run-mount-actions.yml", [
    "name: Dockerfile RUN mount actions",
    "on: push",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: ./.github/actions/mutable-run-mount",
    "      - uses: ./.github/actions/pinned-run-mount",
    "      - uses: ./.github/actions/staged-run-mount",
    "",
  ].join("\n"));
  for (const actionName of [
    "mutable-run-mount",
    "pinned-run-mount",
    "staged-run-mount",
  ]) {
    write(repoRoot, `.github/actions/${actionName}/action.yml`, [
      "name: " + actionName,
      "runs:",
      "  using: docker",
      "  image: Dockerfile",
      "",
    ].join("\n"));
  }
  write(repoRoot, ".github/actions/mutable-run-mount/Dockerfile", [
    "FROM scratch",
    "RUN --mount=from=busybox:latest,source=/bin,target=/mnt /mnt/cp /mnt/sh /bin/other",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/pinned-run-mount/Dockerfile", [
    "FROM scratch",
    `RUN --mount=from=busybox@sha256:${"c".repeat(64)},source=/bin,target=/mnt /mnt/cp /mnt/sh /bin/other`,
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/staged-run-mount/Dockerfile", [
    `FROM busybox@sha256:${"d".repeat(64)} AS tools`,
    "FROM scratch",
    "RUN --mount=from=tools,source=/bin,target=/mnt /mnt/cp /mnt/sh /bin/other",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add Dockerfile RUN mount fixtures");

  const audit = runAudit(repoRoot, ["--fail-on-warning"]);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-mutable-action-ref",
    ".github/actions/mutable-run-mount/Dockerfile",
  );
  for (const actionName of ["pinned-run-mount", "staged-run-mount"]) {
    assert.equal(audit.result.findings.some((finding) => (
      finding.path === `.github/actions/${actionName}/Dockerfile`
    )), false);
  }
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

test("composite outputs propagate through reusable workflow returns", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const inputExpression = ["$", "{{ inputs.ref }}"].join("");
  const jobOutputExpression = ["$", "{{ jobs.source.outputs.ref }}"].join("");
  const stepOutputExpression = ["$", "{{ steps.composite.outputs.ref }}"].join("");
  const actionOutputExpression = ["$", "{{ steps.export.outputs.ref }}"].join("");
  const returnedExpression = ["$", "{{ needs.source.outputs.ref }}"].join("");
  write(repoRoot, ".github/workflows/composite-return-caller.yml", [
    "name: composite return caller",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  source:",
    "    uses: ./.github/workflows/composite-return-callee.yml",
    "    with:",
    "      ref: " + headExpression,
    "  inspect:",
    "    needs: source",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + returnedExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/composite-return-callee.yml", [
    "name: composite return callee",
    "on:",
    "  workflow_call:",
    "    inputs:",
    "      ref:",
    "        required: true",
    "        type: string",
    "    outputs:",
    "      ref:",
    "        value: " + jobOutputExpression,
    "permissions: read-all",
    "jobs:",
    "  source:",
    "    runs-on: ubuntu-latest",
    "    env:",
    "      PR_REF: " + inputExpression,
    "    outputs:",
    "      ref: " + stepOutputExpression,
    "    steps:",
    "      - id: composite",
    "        uses: ./.github/actions/reusable-output-ref",
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/reusable-output-ref/action.yml", [
    "name: reusable output ref",
    "outputs:",
    "  ref:",
    "    value: " + actionOutputExpression,
    "runs:",
    "  using: composite",
    "  steps:",
    "    - id: export",
    "      shell: bash",
    "      run: echo \"ref=$PR_REF\" >> \"$GITHUB_OUTPUT\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add composite reusable output checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/composite-return-caller.yml",
  );
});

test("attached here-strings cannot feed tainted text into shell interpreters", () => {
  const repoRoot = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  write(repoRoot, ".github/workflows/comment-attached-here-shell.yml", [
    "name: comment attached here shell",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: bash <<<\"$COMMAND\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add attached tainted shell here-string");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-attached-here-shell.yml",
  );
});

test("artifact execution recognizes interpreter process substitution", () => {
  const repoRoot = makeRepository();
  const runIdExpression = ["$", "{{ github.event.workflow_run.id }}"].join("");
  write(repoRoot, ".github/workflows/workflow-run-artifact-process-substitution.yml", [
    "name: workflow run artifact process substitution",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: payload",
    "      - run: bash <(cat payload/run.sh)",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/workflow-run-artifact-inline-substitution.yml", [
    "name: workflow run artifact inline substitution",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "      - run: bash <(printf 'echo trusted')",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/workflow-run-artifact-terminated-substitution.yml", [
    "name: workflow run artifact terminated substitution",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/download-artifact@" + "a".repeat(40),
    "        with:",
    "          run-id: " + runIdExpression,
    "          path: payload",
    "      - run: bash -- <(cat payload/run.sh)",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add artifact process substitution execution");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-artifact-execution",
    ".github/workflows/workflow-run-artifact-process-substitution.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-artifact-execution",
    ".github/workflows/workflow-run-artifact-terminated-substitution.yml",
  );
  assert.equal(audit.result.findings.some((finding) => (
    finding.ruleId === "workflow-privileged-untrusted-artifact-execution"
    && finding.path === ".github/workflows/workflow-run-artifact-inline-substitution.yml"
  )), false);
});

test("privileged workflows reject attacker-controlled job and step conditions", () => {
  const repoRoot = makeRepository();
  const conditionExpression = [
    "$",
    "{{ !fromJSON(github.event.comment.body) }}",
  ].join("");
  for (const scope of ["job", "step"]) {
    write(repoRoot, `.github/workflows/comment-${scope}-condition.yml`, [
      `name: comment ${scope} condition`,
      "on: issue_comment",
      "permissions: read-all",
      "jobs:",
      "  deploy:",
      ...(scope === "job" ? ["    if: " + conditionExpression] : []),
      "    runs-on: ubuntu-latest",
      "    steps:",
      ...(scope === "step" ? ["      - if: " + conditionExpression] : ["      - run: echo verify"]),
      ...(scope === "step" ? ["        run: echo deploy"] : []),
      "",
    ].join("\n"));
  }
  write(repoRoot, ".github/workflows/comment-authorized-command.yml", [
    "name: comment authorized command",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  review:",
    "    if: |",
    "      (",
    "        github.event.comment.author_association == 'MEMBER'",
    "        || github.event.comment.author_association == 'OWNER'",
    "      )",
    "      && startsWith(github.event.comment.body, '/review')",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo review",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/comment-command-or-bypass.yml", [
    "name: comment command or bypass",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  deploy:",
    "    if: github.event.comment.author_association == 'MEMBER' && startsWith(github.event.comment.body, '/review') || true",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo deploy",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add attacker-controlled workflow conditions");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  for (const scope of ["job", "step"]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-control-flow",
      `.github/workflows/comment-${scope}-condition.yml`,
    );
  }
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-control-flow",
    ".github/workflows/comment-command-or-bypass.yml",
  );
  assert.equal(audit.result.findings.some((finding) => (
    finding.ruleId === "workflow-privileged-untrusted-control-flow"
    && finding.path === ".github/workflows/comment-authorized-command.yml"
  )), false);
});

test("GITHUB_OUTPUT destination aliases preserve composite output taint", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const outputExpression = ["$", "{{ steps.source.outputs.ref }}"].join("");
  const actionOutputExpression = ["$", "{{ steps.export.outputs.ref }}"].join("");
  write(repoRoot, ".github/workflows/aliased-composite-output.yml", [
    "name: aliased composite output",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    env:",
    "      PR_REF: " + headExpression,
    "    steps:",
    "      - id: source",
    "        uses: ./.github/actions/aliased-output-ref",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + outputExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/aliased-output-ref/action.yml", [
    "name: aliased output ref",
    "outputs:",
    "  ref:",
    "    value: " + actionOutputExpression,
    "runs:",
    "  using: composite",
    "  steps:",
    "    - id: export",
    "      shell: bash",
    "      run: |",
    "        DESTINATION=\"$GITHUB_OUTPUT\"",
    "        echo \"ref=$PR_REF\" >> \"$DESTINATION\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add aliased composite output checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-checkout",
    ".github/workflows/aliased-composite-output.yml",
  );
});

test("composite outputs only inherit taint from their actual output writes", () => {
  const repoRoot = makeRepository();
  const headExpression = ["$", "{{ github.head_ref }}"].join("");
  const outputExpression = ["$", "{{ steps.source.outputs.ref }}"].join("");
  const actionOutputExpression = ["$", "{{ steps.export.outputs.ref }}"].join("");
  write(repoRoot, ".github/workflows/constant-composite-output.yml", [
    "name: constant composite output",
    "on: pull_request_target",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          SOURCE_REF: " + headExpression,
    "        run: echo \"PR_REF=$SOURCE_REF\" >> \"$GITHUB_ENV\"",
    "      - id: source",
    "        uses: ./.github/actions/constant-output-ref",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + outputExpression,
    "",
  ].join("\n"));
  write(repoRoot, ".github/actions/constant-output-ref/action.yml", [
    "name: constant output ref",
    "outputs:",
    "  ref:",
    "    value: " + actionOutputExpression,
    "runs:",
    "  using: composite",
    "  steps:",
    "    - id: export",
    "      shell: bash",
    "      run: |",
    "        printf '%s\\n' \"$PR_REF\"",
    "        echo \"ref=main\" >> \"$GITHUB_OUTPUT\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add constant composite output checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.findings.some((finding) => (
    finding.ruleId === "workflow-privileged-untrusted-checkout"
  )), false);
});

test("step outputs only inherit taint from their named output writes", () => {
  const repoRoot = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  const safeOutputExpression = ["$", "{{ steps.source.outputs.ref }}"].join("");
  write(repoRoot, ".github/workflows/named-step-output.yml", [
    "name: named step output",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - id: source",
    "        env:",
    "          CODE: " + bodyExpression,
    "        run: |",
    "          echo \"unsafe=$CODE\" >> \"$GITHUB_OUTPUT\"",
    "          echo \"ref=main\" >> \"$GITHUB_OUTPUT\"",
    "      - uses: actions/checkout@" + "a".repeat(40),
    "        with:",
    "          ref: " + safeOutputExpression,
    "",
  ].join("\n"));
  commitAll(repoRoot, "add named step output checkout");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.findings.some((finding) => (
    finding.ruleId === "workflow-privileged-untrusted-checkout"
  )), false);
});

test("tainted text cannot reach language runtime evaluators", () => {
  const repoRoot = makeRepository();
  const bodyExpression = ["$", "{{ github.event.comment.body }}"].join("");
  for (const [runtime, command] of [
    ["python", "python -c \"$COMMAND\""],
    ["python-attached", "python -c\"$COMMAND\""],
    ["node", "node -e \"$COMMAND\""],
    ["node-long-eval", "node --eval \"$COMMAND\""],
    ["node-print", "node -p \"$COMMAND\""],
    ["node-long-print", "node --print \"$COMMAND\""],
    ["perl", "perl -e \"$COMMAND\""],
    ["ruby", "ruby -e \"$COMMAND\""],
    ["nohup-shell", "nohup bash -c \"$COMMAND\""],
    ["timeout-shell", "timeout 10 bash -c \"$COMMAND\""],
    ["awk", "awk \"$COMMAND\" /dev/null"],
    ["awk-e", "awk -e \"$COMMAND\" /dev/null"],
    ["sed", "printf x | sed \"$COMMAND\""],
    ["sed-e", "printf x | sed -e \"$COMMAND\""],
    ["find-exec-shell", "find . -maxdepth 0 -exec bash -c \"$COMMAND\" \\;"],
  ]) {
    write(repoRoot, `.github/workflows/comment-${runtime}-eval.yml`, [
      `name: comment ${runtime} eval`,
      "on: issue_comment",
      "permissions: read-all",
      "jobs:",
      "  inspect:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - env:",
      "          COMMAND: " + bodyExpression,
      "        run: " + command,
      "",
    ].join("\n"));
  }
  write(repoRoot, ".github/workflows/comment-printf-assignment-eval.yml", [
    "name: comment printf assignment eval",
    "on: issue_comment",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - env:",
    "          COMMAND: " + bodyExpression,
    "        run: |",
    "          printf -v VALUE '%s' \"$COMMAND\"",
    "          eval \"$VALUE\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add tainted language runtime evaluators");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  for (const runtime of [
    "python", "python-attached", "node", "node-long-eval", "node-print",
    "node-long-print", "perl", "ruby", "nohup-shell",
    "timeout-shell", "awk", "awk-e", "sed", "sed-e", "find-exec-shell",
  ]) {
    assertFinding(
      audit.result,
      "workflow-privileged-untrusted-script-interpolation",
      `.github/workflows/comment-${runtime}-eval.yml`,
    );
  }
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/comment-printf-assignment-eval.yml",
  );
});

test("workflow_run head metadata is untrusted script data", () => {
  const repoRoot = makeRepository();
  const headBranchExpression = [
    "$",
    "{{ github.event.workflow_run.head_branch }}",
  ].join("");
  write(repoRoot, ".github/workflows/workflow-run-head-branch-script.yml", [
    "name: workflow run head branch script",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo \"" + headBranchExpression + "\"",
    "",
  ].join("\n"));
  const headCommitMessageExpression = [
    "$",
    "{{ github.event.workflow_run.head_commit.message }}",
  ].join("");
  write(repoRoot, ".github/workflows/workflow-run-head-commit-script.yml", [
    "name: workflow run head commit script",
    "on:",
    "  workflow_run:",
    "    workflows: [verify]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo \"" + headCommitMessageExpression + "\"",
    "",
  ].join("\n"));
  const displayTitleExpression = [
    "$",
    "{{ github.event.workflow_run.display_title }}",
  ].join("");
  const pullRequestTitleExpression = [
    "$",
    "{{ github.event.pull_request.title }}",
  ].join("");
  write(repoRoot, ".github/workflows/verify-pull-request-title.yml", [
    "name: verify pull request title",
    "run-name: " + pullRequestTitleExpression,
    "on: pull_request",
    "permissions: read-all",
    "jobs:",
    "  verify:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo verified",
    "",
  ].join("\n"));
  write(repoRoot, ".github/workflows/workflow-run-display-title-script.yml", [
    "name: workflow run display title script",
    "on:",
    "  workflow_run:",
    "    workflows: [verify pull request title]",
    "    types: [completed]",
    "permissions: read-all",
    "jobs:",
    "  inspect:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo \"" + displayTitleExpression + "\"",
    "",
  ].join("\n"));
  commitAll(repoRoot, "add workflow run head branch script");

  const audit = runAudit(repoRoot);

  assert.equal(audit.status, 1);
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/workflow-run-head-branch-script.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/workflow-run-head-commit-script.yml",
  );
  assertFinding(
    audit.result,
    "workflow-privileged-untrusted-script-interpolation",
    ".github/workflows/workflow-run-display-title-script.yml",
  );
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

test("required-check strictness is associated with the supplying rule", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const snapshot = githubSnapshot();
  snapshot.rulesets[0].rules[2].parameters.strict_required_status_checks_policy = false;
  snapshot.rulesets.push({
    bypass_actors: [],
    conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
    enforcement: "active",
    rules: [{
      parameters: {
        required_status_checks: [{ context: "lint", integration_id: 15368 }],
        strict_required_status_checks_policy: true,
      },
      type: "required_status_checks",
    }],
    target: "branch",
  });

  const audit = runAudit(repoRoot, [
    "--github-snapshot", writeSnapshot(snapshot),
    "--required-check", "verify",
  ]);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "github-required-check-not-strict");
  assert.equal(
    audit.result.findings.some((finding) => finding.ruleId === "github-required-check-not-strict"
      && finding.check === "verify"),
    true,
  );
});

test("required-check strictness and app identity come from the same record", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const snapshot = githubSnapshot();
  snapshot.rulesets[0].rules[2].parameters.strict_required_status_checks_policy = false;
  snapshot.rulesets.push({
    bypass_actors: [],
    conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
    enforcement: "active",
    rules: [{
      parameters: {
        required_status_checks: [{ context: "verify", integration_id: 999 }],
        strict_required_status_checks_policy: true,
      },
      type: "required_status_checks",
    }],
    target: "branch",
  });

  const audit = runAudit(repoRoot, [
    "--github-snapshot", writeSnapshot(snapshot),
    "--required-check", "verify",
  ]);

  assert.equal(audit.status, 1);
  assert.equal(
    audit.result.findings.some((finding) => finding.ruleId === "github-required-check-not-strict"
      && finding.check === "verify"),
    true,
  );
});

test("missing ruleset bypass evidence fails closed", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const snapshot = githubSnapshot();
  delete snapshot.rulesets[0].bypass_actors;

  const audit = runAudit(repoRoot, [
    "--github-snapshot", writeSnapshot(snapshot),
    "--required-check", "verify",
  ]);

  assert.equal(audit.status, 1);
  assertFinding(audit.result, "github-protection-bypass");
});

test("an unbypassable ruleset covers a classic administrator exemption", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const snapshot = githubSnapshot();
  snapshot.branchProtection = { enforce_admins: { enabled: false } };

  const audit = runAudit(repoRoot, [
    "--github-snapshot", writeSnapshot(snapshot),
    "--required-check", "verify",
  ]);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.passed, true);
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

test("ruleset double-star directories may match zero levels", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const snapshot = githubSnapshot();
  snapshot.repository.default_branch = "releases/1";
  snapshot.rulesets[0].conditions.ref_name.include = ["refs/heads/releases/**/*"];

  const audit = runAudit(repoRoot, [
    "--github-snapshot", writeSnapshot(snapshot),
    "--required-check", "verify",
  ]);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.passed, true);
});

test("ruleset character classes match default branch segments", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const snapshot = githubSnapshot();
  snapshot.repository.default_branch = "release/1.0";
  snapshot.rulesets[0].conditions.ref_name.include = ["refs/heads/release/[0-9]*"];

  const audit = runAudit(repoRoot, [
    "--github-snapshot", writeSnapshot(snapshot),
    "--required-check", "verify",
  ]);

  assert.equal(audit.status, 0);
  assert.equal(audit.result.passed, true);
});

test("ruleset negated character classes exclude default branches", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const excludedSnapshot = githubSnapshot();
  excludedSnapshot.repository.default_branch = "release/0";
  excludedSnapshot.rulesets[0].conditions.ref_name.include = ["refs/heads/release/[!0]*"];
  const includedSnapshot = structuredClone(excludedSnapshot);
  includedSnapshot.repository.default_branch = "release/1";

  const excludedAudit = runAudit(repoRoot, [
    "--github-snapshot", writeSnapshot(excludedSnapshot),
    "--required-check", "verify",
  ]);
  const includedAudit = runAudit(repoRoot, [
    "--github-snapshot", writeSnapshot(includedSnapshot),
    "--required-check", "verify",
  ]);

  assert.equal(excludedAudit.status, 1);
  assertFinding(excludedAudit.result, "github-required-check-missing");
  assert.equal(includedAudit.status, 0);
});

test("live GitHub evidence consumes every ruleset page", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const snapshot = githubSnapshot();
  const laterRuleset = {
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

test("live GitHub evidence is pinned to github.com", () => {
  const repoRoot = makeRepository();
  writeSafeWorkflow(repoRoot);
  commitAll(repoRoot, "add safe workflow");
  const snapshot = githubSnapshot();
  const fakeGhDirectory = writeFakeGh({
    branchProtection: snapshot.branchProtection,
    repository: snapshot.repository,
    rulesetPages: [[{ id: 1 }]],
    rulesets: { 1: snapshot.rulesets[0] },
    runners: snapshot.runners,
  });

  const audit = runAudit(repoRoot, [
    "--github", "example/public",
    "--required-check", "verify",
  ], {
    env: {
      ...process.env,
      GH_HOST: "enterprise.example.invalid",
      PATH: `${fakeGhDirectory}:${process.env.PATH}`,
    },
  });

  assert.equal(audit.status, 0);
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

function missingGitObjectIds(repoRoot) {
  const result = spawnSync("git", [
    "rev-list", "--objects", "--missing=print", "HEAD",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("?"))
    .sort();
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
    "const hostnameIndex = args.indexOf('--hostname');",
    "if (hostnameIndex < 0 || args[hostnameIndex + 1] !== 'github.com') process.exit(5);",
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
