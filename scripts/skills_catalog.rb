#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "date"
require "fileutils"
require "find"
require "ipaddr"
require "json"
require "optparse"
require "pathname"
require "shellwords"
require "uri"
require "yaml"

ROOT = Pathname.new(File.expand_path("..", __dir__)).freeze
CATALOG_SCHEMA_VERSION = "0.1"
GENERATOR = "scripts/skills_catalog.rb"
SKILL_STATUSES = %w[active needs-import-review needs-source-review legacy].freeze
UNRESOLVED_LOCAL_STATUSES = %w[needs-source-review legacy].freeze
FINALIZED_REGISTRY_STATUS = "catalog-dispositions-finalized"
PENDING_SKILL_STATUSES = %w[needs-import-review needs-source-review].freeze
DEFAULT_SKILLS_CLI_PACKAGE = "skills@1.5.14"
DEFAULT_INSTALL_PROFILE = File.join("profiles", "machine", "example-local-skills.yaml").freeze
SHARED_AGENTS_USER_ROOT = File.expand_path("~/.agents/skills").freeze
CLAUDE_USER_ROOT = File.expand_path("~/.claude/skills").freeze
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
INSTALLER_EXCLUDED_FILES = %w[metadata.json].freeze
INSTALLER_EXCLUDED_DIRS = %w[.git __pycache__ __pypackages__ node_modules].freeze
DESCRIPTION_FRONTMATTER_KEY_PATTERN = /\A(?<indent>\s*)(?:"description"|'description'|description)\s*:(?<value>.*)\z/

