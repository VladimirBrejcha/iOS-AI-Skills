# frozen_string_literal: true

require "fileutils"
require "minitest/autorun"
require "open3"
require "tmpdir"

class CheckProjectSkillOwnershipTest < Minitest::Test
  CHECKER = File.expand_path("check_project_skill_ownership.rb", __dir__)

  def with_repo
    Dir.mktmpdir("project-skill-ownership-") do |repo|
      system("git", "-C", repo, "init", "--quiet", exception: true)
      yield repo
    end
  end

  def add_skill(repo, directory, name)
    skill_dir = File.join(repo, directory)
    FileUtils.mkdir_p(skill_dir)
    File.write(
      File.join(skill_dir, "SKILL.md"),
      "---\nname: #{name}\ndescription: Fixture skill.\n---\n\n# Fixture\n"
    )
    system("git", "-C", repo, "add", directory, exception: true)
  end

  def run_checker(repo)
    Open3.capture3("ruby", CHECKER, repo)
  end

  def test_accepts_unique_project_owned_skill
    with_repo do |repo|
      add_skill(repo, ".agents/skills/project-helper", "project-helper")

      stdout, stderr, status = run_checker(repo)

      assert status.success?, stderr
      assert_includes stdout, "project skill ownership check passed"
    end
  end

  def test_rejects_managed_global_shadow
    with_repo do |repo|
      add_skill(repo, ".agents/skills/code-review", "code-review")

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "managed-global skill"
    end
  end

  def test_rejects_managed_global_client_root_symlink
    with_repo do |repo|
      link_dir = File.join(repo, ".codex/skills")
      FileUtils.mkdir_p(link_dir)
      File.symlink("../../external-code-review", File.join(link_dir, "code-review"))
      system("git", "-C", repo, "add", ".codex/skills/code-review", exception: true)

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "managed-global skill"
    end
  end

  def test_accepts_pending_removal_of_managed_global_shadow
    with_repo do |repo|
      add_skill(repo, ".agents/skills/code-review", "code-review")
      FileUtils.rm_rf(File.join(repo, ".agents/skills/code-review"))

      stdout, stderr, status = run_checker(repo)

      assert status.success?, stderr
      assert_includes stdout, "project skill ownership check passed"
    end
  end

  def test_rejects_duplicate_front_matter_names
    with_repo do |repo|
      add_skill(repo, ".agents/skills/first", "first")
      add_skill(repo, "skills/codex/first", "first")

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "duplicate project skill name"
    end
  end

  def test_rejects_directory_name_mismatch
    with_repo do |repo|
      add_skill(repo, ".agents/skills/alias", "canonical-name")

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "must match directory"
    end
  end
end
