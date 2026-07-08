#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "json"
require "optparse"
require "pathname"
require "set"
require "yaml"

ROOT = Pathname.new(File.expand_path("..", __dir__)).freeze
SCRIPT_NAME = "scripts/skills_provenance_audit.rb"
DEFAULT_REGISTRY_PATH = ROOT.join("skills.registry.yaml").freeze
DEFAULT_PROVENANCE_PATH = ROOT.join("provenance.sources.yaml").freeze
VALID_CONFIDENCE = %w[high medium low].freeze
VALID_REVIEW_STATUS = %w[confirmed derived candidate].freeze
VALID_RECOMMENDED_SOURCE = %w[external-git registry-local unknown].freeze

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

def show_local_paths?
  ENV.fetch("SKILLS_PROVENANCE_SHOW_PATHS", "0") == "1"
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

def load_yaml_file(path, reporter)
  parsed = YAML.safe_load(File.read(path), aliases: false, filename: path)
  parsed.nil? ? {} : parsed
rescue Psych::Exception => error
  reporter.error("#{display_path(path)} is not valid YAML: #{redact_local_paths(error.message)}")
  nil
rescue Errno::ENOENT
  reporter.error("#{display_path(path)} does not exist")
  nil
rescue SystemCallError => error
  reporter.error("#{display_path(path)} could not be read: #{redact_local_paths(error.message)}")
  nil
end

def valid_string?(value)
  value.is_a?(String) && !value.strip.empty? && !value.match?(/[\x00-\x1F\x7F]/)
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

