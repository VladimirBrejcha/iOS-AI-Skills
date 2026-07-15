#!/usr/bin/env ruby
# frozen_string_literal: true

require "date"
require "ipaddr"
require "json"
require "open3"
require "optparse"
require "pathname"
require "rubygems"
require "shellwords"
require "tmpdir"
require "uri"
require "yaml"

require_relative "lib/external_git_pin"

ROOT = Pathname.new(File.expand_path("..", __dir__)).freeze
SCRIPT_NAME = "scripts/skills_upstream_updates.rb"
RFC6598_SHARED_ADDRESS_RANGE = IPAddr.new("100.64.0.0/10").freeze
SPECIAL_USE_IPV4_ADDRESS_RANGES = [
  IPAddr.new("0.0.0.0/8"),
  IPAddr.new("192.0.0.0/29"),
  IPAddr.new("192.0.0.170/31"),
  IPAddr.new("192.0.2.0/24"),
  IPAddr.new("198.18.0.0/15"),
  IPAddr.new("198.51.100.0/24"),
  IPAddr.new("203.0.113.0/24"),
  IPAddr.new("224.0.0.0/4"),
  IPAddr.new("240.0.0.0/4")
].freeze
SPECIAL_USE_IPV6_ADDRESS_RANGES = [
  IPAddr.new("::/128"),
  IPAddr.new("::ffff:0:0/96"),
  IPAddr.new("100::/64"),
  IPAddr.new("2001::/23"),
  IPAddr.new("2001:2::/48"),
  IPAddr.new("2001:db8::/32"),
  IPAddr.new("2001:10::/28"),
  IPAddr.new("ff00::/8")
].freeze
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

def scp_like_url_match(value)
  match = /\A(?:(?<userinfo>[^\/@\s]+)@)?(?<host>[^\/:\s]+):(?<path>.+)\z/.match(value.to_s)
  return nil unless match
  return nil unless match[:host].include?(".")

  match
end

def scp_like_url?(value)
  !scp_like_url_match(value).nil?
end

def scp_like_remote_candidate?(value)
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
  !match[:userinfo].to_s.empty? && percent_decoded(match[:userinfo]).include?(":") if match
end

def query_or_fragment_bearing_scheme_url?(value)
  return false unless scheme_url?(value)

  uri = URI.parse(value)
  !uri.query.to_s.empty? || !uri.fragment.to_s.empty?
