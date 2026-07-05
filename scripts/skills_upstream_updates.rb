#!/usr/bin/env ruby
# frozen_string_literal: true

require "date"
require "json"
require "open3"
require "optparse"
require "pathname"
require "rubygems"
require "shellwords"
require "tmpdir"
require "uri"
require "yaml"

ROOT = Pathname.new(File.expand_path("..", __dir__)).freeze
SCRIPT_NAME = "scripts/skills_upstream_updates.rb"
GIT_REPOSITORY_ENV_KEYS = %w[
  GIT_DIR
  GIT_WORK_TREE
  GIT_COMMON_DIR
  GIT_INDEX_FILE
].freeze
GIT_CONFIG_OVERRIDE_ENV_KEYS = %w[
  GIT_CONFIG_PARAMETERS
].freeze
GIT_CONFIG_OVERRIDE_ENV_PREFIXES = %w[
  GIT_CONFIG_KEY_
  GIT_CONFIG_VALUE_
].freeze
SUPPORTED_GIT_TRANSPORT_SCHEMES = %w[file git http https ssh ftp ftps rsync].freeze

class Reporter
  attr_reader :errors, :warnings

  def initialize
    @errors = []
    @warnings = []
  end

  def error(message)
    @errors << message
  end

  def warn(message)
    @warnings << message
  end
end

def load_yaml_file(path, reporter)
  parsed = YAML.safe_load(File.read(path), aliases: false, filename: path)
  parsed.nil? ? {} : parsed
rescue Psych::Exception => error
  reporter.error("#{display_path(path)} is not valid YAML: #{error.message}")
  nil
rescue Errno::ENOENT
  reporter.error("#{display_path(path)} does not exist")
  nil
rescue SystemCallError => error
  reporter.error("#{display_path(path)} could not be read: #{redact_local_paths(error.message)}")
  nil
end

def show_local_paths?
  ENV.fetch("SKILLS_UPSTREAM_SHOW_PATHS", "0") == "1"
end

def display_path(path, root: ROOT)
  expanded = File.expand_path(path.to_s)
  root_path = File.expand_path(root.to_s)
  home = File.expand_path("~")

  return expanded if show_local_paths?
  return "." if expanded == root_path
  return "./#{expanded.delete_prefix("#{root_path}/")}" if expanded.start_with?("#{root_path}/")
  return "~" if expanded == home
  return "~/#{expanded.delete_prefix("#{home}/")}" if expanded.start_with?("#{home}/")

  path.to_s.start_with?("/") ? "<absolute-path>" : path.to_s
end

