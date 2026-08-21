/*
 * Adapted from the Codex Autopilot public-safety audit at reviewed commit
 * 9dd7ecb8a1aecb3d757b935a970991fd3461f5f4. Copyright (c) 2026 Codex
 * Autopilot contributors. MIT license; see THIRD_PARTY_NOTICES.md.
 *
 * This file is the dependency-free JavaScript build of the reviewed
 * TypeScript scanner. Keep behavior changes fixture-backed and reconcile them
 * with the upstream source deliberately.
 */

// -------------------------------------------------------------------------- //
//                                  IMPORTS                                   //
// -------------------------------------------------------------------------- //
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { TextDecoder } from "node:util";
// -------------------------------------------------------------------------- //
//                                  CONSTANTS                                 //
// -------------------------------------------------------------------------- //
const GENERIC_HOME_DIRECTORY_NAMES = new Set([
    "alice",
    "dashboard",
    "example",
    "fixture",
    "fixtures",
    "nobody",
    "operator",
    "public",
    "runner",
    "settings",
    "shared",
    "test",
    "tester",
    "user",
    "username",
]);
const HISTORY_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const GIT_TEXT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const GITHUB_APP_JWT_PATTERN = /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9])/gu;
const GITHUB_APP_JWT_MAX_INTERVAL_SECONDS = 660;
const GIT_BLOB_FULL_DECODE_MAX_BYTES = 64 * 1024 * 1024;
const GIT_LFS_POINTER_MAX_BYTES = 1024;
const LARGE_BLOB_SCAN_CHUNK_BYTES = 256 * 1024;
const LARGE_BLOB_SCAN_OVERLAP_CHARACTERS = 1024 * 1024;
const MAX_REPORTED_FINDINGS = 25;
const OPENPGP_CRC24_INITIAL_VALUE = 0xb704ce;
const OPENPGP_CRC24_POLYNOMIAL = 0x1864cf;
const OPENPGP_ARMOR_CHECKSUM_LINE_PATTERN = /^=[A-Za-z0-9+/]{4}$/u;
const OPENPGP_ARMOR_HEADER_LINE_PATTERN = /^[^:\r\n]+: ?[^\r\n]*$/u;
const OPENPGP_PAYLOAD_LINE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const OPENPGP_PRIVATE_KEY_BEGIN_LINE = "-----BEGIN PGP PRIVATE KEY BLOCK-----";
const OPENPGP_PRIVATE_KEY_END_LINE = "-----END PGP PRIVATE KEY BLOCK-----";
const PEM_LINE_BREAK_SCAN_PATTERN = /(?:\\r)?\\n|\r?\n/gu;
const PEM_PRIVATE_KEY_BEGIN_LINE_PATTERN = /^[ \t]*-----BEGIN ((?:[A-Z0-9 ]+ )?PRIVATE KEY)-----[ \t]*$/u;
const JSON_UNICODE_ESCAPE_SEQUENCE_PATTERN = /\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\})/u;
const SOURCE_STRING_LITERAL_PATTERN = /(?:"(?:\\(?:\r\n|\r|\n|["\\/bfnrt]|u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\})|x[0-9a-fA-F]{2}|[0-7]{1,3})|[^"\\\r\n])*"|'(?:\\(?:\r\n|\r|\n|['"\\/bfnrt]|u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\})|x[0-9a-fA-F]{2}|[0-7]{1,3})|[^'\\\r\n])*'|`(?:\\(?:\r\n|\r|\n|[`"'\\/bfnrt]|u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\})|x[0-9a-fA-F]{2}|[0-7]{1,3})|[^`\\$]|\$(?!\{))*`)/gu;
const HOME_DIRECTORY_NAME_GENERIC_BOUNDARY_PATTERN = /["'`<>\])},;:]/u;
const POSIX_HOME_PATH_PATTERN = /\/(?:[Uu][Ss][Ee][Rr][Ss]|home)\/+([^\/\r\n]+)/gu;
const POSIX_HOME_PATH_BOUNDARY_PATTERN = /[\s"'`<>\])},;:]/u;
const PUTTY_ARGON2_DERIVATION_FIELDS = [
    "Key-Derivation",
    "Argon2-Memory",
    "Argon2-Passes",
    "Argon2-Parallelism",
    "Argon2-Salt",
];
const PUTTY_KEY_DERIVATION_LINE_PATTERN = /^Key-Derivation: Argon2(?:d|i|id)$/u;
const PUTTY_KEY_DERIVATION_PARAMETER_LINE_PATTERN = /^(?:Argon2-(?:Memory|Passes|Parallelism): [1-9][0-9]{0,9}|Argon2-Salt: [0-9a-f]+)$/iu;
const PUTTY_PRIVATE_KEY_LINE_COUNT_PATTERN = /^Private-Lines: ([1-9][0-9]{0,5})$/u;
const PUTTY_COMMENT_LINE_PATTERN = /^Comment: [^\r\n]*$/u;
const PUTTY_PRIVATE_KEY_PAYLOAD_LINE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;
const PUTTY_PUBLIC_KEY_LINE_COUNT_PATTERN = /^Public-Lines: ([1-9][0-9]{0,5})$/u;
const ROOT_HOME_NAME = "ro" + "ot";
const POSIX_HOME_NAME = "ho" + "me";
const USERS_HOME_NAME = "Us" + "ers";
const POSIX_HOME_PREFIX = ["", POSIX_HOME_NAME, ""].join("/");
const VAR_ROOT_PREFIX = ["/var", ROOT_HOME_NAME].join("/");
const ROOT_HOME_PATH_PATTERN = new RegExp(`/(?:private/var/${ROOT_HOME_NAME}|var/${ROOT_HOME_NAME}|${ROOT_HOME_NAME})`, "gu");
const POSIX_USERS_PREFIX_PATTERN = new RegExp(`/${USERS_HOME_NAME}/`, "iu");
const WINDOWS_USERS_PREFIX_PATTERN = new RegExp(String.raw `\\${USERS_HOME_NAME}\\`, "iu");
const WINDOWS_DRIVE_USERS_PREFIX_PATTERN = new RegExp(`[A-Za-z]:[\\\\/]+${USERS_HOME_NAME}[\\\\/]+`, "iu");
const SPARSE_UTF16_MIN_ALIGNED_NULL_BYTES = 8;
const SPARSE_UTF32_MIN_ALIGNED_NULL_CODE_POINTS = 8;
const STREAMING_PRIVATE_KEY_PENDING_LINE_MAX_CHARACTERS = 4096;
const TEXT_FILE_LINE_SEGMENT_MAX_CHARACTERS = 64 * 1024;
const WINDOWS_HOME_PATH_PATTERN = /(?:[A-Za-z]:)?[\\/]+Users[\\/]+([^\\/:\r\n"<>|?*]+)/giu;
const STRICT_UTF8_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const WINDOWS_1252_TEXT_DECODER = new TextDecoder("windows-1252");
const AUTHORIZATION_BEARER_PREFIX_PATTERN = /Authorization:\s*Bearer/iu;
const ACCESS_TOKEN_PATTERNS = [
    /Authorization:\s*Bearer\s+[A-Za-z0-9._~-]{16,}/iu,
    /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])/u,
    /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9])/u,
    /(?<![A-Za-z0-9])gh[pous]_[A-Za-z0-9]{36}(?![A-Za-z0-9])/u,
    /(?<![A-Za-z0-9])ghr_[A-Za-z0-9]{76}(?![A-Za-z0-9])/u,
    /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}(?![A-Za-z0-9])/u,
    /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/u,
    /(?<![A-Za-z0-9])pypi-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9])/u,
    /(?<![A-Za-z0-9])sk-(?:proj-)?[A-Za-z0-9_-]{20,}(?![A-Za-z0-9])/u,
    /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{20,}(?![A-Za-z0-9])/u,
];
const PEM_METADATA_LINE_PATTERN = /^(?:Proc-Type|DEK-Info):[^\r\n\\]*$/u;
const PEM_PAYLOAD_LINE_PATTERN = /^[A-Za-z0-9+/= \t]+$/u;
const PUBLIC_SAFETY_AUDIT_RULES = [
    {
        id: "access-token",
        matches: (source) => containsAccessToken(source),
    },
    {
        id: "machine-home-path",
        matches: (source) => containsNonGenericMachineHomePath(source),
    },
    {
        id: "private-key",
        matches: (source) => containsPrivateKeyBlock(source),
    },
];
// -------------------------------------------------------------------------- //
//                                   EXPORTS                                  //
// -------------------------------------------------------------------------- //
export function auditPublicSafety(options) {
    const repoRoot = path.resolve(options.repoRoot);
    const trackedTreeResult = auditTrackedTree(repoRoot);
    const additionalSourceFindings = auditAdditionalSources(options.additionalSources ?? []);
    const historyResult = options.includeHistory === true
        ? auditHistory(repoRoot)
        : { commitCount: 0, findings: [] };
    const allFindings = uniqueSortedFindings([
        ...additionalSourceFindings,
        ...historyResult.findings,
        ...trackedTreeResult.findings,
    ]);
    const findings = allFindings.slice(0, MAX_REPORTED_FINDINGS);
    return {
        findingCount: allFindings.length,
        findings,
        historyScanned: options.includeHistory === true,
        omittedFindingCount: Math.max(allFindings.length - findings.length, 0),
        passed: allFindings.length === 0,
        scannedHistoryCommitCount: historyResult.commitCount,
        scannedTrackedFileCount: trackedTreeResult.fileCount,
    };
}
// -------------------------------------------------------------------------- //
//                                  HELPERS                                   //
// -------------------------------------------------------------------------- //
function auditHistory(repoRoot) {
    assertNoGitGrafts(repoRoot);
    assertNoGitShallowBoundary(repoRoot);
    const messageResult = auditCommitMessageLog(repoRoot, [
        "log",
        "--all",
        "--no-color",
        "--no-decorate",
        "--no-show-signature",
        "--format=%H%x00Author: %an <%ae>%nCommitter: %cn <%ce>%n%B%x00",
    ]);
    const rawCommitFindings = auditRawCommitObjects(repoRoot);
    const tagMessageFindings = auditAnnotatedTagMessages(repoRoot);
    const historicalRefNameFindings = auditHistoricalRefNames(repoRoot);
    const patchFindings = auditPatch(repoRoot, [
        "log",
        "--all",
        "--root",
        "--no-color",
        "--no-decorate",
        "--no-show-signature",
        "--no-abbrev",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--format=%H",
        "--patch",
        "--text",
        "-m",
    ]);
    const historicalBlobFindings = auditHistoricalBlobSnapshots(repoRoot);
    return {
        commitCount: messageResult.commitCount,
        findings: [
            ...messageResult.findings,
            ...rawCommitFindings,
            ...tagMessageFindings,
            ...historicalRefNameFindings,
            ...patchFindings,
            ...historicalBlobFindings,
        ],
    };
}
function auditAdditionalSources(sources) {
    return sources.flatMap((source) => findingsForSource({
        path: redactSensitivePath(source.path),
        scope: "external-input",
        source: "workflow-input",
        text: source.text,
    }));
}
function assertNoGitGrafts(repoRoot) {
    const gitCommonDirectory = runGit(repoRoot, ["rev-parse", "--git-common-dir"]).trim();
    const graftsPath = path.resolve(repoRoot, gitCommonDirectory, "info", "grafts");
    if (existsSync(graftsPath)) {
        throw new Error("Public safety audit cannot safely scan history while .git/info/grafts is present.");
    }
}
function assertNoGitShallowBoundary(repoRoot) {
    const gitCommonDirectory = runGit(repoRoot, ["rev-parse", "--git-common-dir"]).trim();
    const shallowPath = path.resolve(repoRoot, gitCommonDirectory, "shallow");
    if (existsSync(shallowPath)) {
        throw new Error("Public safety audit cannot safely scan history while .git/shallow is present.");
    }
}
function auditRawCommitObjects(repoRoot) {
    const findings = [];
    scanRawCommitObjects(repoRoot, ({ commit, rawCommitObject, rawCommitObjectPath }) => {
        if (rawCommitObject === undefined) {
            if (rawCommitObjectPath !== undefined) {
                findings.push(...findingsForRuleIds({
                    commit,
                    ruleIds: findRuleIdsForLargeAuditTextFile(rawCommitObjectPath),
                    scope: "history",
                    source: "commit-message",
                }));
            }
            return;
        }
        const rawHeaders = extractNonMergetagCommitHeaderBytes(rawCommitObject);
        if (rawHeaders.length > 0) {
            findings.push(...findingsForRuleIds({
                commit,
                ruleIds: findRuleIdsForAuditTextBuffer(rawHeaders),
                scope: "history",
                source: "commit-message",
            }));
        }
        const rawMessageBody = extractRawCommitMessageBodyBytes(rawCommitObject);
        if (shouldAuditRawCommitMessageBodyBytes(rawMessageBody)) {
            findings.push(...findingsForRuleIds({
                commit,
                ruleIds: findRuleIdsForAuditTextBuffer(rawMessageBody),
                scope: "history",
                source: "commit-message",
            }));
        }
        extractMergetagHeaders(rawCommitObject).forEach((mergetagHeader) => {
            findings.push(...findingsForRuleIds({
                commit,
                ruleIds: findRuleIdsForAuditTextBuffer(mergetagHeader.headers),
                scope: "history",
                source: "tag-message",
            }));
            findings.push(...findingsForRuleIds({
                commit,
                ruleIds: findRuleIdsForAuditTextBuffer(mergetagHeader.messageBody),
                scope: "history",
                source: "tag-message",
            }));
        });
    });
    return findings;
}
function scanRawCommitObjects(repoRoot, onRawCommitObject) {
    const commits = [];
    scanGitOutputLines(repoRoot, ["rev-list", "--all"], (commit) => {
        if (HISTORY_SHA_PATTERN.test(commit)) {
            commits.push(commit);
        }
    });
    if (commits.length === 0) {
        return;
    }
    scanGitOutputFromInput(repoRoot, ["cat-file", "--batch"], `${commits.join("\n")}\n`, (outputPath) => {
        scanRawCommitObjectBatchFile(outputPath, onRawCommitObject);
    });
}
function scanRawCommitObjectBatchFile(outputPath, onRawCommitObject) {
    const reader = createBufferedFileReader(outputPath);
    try {
        while (true) {
            const headerBuffer = readBufferedLine(reader);
            if (headerBuffer === undefined) {
                return;
            }
            const header = headerBuffer.toString("utf8");
            const headerMatch = /^([0-9a-f]{40}|[0-9a-f]{64}) ([a-z]+) ([0-9]+)$/iu.exec(header);
            if (headerMatch?.[1] === undefined || headerMatch[2] === undefined || headerMatch[3] === undefined) {
                throw new Error("Public safety audit could not read the local Git history.");
            }
            const objectSize = Number.parseInt(headerMatch[3], 10);
            if (Number.isSafeInteger(objectSize) === false || objectSize < 0) {
                throw new Error("Public safety audit could not read the local Git history.");
            }
            if (headerMatch[2] === "commit") {
                if (objectSize <= GIT_BLOB_FULL_DECODE_MAX_BYTES) {
                    onRawCommitObject({
                        commit: headerMatch[1],
                        rawCommitObject: readBufferedBytes(reader, objectSize),
                    });
                }
                else {
                    const rawCommitObjectPath = path.join(path.dirname(outputPath), `commit-${headerMatch[1]}`);
                    const rawCommitObjectFd = openSync(rawCommitObjectPath, "w");
                    try {
                        readBufferedBytesToFile(reader, objectSize, rawCommitObjectFd);
                    }
                    finally {
                        closeSync(rawCommitObjectFd);
                    }
                    onRawCommitObject({
                        commit: headerMatch[1],
                        rawCommitObjectPath,
                    });
                }
            }
            else {
                skipBufferedBytes(reader, objectSize);
            }
            const separator = readBufferedByte(reader);
            if (separator !== 0x0a) {
                throw new Error("Public safety audit could not read the local Git history.");
            }
        }
    }
    finally {
        closeSync(reader.fileDescriptor);
    }
}
function extractNonMergetagCommitHeaderBytes(source) {
    const lines = splitBufferLines(source);
    const headers = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.length === 0) {
            break;
        }
        if (line.subarray(0, "mergetag ".length).toString("ascii") === "mergetag ") {
            index += 1;
            while (index < lines.length && lines[index][0] === 0x20) {
                index += 1;
            }
            index -= 1;
            continue;
        }
        headers.push(line);
        index += 1;
        while (index < lines.length && lines[index][0] === 0x20) {
            headers.push(lines[index]);
            index += 1;
        }
        index -= 1;
    }
    return joinBufferLines(headers);
}
function extractRawCommitMessageBodyBytes(source) {
    const headerEnd = source.indexOf("\n\n");
    return headerEnd < 0 ? Buffer.alloc(0) : source.subarray(headerEnd + 2);
}
function shouldAuditRawCommitMessageBodyBytes(source) {
    return source.length > 0
        && (source.includes(0) || hasByteOrderMark(source) || looksLikeUtf16Le(source) || looksLikeUtf16Be(source));
}
function extractMergetagHeaders(source) {
    const lines = splitBufferLines(source);
    const mergetags = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.length === 0) {
            break;
        }
        if (line.subarray(0, "mergetag ".length).toString("ascii") !== "mergetag ") {
            continue;
        }
        const tagObjectLines = [line.subarray("mergetag ".length)];
        index += 1;
        while (index < lines.length && lines[index][0] === 0x20) {
            tagObjectLines.push(lines[index].subarray(1));
            index += 1;
        }
        index -= 1;
        mergetags.push(splitRawAnnotatedTagObject(joinBufferLines(tagObjectLines)));
    }
    return mergetags;
}
function splitRawAnnotatedTagObject(source) {
    const lines = splitBufferLines(source);
    const headerLines = [];
    let messageStartIndex = lines.length;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.length === 0) {
            messageStartIndex = index + 1;
            break;
        }
        headerLines.push(line);
    }
    return {
        headers: joinBufferLines(headerLines),
        messageBody: joinBufferLines(lines.slice(messageStartIndex)),
    };
}
function splitBufferLines(source) {
    const lines = [];
    let offset = 0;
    while (offset <= source.length) {
        const lineEnd = source.indexOf(0x0a, offset);
        if (lineEnd < 0) {
            lines.push(source.subarray(offset));
            break;
        }
        lines.push(source.subarray(offset, lineEnd));
        offset = lineEnd + 1;
    }
    return lines;
}
function joinBufferLines(lines) {
    if (lines.length === 0) {
        return Buffer.alloc(0);
    }
    const separator = Buffer.from("\n");
    return Buffer.concat(lines.flatMap((line, index) => index === 0 ? [line] : [separator, line]));
}
function auditAnnotatedTagMessages(repoRoot) {
    const findings = [];
    scanGitOutputLines(repoRoot, [
        "for-each-ref",
        "--format=%(objecttype)%00%(objectname)%00%(refname)",
        "refs",
    ], (line) => {
        const [objectType, objectId, refName] = line.split("\0");
        if (objectType !== "tag" || objectId === undefined || HISTORY_SHA_PATTERN.test(objectId) === false) {
            return;
        }
        findings.push(...auditReachableAnnotatedTagMessages(repoRoot, {
            objectId,
            refName,
        }));
    });
    return findings;
}
function auditReachableAnnotatedTagMessages(repoRoot, input) {
    const findings = [];
    const pendingTagObjectIds = [input.objectId];
    const redactedPath = input.refName === undefined ? undefined : redactSensitivePath(input.refName);
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "public-safety-audit-tag-"));
    const visitedTagObjectIds = new Set();
    try {
        while (pendingTagObjectIds.length > 0) {
            const objectId = pendingTagObjectIds.pop();
            if (objectId === undefined || visitedTagObjectIds.has(objectId)) {
                continue;
            }
            visitedTagObjectIds.add(objectId);
            const tagObjectPath = path.join(temporaryDirectory, `tag-${objectId}`);
            const tagHeaderPath = path.join(temporaryDirectory, `tag-header-${objectId}`);
            const tagMessagePath = path.join(temporaryDirectory, `tag-message-${objectId}`);
            writeGitCatFileTagToFile(repoRoot, objectId, tagObjectPath);
            const tagObject = splitAnnotatedTagObject(tagObjectPath, tagHeaderPath, tagMessagePath);
            findings.push(...findingsForRuleIds({
                commit: objectId,
                path: redactedPath,
                ruleIds: findRuleIdsForAuditTextFile(tagHeaderPath),
                scope: "history",
                source: "tag-message",
            }));
            findings.push(...findingsForRuleIds({
                commit: objectId,
                path: redactedPath,
                ruleIds: findRuleIdsForAuditTextFile(tagMessagePath),
                scope: "history",
                source: "tag-message",
            }));
            const target = parseAnnotatedTagTarget(tagObject.headersText);
            if (target?.type === "tag") {
                pendingTagObjectIds.push(target.objectId);
            }
        }
    }
    finally {
        rmSync(temporaryDirectory, { force: true, recursive: true });
    }
    return findings;
}
function splitAnnotatedTagObject(tagObjectPath, tagHeaderPath, tagMessagePath) {
    const reader = createBufferedFileReader(tagObjectPath);
    let headerFd;
    let messageFd;
    const headerLines = [];
    let currentHeaderLine = "";
    let currentHeaderLineOverflowed = false;
    let startsLine = true;
    try {
        headerFd = openSync(tagHeaderPath, "w");
        while (true) {
            const segment = readBufferedLineSegment(reader, TEXT_FILE_LINE_SEGMENT_MAX_CHARACTERS);
            if (segment === undefined) {
                if (startsLine === false && currentHeaderLineOverflowed === false) {
                    headerLines.push(currentHeaderLine);
                }
                break;
            }
            if (startsLine && segment.endsLine && segment.buffer.length === 0) {
                break;
            }
            writeSync(headerFd, segment.buffer);
            if (segment.endsLine) {
                writeSync(headerFd, "\n");
            }
            if (currentHeaderLineOverflowed === false) {
                const nextHeaderLine = `${currentHeaderLine}${decodeGitPathOutput(segment.buffer)}`;
                if (nextHeaderLine.length <= TEXT_FILE_LINE_SEGMENT_MAX_CHARACTERS) {
                    currentHeaderLine = nextHeaderLine;
                }
                else {
                    currentHeaderLineOverflowed = true;
                }
            }
            if (segment.endsLine) {
                if (currentHeaderLineOverflowed === false) {
                    headerLines.push(currentHeaderLine);
                }
                currentHeaderLine = "";
                currentHeaderLineOverflowed = false;
                startsLine = true;
            }
            else {
                startsLine = false;
            }
        }
        closeSync(headerFd);
        headerFd = undefined;
        messageFd = openSync(tagMessagePath, "w");
        writeBufferedRemainderToFile(reader, messageFd);
        closeSync(messageFd);
        messageFd = undefined;
    }
    finally {
        if (headerFd !== undefined) {
            closeSync(headerFd);
        }
        if (messageFd !== undefined) {
            closeSync(messageFd);
        }
        closeSync(reader.fileDescriptor);
    }
    return {
        headersText: headerLines.join("\n"),
    };
}
function readAnnotatedTagHeaderText(tagObjectPath) {
    const reader = createBufferedFileReader(tagObjectPath);
    const headerLines = [];
    let currentHeaderLine = "";
    let currentHeaderLineOverflowed = false;
    let startsLine = true;
    try {
        while (true) {
            const segment = readBufferedLineSegment(reader, TEXT_FILE_LINE_SEGMENT_MAX_CHARACTERS);
            if (segment === undefined) {
                if (startsLine === false && currentHeaderLineOverflowed === false) {
                    headerLines.push(currentHeaderLine);
                }
                break;
            }
            if (startsLine && segment.endsLine && segment.buffer.length === 0) {
                break;
            }
            if (currentHeaderLineOverflowed === false) {
                const nextHeaderLine = `${currentHeaderLine}${decodeGitPathOutput(segment.buffer)}`;
                if (nextHeaderLine.length <= TEXT_FILE_LINE_SEGMENT_MAX_CHARACTERS) {
                    currentHeaderLine = nextHeaderLine;
                }
                else {
                    currentHeaderLineOverflowed = true;
                }
            }
            if (segment.endsLine) {
                if (currentHeaderLineOverflowed === false) {
                    headerLines.push(currentHeaderLine);
                }
                currentHeaderLine = "";
                currentHeaderLineOverflowed = false;
                startsLine = true;
            }
            else {
                startsLine = false;
            }
        }
    }
    finally {
        closeSync(reader.fileDescriptor);
    }
    return headerLines.join("\n");
}
function auditHistoricalRefNames(repoRoot) {
    const findings = [];
    scanGitOutputLines(repoRoot, [
        "for-each-ref",
        "--format=%(objectname)%00%(refname)",
        "refs",
    ], (line) => {
        const [objectId, refName] = line.split("\0");
        if (objectId === undefined
            || refName === undefined
            || refName.length === 0
            || HISTORY_SHA_PATTERN.test(objectId) === false) {
            return;
        }
        findings.push(...findingsForSource({
            commit: objectId,
            path: redactSensitivePath(refName),
            scope: "history",
            source: "patch",
            text: refName,
        }));
    });
    return findings;
}
function auditCommitMessageLog(repoRoot, gitArgs) {
    const findings = [];
    const commits = new Set();
    let commit;
    let commitRecord = "";
    let messageWindow = "";
    const reportedFindingKeys = new Set();
    const scanMessageSegment = (source) => {
        if (commit === undefined) {
            return;
        }
        commits.add(commit);
        if (source.length > LARGE_BLOB_SCAN_OVERLAP_CHARACTERS) {
            scanCommitMessageWindow(commit, source, findings, reportedFindingKeys);
        }
        messageWindow = boundedAuditTextWindow(messageWindow, source);
        scanCommitMessageWindow(commit, messageWindow, findings, reportedFindingKeys);
    };
    scanGitOutputRecordSegments(repoRoot, gitArgs, (segment) => {
        if (segment.index % 2 === 0) {
            commitRecord = boundedAuditTextWindow(commitRecord, segment.text);
            if (segment.endsRecord) {
                const candidate = commitRecord.trim();
                commit = HISTORY_SHA_PATTERN.test(candidate) ? candidate : undefined;
                commitRecord = "";
            }
            return;
        }
        scanMessageSegment(segment.text);
        if (segment.endsRecord) {
            commit = undefined;
            messageWindow = "";
        }
    });
    return {
        commitCount: commits.size,
        findings,
    };
}
function scanCommitMessageWindow(commit, source, findings, reportedFindingKeys) {
    const prefilterSources = source.includes("\\")
        ? [source, decodeJsonEscapedTextFragment(source)]
        : [source];
    PUBLIC_SAFETY_AUDIT_RULES.forEach((rule) => {
        if (prefilterSources.some((prefilterSource) => couldMatchRuleInText(rule.id, prefilterSource)) === false
            || rule.matches(source) === false) {
            return;
        }
        const finding = {
            commit,
            ruleId: rule.id,
            scope: "history",
            source: "commit-message",
        };
        const findingKey = `${finding.commit ?? ""}\0${finding.ruleId}\0${finding.scope}\0${finding.source}`;
        if (reportedFindingKeys.has(findingKey)) {
            return;
        }
        reportedFindingKeys.add(findingKey);
        findings.push(finding);
    });
}
function auditPatch(repoRoot, gitArgs) {
    let commit;
    let additionWindow = "";
    let inHunk = false;
    const findings = [];
    const reportedFindingKeys = new Set();
    const flushAdditions = () => {
        additionWindow = "";
    };
    const scanPatchWindow = (source) => {
        if (commit === undefined) {
            return;
        }
        findingsForSource({
            commit,
            scope: "history",
            source: "patch",
            text: source,
            ruleIds: ["access-token", "machine-home-path"],
        }).forEach((finding) => {
            const findingKey = `${finding.commit ?? ""}\0${finding.ruleId}\0${finding.scope}\0${finding.source}`;
            if (reportedFindingKeys.has(findingKey)) {
                return;
            }
            reportedFindingKeys.add(findingKey);
            findings.push(finding);
        });
    };
    const scanAddition = (source, input) => {
        if (source.length > LARGE_BLOB_SCAN_OVERLAP_CHARACTERS) {
            scanPatchWindow(source);
        }
        const separator = input.startsNewAddition && additionWindow.length > 0 ? "\n" : "";
        additionWindow = boundedAuditTextWindow(additionWindow, `${separator}${source}`);
        scanPatchWindow(additionWindow);
    };
    let inAdditionContinuation = false;
    scanGitOutputLineSegments(repoRoot, gitArgs, (segment) => {
        if (segment.startsLine && HISTORY_SHA_PATTERN.test(segment.text)) {
            flushAdditions();
            commit = segment.text;
            inHunk = false;
            inAdditionContinuation = false;
            return;
        }
        if (segment.startsLine && segment.text.startsWith("diff --git ")) {
            flushAdditions();
            inHunk = false;
            inAdditionContinuation = false;
            return;
        }
        if (segment.startsLine && segment.text.startsWith("@@ ")) {
            flushAdditions();
            inHunk = true;
            inAdditionContinuation = false;
            return;
        }
        if (inHunk && segment.startsLine && segment.text.startsWith("+")) {
            scanAddition(normalizePatchAdditionText(segment.text.slice(1)), {
                startsNewAddition: true,
            });
            inAdditionContinuation = segment.endsLine === false;
            return;
        }
        if (inHunk && inAdditionContinuation && segment.startsLine === false) {
            scanAddition(normalizePatchAdditionText(segment.text), {
                startsNewAddition: false,
            });
            inAdditionContinuation = segment.endsLine === false;
            return;
        }
        if (segment.endsLine) {
            inAdditionContinuation = false;
        }
    });
    flushAdditions();
    return findings;
}
function auditHistoricalBlobSnapshots(repoRoot) {
    const historicalBlobEntries = getHistoricalBlobEntries(repoRoot);
    const findings = [];
    const blobRuleIdsByObjectId = findRuleIdsForGitBlobs(repoRoot, [...new Set(historicalBlobEntries
            .filter((entry) => entry.mode !== "160000")
            .map((entry) => entry.objectId))]);
    historicalBlobEntries.forEach((entry) => {
        const redactedPath = redactSensitivePath(entry.path);
        const pathRuleIds = uniqueRuleIds([
            ...entry.pathRuleIds,
            ...findingsForSource({
                commit: entry.commit,
                path: redactedPath,
                scope: "history",
                source: "patch",
                text: entry.path,
            }).map((finding) => finding.ruleId),
        ]);
        pathRuleIds.forEach((ruleId) => {
            findings.push({
                commit: entry.commit,
                path: redactedPath,
                ruleId,
                scope: "history",
                source: "patch",
            });
        });
        if (entry.mode === "160000") {
            return;
        }
        blobRuleIdsByObjectId.get(entry.objectId)?.forEach((ruleId) => {
            findings.push({
                commit: entry.commit,
                path: redactSensitivePath(entry.path),
                ruleId,
                scope: "history",
                source: "patch",
            });
        });
    });
    return findings;
}
function auditTrackedTree(repoRoot) {
    const trackedEntries = getTrackedEntries(repoRoot);
    const trackedBlobEntries = trackedEntries.filter((entry) => entry.type === "blob" && entry.mode !== "160000");
    const blobRuleIdsByObjectId = findRuleIdsForGitBlobs(repoRoot, [...new Set(trackedBlobEntries.map((entry) => entry.objectId))]);
    const findings = [];
    let fileCount = 0;
    trackedEntries.forEach((entry) => {
        const redactedPath = redactSensitivePath(entry.path);
        findings.push(...findingsForSource({
            path: redactedPath,
            scope: "tracked-tree",
            source: "tracked-file",
            text: entry.path,
        }));
        if (entry.type !== "blob" || entry.mode === "160000") {
            return;
        }
        fileCount += 1;
        blobRuleIdsByObjectId.get(entry.objectId)?.forEach((ruleId) => {
            findings.push({
                path: redactedPath,
                ruleId,
                scope: "tracked-tree",
                source: "tracked-file",
            });
        });
    });
    return {
        fileCount,
        findings,
    };
}
function decodeAuditText(source) {
    if (source.length >= 4 && source[0] === 0xff && source[1] === 0xfe && source[2] === 0 && source[3] === 0) {
        return decodeUtf32Text(source.subarray(4), "le");
    }
    if (source.length >= 4 && source[0] === 0 && source[1] === 0 && source[2] === 0xfe && source[3] === 0xff) {
        return decodeUtf32Text(source.subarray(4), "be");
    }
    if (source.length >= 2 && source[0] === 0xff && source[1] === 0xfe) {
        return stripTextByteOrderMark(source.subarray(2).toString("utf16le"));
    }
    if (source.length >= 2 && source[0] === 0xfe && source[1] === 0xff) {
        return stripTextByteOrderMark(swapUtf16ByteOrder(source.subarray(2)).toString("utf16le"));
    }
    if (looksLikeUtf16Le(source)) {
        return stripTextByteOrderMark(source.toString("utf16le"));
    }
    if (looksLikeUtf16Be(source)) {
        return stripTextByteOrderMark(swapUtf16ByteOrder(source).toString("utf16le"));
    }
    return decodeSingleByteSafeText(source);
}
function scanDecodedAuditTextVariants(source, scanDecodedText) {
    const scanText = (decodedText) => decodedText !== undefined && scanDecodedText(decodedText);
    if (scanText(decodeAuditText(source))) {
        return true;
    }
    if (scanText(decodeOppositeUtf16ByteOrderBomText(source))) {
        return true;
    }
    if (scanText(decodeOppositeUtf32ByteOrderBomText(source))) {
        return true;
    }
    if (hasByteOrderMark(source) || looksLikeUtf16Le(source) || looksLikeUtf16Be(source)) {
        if (scanText(decodeSingleByteSafeText(source))) {
            return true;
        }
    }
    const shouldScanUtf16Alignments = hasUtf16ByteOrderMark(source)
        || looksLikeUtf16Le(source)
        || looksLikeUtf16Be(source);
    if (shouldScanUtf16Alignments) {
        for (const byteOrder of ["le", "be"]) {
            for (const alignmentOffset of [0, 1]) {
                if (scanText(decodeUtf16TextAtAlignment(source, byteOrder, alignmentOffset))) {
                    return true;
                }
            }
        }
    }
    const shouldScanUtf32Alignments = hasUtf32ByteOrderMark(source)
        || looksLikeUtf32Le(source)
        || looksLikeUtf32Be(source);
    if (shouldScanUtf32Alignments) {
        const baseByteOffset = hasUtf32ByteOrderMark(source) ? 4 : 0;
        for (const byteOrder of ["le", "be"]) {
            for (const alignmentOffset of [0, 1, 2, 3]) {
                if (scanText(decodeUtf32TextAtByteOffset(source, byteOrder, baseByteOffset + alignmentOffset))) {
                    return true;
                }
            }
        }
    }
    return false;
}
function decodeUtf16TextAtAlignment(source, byteOrder, alignmentOffset) {
    const alignedSource = source.subarray(alignmentOffset);
    if (alignedSource.length < 2) {
        return undefined;
    }
    const evenLength = alignedSource.length - (alignedSource.length % 2);
    const alignedTextSource = alignedSource.subarray(0, evenLength);
    return byteOrder === "le"
        ? stripTextByteOrderMark(alignedTextSource.toString("utf16le"))
        : stripTextByteOrderMark(swapUtf16ByteOrder(alignedTextSource).toString("utf16le"));
}
function decodeOppositeUtf16ByteOrderBomText(source) {
    if (source.length >= 4 && source[0] === 0xff && source[1] === 0xfe && source[2] === 0 && source[3] === 0) {
        return undefined;
    }
    if (source.length >= 4 && source[0] === 0 && source[1] === 0 && source[2] === 0xfe && source[3] === 0xff) {
        return undefined;
    }
    if (source.length >= 2 && source[0] === 0xff && source[1] === 0xfe) {
        return stripTextByteOrderMark(swapUtf16ByteOrder(source.subarray(2)).toString("utf16le"));
    }
    if (source.length >= 2 && source[0] === 0xfe && source[1] === 0xff) {
        return stripTextByteOrderMark(source.subarray(2).toString("utf16le"));
    }
    return undefined;
}
function decodeOppositeUtf32ByteOrderBomText(source) {
    if (source.length >= 4 && source[0] === 0xff && source[1] === 0xfe && source[2] === 0 && source[3] === 0) {
        return decodeUtf32Text(source.subarray(4), "be");
    }
    if (source.length >= 4 && source[0] === 0 && source[1] === 0 && source[2] === 0xfe && source[3] === 0xff) {
        return decodeUtf32Text(source.subarray(4), "le");
    }
    return undefined;
}
function hasUtf32ByteOrderMark(source) {
    return (source.length >= 4 && source[0] === 0xff && source[1] === 0xfe && source[2] === 0 && source[3] === 0)
        || (source.length >= 4 && source[0] === 0 && source[1] === 0 && source[2] === 0xfe && source[3] === 0xff);
}
function hasByteOrderMark(source) {
    return (source.length >= 4 && source[0] === 0xff && source[1] === 0xfe && source[2] === 0 && source[3] === 0)
        || (source.length >= 4 && source[0] === 0 && source[1] === 0 && source[2] === 0xfe && source[3] === 0xff)
        || (source.length >= 2 && source[0] === 0xff && source[1] === 0xfe)
        || (source.length >= 2 && source[0] === 0xfe && source[1] === 0xff);
}
function hasUtf16ByteOrderMark(source) {
    return (source.length >= 2 && source[0] === 0xff && source[1] === 0xfe)
        || (source.length >= 2 && source[0] === 0xfe && source[1] === 0xff);
}
function getHistoricalBlobEntries(repoRoot) {
    const entries = [];
    let commit;
    let rawMetadata;
    let pathRuleIds = new Set();
    let recordText = "";
    let recordWindow = "";
    let recordWasSegmented = false;
    const resetRecord = () => {
        pathRuleIds = new Set();
        recordText = "";
        recordWindow = "";
        recordWasSegmented = false;
    };
    const scanPathRecordSegment = (segmentText) => {
        if (commit === undefined) {
            return;
        }
        const nextWindow = boundedAuditTextWindow(recordWindow, segmentText);
        const source = segmentText.length > LARGE_BLOB_SCAN_OVERLAP_CHARACTERS
            ? segmentText
            : nextWindow;
        findingsForSource({
            commit,
            scope: "history",
            source: "patch",
            text: source,
        }).forEach((finding) => {
            pathRuleIds.add(finding.ruleId);
        });
        recordWindow = nextWindow;
    };
    scanGitOutputRecordSegments(repoRoot, [
        "log",
        "--all",
        "--root",
        "--no-color",
        "--no-decorate",
        "--no-show-signature",
        "--no-abbrev",
        "--no-ext-diff",
        "--no-renames",
        "--format=%H",
        "--raw",
        "-m",
        "-z",
        "--diff-filter=AMT",
        "--reverse",
    ], (segment) => {
        if (rawMetadata !== undefined) {
            recordWasSegmented ||= segment.endsRecord === false;
            scanPathRecordSegment(segment.text);
            if (recordWasSegmented === false) {
                recordText += segment.text;
            }
            if (segment.endsRecord === false) {
                return;
            }
            const pathRecord = recordWasSegmented ? recordWindow : recordText;
            const entry = commit === undefined
                ? undefined
                : parseHistoricalRawBlobEntry({
                    commit,
                    metadata: rawMetadata,
                    path: pathRecord,
                    pathRuleIds: [...pathRuleIds],
                });
            if (entry !== undefined) {
                entries.push(entry);
            }
            rawMetadata = undefined;
            resetRecord();
            return;
        }
        recordText += segment.text;
        if (segment.endsRecord === false) {
            return;
        }
        const record = recordText;
        resetRecord();
        if (HISTORY_SHA_PATTERN.test(record)) {
            commit = record;
            return;
        }
        const trimmedRecord = record.trimStart();
        if (trimmedRecord.startsWith(":")) {
            rawMetadata = trimmedRecord;
        }
    });
    return uniqueHistoricalBlobEntries([
        ...entries,
        ...getHistoricalRefBlobEntries(repoRoot),
    ]);
}
function getHistoricalRefBlobEntries(repoRoot) {
    const entries = [];
    scanGitOutputLines(repoRoot, [
        "for-each-ref",
        "--format=%(objecttype)%00%(objectname)%00%(*objecttype)%00%(*objectname)%00%(refname)",
        "refs",
    ], (line) => {
        const [objectType, objectId, peeledObjectType, peeledObjectId, refName] = line.split("\0");
        if (objectId === undefined || refName === undefined || HISTORY_SHA_PATTERN.test(objectId) === false) {
            return;
        }
        const rawTargetObjectType = peeledObjectType === undefined || peeledObjectType.length === 0
            ? objectType
            : peeledObjectType;
        const rawTargetObjectId = peeledObjectId === undefined || peeledObjectId.length === 0
            ? objectId
            : peeledObjectId;
        if (rawTargetObjectId === undefined
            || rawTargetObjectType === undefined
            || HISTORY_SHA_PATTERN.test(rawTargetObjectId) === false) {
            return;
        }
        const target = peelGitObjectTarget(repoRoot, {
            objectId: rawTargetObjectId,
            type: rawTargetObjectType,
        });
        if (target === undefined) {
            return;
        }
        if (target.type === "blob") {
            entries.push({
                commit: objectId,
                mode: "100644",
                objectId: target.objectId,
                path: refName,
                pathRuleIds: [],
            });
            return;
        }
        if (target.type === "tree") {
            entries.push(...parseTrackedBlobEntries(decodeGitPathRecordsOutput(runGitBuffer(repoRoot, ["ls-tree", "-r", "-z", "--full-tree", target.objectId])))
                .filter((entry) => entry.type === "blob" || entry.mode === "160000")
                .map((entry) => ({
                commit: objectId,
                mode: entry.mode,
                objectId: entry.objectId,
                path: `${refName}:${entry.path}`,
                pathRuleIds: [],
            })));
        }
    });
    return entries;
}
function parseHistoricalRawBlobEntry(input) {
    const metadataFields = input.metadata.trim().split(" ");
    const mode = metadataFields[1];
    const objectId = metadataFields[3];
    const status = metadataFields[4];
    if (mode === undefined
        || objectId === undefined
        || status === undefined
        || /^[AMT]/u.test(status) === false
        || HISTORY_SHA_PATTERN.test(objectId) === false
        || /^0+$/u.test(objectId)
        || input.path.length === 0) {
        return undefined;
    }
    return {
        commit: input.commit,
        mode,
        objectId,
        path: input.path,
        pathRuleIds: input.pathRuleIds,
    };
}
function getTrackedEntries(repoRoot) {
    return uniqueTrackedEntries([
        ...getTrackedHeadEntries(repoRoot),
        ...parseTrackedBlobEntries(decodeGitPathRecordsOutput(runGitBuffer(repoRoot, ["ls-files", "-s", "-z"]))),
    ]);
}
function getTrackedHeadEntries(repoRoot) {
    if (hasGitHead(repoRoot) === false) {
        return [];
    }
    return parseTrackedBlobEntries(decodeGitPathRecordsOutput(runGitBuffer(repoRoot, ["ls-tree", "-r", "-z", "--full-tree", "HEAD"])));
}
function hasGitHead(repoRoot) {
    try {
        execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
            cwd: repoRoot,
            env: auditGitEnvironment(),
            stdio: "ignore",
        });
        return true;
    }
    catch {
        return false;
    }
}
function containsNonGenericMachineHomePath(source) {
    return containsNonGenericMachineHomePathInPlainText(source)
        || containsJsonDecodedSensitiveValue(source, containsNonGenericMachineHomePathInPlainText);
}
function containsNonGenericMachineHomePathInPlainText(source) {
    const tokenRanges = buildSourceTokenRanges(source);
    if (containsRootMachineHomePath(source, tokenRanges)) {
        return true;
    }
    for (const match of source.matchAll(POSIX_HOME_PATH_PATTERN)) {
        const directoryName = match[1];
        if (directoryName !== undefined
            && isGenericHomeDirectoryMatch(source, match) === false
            && isFilesystemLikePosixHomeMatch(source, match, tokenRanges)) {
            return true;
        }
    }
    for (const match of source.matchAll(WINDOWS_HOME_PATH_PATTERN)) {
        const directoryName = match[1];
        if (directoryName !== undefined
            && isGenericHomeDirectoryMatch(source, match) === false
            && isFilesystemLikeMachineHomeMatch(source, match, tokenRanges)) {
            return true;
        }
    }
    return false;
}
function containsJsonDecodedSensitiveValue(source, matches) {
    if (source.includes("\\") === false && source.includes("\"") === false && source.includes("'") === false) {
        return false;
    }
    if ([...source.matchAll(SOURCE_STRING_LITERAL_PATTERN)].some((match) => {
        const decoded = decodeSourceStringLiteral(match[0]);
        return decoded !== undefined && matches(decoded);
    })) {
        return true;
    }
    if (containsConcatenatedJsonStringLiteralValue(source, matches)) {
        return true;
    }
    if (source.includes("\\") === false) {
        return false;
    }
    return matches(decodeJsonEscapedTextFragment(source));
}
function containsConcatenatedJsonStringLiteralValue(source, matches) {
    let literalCount = 0;
    let previousEnd;
    let runtimeText = "";
    for (const match of source.matchAll(SOURCE_STRING_LITERAL_PATTERN)) {
        const decoded = decodeSourceStringLiteral(match[0]);
        if (decoded === undefined) {
            literalCount = 0;
            previousEnd = undefined;
            runtimeText = "";
            continue;
        }
        const separator = previousEnd === undefined ? undefined : source.slice(previousEnd, match.index);
        if (separator !== undefined && isSourceLiteralConcatenationSeparator(separator)) {
            literalCount += 1;
            runtimeText += decoded;
        }
        else {
            literalCount = 1;
            runtimeText = decoded;
        }
        if (literalCount > 1 && matches(runtimeText)) {
            return true;
        }
        previousEnd = match.index + match[0].length;
    }
    return false;
}
function isSourceLiteralConcatenationSeparator(separator) {
    const separatorWithoutComments = separator.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r\n|\r|\n)/gu, " ");
    return /^\s*(?:\+\s*)?$/u.test(separatorWithoutComments);
}
function containsAccessToken(source) {
    return containsAccessTokenInPlainText(source)
        || containsJsonDecodedSensitiveValue(source, containsAccessTokenInPlainText);
}
function containsAccessTokenInPlainText(source) {
    return ACCESS_TOKEN_PATTERNS.some((pattern) => pattern.test(source)) || containsGitHubAppJwt(source);
}
function containsGitHubAppJwt(source) {
    return [...source.matchAll(GITHUB_APP_JWT_PATTERN)].some((match) => isGitHubAppJwt(match[0]));
}
function containsPrivateKeyBlock(source) {
    return containsPrivateKeyBlockInPlainText(source)
        || containsJsonDecodedSensitiveValue(source, containsPrivateKeyBlockInPlainText);
}
function containsPrivateKeyBlockInPlainText(source) {
    const normalizedSource = stripTextByteOrderMark(source);
    return containsPemPrivateKeyBlock(normalizedSource)
        || containsOpenPgpPrivateKeyBlock(normalizedSource)
        || containsPuttyPrivateKeyBlock(normalizedSource);
}
function containsPemPrivateKeyBlock(source) {
    return collectPemPrivateKeyBlockRanges(source).length > 0;
}
function containsOpenPgpPrivateKeyBlock(source) {
    return collectOpenPgpPrivateKeyBlockRanges(source).length > 0;
}
function containsPuttyPrivateKeyBlock(source) {
    return collectPuttyPrivateKeyBlockRanges(source).length > 0;
}
function createStreamingPrivateKeyDetector() {
    let pendingLine = "";
    let pemBlock;
    let openPgpBlock;
    let puttyBlock;
    const processLine = (line) => {
        const pemFound = processStreamingPemPrivateKeyLine(line, {
            get: () => pemBlock,
            set: (nextBlock) => {
                pemBlock = nextBlock;
            },
        });
        const openPgpFound = processStreamingOpenPgpPrivateKeyLine(line, {
            get: () => openPgpBlock,
            set: (nextBlock) => {
                openPgpBlock = nextBlock;
            },
        });
        const puttyFound = processStreamingPuttyPrivateKeyLine(line, {
            get: () => puttyBlock,
            set: (nextBlock) => {
                puttyBlock = nextBlock;
            },
        });
        return pemFound || openPgpFound || puttyFound;
    };
    return {
        end: () => {
            const found = pendingLine.length > 0 && processLine(pendingLine);
            pendingLine = "";
            return found;
        },
        write: (source) => {
            if (source.length === 0) {
                return false;
            }
            const combinedSource = `${pendingLine}${source}`;
            let found = false;
            let start = 0;
            for (const match of combinedSource.matchAll(PEM_LINE_BREAK_SCAN_PATTERN)) {
                found ||= processLine(combinedSource.slice(start, match.index));
                start = match.index + match[0].length;
            }
            pendingLine = combinedSource.slice(start);
            while (pendingLine.length > STREAMING_PRIVATE_KEY_PENDING_LINE_MAX_CHARACTERS
                && (pemBlock !== undefined || openPgpBlock !== undefined || puttyBlock !== undefined)) {
                found ||= processLine(pendingLine.slice(0, STREAMING_PRIVATE_KEY_PENDING_LINE_MAX_CHARACTERS));
                pendingLine = pendingLine.slice(STREAMING_PRIVATE_KEY_PENDING_LINE_MAX_CHARACTERS);
            }
            pendingLine = boundStreamingPrivateKeyPendingLine(pendingLine);
            return found;
        },
    };
}
function boundStreamingPrivateKeyPendingLine(source) {
    if (source.length <= STREAMING_PRIVATE_KEY_PENDING_LINE_MAX_CHARACTERS) {
        return source;
    }
    return source.slice(source.length - STREAMING_PRIVATE_KEY_PENDING_LINE_MAX_CHARACTERS);
}
function processStreamingPemPrivateKeyLine(line, block) {
    const beginLine = parsePemPrivateKeyBeginLine(line);
    const activeBlock = block.get();
    if (activeBlock !== undefined) {
        const endMarker = `-----END ${activeBlock.label}-----`;
        if (isPemPrivateKeyEndLine(line, endMarker, activeBlock.sourceLiteralDelimiter)) {
            block.set(undefined);
            return activeBlock.invalidPayload === false
                && activeBlock.payloadCharacterCount >= 32
                && activeBlock.paddingCharacterCount <= 2
                && hasValidBase64QuantumLength(activeBlock.payloadCharacterCount, activeBlock.paddingCharacterCount);
        }
        if (beginLine !== undefined) {
            block.set(createStreamingPemPrivateKeyBlock(beginLine));
            return false;
        }
        updateStreamingPemPayload(activeBlock, line);
        return false;
    }
    if (beginLine !== undefined) {
        block.set(createStreamingPemPrivateKeyBlock(beginLine));
    }
    return false;
}
function processStreamingOpenPgpPrivateKeyLine(line, block) {
    const beginLine = parseOpenPgpPrivateKeyBeginLine(line);
    const activeBlock = block.get();
    if (activeBlock !== undefined) {
        if (isArmorMarkerEndLine(line, OPENPGP_PRIVATE_KEY_END_LINE, activeBlock.sourceLiteralDelimiter)) {
            block.set(undefined);
            return activeBlock.invalidPayload === false
                && activeBlock.sawSeparator
                && activeBlock.payloadCharacterCount - activeBlock.paddingCharacterCount >= 32
                && activeBlock.paddingCharacterCount <= 2
                && hasValidBase64QuantumLength(activeBlock.payloadCharacterCount, activeBlock.paddingCharacterCount)
                && hasValidStreamingOpenPgpArmorChecksum(activeBlock);
        }
        if (beginLine !== undefined) {
            block.set(createStreamingOpenPgpPrivateKeyBlock(beginLine));
            return false;
        }
        updateStreamingOpenPgpPayload(activeBlock, line);
        return false;
    }
    if (beginLine !== undefined) {
        block.set(createStreamingOpenPgpPrivateKeyBlock(beginLine));
    }
    return false;
}
function processStreamingPuttyPrivateKeyLine(line, block) {
    const trimmedLine = line.trim();
    const beginLine = parsePuttyPrivateKeyBeginLine(line);
    const activeBlock = block.get();
    if (beginLine !== undefined) {
        block.set(createStreamingPuttyPrivateKeyBlock(beginLine));
        return false;
    }
    if (activeBlock === undefined) {
        return false;
    }
    if (trimmedLine.length === 0) {
        block.set(undefined);
        return false;
    }
    if (activeBlock.waitingForMac) {
        const found = activeBlock.invalidPayload === false
            && activeBlock.privateLineCount !== undefined
            && activeBlock.privateLinesRead === activeBlock.privateLineCount
            && activeBlock.privatePayloadCharacterCount >= 32
            && activeBlock.paddingCharacterCount <= 2
            && hasValidBase64QuantumLength(activeBlock.privatePayloadCharacterCount + activeBlock.paddingCharacterCount, activeBlock.paddingCharacterCount)
            && parsePuttyPrivateKeyMacLine(line, activeBlock.sourceLiteralDelimiter, activeBlock.version) !== undefined;
        block.set(undefined);
        return found;
    }
    if (activeBlock.privateLineCount !== undefined) {
        updateStreamingPuttyPayload(activeBlock, trimmedLine);
        activeBlock.privateLinesRead += 1;
        if (activeBlock.privateLinesRead === activeBlock.privateLineCount) {
            activeBlock.waitingForMac = true;
        }
        return false;
    }
    if (activeBlock.publicLineCount !== undefined && activeBlock.publicLinesRead < activeBlock.publicLineCount) {
        updateStreamingPuttyPublicPayload(activeBlock, trimmedLine);
        activeBlock.publicLinesRead += 1;
        return false;
    }
    if (PUTTY_COMMENT_LINE_PATTERN.test(trimmedLine)) {
        if (activeBlock.sawEncryption === false
            || activeBlock.sawComment
            || activeBlock.publicLineCount !== undefined) {
            activeBlock.invalidPayload = true;
        }
        else {
            activeBlock.sawComment = true;
        }
        return false;
    }
    const privateLineMatch = PUTTY_PRIVATE_KEY_LINE_COUNT_PATTERN.exec(trimmedLine);
    if (privateLineMatch?.[1] !== undefined) {
        if (activeBlock.sawEncryption
            && activeBlock.sawComment
            && (activeBlock.encrypted === false
                || activeBlock.version !== 3
                || hasCompletePuttyArgon2DerivationFields(activeBlock.keyDerivationFields))
            && activeBlock.publicLineCount !== undefined
            && activeBlock.publicLinesRead === activeBlock.publicLineCount
            && hasValidStreamingPuttyPublicPayload(activeBlock)) {
            activeBlock.privateLineCount = Number.parseInt(privateLineMatch[1], 10);
        }
        else {
            activeBlock.invalidPayload = true;
        }
        return false;
    }
    if (activeBlock.version === 3
        && activeBlock.publicLineCount !== undefined
        && activeBlock.publicLinesRead === activeBlock.publicLineCount
        && hasValidStreamingPuttyPublicPayload(activeBlock)
        && isPuttyKeyDerivationLine(trimmedLine)) {
        if (recordPuttyArgon2DerivationField(activeBlock.keyDerivationFields, trimmedLine) === false) {
            activeBlock.invalidPayload = true;
        }
        return false;
    }
    if (activeBlock.publicLineCount !== undefined && activeBlock.publicLinesRead === activeBlock.publicLineCount) {
        activeBlock.invalidPayload = true;
        return false;
    }
    if (trimmedLine.startsWith("Encryption: ")) {
        if (activeBlock.sawEncryption || activeBlock.sawComment) {
            activeBlock.invalidPayload = true;
        }
        else {
            activeBlock.sawEncryption = true;
            activeBlock.encrypted = /^Encryption: none$/iu.test(trimmedLine) === false;
        }
        return false;
    }
    const publicLineMatch = PUTTY_PUBLIC_KEY_LINE_COUNT_PATTERN.exec(trimmedLine);
    if (publicLineMatch?.[1] !== undefined) {
        if (activeBlock.sawEncryption === false
            || activeBlock.sawComment === false
            || activeBlock.publicLineCount !== undefined) {
            activeBlock.invalidPayload = true;
        }
        else {
            activeBlock.publicLineCount = Number.parseInt(publicLineMatch[1], 10);
        }
        return false;
    }
    if (trimmedLine.startsWith("Public-Lines: ")) {
        activeBlock.invalidPayload = true;
        return false;
    }
    return false;
}
function createStreamingPemPrivateKeyBlock(beginLine) {
    return {
        invalidPayload: false,
        label: beginLine.label,
        paddingCharacterCount: 0,
        payloadCharacterCount: 0,
        sawPadding: false,
        sawPayload: false,
        sourceLiteralDelimiter: beginLine.sourceLiteralDelimiter,
    };
}
function createStreamingOpenPgpPrivateKeyBlock(beginLine) {
    return {
        base64Remainder: "",
        crc24: OPENPGP_CRC24_INITIAL_VALUE,
        invalidPayload: false,
        paddingCharacterCount: 0,
        payloadCharacterCount: 0,
        sawChecksum: false,
        sawPadding: false,
        sawPayload: false,
        sawSeparator: false,
        sourceLiteralDelimiter: beginLine.sourceLiteralDelimiter,
    };
}
function createStreamingPuttyPrivateKeyBlock(beginLine) {
    return {
        encrypted: false,
        invalidPayload: false,
        keyDerivationFields: [],
        paddingCharacterCount: 0,
        privateLinesRead: 0,
        privatePayloadCharacterCount: 0,
        publicLinesRead: 0,
        publicPaddingCharacterCount: 0,
        publicPayloadCharacterCount: 0,
        publicSawPadding: false,
        sawComment: false,
        sawEncryption: false,
        sawPadding: false,
        sourceLiteralDelimiter: beginLine.sourceLiteralDelimiter,
        version: beginLine.version,
        waitingForMac: false,
    };
}
function updateStreamingPemPayload(block, line) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
        return;
    }
    if (PEM_METADATA_LINE_PATTERN.test(trimmedLine)) {
        if (block.sawPayload) {
            block.invalidPayload = true;
        }
        return;
    }
    const payloadLine = trimmedLine.replace(/[ \t]/gu, "");
    if (PEM_PAYLOAD_LINE_PATTERN.test(payloadLine) === false) {
        block.invalidPayload = true;
        return;
    }
    block.sawPayload = true;
    updateStreamingBase64Payload(block, payloadLine, true);
}
function updateStreamingOpenPgpPayload(block, line) {
    const trimmedLine = line.trim();
    if (block.sawSeparator === false) {
        if (trimmedLine.length === 0) {
            block.sawSeparator = true;
            return;
        }
        if (OPENPGP_ARMOR_HEADER_LINE_PATTERN.test(trimmedLine)) {
            return;
        }
        block.invalidPayload = true;
        return;
    }
    if (trimmedLine.length === 0) {
        return;
    }
    if (block.sawChecksum) {
        block.invalidPayload = true;
        return;
    }
    const checksum = decodeOpenPgpArmorChecksum(trimmedLine);
    if (checksum !== undefined) {
        block.sawChecksum = true;
        block.armorChecksum = checksum;
        return;
    }
    if (OPENPGP_ARMOR_HEADER_LINE_PATTERN.test(trimmedLine)) {
        block.invalidPayload = true;
        return;
    }
    const payloadLine = trimmedLine.replace(/[ \t]/gu, "");
    if (OPENPGP_PAYLOAD_LINE_PATTERN.test(payloadLine) === false) {
        block.invalidPayload = true;
        return;
    }
    for (const character of payloadLine) {
        if (character === "=") {
            block.sawPayload = true;
            block.sawPadding = true;
            block.paddingCharacterCount += 1;
            block.payloadCharacterCount += 1;
            continue;
        }
        if (block.sawPadding) {
            block.invalidPayload = true;
        }
        block.sawPayload = true;
        block.payloadCharacterCount += 1;
    }
    updateStreamingOpenPgpPayloadChecksum(block, payloadLine);
}
function updateStreamingOpenPgpPayloadChecksum(block, payloadLine) {
    block.base64Remainder += payloadLine;
    const completeQuantumLength = block.base64Remainder.length - (block.base64Remainder.length % 4);
    if (completeQuantumLength === 0) {
        return;
    }
    const completePayload = block.base64Remainder.slice(0, completeQuantumLength);
    block.base64Remainder = block.base64Remainder.slice(completeQuantumLength);
    block.crc24 = updateOpenPgpCrc24(block.crc24, Buffer.from(completePayload, "base64"));
}
function hasValidStreamingOpenPgpArmorChecksum(block) {
    if (block.sawChecksum === false) {
        return true;
    }
    if (block.armorChecksum === undefined) {
        return false;
    }
    const crc24 = block.base64Remainder.length === 0
        ? block.crc24
        : updateOpenPgpCrc24(block.crc24, Buffer.from(block.base64Remainder, "base64"));
    return matchesOpenPgpArmorChecksum(block.armorChecksum, crc24);
}
function updateStreamingPuttyPayload(block, line) {
    if (PUTTY_PRIVATE_KEY_PAYLOAD_LINE_PATTERN.test(line) === false) {
        block.invalidPayload = true;
        return;
    }
    for (const character of line) {
        if (character === "=") {
            block.sawPadding = true;
            block.paddingCharacterCount += 1;
            continue;
        }
        if (block.sawPadding) {
            block.invalidPayload = true;
        }
        block.privatePayloadCharacterCount += 1;
    }
}
function updateStreamingPuttyPublicPayload(block, line) {
    if (PUTTY_PRIVATE_KEY_PAYLOAD_LINE_PATTERN.test(line) === false) {
        block.invalidPayload = true;
        return;
    }
    for (const character of line) {
        if (character === "=") {
            block.publicSawPadding = true;
            block.publicPaddingCharacterCount += 1;
            continue;
        }
        if (block.publicSawPadding) {
            block.invalidPayload = true;
        }
        block.publicPayloadCharacterCount += 1;
    }
}
function hasValidStreamingPuttyPublicPayload(block) {
    return block.publicPayloadCharacterCount >= 32
        && block.publicPaddingCharacterCount <= 2
        && hasValidBase64QuantumLength(block.publicPayloadCharacterCount + block.publicPaddingCharacterCount, block.publicPaddingCharacterCount);
}
function updateStreamingBase64Payload(block, payloadLine, countPadding) {
    for (const character of payloadLine) {
        if (character === "=") {
            block.sawPadding = true;
            if (countPadding) {
                block.paddingCharacterCount += 1;
            }
            block.payloadCharacterCount += 1;
            continue;
        }
        if (block.sawPadding) {
            block.invalidPayload = true;
        }
        block.payloadCharacterCount += 1;
    }
}
function collectPemPrivateKeyBlockRanges(source) {
    const ranges = [];
    const lines = splitTextLineSpans(source);
    let activeBlock;
    lines.forEach((line) => {
        const beginLine = parsePemPrivateKeyBeginLine(line.text);
        if (activeBlock !== undefined) {
            const endMarker = `-----END ${activeBlock.label}-----`;
            const endMarkerIndex = line.text.indexOf(endMarker);
            if (isPemPrivateKeyEndLine(line.text, endMarker, activeBlock.sourceLiteralDelimiter)) {
                if (isValidPemPrivateKeyPayload(activeBlock.bodyLines)) {
                    ranges.push({
                        end: line.start + endMarkerIndex + endMarker.length,
                        start: activeBlock.start,
                    });
                }
                activeBlock = undefined;
                return;
            }
            if (beginLine !== undefined) {
                activeBlock = {
                    bodyLines: [],
                    label: beginLine.label,
                    start: line.start,
                    sourceLiteralDelimiter: beginLine.sourceLiteralDelimiter,
                };
                return;
            }
            activeBlock.bodyLines.push(line.text);
            return;
        }
        if (beginLine !== undefined) {
            activeBlock = {
                bodyLines: [],
                label: beginLine.label,
                start: line.start,
                sourceLiteralDelimiter: beginLine.sourceLiteralDelimiter,
            };
        }
    });
    return ranges;
}
function collectOpenPgpPrivateKeyBlockRanges(source) {
    const ranges = [];
    const lines = splitTextLineSpans(source);
    let activeBlock;
    lines.forEach((line) => {
        const beginLine = parseOpenPgpPrivateKeyBeginLine(line.text);
        if (activeBlock !== undefined) {
            const endMarkerIndex = line.text.indexOf(OPENPGP_PRIVATE_KEY_END_LINE);
            if (isArmorMarkerEndLine(line.text, OPENPGP_PRIVATE_KEY_END_LINE, activeBlock.sourceLiteralDelimiter)) {
                if (isValidOpenPgpPrivateKeyPayload(activeBlock.bodyLines)) {
                    ranges.push({
                        end: line.start + endMarkerIndex + OPENPGP_PRIVATE_KEY_END_LINE.length,
                        start: activeBlock.start,
                    });
                }
                activeBlock = undefined;
                return;
            }
            if (beginLine !== undefined) {
                activeBlock = {
                    bodyLines: [],
                    sourceLiteralDelimiter: beginLine.sourceLiteralDelimiter,
                    start: line.start,
                };
                return;
            }
            activeBlock.bodyLines.push(line.text);
            return;
        }
        if (beginLine !== undefined) {
            activeBlock = {
                bodyLines: [],
                sourceLiteralDelimiter: beginLine.sourceLiteralDelimiter,
                start: line.start,
            };
        }
    });
    return ranges;
}
function collectPuttyPrivateKeyBlockRanges(source) {
    const ranges = [];
    const lines = splitTextLineSpans(source);
    for (let index = 0; index < lines.length; index += 1) {
        const headerLine = lines[index];
        const beginLine = headerLine === undefined ? undefined : parsePuttyPrivateKeyBeginLine(headerLine.text);
        if (headerLine === undefined || beginLine === undefined) {
            continue;
        }
        let privateLineCount;
        let privateLinesStart;
        let publicLineCount;
        let publicLinesRead = 0;
        const publicPayloadLines = [];
        let encrypted = false;
        const keyDerivationFields = [];
        let sawComment = false;
        let sawEncryption = false;
        for (let scanIndex = index + 1; scanIndex < lines.length; scanIndex += 1) {
            const lineText = lines[scanIndex].text.trim();
            if (lineText.length === 0 || parsePuttyPrivateKeyBeginLine(lines[scanIndex].text) !== undefined) {
                break;
            }
            if (publicLineCount !== undefined && publicLinesRead < publicLineCount) {
                if (PUTTY_PRIVATE_KEY_PAYLOAD_LINE_PATTERN.test(lineText) === false) {
                    break;
                }
                publicPayloadLines.push(lineText);
                publicLinesRead += 1;
                continue;
            }
            if (PUTTY_COMMENT_LINE_PATTERN.test(lineText)) {
                if (sawEncryption === false || sawComment || publicLineCount !== undefined) {
                    break;
                }
                sawComment = true;
                continue;
            }
            const privateLineMatch = PUTTY_PRIVATE_KEY_LINE_COUNT_PATTERN.exec(lineText);
            if (privateLineMatch?.[1] !== undefined) {
                if (sawComment === false
                    || sawEncryption === false
                    || publicLineCount === undefined
                    || publicLinesRead !== publicLineCount
                    || (encrypted
                        && beginLine.version === 3
                        && hasCompletePuttyArgon2DerivationFields(keyDerivationFields) === false)) {
                    break;
                }
                privateLineCount = Number.parseInt(privateLineMatch[1], 10);
                privateLinesStart = scanIndex + 1;
                break;
            }
            if (beginLine.version === 3
                && publicLineCount !== undefined
                && publicLinesRead === publicLineCount
                && isPuttyKeyDerivationLine(lineText)) {
                if (recordPuttyArgon2DerivationField(keyDerivationFields, lineText) === false) {
                    break;
                }
                continue;
            }
            if (publicLineCount !== undefined && publicLinesRead === publicLineCount) {
                break;
            }
            if (lineText.startsWith("Encryption: ")) {
                if (sawEncryption || sawComment) {
                    break;
                }
                sawEncryption = true;
                encrypted = /^Encryption: none$/iu.test(lineText) === false;
                continue;
            }
            const publicLineMatch = PUTTY_PUBLIC_KEY_LINE_COUNT_PATTERN.exec(lineText);
            if (publicLineMatch?.[1] !== undefined) {
                if (sawEncryption === false || sawComment === false || publicLineCount !== undefined) {
                    break;
                }
                publicLineCount = Number.parseInt(publicLineMatch[1], 10);
                continue;
            }
        }
        if (sawEncryption === false
            || sawComment === false
            || publicLineCount === undefined
            || publicLinesRead !== publicLineCount
            || privateLineCount === undefined
            || privateLinesStart === undefined
            || privateLinesStart + privateLineCount >= lines.length) {
            continue;
        }
        const privatePayloadLines = lines
            .slice(privateLinesStart, privateLinesStart + privateLineCount)
            .map((line) => line.text.trim());
        const privateMacLine = lines[privateLinesStart + privateLineCount];
        const privateMac = privateMacLine === undefined
            ? undefined
            : parsePuttyPrivateKeyMacLine(privateMacLine.text, beginLine.sourceLiteralDelimiter, beginLine.version);
        if (privatePayloadLines.length === privateLineCount
            && isValidPuttyPayload(privatePayloadLines)
            && isValidPuttyPayload(publicPayloadLines)
            && privateMacLine !== undefined
            && privateMac !== undefined) {
            ranges.push({
                end: privateMacLine.start + privateMac.markerIndex + privateMac.markerLength,
                start: headerLine.start + beginLine.markerIndex,
            });
        }
    }
    return ranges;
}
function isValidPemPrivateKeyPayload(bodyLines) {
    const payload = [];
    let sawPayload = false;
    for (const line of bodyLines) {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) {
            continue;
        }
        if (PEM_METADATA_LINE_PATTERN.test(trimmedLine)) {
            if (sawPayload) {
                return false;
            }
            continue;
        }
        sawPayload = true;
        payload.push(trimmedLine.replace(/[ \t]/gu, ""));
    }
    if (payload.length === 0 || payload.some((line) => PEM_PAYLOAD_LINE_PATTERN.test(line) === false)) {
        return false;
    }
    const combinedPayload = payload.join("");
    const paddingCharacterCount = countTerminalBase64Padding(combinedPayload);
    return combinedPayload.length >= 32
        && hasValidBase64QuantumLength(combinedPayload.length, paddingCharacterCount)
        && /^[A-Za-z0-9+/]+={0,2}$/u.test(combinedPayload);
}
function hasValidBase64QuantumLength(characterCount, paddingCharacterCount) {
    if (paddingCharacterCount === 0) {
        return characterCount % 4 !== 1;
    }
    if (paddingCharacterCount === 1) {
        return characterCount % 4 === 0 && (characterCount - paddingCharacterCount) % 4 === 3;
    }
    if (paddingCharacterCount === 2) {
        return characterCount % 4 === 0 && (characterCount - paddingCharacterCount) % 4 === 2;
    }
    return false;
}
function countTerminalBase64Padding(source) {
    const paddingMatch = /=*$/u.exec(source);
    return paddingMatch?.[0].length ?? 0;
}
function isValidOpenPgpPrivateKeyPayload(bodyLines) {
    let armorChecksum;
    let sawChecksum = false;
    let sawSeparator = false;
    const payload = [];
    for (const line of bodyLines) {
        const trimmedLine = line.trim();
        if (sawSeparator === false) {
            if (trimmedLine.length === 0) {
                sawSeparator = true;
                continue;
            }
            if (OPENPGP_ARMOR_HEADER_LINE_PATTERN.test(trimmedLine)) {
                continue;
            }
            return false;
        }
        if (trimmedLine.length === 0) {
            continue;
        }
        if (sawChecksum) {
            return false;
        }
        const checksum = decodeOpenPgpArmorChecksum(trimmedLine);
        if (checksum !== undefined) {
            sawChecksum = true;
            armorChecksum = checksum;
            continue;
        }
        if (OPENPGP_ARMOR_HEADER_LINE_PATTERN.test(trimmedLine)) {
            return false;
        }
        payload.push(trimmedLine.replace(/[ \t]/gu, ""));
    }
    if (sawSeparator === false
        || payload.length === 0
        || payload.some((line) => OPENPGP_PAYLOAD_LINE_PATTERN.test(line) === false)) {
        return false;
    }
    const combinedPayload = payload.join("");
    const paddingCharacterCount = countTerminalBase64Padding(combinedPayload);
    return combinedPayload.length - paddingCharacterCount >= 32
        && hasValidBase64QuantumLength(combinedPayload.length, paddingCharacterCount)
        && /^[A-Za-z0-9+/]+={0,2}$/u.test(combinedPayload)
        && (armorChecksum === undefined || matchesOpenPgpArmorChecksum(armorChecksum, calculateOpenPgpCrc24(Buffer.from(combinedPayload, "base64"))));
}
function decodeOpenPgpArmorChecksum(line) {
    if (OPENPGP_ARMOR_CHECKSUM_LINE_PATTERN.test(line) === false) {
        return undefined;
    }
    const checksum = Buffer.from(line.slice(1), "base64");
    return checksum.length === 3 ? checksum : undefined;
}
function calculateOpenPgpCrc24(source) {
    return updateOpenPgpCrc24(OPENPGP_CRC24_INITIAL_VALUE, source);
}
function updateOpenPgpCrc24(crc24, source) {
    let nextCrc24 = crc24;
    for (const byte of source) {
        nextCrc24 ^= byte << 16;
        for (let bit = 0; bit < 8; bit += 1) {
            nextCrc24 <<= 1;
            if ((nextCrc24 & 0x1000000) !== 0) {
                nextCrc24 ^= OPENPGP_CRC24_POLYNOMIAL;
            }
            nextCrc24 &= 0xffffff;
        }
    }
    return nextCrc24;
}
function matchesOpenPgpArmorChecksum(checksum, crc24) {
    return checksum[0] === ((crc24 >>> 16) & 0xff)
        && checksum[1] === ((crc24 >>> 8) & 0xff)
        && checksum[2] === (crc24 & 0xff);
}
function isValidPuttyPayload(bodyLines) {
    if (bodyLines.length === 0 || bodyLines.some((line) => PUTTY_PRIVATE_KEY_PAYLOAD_LINE_PATTERN.test(line) === false)) {
        return false;
    }
    const combinedPayload = bodyLines.join("");
    const paddingCharacterCount = countTerminalBase64Padding(combinedPayload);
    return combinedPayload.length - paddingCharacterCount >= 32
        && hasValidBase64QuantumLength(combinedPayload.length, paddingCharacterCount)
        && /^[A-Za-z0-9+/]+={0,2}$/u.test(combinedPayload);
}
function parsePemPrivateKeyBeginLine(lineText) {
    const exactBeginMatch = PEM_PRIVATE_KEY_BEGIN_LINE_PATTERN.exec(lineText);
    if (exactBeginMatch?.[1] !== undefined) {
        return {
            label: exactBeginMatch[1],
        };
    }
    const markerMatch = /-----BEGIN ((?:[A-Z0-9 ]+ )?PRIVATE KEY)-----/u.exec(lineText);
    if (markerMatch?.[1] === undefined) {
        return undefined;
    }
    const markerEnd = markerMatch.index + markerMatch[0].length;
    const delimiter = parseSourceLiteralDelimiter(lineText.slice(0, markerMatch.index));
    if (delimiter === undefined || lineText.slice(markerEnd).trim().length > 0) {
        return undefined;
    }
    return {
        label: markerMatch[1],
        sourceLiteralDelimiter: delimiter,
    };
}
function isPemPrivateKeyEndLine(lineText, marker, sourceLiteralDelimiter) {
    return isArmorMarkerEndLine(lineText, marker, sourceLiteralDelimiter);
}
function parseOpenPgpPrivateKeyBeginLine(lineText) {
    if (isExactArmorMarkerLine(lineText, OPENPGP_PRIVATE_KEY_BEGIN_LINE)) {
        return {};
    }
    const markerIndex = lineText.indexOf(OPENPGP_PRIVATE_KEY_BEGIN_LINE);
    if (markerIndex < 0) {
        return undefined;
    }
    const markerEnd = markerIndex + OPENPGP_PRIVATE_KEY_BEGIN_LINE.length;
    const delimiter = parseSourceLiteralDelimiter(lineText.slice(0, markerIndex));
    if (delimiter === undefined || lineText.slice(markerEnd).trim().length > 0) {
        return undefined;
    }
    return {
        sourceLiteralDelimiter: delimiter,
    };
}
function parsePuttyPrivateKeyBeginLine(lineText) {
    const trimmedLine = lineText.trim();
    const exactBeginMatch = /^PuTTY-User-Key-File-([123]): [^\r\n]+$/u.exec(trimmedLine);
    if (exactBeginMatch?.[1] === "1" || exactBeginMatch?.[1] === "2" || exactBeginMatch?.[1] === "3") {
        return {
            markerIndex: lineText.indexOf(trimmedLine),
            version: Number.parseInt(exactBeginMatch[1], 10),
        };
    }
    const markerMatch = /PuTTY-User-Key-File-([123]): [^\r\n]+$/u.exec(lineText);
    if (markerMatch?.[1] === undefined) {
        return undefined;
    }
    const delimiter = parseSourceLiteralDelimiter(lineText.slice(0, markerMatch.index));
    if (delimiter === undefined) {
        return undefined;
    }
    return {
        markerIndex: markerMatch.index,
        sourceLiteralDelimiter: delimiter,
        version: Number.parseInt(markerMatch[1], 10),
    };
}
function isPuttyKeyDerivationLine(lineText) {
    return PUTTY_KEY_DERIVATION_LINE_PATTERN.test(lineText)
        || PUTTY_KEY_DERIVATION_PARAMETER_LINE_PATTERN.test(lineText);
}
function parsePuttyArgon2DerivationField(lineText) {
    const fieldName = lineText.slice(0, lineText.indexOf(":"));
    return PUTTY_ARGON2_DERIVATION_FIELDS.includes(fieldName)
        ? fieldName
        : undefined;
}
function recordPuttyArgon2DerivationField(fields, lineText) {
    const field = parsePuttyArgon2DerivationField(lineText);
    const expectedField = PUTTY_ARGON2_DERIVATION_FIELDS[fields.length];
    if (field === undefined || field !== expectedField) {
        return false;
    }
    fields.push(field);
    return true;
}
function hasCompletePuttyArgon2DerivationFields(fields) {
    return fields.length === PUTTY_ARGON2_DERIVATION_FIELDS.length;
}
function parsePuttyPrivateKeyMacLine(lineText, sourceLiteralDelimiter, version) {
    const macLength = version === 2 ? 40 : 64;
    const integrityLinePattern = version === 1
        ? /^Private-Hash: [0-9a-f]{40}$/iu
        : new RegExp(`^Private-MAC: [0-9a-f]{${macLength}}$`, "iu");
    const integrityMarkerPattern = version === 1
        ? /Private-Hash: [0-9a-f]{40}/iu
        : new RegExp(`Private-MAC: [0-9a-f]{${macLength}}`, "iu");
    if (sourceLiteralDelimiter === undefined) {
        const trimmedLine = lineText.trim();
        return integrityLinePattern.test(trimmedLine)
            ? {
                markerIndex: lineText.indexOf(trimmedLine),
                markerLength: trimmedLine.length,
            }
            : undefined;
    }
    const markerMatch = integrityMarkerPattern.exec(lineText);
    if (markerMatch === null || /^[ \t]*$/u.test(lineText.slice(0, markerMatch.index)) === false) {
        return undefined;
    }
    const suffix = lineText.slice(markerMatch.index + markerMatch[0].length);
    if (isSourceLiteralClosingSuffix(suffix, sourceLiteralDelimiter) === false) {
        return undefined;
    }
    return {
        markerIndex: markerMatch.index,
        markerLength: markerMatch[0].length,
    };
}
function isArmorMarkerEndLine(lineText, marker, sourceLiteralDelimiter) {
    if (sourceLiteralDelimiter === undefined) {
        return isExactArmorMarkerLine(lineText, marker);
    }
    const markerIndex = lineText.indexOf(marker);
    if (markerIndex < 0 || /^[ \t]*$/u.test(lineText.slice(0, markerIndex)) === false) {
        return false;
    }
    const suffix = lineText.slice(markerIndex + marker.length);
    return isSourceLiteralClosingSuffix(suffix, sourceLiteralDelimiter);
}
function isSourceLiteralClosingSuffix(suffix, sourceLiteralDelimiter) {
    const escapedDelimiter = escapeRegExp(sourceLiteralDelimiter);
    return new RegExp(`^[ \\t]*${escapedDelimiter}[ \\t]*(?:[;,\\])}]*)[ \\t]*$`, "u").test(suffix);
}
function parseSourceLiteralDelimiter(prefix) {
    const trimmedPrefix = prefix.trimEnd();
    const rawStringMatch = /(?:^|[^A-Za-z0-9_])(?:u8|u|U|L)?R"([^()\s\\]{0,16})\($/u.exec(trimmedPrefix);
    if (rawStringMatch?.[1] !== undefined) {
        return `)${rawStringMatch[1]}"`;
    }
    const rustRawStringMatch = /(?:^|[^A-Za-z0-9_])(?:b|c)?r(#{0,16})"$/u.exec(trimmedPrefix);
    if (rustRawStringMatch?.[1] !== undefined) {
        return `"${rustRawStringMatch[1]}`;
    }
    const delimiter = trimmedPrefix.at(-1);
    if (delimiter !== "\"" && delimiter !== "'" && delimiter !== "`") {
        return undefined;
    }
    let delimiterStart = trimmedPrefix.length - 1;
    while (delimiterStart > 0 && trimmedPrefix[delimiterStart - 1] === delimiter) {
        delimiterStart -= 1;
    }
    return trimmedPrefix.slice(delimiterStart);
}
function isExactArmorMarkerLine(lineText, marker) {
    const markerIndex = lineText.indexOf(marker);
    return markerIndex >= 0
        && /^[ \t]*$/u.test(lineText.slice(0, markerIndex))
        && /^[ \t]*$/u.test(lineText.slice(markerIndex + marker.length));
}
function escapeRegExp(source) {
    return source.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function splitTextLineSpans(source) {
    const lines = [];
    let start = 0;
    for (const match of source.matchAll(PEM_LINE_BREAK_SCAN_PATTERN)) {
        lines.push({
            end: match.index,
            start,
            text: source.slice(start, match.index),
        });
        start = match.index + match[0].length;
    }
    lines.push({
        end: source.length,
        start,
        text: source.slice(start),
    });
    return lines;
}
function redactSensitiveBlockRanges(source, ranges) {
    if (ranges.length === 0) {
        return source;
    }
    let redactedSource = "";
    let startIndex = 0;
    ranges
        .sort((left, right) => left.start - right.start)
        .forEach((range) => {
        if (range.start < startIndex) {
            return;
        }
        redactedSource += `${source.slice(startIndex, range.start)}[REDACTED]`;
        startIndex = range.end;
    });
    return `${redactedSource}${source.slice(startIndex)}`;
}
function decodeBase64UrlJson(segment) {
    try {
        return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    }
    catch {
        return undefined;
    }
}
function decodeSourceStringLiteral(source) {
    const delimiter = source.at(0);
    if ((delimiter !== "\"" && delimiter !== "'" && delimiter !== "`")
        || source.at(-1) !== delimiter
        || (delimiter === "`" && source.includes("${"))) {
        return undefined;
    }
    return decodeJsonEscapedTextFragment(source.slice(1, -1));
}
function decodeJsonUnicodeEscapedTextFragment(source) {
    if (JSON_UNICODE_ESCAPE_SEQUENCE_PATTERN.test(source) === false) {
        return undefined;
    }
    return decodeJsonEscapedTextFragment(source);
}
function decodeJsonEscapedTextFragment(source) {
    const decoded = [];
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (character !== "\\") {
            decoded.push(character);
            continue;
        }
        const escapeCharacter = source[index + 1];
        switch (escapeCharacter) {
            case "\n":
                index += 1;
                break;
            case "\r":
                index += source[index + 2] === "\n" ? 2 : 1;
                break;
            case "\"":
            case "'":
            case "\\":
            case "/":
                decoded.push(escapeCharacter);
                index += 1;
                break;
            case "b":
                decoded.push("\b");
                index += 1;
                break;
            case "f":
                decoded.push("\f");
                index += 1;
                break;
            case "n":
                decoded.push("\n");
                index += 1;
                break;
            case "r":
                decoded.push("\r");
                index += 1;
                break;
            case "t":
                decoded.push("\t");
                index += 1;
                break;
            case "u": {
                if (source[index + 2] === "{") {
                    const closingBraceIndex = source.indexOf("}", index + 3);
                    const hex = closingBraceIndex < 0 ? "" : source.slice(index + 3, closingBraceIndex);
                    if (/^[0-9a-fA-F]{1,6}$/u.test(hex)) {
                        const codePoint = Number.parseInt(hex, 16);
                        if (codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff)) {
                            decoded.push(String.fromCodePoint(codePoint));
                            index = closingBraceIndex;
                            break;
                        }
                    }
                }
                const hex = source.slice(index + 2, index + 6);
                if (/^[0-9a-fA-F]{4}$/u.test(hex)) {
                    decoded.push(String.fromCharCode(Number.parseInt(hex, 16)));
                    index += 5;
                    break;
                }
                decoded.push(character);
                break;
            }
            case "x": {
                const hex = source.slice(index + 2, index + 4);
                if (/^[0-9a-fA-F]{2}$/u.test(hex)) {
                    decoded.push(String.fromCharCode(Number.parseInt(hex, 16)));
                    index += 3;
                    break;
                }
                decoded.push(character);
                break;
            }
            default:
                if (escapeCharacter !== undefined && /^[0-7]$/u.test(escapeCharacter)) {
                    const octalMatch = /^[0-7]{1,3}/u.exec(source.slice(index + 1));
                    if (octalMatch?.[0] !== undefined) {
                        decoded.push(String.fromCharCode(Number.parseInt(octalMatch[0], 8)));
                        index += octalMatch[0].length;
                        break;
                    }
                }
                decoded.push(character);
                break;
        }
    }
    return decoded.join("");
}
function buildSourceTokenRanges(source) {
    return {
        filesystem: buildTextRanges(source, isFilesystemTokenDelimiter),
        url: buildTextRanges(source, isUrlTokenDelimiter),
    };
}
function buildTextRanges(source, isDelimiter) {
    const ranges = [];
    let start = 0;
    for (let index = 0; index < source.length; index += 1) {
        if (isDelimiter(source[index])) {
            if (start < index) {
                ranges.push({ end: index, start });
            }
            start = index + 1;
        }
    }
    if (start < source.length) {
        ranges.push({ end: source.length, start });
    }
    return ranges;
}
function findTextRangeStart(ranges, matchIndex) {
    let high = ranges.length - 1;
    let low = 0;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const range = ranges[middle];
        if (matchIndex < range.start) {
            high = middle - 1;
        }
        else if (matchIndex >= range.end) {
            low = middle + 1;
        }
        else {
            return range.start;
        }
    }
    return 0;
}
function isFilesystemTokenDelimiter(character) {
    return /[\s"'`<>\[({=]/u.test(character);
}
function isUrlTokenDelimiter(character) {
    return /[\s"'`<>\[({]/u.test(character);
}
function isFilesystemLikeMachineHomeMatch(source, match, tokenRanges) {
    if (hasEnclosingRemoteUrlPrefix(source, match.index, tokenRanges)) {
        return false;
    }
    const tokenStart = findTextRangeStart(tokenRanges.filesystem, match.index);
    const tokenPrefix = source.slice(tokenStart, match.index);
    return isRemoteUrlPrefix(tokenPrefix) === false;
}
function isFilesystemLikePosixHomeMatch(source, match, tokenRanges) {
    const directoryName = match[1];
    if (directoryName === undefined || isRouteParameterDirectory(directoryName)) {
        return false;
    }
    if (hasEnclosingRemoteUrlPrefix(source, match.index, tokenRanges)) {
        return false;
    }
    const tokenStart = findTextRangeStart(tokenRanges.filesystem, match.index);
    const tokenPrefix = source.slice(tokenStart, match.index);
    if (isRemoteUrlPrefix(tokenPrefix)) {
        return false;
    }
    const nextCharacter = source.at(match.index + match[0].length);
    return nextCharacter === "/"
        || nextCharacter === "\\"
        || nextCharacter === undefined
        || POSIX_HOME_PATH_BOUNDARY_PATTERN.test(nextCharacter);
}
function isRouteParameterDirectory(directoryName) {
    return directoryName.startsWith(":");
}
function isFilesystemLikeRootHomeMatch(source, match, tokenRanges) {
    if (hasEnclosingRemoteUrlPrefix(source, match.index, tokenRanges)) {
        return false;
    }
    const tokenStart = findTextRangeStart(tokenRanges.filesystem, match.index);
    const tokenPrefix = source.slice(tokenStart, match.index);
    if (isRemoteUrlPrefix(tokenPrefix)) {
        return false;
    }
    const nextCharacter = source.at(match.index + match[0].length);
    return nextCharacter === "/"
        || nextCharacter === undefined
        || POSIX_HOME_PATH_BOUNDARY_PATTERN.test(nextCharacter);
}
function isGenericHomeDirectoryName(directoryName) {
    return GENERIC_HOME_DIRECTORY_NAMES.has(directoryName.toLowerCase());
}
function isGenericHomeDirectoryMatch(source, match) {
    const directoryName = match[1];
    if (directoryName === undefined) {
        return false;
    }
    const nextCharacter = source.at(match.index + match[0].length);
    const boundaryIndex = nextCharacter === "/" || nextCharacter === "\\"
        ? -1
        : directoryName.search(HOME_DIRECTORY_NAME_GENERIC_BOUNDARY_PATTERN);
    const boundedDirectoryName = boundaryIndex < 0
        ? directoryName
        : directoryName.slice(0, boundaryIndex);
    return isGenericHomeDirectoryName(boundedDirectoryName);
}
function hasEnclosingRemoteUrlPrefix(source, matchIndex, tokenRanges) {
    const tokenStart = findTextRangeStart(tokenRanges.url, matchIndex);
    const tokenPrefix = source.slice(tokenStart, matchIndex);
    const urlMatch = /(?:^|=)([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>]*)$/u.exec(tokenPrefix);
    return urlMatch !== null && /^file:\/\//iu.test(urlMatch[1] ?? "") === false;
}
function isRemoteUrlPrefix(tokenPrefix) {
    return /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>]*$/u.test(tokenPrefix) && /^file:\/\//iu.test(tokenPrefix) === false;
}
function isGitHubAppJwt(candidate) {
    const [headerSegment, payloadSegment, signatureSegment] = candidate.split(".");
    if (headerSegment === undefined || payloadSegment === undefined || signatureSegment === undefined) {
        return false;
    }
    const header = decodeBase64UrlJson(headerSegment);
    const payload = decodeBase64UrlJson(payloadSegment);
    if (isJsonRecord(header) === false || isJsonRecord(payload) === false) {
        return false;
    }
    const tokenType = header.typ;
    const issuedAt = readJwtNumericDate(payload.iat);
    const expiresAt = readJwtNumericDate(payload.exp);
    return header.alg === "RS256"
        && (tokenType === undefined || (typeof tokenType === "string" && tokenType.toUpperCase() === "JWT"))
        && isGitHubAppIssuer(payload.iss)
        && issuedAt !== undefined
        && expiresAt !== undefined
        && expiresAt > issuedAt
        && expiresAt - issuedAt <= GITHUB_APP_JWT_MAX_INTERVAL_SECONDS;
}
function isGitHubAppIssuer(issuer) {
    if (typeof issuer === "number") {
        return Number.isSafeInteger(issuer) && issuer > 0;
    }
    return typeof issuer === "string"
        && (/^[1-9][0-9]{0,15}$/u.test(issuer) || /^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/u.test(issuer));
}
function isJsonRecord(value) {
    return typeof value === "object" && value !== null && Array.isArray(value) === false;
}
function looksLikeUtf16Be(source) {
    return hasUtf16NullBytePattern(source, "be");
}
function looksLikeUtf16Le(source) {
    return hasUtf16NullBytePattern(source, "le");
}
function looksLikeUtf32Be(source) {
    return hasUtf32NullBytePattern(source, "be");
}
function looksLikeUtf32Le(source) {
    return hasUtf32NullBytePattern(source, "le");
}
function hasUtf16NullBytePattern(source, byteOrder) {
    const sampleLength = source.length - (source.length % 2);
    if (sampleLength < 4) {
        return false;
    }
    let evenZeroByteCount = 0;
    let oddZeroByteCount = 0;
    let pairCount = 0;
    for (let index = 0; index + 1 < sampleLength; index += 2) {
        if (source[index] === 0) {
            evenZeroByteCount += 1;
        }
        if (source[index + 1] === 0) {
            oddZeroByteCount += 1;
        }
        pairCount += 1;
    }
    const expectedZeroByteCount = byteOrder === "be" ? evenZeroByteCount : oddZeroByteCount;
    const unexpectedZeroByteCount = byteOrder === "be" ? oddZeroByteCount : evenZeroByteCount;
    return (expectedZeroByteCount / pairCount >= 0.25
        && unexpectedZeroByteCount / pairCount <= 0.05
        && expectedZeroByteCount > unexpectedZeroByteCount * 2)
        || (expectedZeroByteCount >= SPARSE_UTF16_MIN_ALIGNED_NULL_BYTES
            && unexpectedZeroByteCount <= Math.max(4, Math.floor(expectedZeroByteCount * 0.05))
            && expectedZeroByteCount > unexpectedZeroByteCount * 4);
}
function hasUtf32NullBytePattern(source, byteOrder) {
    return [0, 1, 2, 3].some((alignmentOffset) => (hasUtf32NullBytePatternAtAlignment(source, byteOrder, alignmentOffset)));
}
function hasUtf32NullBytePatternAtAlignment(source, byteOrder, alignmentOffset) {
    const sampleLength = source.length - ((source.length - alignmentOffset) % 4);
    if (sampleLength - alignmentOffset < 16) {
        return false;
    }
    let matchingCodePointCount = 0;
    let codePointCount = 0;
    for (let index = alignmentOffset; index + 3 < sampleLength; index += 4) {
        const valueByteIndex = byteOrder === "le" ? index : index + 3;
        const firstZeroByteIndex = byteOrder === "le" ? index + 1 : index;
        const secondZeroByteIndex = byteOrder === "le" ? index + 2 : index + 1;
        const thirdZeroByteIndex = byteOrder === "le" ? index + 3 : index + 2;
        if (source[valueByteIndex] !== 0
            && source[firstZeroByteIndex] === 0
            && source[secondZeroByteIndex] === 0
            && source[thirdZeroByteIndex] === 0) {
            matchingCodePointCount += 1;
        }
        codePointCount += 1;
    }
    return matchingCodePointCount / codePointCount >= 0.25
        || matchingCodePointCount >= SPARSE_UTF32_MIN_ALIGNED_NULL_CODE_POINTS;
}
function stripTextByteOrderMark(source) {
    return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}
function decodeGitPathOutput(source) {
    try {
        return STRICT_UTF8_TEXT_DECODER.decode(source);
    }
    catch {
        return WINDOWS_1252_TEXT_DECODER.decode(source);
    }
}
function decodeGitPathRecordsOutput(source) {
    if (source.length === 0) {
        return "";
    }
    const records = [];
    let recordStart = 0;
    let recordEnd = source.indexOf(0, recordStart);
    while (recordEnd >= 0) {
        records.push(decodeGitPathOutput(source.subarray(recordStart, recordEnd)));
        recordStart = recordEnd + 1;
        recordEnd = source.indexOf(0, recordStart);
    }
    if (recordStart < source.length) {
        records.push(decodeGitPathOutput(source.subarray(recordStart)));
        return records.join("\0");
    }
    return `${records.join("\0")}\0`;
}
function parseTrackedBlobEntries(output) {
    if (output.length === 0) {
        return [];
    }
    return output
        .split("\0")
        .filter(Boolean)
        .flatMap((record) => {
        const metadataEnd = record.indexOf("\t");
        if (metadataEnd < 0) {
            return [];
        }
        const metadata = record.slice(0, metadataEnd);
        const relativePath = record.slice(metadataEnd + 1);
        const treeMatch = /^([0-9]{6}) (blob|commit) ([0-9a-f]+)$/iu.exec(metadata);
        const indexMatch = /^([0-9]{6}) ([0-9a-f]+) [0-3]$/iu.exec(metadata);
        const mode = treeMatch?.[1] ?? indexMatch?.[1];
        const objectId = treeMatch?.[3] ?? indexMatch?.[2];
        const type = treeMatch?.[2] === "commit" || mode === "160000" ? "commit" : "blob";
        if (mode === undefined
            || objectId === undefined
            || /^0+$/u.test(objectId)
            || relativePath.length === 0
            || type === undefined) {
            return [];
        }
        return [{
                mode,
                objectId,
                path: relativePath,
                type,
            }];
    })
        .sort((left, right) => left.path.localeCompare(right.path));
}
function normalizePatchAdditionText(source) {
    return source.replace(/\0+/gu, "\n");
}
function decodeGitObjectHeaders(source) {
    const headerEnd = source.indexOf("\n\n");
    if (headerEnd < 0) {
        return {
            bodyStart: source.length,
            text: decodeGitPathOutput(source),
        };
    }
    return {
        bodyStart: headerEnd + 2,
        text: decodeGitPathOutput(source.subarray(0, headerEnd)),
    };
}
function parseAnnotatedTagTarget(source) {
    let objectId;
    let type;
    for (const line of source.split(/\r?\n/u)) {
        if (line.length === 0) {
            break;
        }
        if (line.startsWith("object ")) {
            objectId = line.slice("object ".length);
            continue;
        }
        if (line.startsWith("type ")) {
            type = line.slice("type ".length);
        }
    }
    if (objectId === undefined || type === undefined || HISTORY_SHA_PATTERN.test(objectId) === false) {
        return undefined;
    }
    return {
        objectId,
        type,
    };
}
function peelGitObjectTarget(repoRoot, input) {
    let target = input;
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "public-safety-audit-peel-"));
    const visitedTagObjectIds = new Set();
    try {
        while (target.type === "tag") {
            if (visitedTagObjectIds.has(target.objectId)) {
                return undefined;
            }
            visitedTagObjectIds.add(target.objectId);
            const tagObjectPath = path.join(temporaryDirectory, `tag-${target.objectId}`);
            writeGitCatFileTagToFile(repoRoot, target.objectId, tagObjectPath);
            const nextTarget = parseAnnotatedTagTarget(readAnnotatedTagHeaderText(tagObjectPath));
            if (nextTarget === undefined) {
                return undefined;
            }
            target = nextTarget;
        }
        return target;
    }
    finally {
        rmSync(temporaryDirectory, { force: true, recursive: true });
    }
}
function parseGitLfsPointerFile(filePath) {
    const size = statSync(filePath).size;
    if (size > GIT_LFS_POINTER_MAX_BYTES) {
        return undefined;
    }
    const sourceText = decodeAuditText(readFileSync(filePath));
    return sourceText === undefined ? undefined : parseGitLfsPointer(sourceText);
}
function parseGitLfsPointer(source) {
    const lines = source.trimEnd().split(/\r?\n/u);
    if (lines[0] !== "version https://git-lfs.github.com/spec/v1") {
        return undefined;
    }
    let oid;
    let size;
    for (const line of lines.slice(1)) {
        const oidMatch = /^oid sha256:([0-9a-f]{64})$/u.exec(line);
        if (oidMatch?.[1] !== undefined) {
            oid = oidMatch[1];
            continue;
        }
        const sizeMatch = /^size ([0-9]+)$/u.exec(line);
        if (sizeMatch?.[1] !== undefined) {
            const parsedSize = Number.parseInt(sizeMatch[1], 10);
            if (Number.isSafeInteger(parsedSize) && parsedSize >= 0) {
                size = parsedSize;
            }
        }
    }
    if (oid === undefined || size === undefined) {
        return undefined;
    }
    return {
        oid,
        size,
    };
}
function getLocalGitLfsObjectPath(repoRoot, oid) {
    const candidatePath = path.join(getGitLfsObjectsDirectory(repoRoot), oid.slice(0, 2), oid.slice(2, 4), oid);
    try {
        return lstatSync(candidatePath).isFile() ? candidatePath : undefined;
    }
    catch {
        return undefined;
    }
}
function doesGitLfsObjectMatchPointer(filePath, pointer) {
    let reader;
    try {
        const stat = statSync(filePath);
        if (stat.size !== pointer.size) {
            return false;
        }
        const hash = createHash("sha256");
        reader = createBufferedFileReader(filePath);
        while (fillBufferedReader(reader)) {
            hash.update(reader.buffer.subarray(reader.offset, reader.length));
            reader.offset = reader.length;
        }
        return hash.digest("hex") === pointer.oid;
    }
    catch {
        return false;
    }
    finally {
        if (reader !== undefined) {
            closeSync(reader.fileDescriptor);
        }
    }
}
function getGitLfsObjectsDirectory(repoRoot) {
    const gitCommonDirectory = path.resolve(repoRoot, runGit(repoRoot, ["rev-parse", "--git-common-dir"]).trim());
    const configuredStorage = readGitLfsStorageConfig(repoRoot);
    const storageDirectory = configuredStorage === undefined
        ? path.join(gitCommonDirectory, "lfs")
        : resolveGitDirectoryRelativePath(gitCommonDirectory, configuredStorage);
    return path.join(storageDirectory, "objects");
}
function readGitLfsStorageConfig(repoRoot) {
    try {
        const value = execFileSync("git", ["config", "--get", "--path", "lfs.storage"], {
            cwd: repoRoot,
            encoding: "utf8",
            env: auditGitEnvironment(),
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        return value.length === 0 ? undefined : value;
    }
    catch {
        return undefined;
    }
}
function resolveGitDirectoryRelativePath(gitDirectory, configuredPath) {
    return path.isAbsolute(configuredPath)
        ? configuredPath
        : path.resolve(gitDirectory, configuredPath);
}
function readJwtNumericDate(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
function findRuleIdsForGitBlobs(repoRoot, objectIds) {
    const uniqueObjectIds = [...new Set(objectIds)];
    const ruleIdsByObjectId = new Map();
    if (uniqueObjectIds.length === 0) {
        return ruleIdsByObjectId;
    }
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "public-safety-audit-blob-"));
    const outputPath = path.join(temporaryDirectory, "git-cat-file-output");
    let outputFd;
    try {
        outputFd = openSync(outputPath, "w");
        execFileSync("git", ["cat-file", "--batch"], {
            cwd: repoRoot,
            env: auditGitEnvironment(),
            input: `${uniqueObjectIds.join("\n")}\n`,
            stdio: ["pipe", outputFd, "pipe"],
        });
        closeSync(outputFd);
        outputFd = undefined;
        readGitCatFileBatchBlobs(repoRoot, outputPath, ruleIdsByObjectId, temporaryDirectory);
        if (ruleIdsByObjectId.size !== uniqueObjectIds.length) {
            throw new Error("Public safety audit could not read the local Git history.");
        }
        return ruleIdsByObjectId;
    }
    catch {
        throw new Error("Public safety audit could not read the local Git history.");
    }
    finally {
        if (outputFd !== undefined) {
            closeSync(outputFd);
        }
        rmSync(temporaryDirectory, { force: true, recursive: true });
    }
}
function readGitCatFileBatchBlobs(repoRoot, outputPath, ruleIdsByObjectId, temporaryDirectory) {
    const reader = createBufferedFileReader(outputPath);
    try {
        while (true) {
            const headerBuffer = readBufferedLine(reader);
            if (headerBuffer === undefined) {
                return;
            }
            const header = headerBuffer.toString("utf8");
            const headerMatch = /^([0-9a-f]{40}|[0-9a-f]{64}) ([a-z]+) ([0-9]+)$/iu.exec(header);
            if (headerMatch?.[1] === undefined || headerMatch[2] === undefined || headerMatch[3] === undefined) {
                throw new Error("Public safety audit could not read the local Git history.");
            }
            const objectId = headerMatch[1];
            const objectSize = Number.parseInt(headerMatch[3], 10);
            if (headerMatch[2] !== "blob" || Number.isSafeInteger(objectSize) === false || objectSize < 0) {
                throw new Error("Public safety audit could not read the local Git history.");
            }
            ruleIdsByObjectId.set(objectId, findRuleIdsForGitCatFileBatchBlob(repoRoot, reader, objectId, objectSize, temporaryDirectory));
            const separator = readBufferedByte(reader);
            if (separator !== 0x0a) {
                throw new Error("Public safety audit could not read the local Git history.");
            }
        }
    }
    finally {
        closeSync(reader.fileDescriptor);
    }
}
function findRuleIdsForGitCatFileBatchBlob(repoRoot, reader, objectId, objectSize, temporaryDirectory) {
    if (objectSize <= GIT_BLOB_FULL_DECODE_MAX_BYTES) {
        return findRuleIdsForGitBlobBuffer(repoRoot, readBufferedBytes(reader, objectSize));
    }
    const blobPath = path.join(temporaryDirectory, `blob-${objectId}`);
    const blobFd = openSync(blobPath, "w");
    try {
        readBufferedBytesToFile(reader, objectSize, blobFd);
    }
    finally {
        closeSync(blobFd);
    }
    return findRuleIdsForGitBlobFile(repoRoot, blobPath);
}
function findRuleIdsForGitBlobBuffer(repoRoot, source) {
    if (source.length <= GIT_LFS_POINTER_MAX_BYTES) {
        const sourceText = decodeAuditText(source);
        const lfsPointer = sourceText === undefined ? undefined : parseGitLfsPointer(sourceText);
        if (lfsPointer !== undefined) {
            const pointerRuleIds = findRuleIdsForAuditTextBuffer(source);
            const lfsObjectPath = getLocalGitLfsObjectPath(repoRoot, lfsPointer.oid);
            if (lfsObjectPath === undefined || doesGitLfsObjectMatchPointer(lfsObjectPath, lfsPointer) === false) {
                return uniqueRuleIds([...pointerRuleIds, "git-lfs-pointer"]);
            }
            try {
                return uniqueRuleIds([...pointerRuleIds, ...findRuleIdsForAuditTextFile(lfsObjectPath)]);
            }
            catch {
                return uniqueRuleIds([...pointerRuleIds, "git-lfs-pointer"]);
            }
        }
    }
    return findRuleIdsForAuditTextBuffer(source);
}
function findRuleIdsForGitBlobFile(repoRoot, filePath) {
    const lfsPointer = parseGitLfsPointerFile(filePath);
    if (lfsPointer !== undefined) {
        const pointerRuleIds = findRuleIdsForAuditTextBuffer(readFileSync(filePath));
        const lfsObjectPath = getLocalGitLfsObjectPath(repoRoot, lfsPointer.oid);
        if (lfsObjectPath === undefined || doesGitLfsObjectMatchPointer(lfsObjectPath, lfsPointer) === false) {
            return uniqueRuleIds([...pointerRuleIds, "git-lfs-pointer"]);
        }
        try {
            return uniqueRuleIds([...pointerRuleIds, ...findRuleIdsForAuditTextFile(lfsObjectPath)]);
        }
        catch {
            return uniqueRuleIds([...pointerRuleIds, "git-lfs-pointer"]);
        }
    }
    return findRuleIdsForAuditTextFile(filePath);
}
function uniqueRuleIds(ruleIds) {
    const orderedRuleIds = ["access-token", "git-lfs-pointer", "machine-home-path", "private-key"];
    return orderedRuleIds
        .filter((ruleId) => ruleIds.includes(ruleId));
}
function findRuleIdsForAuditTextFile(filePath) {
    if (statSync(filePath).size <= GIT_BLOB_FULL_DECODE_MAX_BYTES) {
        return findRuleIdsForAuditTextBuffer(readFileSync(filePath));
    }
    return findRuleIdsForLargeAuditTextFile(filePath);
}
function findRuleIdsForAuditTextBuffer(source) {
    const foundRuleIds = new Set();
    scanDecodedAuditTextVariants(source, (sourceText) => {
        findRuleIdsForText(sourceText).forEach((ruleId) => {
            foundRuleIds.add(ruleId);
        });
        return foundRuleIds.size === PUBLIC_SAFETY_AUDIT_RULES.length;
    });
    return PUBLIC_SAFETY_AUDIT_RULES
        .map((rule) => rule.id)
        .filter((ruleId) => foundRuleIds.has(ruleId));
}
function findRuleIdsForText(source) {
    return PUBLIC_SAFETY_AUDIT_RULES
        .filter((rule) => rule.matches(source))
        .map((rule) => rule.id);
}
function couldMatchRuleInText(ruleId, source) {
    switch (ruleId) {
        case "access-token":
            return AUTHORIZATION_BEARER_PREFIX_PATTERN.test(source)
                || source.includes("AKIA")
                || source.includes("ASIA")
                || source.includes("AIza")
                || source.includes("eyJ")
                || source.includes("gh")
                || source.includes("github_pat_")
                || source.includes("npm_")
                || source.includes("pypi-")
                || source.includes("sk-")
                || source.includes("xox");
        case "git-lfs-pointer":
            return false;
        case "machine-home-path":
            return POSIX_USERS_PREFIX_PATTERN.test(source)
                || source.includes(POSIX_HOME_PREFIX)
                || source.includes(`/${ROOT_HOME_NAME}`)
                || source.includes(VAR_ROOT_PREFIX)
                || WINDOWS_USERS_PREFIX_PATTERN.test(source)
                || WINDOWS_DRIVE_USERS_PREFIX_PATTERN.test(source);
        case "private-key":
            return source.includes("PRIVATE KEY BLOCK")
                || source.includes(" PRIVATE KEY-----")
                || source.includes("PuTTY-User-Key-File-")
                || source.includes("Private-Lines:");
    }
}
function findRuleIdsForLargeAuditTextFile(filePath) {
    const foundRuleIds = new Set();
    scanLargeDecodedAuditTextFile(filePath, () => createLargeBlobTextScanner(foundRuleIds));
    return PUBLIC_SAFETY_AUDIT_RULES
        .map((rule) => rule.id)
        .filter((ruleId) => foundRuleIds.has(ruleId));
}
function createLargeBlobTextScanner(foundRuleIds) {
    const privateKeyDetector = createStreamingPrivateKeyDetector();
    const scanWindow = (source) => {
        const prefilterSources = source.includes("\\")
            ? [source, decodeJsonEscapedTextFragment(source)]
            : [source];
        PUBLIC_SAFETY_AUDIT_RULES.forEach((rule) => {
            if (foundRuleIds.has(rule.id) === false
                && prefilterSources.some((prefilterSource) => couldMatchRuleInText(rule.id, prefilterSource))
                && rule.matches(source)) {
                foundRuleIds.add(rule.id);
            }
        });
        return foundRuleIds.size === PUBLIC_SAFETY_AUDIT_RULES.length;
    };
    return {
        end: (sourceWindow) => {
            if (privateKeyDetector.end()) {
                foundRuleIds.add("private-key");
            }
            return scanWindow(sourceWindow);
        },
        write: ({ decodedChunk, sourceWindow }) => {
            if (privateKeyDetector.write(decodedChunk)) {
                foundRuleIds.add("private-key");
            }
            return scanWindow(sourceWindow);
        },
    };
}
function containsRootMachineHomePath(source, tokenRanges) {
    for (const match of source.matchAll(ROOT_HOME_PATH_PATTERN)) {
        if (isFilesystemLikeRootHomeMatch(source, match, tokenRanges)) {
            return true;
        }
    }
    return false;
}
export function redactSensitivePath(sourcePath) {
    const withAccessTokensRedacted = ACCESS_TOKEN_PATTERNS.reduce((redactedPath, pattern) => {
        const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
        return redactedPath.replace(new RegExp(pattern.source, flags), "[REDACTED]");
    }, sourcePath);
    const withJwtRedacted = withAccessTokensRedacted.replace(GITHUB_APP_JWT_PATTERN, "[REDACTED]");
    const withJsonDecodedSecretsRedacted = redactJsonDecodedSensitiveValues(withJwtRedacted);
    const withPrivateKeysRedacted = redactPrivateKeyBlocks(withJsonDecodedSecretsRedacted);
    return redactMachineHomePathSegments(withPrivateKeysRedacted);
}
function redactJsonDecodedSensitiveValues(sourcePath) {
    if (sourcePath.includes("\\") === false
        && sourcePath.includes("\"") === false
        && sourcePath.includes("'") === false) {
        return sourcePath;
    }
    const withSensitiveSourceLiteralsRedacted = redactSensitiveSourceLiterals(sourcePath);
    const decodedFragment = decodeJsonUnicodeEscapedTextFragment(withSensitiveSourceLiteralsRedacted);
    if (decodedFragment !== undefined && containsSensitiveValueInPlainText(decodedFragment)) {
        return "[REDACTED]";
    }
    return withSensitiveSourceLiteralsRedacted;
}
function redactSensitiveSourceLiterals(sourcePath) {
    const redactionRanges = [];
    let previousEnd;
    let runLiterals = [];
    const flushLiteralRun = () => {
        if (runLiterals.length === 0) {
            return;
        }
        if (runLiterals.length === 1) {
            const literal = runLiterals[0];
            if (containsSensitiveValueInPlainText(literal.decodedText)) {
                redactionRanges.push({
                    end: literal.end - 1,
                    start: literal.start + 1,
                });
            }
        }
        else if (containsSensitiveValueInPlainText(runLiterals.map((literal) => literal.decodedText).join(""))) {
            redactionRanges.push({
                end: runLiterals[runLiterals.length - 1].end,
                start: runLiterals[0].start,
            });
        }
        runLiterals = [];
    };
    for (const match of sourcePath.matchAll(SOURCE_STRING_LITERAL_PATTERN)) {
        const decodedText = decodeSourceStringLiteral(match[0]);
        if (decodedText === undefined) {
            flushLiteralRun();
            previousEnd = undefined;
            continue;
        }
        const separator = previousEnd === undefined ? undefined : sourcePath.slice(previousEnd, match.index);
        if (runLiterals.length > 0 && separator !== undefined && isSourceLiteralConcatenationSeparator(separator)) {
            runLiterals.push({
                decodedText,
                end: match.index + match[0].length,
                start: match.index,
            });
        }
        else {
            flushLiteralRun();
            runLiterals.push({
                decodedText,
                end: match.index + match[0].length,
                start: match.index,
            });
        }
        previousEnd = match.index + match[0].length;
    }
    flushLiteralRun();
    return redactSensitiveBlockRanges(sourcePath, redactionRanges);
}
function containsSensitiveValueInPlainText(source) {
    return containsAccessTokenInPlainText(source)
        || containsNonGenericMachineHomePathInPlainText(source)
        || containsPrivateKeyBlockInPlainText(source);
}
function redactPrivateKeyBlocks(sourcePath) {
    return redactSensitiveBlockRanges(sourcePath, [
        ...collectPemPrivateKeyBlockRanges(sourcePath),
        ...collectOpenPgpPrivateKeyBlockRanges(sourcePath),
        ...collectPuttyPrivateKeyBlockRanges(sourcePath),
    ]);
}
function redactMachineHomePathSegments(sourcePath) {
    return redactWindowsMachineHomePathSegments(redactRootMachineHomePathSegments(redactPosixMachineHomePathSegments(sourcePath)));
}
function redactPosixMachineHomePathSegments(sourcePath) {
    let redactedPath = "";
    let startIndex = 0;
    const tokenRanges = buildSourceTokenRanges(sourcePath);
    for (const match of sourcePath.matchAll(POSIX_HOME_PATH_PATTERN)) {
        const directoryName = match[1];
        if (directoryName === undefined
            || isGenericHomeDirectoryMatch(sourcePath, match)
            || isFilesystemLikePosixHomeMatch(sourcePath, match, tokenRanges) === false) {
            continue;
        }
        const directoryStart = match.index + match[0].length - directoryName.length;
        redactedPath += `${sourcePath.slice(startIndex, directoryStart)}[REDACTED]`;
        startIndex = directoryStart + directoryName.length;
    }
    return `${redactedPath}${sourcePath.slice(startIndex)}`;
}
function redactWindowsMachineHomePathSegments(sourcePath) {
    let redactedPath = "";
    let startIndex = 0;
    const tokenRanges = buildSourceTokenRanges(sourcePath);
    for (const match of sourcePath.matchAll(WINDOWS_HOME_PATH_PATTERN)) {
        const directoryName = match[1];
        if (directoryName === undefined
            || isGenericHomeDirectoryMatch(sourcePath, match)
            || isFilesystemLikeMachineHomeMatch(sourcePath, match, tokenRanges) === false) {
            continue;
        }
        const directoryStart = match.index + match[0].length - directoryName.length;
        redactedPath += `${sourcePath.slice(startIndex, directoryStart)}[REDACTED]`;
        startIndex = directoryStart + directoryName.length;
    }
    return `${redactedPath}${sourcePath.slice(startIndex)}`;
}
function redactRootMachineHomePathSegments(sourcePath) {
    let redactedPath = "";
    let startIndex = 0;
    const tokenRanges = buildSourceTokenRanges(sourcePath);
    for (const match of sourcePath.matchAll(ROOT_HOME_PATH_PATTERN)) {
        if (isFilesystemLikeRootHomeMatch(sourcePath, match, tokenRanges) === false) {
            continue;
        }
        const directoryStart = match.index + 1;
        redactedPath += `${sourcePath.slice(startIndex, directoryStart)}[REDACTED]`;
        startIndex = match.index + match[0].length;
    }
    return `${redactedPath}${sourcePath.slice(startIndex)}`;
}
function swapUtf16ByteOrder(source) {
    const swapped = Buffer.alloc(source.length - (source.length % 2));
    for (let index = 0; index + 1 < source.length; index += 2) {
        swapped[index] = source[index + 1];
        swapped[index + 1] = source[index];
    }
    return swapped;
}
function decodeUtf32Text(source, byteOrder) {
    const codePoints = [];
    const sourceLength = source.length - (source.length % 4);
    let decoded = "";
    const flushCodePoints = () => {
        if (codePoints.length > 0) {
            decoded += String.fromCodePoint(...codePoints);
            codePoints.length = 0;
        }
    };
    for (let index = 0; index + 3 < sourceLength; index += 4) {
        const codePoint = byteOrder === "le"
            ? source[index] + (source[index + 1] * 0x100) + (source[index + 2] * 0x10000) + (source[index + 3] * 0x1000000)
            : source[index + 3] + (source[index + 2] * 0x100) + (source[index + 1] * 0x10000) + (source[index] * 0x1000000);
        if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
            codePoints.push(0xfffd);
            if (codePoints.length >= 4096) {
                flushCodePoints();
            }
            continue;
        }
        codePoints.push(codePoint);
        if (codePoints.length >= 4096) {
            flushCodePoints();
        }
    }
    flushCodePoints();
    return stripTextByteOrderMark(decoded);
}
function decodeUtf32TextAtByteOffset(source, byteOrder, byteOffset) {
    const offsetSource = source.subarray(byteOffset);
    if (offsetSource.length < 4) {
        return undefined;
    }
    const alignedLength = offsetSource.length - (offsetSource.length % 4);
    return decodeUtf32Text(offsetSource.subarray(0, alignedLength), byteOrder);
}
function decodeSingleByteSafeText(source) {
    if (source.includes(0)) {
        return stripTextByteOrderMark(decodeGitPathOutput(source).replace(/\0+/gu, "\n"));
    }
    return stripTextByteOrderMark(decodeGitPathOutput(source));
}
function findingsForSource(input) {
    const allowedRuleIds = input.ruleIds === undefined ? undefined : new Set(input.ruleIds);
    return PUBLIC_SAFETY_AUDIT_RULES
        .filter((rule) => allowedRuleIds === undefined || allowedRuleIds.has(rule.id))
        .filter((rule) => rule.matches(input.text))
        .map((rule) => ({
        ...(input.commit === undefined ? {} : { commit: input.commit }),
        ...(input.path === undefined ? {} : { path: input.path }),
        ruleId: rule.id,
        scope: input.scope,
        source: input.source,
    }));
}
function findingsForRuleIds(input) {
    return input.ruleIds.map((ruleId) => ({
        ...(input.commit === undefined ? {} : { commit: input.commit }),
        ...(input.path === undefined ? {} : { path: input.path }),
        ruleId,
        scope: input.scope,
        source: input.source,
    }));
}
function runGit(repoRoot, args) {
    try {
        return execFileSync("git", gitArgsWithAuditConfig(args), {
            cwd: repoRoot,
            encoding: "utf8",
            env: auditGitEnvironment(),
            maxBuffer: GIT_TEXT_MAX_BUFFER_BYTES,
            stdio: ["ignore", "pipe", "pipe"],
        });
    }
    catch {
        throw new Error("Public safety audit could not read the local Git history.");
    }
}
function runGitBuffer(repoRoot, args) {
    try {
        return execFileSync("git", gitArgsWithAuditConfig(args), {
            cwd: repoRoot,
            env: auditGitEnvironment(),
            maxBuffer: GIT_TEXT_MAX_BUFFER_BYTES,
            stdio: ["ignore", "pipe", "pipe"],
        });
    }
    catch {
        throw new Error("Public safety audit could not read the local Git history.");
    }
}
function writeGitCatFileTagToFile(repoRoot, objectId, outputPath) {
    let outputFd;
    try {
        outputFd = openSync(outputPath, "w");
        execFileSync("git", ["cat-file", "tag", objectId], {
            cwd: repoRoot,
            env: auditGitEnvironment(),
            stdio: ["ignore", outputFd, "pipe"],
        });
        closeSync(outputFd);
        outputFd = undefined;
    }
    catch {
        throw new Error("Public safety audit could not read the local Git history.");
    }
    finally {
        if (outputFd !== undefined) {
            closeSync(outputFd);
        }
    }
}
function scanGitOutputLines(repoRoot, args, onLine) {
    scanGitOutputFile(repoRoot, args, (outputPath) => {
        scanTextFileLines(outputPath, onLine);
    });
}
function scanGitOutputLineSegments(repoRoot, args, onSegment) {
    scanGitOutputFile(repoRoot, args, (outputPath) => {
        scanTextFileLineSegments(outputPath, onSegment);
    });
}
function scanGitOutputRecords(repoRoot, args, onRecord) {
    scanGitOutputFile(repoRoot, args, (outputPath) => {
        scanTextFileRecords(outputPath, onRecord);
    });
}
function scanGitOutputRecordSegments(repoRoot, args, onSegment) {
    scanGitOutputFile(repoRoot, args, (outputPath) => {
        scanTextFileRecordSegments(outputPath, onSegment);
    });
}
function scanGitOutputFile(repoRoot, args, scanOutput) {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "public-safety-audit-"));
    const outputPath = path.join(temporaryDirectory, "git-output.txt");
    let outputFd;
    try {
        outputFd = openSync(outputPath, "w");
        execFileSync("git", gitArgsWithAuditConfig(args), {
            cwd: repoRoot,
            env: auditGitEnvironment(),
            stdio: ["ignore", outputFd, "pipe"],
        });
        closeSync(outputFd);
        outputFd = undefined;
        scanOutput(outputPath);
    }
    catch {
        throw new Error("Public safety audit could not read the local Git history.");
    }
    finally {
        if (outputFd !== undefined) {
            closeSync(outputFd);
        }
        rmSync(temporaryDirectory, { force: true, recursive: true });
    }
}
function scanGitOutputFromInput(repoRoot, args, input, scanOutput) {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "public-safety-audit-"));
    const outputPath = path.join(temporaryDirectory, "git-output.txt");
    let outputFd;
    try {
        outputFd = openSync(outputPath, "w");
        execFileSync("git", gitArgsWithAuditConfig(args), {
            cwd: repoRoot,
            env: auditGitEnvironment(),
            input,
            stdio: ["pipe", outputFd, "pipe"],
        });
        closeSync(outputFd);
        outputFd = undefined;
        scanOutput(outputPath);
    }
    catch {
        throw new Error("Public safety audit could not read the local Git history.");
    }
    finally {
        if (outputFd !== undefined) {
            closeSync(outputFd);
        }
        rmSync(temporaryDirectory, { force: true, recursive: true });
    }
}
function gitArgsWithAuditConfig(args) {
    return args[0] === "log"
        ? ["-c", "i18n.logOutputEncoding=UTF-8", ...args]
        : args;
}
function auditGitEnvironment() {
    return {
        ...process.env,
        GIT_NO_REPLACE_OBJECTS: "1",
    };
}
function scanLargeDecodedAuditTextFile(filePath, createScanner) {
    const detection = detectLargeBlobTextEncoding(filePath);
    const encodings = detection.scanSingleByteFallback
        ? uniqueLargeBlobTextEncodings([...detection.encodings, "single-byte"])
        : detection.encodings;
    for (const encoding of encodings) {
        for (const input of largeBlobTextDecoderInputs(encoding, detection)) {
            if (scanLargeDecodedAuditTextFileWithEncoding(filePath, input, createScanner())) {
                return;
            }
        }
    }
}
function scanLargeDecodedAuditTextFileWithEncoding(filePath, input, scanner) {
    const buffer = Buffer.alloc(LARGE_BLOB_SCAN_CHUNK_BYTES);
    const fileDescriptor = openSync(filePath, "r");
    const decoder = createLargeBlobTextDecoder(input);
    let pending = "";
    try {
        let bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
        while (bytesRead > 0) {
            const chunk = Buffer.from(buffer.subarray(0, bytesRead));
            const decodedChunk = decoder.write(chunk);
            pending = boundedAuditTextWindow(pending, decodedChunk);
            if (scanner.write({ decodedChunk, sourceWindow: pending })) {
                return true;
            }
            bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
        }
        const decodedChunk = decoder.end();
        pending = boundedAuditTextWindow(pending, decodedChunk);
        if (scanner.write({ decodedChunk, sourceWindow: pending })) {
            return true;
        }
        return scanner.end(pending);
    }
    finally {
        closeSync(fileDescriptor);
    }
}
function detectLargeBlobTextEncoding(filePath) {
    const buffer = Buffer.alloc(LARGE_BLOB_SCAN_CHUNK_BYTES);
    const fileDescriptor = openSync(filePath, "r");
    let sawUtf16Be = false;
    let sawUtf16Le = false;
    let sawUtf32Be = false;
    let sawUtf32Le = false;
    try {
        let bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
        let isFirstChunk = true;
        while (bytesRead > 0) {
            const chunk = Buffer.from(buffer.subarray(0, bytesRead));
            if (isFirstChunk) {
                if (chunk.length >= 4 && chunk[0] === 0xff && chunk[1] === 0xfe && chunk[2] === 0 && chunk[3] === 0) {
                    return {
                        encodings: ["utf32le", "utf32be"],
                        hasBom: true,
                        scanSingleByteFallback: true,
                    };
                }
                if (chunk.length >= 4 && chunk[0] === 0 && chunk[1] === 0 && chunk[2] === 0xfe && chunk[3] === 0xff) {
                    return {
                        encodings: ["utf32be", "utf32le"],
                        hasBom: true,
                        scanSingleByteFallback: true,
                    };
                }
                if (chunk.length >= 2 && chunk[0] === 0xff && chunk[1] === 0xfe) {
                    return {
                        encodings: ["utf16le", "utf16be"],
                        hasBom: true,
                        scanSingleByteFallback: true,
                    };
                }
                if (chunk.length >= 2 && chunk[0] === 0xfe && chunk[1] === 0xff) {
                    return {
                        encodings: ["utf16be", "utf16le"],
                        hasBom: true,
                        scanSingleByteFallback: true,
                    };
                }
                isFirstChunk = false;
            }
            sawUtf32Le ||= looksLikeUtf32Le(chunk);
            sawUtf32Be ||= looksLikeUtf32Be(chunk);
            sawUtf16Le ||= looksLikeUtf16Le(chunk);
            sawUtf16Be ||= looksLikeUtf16Be(chunk);
            bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
        }
    }
    finally {
        closeSync(fileDescriptor);
    }
    if (sawUtf32Le && sawUtf32Be) {
        return {
            encodings: ["utf32le", "utf32be"],
            hasBom: false,
            scanSingleByteFallback: true,
        };
    }
    if (sawUtf32Le) {
        return {
            encodings: ["utf32le", "utf32be"],
            hasBom: false,
            scanSingleByteFallback: true,
        };
    }
    if (sawUtf32Be) {
        return {
            encodings: ["utf32be", "utf32le"],
            hasBom: false,
            scanSingleByteFallback: true,
        };
    }
    if (sawUtf16Le && sawUtf16Be) {
        return {
            encodings: ["utf16le", "utf16be"],
            hasBom: false,
            scanSingleByteFallback: true,
        };
    }
    if (sawUtf16Le) {
        return {
            encodings: ["utf16le"],
            hasBom: false,
            scanSingleByteFallback: true,
        };
    }
    if (sawUtf16Be) {
        return {
            encodings: ["utf16be"],
            hasBom: false,
            scanSingleByteFallback: true,
        };
    }
    return {
        encodings: ["single-byte"],
        hasBom: false,
        scanSingleByteFallback: false,
    };
}
function uniqueLargeBlobTextEncodings(encodings) {
    const uniqueEncodings = [];
    encodings.forEach((encoding) => {
        if (uniqueEncodings.includes(encoding) === false) {
            uniqueEncodings.push(encoding);
        }
    });
    return uniqueEncodings;
}
function largeBlobTextDecoderInputs(encoding, detection) {
    if (encoding === "utf16be") {
        return [
            { byteOffset: 0, encoding },
            { byteOffset: 1, encoding: detection.hasBom ? "utf16be" : "utf16le" },
        ];
    }
    if (encoding === "utf16le") {
        return [
            { byteOffset: 0, encoding },
            { byteOffset: 1, encoding: detection.hasBom ? "utf16le" : "utf16be" },
        ];
    }
    if (encoding === "utf32be" || encoding === "utf32le") {
        if (detection.hasBom) {
            return [0, 1, 2, 3].map((alignmentOffset) => ({
                byteOffset: 4 + alignmentOffset,
                encoding,
            }));
        }
        return [0, 1, 2, 3].map((alignmentOffset) => ({
            byteOffset: alignmentOffset,
            encoding,
        }));
    }
    return [{ byteOffset: 0, encoding }];
}
function createLargeBlobTextDecoder(input) {
    switch (input.encoding) {
        case "single-byte":
            return createLargeSingleByteTextDecoder();
        case "utf16be":
            return createLargeUtf16TextDecoder("be", input.byteOffset);
        case "utf16le":
            return createLargeUtf16TextDecoder("le", input.byteOffset);
        case "utf32be":
            return createLargeUtf32TextDecoder("be", input.byteOffset);
        case "utf32le":
            return createLargeUtf32TextDecoder("le", input.byteOffset);
    }
}
function createLargeSingleByteTextDecoder() {
    const decoder = new StringDecoder("utf8");
    return {
        end: () => decoder.end().replace(/\0+/gu, "\n"),
        write: (chunk) => decoder.write(chunk).replace(/\0+/gu, "\n"),
    };
}
function createLargeUtf16TextDecoder(byteOrder, byteOffset) {
    let pending = Buffer.alloc(0);
    let stripBom = true;
    let remainingByteOffset = byteOffset;
    const decodeChunk = (chunk) => {
        const offsetChunk = remainingByteOffset === 0
            ? chunk
            : chunk.subarray(Math.min(remainingByteOffset, chunk.length));
        remainingByteOffset = Math.max(remainingByteOffset - chunk.length, 0);
        const source = pending.length === 0 ? offsetChunk : Buffer.concat([pending, offsetChunk]);
        const alignedLength = source.length - (source.length % 2);
        pending = Buffer.from(source.subarray(alignedLength));
        const aligned = source.subarray(0, alignedLength);
        const decoded = byteOrder === "le"
            ? aligned.toString("utf16le")
            : swapUtf16ByteOrder(aligned).toString("utf16le");
        if (stripBom) {
            stripBom = false;
            return stripTextByteOrderMark(decoded);
        }
        return decoded;
    };
    return {
        end: () => decodeChunk(Buffer.alloc(0)),
        write: decodeChunk,
    };
}
function createLargeUtf32TextDecoder(byteOrder, byteOffset) {
    let pending = Buffer.alloc(0);
    let remainingByteOffset = byteOffset;
    const decodeChunk = (chunk) => {
        const offsetChunk = remainingByteOffset === 0
            ? chunk
            : chunk.subarray(Math.min(remainingByteOffset, chunk.length));
        remainingByteOffset = Math.max(remainingByteOffset - chunk.length, 0);
        const source = pending.length === 0 ? offsetChunk : Buffer.concat([pending, offsetChunk]);
        const alignedLength = source.length - (source.length % 4);
        pending = Buffer.from(source.subarray(alignedLength));
        return decodeUtf32Text(source.subarray(0, alignedLength), byteOrder) ?? "";
    };
    return {
        end: () => "",
        write: decodeChunk,
    };
}
function boundedAuditTextWindow(previous, next) {
    const source = `${previous}${next}`;
    return source.length <= LARGE_BLOB_SCAN_OVERLAP_CHARACTERS
        ? source
        : source.slice(source.length - LARGE_BLOB_SCAN_OVERLAP_CHARACTERS);
}
function scanTextFileLines(filePath, onLine) {
    const buffer = Buffer.alloc(64 * 1024);
    const decoder = new StringDecoder("utf8");
    const fileDescriptor = openSync(filePath, "r");
    let pending = "";
    try {
        let bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
        while (bytesRead > 0) {
            pending += decoder.write(buffer.subarray(0, bytesRead));
            const lines = pending.split(/\r?\n/u);
            pending = lines.pop() ?? "";
            lines.forEach((line) => {
                onLine(line);
            });
            bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
        }
        pending += decoder.end();
        if (pending.length > 0) {
            onLine(pending);
        }
    }
    finally {
        closeSync(fileDescriptor);
    }
}
function scanTextFileLineSegments(filePath, onSegment) {
    const buffer = Buffer.alloc(64 * 1024);
    const decoder = new StringDecoder("utf8");
    const fileDescriptor = openSync(filePath, "r");
    let pending = "";
    let startsLine = true;
    const emitSegment = (text, endsLine) => {
        onSegment({
            endsLine,
            startsLine,
            text,
        });
        startsLine = endsLine;
    };
    const emitLineText = (lineText, endsLine) => {
        if (lineText.length === 0 && endsLine) {
            emitSegment("", true);
            return;
        }
        let start = 0;
        while (start < lineText.length) {
            const end = Math.min(start + TEXT_FILE_LINE_SEGMENT_MAX_CHARACTERS, lineText.length);
            emitSegment(lineText.slice(start, end), endsLine && end === lineText.length);
            start = end;
        }
    };
    const drainCompleteLines = () => {
        let start = 0;
        for (const match of pending.matchAll(/\r?\n/gu)) {
            emitLineText(pending.slice(start, match.index), true);
            start = match.index + match[0].length;
        }
        pending = pending.slice(start);
    };
    const drainOversizedPending = () => {
        while (pending.length > TEXT_FILE_LINE_SEGMENT_MAX_CHARACTERS) {
            emitSegment(pending.slice(0, TEXT_FILE_LINE_SEGMENT_MAX_CHARACTERS), false);
            pending = pending.slice(TEXT_FILE_LINE_SEGMENT_MAX_CHARACTERS);
        }
    };
    try {
        let bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
        while (bytesRead > 0) {
            pending += decoder.write(buffer.subarray(0, bytesRead));
            drainCompleteLines();
            drainOversizedPending();
            bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
        }
        pending += decoder.end();
        drainCompleteLines();
        if (pending.length > 0) {
            emitLineText(pending, true);
        }
    }
    finally {
        closeSync(fileDescriptor);
    }
}
function scanTextFileRecords(filePath, onRecord) {
    const buffer = Buffer.alloc(64 * 1024);
    const fileDescriptor = openSync(filePath, "r");
    let pending = Buffer.alloc(0);
    try {
        let bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
        while (bytesRead > 0) {
            const chunk = pending.length === 0
                ? Buffer.from(buffer.subarray(0, bytesRead))
                : Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
            let recordStart = 0;
            let recordEnd = chunk.indexOf(0, recordStart);
            while (recordEnd >= 0) {
                onRecord(decodeGitPathOutput(chunk.subarray(recordStart, recordEnd)));
                recordStart = recordEnd + 1;
                recordEnd = chunk.indexOf(0, recordStart);
            }
            pending = Buffer.from(chunk.subarray(recordStart));
            bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
        }
        if (pending.length > 0) {
            onRecord(decodeGitPathOutput(pending));
        }
    }
    finally {
        closeSync(fileDescriptor);
    }
}
function scanTextFileRecordSegments(filePath, onSegment) {
    const buffer = Buffer.alloc(64 * 1024);
    const decoder = new StringDecoder("utf8");
    const fileDescriptor = openSync(filePath, "r");
    let pending = "";
    let recordIndex = 0;
    const emitSegment = (text, endsRecord) => {
        onSegment({
            endsRecord,
            index: recordIndex,
            text,
        });
        if (endsRecord) {
            recordIndex += 1;
        }
    };
    const drainCompleteRecords = () => {
        let recordEnd = pending.indexOf("\0");
        while (recordEnd >= 0) {
            emitSegment(pending.slice(0, recordEnd), true);
            pending = pending.slice(recordEnd + 1);
            recordEnd = pending.indexOf("\0");
        }
    };
    const drainOversizedPending = () => {
        while (pending.length > TEXT_FILE_LINE_SEGMENT_MAX_CHARACTERS) {
            emitSegment(pending.slice(0, TEXT_FILE_LINE_SEGMENT_MAX_CHARACTERS), false);
            pending = pending.slice(TEXT_FILE_LINE_SEGMENT_MAX_CHARACTERS);
        }
    };
    try {
        let bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
        while (bytesRead > 0) {
            pending += decoder.write(buffer.subarray(0, bytesRead));
            drainCompleteRecords();
            drainOversizedPending();
            bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null);
        }
        pending += decoder.end();
        drainCompleteRecords();
        if (pending.length > 0) {
            emitSegment(pending, true);
        }
    }
    finally {
        closeSync(fileDescriptor);
    }
}
function createBufferedFileReader(filePath) {
    return {
        buffer: Buffer.alloc(64 * 1024),
        fileDescriptor: openSync(filePath, "r"),
        length: 0,
        offset: 0,
    };
}
function fillBufferedReader(reader) {
    if (reader.offset < reader.length) {
        return true;
    }
    reader.length = readSync(reader.fileDescriptor, reader.buffer, 0, reader.buffer.length, null);
    reader.offset = 0;
    return reader.length > 0;
}
function readBufferedByte(reader) {
    if (fillBufferedReader(reader) === false) {
        return undefined;
    }
    const value = reader.buffer[reader.offset];
    reader.offset += 1;
    return value;
}
function readBufferedBytes(reader, byteCount) {
    const output = Buffer.alloc(byteCount);
    let outputOffset = 0;
    while (outputOffset < byteCount) {
        if (fillBufferedReader(reader) === false) {
            throw new Error("Public safety audit could not read the local Git history.");
        }
        const chunkLength = Math.min(byteCount - outputOffset, reader.length - reader.offset);
        reader.buffer.copy(output, outputOffset, reader.offset, reader.offset + chunkLength);
        reader.offset += chunkLength;
        outputOffset += chunkLength;
    }
    return output;
}
function readBufferedBytesToFile(reader, byteCount, outputFd) {
    let remaining = byteCount;
    while (remaining > 0) {
        if (fillBufferedReader(reader) === false) {
            throw new Error("Public safety audit could not read the local Git history.");
        }
        const chunkLength = Math.min(remaining, reader.length - reader.offset);
        writeSync(outputFd, reader.buffer, reader.offset, chunkLength);
        reader.offset += chunkLength;
        remaining -= chunkLength;
    }
}
function skipBufferedBytes(reader, byteCount) {
    let remaining = byteCount;
    while (remaining > 0) {
        if (fillBufferedReader(reader) === false) {
            throw new Error("Public safety audit could not read the local Git history.");
        }
        const chunkLength = Math.min(remaining, reader.length - reader.offset);
        reader.offset += chunkLength;
        remaining -= chunkLength;
    }
}
function writeBufferedRemainderToFile(reader, outputFd) {
    if (reader.offset < reader.length) {
        writeSync(outputFd, reader.buffer, reader.offset, reader.length - reader.offset);
        reader.offset = reader.length;
    }
    const buffer = Buffer.alloc(64 * 1024);
    let bytesRead = readSync(reader.fileDescriptor, buffer, 0, buffer.length, null);
    while (bytesRead > 0) {
        writeSync(outputFd, buffer, 0, bytesRead);
        bytesRead = readSync(reader.fileDescriptor, buffer, 0, buffer.length, null);
    }
}
function readBufferedLine(reader) {
    const chunks = [];
    while (true) {
        if (fillBufferedReader(reader) === false) {
            return chunks.length === 0 ? undefined : Buffer.concat(chunks);
        }
        const lineEnd = reader.buffer.indexOf(0x0a, reader.offset);
        const chunkEnd = lineEnd >= 0 && lineEnd < reader.length ? lineEnd : reader.length;
        if (chunkEnd > reader.offset) {
            chunks.push(Buffer.from(reader.buffer.subarray(reader.offset, chunkEnd)));
        }
        reader.offset = chunkEnd;
        if (lineEnd >= 0 && lineEnd < reader.length) {
            reader.offset += 1;
            return Buffer.concat(chunks);
        }
    }
}
function readBufferedLineSegment(reader, maxByteCount) {
    const chunks = [];
    let byteCount = 0;
    while (byteCount < maxByteCount) {
        if (fillBufferedReader(reader) === false) {
            return byteCount === 0 ? undefined : {
                buffer: Buffer.concat(chunks, byteCount),
                endsLine: false,
            };
        }
        const lineEnd = reader.buffer.indexOf(0x0a, reader.offset);
        const lineEndInBuffer = lineEnd >= 0 && lineEnd < reader.length;
        const chunkLimit = Math.min(lineEndInBuffer ? lineEnd : reader.length, reader.offset + maxByteCount - byteCount);
        if (chunkLimit > reader.offset) {
            const chunk = reader.buffer.subarray(reader.offset, chunkLimit);
            chunks.push(Buffer.from(chunk));
            byteCount += chunk.length;
        }
        reader.offset = chunkLimit;
        if (lineEndInBuffer && reader.offset === lineEnd) {
            reader.offset += 1;
            return {
                buffer: Buffer.concat(chunks, byteCount),
                endsLine: true,
            };
        }
    }
    return {
        buffer: Buffer.concat(chunks, byteCount),
        endsLine: false,
    };
}
function uniqueSortedFindings(findings) {
    const byKey = new Map();
    findings.forEach((finding) => {
        const key = [
            finding.commit ?? "",
            finding.path ?? "",
            finding.ruleId,
            finding.scope,
            finding.source,
        ].join("\0");
        byKey.set(key, finding);
    });
    return [...byKey.values()].sort((left, right) => {
        const leftKey = [left.commit ?? "", left.path ?? "", left.ruleId, left.scope, left.source].join("\0");
        const rightKey = [right.commit ?? "", right.path ?? "", right.ruleId, right.scope, right.source].join("\0");
        return leftKey.localeCompare(rightKey);
    });
}
function uniqueHistoricalBlobEntries(entries) {
    const byKey = new Map();
    entries.forEach((entry) => {
        const key = [entry.objectId, entry.path].join("\0");
        if (byKey.has(key) === false) {
            byKey.set(key, entry);
        }
    });
    return [...byKey.values()].sort((left, right) => {
        const leftKey = [left.path, left.objectId, left.commit].join("\0");
        const rightKey = [right.path, right.objectId, right.commit].join("\0");
        return leftKey.localeCompare(rightKey);
    });
}
function uniqueTrackedEntries(entries) {
    const byKey = new Map();
    entries.forEach((entry) => {
        byKey.set([entry.mode, entry.objectId, entry.path, entry.type].join("\0"), entry);
    });
    return [...byKey.values()].sort((left, right) => {
        const leftKey = [left.path, left.mode, left.objectId, left.type].join("\0");
        const rightKey = [right.path, right.mode, right.objectId, right.type].join("\0");
        return leftKey.localeCompare(rightKey);
    });
}
