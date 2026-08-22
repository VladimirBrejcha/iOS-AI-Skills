#!/usr/bin/env ruby
# frozen_string_literal: true

require "open3"
require "set"

RULES = [
  [
    "machine-local home path",
    %r{
      (?:\A|[\s"'`>:(,]|(?<![A-Za-z0-9+.-])file://)
      (?:(?:[A-Za-z_][A-Za-z0-9_.-]*|--?[A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*)?
      (?:
        (?:/|\\/)
        (?:
          (?:Users|home)(?:/|\\/)[A-Za-z0-9._\x80-\xFF-]+(?:(?:/|\\/)|(?=[<>"'\s,;:)\]\}]|\z))
          |
          root(?:(?:/|\\/)|(?![A-Za-z0-9._-]))
          |
          (?:private(?:/|\\/))?var(?:/|\\/)root(?:(?:/|\\/)|(?![A-Za-z0-9._-]))
        )
        |
        [A-Za-z]:[\\/]{1,2}(?i:Users)[\\/]{1,2}[A-Za-z0-9._\x80-\xFF-]+(?:[\\/]{1,2}|(?=[<>"'\s,;:)\]\}]|\z))
      )
    }xn
  ],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  [
    "AWS secret access key",
    /(?<![A-Za-z0-9_])(?<aws_quote>["']?)aws_secret_access_key\k<aws_quote>(?![A-Za-z0-9_])\s*(?:=|:)\s*["']?[A-Za-z0-9\/=+]{40}(?=["'\s\r\n,}\]]|\z)/i
  ],
  [
    "bearer credential",
    /(?<![A-Za-z0-9_.-])(?<authorization_quote>["']?)Authorization\k<authorization_quote>(?![A-Za-z0-9_.-])\s*(?::|=>)\s*["']?Bearer\s+[A-Za-z0-9._~+\/=:-]{16,}/i
  ],
  [
    "GitHub token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/
  ],
  ["OpenAI API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  [
    "private key",
    /-----BEGIN (?:[A-Z0-9][A-Z0-9 ]* )?PRIVATE KEY(?: BLOCK)?-----/
  ],
  ["private key", /\APuTTY-User-Key-File-[23]:/]
].freeze

INDEX_BLOB_MODES = %w[100644 100755 120000].freeze
LFS_POINTER = %r{\Aversion https://git-lfs\.github\.com/spec/v1(?:\r?\n|\z)}.freeze
UTF16_BOMS = ["\xFF\xFE".b, "\xFE\xFF".b].freeze
GIT_ENVIRONMENT = {
  "GIT_ALTERNATE_OBJECT_DIRECTORIES" => nil,
  "GIT_COMMON_DIR" => nil,
  "GIT_DIR" => nil,
  "GIT_INDEX_FILE" => nil,
  "GIT_NO_LAZY_FETCH" => "1",
  "GIT_NO_REPLACE_OBJECTS" => "1",
  "GIT_OBJECT_DIRECTORY" => nil,
  "GIT_OPTIONAL_LOCKS" => "0",
  "GIT_TRACE" => nil,
  "GIT_TRACE2" => nil,
  "GIT_TRACE2_EVENT" => nil,
  "GIT_TRACE2_PERF" => nil,
  "GIT_TRACE_CURL" => nil,
  "GIT_TRACE_PACK_ACCESS" => nil,
  "GIT_TRACE_PACKET" => nil,
  "GIT_TRACE_PERFORMANCE" => nil,
  "GIT_TRACE_SETUP" => nil,
  "GIT_TRACE_SHALLOW" => nil,
  "GIT_WORK_TREE" => nil
}.freeze

def usage(message = nil)
  warn message if message
  warn "Usage: check_current_source.rb [repository]"
  exit 64
end

def git_command(repo, *arguments)
  [
    "git",
    "-C",
    repo,
    "-c",
    "core.fsmonitor=false",
    *arguments
  ]
end

def git_capture(repo, *arguments)
  Open3.capture3(GIT_ENVIRONMENT, *git_command(repo, *arguments))
end

def read_blob_results(repo, object_ids)
  return [{}, true] if object_ids.empty?

  results = {}
  protocol_failed = false
  Open3.popen3(
    GIT_ENVIRONMENT,
    *git_command(repo, "cat-file", "--batch")
  ) do |input, output, error, wait_thread|
    input.binmode
    output.binmode
    error_reader = Thread.new { error.read }

    begin
      object_ids.each do |object_id|
        input.write(object_id)
        input.write("\n")
        input.flush

        header = output.gets
        unless header
          protocol_failed = true
          break
        end

        fields = header.delete_suffix("\n".b).split(" ".b)
        if fields.length == 2 && fields[0] == object_id && fields[1] == "missing".b
          next
        end

        returned_id, type, size_text = fields
        size = begin
          Integer(size_text, 10)
        rescue ArgumentError, TypeError
          nil
        end
        unless fields.length == 3 && returned_id == object_id && size && size >= 0
          protocol_failed = true
          break
        end

        content = output.read(size)
        terminator = output.read(1)
        unless content&.bytesize == size && terminator == "\n".b
          protocol_failed = true
          break
        end
        next unless type == "blob".b

        results[object_id] = {
          labels: matching_labels(content),
          lfs_pointer: LFS_POINTER.match?(content.b),
          utf16_bom: utf16_bom?(content)
        }
      end
    rescue IOError, SystemCallError
      protocol_failed = true
    ensure
      input.close unless input.closed?
      output.close if protocol_failed && !output.closed?
    end

    error_reader.value
    protocol_failed = true unless wait_thread.value.success?
  end

  [results, !protocol_failed]
end

def matching_labels(content)
  source = content.b
  RULES.filter_map { |label, pattern| label if pattern.match?(source) }
end

def utf16_bom?(content)
  source = content.b
  UTF16_BOMS.any? { |bom| source.start_with?(bom) }
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

def symlinked_parent?(repo, relative_path)
  current = repo.b
  relative_path.b.split("/".b)[0...-1].any? do |component|
    current = File.join(current, component)
    File.symlink?(current)
  end
end

usage("Too many arguments") if ARGV.length > 1
repo = File.expand_path(ARGV.first || ".")
usage("Repository must be a directory") unless File.directory?(repo)

toplevel_output, _toplevel_error, toplevel_status = git_capture(
  repo,
  "rev-parse",
  "--show-toplevel"
)
usage("Repository must be a Git worktree") unless toplevel_status.success?
repo = toplevel_output.b.sub(/\r?\n\z/, "".b)
usage("Unable to resolve Git worktree root") unless File.directory?(repo)

index_output, _index_error, index_status = git_capture(
  repo,
  "ls-files",
  "--stage",
  "-z"
)
usage("Unable to enumerate Git index") unless index_status.success?

errors = Set.new
findings = Set.new
sensitive_paths = Set.new
index_entries = index_output.b.split("\0".b).reject(&:empty?).filter_map do |record|
  metadata, relative_path = record.split("\t".b, 2)
  mode, object_id, stage = metadata&.split(" ".b, 3)
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

blob_paths = Hash.new { |paths, object_id| paths[object_id] = [] }
submodule_paths = Set.new
index_entries.each do |entry|
  relative_path = entry.fetch(:path)
  scan_source(relative_path, relative_path, findings, sensitive_paths)
  if entry.fetch(:mode) == "160000"
    submodule_paths.add(relative_path)
    next
  end

  unless INDEX_BLOB_MODES.include?(entry.fetch(:mode))
    errors.add([relative_path, "unsupported Git index mode"])
    next
  end

  blob_paths[entry.fetch(:object_id)] << relative_path
end

blob_results, blob_reader_success = read_blob_results(repo, blob_paths.keys)
unless blob_reader_success
  errors.add(["<repository>", "Git index blob reader failed"])
end
blob_paths.each do |object_id, relative_paths|
  result = blob_results[object_id]
  relative_paths.each do |relative_path|
    unless result
      errors.add([relative_path, "unable to read Git index blob"])
      next
    end
    if result.fetch(:lfs_pointer)
      errors.add([relative_path, "Git LFS object requires separate review"])
    end
    if result.fetch(:utf16_bom)
      errors.add([relative_path, "BOM-marked UTF-16 source requires separate review"])
    end
    record_findings(result.fetch(:labels), relative_path, findings)
  end
end

worktree_output, _worktree_error, worktree_status = git_capture(
  repo,
  "ls-files",
  "-co",
  "--exclude-standard",
  "-z"
)
usage("Unable to enumerate repository worktree source") unless worktree_status.success?

worktree_paths = worktree_output.b.split("\0".b).reject(&:empty?).uniq
worktree_paths.each do |relative_path|
  scan_source(relative_path, relative_path, findings, sensitive_paths)
  next if submodule_paths.include?(relative_path)

  begin
    if symlinked_parent?(repo, relative_path)
      errors.add([relative_path, "symlinked parent component"])
      next
    end
    absolute_path = File.join(repo.b, relative_path)
    stat = File.lstat(absolute_path)
    content = if stat.symlink?
      File.readlink(absolute_path)
    elsif stat.file?
      File.binread(absolute_path)
    else
      errors.add([relative_path, "unsupported worktree source type"])
      next
    end
    if content
      if LFS_POINTER.match?(content.b)
        errors.add([relative_path, "Git LFS object requires separate review"])
      end
      if utf16_bom?(content)
        errors.add([relative_path, "BOM-marked UTF-16 source requires separate review"])
      end
      scan_source(content, relative_path, findings)
    end
  rescue Errno::ENOENT
    next
  rescue SystemCallError
    errors.add([relative_path, "unable to read worktree source"])
  end
end

unless errors.empty? && findings.empty?
  warn "current public-source check failed:"
  errors.to_a.sort_by { |relative_path, label| [relative_path.b, label] }.each do |relative_path, label|
    warn "- #{display_path(relative_path, sensitive_paths)}: #{label}"
  end
  findings.to_a.sort_by { |relative_path, label| [relative_path.b, label] }.each do |relative_path, label|
    warn "- #{display_path(relative_path, sensitive_paths)}: #{label}"
  end
  warn "Matched content is intentionally omitted." unless findings.empty?
  exit 1
end

puts "current public-source check passed"
