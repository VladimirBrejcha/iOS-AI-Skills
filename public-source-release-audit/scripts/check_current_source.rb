#!/usr/bin/env ruby
# frozen_string_literal: true

require "open3"
require "set"

RULES = [
  [
    "machine-local home path",
    %r{(?:\A|[\s"'`=:(,])(?:/(?:Users|home)/[A-Za-z0-9._-]+(?:/|\b)|/root(?:/|(?![A-Za-z0-9._-])))|\b[A-Za-z]:[\\/]Users[\\/][^\\/\r\n]+(?:[\\/]|$)}
  ],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["bearer credential", /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+\/=:-]{16,}/i],
  [
    "GitHub token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/
  ],
  ["OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  [
    "private key",
    /-----BEGIN (?:[A-Z0-9][A-Z0-9 ]* )?PRIVATE KEY-----/
  ]
].freeze

INDEX_BLOB_MODES = %w[100644 100755 120000].freeze
LFS_POINTER = %r{\Aversion https://git-lfs\.github\.com/spec/v1(?:\r?\n|\z)}.freeze
GIT_ENVIRONMENT = {
  "GIT_ALTERNATE_OBJECT_DIRECTORIES" => nil,
  "GIT_COMMON_DIR" => nil,
  "GIT_DIR" => nil,
  "GIT_INDEX_FILE" => nil,
  "GIT_NO_LAZY_FETCH" => "1",
  "GIT_NO_REPLACE_OBJECTS" => "1",
  "GIT_OBJECT_DIRECTORY" => nil,
  "GIT_WORK_TREE" => nil
}.freeze

def usage(message = nil)
  warn message if message
  warn "Usage: check_current_source.rb [repository]"
  exit 64
end

def git_capture(repo, *arguments)
  Open3.capture3(GIT_ENVIRONMENT, "git", "-C", repo, *arguments)
end

def matching_labels(content)
  source = content.b
  RULES.filter_map { |label, pattern| label if pattern.match?(source) }
end

def record_findings(labels, relative_path, findings, sensitive_paths = nil)
  labels.each do |label|
    findings.add([relative_path, label])
    sensitive_paths&.add(relative_path)
  end
end

def scan_source(content, relative_path, findings, sensitive_paths = nil)
  record_findings(
    matching_labels(content),
    relative_path,
    findings,
    sensitive_paths
  )
end

def display_path(relative_path, sensitive_paths)
  sensitive_paths.include?(relative_path) ? "<redacted path>" : relative_path.dump
end

usage("Too many arguments") if ARGV.length > 1
repo = File.expand_path(ARGV.first || ".")
usage("Repository must be a directory") unless File.directory?(repo)

index_output, _index_error, index_status = git_capture(
  repo,
  "ls-files",
  "--stage",
  "-z"
)
usage("Repository must be a Git worktree") unless index_status.success?

errors = Set.new
findings = Set.new
sensitive_paths = Set.new
blob_result_cache = {}
index_entries = index_output.split("\0").reject(&:empty?).filter_map do |record|
  metadata, relative_path = record.split("\t", 2)
  mode, object_id, stage = metadata&.split(" ", 3)
  unless mode && object_id && stage && relative_path
    errors.add([relative_path || "<unknown>", "unreadable Git index entry"])
    next
  end

  if stage != "0"
    errors.add([relative_path, "unresolved Git index entry"])
    next
  end

  { mode: mode, object_id: object_id, path: relative_path }
end

index_entries.each do |entry|
  relative_path = entry.fetch(:path)
  scan_source(relative_path, relative_path, findings, sensitive_paths)
  next if entry.fetch(:mode) == "160000"

  unless INDEX_BLOB_MODES.include?(entry.fetch(:mode))
    errors.add([relative_path, "unsupported Git index mode"])
    next
  end

  object_id = entry.fetch(:object_id)
  result = blob_result_cache[object_id]
  unless result
    content, _blob_error, blob_status = git_capture(
      repo,
      "cat-file",
      "blob",
      object_id
    )
    unless blob_status.success?
      errors.add([relative_path, "unable to read Git index blob"])
      next
    end
    result = {
      labels: matching_labels(content),
      lfs_pointer: LFS_POINTER.match?(content.b)
    }
    blob_result_cache[object_id] = result
  end
  if result.fetch(:lfs_pointer)
    errors.add([relative_path, "Git LFS object requires separate review"])
  end
  record_findings(result.fetch(:labels), relative_path, findings)
end

worktree_output, _worktree_error, worktree_status = git_capture(
  repo,
  "ls-files",
  "-co",
  "--exclude-standard",
  "-z"
)
usage("Unable to enumerate repository worktree source") unless worktree_status.success?

worktree_paths = worktree_output.split("\0").reject(&:empty?).uniq
worktree_paths.each do |relative_path|
  absolute_path = File.join(repo, relative_path)
  scan_source(relative_path, relative_path, findings, sensitive_paths)
  begin
    content = if File.symlink?(absolute_path)
      File.readlink(absolute_path)
    elsif File.file?(absolute_path)
      File.binread(absolute_path)
    end
    scan_source(content, relative_path, findings) if content
  rescue SystemCallError
    errors.add([relative_path, "unable to read worktree source"])
  end
end

unless errors.empty? && findings.empty?
  warn "current public-source check failed:"
  errors.to_a.sort.each do |relative_path, label|
    warn "- #{display_path(relative_path, sensitive_paths)}: #{label}"
  end
  findings.to_a.sort.each do |relative_path, label|
    warn "- #{display_path(relative_path, sensitive_paths)}: #{label}"
  end
  warn "Matched content is intentionally omitted." unless findings.empty?
  exit 1
end

puts "current public-source check passed"
