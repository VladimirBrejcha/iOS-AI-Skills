#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "fileutils"
require "find"
require "json"
require "optparse"
require "pathname"
require "shellwords"
require "uri"
require "yaml"

ROOT = Pathname.new(File.expand_path("..", __dir__)).freeze
CATALOG_SCHEMA_VERSION = "0.1"
GENERATOR = "scripts/skills_catalog.rb"
DEFAULT_SKILLS_CLI_PACKAGE = "skills@1.5.14"
DEFAULT_INSTALL_PROFILE = File.join("profiles", "machine", "example-local-skills.yaml").freeze
INSTALLER_EXCLUDED_FILES = %w[metadata.json].freeze
INSTALLER_EXCLUDED_DIRS = %w[.git __pycache__ __pypackages__].freeze

PUBLIC_UNSAFE_PATTERNS = {
  "macOS user path" => %r{/Users/[A-Za-z0-9._-]+},
  "Linux user path" => %r{/home/[A-Za-z0-9._-]+},
  "root home path" => %r{/root(?:/|\b)},
  "Windows user path" => %r{[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s]+},
  "mac temp path" => %r{/var/folders/},
  "file URL" => %r{file://},
  "HTTP credentials" => %r{https?://[^/\s]*@}i,
  "GitHub token" => %r{github_pat_|ghp_|gho_|ghu_|ghs_|ghr_},
  "OpenAI key" => %r{sk-[A-Za-z0-9_-]{20,}},
  "AWS access key" => %r{\b(?:A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}\b},
  "Bearer token" => %r{\bAuthorization:\s*Bearer\s+[A-Za-z0-9._~+\/-]{20,}\b}i,
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

def safe_relative_path?(value)
  return false unless valid_string?(value)
  return false if value.start_with?("/") || value.include?("\\")

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

def scp_like_url?(value)
  value.is_a?(String) && /\A(?:[^\/@\s]+@)?[^\/:\s]+:.+\z/.match?(value)
end

def credential_bearing_scp_url?(value)
  match = /\A(?<userinfo>[^\/@\s]+)@[^\/:\s]+:.+\z/.match(value.to_s)
  match && match[:userinfo].include?(":")
end

def query_or_fragment_bearing_scp_url?(value)
  match = /\A(?:[^\/@\s]+@)?[^\/:\s]+:(?<path>.+)\z/.match(value.to_s)
  match && (match[:path].include?("?") || match[:path].include?("#"))
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
  userinfo = uri.respond_to?(:userinfo) ? uri.userinfo.to_s : ""
  return false if userinfo.empty?

  !(uri.scheme.to_s.casecmp("ssh").zero? && !userinfo.include?(":"))
rescue URI::InvalidURIError
  authority = scheme_url_authority(value)
  return false if authority.nil? || authority.empty?

  match = /\A(?<userinfo>[^@]+)@/.match(authority)
  return false unless match

  scheme = url_scheme(value).to_s.downcase
  userinfo = match[:userinfo]

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

def valid_http_remote_url?(value)
  return false unless value.is_a?(String) && /\Ahttps?:\/\//i.match?(value)

  uri = URI.parse(value)
  uri.is_a?(URI::HTTP) && !uri.host.to_s.empty?
rescue URI::InvalidURIError
  false
end

def valid_remote_scheme_url?(value)
  return false unless scheme_url?(value)

  uri = URI.parse(value)
  !uri.scheme.to_s.empty? && !uri.host.to_s.empty?
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
  return false if fragment && (fragment.match?(/\s/) || contains_control_characters?(fragment))

  true
end

def safe_manager_source?(value)
  return false unless value.is_a?(String) && !value.empty?
  return false if contains_control_characters?(value)
  return false if value.match?(/\s/)
  return false if value.start_with?("-")

  source_base, = split_manager_source_ref(value)
  return false if windows_local_path?(source_base) || Pathname.new(source_base).absolute?
  return false if local_file_url?(source_base) || home_relative_url?(source_base)
  return false if ext_remote_url?(source_base) || remote_helper_transport_url?(source_base)
  return false if credential_bearing_scheme_url?(source_base) || credential_bearing_scp_url?(source_base)
  return false if query_or_fragment_bearing_scheme_url?(source_base) || query_or_fragment_bearing_scp_url?(source_base)

  if scheme_url?(source_base)
    valid_http_remote_url?(source_base) || valid_remote_scheme_url?(source_base)
  elsif scp_like_url?(source_base)
    true
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
  return [{}, nil] unless profile_path.file?

  profile = load_yaml_file(profile_path.to_s, reporter)
  return [{}, profile_path] unless profile.is_a?(Hash)

  [profile, profile_path]
end

def approved_codex_global_install_ids(profile, profile_path, reporter)
  return {} unless profile.is_a?(Hash)
  return {} if profile_path.nil?

  consumer_roots = profile["consumer_roots"]
  unless consumer_roots.is_a?(Hash)
    reporter.error("#{display_path(profile_path)} consumer_roots must be a mapping")
    return {}
  end

  agents_root = consumer_roots["agents_user"]
  return {} unless agents_root.is_a?(Hash) && agents_root["path"] == "~/.agents/skills"

  selected_skills = profile["selected_skills"]
  unless selected_skills.is_a?(Array)
    reporter.error("#{display_path(profile_path)} selected_skills must be an array")
    return {}
  end

  selected_skills.each_with_object({}) do |entry, memo|
    unless entry.is_a?(Hash) && valid_string?(entry["skill_id"])
      reporter.error("#{display_path(profile_path)} selected_skills entries must include non-empty skill_id")
      next
    end

    expose_to = entry["expose_to"]
    override = entry.dig("consumer_overrides", "agents_user")
    state = entry["state"].to_s
    next unless state == "active"
    next unless expose_to.is_a?(Array) && expose_to.include?("agents_user")
    next unless override.is_a?(Hash)
    next unless override["adapter"] == "manager-copy"
    next unless override["status"] == "proven-manager-copy"

    memo[entry["skill_id"]] = true
  end
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

  metadata = YAML.safe_load(lines[1, closing].join("\n"), aliases: false, filename: path) || {}
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

def install_command(manager_source, skill_name)
  Shellwords.join([
                    "npx",
                    "--yes",
                    DEFAULT_SKILLS_CLI_PACKAGE,
                    "add",
                    manager_source,
                    "--skill",
                    skill_name,
                    "--agent",
                    "codex",
                    "--global",
                    "--yes"
                  ])
end

def catalog_description(skill, metadata)
  catalog = skill["catalog"]
  if catalog.is_a?(Hash) && valid_text_string?(catalog["description"])
    return normalize_text(catalog["description"])
  end

  description = metadata["description"]
  return normalize_text(description) if valid_text_string?(description)

  ""
end

def catalog_name(skill, metadata, exported_names)
  catalog = skill["catalog"]
  if catalog.is_a?(Hash) && valid_string?(catalog["name"])
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

  true
rescue ArgumentError
  false
end

def build_catalog(registry, lock, registry_path, lock_path, reporter)
  registry_root = Pathname.new(File.dirname(File.expand_path(registry_path))).cleanpath
  install_profile, install_profile_path = load_install_profile(registry_root, reporter)
  installable_codex_skills = approved_codex_global_install_ids(install_profile, install_profile_path, reporter)
  registry_metadata = mapping(registry["registry"], reporter, "registry metadata")
  registry_id = registry_metadata["id"]
  registry_name = registry_metadata["name"]
  registry_status = registry["status"]
  manager_source = registry_metadata["manager_source"]
  raw_skills = registry["skills"]

  reporter.error("registry.id is required") unless valid_string?(registry_id)
  reporter.error("registry.name is required") unless valid_string?(registry_name)
  reporter.error("registry.status is required") unless valid_string?(registry_status)
  unless raw_skills.is_a?(Array)
    reporter.error("skills.registry.yaml skills must be an array")
    raw_skills = []
  end

  lock_by_id = index_lock_entries(lock, reporter)
  catalog_skills = []
  seen_skill_ids = {}
  seen_exported_names = {}
  seen_registry_local_source_paths = {}
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
    source = mapping(skill["source"], reporter, "#{skill_id}: source")
    source_type = source["type"]
    exported_names = string_array(skill["exported_names"], reporter, "#{skill_id}: exported_names")
    exported_names.each do |name|
      reporter.error("#{skill_id}: exported_names entries must be safe adapter names") unless safe_adapter_name?(name)
      if safe_adapter_name?(name) && seen_exported_names.key?(name)
        reporter.error("#{skill_id}: exported adapter name #{name} is duplicated")
      else
        seen_exported_names[name] = skill_id if safe_adapter_name?(name)
      end
    end
    reporter.error("#{skill_id}: exported_names must not be empty") if exported_names.empty?
    clients = string_mapping(skill["clients"], reporter, "#{skill_id}: clients", allow_nil: true)
    scopes = string_array(skill["scopes"], reporter, "#{skill_id}: scopes")
    update_policy = skill["update_policy"]
    reporter.error("#{skill_id}: update_policy is required") unless valid_string?(update_policy)

    lock_entry = lock_by_id[skill_id]
    if lock_entry.nil?
      reporter.error("#{skill_id}: missing lock entry")
      lock_entry = {}
    end
    compare_lock_field(lock_entry, skill_id, "source_type", source_type, reporter)
    compare_lock_array(lock_entry, skill_id, "exported_names", exported_names, reporter)

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
      digest = require_lock_field(lock_entry, skill_id, "digest_sha256", reporter)
      reporter.error("#{skill_id}: lock digest_sha256 must be a 64-character SHA-256") unless digest.empty? || valid_sha256_hex?(digest)
      current_digest = directory_digest(skill_root.to_s, reporter) if skill_root&.directory?
      if valid_sha256_hex?(digest) && current_digest && digest != current_digest
        reporter.error("#{skill_id}: lock digest_sha256 differs from registry-local source contents")
      end
      compare_lock_field(lock_entry, skill_id, "path", source_path, reporter)
      source_catalog = {
        "type" => "registry-local",
        "path" => source_path
      }
      lock_catalog = {
        "source_type" => "registry-local",
        "path" => lock_entry["path"],
        "digest_sha256" => digest
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
      reporter.error("#{skill_id}: external-git source.observed_at is required") unless valid_string?(observed_at)

      %w[url path pinned_tag observed_commit].each do |field|
        require_lock_field(lock_entry, skill_id, field, reporter)
        compare_lock_field(lock_entry, skill_id, field, source[field], reporter)
      end
      if valid_string?(lock_entry["pinned_tag"]) && !valid_git_tag_name?(lock_entry["pinned_tag"])
        reporter.error("#{skill_id}: lock pinned_tag must be an exact tag name")
      end

      source_catalog = {
        "type" => "external-git",
        "url" => url,
        "path" => path,
        "pinned_tag" => pinned_tag,
        "observed_commit" => observed_commit,
        "observed_at" => observed_at
      }
      lock_catalog = {
        "source_type" => "external-git",
        "url" => lock_entry["url"],
        "path" => lock_entry["path"],
        "pinned_tag" => lock_entry["pinned_tag"],
        "observed_commit" => lock_entry["observed_commit"]
      }
    else
      reporter.error("#{skill_id}: source.type must be registry-local or external-git")
    end

    name = catalog_name(skill, metadata, exported_names)
    description = catalog_description(skill, metadata)
    manager_skill_name = source_type == "registry-local" ? manager_selected_skill_name(metadata) : nil
    reporter.error("#{skill_id}: catalog description is required") unless valid_string?(description)

    install = nil
    installable_by_manager = source_type == "registry-local" &&
                             status == "active" &&
                             clients["codex"] == "supported" &&
                             installable_codex_skills[skill_id] &&
                             safe_adapter_name?(exported_names.first) &&
                             manager_skill_name == exported_names.first
    manager_source_required ||= installable_by_manager
    if installable_by_manager && safe_manager_source?(manager_source)
      install = {
        "manager_package" => DEFAULT_SKILLS_CLI_PACKAGE,
        "registry_source" => manager_source,
        "skill" => manager_skill_name,
        "codex_global_command" => install_command(manager_source, manager_skill_name)
      }
    end

    entry = {
      "id" => skill_id,
      "name" => name,
      "description" => description,
      "status" => status,
      "source" => source_catalog,
      "exported_names" => exported_names,
      "clients" => clients,
      "scopes" => scopes,
      "update_policy" => update_policy,
      "lock" => lock_catalog
    }
    entry["install"] = install if install
    catalog_skills << entry
  end

  registry_skill_ids = raw_skills.each_with_object([]) do |entry, memo|
    memo << entry["id"] if entry.is_a?(Hash) && safe_non_path_identifier?(entry["id"])
  end
  stale_locks = lock_by_id.keys - registry_skill_ids
  stale_locks.sort.each do |skill_id|
    reporter.error("skills.lock.yaml stale lock entry #{skill_id} is not present in skills.registry.yaml")
  end

  if valid_string?(manager_source)
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
  lines << "This file is generated. Edit `skills.registry.yaml`, `skills.lock.yaml`,"
  lines << "`profiles/machine/example-local-skills.yaml`, or registered `SKILL.md`"
  lines << "front matter, then run"
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
        "registry-local:#{source.fetch("path")}"
      end
    clients = skill.fetch("clients").map { |client, status| "#{client}=#{status}" }.join(", ")
    lines << [
      code_span(skill.fetch("id")),
      code_span(skill.fetch("status")),
      code_span(source_label),
      skill.fetch("exported_names").map { |name| code_span(name) }.join(", "),
      md_escape(clients),
      skill.fetch("scopes").map { |scope| code_span(scope) }.join(", "),
      code_span(skill.fetch("update_policy")),
      md_escape(skill.fetch("description"))
    ].join(" | ").prepend("| ") + " |"
  end

  lines << ""
  lines << "## Installable Active Skills"
  lines << ""
  if active_installable.empty?
    lines << "No active Codex-supported skills currently emit public install commands."
  else
    lines << "The commands below use the pinned upstream skills manager package"
    lines << "for the current reviewed example profile."
    lines << ""
    lines << "```bash"
    active_installable.each do |skill|
      lines << skill.fetch("install").fetch("codex_global_command")
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
