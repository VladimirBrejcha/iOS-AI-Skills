#!/usr/bin/env ruby
# frozen_string_literal: true

require "open3"
require "yaml"

SOURCE_ROOT = File.expand_path("..", __dir__)
BOOTSTRAP_PATH = File.join(SOURCE_ROOT, "bootstrap.sh")
PROJECT_SKILL_ROOTS = %w[
  .agent/skills
  .agents/skills
  .claude/skills
  .codex/skills
  .cursor/skills
  .opencode/skills
  skills/codex
].freeze

def fail_usage(message)
  warn message
  warn "Usage: scripts/check_project_skill_ownership.rb <project-repo> [...]"
  exit 64
end

def parse_bootstrap_array(source, name)
  match = source.match(/^#{Regexp.escape(name)}=\(\n([\s\S]*?)^\)/)
  raise "bootstrap.sh is missing #{name}" unless match

  match[1].lines.map(&:strip).reject { |line| line.empty? || line.start_with?("#") }
end

def read_skill_name(content, label)
  lines = content.lines(chomp: true)
  raise "missing YAML front matter" unless lines.first == "---"

  closing_offset = lines[1..]&.index("---")
  raise "unterminated YAML front matter" unless closing_offset

  metadata = YAML.safe_load(
    lines[1, closing_offset].join("\n"),
    aliases: false,
    filename: label
  )
  raise "front matter must be a mapping" unless metadata.is_a?(Hash)

  name = metadata["name"]
  raise "missing name" unless name.is_a?(String) && !name.strip.empty?

  name
rescue Psych::SyntaxError => error
  raise "invalid YAML front matter: #{error.problem}"
end

fail_usage("At least one project repository is required") if ARGV.empty?

bootstrap = File.read(BOOTSTRAP_PATH)
managed_names = (
  parse_bootstrap_array(bootstrap, "owned_skills") +
  parse_bootstrap_array(bootstrap, "standalone_skills") +
  parse_bootstrap_array(bootstrap, "asc_skills")
).freeze

unless managed_names.length == managed_names.uniq.length
  raise "bootstrap.sh contains duplicate managed skill names"
end

all_errors = []

ARGV.each do |argument|
  repo = File.expand_path(argument)
  fail_usage("Not a directory: #{argument}") unless File.directory?(repo)

  output, status = Open3.capture2e("git", "-C", repo, "ls-files", "--stage", "-z")
  fail_usage("Not a Git worktree: #{argument}") unless status.success?

  repo_label = File.basename(repo)
  names_to_paths = Hash.new { |hash, key| hash[key] = [] }
  index_entries = output.split("\0").reject(&:empty?).map do |record|
    metadata, relative = record.split("\t", 2)
    mode, object, stage = metadata&.split(" ", 3)
    unless mode && object && stage && relative
      raise "unexpected git ls-files --stage output"
    end

    { mode: mode, object: object, path: relative, stage: stage }
  end
  conflicted_paths = index_entries.reject { |entry| entry[:stage] == "0" }.map { |entry| entry[:path] }.uniq.sort
  conflicted_paths.each do |relative|
    all_errors << "#{repo_label}:#{relative}: unresolved index entry"
  end
  index_entries.select! { |entry| entry[:stage] == "0" }
  tracked_paths = index_entries.map { |entry| entry[:path] }.sort

  PROJECT_SKILL_ROOTS.each do |root|
    managed_names.each do |name|
      entrypoint = "#{root}/#{name}"
      next unless tracked_paths.any? { |relative| relative == entrypoint || relative.start_with?("#{entrypoint}/") }

      all_errors << "#{repo_label}:#{entrypoint}: managed-global skill #{name.inspect} must not be committed in a project skill root"
    end
  end

  blob_cache = {}
  index_entries.select { |entry| File.basename(entry[:path]) == "SKILL.md" }.each do |entry|
    relative = entry[:path]
    unless %w[100644 100755].include?(entry[:mode])
      all_errors << "#{repo_label}:#{relative}: skill entrypoint must be a regular file in the Git index"
      next
    end

    begin
      content = blob_cache.fetch(entry[:object]) do
        blob, blob_status = Open3.capture2e("git", "-C", repo, "cat-file", "blob", entry[:object])
        raise "unable to read staged content" unless blob_status.success?

        blob_cache[entry[:object]] = blob
      end
      name = read_skill_name(content, relative)
    rescue StandardError => error
      all_errors << "#{repo_label}:#{relative}: #{error.message}"
      next
    end

    names_to_paths[name] << relative
    directory_name = File.basename(File.dirname(relative))
    if directory_name != name
      all_errors << "#{repo_label}:#{relative}: skill name #{name.inspect} must match directory #{directory_name.inspect}"
    end
    if managed_names.include?(name) && PROJECT_SKILL_ROOTS.none? { |root| relative.start_with?("#{root}/#{name}/") }
      all_errors << "#{repo_label}:#{relative}: managed-global skill #{name.inspect} must not be committed in a project"
    end
  end

  names_to_paths.sort.each do |name, paths|
    next unless paths.length > 1

    all_errors << "#{repo_label}: duplicate project skill name #{name.inspect}: #{paths.sort.join(', ')}"
  end
end

unless all_errors.empty?
  warn "project skill ownership check failed:"
  all_errors.sort.each { |error| warn "- #{error}" }
  exit 1
end

puts "project skill ownership check passed"