rescue URI::InvalidURIError
  suffix = value.to_s.sub(/\A[a-z][a-z0-9+.-]*:\/\/[^\/?#]*/i, "")
  suffix.include?("?") || suffix.include?("#")
end

def query_or_fragment_bearing_scp_url?(value)
  match = scp_like_url_match(value)
  match && (match[:path].include?("?") || match[:path].include?("#"))
end

def local_file_url?(value)
  value.is_a?(String) && /\Afile:/i.match?(value)
end

def home_relative_url?(value)
  value.is_a?(String) && value.start_with?("~")
end

def windows_drive_letter_path?(value)
  value.is_a?(String) && /\A[a-z]:(?:[\\\/]|[^\\\/]|$)/i.match?(value)
end

def windows_unc_path?(value)
  value.is_a?(String) && (value.start_with?("\\\\") || value.match?(%r{\A//[^/\\]}))
end

def windows_local_path?(value)
  windows_drive_letter_path?(value) || windows_unc_path?(value)
end

def scheme_url_authority(value)
  return nil unless scheme_url?(value)

  value.sub(/\A[a-z][a-z0-9+.-]*:\/\//i, "").split(/[\/?#]/, 2).first
end

def http_url_authority(value)
  return nil unless value.is_a?(String) && /\Ahttps?:\/\//i.match?(value)

  scheme_url_authority(value)
end

def remote_path_segments(path)
  percent_decoded(path).split("/").reject(&:empty?)
end

def remote_path_has_dot_segments?(path)
  remote_path_segments(path).any? { |segment| %w[. ..].include?(segment) }
end

def remote_repository_path?(path)
  segments = remote_path_segments(path)
  !segments.empty? && !remote_path_has_dot_segments?(path)
end

def remote_uri_has_repository_path?(uri)
  remote_repository_path?(uri.path)
end

def normalized_host_name(host)
  percent_decoded(host).delete_prefix("[").delete_suffix("]").sub(/\.+\z/, "").downcase
end

def parse_ipv4_legacy_component(value)
  text = value.to_s
  return nil if text.empty?

  base =
    if text.start_with?("0x", "0X")
      16
    elsif text.length > 1 && text.start_with?("0")
      8
    else
      10
    end

  pattern =
    case base
    when 16 then /\A0x[0-9a-f]+\z/i
    when 8 then /\A0[0-7]*\z/
    else /\A[0-9]+\z/
    end
  return nil unless pattern.match?(text)

  Integer(text, base)
rescue ArgumentError
  nil
end

def normalized_legacy_ipv4_address(host)
  normalized = normalized_host_name(host)
  return nil if normalized.empty? || normalized.include?(":") || normalized.include?("%")

  parts = normalized.split(".")
  return nil unless (1..4).cover?(parts.length)

  values = parts.map { |part| parse_ipv4_legacy_component(part) }
  return nil if values.any?(&:nil?)

  prefix_values = values[0...-1]
  return nil unless prefix_values.all? { |part| part.between?(0, 255) }

  max_last = (1 << (8 * (5 - parts.length))) - 1
  last = values[-1]
  return nil unless last.between?(0, max_last)

  address =
    case parts.length
    when 1
      last
    when 2
      (values[0] << 24) | last
    when 3
      (values[0] << 24) | (values[1] << 16) | last
    when 4
      (values[0] << 24) | (values[1] << 16) | (values[2] << 8) | last
    end
  return nil unless address&.between?(0, 0xFFFF_FFFF)

  [24, 16, 8, 0].map { |shift| (address >> shift) & 0xFF }.join(".")
end

def special_use_ip_address?(address)
  ranges = address.ipv4? ? SPECIAL_USE_IPV4_ADDRESS_RANGES : SPECIAL_USE_IPV6_ADDRESS_RANGES
  ranges.any? { |range| range.include?(address) }
end

def private_host?(host)
  normalized = normalized_host_name(host)
  return true if normalized.empty?
  return true if normalized == "localhost" || normalized.end_with?(".localhost", ".local")

  address = IPAddr.new(normalized_legacy_ipv4_address(normalized) || normalized)
  return true if RFC6598_SHARED_ADDRESS_RANGE.include?(address)
  return true if special_use_ip_address?(address)
  return true if address.loopback? || address.private? || address.link_local?

  false
rescue IPAddr::InvalidAddressError
  false
end

def github_host?(host)
  %w[github.com www.github.com].include?(normalized_host_name(host))
end

def github_repository_path?(path)
  segments = remote_path_segments(path)
  segments.length == 2 && !remote_path_has_dot_segments?(path)
end

def scp_like_url_has_repository_path?(value)
  match = scp_like_url_match(value)
  return false unless match
  return false if match[:path].include?("@")
  return false if private_host?(match[:host])
  return false if github_host?(match[:host]) && !github_repository_path?(match[:path])

  remote_repository_path?(match[:path])
end

def valid_http_remote_url?(value)
  return false unless value.is_a?(String) && /\Ahttps?:\/\//i.match?(value)

  uri = URI.parse(value)
  return false unless uri.is_a?(URI::HTTP) && !uri.host.to_s.empty?
  return false if private_host?(uri.host)
  return false unless remote_uri_has_repository_path?(uri)
  return false if github_host?(uri.host) && !github_repository_path?(uri.path)

  true
rescue URI::InvalidURIError
  false
end

def valid_remote_scheme_url?(value)
  return false unless scheme_url?(value)

  uri = URI.parse(value)
  return false if uri.scheme.to_s.empty? || uri.host.to_s.empty?
  return false if private_host?(uri.host)
  return false unless remote_uri_has_repository_path?(uri)
  return false if github_host?(uri.host) && !github_repository_path?(uri.path)

  true
rescue URI::InvalidURIError
  false
end

def external_git_url_public?(value)
  return false unless valid_string?(value)
  return false if value.start_with?("-")
  return false if windows_local_path?(value) || Pathname.new(value).absolute?
  return false if local_file_url?(value) || home_relative_url?(value)
  return false unless scheme_url?(value) || scp_like_url?(value)
  return false if ext_remote_url?(value) || remote_helper_transport_url?(value)
  return false if credential_bearing_scheme_url?(value) || credential_bearing_scp_url?(value)
  return false if query_or_fragment_bearing_scheme_url?(value) || query_or_fragment_bearing_scp_url?(value)
  return false if http_url_authority(value) && !valid_http_remote_url?(value)
  return false if scheme_url?(value) && http_url_authority(value).nil? && !valid_remote_scheme_url?(value)
  return false if scp_like_url?(value) && !scp_like_url_has_repository_path?(value)

  true
rescue ArgumentError
  false
end

def safe_relative_upstream_url?(value)
  return false unless valid_string?(value)
  return false if value.start_with?("-")
  return false if windows_local_path?(value) || Pathname.new(value).absolute?
  return false if local_file_url?(value) || home_relative_url?(value)
  return false if scheme_url?(value) || scp_like_remote_candidate?(value)

  safe_relative_path?(value)
rescue ArgumentError
  false
end

def registry_relative_upstream_path(url, registry_root)
  return nil unless safe_relative_upstream_url?(url)

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
  external_git_url_public?(url) || safe_relative_upstream_url?(url)
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

def valid_git_tracking_ref?(value)
  return false unless valid_string?(value) && value.start_with?("refs/heads/")

  _stdout, _stderr, status = Open3.capture3("git", "check-ref-format", value)
  status.success?
rescue SystemCallError
  false
end

def sanitized_git_env(ssh_state_dir:)
  env = {
    "GIT_TERMINAL_PROMPT" => "0",
    "GIT_ASKPASS" => "false",
    "SSH_ASKPASS" => "false",
    "SSH_ASKPASS_REQUIRE" => "never",
    "GCM_INTERACTIVE" => "never",
    "GIT_SSH_COMMAND" => "ssh -F #{File::NULL} -oBatchMode=yes -oIdentityAgent=none",
    "GIT_CONFIG_NOSYSTEM" => "1",
    "GIT_CONFIG_SYSTEM" => File::NULL,
    "GIT_CONFIG_GLOBAL" => File::NULL,
    "GIT_CONFIG_COUNT" => "0",
    "HOME" => ssh_state_dir,
    "USERPROFILE" => ssh_state_dir,
    "XDG_CONFIG_HOME" => ssh_state_dir,
    "SSH_AUTH_SOCK" => nil,
    "SSH_AGENT_PID" => nil
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
  stdout = stderr = nil
  status = nil
  Dir.mktmpdir("skills-upstream-ssh-") do |ssh_state_dir|
    stdout, stderr, status = Open3.capture3(
      sanitized_git_env(ssh_state_dir: ssh_state_dir),
      "git",
      "ls-remote",
      "--tags",
      "--end-of-options",
      url.to_s,
      chdir: neutral_git_working_directory(registry_root)
    )
  end
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

def git_ls_remote_ref(url, ref, registry_root)
  stdout = stderr = nil
  status = nil
  Dir.mktmpdir("skills-upstream-ssh-") do |ssh_state_dir|
    stdout, stderr, status = Open3.capture3(
      sanitized_git_env(ssh_state_dir: ssh_state_dir),
      "git",
      "ls-remote",
      "--refs",
      "--end-of-options",
      url.to_s,
      ref,
      chdir: neutral_git_working_directory(registry_root)
    )
  end
  unless status.success?
    detail = stderr.strip.empty? ? "git ls-remote failed with status #{status.exitstatus}" : stderr.strip
    return [nil, redact_local_paths(detail)]
  end

  refs = stdout.lines.each_with_object({}) do |line, memo|
    object_id, resolved_ref = line.split(/\s+/, 2)
    next unless valid_git_object_id?(object_id) && resolved_ref

    resolved_ref = resolved_ref.strip
    memo[resolved_ref] = object_id.downcase if resolved_ref == ref
  end
  [refs, nil]
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
    next if entry["status"] == "legacy"

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

  pin_kind = ExternalGitPin.kind(source)
  lock_pin_kind = ExternalGitPin.kind(lock_entry)
  mismatches = []
  mismatches << "source pin mode" if pin_kind.nil?
  mismatches << "lock pin mode" if lock_pin_kind.nil?
  mismatches << "pin mode" if !pin_kind.nil? && !lock_pin_kind.nil? && pin_kind != lock_pin_kind
  fields = {
    "source_type" => "external-git",
    "url" => source["url"],
    "path" => source["path"],
    "exported_names" => registry_skill["exported_names"]
  }
  ExternalGitPin.required_fields(pin_kind).each { |field| fields[field] = source[field] }
  fields.each do |field, expected|
    actual = lock_entry[field]
    matches =
      if %w[observed_commit pinned_commit].include?(field) && valid_git_object_id?(actual) && valid_git_object_id?(expected)
        actual.to_s.downcase == expected.to_s.downcase
      else
        actual == expected
      end
    mismatches << field unless matches
  end
  unless pin_kind.nil?
    forbidden_source = ExternalGitPin.forbidden_fields(pin_kind).select { |field| source.key?(field) }
    forbidden_lock = ExternalGitPin.forbidden_fields(pin_kind).select { |field| lock_entry.key?(field) }
    mismatches.concat(forbidden_source.map { |field| "source.#{field}" })
    mismatches.concat(forbidden_lock.map { |field| "lock.#{field}" })
  end
  mismatches.uniq!

  reporter.error("#{skill_id}: lock entry differs from registry fields: #{mismatches.join(", ")}") unless mismatches.empty?
  mismatches.empty? ? "ok" : "mismatch"
end

def required_update_steps(skill_id, pin_kind)
  pin_fields =
    if pin_kind == :commit
      "source.pinned_commit, source.tracking_ref, and source.observed_at"
    else
      "source.pinned_tag, source.observed_commit, and source.observed_at"
    end
  [
    "Review upstream diff and license before changing #{skill_id}.",
    "Update skills.registry.yaml #{pin_fields}.",
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
    observed_at = source["observed_at"]
    exported_names = string_array(skill["exported_names"])
    lock_state = compare_lock(skill, lock_by_id[skill_id], reporter)
    pin_kind = ExternalGitPin.kind(source)
    if pin_kind.nil?
      reporter.error("#{skill_id}: external-git source must define exactly one of pinned_tag or pinned_commit")
      next
    end

    unless acceptable_upstream_url?(url)
      reporter.error("#{skill_id}: external-git source.url must be a public, credential-free URL or safe relative test URL")
    end
    path_valid = path == "." || safe_relative_path?(path)
    reporter.error("#{skill_id}: external-git source.path must be a safe relative path") unless path_valid
    reporter.error("#{skill_id}: external-git observed_at is required") unless valid_string?(observed_at)
    forbidden_field = ExternalGitPin.forbidden_fields(pin_kind).find { |field| source.key?(field) }
    reporter.error("#{skill_id}: external-git source.#{forbidden_field} must not be defined for #{pin_kind} pins") unless forbidden_field.nil?

    status = "check-failed"
    status_detail = "registry metadata is invalid"
    current_data = {}
    latest_data = {}
    tags_checked = []
    refs_checked = []
    diff_command = nil
    if pin_kind == :tag
      pinned_tag = source["pinned_tag"]
      observed_commit = source["observed_commit"].to_s.downcase
      reporter.error("#{skill_id}: external-git pinned_tag is required") unless valid_string?(pinned_tag)
      if valid_string?(pinned_tag) && !valid_git_tag_name?(pinned_tag)
        reporter.error("#{skill_id}: external-git pinned_tag must be an exact tag name")
      end
      unless valid_git_object_id?(observed_commit)
        reporter.error("#{skill_id}: external-git observed_commit must be a full git object id")
      end

      tag_map = {}
      latest = nil
      if acceptable_upstream_url?(url) && valid_git_tag_name?(pinned_tag) && valid_git_object_id?(observed_commit)
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
          elsif current["commit"].to_s.downcase != observed_commit
            status = "pin-mismatch"
            status_detail = "pinned tag no longer resolves to observed_commit"
          elsif current_version.nil?
            status = "uncomparable-tags"
            status_detail = "pinned tag is not a release-like version"
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
      current_data = {
        "pinned_tag" => pinned_tag,
        "observed_commit" => observed_commit,
        "observed_at" => observed_at,
        "upstream_commit" => current_tag["commit"]
      }
      latest_data = {
        "tag" => latest_tag["tag"],
        "commit" => latest_tag["commit"]
      }
      tags_checked = tag_map.keys.sort
      if status == "stale" && path_valid && valid_string?(pinned_tag) && valid_string?(latest_tag["tag"])
        diff_command = "git diff --stat #{Shellwords.escape(pinned_tag)}..#{Shellwords.escape(latest_tag["tag"])} -- #{Shellwords.escape(path)}"
      end
    else
      pinned_commit = source["pinned_commit"].to_s.downcase
      tracking_ref = source["tracking_ref"]
      unless valid_git_object_id?(pinned_commit)
        reporter.error("#{skill_id}: external-git pinned_commit must be a full git object id")
      end
      unless valid_git_tracking_ref?(tracking_ref)
        reporter.error("#{skill_id}: external-git tracking_ref must be a full refs/heads/... branch ref")
      end

      upstream_commit = nil
      if acceptable_upstream_url?(url) && valid_git_object_id?(pinned_commit) && valid_git_tracking_ref?(tracking_ref)
        upstream_refs, error = git_ls_remote_ref(resolved_upstream_url(url, registry_root), tracking_ref, registry_root)
        if upstream_refs.nil?
          status_detail = error
          reporter.warn("#{skill_id}: could not resolve upstream tracking ref #{tracking_ref}: #{error}")
        else
          refs_checked = upstream_refs.keys.sort
          upstream_commit = upstream_refs[tracking_ref]
          if upstream_commit.nil?
            status = "missing-tracking-ref"
            status_detail = "tracking ref #{tracking_ref} is not present upstream"
          elsif upstream_commit == pinned_commit
            status = "current"
            status_detail = "tracking ref resolves to pinned_commit"
          else
            status = "stale"
            status_detail = "tracking ref resolves to #{upstream_commit[0, 12]}, not pinned_commit #{pinned_commit[0, 12]}"
            if path_valid
              diff_command = "git diff --stat #{Shellwords.escape(pinned_commit)}..#{Shellwords.escape(upstream_commit)} -- #{Shellwords.escape(path)}"
            end
          end
        end
      end
      current_data = {
        "pinned_commit" => pinned_commit,
        "tracking_ref" => tracking_ref,
        "observed_at" => observed_at,
        "upstream_commit" => upstream_commit
      }
      latest_data = {
        "ref" => tracking_ref,
        "commit" => upstream_commit
      }
    end

    entry = {
      "id" => skill_id,
      "pin_mode" => pin_kind.to_s,
      "status" => status,
      "status_detail" => status_detail,
      "source" => {
        "type" => "external-git",
        "url" => url,
        "path" => path
      },
      "exported_names" => exported_names,
      "current" => current_data,
      "latest" => latest_data,
      "lock_state" => lock_state,
      "include_prerelease" => options[:include_prerelease],
      "update_required" => %w[stale missing-current-tag pin-mismatch missing-tracking-ref].include?(status),
      "diff_command" => diff_command,
      "required_update_steps" => required_update_steps(skill_id, pin_kind)
    }
    entry[pin_kind == :tag ? "tags_checked" : "refs_checked"] = pin_kind == :tag ? tags_checked : refs_checked
    memo << entry
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
  lines << "| Skill | Status | Current Pin | Latest Upstream | Lock | Detail |"
  lines << "| --- | --- | --- | --- | --- | --- |"
  report.fetch("skills").each do |skill|
    current = skill.fetch("current")
    latest = skill.fetch("latest")
    if skill.fetch("pin_mode") == "commit"
      current_label = "#{current.fetch("tracking_ref")} @ #{current.fetch("pinned_commit")[0, 12]}"
      latest_label = latest["commit"].to_s.empty? ? latest["ref"].to_s : "#{latest["ref"]} @ #{latest["commit"].to_s[0, 12]}"
    else
      current_label = [current["pinned_tag"], current["observed_commit"].to_s[0, 12]].compact.join(" @ ")
      latest_label = latest["tag"].to_s.empty? ? "" : [latest["tag"], latest["commit"].to_s[0, 12]].compact.join(" @ ")
    end
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
