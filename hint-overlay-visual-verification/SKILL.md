---
name: hint-overlay-visual-verification
description: >-
  Fail-fast visual verification for in-app hint overlays, coach marks, and spotlight callouts. Use when screenshots must prove target highlighting, background suppression, pointer geometry, safe-area containment, readable copy, and light/dark parity; not for generic screenshot review or App Store marketing composites.
---

# Hint Overlay Visual Verification

## Scope

Use this skill only when screenshot evidence is meant to approve an in-app hint
overlay, coach mark, spotlight, or anchored instructional callout.

This is a visual verification contract. It does not capture screenshots, drive
the interface, measure accessibility values, or create marketing artwork. Use
the available image, browser, or computer inspection capability to perform the
checks below.

Do not use this skill for:

- generic screenshot or broad UI review;
- App Store screenshot capture, resizing, framing, composition, or upload;
- reference-poster or marketing-composite approval;
- proving interaction behavior from a still image alone.

If a hard gate fails or required evidence is missing, report `NOT VERIFIED`.

## Required Inputs

Approval requires all of the following to be explicit:

- App, route, page, or surface under review.
- Scenario and overlay state.
- Target element and expected highlight bounds or anchor.
- Required callout text and required visible controls.
- Elements that must be hidden or de-emphasized.
- Required device, viewport, operating-system, and light/dark coverage.
- Expected pointer, tail, dismissal, and tap behavior.
- Screenshot paths and capture labels.
- Build, deployment, or page-version evidence when freshness matters.
- Separate interaction evidence when approval includes tap or dismissal
  behavior.

If an input is unavailable, continue only far enough to report the missing
evidence. Do not infer approval from a plausible-looking screenshot.

## Evidence Limits

- Inspect the original image at the highest available detail before judging
  small text, pointer tips, aperture edges, or safe-area clearance.
- A still image can show a rendered state. It cannot prove that a target is
  tappable, a callout ignores taps, an outside tap dismisses, or an animation
  remains correct over time.
- A screenshot cannot prove that it came from the latest build without
  independent capture or build evidence.
- Visual inspection can identify likely contrast problems but is not a
  measured WCAG conformance test. Measure when exact conformance is required.
- When image detail or capture provenance is insufficient, fail closed and
  name the missing evidence.

## Hard Gates

### Gate 1: Correct Context And Capture Identity

Fail if the capture is from the wrong app, surface, route, scenario, theme,
device class, or requested build.

Required checks:

- Landmark content and navigation match the requested surface.
- Scenario-specific text and controls match the requested state.
- Filename or capture metadata agrees with the claimed device, OS, and theme.
- Freshness claims are backed by build, install, deploy, or page-version
  evidence when required.

Failure label:

- `NOT VERIFIED: wrong or unproven capture context`

### Gate 2: Target And Callout Are Complete

Fail if any required overlay element is missing, cropped, truncated, or partly
outside the valid viewport.

Required checks:

- Target element is present and fully visible.
- Highlight or spotlight aperture is present when required.
- Callout or bubble text is complete.
- Pointer or tail is present when the design requires one.
- Required controls remain visible.

### Gate 3: Background Suppression Is Correct

Fail if non-target UI remains too prominent or the spotlight exposes unrelated
content.

Required checks:

- Dimming or blur covers all intended non-target regions consistently.
- Highlight aperture is constrained to the intended target.
- Required hidden or de-emphasized elements are clearly suppressed.
- Persistent chrome, such as tab bars, input bars, and sticky headers, is also
  suppressed unless it is the target.
- Overlay edges do not leak, band, or leave accidental undimmed gaps.

### Gate 4: Copy Is Legible

Fail if instructional text cannot be read quickly in every required mode.

Required checks:

- Primary copy is fully visible and readable.
- Secondary copy remains readable when it is meant to be shown.
- Text does not blend into the overlay, target highlight, or background.
- Small labels are inspected at original image detail.
- Borderline contrast is measured with dedicated tooling or treated as a
  failure; visual inspection alone must not be reported as exact conformance.

### Gate 5: Geometry And Coverage Are Sound

Fail when placement makes the overlay ambiguous, clipped, or disconnected from
its target.

Required checks:

- Callout does not overlap critical UI or another callout.
- Text wraps inside the callout with consistent padding.
- Pointer remains attached to the callout and lands on the intended anchor.
- Clamping near viewport edges does not detach or misdirect the pointer.
- Callout, pointer, and aperture clear notches, status areas, browser chrome,
  and home indicators.