def redact_local_paths(text)
  return text.to_s if show_local_paths?

  text
    .to_s
    .gsub(%r{(?<![[:alnum:]_.-])/(?:[^[:space:]]+)}, "<absolute-path>")
    .gsub(%r{(?<![[:alnum:]_.-])(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/]|//[^/\s]+/)(?:[^[:space:]]+)}i, "<absolute-path>")
end

def contains_control_characters?(value)
  value.is_a?(String) && /[\x00-\x1F\x7F]/.match?(value)
end

def valid_string?(value)
  value.is_a?(String) && !value.strip.empty? && !contains_control_characters?(value)
end

def safe_relative_path?(value)
  return false unless valid_string?(value)
  return false if value.start_with?("/") || value.include?("\\")

  path = Pathname.new(value)
  return false if path.each_filename.any? { |part| part == ".." }

  path.cleanpath.each_filename.none? { |part| part == ".." }
rescue ArgumentError
  false
end

def scheme_url?(value)
  value.is_a?(String) && /\A[a-z][a-z0-9+.-]*:\/\//i.match?(value)
end

def scp_like_url?(value)
  value.is_a?(String) && /\A(?:[^\/@\s]+@)?[^\/:\s]+:.+\z/.match?(value)
end

def ext_remote_url?(value)
  value.is_a?(String) && value.start_with?("ext::")
end

def url_scheme(value)
  match = /\A([a-z][a-z0-9+.-]*):/i.match(value.to_s)
  match && match[1]
end

def remote_helper_transport_url?(value)
  raw_scheme = url_scheme(value)
  return ext_remote_url?(value) if raw_scheme.nil?
  return true if ext_remote_url?(value)
  return true if value.to_s.match?(/\A[a-z][a-z0-9+.-]*::/i)
  return false unless scheme_url?(value)

  scheme = raw_scheme.downcase
  return true if raw_scheme != scheme

  !SUPPORTED_GIT_TRANSPORT_SCHEMES.include?(scheme)
end

def percent_decoded(value)
  URI::DEFAULT_PARSER.unescape(value.to_s)
end

def credential_bearing_scheme_url?(value)
  uri = URI.parse(value)
  userinfo = uri.respond_to?(:userinfo) ? percent_decoded(uri.userinfo) : ""
  return false if userinfo.empty?

  !(uri.scheme.to_s.casecmp("ssh").zero? && !userinfo.include?(":"))
rescue URI::InvalidURIError
  authority = value.to_s.sub(/\A[a-z][a-z0-9+.-]*:\/\//i, "").split(/[\/?#]/, 2).first
  return false if authority.nil? || authority.empty?

  match = /\A(?<userinfo>[^@]+)@/.match(authority)
  return false unless match

  scheme = value.to_s[/\A([a-z][a-z0-9+.-]*):/i, 1].to_s.downcase
  userinfo = percent_decoded(match[:userinfo])

  !(scheme == "ssh" && !userinfo.include?(":"))
end

def credential_bearing_scp_url?(value)
  match = /\A(?<userinfo>[^\/@\s]+)@[^\/:\s]+:.+\z/.match(value.to_s)
  match && percent_decoded(match[:userinfo]).include?(":")
end

def local_file_url?(value)
  value.is_a?(String) && /\Afile:/i.match?(value)
end

def registry_relative_upstream_path(url, registry_root)
  return nil unless safe_relative_path?(url)
  return nil if scheme_url?(url) || scp_like_url?(url)

  registry_root.join(url).cleanpath
rescue ArgumentError
  nil
end

def resolved_upstream_url(url, registry_root)
  relative = registry_relative_upstream_path(url, registry_root)
  return relative.to_s unless relative.nil?

  url
end

def acceptable_upstream_url?(url)
  return false unless valid_string?(url)
  return false if local_file_url?(url)
  return false if credential_bearing_scheme_url?(url)
  return false if credential_bearing_scp_url?(url)
  return false if remote_helper_transport_url?(url)
  return false if url.start_with?("/") || url.start_with?("~")

  scheme_url?(url) || scp_like_url?(url) || safe_relative_path?(url)
end

def valid_git_object_id?(value)
  value.is_a?(String) && /\A(?:[0-9a-f]{40}|[0-9a-f]{64})\z/i.match?(value) && !value.match?(/\A0+\z/)
end

def valid_git_tag_name?(value)
  return false unless valid_string?(value)
  return false if value.start_with?("refs/")

  _stdout, _stderr, status = Open3.capture3("git", "check-ref-format", "refs/tags/#{value}")
  status.success?
rescue SystemCallError
  false
end

def sanitized_git_env
  env = {
    "GIT_TERMINAL_PROMPT" => "0",
    "GIT_ASKPASS" => "false",
    "SSH_ASKPASS" => "false",
    "SSH_ASKPASS_REQUIRE" => "never",
    "GCM_INTERACTIVE" => "never",
    "GIT_SSH_COMMAND" => "ssh -oBatchMode=yes",
    "GIT_CONFIG_NOSYSTEM" => "1",
    "GIT_CONFIG_SYSTEM" => File::NULL,
    "GIT_CONFIG_GLOBAL" => File::NULL,
    "GIT_CONFIG_COUNT" => "0"
  }
  GIT_REPOSITORY_ENV_KEYS.each { |key| env[key] = nil }
  GIT_CONFIG_OVERRIDE_ENV_KEYS.each { |key| env[key] = nil }
  GIT_CONFIG_OVERRIDE_ENV_PREFIXES.each do |prefix|
    ENV.each_key { |key| env[key] = nil if key.start_with?(prefix) }
  end
  env
end

def neutral_git_working_directory(registry_root)
  Pathname.new(registry_root.to_s).expand_path.ascend.to_a.last.to_s
rescue ArgumentError, SystemCallError
  Dir.tmpdir
end

def git_ls_remote_tags(url, registry_root)
  stdout, stderr, status = Open3.capture3(
    sanitized_git_env,
    "git",
    "ls-remote",
    "--tags",
    "--end-of-options",
    url.to_s,
    chdir: neutral_git_working_directory(registry_root)
  )
  return [nil, redact_local_paths(stderr.strip.empty? ? "git ls-remote failed with status #{status.exitstatus}" : stderr.strip)] unless status.success?

  tags = {}
  stdout.lines.each do |line|
    object_id, ref = line.split(/\s+/, 2)
    next unless object_id && ref
    next unless valid_git_object_id?(object_id)

    ref = ref.strip
    next unless ref.start_with?("refs/tags/")

    tag_name = ref.delete_prefix("refs/tags/")
    peeled = tag_name.end_with?("^{}")
    tag_name = tag_name.delete_suffix("^{}")
    next if tag_name.empty?

    entry = tags[tag_name] ||= { "tag" => tag_name }
    if peeled
      entry["commit"] = object_id.downcase
    else
      entry["object"] = object_id.downcase
      entry["commit"] ||= object_id.downcase
    end
  end

  [tags, nil]
rescue SystemCallError => error
  [nil, redact_local_paths(error.message)]
end

def version_for_tag(tag, include_prerelease:)
  normalized = tag.to_s.sub(/\Av/, "")
  return nil unless normalized.match?(/\A\d+(?:\.\d+)*(?:[-.][A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?\z/)

  version = Gem::Version.new(normalized)
  return nil if version.prerelease? && !include_prerelease

  version
rescue ArgumentError
  nil
end

def semver_candidates(tags, include_prerelease:)
  tags.each_with_object([]) do |(tag, entry), memo|
    version = version_for_tag(tag, include_prerelease: include_prerelease)
    next if version.nil?

    memo << entry.merge("version" => version)
  end
end

def string_array(value)
  return [] unless value.is_a?(Array)

  value.select { |entry| entry.is_a?(String) && !entry.empty? }
end

def index_lock(lock, reporter)
  raw = lock["skills"]
  unless raw.is_a?(Array)
    reporter.error("skills.lock.yaml skills must be an array")
    return {}
  end

  raw.each_with_object({}) do |entry, memo|
    unless entry.is_a?(Hash) && valid_string?(entry["id"])
      reporter.error("skills.lock.yaml entries must include non-empty string id")
      next
    end

    skill_id = entry["id"]
    reporter.error("skills.lock.yaml duplicate lock entry #{skill_id}") if memo.key?(skill_id)
    memo[skill_id] = entry
  end
end

def external_registry_skills(registry, reporter)
  raw = registry["skills"]
  unless raw.is_a?(Array)
    reporter.error("skills.registry.yaml skills must be an array")
    return []
  end

  raw.each_with_object([]) do |entry, memo|
    next unless entry.is_a?(Hash)
    source = entry["source"]
    next unless source.is_a?(Hash) && source["type"] == "external-git"

    memo << entry
  end
end

def compare_lock(registry_skill, lock_entry, reporter)
  skill_id = registry_skill["id"]
  source = registry_skill["source"]
  if lock_entry.nil?
    reporter.error("#{skill_id}: missing lock entry")
    return "missing"
  end

  mismatches = []
  {
    "source_type" => "external-git",
    "url" => source["url"],
    "path" => source["path"],
    "pinned_tag" => source["pinned_tag"],
    "observed_commit" => source["observed_commit"],
    "exported_names" => registry_skill["exported_names"]
  }.each do |field, expected|
    actual = lock_entry[field]
    matches =
      if field == "observed_commit" && valid_git_object_id?(actual) && valid_git_object_id?(expected)
        actual.to_s.downcase == expected.to_s.downcase
      else
        actual == expected
      end
    mismatches << field unless matches
  end

  reporter.error("#{skill_id}: lock entry differs from registry fields: #{mismatches.join(", ")}") unless mismatches.empty?
  mismatches.empty? ? "ok" : "mismatch"
end

def required_update_steps(skill_id)
  [
    "Review upstream diff and license before changing #{skill_id}.",
    "Update skills.registry.yaml source.pinned_tag, source.observed_commit, and source.observed_at.",
    "Regenerate skills.lock.yaml with scripts/skills_doctor.rb --check-upstream --print-lock.",
    "Regenerate the public catalog with scripts/skills_catalog.rb --write.",
    "Run doctor, catalog, sync-plan, and public-safety validation before opening the update PR."
  ]
end

def build_report(registry, lock, options, reporter)
  registry_path = File.expand_path(options[:registry])
  registry_root = Pathname.new(File.dirname(registry_path)).cleanpath
  lock_by_id = index_lock(lock, reporter)
  skills = external_registry_skills(registry, reporter)
  checked_at = options[:today] || Date.today.iso8601

  entries = skills.each_with_object([]) do |skill, memo|
    skill_id = skill["id"]
    unless valid_string?(skill_id)
      reporter.error("external-git registry skill is missing id")
      next
    end

    source = skill["source"]
    url = source["url"]
    path = source["path"].to_s.empty? ? "." : source["path"]
    pinned_tag = source["pinned_tag"]
    observed_commit = source["observed_commit"].to_s.downcase
    observed_at = source["observed_at"]
    exported_names = string_array(skill["exported_names"])
    lock_state = compare_lock(skill, lock_by_id[skill_id], reporter)

    unless acceptable_upstream_url?(url)
      reporter.error("#{skill_id}: external-git source.url must be a public, credential-free URL or safe relative test URL")
    end
    reporter.error("#{skill_id}: external-git source.path must be a safe relative path") unless path == "." || safe_relative_path?(path)
    reporter.error("#{skill_id}: external-git pinned_tag is required") unless valid_string?(pinned_tag)
    reporter.error("#{skill_id}: external-git pinned_tag must be an exact tag name") if valid_string?(pinned_tag) && !valid_git_tag_name?(pinned_tag)
    reporter.error("#{skill_id}: external-git observed_commit must be a full git object id") unless valid_git_object_id?(observed_commit)
    reporter.error("#{skill_id}: external-git observed_at is required") unless valid_string?(observed_at)

    tag_map = {}
    latest = nil
    status = "check-failed"
    status_detail = nil
    if acceptable_upstream_url?(url)
      upstream_tags, error = git_ls_remote_tags(resolved_upstream_url(url, registry_root), registry_root)
      if upstream_tags.nil?
        status_detail = error
        reporter.warn("#{skill_id}: could not list upstream tags: #{error}")
      else
        tag_map = upstream_tags
        current = tag_map[pinned_tag]
        current_version = version_for_tag(pinned_tag, include_prerelease: true)
        candidates = semver_candidates(tag_map, include_prerelease: options[:include_prerelease])
        latest = candidates.max_by { |entry| entry["version"] }

        if current.nil?
          status = "missing-current-tag"
          status_detail = "pinned tag #{pinned_tag} is not present upstream"
        elsif valid_git_object_id?(observed_commit) && current["commit"].to_s.downcase != observed_commit
          status = "pin-mismatch"
          status_detail = "pinned tag no longer resolves to observed_commit"
        elsif current_version&.prerelease? &&
              !options[:include_prerelease] &&
              !latest.nil? &&
              latest["version"] < current_version
          status = "current"
          status_detail = "latest stable tag is older than pinned prerelease; rerun with --include-prerelease to compare prereleases"
        elsif latest.nil?
          status = "uncomparable-tags"
          status_detail = "no release-like tags found"
        elsif latest["tag"] == pinned_tag
          status = "current"
          status_detail = "pinned tag is latest release-like tag"
        else
          status = "stale"
          status_detail = "latest release-like tag is #{latest["tag"]}"
        end
      end
    end

    current_tag = tag_map[pinned_tag] || {}
    latest_tag = latest || {}
    diff_command = nil
    if status == "stale" && valid_string?(url) && valid_string?(pinned_tag) && valid_string?(latest_tag["tag"])
      diff_path = path == "." ? "." : path
      diff_command = "git diff --stat #{Shellwords.escape(pinned_tag)}..#{Shellwords.escape(latest_tag["tag"])} -- #{Shellwords.escape(diff_path)}"
    end

    memo << {
      "id" => skill_id,
      "status" => status,
      "status_detail" => status_detail,
      "source" => {
        "type" => "external-git",
        "url" => url,
        "path" => path
      },
      "exported_names" => exported_names,
      "current" => {
        "pinned_tag" => pinned_tag,
        "observed_commit" => observed_commit,
        "observed_at" => observed_at,
        "upstream_commit" => current_tag["commit"]
      },
      "latest" => {
        "tag" => latest_tag["tag"],
        "commit" => latest_tag["commit"]
      },
      "lock_state" => lock_state,
      "tags_checked" => tag_map.keys.sort,
      "include_prerelease" => options[:include_prerelease],
      "update_required" => %w[stale missing-current-tag pin-mismatch].include?(status),
      "diff_command" => diff_command,
      "required_update_steps" => required_update_steps(skill_id)
    }
  end

  stale_count = entries.count { |entry| entry["update_required"] }
  {
    "schema_version" => "0.1",
    "generated_by" => SCRIPT_NAME,
    "checked_at" => checked_at,
    "include_prerelease" => options[:include_prerelease],
    "summary" => {
      "external_skills" => entries.length,
      "update_required" => stale_count,
      "current" => entries.count { |entry| entry["status"] == "current" },
      "check_failed" => entries.count { |entry| entry["status"] == "check-failed" }
    },
    "skills" => entries
  }
end

def json_document(report)
  "#{JSON.pretty_generate(report)}\n"
end

def md_escape(value)
  value.to_s.gsub("|", "\\|").gsub("\n", " ")
end

def markdown_document(report)
  lines = []
  summary = report.fetch("summary")
  lines << "# Upstream Update Report"
  lines << ""
  lines << "Generated by `#{report.fetch("generated_by")}` on `#{report.fetch("checked_at")}`."
  lines << ""
  lines << "- External skills checked: #{summary.fetch("external_skills")}"
  lines << "- Updates requiring review: #{summary.fetch("update_required")}"
  lines << "- Include prerelease tags: #{report.fetch("include_prerelease")}"
  lines << ""
  lines << "| Skill | Status | Current Pin | Latest Tag | Lock | Detail |"
  lines << "| --- | --- | --- | --- | --- | --- |"
  report.fetch("skills").each do |skill|
    current = skill.fetch("current")
    latest = skill.fetch("latest")
    current_label = [current["pinned_tag"], current["observed_commit"].to_s[0, 12]].compact.join(" @ ")
    latest_label = latest["tag"].to_s.empty? ? "" : [latest["tag"], latest["commit"].to_s[0, 12]].compact.join(" @ ")
    lines << [
      "`#{skill.fetch("id")}`",
      "`#{skill.fetch("status")}`",
      md_escape(current_label),
      md_escape(latest_label),
      "`#{skill.fetch("lock_state")}`",
      md_escape(skill.fetch("status_detail"))
    ].join(" | ").prepend("| ") + " |"
  end

  actionable = report.fetch("skills").select { |skill| skill.fetch("update_required") }
  failed_checks = report.fetch("skills").select { |skill| skill.fetch("status") == "check-failed" }
  if actionable.empty? && failed_checks.empty?
    lines << ""
    lines << "No external pins require an update PR."
  end

  unless failed_checks.empty?
    lines << ""
    lines << "## Upstream Check Failures"
    failed_checks.each do |skill|
      lines << "- `#{skill.fetch("id")}`: #{skill.fetch("status_detail")}"
    end
  end

  unless actionable.empty?
    lines << ""
    lines << "## Required Update PR Evidence"
    actionable.each do |skill|
      lines << ""
      lines << "### #{skill.fetch("id")}"
      if skill["diff_command"]
        lines << ""
        lines << "Review upstream diff from a clone of #{skill.dig("source", "url")}:"
        lines << ""
        lines << "```bash"
        lines << skill.fetch("diff_command")
        lines << "```"
      end
      lines << ""
      skill.fetch("required_update_steps").each do |step|
        lines << "- #{step}"
      end
    end
  end

  lines << ""
  lines.join("\n")
end

options = {
  registry: ROOT.join("skills.registry.yaml").to_s,
  lock: ROOT.join("skills.lock.yaml").to_s,
  mode: :markdown,
  output: nil,
  fail_on_stale: false,
  include_prerelease: false,
  today: nil
}

parser = OptionParser.new do |opts|
  opts.banner = "Usage: #{SCRIPT_NAME} [--markdown|--json] [--fail-on-stale]"
  opts.on("--registry PATH", "Registry manifest path") { |value| options[:registry] = value }
  opts.on("--lock PATH", "Lock file path") { |value| options[:lock] = value }
  opts.on("--markdown", "Print Markdown report") { options[:mode] = :markdown }
  opts.on("--json", "Print JSON report") { options[:mode] = :json }
  opts.on("--output PATH", "Write report to path") { |value| options[:output] = value }
  opts.on("--fail-on-stale", "Exit non-zero when an external pin needs review") { options[:fail_on_stale] = true }
  opts.on("--include-prerelease", "Include prerelease tags in latest-tag comparison") { options[:include_prerelease] = true }
  opts.on("--today DATE", "Override report date for tests") { |value| options[:today] = value }
end

parser.parse!

reporter = Reporter.new
registry = load_yaml_file(options[:registry], reporter) || {}
lock = load_yaml_file(options[:lock], reporter) || {}
report = build_report(registry, lock, options, reporter)
document = options[:mode] == :json ? json_document(report) : markdown_document(report)

unless reporter.errors.empty?
  warn reporter.errors.join("\n")
  exit 1
end

if options[:output]
  File.write(options[:output], document)
else
  print document
end

unless reporter.warnings.empty?
  warn reporter.warnings.join("\n")
end

if options[:fail_on_stale] &&
   (report.fetch("summary").fetch("update_required").positive? ||
    report.fetch("summary").fetch("check_failed").positive?)
  warn "stale external pins or upstream check failures found"
  exit 1
end
