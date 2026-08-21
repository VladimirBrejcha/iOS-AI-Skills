# Third-Party Notices

The repository is licensed under the [MIT License](LICENSE). The maintained
registry-local forks below also retain their reviewed upstream MIT notices.

## xcode-build

- Source: [pzep1/xcode-build-skill](https://github.com/pzep1/xcode-build-skill)
- Reviewed upstream commit: `9b5c31392971116b207f79525eeb8a3e57fbf227`
- Upstream notice: `Copyright (c) 2024`
- Local state: modified maintained fork

## swift-testing

- Source: [twostraws/Swift-Testing-Agent-Skill](https://github.com/twostraws/Swift-Testing-Agent-Skill)
- Reviewed upstream release: `1.0.0`
- Reviewed upstream commit: `29921fb187f1165cb8975791c7e11fbb23d03398`
- Upstream notice: `Copyright (c) 2026 Paul Hudson.`
- Local state: renamed and modified maintained fork

## swiftui-view-refactor

- Source: [Dimillian/Skills](https://github.com/Dimillian/Skills)
- Reviewed upstream commit: `05ba982bfeb0d77d3c97d4542b0ee15034d05f84`
- Upstream notice: `Copyright (c) 2026 Thomas Ricouard`
- Local state: modified maintained fork

## public-source-release-audit scanner

- Source: [Codex Autopilot public safety audit](https://github.com/fiveonecode/autopilot/blob/9dd7ecb8a1aecb3d757b935a970991fd3461f5f4/agent-harness/src/lib/public-safety-audit.ts)
- Reviewed upstream commit: `9dd7ecb8a1aecb3d757b935a970991fd3461f5f4`
- Upstream notice: `Copyright (c) 2026 Codex Autopilot contributors`
- Local state: dependency-free JavaScript port with a repository-release wrapper

The scanner is distributed under the MIT License reproduced in this
repository's [LICENSE](LICENSE). Keep local behavior changes fixture-backed and
reconcile future upstream changes deliberately.

The global bootstrap also installs `swift-concurrency` directly from its pinned
upstream repository. It is not vendored here; its upstream license and notices
remain authoritative. Impeccable remains an optional project-local install
from its pinned upstream repository.

## App Store Connect CLI skills

- Source: [rorkai/app-store-connect-cli-skills](https://github.com/rorkai/app-store-connect-cli-skills)
- Reviewed upstream commit: `c77169ab1a9595bbd426ec943797b36072ccf8e3`
- Upstream notice: `Copyright (c) 2026 Rudrank Riyam`
- Local state: installed directly by the global bootstrap; not vendored