- Required viewport, device, OS, and theme variants all pass independently.

## Validation Checklist

Mark every item `PASS`, `FAIL`, or `MISSING EVIDENCE`. Any value other than
`PASS` makes the overall status `NOT VERIFIED`.

1. Context and provenance
- Correct app and surface?
- Correct scenario and overlay state?
- Correct device, OS, viewport, and theme label?
- Required freshness evidence present?

2. Target and callout
- Target fully visible?
- Highlight aperture present and correctly sized?
- Callout copy complete?
- Pointer present when required?
- Mandatory controls visible?

3. Suppression
- Non-target dimming or blur active and even?
- Aperture constrained to the target?
- Persistent chrome suppressed when required?
- No undimmed gaps or overlay leaks?

4. Legibility
- Text complete and readable at original detail?
- No truncation, spill, or unreadably small labels?
- Contrast acceptable in every required theme?
- Exact contrast measured when exact conformance is claimed?

5. Geometry and coverage
- Padding and wrapping intact?
- No critical overlap?
- Pointer attached and aimed at the intended anchor?
- No safe-area or viewport clipping?
- Every required variant reviewed separately?

6. Interaction evidence
- Required tap and dismissal behaviors tested separately from the still image?
- Result tied to the same scenario and build as the visual evidence?

## Regression Labels

- `HOV-01 Wrong context`: capture does not match the requested app, route, or
  scenario.
- `HOV-02 Unproven freshness`: capture is claimed as current without build,
  install, deploy, or version evidence.
- `HOV-03 Missing overlay element`: target, aperture, callout, pointer, or
  required control is absent or incomplete.
- `HOV-04 Suppression leak`: non-target or persistent UI remains too prominent.
- `HOV-05 Aperture overreach`: spotlight reveals unrelated content.
- `HOV-06 Copy failure`: text is clipped, unreadable, or lacks required
  contrast.
- `HOV-07 Geometry collision`: callout overlaps critical UI or exits the valid
  viewport.
- `HOV-08 Detached pointer`: pointer separates from the callout.
- `HOV-09 Pointer mis-targeting`: clamping or layout moves the pointer away from
  the intended anchor.
- `HOV-10 Coverage gap`: a required theme, viewport, device, or OS variant is
  missing or fails.
- `HOV-11 Interaction evidence gap`: a still image is used to claim tap or
  dismissal behavior.

Severity guidance:

- `HOV-01`, `HOV-02`, `HOV-04`, `HOV-05`, `HOV-09`, and `HOV-11` are `P1`
  when they invalidate the approval claim.
- `HOV-03`, `HOV-07`, `HOV-08`, and `HOV-10` are normally `P1` unless the
  affected requirement is explicitly optional.
- `HOV-06` is at least `P2` and becomes `P1` when instructional copy is not
  usable.

## Capture Protocol

When generating new evidence:

1. Build or deploy the version under review.
2. Launch the exact scenario and overlay state.
3. Exercise required interaction behavior separately and record the result.
4. Capture deterministic filenames such as
   `<platform>-<version>-<scenario>-<theme>.png`.
5. Inspect every file at original detail before reporting.
6. Keep capture labels and interaction evidence tied to the same build or page
   version.

When reviewing supplied evidence, report capture provenance as unknown unless
it is provided. Do not manufacture a build-freshness claim from image content.

## Required Output

Respond in this structure:

1. `Verification Status`: `VERIFIED` or `NOT VERIFIED`
2. `Hard Gate Results`:
   - Gate 1: `PASS`, `FAIL`, or `MISSING EVIDENCE`
   - Gate 2: `PASS`, `FAIL`, or `MISSING EVIDENCE`
   - Gate 3: `PASS`, `FAIL`, or `MISSING EVIDENCE`
   - Gate 4: `PASS`, `FAIL`, or `MISSING EVIDENCE`
   - Gate 5: `PASS`, `FAIL`, or `MISSING EVIDENCE`
3. `Findings`:
   - Sort by severity (`P1`, `P2`, `P3`).
   - Include screenshot path or capture label.
   - State the exact defect, missing evidence, and approval impact.
4. `Required Fixes Before Approval`
5. `Residual Risks` only when status is `VERIFIED` with non-blocking caveats.

Never return `VERIFIED` when a gate failed, evidence is missing, or interaction
behavior is claimed from still images alone.
