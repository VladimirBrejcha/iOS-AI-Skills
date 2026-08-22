# frozen_string_literal: true

require "fileutils"
require "minitest/autorun"
require "open3"
require "tmpdir"

class CheckCurrentSourceTest < Minitest::Test
  CHECKER = File.expand_path("../scripts/check_current_source.rb", __dir__)

  def with_repo
    Dir.mktmpdir("public-source-check-") do |repo|
      system("git", "-C", repo, "init", "--quiet", exception: true)
      yield repo
    end
  end

  def write(repo, relative_path, content)
    path = File.join(repo, relative_path)
    FileUtils.mkdir_p(File.dirname(path))
    File.binwrite(path, content)
  end

  def stage(repo, relative_path, content)
    write(repo, relative_path, content)
    system("git", "-C", repo, "add", "--", relative_path, exception: true)
  end

  def run_checker(repo, environment = {})
    Open3.capture3(environment, "ruby", CHECKER, repo)
  end

  def github_token
    "gh" + "p_" + ("A" * 24)
  end

  def test_safe_candidate_passes
    with_repo do |repo|
      stage(repo, "README.md", "Public documentation without credentials.\n")

      stdout, stderr, status = run_checker(repo)

      assert status.success?, stderr
      assert_includes stdout, "current public-source check passed"
    end
  end

  def test_staged_credential_cannot_be_hidden_by_clean_worktree_replacement
    with_repo do |repo|
      token = github_token
      stage(repo, "masked.txt", token)
      write(repo, "masked.txt", "clean replacement\n")

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "masked.txt"
      assert_includes stderr, "GitHub token"
      refute_includes stderr, token
    end
  end

  def test_unstaged_credential_is_checked_before_it_can_be_added
    with_repo do |repo|
      token = github_token
      stage(repo, "pending.txt", "safe candidate\n")
      write(repo, "pending.txt", token)

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "pending.txt"
      assert_includes stderr, "GitHub token"
      refute_includes stderr, token
    end
  end

  def test_git_environment_cannot_redirect_the_candidate_index
    with_repo do |repo|
      token = github_token
      stage(repo, "candidate.txt", token)
      alternate_index = File.join(repo, "alternate-index")
      environment = { "GIT_INDEX_FILE" => alternate_index }
      _output, error, status = Open3.capture3(
        environment,
        "git",
        "-C",
        repo,
        "read-tree",
        "--empty"
      )
      assert status.success?, error

      _stdout, stderr, checker_status = run_checker(repo, environment)

      refute checker_status.success?
      assert_includes stderr, "candidate.txt"
      assert_includes stderr, "GitHub token"
      refute_includes stderr, token
    end
  end

  def test_sensitive_filename_is_detected_without_echoing_it
    with_repo do |repo|
      token = github_token
      stage(repo, token, "safe content\n")

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "<redacted path>"
      assert_includes stderr, "GitHub token"
      refute_includes stderr, token
    end
  end

  def test_supported_high_confidence_formats_are_detected_and_redacted
    with_repo do |repo|
      fixtures = {
        "aws.txt" => "AK" + "IA" + ("A" * 16),
        "bearer.txt" => "Authorization: " + "Bearer " + ("b" * 24),
        "fine-grained.txt" => "github_" + "pat_" + ("C" * 24),
        "openai.txt" => "s" + "k-proj-" + ("D" * 24),
        "private-key.txt" => "-----BEGIN " + "OPENSSH PRIVATE KEY-----",
        "posix-home.txt" => "/" + "Users/example/private.txt",
        "root-home.txt" => "/" + "root/.ssh/id_ed25519",
        "windows-home.txt" => "C:" + "\\Users\\example\\private.txt"
      }
      fixtures.each { |path, content| stage(repo, path, content) }

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      fixtures.each do |path, content|
        assert_includes stderr, path
        refute_includes stderr, content
      end
      [
        "AWS access key",
        "bearer credential",
        "GitHub token",
        "OpenAI API key",
        "private key",
        "machine-local home path"
      ].each { |label| assert_includes stderr, label }
    end
  end

  def test_symlink_target_is_scanned_without_following_it
    with_repo do |repo|
      target = "/" + "home/example/private.txt"
      File.symlink(target, File.join(repo, "local-link"))
      system("git", "-C", repo, "add", "local-link", exception: true)

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "local-link"
      assert_includes stderr, "machine-local home path"
      refute_includes stderr, target
    end
  end

  def test_ignored_local_files_are_outside_the_release_candidate
    with_repo do |repo|
      stage(repo, ".gitignore", "ignored.txt\n")
      write(repo, "ignored.txt", github_token)

      stdout, stderr, status = run_checker(repo)

      assert status.success?, stderr
      assert_includes stdout, "current public-source check passed"
    end
  end

  def test_unrelated_home_directory_and_web_route_do_not_match_user_homes
    with_repo do |repo|
      stage(repo, "paths.txt", [
        "/tmp/home/.local/bin/tool",
        "https://example.invalid/home/user/profile"
      ].join("\n"))

      stdout, stderr, status = run_checker(repo)

      assert status.success?, stderr
      assert_includes stdout, "current public-source check passed"
    end
  end

  def test_duplicate_index_blobs_report_each_candidate_path
    with_repo do |repo|
      token = github_token
      stage(repo, "first.txt", token)
      stage(repo, "second.txt", token)

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "first.txt"
      assert_includes stderr, "second.txt"
      assert_includes stderr, "GitHub token"
      refute_includes stderr, token
    end
  end

  def test_git_commands_disable_lazy_object_fetching
    with_repo do |repo|
      stage(repo, "README.md", "Public documentation without credentials.\n")
      real_git = ENV.fetch("PATH").split(File::PATH_SEPARATOR).filter_map do |dir|
        candidate = File.join(dir, "git")
        candidate if File.executable?(candidate)
      end.first
      refute_nil real_git

      Dir.mktmpdir("public-source-check-bin-") do |bin_dir|
        fake_git = File.join(bin_dir, "git")
        File.write(fake_git, <<~RUBY)
          #!/usr/bin/env ruby
          abort "lazy fetching was not disabled" unless ENV["GIT_NO_LAZY_FETCH"] == "1"
          exec #{real_git.dump}, *ARGV
        RUBY
        FileUtils.chmod(0o755, fake_git)

        stdout, stderr, status = run_checker(
          repo,
          {
            "GIT_NO_LAZY_FETCH" => "0",
            "PATH" => [bin_dir, ENV.fetch("PATH")].join(File::PATH_SEPARATOR)
          }
        )

        assert status.success?, stderr
        assert_includes stdout, "current public-source check passed"
      end
    end
  end

  def test_git_lfs_pointer_requires_separate_review
    with_repo do |repo|
      pointer = [
        "version https://git-lfs.github.com/spec/v1",
        "oid sha256:#{'a' * 64}",
        "size 123"
      ].join("\n") + "\n"
      stage(repo, "large.dat", pointer)

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "large.dat"
      assert_includes stderr, "Git LFS object requires separate review"
      refute_includes stderr, "sha256:"
    end
  end

  def test_unresolved_index_entries_fail_closed
    with_repo do |repo|
      object_ids = %w[base ours theirs].map do |content|
        output, error, status = Open3.capture3(
          "git",
          "-C",
          repo,
          "hash-object",
          "-w",
          "--stdin",
          stdin_data: content
        )
        assert status.success?, error
        output.strip
      end
      index_info = object_ids.each_with_index.map do |object_id, index|
        "100644 #{object_id} #{index + 1}\tconflict.txt\n"
      end.join
      _output, error, status = Open3.capture3(
        "git",
        "-C",
        repo,
        "update-index",
        "--index-info",
        stdin_data: index_info
      )
      assert status.success?, error

      _stdout, stderr, checker_status = run_checker(repo)

      refute checker_status.success?
      assert_includes stderr, "conflict.txt"
      assert_includes stderr, "unresolved Git index entry"
    end
  end
end