def public_https_url?(value)
  valid_string?(value) && value.match?(%r{\Ahttps://[A-Za-z0-9][A-Za-z0-9.-]*/[^?#\s]+\z})
end

def parse_frontmatter(path, reporter)
  lines = File.readlines(path, chomp: true)
  unless lines.first == "---"
    reporter.warn("#{display_path(path)} missing YAML front matter")
    return {}
  end

  closing_index = lines[1..]&.index("---")
  unless closing_index
    reporter.warn("#{display_path(path)} has unterminated YAML front matter")
    return {}
  end

  content = lines[1, closing_index].join("\n")
  metadata = YAML.safe_load(content, aliases: false, filename: path)
  metadata.is_a?(Hash) ? metadata : {}
rescue Psych::Exception => error
  reporter.warn("#{display_path(path)} front matter is not valid YAML: #{redact_local_paths(error.message)}")
  {}
rescue SystemCallError => error
  reporter.warn("#{display_path(path)} could not be read: #{redact_local_paths(error.message)}")
  {}
end

def normalized_text(path)
  File.read(path).gsub(/\r\n?/, "\n").strip
end

def skill_body(text)
  lines = text.lines
  return text unless lines.first&.chomp == "---"

  closing_index = lines[1..]&.index { |line| line.chomp == "---" }
  return text unless closing_index

  lines[(closing_index + 2)..]&.join.to_s.strip
end

def shingle_similarity(left, right)
  left_tokens = left.downcase.scan(/[a-z0-9_@#.-]+/)
  right_tokens = right.downcase.scan(/[a-z0-9_@#.-]+/)
  return 1.0 if left_tokens == right_tokens
  return 0.0 if left_tokens.empty? || right_tokens.empty?

  size = 5
  left_set = left_tokens.each_cons(size).map { |tokens| tokens.join(" ") }.to_set
  right_set = right_tokens.each_cons(size).map { |tokens| tokens.join(" ") }.to_set
  return 0.0 if left_set.empty? || right_set.empty?

  (left_set & right_set).length.to_f / (left_set | right_set).length
end

def inventory_skills(root, reporter)
  Dir.glob(root.join("*/SKILL.md").to_s).sort.each_with_object({}) do |path, skills|
    entrypoint = Pathname.new(path)
    id = entrypoint.dirname.basename.to_s
    metadata = parse_frontmatter(entrypoint, reporter)
    digest = Digest::SHA256.hexdigest(normalized_text(entrypoint))
    skills[id] = {
      "id" => id,
      "path" => "#{id}/SKILL.md",
      "name" => metadata["name"].to_s,
      "description" => metadata["description"].to_s,
      "skill_digest" => digest
    }
  end
end

def load_registry_entries(path, reporter)
  registry = load_yaml_file(path, reporter)
  return {} unless registry

  entries = registry.fetch("skills", [])
  unless entries.is_a?(Array)
    reporter.error("#{display_path(path)} skills must be a list")
    return {}
  end

  entries.each_with_object({}) do |entry, by_id|
    unless entry.is_a?(Hash) && valid_string?(entry["id"])
      reporter.error("#{display_path(path)} has a skill entry without a string id")
      next
    end

    if by_id.key?(entry["id"])
      reporter.error("#{entry["id"]}: duplicate registry entry")
      next
    end

    source = entry["source"].is_a?(Hash) ? entry["source"] : {}
    by_id[entry["id"]] = {
      "id" => entry["id"],
      "status" => entry["status"],
      "source_type" => source["type"],
      "source_path" => source["path"]
    }
  end
end

def validate_provenance_source(source, reporter)
  source_id = source["id"]
  reporter.error("provenance source id must be a non-empty string") unless valid_string?(source_id)
  reporter.error("#{source_id}: source url must be a public https URL") unless public_https_url?(source["url"])

  observed_commit = source["observed_commit"]
  if observed_commit && (!observed_commit.is_a?(String) || !observed_commit.match?(/\A[0-9a-f]{40}\z/i))
    reporter.error("#{source_id}: observed_commit must be a full 40-character git commit hash")
  end

  skills = source["skills"]
  unless skills.is_a?(Array)
    reporter.error("#{source_id}: skills must be a list")
    return
  end

  skills.each_with_index do |skill, index|
    unless skill.is_a?(Hash)
      reporter.error("#{source_id}: skill entry ##{index + 1} must be a mapping")
      next
    end

    local_id = skill["local_id"]
    reporter.error("#{source_id}: skill local_id must be a non-empty string") unless valid_string?(local_id)
    unless safe_relative_path?(skill["upstream_path"])
      reporter.error("#{source_id}: #{local_id}: upstream_path must be a safe relative path")
    end
    unless VALID_REVIEW_STATUS.include?(skill["status"])
      reporter.error("#{source_id}: #{local_id}: status must be one of #{VALID_REVIEW_STATUS.join(", ")}")
    end
    unless VALID_CONFIDENCE.include?(skill["confidence"])
      reporter.error("#{source_id}: #{local_id}: confidence must be one of #{VALID_CONFIDENCE.join(", ")}")
    end
    unless VALID_RECOMMENDED_SOURCE.include?(skill.fetch("recommended_registry_source", "unknown"))
      reporter.error("#{source_id}: #{local_id}: recommended_registry_source must be external-git, registry-local, or unknown")
    end
  end
end

def load_provenance_entries(path, reporter)
  provenance = load_yaml_file(path, reporter)
  return [] unless provenance

  sources = provenance.fetch("sources", [])
  unless sources.is_a?(Array)
    reporter.error("#{display_path(path)} sources must be a list")
    return []
  end

  sources.each { |source| validate_provenance_source(source, reporter) if source.is_a?(Hash) }

  sources.flat_map do |source|
    next [] unless source.is_a?(Hash)

    source.fetch("skills", []).map do |skill|
      next nil unless skill.is_a?(Hash)

      {
        "source_id" => source["id"],
        "source_url" => source["url"],
        "source_license" => source["license"],
        "source_observed_commit" => source["observed_commit"],
        "local_id" => skill["local_id"],
        "upstream_path" => skill["upstream_path"],
        "status" => skill["status"],
        "confidence" => skill["confidence"],
        "match" => skill["match"],
        "recommended_registry_source" => skill.fetch("recommended_registry_source", "unknown"),
        "note" => skill["note"]
      }
    end
  end.compact
end

def parse_source_root(value)
  source_id, path = value.to_s.split("=", 2)
  return nil unless valid_string?(source_id) && valid_string?(path)

  [source_id, Pathname.new(File.expand_path(path))]
rescue ArgumentError
  nil
end

def source_root_label(source_id)
  "[source-root:#{source_id}]"
end

def compare_source_root(local_skill, entry, source_roots, skills_root)
  source_root = source_roots[entry["source_id"]]
  return nil unless source_root

  upstream_skill_path = source_root.join(entry["upstream_path"], "SKILL.md")
  unless upstream_skill_path.file?
    return {
      "status" => "missing-upstream-skill",
      "path" => "#{source_root_label(entry["source_id"])}/#{entry["upstream_path"]}/SKILL.md"
    }
  end

  local_path = skills_root.join(local_skill.fetch("path"))
  local_text = normalized_text(local_path)
  upstream_text = normalized_text(upstream_skill_path)

  if local_text == upstream_text
    return {
      "status" => "exact",
      "confidence" => "high",
      "similarity" => 1.0,
      "path" => "#{source_root_label(entry["source_id"])}/#{entry["upstream_path"]}/SKILL.md"
    }
  end

  if skill_body(local_text) == skill_body(upstream_text)
    return {
      "status" => "body-exact",
      "confidence" => "high",
      "similarity" => 1.0,
      "path" => "#{source_root_label(entry["source_id"])}/#{entry["upstream_path"]}/SKILL.md"
    }
  end

  similarity = shingle_similarity(local_text, upstream_text)
  confidence = if similarity >= 0.90
                 "high"
               elsif similarity >= 0.65
                 "medium"
               else
                 "low"
               end

  {
    "status" => "similarity",
    "confidence" => confidence,
    "similarity" => similarity.round(4),
    "path" => "#{source_root_label(entry["source_id"])}/#{entry["upstream_path"]}/SKILL.md"
  }
end

def finding(severity:, kind:, skill_ids:, message:, details: {})
  {
    "severity" => severity,
    "kind" => kind,
    "skill_ids" => Array(skill_ids),
    "message" => message,
    "details" => details.compact
  }
end

def provenance_label(entry)
  "#{entry["source_id"]}:#{entry["upstream_path"]}"
end

def build_findings(skills:, registry_entries:, provenance_entries:, source_roots:, root:)
  findings = []
  known_ids = Set.new

  provenance_entries.each do |entry|
    local_id = entry["local_id"]
    known_ids << local_id
    local_skill = skills[local_id]
    registry = registry_entries[local_id]
    details = {
      "source" => provenance_label(entry),
      "source_url" => entry["source_url"],
      "source_observed_commit" => entry["source_observed_commit"],
      "review_status" => entry["status"],
      "match" => entry["match"],
      "recommended_registry_source" => entry["recommended_registry_source"],
      "registry_source_type" => registry&.fetch("source_type", nil),
      "note" => entry["note"]
    }

    unless local_skill
      findings << finding(
        severity: "warning",
        kind: "stale-provenance-entry",
        skill_ids: local_id,
        message: "#{local_id} has checked-in provenance but no local skill folder",
        details: details
      )
      next
    end

    comparison = compare_source_root(local_skill, entry, source_roots, root)
    confidence = comparison&.fetch("confidence", nil) || entry["confidence"]
    external_reviewed = entry["recommended_registry_source"] == "external-git" &&
                        entry["status"] != "candidate" &&
                        %w[high medium].include?(confidence)

    details["confidence"] = confidence
    details["match"] = comparison&.fetch("status", nil) || entry["match"]
    details["source_root_comparison"] = comparison

    if external_reviewed && registry && registry["source_type"] == "registry-local"
      findings << finding(
        severity: "error",
        kind: "registry-provenance-conflict",
        skill_ids: local_id,
        message: "#{local_id} is registry-local but has reviewed external provenance",
        details: details
      )
    elsif entry["recommended_registry_source"] == "registry-local" && registry.nil?
      findings << finding(
        severity: "warning",
        kind: "unregistered-local-fork-provenance",
        skill_ids: local_id,
        message: "#{local_id} has reviewed local-fork provenance but is not registry-covered",
        details: details
      )
    elsif external_reviewed && registry.nil?
      findings << finding(
        severity: "warning",
        kind: "unregistered-external-import",
        skill_ids: local_id,
        message: "#{local_id} appears copied or derived from an external source but is not registry-covered",
        details: details
      )
    elsif entry["status"] == "candidate" && registry.nil?
      findings << finding(
        severity: "info",
        kind: "unregistered-provenance-candidate",
        skill_ids: local_id,
        message: "#{local_id} has an unresolved public provenance candidate",
        details: details
      )
    elsif comparison && comparison["status"] == "similarity" && comparison["confidence"] == "low"
      findings << finding(
        severity: "warning",
        kind: "source-root-mismatch",
        skill_ids: local_id,
        message: "#{local_id} no longer resembles the provided source-root copy",
        details: details
      )
    end
  end

  digest_groups = skills.values.group_by { |skill| skill["skill_digest"] }
  digest_groups.each_value do |group|
    next unless group.length > 1

    ids = group.map { |skill| skill["id"] }.sort
    findings << finding(
      severity: "warning",
      kind: "duplicate-local-skill-content",
      skill_ids: ids,
      message: "Multiple local skills have identical SKILL.md content",
      details: { "paths" => ids.map { |id| "#{id}/SKILL.md" } }
    )
  end

  name_groups = skills.values
                      .reject { |skill| skill["name"].empty? }
                      .group_by { |skill| skill["name"] }
  name_groups.each do |name, group|
    next unless group.length > 1

    ids = group.map { |skill| skill["id"] }.sort
    findings << finding(
      severity: "warning",
      kind: "duplicate-skill-name",
      skill_ids: ids,
      message: "Multiple local skills use the same front matter name",
      details: { "name" => name, "paths" => ids.map { |id| "#{id}/SKILL.md" } }
    )
  end

  registry_entries.each do |id, entry|
    source_path = entry["source_path"]
    next unless entry["source_type"] == "registry-local"
    next unless valid_string?(source_path)
    next if skills.key?(source_path)

    findings << finding(
      severity: "error",
      kind: "registry-local-source-missing",
      skill_ids: id,
      message: "#{id} points at missing local source path #{source_path}",
      details: { "registry_source_path" => source_path }
    )
  end

  unclassified = skills.keys.sort - registry_entries.keys - known_ids.to_a
  unclassified.each do |id|
    findings << finding(
      severity: "info",
      kind: "unclassified-local-skill",
      skill_ids: id,
      message: "#{id} is not registry-covered and has no checked-in provenance candidate",
      details: { "path" => "#{id}/SKILL.md" }
    )
  end

  findings
end

def summary_for(skills, registry_entries, provenance_entries, findings)
  by_kind = findings.group_by { |finding| finding["kind"] }.transform_values(&:length)
  {
    "total_local_skills" => skills.length,
    "registry_covered_skills" => registry_entries.length,
    "known_provenance_entries" => provenance_entries.length,
    "registry_provenance_conflicts" => by_kind.fetch("registry-provenance-conflict", 0),
    "stale_provenance_entries" => by_kind.fetch("stale-provenance-entry", 0),
    "unregistered_external_imports" => by_kind.fetch("unregistered-external-import", 0),
    "unregistered_local_fork_provenance" => by_kind.fetch("unregistered-local-fork-provenance", 0),
    "unregistered_provenance_candidates" => by_kind.fetch("unregistered-provenance-candidate", 0),
    "duplicate_local_skill_content" => by_kind.fetch("duplicate-local-skill-content", 0),
    "duplicate_skill_names" => by_kind.fetch("duplicate-skill-name", 0),
    "unclassified_local_skills" => by_kind.fetch("unclassified-local-skill", 0),
    "errors" => findings.count { |finding| finding["severity"] == "error" },
    "warnings" => findings.count { |finding| finding["severity"] == "warning" },
    "infos" => findings.count { |finding| finding["severity"] == "info" }
  }
end

def report_payload(skills:, registry_entries:, provenance_entries:, findings:)
  {
    "schema_version" => "0.1",
    "generated_by" => SCRIPT_NAME,
    "summary" => summary_for(skills, registry_entries, provenance_entries, findings),
    "findings" => findings.sort_by { |finding| [finding["severity"], finding["kind"], finding["skill_ids"].join(",")] },
    "skills" => skills.keys.sort.map do |id|
      registry = registry_entries[id]
      provenance = provenance_entries.select { |entry| entry["local_id"] == id }
      {
        "id" => id,
        "path" => "#{id}/SKILL.md",
        "frontmatter_name" => skills.fetch(id)["name"],
        "registry_source_type" => registry&.fetch("source_type", nil),
        "registry_source_path" => registry&.fetch("source_path", nil),
        "provenance_sources" => provenance.map { |entry| provenance_label(entry) }
      }
    end
  }
end

def markdown_escape(value)
  value.to_s.gsub("|", "\\|").gsub("\n", " ")
end

def markdown_table(headers, rows)
  output = []
  output << "| #{headers.join(" | ")} |"
  output << "| #{headers.map { "---" }.join(" | ")} |"
  rows.each do |row|
    output << "| #{row.map { |value| markdown_escape(value) }.join(" | ")} |"
  end
  output.join("\n")
end

def format_markdown(payload)
  summary = payload.fetch("summary")
  findings = payload.fetch("findings")
  lines = []

  lines << "# Skills Provenance Audit"
  lines << ""
  lines << "Generated by `#{payload.fetch("generated_by")}`."
  lines << ""
  lines << "This report is read-only. It records source-ownership risk; it does not update skills, registry entries, locks, catalog artifacts, or consumer adapters."
  lines << ""
  lines << "## Summary"
  lines << ""
  lines << markdown_table(
    %w[Metric Count],
    [
      ["Local skills", summary.fetch("total_local_skills")],
      ["Registry-covered skills", summary.fetch("registry_covered_skills")],
      ["Known provenance entries", summary.fetch("known_provenance_entries")],
      ["Registry provenance conflicts", summary.fetch("registry_provenance_conflicts")],
      ["Stale provenance entries", summary.fetch("stale_provenance_entries")],
      ["Unregistered external imports", summary.fetch("unregistered_external_imports")],
      ["Unregistered local-fork provenance", summary.fetch("unregistered_local_fork_provenance")],
      ["Unresolved provenance candidates", summary.fetch("unregistered_provenance_candidates")],
      ["Duplicate local SKILL.md groups", summary.fetch("duplicate_local_skill_content")],
      ["Duplicate front matter names", summary.fetch("duplicate_skill_names")],
      ["Unclassified local skills", summary.fetch("unclassified_local_skills")]
    ]
  )

  sections = {
    "Registry Provenance Conflicts" => "registry-provenance-conflict",
    "Stale Provenance Entries" => "stale-provenance-entry",
    "Unregistered External Imports" => "unregistered-external-import",
    "Unregistered Local-Fork Provenance" => "unregistered-local-fork-provenance",
    "Unresolved Provenance Candidates" => "unregistered-provenance-candidate",
    "Duplicate Local Skills" => "duplicate-local-skill-content",
    "Duplicate Skill Names" => "duplicate-skill-name",
    "Source Root Mismatches" => "source-root-mismatch",
    "Unclassified Local Skills" => "unclassified-local-skill"
  }

  sections.each do |title, kind|
    rows = findings.select { |finding| finding["kind"] == kind }.map do |finding|
      details = finding.fetch("details", {})
      [
        finding.fetch("skill_ids").join(", "),
        finding.fetch("severity"),
        details["source"] || details["name"] || details["path"] || "-",
        details["confidence"] || "-",
        finding.fetch("message")
      ]
    end
    next if rows.empty?

    lines << ""
    lines << "## #{title}"
    lines << ""
    lines << markdown_table(%w[Skill Severity Source/Evidence Confidence Message], rows)
  end

  lines << ""
  lines << "## Next Use"
  lines << ""
  lines << "- Use `--fail-on-registry-conflict` after confirmed external-derived registry-local entries are reclassified or intentionally forked."
  lines << "- Use `--source-root SOURCE_ID=path/to/local/upstream-clone` to add fresh local clone comparison evidence without adding network access to CI."
  lines << "- Keep third-party content updates in separate reviewed registry/lock/catalog PRs."
  lines << ""
  lines.join("\n")
end

options = {
  format: "markdown",
  root: ROOT,
  registry_path: DEFAULT_REGISTRY_PATH,
  provenance_path: DEFAULT_PROVENANCE_PATH,
  source_roots: {},
  fail_on_registry_conflict: false,
  fail_on_unregistered_import: false
}

parser = OptionParser.new do |opts|
  opts.banner = "Usage: #{SCRIPT_NAME} [options]"
  opts.on("--root PATH", "Root containing top-level skill folders") do |value|
    options[:root] = Pathname.new(File.expand_path(value))
  end
  opts.on("--registry PATH", "Path to skills.registry.yaml") do |value|
    options[:registry_path] = Pathname.new(File.expand_path(value))
  end
  opts.on("--provenance PATH", "Path to provenance.sources.yaml") do |value|
    options[:provenance_path] = Pathname.new(File.expand_path(value))
  end
  opts.on("--source-root SOURCE_ID=PATH", "Optional local upstream clone root for comparison; repeatable") do |value|
    parsed = parse_source_root(value)
    raise OptionParser::InvalidArgument, "expected SOURCE_ID=PATH" unless parsed

    options[:source_roots][parsed.first] = parsed.last
  end
  opts.on("--source-root-dir PATH", "Use PATH/SOURCE_ID as source roots when present") do |value|
    options[:source_root_dir] = Pathname.new(File.expand_path(value))
  end
  opts.on("--json", "Emit JSON") do
    options[:format] = "json"
  end
  opts.on("--markdown", "Emit Markdown") do
    options[:format] = "markdown"
  end
  opts.on("--fail-on-registry-conflict", "Exit non-zero when registry-local entries have reviewed external provenance") do
    options[:fail_on_registry_conflict] = true
  end
  opts.on("--fail-on-unregistered-import", "Exit non-zero when unregistered skills have reviewed external provenance") do
    options[:fail_on_unregistered_import] = true
  end
end

begin
  parser.parse!(ARGV)
rescue OptionParser::ParseError => error
  warn error.message
  warn parser.to_s
  exit 2
end

reporter = Reporter.new
registry_entries = load_registry_entries(options[:registry_path], reporter)
provenance_entries = load_provenance_entries(options[:provenance_path], reporter)

if options[:source_root_dir]
  provenance_entries.map { |entry| entry["source_id"] }.uniq.each do |source_id|
    candidate = options[:source_root_dir].join(source_id)
    options[:source_roots][source_id] = candidate if candidate.directory?
  end
end

reporter.errors.each { |message| warn "error: #{message}" }
exit 2 unless reporter.errors.empty?

skills = inventory_skills(options[:root], reporter)
findings = build_findings(
  skills: skills,
  registry_entries: registry_entries,
  provenance_entries: provenance_entries,
  source_roots: options[:source_roots],
  root: options[:root]
)
payload = report_payload(
  skills: skills,
  registry_entries: registry_entries,
  provenance_entries: provenance_entries,
  findings: findings
)

reporter.warnings.each { |message| warn "warning: #{message}" }

case options[:format]
when "json"
  puts JSON.pretty_generate(payload)
when "markdown"
  puts format_markdown(payload)
else
  warn "unsupported format: #{options[:format]}"
  exit 2
end

failures = []
if options[:fail_on_registry_conflict] && payload.fetch("summary").fetch("registry_provenance_conflicts").positive?
  failures << "registry provenance conflicts found"
end
if options[:fail_on_unregistered_import] && payload.fetch("summary").fetch("unregistered_external_imports").positive?
  failures << "unregistered external imports found"
end

unless failures.empty?
  warn failures.join("; ")
  exit 1
end