PUBLIC_UNSAFE_PATTERNS = {
  "macOS user path" => %r{/Users/[A-Za-z0-9._-]+}i,
  "Linux user path" => %r{/home/[A-Za-z0-9._-]+},
  "root home path" => %r{/root(?:/|\b)},
  "POSIX local path" => %r{(?<![A-Za-z0-9.+:\/-])/(?!/)[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+(?:/)?},
  "home-relative local path" => %r{(?<![A-Za-z0-9._-])~[A-Za-z0-9._-]*[\\/]},
  "Windows local path" => %r{(?:\b[A-Za-z]:(?:[\\/]|[^\\/\s])|(?<!:)//[^/\\\s]+[\\/]|\\\\[^\\/\s]+[\\/])},
  "mac temp path" => %r{/var/folders/},
  "file URL" => %r{\bfile:}i,
  "HTTP credentials" => %r{https?://[^/\s]*@}i,
  "non-HTTP URL password" => %r{\b(?!https?://)(?:[a-z][a-z0-9+.-]*://)[^/\s:@]+(?::|%3a)[^/\s@]+@}i,
  "scp-like URL password" => %r{\b[^/\s:@]+(?::|%3[aA])[^/\s@]+@[^/\s:@]+:[^\s]+},
  "GitHub token" => %r{github_pat_|ghp_|gho_|ghu_|ghs_|ghr_},
  "OpenAI key" => %r{sk-[A-Za-z0-9_-]{20,}},
  "AWS access key" => %r{\b(?:A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}\b},
  "Bearer token" => %r{\b(?:Authorization:\s*)?Bearer\s+[A-Za-z0-9._~+\/-]{20,}\b}i,
  "private key" => %r{BEGIN [A-Z ]*PRIVATE KEY}
}.freeze

class Reporter
  attr_reader :errors

  def initialize
    @errors = []
  end

  def error(message)
    @errors << message
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
  reporter.error("#{display_path(path)} could not be read: #{error.message}")
  nil
end

def load_yaml_mapping_file(path, reporter)
  parsed = load_yaml_file(path, reporter)
  return {} if parsed.nil?
  return parsed if parsed.is_a?(Hash)

  reporter.error("#{display_path(path)} top-level YAML document must be a mapping")
  {}
end

def display_path(path, root: ROOT)
  expanded = File.expand_path(path.to_s)
  root_path = File.expand_path(root.to_s)
  return "." if expanded == root_path
  return "./#{expanded.delete_prefix("#{root_path}/")}" if expanded.start_with?("#{root_path}/")

  path.to_s
end

def contains_control_characters?(value)
  value.is_a?(String) && /[\x00-\x1F\x7F]/.match?(value)
end

def valid_string?(value)
  value.is_a?(String) && !value.strip.empty? && !contains_control_characters?(value)
end

def valid_text_string?(value)
  value.is_a?(String) &&
    !value.strip.empty? &&
    !value.match?(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/)
end

def normalize_text(value)
  value.to_s.strip.split(/\s+/).join(" ")
end

def percent_decoded(value)
  URI::DEFAULT_PARSER.unescape(value.to_s)
end

def valid_path_string?(value)
  return false unless value.is_a?(String) && !value.empty?
  return false if contains_control_characters?(value)
  return false if windows_local_path?(value)
  return false if value.start_with?("~") && value != "~" && !value.start_with?("~/")

  Pathname.new(value)
  true
rescue ArgumentError
  false
end

def safe_relative_path?(value)
  return false unless valid_string?(value)
  return false if value.start_with?("/")
  return false if windows_local_path?(value) || value.include?("\\")

  path = Pathname.new(value)
  return false if path.each_filename.any? { |part| part == ".." }

  path.cleanpath.each_filename.none? { |part| part == ".." }
rescue ArgumentError
  false
end

def expand_config_path(path, base_dir:)
  value = path.to_s
  return File.expand_path(value.delete_prefix("~/"), Dir.home) if value.start_with?("~/")

  File.expand_path(value, base_dir)
end

def normalized_expanded_path(path, base_dir:)
  canonical_existing_path(expand_config_path(path, base_dir: base_dir))
rescue ArgumentError, SystemCallError
  expand_config_path(path, base_dir: base_dir)
end

def canonical_existing_path(path)
  expanded = File.expand_path(path.to_s)
  return File.realpath(expanded) if File.exist?(expanded) || File.symlink?(expanded)

  parent = expanded
  missing_parts = []
  until File.exist?(parent) || File.symlink?(parent)
    next_parent = File.dirname(parent)
    break if next_parent == parent

    missing_parts.unshift(File.basename(parent))
    parent = next_parent
  end

  parent_real = File.realpath(parent)
  File.join(parent_real, *missing_parts)
rescue SystemCallError
  expanded
end

def path_within?(path, root)
  candidate = Pathname.new(path).cleanpath.to_s
  root_path = Pathname.new(root).cleanpath.to_s
  candidate == root_path || candidate.start_with?("#{root_path}/")
end

def local_file_url?(value)
  value.is_a?(String) && /\Afile:/i.match?(value)
end

def home_relative_url?(value)
  value.is_a?(String) && value.start_with?("~")
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

def credential_bearing_scp_url?(value)
  match = scp_like_url_match(value)
  !match[:userinfo].to_s.empty? && percent_decoded(match[:userinfo]).include?(":") if match
end

def query_or_fragment_bearing_scp_url?(value)
  match = scp_like_url_match(value)
  match && (match[:path].include?("?") || match[:path].include?("#"))
end

def scp_like_url_has_repository_path?(value)
  match = scp_like_url_match(value)
  return false unless match
  return false if match[:path].include?("@")
  return false if private_host?(match[:host])
  return false if github_host?(match[:host]) && !github_repository_path?(match[:path])

  remote_repository_path?(match[:path])
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

def windows_path_fragment?(value)
  return false unless value.is_a?(String) && !value.empty?

  return true if windows_local_path?(value) || value.include?("\\")

  value.split("/").any? { |segment| windows_local_path?(segment) }
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
  return false if raw_scheme.nil? || ext_remote_url?(value)

  return true if value.to_s.match?(/\A[a-z][a-z0-9+.-]*::/i)
  return false unless scheme_url?(value)

  scheme = raw_scheme.downcase
  return true if raw_scheme != scheme

  !%w[file git http https ssh ftp ftps rsync].include?(scheme)
end

def scheme_url_authority(value)
  return nil unless scheme_url?(value)

  value.sub(/\A[a-z][a-z0-9+.-]*:\/\//i, "").split(/[\/?#]/, 2).first
end

def http_url_authority(value)
  return nil unless value.is_a?(String) && /\Ahttps?:\/\//i.match?(value)

  scheme_url_authority(value)
end

def credential_bearing_scheme_url?(value)
  uri = URI.parse(value)
  userinfo = uri.respond_to?(:userinfo) ? percent_decoded(uri.userinfo) : ""
  return false if userinfo.empty?

  !(uri.scheme.to_s.casecmp("ssh").zero? && !userinfo.include?(":"))
rescue URI::InvalidURIError
  authority = scheme_url_authority(value)
  return false if authority.nil? || authority.empty?

  match = /\A(?<userinfo>[^@]+)@/.match(authority)
  return false unless match

  scheme = url_scheme(value).to_s.downcase
  userinfo = percent_decoded(match[:userinfo])

  !(scheme == "ssh" && !userinfo.include?(":"))
end

def query_or_fragment_bearing_scheme_url?(value)
  return false unless scheme_url?(value)

  uri = URI.parse(value)
  !uri.query.to_s.empty? || !uri.fragment.to_s.empty?
rescue URI::InvalidURIError
  suffix = value.to_s.sub(/\A[a-z][a-z0-9+.-]*:\/\/[^\/?#]*/i, "")
  suffix.include?("?") || suffix.include?("#")
end

def remote_path_segments(path)
  percent_decoded(path).split("/").reject(&:empty?)
end

def remote_path_has_dot_segments?(path)
  remote_path_segments(path).any? { |segment| ["..", "."].include?(segment) }
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

def secure_manager_source_scheme?(value)
  %w[https ssh ftps].include?(url_scheme(value).to_s.downcase)
end

def github_host?(host)
  %w[github.com www.github.com].include?(normalized_host_name(host))
end

def github_repository_path?(path)
  segments = remote_path_segments(path)
  segments.length == 2 && !remote_path_has_dot_segments?(path)
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

def split_manager_source_ref(value)
  return [value, nil] unless value.is_a?(String)

  fragment_index = value.index("#")
  return [value, nil] if fragment_index.nil?

  base = value[0...fragment_index]
  fragment = value[(fragment_index + 1)..]
  return [value, nil] if base.to_s.empty? || fragment.to_s.empty?

  [base, fragment]
end

def public_manager_shorthand?(value)
  base, fragment = split_manager_source_ref(value)
  return false if value.include?("#") && fragment.nil?
  return false unless safe_relative_path?(base)
  return false if base.start_with?(".")
  return false if base.include?(":")
  return false if base.include?("?")
  return false unless base.include?("/")
  return false if remote_path_has_dot_segments?(base)
  return false unless remote_path_segments(base).length == 2
  return false if fragment && (fragment.match?(/\s/) || contains_control_characters?(fragment))

  true
end

def safe_manager_source?(value)
  return false unless value.is_a?(String) && !value.empty?
  return false if contains_control_characters?(value)
  return false if value.match?(/\s/)
  return false if value.start_with?("-")
  return false if scheme_url?(value) && query_or_fragment_bearing_scheme_url?(value)
  return false if scp_like_url?(value) && query_or_fragment_bearing_scp_url?(value)

  source_base, = split_manager_source_ref(value)
  return false if windows_local_path?(source_base) || Pathname.new(source_base).absolute?
  return false if local_file_url?(source_base) || home_relative_url?(source_base)
  return false if ext_remote_url?(source_base) || remote_helper_transport_url?(source_base)
  return false if credential_bearing_scheme_url?(source_base) || credential_bearing_scp_url?(source_base)

  if scheme_url?(source_base)
    return false unless secure_manager_source_scheme?(source_base)

    valid_http_remote_url?(source_base) || valid_remote_scheme_url?(source_base)
  elsif scp_like_url?(source_base)
    scp_like_url_has_repository_path?(source_base)
  else
    public_manager_shorthand?(value)
  end
rescue ArgumentError
  false
end

def top_level_skill_path?(value)
  return false unless safe_relative_path?(value)

  parts = Pathname.new(value).each_filename.to_a
  parts.length == 1 && parts.first == value
rescue ArgumentError
  false
end

def safe_adapter_name?(value)
  return false unless valid_string?(value)
  return false if value.start_with?("/") || windows_local_path?(value) || value.include?("\\")
  return false if [".", ".."].include?(value)

  path = Pathname.new(value)
  path.cleanpath.to_s == value &&
    path.each_filename.to_a.length == 1 &&
    path.each_filename.first == value
rescue ArgumentError
  false
end

def safe_non_path_identifier?(value)
  safe_adapter_name?(value)
end

def string_array(value, reporter, label)
  unless value.is_a?(Array)
    reporter.error("#{label} must be an array of strings")
    return []
  end

  value.each_with_index.each_with_object([]) do |(entry, index), memo|
    if valid_string?(entry)
      memo << entry
    else
      reporter.error("#{label}[#{index}] must be a non-empty string without control characters")
    end
  end
end

def valid_iso_date?(value)
  return false unless valid_string?(value)

  Date.iso8601(value).iso8601 == value
rescue ArgumentError
  false
end

def string_mapping(value, reporter, label, allow_nil: false)
  return {} if value.nil? && allow_nil
  unless value.is_a?(Hash)
    reporter.error("#{label} must be a mapping")
    return {}
  end

  value.each_with_object({}) do |(key, raw), memo|
    if valid_string?(key) && valid_string?(raw)
      memo[key] = raw
    else
      reporter.error("#{label} entries must be non-empty strings without control characters")
    end
  end.sort.to_h
end

def mapping(value, reporter, label, allow_nil: false)
  return {} if value.nil? && allow_nil
  return value if value.is_a?(Hash)

  reporter.error("#{label} must be a mapping")
  {}
end

def load_install_profile(registry_root, reporter)
  profile_path = registry_root.join(DEFAULT_INSTALL_PROFILE)
  unless profile_path.file?
    reporter.error("#{display_path(profile_path)} does not exist")
    return [{}, nil]
  end

  profile = load_yaml_file(profile_path.to_s, reporter)
  return [{}, profile_path] unless profile.is_a?(Hash)

  [profile, profile_path]
end

def matches_shared_agents_user_root?(value, base_dir:)
  return false unless valid_string?(value)

  expand_config_path(value, base_dir: base_dir) == SHARED_AGENTS_USER_ROOT
rescue ArgumentError
  false
end

def matches_claude_user_root?(value, base_dir:)
  return false unless valid_string?(value)

  expand_config_path(value, base_dir: base_dir) == CLAUDE_USER_ROOT
rescue ArgumentError
  false
end

def normalized_consumer_roots(raw_consumer_roots, profile_path, reporter)
  unless raw_consumer_roots.is_a?(Hash)
    reporter.error("#{display_path(profile_path)} consumer_roots must be a mapping")
    return {}
  end

  raw_consumer_roots.each_with_object({}) do |(consumer, raw_config), memo|
    unless valid_string?(consumer)
      reporter.error("#{display_path(profile_path)} consumer_roots keys must be non-empty strings")
      next
    end
    unless safe_non_path_identifier?(consumer)
      reporter.error("#{display_path(profile_path)} consumer_roots keys must be safe non-path identifiers")
      next
    end
    unless raw_config.is_a?(Hash)
      reporter.error("#{display_path(profile_path)} consumer_roots.#{consumer} must be a mapping")
      next
    end

    path = raw_config["path"]
    if windows_path_fragment?(path)
      reporter.error("#{display_path(profile_path)} consumer_roots.#{consumer} path must not be a local Windows path")
      next
    end
    unless valid_path_string?(path)
      reporter.error("#{display_path(profile_path)} consumer_roots.#{consumer} path must be a non-empty valid path")
      next
    end

    raw_adapter = raw_config["adapter"]
    adapter =
      if raw_adapter.nil? || (raw_adapter.is_a?(String) && raw_adapter.empty?)
        "symlink"
      else
        raw_adapter
      end
    unless adapter.is_a?(String)
      reporter.error("#{display_path(profile_path)} consumer_roots.#{consumer} adapter must be a string when provided")
      next
    end
    if contains_control_characters?(adapter)
      reporter.error("#{display_path(profile_path)} consumer_roots.#{consumer} adapter must not contain control characters")
      next
    end
    unless adapter.empty? || safe_non_path_identifier?(adapter)
      reporter.error("#{display_path(profile_path)} consumer_roots.#{consumer} adapter must be a safe non-path identifier")
      next
    end

    memo[consumer] = raw_config.merge("adapter" => adapter)
  end
end

def normalized_consumer_overrides(raw_overrides, profile_path, skill_id, expose_to, normalized_roots, reporter)
  return nil if raw_overrides.nil?

  unless raw_overrides.is_a?(Hash)
    reporter.error("#{display_path(profile_path)} #{skill_id} consumer_overrides must be a mapping")
    return nil
  end

  raw_overrides.each_with_object({}) do |(consumer, raw_override), memo|
    unless valid_string?(consumer)
      reporter.error("#{display_path(profile_path)} #{skill_id} consumer_overrides keys must be non-empty strings")
      next
    end
    unless safe_non_path_identifier?(consumer)
      reporter.error("#{display_path(profile_path)} #{skill_id} consumer_overrides keys must be safe non-path identifiers")
      next
    end
    unless expose_to.include?(consumer)
      reporter.error("#{display_path(profile_path)} #{skill_id} consumer_overrides.#{consumer} must target an exposed consumer")
    end
    unless normalized_roots.key?(consumer)
      reporter.error("#{display_path(profile_path)} #{skill_id} consumer_overrides.#{consumer} targets unknown consumer #{consumer}")
    end
    unless raw_override.is_a?(Hash)
      reporter.error("#{display_path(profile_path)} #{skill_id} consumer_overrides.#{consumer} must be a mapping")
      next
    end

    unsupported_keys = raw_override.keys - %w[adapter status]
    unless unsupported_keys.empty?
      reporter.error("#{display_path(profile_path)} #{skill_id} consumer_overrides.#{consumer} supports only adapter and status")
      next
    end

    normalized = {}
    %w[adapter status].each do |key|
      next unless raw_override.key?(key)

      value = raw_override[key]
      unless value.is_a?(String) && !value.empty?
        reporter.error("#{display_path(profile_path)} #{skill_id} consumer_overrides.#{consumer}.#{key} must be a non-empty string")
        next
      end
      if contains_control_characters?(value)
        reporter.error("#{display_path(profile_path)} #{skill_id} consumer_overrides.#{consumer}.#{key} must not contain control characters")
        next
      end
      unless safe_non_path_identifier?(value)
        reporter.error("#{display_path(profile_path)} #{skill_id} consumer_overrides.#{consumer}.#{key} must be a safe non-path identifier")
        next
      end

      normalized[key] = value
    end

    memo[consumer] = normalized unless normalized.empty?
  end
end

def effective_consumer_config(root_config, overrides, consumer)
  return root_config unless root_config.is_a?(Hash)

  override = overrides.is_a?(Hash) ? overrides[consumer] : nil
  override.is_a?(Hash) ? root_config.merge(override) : root_config
end

def approved_codex_global_install_ids(profile, profile_path, registry_skill_ids, reporter)
  return {} unless profile.is_a?(Hash)
  return {} if profile_path.nil?

  starting_error_count = reporter.errors.length
  profile_base_dir = File.dirname(profile_path)
  profile_status = profile["status"]
  if !profile_status.nil? && !profile_status.is_a?(String)
    reporter.error("#{display_path(profile_path)} status must be a string when provided")
  end
  profile_metadata = mapping(profile["profile"], reporter, "#{display_path(profile_path)} profile", allow_nil: true)
  profile_id = profile_metadata["id"]
  reporter.error("#{display_path(profile_path)} profile.id is required") unless valid_string?(profile_id)
  if valid_string?(profile_id) && !safe_non_path_identifier?(profile_id)
    reporter.error("#{display_path(profile_path)} profile.id must be a safe non-path identifier")
  end
  consumer_roots = normalized_consumer_roots(profile["consumer_roots"], profile_path, reporter)
  consumer_root_keys = consumer_roots.each_with_object({}) do |(consumer, config), memo|
    memo[consumer] = normalized_expanded_path(config["path"], base_dir: profile_base_dir) if valid_string?(config["path"])
  end

  agents_root = consumer_roots["agents_user"]
  shared_agents_root = agents_root.is_a?(Hash) &&
    matches_shared_agents_user_root?(agents_root["path"], base_dir: profile_base_dir)

  selected_skills = profile["selected_skills"]
  unless selected_skills.is_a?(Array)
    reporter.error("#{display_path(profile_path)} selected_skills must be an array")
    return {}
  end

  seen_active_agents_user_skill_ids = {}
  seen_selected_skill_targets = {}

  installable_skills = selected_skills.each_with_object({}) do |entry, memo|
    unless entry.is_a?(Hash) && valid_string?(entry["skill_id"])
      reporter.error("#{display_path(profile_path)} selected_skills entries must include non-empty skill_id")
      next
    end
    unless registry_skill_ids.key?(entry["skill_id"])
      reporter.error("#{display_path(profile_path)} selected skill #{entry["skill_id"]} is not in registry")
      next
    end
    unless registry_skill_ids[entry["skill_id"]] == "active"
      reporter.error(
        "#{display_path(profile_path)} selected skill #{entry["skill_id"]} " \
        "has non-active registry status #{registry_skill_ids[entry["skill_id"]]}"
      )
      next
    end

    expose_to = string_array(entry["expose_to"], reporter, "#{display_path(profile_path)} #{entry["skill_id"]} expose_to")
    reporter.error("#{display_path(profile_path)} #{entry["skill_id"]} expose_to must list at least one consumer") if expose_to.empty?
    seen_expose_to_consumers = {}
    expose_to.each do |consumer|
      unless safe_non_path_identifier?(consumer)
        reporter.error("#{display_path(profile_path)} #{entry["skill_id"]} expose_to entries must be safe non-path identifiers")
        next
      end
      if seen_expose_to_consumers[consumer]
        reporter.error("#{display_path(profile_path)} #{entry["skill_id"]} expose_to must not list duplicate consumers")
      else
        seen_expose_to_consumers[consumer] = true
      end
      reporter.error("#{display_path(profile_path)} #{entry["skill_id"]} exposes to unknown consumer #{consumer}") unless consumer_roots.key?(consumer)
    end
    overrides = normalized_consumer_overrides(
      entry["consumer_overrides"],
      profile_path,
      entry["skill_id"],
      expose_to,
      consumer_roots,
      reporter
    )
    state = entry["state"]
    if !state.nil? && !state.is_a?(String)
      reporter.error("#{display_path(profile_path)} #{entry["skill_id"]} state must be a string when provided")
    elsif state.is_a?(String) && !state.empty? && !safe_non_path_identifier?(state)
      reporter.error("#{display_path(profile_path)} #{entry["skill_id"]} state must be a safe non-path identifier")
    end
    expose_to.each do |consumer|
      next unless safe_non_path_identifier?(consumer) && consumer_roots.key?(consumer)

      key = [entry["skill_id"], consumer_root_keys[consumer]]
      existing_target = seen_selected_skill_targets[key]
      duplicate_active_agents_user = existing_target &&
        consumer == "agents_user" &&
        state.to_s == "active" &&
        existing_target[:consumer] == "agents_user" &&
        existing_target[:state] == "active"
      if existing_target
        unless duplicate_active_agents_user
          if existing_target[:consumer] == consumer
            reporter.error("#{display_path(profile_path)} duplicate selected target for skill_id #{entry["skill_id"]} and consumer #{consumer}")
          else
            reporter.error(
              "#{display_path(profile_path)} duplicate selected target for skill_id #{entry["skill_id"]} " \
              "because consumers #{existing_target[:consumer]} and #{consumer} share the same expanded root"
            )
          end
        end
      else
        seen_selected_skill_targets[key] = { consumer: consumer, state: state.to_s }
      end
    end
    next unless state.to_s == "active"
    next unless registry_skill_ids[entry["skill_id"]] == "active"
    next unless expose_to.is_a?(Array) && expose_to.include?("agents_user")
    if seen_active_agents_user_skill_ids[entry["skill_id"]]
      reporter.error("#{display_path(profile_path)} duplicate active agents_user selection for skill_id #{entry["skill_id"]}")
      next
    end

    seen_active_agents_user_skill_ids[entry["skill_id"]] = true
    effective_agents_config = effective_consumer_config(agents_root, overrides, "agents_user")
    next unless effective_agents_config.is_a?(Hash)
    next unless effective_agents_config["adapter"] == "manager-copy"
    next unless effective_agents_config["status"] == "proven-manager-copy"

    memo[entry["skill_id"]] = true
  end

  return {} if reporter.errors.length > starting_error_count
  return {} unless shared_agents_root

  installable_skills
end

def approved_claude_code_global_install_ids(profile, profile_path, registry_skill_ids, reporter)
  return {} unless profile.is_a?(Hash)
  return {} if profile_path.nil?
  return {} unless reporter.errors.empty?

  starting_error_count = reporter.errors.length
  profile_base_dir = File.dirname(profile_path)
  consumer_roots = normalized_consumer_roots(profile["consumer_roots"], profile_path, reporter)
  claude_root = consumer_roots["claude_user"]
  return {} unless claude_root.is_a?(Hash)
  return {} unless matches_claude_user_root?(claude_root["path"], base_dir: profile_base_dir)

  selected_skills = profile["selected_skills"]
  unless selected_skills.is_a?(Array)
    reporter.error("#{display_path(profile_path)} selected_skills must be an array")
    return {}
  end

  installable_skills = selected_skills.each_with_object({}) do |entry, memo|
    next unless entry.is_a?(Hash) && valid_string?(entry["skill_id"])
    next unless registry_skill_ids[entry["skill_id"]] == "active"

    expose_to = string_array(entry["expose_to"], reporter, "#{display_path(profile_path)} #{entry["skill_id"]} expose_to")
    next unless expose_to.include?("claude_user")
    next unless entry["state"].to_s == "active"

    overrides = normalized_consumer_overrides(
      entry["consumer_overrides"],
      profile_path,
      entry["skill_id"],
      expose_to,
      consumer_roots,
      reporter
    )
    effective_claude_config = effective_consumer_config(claude_root, overrides, "claude_user")
    next unless effective_claude_config.is_a?(Hash)
    next unless effective_claude_config["adapter"] == "manager-copy"
    next unless effective_claude_config["status"] == "proven-manager-copy"

    memo[entry["skill_id"]] = true
  end

  return {} if reporter.errors.length > starting_error_count

  installable_skills
end

def frontmatter(path, reporter)
  lines = File.readlines(path, chomp: true)
  unless lines.first == "---"
    reporter.error("#{display_path(path)} is missing YAML front matter")
    return {}
  end

  closing = lines[1..]&.index("---")
  unless closing
    reporter.error("#{display_path(path)} has unterminated YAML front matter")
    return {}
  end

  frontmatter_lines = lines[1, closing]
  if unquoted_description_comment?(frontmatter_lines)
    reporter.error("#{display_path(path)} front matter description contains an unquoted #; quote the value or use a block scalar")
    return {}
  end

  metadata = YAML.safe_load(frontmatter_lines.join("\n"), aliases: false, filename: path) || {}
  return metadata if metadata.is_a?(Hash)

  reporter.error("#{display_path(path)} front matter must be a mapping")
  {}
rescue Psych::Exception => error
  reporter.error("#{display_path(path)} front matter is not valid YAML: #{error.message}")
  {}
rescue SystemCallError => error
  reporter.error("#{display_path(path)} could not be read: #{error.message}")
  {}
end

def unquoted_description_comment?(frontmatter_lines)
  frontmatter_lines.each_with_index do |line, index|
    match = DESCRIPTION_FRONTMATTER_KEY_PATTERN.match(line)
    next unless match

    value = match[:value].lstrip
    plain_continuation_lines = description_plain_continuation_lines(frontmatter_lines, index, match[:indent].length)
    next unless description_value_has_unquoted_comment?(value, plain_continuation_lines)

    return true
  end

  false
end

def description_value_has_unquoted_comment?(value, continuation_lines)
  return false if value.start_with?("|", ">")

  value_lines = []
  value_lines << value unless value.empty?
  value_lines.concat(continuation_lines)
  return false if value_lines.empty?

  quoted_style = value_lines.first.start_with?("\"", "'") ? value_lines.first[0] : nil
  in_quote = quoted_style
  first_line = true

  value_lines.each do |line|
    index = quoted_style && first_line ? 1 : 0
    first_line = false

    while index < line.length
      char = line[index]
      case in_quote
      when "\""
        if char == "\""
          backslash_count = 0
          cursor = index - 1
          while cursor >= 0 && line[cursor] == "\\"
            backslash_count += 1
            cursor -= 1
          end
          in_quote = nil if backslash_count.even?
        end
      when "'"
        next_char = line[index + 1]
        if char == "'" && next_char == "'"
          index += 1
        elsif char == "'"
          in_quote = nil
        end
      else
        return true if char == "#" && (index.zero? || line[index - 1].match?(/[[:space:]]/))
      end

      index += 1
    end
  end

  false
end

def description_plain_continuation_lines(frontmatter_lines, start_index, description_indent)
  continuation_lines = []

  frontmatter_lines[(start_index + 1)..]&.each do |line|
    if line.strip.empty?
      continuation_lines << line
      next
    end

    break if line[/\A[ \t]*/].length <= description_indent

    continuation_lines << line.lstrip
  end

  continuation_lines
end

def valid_sha256_hex?(value)
  value.is_a?(String) && /\A[0-9a-f]{64}\z/i.match?(value)
end

def valid_git_object_id?(value)
  value.is_a?(String) && /\A(?:[0-9a-f]{40}|[0-9a-f]{64})\z/i.match?(value) && !value.match?(/\A0+\z/)
end

def valid_git_tag_name?(value)
  return false unless value.is_a?(String) && !value.empty?
  return false if value.start_with?("refs/")

  system("git", "check-ref-format", "refs/tags/#{value}", out: File::NULL, err: File::NULL)
rescue SystemCallError, ArgumentError
  false
end

def installer_excluded_entry?(entry, directory:)
  name = File.basename(entry.to_s)
  return true if INSTALLER_EXCLUDED_FILES.include?(name)

  directory && INSTALLER_EXCLUDED_DIRS.include?(name)
end

def directory_digest(dir, reporter)
  digest = Digest::SHA256.new
  files = []
  invalid = false

  Find.find(dir) do |entry|
    if installer_excluded_entry?(entry, directory: File.directory?(entry))
      Find.prune if File.directory?(entry)
      next
    end

    if File.symlink?(entry)
      reporter.error("#{display_path(entry)} must not be a symlink")
      invalid = true
      Find.prune if File.directory?(entry)
      next
    end

    next if File.directory?(entry)

    unless File.file?(entry)
      reporter.error("#{display_path(entry)} must be a regular file")
      invalid = true
      next
    end

    files << entry
  end

  return nil if invalid

  files.sort.each do |file|
    relative = Pathname.new(file).relative_path_from(Pathname.new(dir)).to_s
    digest.update(relative)
    digest.update("\0")
    digest.update(format("%03o", File.stat(file).mode & 0o111))
    digest.update("\0")
    digest.update(File.binread(file))
    digest.update("\0")
  end

  digest.hexdigest
rescue SystemCallError => error
  reporter.error("#{display_path(dir)} could not be hashed cleanly: #{error.message}")
  nil
end

def index_lock_entries(lock, reporter)
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
    unless safe_non_path_identifier?(skill_id)
      reporter.error("skills.lock.yaml entries must use safe non-path identifiers")
      next
    end
    reporter.error("skills.lock.yaml duplicate lock entry #{skill_id}") if memo.key?(skill_id)
    memo[skill_id] = entry
  end
end

def require_lock_field(lock_entry, skill_id, field, reporter)
  value = lock_entry[field]
  reporter.error("#{skill_id}: lock #{field} is required") unless valid_string?(value)
  value.to_s
end

def compare_lock_field(lock_entry, skill_id, field, expected, reporter)
  actual = lock_entry[field]
  if field == "observed_commit" && valid_git_object_id?(actual) && valid_git_object_id?(expected)
    return if actual.casecmp?(expected)
  else
    return if actual == expected
  end

  reporter.error("#{skill_id}: lock #{field} differs from registry metadata")
end

def compare_lock_array(lock_entry, skill_id, field, expected, reporter)
  actual = lock_entry[field]
  return if actual == expected

  reporter.error("#{skill_id}: lock #{field} differs from registry metadata")
end

def install_command(manager_source, skill_name, agent:)
  Shellwords.join([
                    "npx",
                    "--yes",
                    DEFAULT_SKILLS_CLI_PACKAGE,
                    "add",
                    manager_source,
                    "--skill",
                    skill_name,
                    "--agent",
                    agent,
                    "--global",
                    "--yes"
                  ])
end

def catalog_description(skill, metadata, source_type)
  catalog = skill["catalog"]
  if source_type == "external-git" && catalog.is_a?(Hash) && valid_text_string?(catalog["description"])
    return normalize_text(catalog["description"])
  end

  description = metadata["description"]
  return normalize_text(description) if valid_text_string?(description)

  ""
end

def catalog_name(skill, metadata, exported_names, source_type)
  catalog = skill["catalog"]
  if source_type == "external-git" && catalog.is_a?(Hash) && valid_string?(catalog["name"])
    return catalog["name"].strip
  end

  name = metadata["name"]
  return name.strip if valid_string?(name)

  exported_names.first || skill["id"]
end

def manager_selected_skill_name(metadata)
  return nil unless metadata.is_a?(Hash) && valid_string?(metadata["name"])

  name = metadata["name"].strip
  return nil unless safe_adapter_name?(name)

  name
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

def build_catalog(registry, lock, registry_path, lock_path, reporter)
  registry_root = Pathname.new(File.dirname(File.expand_path(registry_path))).cleanpath
  registry_metadata = mapping(registry["registry"], reporter, "registry metadata")
  registry_id = registry_metadata["id"]
  registry_name = registry_metadata["name"]
  registry_status = registry["status"]
  manager_source = registry_metadata["manager_source"]
  raw_skills = registry["skills"]

  if !valid_string?(registry_id)
    reporter.error("registry.id is required")
  elsif !safe_non_path_identifier?(registry_id)
    reporter.error("registry.id must be a safe non-path identifier")
  end
  reporter.error("registry.name is required") unless valid_string?(registry_name)
  reporter.error("registry.status is required") unless valid_string?(registry_status)
  unless raw_skills.is_a?(Array)
    reporter.error("skills.registry.yaml skills must be an array")
    raw_skills = []
  end
  if registry_status == FINALIZED_REGISTRY_STATUS
    pending_ids = raw_skills.map do |entry|
      next unless entry.is_a?(Hash)

      entry["id"] if PENDING_SKILL_STATUSES.include?(entry["status"])
    end.compact
    unless pending_ids.empty?
      reporter.error("registry status #{FINALIZED_REGISTRY_STATUS} cannot contain pending skill dispositions: #{pending_ids.join(', ')}")
    end
  end
  registry_skill_ids = raw_skills.each_with_object({}) do |entry, memo|
    next unless entry.is_a?(Hash) && safe_non_path_identifier?(entry["id"])

    memo[entry["id"]] = entry["status"]
  end
  install_profile, install_profile_path = load_install_profile(registry_root, reporter)
  installable_codex_skills = approved_codex_global_install_ids(
    install_profile,
    install_profile_path,
    registry_skill_ids,
    reporter
  )
  installable_claude_code_skills = approved_claude_code_global_install_ids(
    install_profile,
    install_profile_path,
    registry_skill_ids,
    reporter
  )

  lock_by_id = index_lock_entries(lock, reporter)
  catalog_skills = []
  seen_skill_ids = {}
  seen_exported_names = {}
  seen_registry_local_source_paths = {}
  lockable_skill_ids = []
  manager_source_required = false

  raw_skills.each_with_index do |skill, index|
    unless skill.is_a?(Hash)
      reporter.error("skills[#{index}] must be a mapping")
      next
    end

    skill_id = skill["id"]
    unless valid_string?(skill_id)
      reporter.error("skills[#{index}].id is required")
      next
    end
    unless safe_non_path_identifier?(skill_id)
      reporter.error("skills[#{index}].id must be a safe non-path identifier")
      next
    end
    if seen_skill_ids.key?(skill_id)
      reporter.error("duplicate skill id #{skill_id}")
      next
    end
    seen_skill_ids[skill_id] = true

    status = skill["status"]
    reporter.error("#{skill_id}: status is required") unless valid_string?(status)
    if valid_string?(status) && !SKILL_STATUSES.include?(status)
      reporter.error("#{skill_id}: status must be one of #{SKILL_STATUSES.join(', ')}")
    end
    source = mapping(skill["source"], reporter, "#{skill_id}: source")
    source_type = source["type"]
    if status == "needs-source-review" && source_type != "unresolved-local"
      reporter.error("#{skill_id}: needs-source-review status requires source.type unresolved-local")
    end
    if status == "needs-import-review" && source_type != "external-git"
      reporter.error("#{skill_id}: needs-import-review status requires source.type external-git")
    end
    if source_type == "unresolved-local"
      %w[exported_names clients scopes].each do |field|
        reporter.error("#{skill_id}: unresolved-local entries must not define #{field}") if skill.key?(field)
      end
    end
    exported_names = source_type == "unresolved-local" && skill["exported_names"].nil? ? [] :
      string_array(skill["exported_names"], reporter, "#{skill_id}: exported_names")
    exported_names.each do |name|
      reporter.error("#{skill_id}: exported_names entries must be safe adapter names") unless safe_adapter_name?(name)
      if safe_adapter_name?(name) && seen_exported_names.key?(name)
        reporter.error("#{skill_id}: exported adapter name #{name} is duplicated")
      else
        seen_exported_names[name] = skill_id if safe_adapter_name?(name)
      end
    end
    reporter.error("#{skill_id}: exported_names must not be empty") if source_type != "unresolved-local" && exported_names.empty?
    clients = string_mapping(skill["clients"], reporter, "#{skill_id}: clients", allow_nil: true)
    reporter.error("#{skill_id}: clients values must be safe non-path identifiers") unless clients.values.all? { |value| safe_non_path_identifier?(value) }
    scopes = source_type == "unresolved-local" && skill["scopes"].nil? ? [] :
      string_array(skill["scopes"], reporter, "#{skill_id}: scopes")
    update_policy = skill["update_policy"]
    reporter.error("#{skill_id}: update_policy is required") if source_type != "unresolved-local" && !valid_string?(update_policy)

    lockable = %w[registry-local external-git].include?(source_type) && status != "legacy"
    lockable_skill_ids << skill_id if lockable
    lock_entry = lockable ? lock_by_id[skill_id] : nil
    if lockable && lock_entry.nil?
      reporter.error("#{skill_id}: missing lock entry")
      lock_entry = {}
    end
    compare_lock_field(lock_entry, skill_id, "source_type", source_type, reporter) if lockable
    compare_lock_array(lock_entry, skill_id, "exported_names", exported_names, reporter) if lockable

    metadata = {}
    source_catalog = nil
    lock_catalog = nil

    case source_type
    when "registry-local"
      source_path = source["path"]
      source_valid = top_level_skill_path?(source_path)
      unless source_valid
        reporter.error("#{skill_id}: registry-local source.path must name a top-level skill directory")
      end
      if source_valid && seen_registry_local_source_paths.key?(source_path)
        reporter.error("#{skill_id}: registry-local source.path #{source_path} is already declared by #{seen_registry_local_source_paths[source_path]}")
        next
      end
      seen_registry_local_source_paths[source_path] = skill_id if source_valid

      skill_root = source_valid ? registry_root.join(source_path) : nil
      skill_file = skill_root&.join("SKILL.md")
      metadata = skill_file ? frontmatter(skill_file.to_s, reporter) : {}
      if skill_file&.file? && !valid_string?(metadata["name"])
        reporter.error("#{skill_id}: registry-local SKILL.md front matter name is required")
      end
      if skill_file&.file? && !valid_text_string?(metadata["description"])
        reporter.error("#{skill_id}: registry-local SKILL.md front matter description is required")
      end
      if lockable
        digest = require_lock_field(lock_entry, skill_id, "digest_sha256", reporter)
        reporter.error("#{skill_id}: lock digest_sha256 must be a 64-character SHA-256") unless digest.empty? || valid_sha256_hex?(digest)
        current_digest = directory_digest(skill_root.to_s, reporter) if skill_root&.directory?
        if valid_sha256_hex?(digest) && current_digest && digest != current_digest
          reporter.error("#{skill_id}: lock digest_sha256 differs from registry-local source contents")
        end
        compare_lock_field(lock_entry, skill_id, "path", source_path, reporter)
        lock_catalog = {
          "source_type" => "registry-local",
          "path" => lock_entry["path"],
          "digest_sha256" => digest
        }
      end
      source_catalog = {
        "type" => "registry-local",
        "path" => source_path
      }
    when "external-git"
      url = source["url"]
      path = source["path"]
      pinned_tag = source["pinned_tag"]
      observed_commit = source["observed_commit"]
      observed_at = source["observed_at"]

      reporter.error("#{skill_id}: external-git source.url must be a public, credential-free URL") unless external_git_url_public?(url)
      reporter.error("#{skill_id}: external-git source.path must be a safe relative path") unless safe_relative_path?(path)
      reporter.error("#{skill_id}: external-git source.pinned_tag is required") unless valid_string?(pinned_tag)
      if valid_string?(pinned_tag) && !valid_git_tag_name?(pinned_tag)
        reporter.error("#{skill_id}: external-git source.pinned_tag must be an exact tag name")
      end
      reporter.error("#{skill_id}: external-git source.observed_commit must be a full git object id") unless valid_git_object_id?(observed_commit)
      if !valid_string?(observed_at)
        reporter.error("#{skill_id}: external-git source.observed_at is required")
      elsif !valid_iso_date?(observed_at)
        reporter.error("#{skill_id}: external-git source.observed_at must be an ISO date (YYYY-MM-DD)")
      end

      if lockable
        %w[url path pinned_tag observed_commit].each do |field|
          require_lock_field(lock_entry, skill_id, field, reporter)
          compare_lock_field(lock_entry, skill_id, field, source[field], reporter)
        end
        if valid_string?(lock_entry["pinned_tag"]) && !valid_git_tag_name?(lock_entry["pinned_tag"])
          reporter.error("#{skill_id}: lock pinned_tag must be an exact tag name")
        end
        lock_catalog = {
          "source_type" => "external-git",
          "url" => lock_entry["url"],
          "path" => lock_entry["path"],
          "pinned_tag" => lock_entry["pinned_tag"],
          "observed_commit" => lock_entry["observed_commit"]
        }
      end

      source_catalog = {
        "type" => "external-git",
        "url" => url,
        "path" => path,
        "pinned_tag" => pinned_tag,
        "observed_commit" => observed_commit,
        "observed_at" => observed_at
      }
    when "unresolved-local"
      unless UNRESOLVED_LOCAL_STATUSES.include?(status)
        reporter.error("#{skill_id}: unresolved-local source requires status needs-source-review or legacy")
      end
      source_path = source["path"]
      source_valid = top_level_skill_path?(source_path)
      unless source_valid
        reporter.error("#{skill_id}: unresolved-local source.path must name a top-level skill directory")
      end
      if source_valid && seen_registry_local_source_paths.key?(source_path)
        reporter.error("#{skill_id}: local source.path #{source_path} is already declared by #{seen_registry_local_source_paths[source_path]}")
        next
      end
      seen_registry_local_source_paths[source_path] = skill_id if source_valid

      skill_root = source_valid ? registry_root.join(source_path) : nil
      skill_file = skill_root&.join("SKILL.md")
      if skill_root&.symlink?
        reporter.error("#{skill_id}: unresolved-local source.path must not be a symlink")
      elsif !skill_file&.file?
        reporter.error("#{skill_id}: #{source_path}/SKILL.md is missing") if source_valid
      else
        metadata = frontmatter(skill_file.to_s, reporter)
        reporter.error("#{skill_id}: unresolved-local SKILL.md front matter name is required") unless valid_string?(metadata["name"])
      end
      source_catalog = {
        "type" => "unresolved-local",
        "path" => source_path
      }
    else
      reporter.error("#{skill_id}: source.type must be registry-local, external-git, or unresolved-local")
    end

    name = catalog_name(skill, metadata, exported_names, source_type)
    description = catalog_description(skill, metadata, source_type)
    manager_skill_name = source_type == "registry-local" ? manager_selected_skill_name(metadata) : nil
    reporter.error("#{skill_id}: catalog description is required") unless valid_string?(description)

    install = nil
    installable_by_manager = source_type == "registry-local" &&
                             status == "active" &&
                             scopes.include?("machine") &&
                             exported_names == [manager_skill_name]
    installable_for_codex = installable_by_manager &&
                            clients["codex"] == "supported" &&
                            installable_codex_skills[skill_id]
    installable_for_claude_code = installable_by_manager &&
                                  clients["claude"] == "supported" &&
                                  installable_claude_code_skills[skill_id]
    manager_source_required ||= installable_for_codex || installable_for_claude_code
    if safe_manager_source?(manager_source) && (installable_for_codex || installable_for_claude_code)
      install = {
        "manager_package" => DEFAULT_SKILLS_CLI_PACKAGE,
        "registry_source" => manager_source,
        "skill" => manager_skill_name
      }
      install["codex_global_command"] = install_command(manager_source, manager_skill_name, agent: "codex") if installable_for_codex
      install["claude_code_global_command"] = install_command(manager_source, manager_skill_name, agent: "claude-code") if installable_for_claude_code
    end

    entry = {
      "id" => skill_id,
      "name" => name,
      "description" => description,
      "status" => status,
      "source" => source_catalog,
      "update_policy" => source_type == "unresolved-local" ? "review-required" : update_policy
    }
    if lockable
      entry["exported_names"] = exported_names
      entry["clients"] = clients
      entry["scopes"] = scopes
      entry["lock"] = lock_catalog
    end
    entry["install"] = install if install
    catalog_skills << entry
  end

  top_level_skill_paths = Dir.glob(registry_root.join("*/SKILL.md").to_s).map do |path|
    Pathname.new(path).dirname.basename.to_s
  end.sort
  (top_level_skill_paths - seen_registry_local_source_paths.keys).each do |source_path|
    reporter.error("#{source_path}/SKILL.md has no registry disposition")
  end
  stale_locks = lock_by_id.keys - lockable_skill_ids
  stale_locks.sort.each do |skill_id|
    if seen_skill_ids.key?(skill_id)
      reporter.error("skills.lock.yaml stale lock entry #{skill_id} is not lockable in skills.registry.yaml")
    else
      reporter.error("skills.lock.yaml stale lock entry #{skill_id} is not present in skills.registry.yaml")
    end
  end

  if !manager_source.nil? && !manager_source.is_a?(String)
    reporter.error("registry.manager_source must be a string")
  elsif manager_source.is_a?(String) && !manager_source.empty?
    reporter.error("registry.manager_source must be a public-safe skills source") unless safe_manager_source?(manager_source)
  elsif manager_source_required
    reporter.error("registry.manager_source is required for public install commands")
  end

  registry_catalog = {
    "id" => registry_id,
    "name" => registry_name,
    "status" => registry_status,
    "source_files" => [
      Pathname.new(registry_path).relative_path_from(registry_root).to_s,
      Pathname.new(lock_path).relative_path_from(registry_root).to_s,
      install_profile_path && install_profile_path.relative_path_from(registry_root).to_s
    ].compact
  }
  registry_catalog["manager_source"] = manager_source if safe_manager_source?(manager_source)

  catalog = {
    "schema_version" => CATALOG_SCHEMA_VERSION,
    "generated_by" => GENERATOR,
    "registry" => registry_catalog,
    "skills" => catalog_skills
  }

  catalog
end

def json_document(catalog)
  "#{JSON.pretty_generate(catalog)}\n"
end

def md_escape(value)
  value.to_s.gsub("|", "\\|").gsub("\n", " ")
end

def code_span(value)
  "`#{md_escape(value)}`"
end

def markdown_document(catalog)
  registry = catalog.fetch("registry")
  skills = catalog.fetch("skills")
  active_installable = skills.select { |skill| skill.key?("install") }
  lines = []

  lines << "# Skills Catalog"
  lines << ""
  lines << "This file is generated. Edit `skills.registry.yaml`,"
  lines << "`profiles/machine/example-local-skills.yaml`, or registered `SKILL.md`"
  lines << "front matter, refresh `skills.lock.yaml` if source contents changed, then run"
  lines << "`scripts/skills_catalog.rb --write`."
  lines << ""
  lines << "- Registry: #{registry.fetch("name")} (#{code_span(registry.fetch("id"))})"
  lines << "- Status: #{code_span(registry.fetch("status"))}"
  if registry.key?("manager_source")
    lines << "- Manager source: #{code_span(registry.fetch("manager_source"))}"
  else
    lines << "- Manager source: not required for this catalog"
  end
  lines << "- Covered skills: #{skills.length}"
  lines << ""
  lines << "## Registry-Covered Skills"
  lines << ""
  lines << "| Skill | Status | Source | Exports | Clients | Scopes | Update Policy | Description |"
  lines << "| --- | --- | --- | --- | --- | --- | --- | --- |"

  skills.each do |skill|
    source = skill.fetch("source")
    source_label =
      if source.fetch("type") == "external-git"
        "external-git:#{source.fetch("path")}@#{source.fetch("pinned_tag")}"
      else
        "#{source.fetch("type")}:#{source.fetch("path")}"
      end
    clients = (skill["clients"] || {}).map { |client, status| "#{client}=#{status}" }.join(", ")
    lines << [
      code_span(skill.fetch("id")),
      code_span(skill.fetch("status")),
      code_span(source_label),
      Array(skill["exported_names"]).map { |name| code_span(name) }.join(", "),
      md_escape(clients),
      Array(skill["scopes"]).map { |scope| code_span(scope) }.join(", "),
      code_span(skill.fetch("update_policy")),
      md_escape(skill.fetch("description"))
    ].join(" | ").prepend("| ") + " |"
  end

  lines << ""
  lines << "## Installable Active Skills"
  lines << ""
  if active_installable.empty?
    lines << "No active supported skills currently emit public install commands."
  else
    lines << "The commands below use the pinned upstream skills manager package"
    lines << "for the current reviewed example profile. `--agent codex` commands"
    lines << "target the proven shared manager root; verify OpenCode visibility with"
    lines << "the upstream global list. `--agent claude-code` commands target the"
    lines << "separate proven Claude Code root for skills that explicitly carry that"
    lines << "profile proof."
    lines << ""
    lines << "```bash"
    active_installable.each do |skill|
      install = skill.fetch("install")
      lines << install.fetch("codex_global_command") if install.key?("codex_global_command")
      lines << install.fetch("claude_code_global_command") if install.key?("claude_code_global_command")
    end
    lines << "```"
  end

  lines << ""
  lines.join("\n")
end

def public_safety_scan(text, label, reporter)
  PUBLIC_UNSAFE_PATTERNS.each do |name, pattern|
    reporter.error("#{label} contains #{name}") if text.match?(pattern)
  end

  reporter.error("#{label} contains private or loopback URL") if contains_private_url?(text)
end

def trim_url_candidate(value)
  value.to_s.sub(/[),.;:!?]+$/, "")
end

def host_from_scheme_url(value)
  uri = URI.parse(value)
  return nil if uri.host.to_s.empty?

  uri.host
rescue URI::InvalidURIError
  authority = scheme_url_authority(value)
  return nil if authority.to_s.empty?

  host_port = authority.split("@").last.to_s
  return host_port[1..host_port.index("]") - 1] if host_port.start_with?("[") && host_port.include?("]")

  host_port.split(":", 2).first
end

def host_from_private_scp_candidate(value)
  match = /\A(?:(?<userinfo>[^\/@\s]+)@)?(?<host>\[[^\]]+\]|[^\/:\s]+):(?<path>[^\s]+)\z/.match(value.to_s)
  return nil unless match
  return nil if match[:path].to_s.empty? || match[:path].include?("@")

  host = match[:host]
  host if private_host?(host)
end

def contains_private_url?(text)
  text.to_s.scan(%r{\b[a-z][a-z0-9+.-]*://[^\s<>"'`|]+}i).any? do |candidate|
    host = host_from_scheme_url(trim_url_candidate(candidate))
    host && private_host?(host)
  end || text.to_s.scan(%r{(?:\b[^\/@\s]+@)?(?:\[[^\]]+\]|[^\/:\s]+):[^\s<>"'`|]+}).any? do |candidate|
    !host_from_private_scp_candidate(trim_url_candidate(candidate)).nil?
  end
end

def write_if_changed(path, content)
  FileUtils.mkdir_p(File.dirname(path))
  File.write(path, content)
end

def check_file(path, expected, reporter)
  actual = File.exist?(path) ? File.read(path) : nil
  return if actual == expected

  reporter.error("#{display_path(path)} catalog drift; run #{GENERATOR} --write")
end

options = {
  registry: ROOT.join("skills.registry.yaml").to_s,
  lock: ROOT.join("skills.lock.yaml").to_s,
  json_output: ROOT.join("skills.catalog.json").to_s,
  markdown_output: ROOT.join("docs/skills-catalog.md").to_s,
  mode: :check
}

parser = OptionParser.new do |opts|
  opts.banner = "Usage: #{GENERATOR} [--check|--write|--json|--markdown]"
  opts.on("--registry PATH", "Registry manifest path") { |value| options[:registry] = value }
  opts.on("--lock PATH", "Lock file path") { |value| options[:lock] = value }
  opts.on("--json-output PATH", "Generated JSON catalog path") { |value| options[:json_output] = value }
  opts.on("--markdown-output PATH", "Generated Markdown catalog path") { |value| options[:markdown_output] = value }
  opts.on("--check", "Verify checked-in generated catalog artifacts") { options[:mode] = :check }
  opts.on("--write", "Write generated catalog artifacts") { options[:mode] = :write }
  opts.on("--json", "Print generated JSON catalog") { options[:mode] = :json }
  opts.on("--markdown", "Print generated Markdown catalog") { options[:mode] = :markdown }
end

parser.parse!

base_dir = Dir.pwd
options[:registry] = expand_config_path(options[:registry], base_dir: base_dir)
options[:lock] = expand_config_path(options[:lock], base_dir: base_dir)
options[:json_output] = expand_config_path(options[:json_output], base_dir: base_dir)
options[:markdown_output] = expand_config_path(options[:markdown_output], base_dir: base_dir)

reporter = Reporter.new
registry = load_yaml_mapping_file(options[:registry], reporter)
lock = load_yaml_mapping_file(options[:lock], reporter)
catalog = build_catalog(registry, lock, options[:registry], options[:lock], reporter) if reporter.errors.empty?

unless reporter.errors.empty?
  warn reporter.errors.join("\n")
  exit 1
end

json = json_document(catalog)
markdown = markdown_document(catalog)
public_safety_scan(json, "generated catalog JSON", reporter)
public_safety_scan(markdown, "generated catalog Markdown", reporter)

unless reporter.errors.empty?
  warn reporter.errors.join("\n")
  exit 1
end

case options[:mode]
when :check
  check_file(options[:json_output], json, reporter)
  check_file(options[:markdown_output], markdown, reporter)
when :write
  write_if_changed(options[:json_output], json)
  write_if_changed(options[:markdown_output], markdown)
when :json
  print json
when :markdown
  print markdown
end

unless reporter.errors.empty?
  warn reporter.errors.join("\n")
  exit 1
end
