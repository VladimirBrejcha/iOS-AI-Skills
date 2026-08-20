#!/usr/bin/env ruby
# frozen_string_literal: true

require "open3"
require "pathname"
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

def read_skill_name(file)
  lines = File.readlines(file, chomp: true)
  raise "missing YAML front matter" unless lines.first == "---"

  closing_offset = lines[1..]&.index("---")
  raise "unterminated YAML front matter" unless closing_offset

  metadata = YAML.safe_load(
    lines[1, closing_offset].join("\n"),
    aliases: false,
    filename: file
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
  ["swift-concurrency"] +
  parse_bootstrap_array(bootstrap, "asc_skills")
).freeze

unless managed_names.length == managed_names.uniq.length
  raise "bootstrap.sh contains duplicate managed skill names"
end

all_errors = []

ARGV.each do |argument|
  repo = File.expand_path(argument)
  fail_usage("Not a directory: #{argument}") unless File.directory?(repo)

  output, status = Open3.capture2e("git", "-C", repo, "ls-files", "-z")
  fail_usage("Not a Git worktree: #{argument}") unless status.success?

  repo_label = File.basename(repo)
  names_to_paths = Hash.new { |hash, key| hash[key] = [] }
  tracked_paths = output.split("\0").reject(&:empty?).sort
  visible_paths = tracked_paths.select do |relative|
    absolute = File.join(repo, relative)
    File.exist?(absolute) || File.symlink?(absolute)
  end

  PROJECT_SKILL_ROOTS.each do |root|
    managed_names.each do |name|
      entrypoint = "#{root}/#{name}"
      next unless visible_paths.any? { |relative| relative == entrypoint || relative.start_with?("#{entrypoint}/") }

      all_errors << "#{repo_label}:#{entrypoint}: managed-global skill #{name.inspect} must not be committed in a project skill root"
    end
  end

  visible_paths.select { |relative| relative.end_with?("SKILL.md") }.each do |relative|
    file = File.join(repo, relative)
    next unless File.file?(file)

    begin
      name = read_skill_name(file)
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
