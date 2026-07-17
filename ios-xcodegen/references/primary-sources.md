# Primary sources

Reviewed and retrieved: 2026-07-16.

Use these sources for mutable XcodeGen and Apple platform claims. Re-review the
relevant source when the repository's XcodeGen or Xcode version changes.

| Contract | Primary source |
| --- | --- |
| Reviewed XcodeGen version | [XcodeGen 2.45.4 release](https://github.com/yonaskolb/XcodeGen/releases/tag/2.45.4) and [immutable release commit](https://github.com/yonaskolb/XcodeGen/commit/8d3d3476a69ae3e5d68e1adccc701c410c05eb36) |
| `minimumXcodeGenVersion`, resources, schemes, packages, and documented dependency types | [XcodeGen 2.45.4 project specification](https://github.com/yonaskolb/XcodeGen/blob/2.45.4/Docs/ProjectSpec.md) |
| Asset-symbol build settings | [Apple Xcode build settings reference](https://developer.apple.com/documentation/xcode/build-settings-reference) |
| `ColorResource` and `ImageResource` generation | [Apple Xcode 15 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-15-release-notes) |
| Raw archive and XCFramework packaging model | [Apple: Creating a multi-platform binary framework bundle](https://developer.apple.com/documentation/xcode/creating-a-multi-platform-binary-framework-bundle) and [Apple TN2435](https://developer.apple.com/library/archive/technotes/tn2435/_index.html) |
| Resource-bearing static frameworks | [Apple: Creating a static framework](https://developer.apple.com/documentation/xcode/creating-a-static-framework) |
| Designed-for-iPad eligibility on Apple silicon | [Apple: Providing an edge-to-edge, full-screen experience in your iPad app running on a Mac](https://developer.apple.com/documentation/apple-silicon/providing-an-edge-to-edge-full-screen-experience-in-your-ipad-app-running-on-a-mac) |
| Swift package resolution in CI | [Apple: Making dependencies available to Xcode Cloud](https://developer.apple.com/documentation/xcode/making-dependencies-available-to-xcode-cloud) |

Runtime evidence is still required. Use the active Xcode's
`xcodebuild -showdestinations` output for the generated scheme, inspect the
generated project or workspace for the shared `Package.resolved`, and inspect
the generated link/embed phases plus the final archive for binary packaging.
