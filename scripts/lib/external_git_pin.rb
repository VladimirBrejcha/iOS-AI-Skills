# frozen_string_literal: true

module ExternalGitPin
  PIN_FIELDS = %w[pinned_tag pinned_commit].freeze
  TAG_FIELDS = %w[pinned_tag observed_commit].freeze
  COMMIT_FIELDS = %w[pinned_commit tracking_ref].freeze
  ALL_FIELDS = (TAG_FIELDS + COMMIT_FIELDS).uniq.freeze

  module_function

  def kind(source)
    return nil unless source.respond_to?(:key?)

    present = PIN_FIELDS.select { |field| source.key?(field) }
    return nil unless present.length == 1

    present.first == "pinned_tag" ? :tag : :commit
  end

  def required_fields(kind)
    case kind
    when :tag then TAG_FIELDS
    when :commit then COMMIT_FIELDS
    else []
    end
  end

  def forbidden_fields(kind)
    case kind
    when :tag then COMMIT_FIELDS
    when :commit then TAG_FIELDS
    else ALL_FIELDS
    end
  end

  def reference(source)
    case kind(source)
    when :tag then source["pinned_tag"]
    when :commit then source["pinned_commit"]
    end
  end
end
