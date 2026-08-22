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

  def lfs_pointer
    [
      "version https://git-lfs.github.com/spec/v1",
      "oid sha256:#{'a' * 64}",
      "size 123"
    ].join("\n") + "\n"
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

  def test_subdirectory_argument_still_scans_the_complete_worktree
    with_repo do |repo|
      token = github_token
      stage(repo, "root-secret.txt", token)
      child = File.join(repo, "child")
      FileUtils.mkdir_p(child)

      _stdout, stderr, status = run_checker(child)

      refute status.success?
      assert_includes stderr, "root-secret.txt"
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
      escaped_slash = "\\" + "/"
      fixtures = {
        "aws.txt" => "AK" + "IA" + ("A" * 16),
        "aws-secret.txt" => "AWS_SECRET_ACCESS_KEY=" + ("S" * 40),
        "aws-secret-json.txt" => "{\"AWS_SECRET_ACCESS_KEY\":\"" + ("J" * 40) + "\"}",
        "bearer.txt" => "Authorization: " + "Bearer " + ("b" * 24),
        "bearer-json.txt" => "{\"Authorization\":\"" + "Bearer " + ("e" * 24) + "\"}",
        "fine-grained.txt" => "github_" + "pat_" + ("C" * 24),
        "openai.txt" => "s" + "k-proj-" + ("D" * 24),
        "private-key.txt" => "-----BEGIN " + "OPENSSH PRIVATE KEY-----",
        "pgp-private-key.txt" => "-----BEGIN " + "PGP PRIVATE KEY BLOCK-----",
        "putty-private-key.txt" => "PuTTY" + "-User-Key-File-3: ssh-ed25519",
        "markup-home.txt" => "<string>" + "/" + "Users/example/private.txt</string>",
        "posix-home.txt" => "/" + "Users/example/private.txt",
        "escaped-posix-home.txt" => [
          escaped_slash,
          "home",
          escaped_slash,
          "example",
          escaped_slash,
          "private.txt"
        ].join,
        "root-home.txt" => "/" + "root/.ssh/id_ed25519",
        "macos-root-home.txt" => "/" + "var/root/.ssh/id_ed25519",
        "macos-private-root-home.txt" => "/" + "private/var/root/.ssh/id_ed25519",
        "unicode-posix-home.txt" => "/" + "home/山田/private.txt",
        "terminal-unicode-posix-home.txt" => "/" + "home/山田\n",
        "file-uri-home.txt" => "file://" + "/" + "home/example/private.txt",
        "windows-home.txt" => "C:" + "\\Users\\example\\private.txt",
        "lowercase-windows-home.txt" => "c:" + "\\users\\example\\private.txt",
        "unicode-windows-home.txt" => "C:" + "\\Users\\山田\\private.txt",
        "escaped-windows-home.txt" => [
          "C:",
          "\\" * 2,
          "Users",
          "\\" * 2,
          "example",
          "\\" * 2,
          "private.txt"
        ].join
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
        "AWS secret access key",
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

  def test_symlinked_parent_is_rejected_without_reading_outside_repo
    with_repo do |repo|
      stage(repo, "dir/file.txt", "safe candidate\n")
      FileUtils.mv(File.join(repo, "dir"), File.join(repo, "original-dir"))

      Dir.mktmpdir("public-source-check-outside-") do |outside|
        token = github_token
        write(outside, "file.txt", token)
        File.symlink(outside, File.join(repo, "dir"))

        _stdout, stderr, status = run_checker(repo)

        refute status.success?
        assert_includes stderr, "dir/file.txt"
        assert_includes stderr, "symlinked parent component"
        refute_includes stderr, "GitHub token"
        refute_includes stderr, token
      end
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
      windows_profiles = "C:" + "\\Users\\"
      stage(repo, "paths.txt", [
        "/tmp/home/.local/bin/tool",
        "https://example.invalid/home/user/profile",
        "https://example.invalid/login?next=/home/user/profile",
        "Windows stores profiles under #{windows_profiles} by default."
      ].join("\n"))

      stdout, stderr, status = run_checker(repo)

      assert status.success?, stderr
      assert_includes stdout, "current public-source check passed"
    end
  end

  def test_similar_bearer_map_key_is_not_authorization
    with_repo do |repo|
      value = "Bearer " + ("a" * 24)
      stage(repo, "map.json", "{\"NotAuthorization\":\"#{value}\"}\n")

      stdout, stderr, status = run_checker(repo)

      assert status.success?, stderr
      assert_includes stdout, "current public-source check passed"
    end
  end

  def test_home_assignment_is_still_detected
    with_repo do |repo|
      home = "/" + "home/example/private.txt"
      stage(repo, "settings.env", "HOME=#{home}\n")

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "settings.env"
      assert_includes stderr, "machine-local home path"
      refute_includes stderr, home
    end
  end

  def test_command_option_home_assignment_is_detected
    with_repo do |repo|
      home = "/" + "home/example/private.txt"
      stage(repo, "command.txt", "tool --cache=#{home}\n")

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "command.txt"
      assert_includes stderr, "machine-local home path"
      refute_includes stderr, home
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

  def test_git_commands_enforce_read_only_environment
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
          abort "optional Git locks were not disabled" unless ENV["GIT_OPTIONAL_LOCKS"] == "0"
          exec #{real_git.dump}, *ARGV
        RUBY
        FileUtils.chmod(0o755, fake_git)

        stdout, stderr, status = run_checker(
          repo,
          {
            "GIT_NO_LAZY_FETCH" => "0",
            "GIT_OPTIONAL_LOCKS" => "1",
            "PATH" => [bin_dir, ENV.fetch("PATH")].join(File::PATH_SEPARATOR)
          }
        )

        assert status.success?, stderr
        assert_includes stdout, "current public-source check passed"
      end
    end
  end

  def test_repository_fsmonitor_hook_is_disabled
    with_repo do |repo|
      stage(repo, "README.md", "Public documentation without credentials.\n")
      hook = File.join(repo, "fsmonitor-hook")
      marker = File.join(repo, "fsmonitor-ran")
      File.write(hook, <<~'SH')
        #!/bin/sh
        printf 'ran\n' > "$FSMONITOR_MARKER"
      SH
      FileUtils.chmod(0o755, hook)
      system(
        "git",
        "-C",
        repo,
        "config",
        "core.fsmonitor",
        hook,
        exception: true
      )

      _output, error, status = Open3.capture3(
        { "FSMONITOR_MARKER" => marker },
        "git",
        "-C",
        repo,
        "ls-files"
      )
      assert status.success?, error
      assert File.exist?(marker), "fsmonitor fixture did not execute"
      FileUtils.rm(marker)

      stdout, stderr, checker_status = run_checker(
        repo,
        { "FSMONITOR_MARKER" => marker }
      )

      assert checker_status.success?, stderr
      assert_includes stdout, "current public-source check passed"
      refute File.exist?(marker), "checker executed the repository fsmonitor hook"
    end
  end

  def test_unique_blobs_use_one_cat_file_process
    with_repo do |repo|
      stage(repo, "first.txt", "first safe blob\n")
      stage(repo, "second.txt", "second safe blob\n")
      real_git = ENV.fetch("PATH").split(File::PATH_SEPARATOR).filter_map do |dir|
        candidate = File.join(dir, "git")
        candidate if File.executable?(candidate)
      end.first
      refute_nil real_git

      Dir.mktmpdir("public-source-check-bin-") do |bin_dir|
        marker = File.join(bin_dir, "cat-file-processes")
        fake_git = File.join(bin_dir, "git")
        File.write(fake_git, <<~RUBY)
          #!/usr/bin/env ruby
          if ARGV.include?("cat-file")
            File.open(ENV.fetch("CAT_FILE_MARKER"), "a") { |file| file.puts("started") }
          end
          exec #{real_git.dump}, *ARGV
        RUBY
        FileUtils.chmod(0o755, fake_git)

        stdout, stderr, status = run_checker(
          repo,
          {
            "CAT_FILE_MARKER" => marker,
            "PATH" => [bin_dir, ENV.fetch("PATH")].join(File::PATH_SEPARATOR)
          }
        )

        assert status.success?, stderr
        assert_includes stdout, "current public-source check passed"
        assert_equal ["started\n"], File.readlines(marker)
      end
    end
  end

  def test_non_utf8_git_paths_are_scanned_without_crashing
    with_repo do |repo|
      token = github_token
      Dir.mktmpdir("public-source-check-bin-") do |bin_dir|
        fake_git = File.join(bin_dir, "git")
        File.write(fake_git, <<~'RUBY')
          #!/usr/bin/env ruby
          STDOUT.binmode
          path = "raw-\xFF.txt".b
          if ARGV.include?("rev-parse")
            repo_index = ARGV.index("-C") + 1
            STDOUT.write(ARGV.fetch(repo_index) + "\n")
          elsif ARGV.include?("--stage")
            STDOUT.write("100644 #{'a' * 40} 0\t".b + path + "\0".b)
          elsif ARGV.include?("cat-file")
            STDOUT.sync = true
            content = "gh" + "p_" + ("A" * 24)
            while (object_id = STDIN.gets&.chomp)
              STDOUT.write("#{object_id} blob #{content.bytesize}\n")
              STDOUT.write(content)
              STDOUT.write("\n")
            end
          elsif ARGV.include?("-co")
            STDOUT.write(path + "\0".b)
          else
            abort "unexpected git invocation: #{ARGV.join(' ')}"
          end
        RUBY
        FileUtils.chmod(0o755, fake_git)

        _stdout, stderr, status = run_checker(
          repo,
          { "PATH" => [bin_dir, ENV.fetch("PATH")].join(File::PATH_SEPARATOR) }
        )

        refute status.success?
        assert_includes stderr, "GitHub token"
        assert_includes stderr, "\\xFF"
        refute_includes stderr, "invalid byte sequence"
        refute_includes stderr, token
      end
    end
  end

  def test_git_lfs_pointer_requires_separate_review
    with_repo do |repo|
      stage(repo, "large.dat", lfs_pointer)

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "large.dat"
      assert_includes stderr, "Git LFS object requires separate review"
      refute_includes stderr, "sha256:"
    end
  end

  def test_unstaged_git_lfs_pointer_requires_separate_review
    with_repo do |repo|
      stage(repo, "large.dat", "safe candidate\n")
      write(repo, "large.dat", lfs_pointer)

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "large.dat"
      assert_includes stderr, "Git LFS object requires separate review"
      refute_includes stderr, "sha256:"
    end
  end

  def test_bom_marked_utf16_source_requires_separate_review
    with_repo do |repo|
      token = github_token
      content = "\xFF\xFE".b + token.encode("UTF-16LE").b
      stage(repo, "script.ps1", content)

      _stdout, stderr, status = run_checker(repo)

      refute status.success?
      assert_includes stderr, "script.ps1"
      assert_includes stderr, "BOM-marked UTF-16 source requires separate review"
      refute_includes stderr, token
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
