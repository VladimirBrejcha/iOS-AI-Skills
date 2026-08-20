# Spec must-have checklist

Use this checklist as a hard gate before marking a spec as ready.

## MUST items (blocking if missing)

| ID | Requirement | Why it is mandatory |
|---|---|---|
| M01 | Document metadata (`ID`, `version`, `status`, `last updated`, optional parent/owner). | Prevent stale, ownerless specs. |
| M02 | Clear objective and problem statement. | Anchor decisions to outcomes, not implementation guesses. |
| M03 | Explicit scope and explicit non-goals. | Prevent scope creep and hidden assumptions. |
| M04 | Functional requirements written as testable statements. | Make implementation and QA unambiguous. |
| M05 | Behavior for success path, edge cases, and failures. | Avoid undefined runtime behavior. |
| M06 | Interfaces/contracts (API shapes, events, I/O, schemas, protocol rules) where applicable. | Keep integrations deterministic. |
| M07 | Data model and state transitions where applicable. | Define lifecycle and consistency expectations. |
| M08 | Non-functional requirements (performance, reliability, scalability, observability). | Make quality attributes explicit and enforceable. |
| M09 | Security/privacy/compliance requirements or an explicit `N/A` with rationale. | Prevent silent high-risk omissions. |
| M10 | Dependencies, assumptions, constraints, and external prerequisites. | Surface risks and planning constraints early. |
| M11 | Verification plan mapped to requirements. | Ensure each requirement is actually verifiable. |
| M12 | Completion criteria with pass/fail outcomes. | Define "done" objectively. |
| M13 | Traceability links to related docs/specs/ADRs/tickets. | Preserve context and decision lineage. |
| M14 | Document history (change log by version/date/summary). | Keep updates auditable. |
| M15 | Machine-checkable contract block for external, generated, AI-facing, or verifier-owned contracts. | Prevent ambiguous enums, predicates, validator order, redaction, publication gates, and boundary cases from becoming review-time discoveries. |
| M16 | Requirement-to-verifier binding with stable IDs. | Prevent specs and verifiers from drifting into false coverage. |

## SHOULD items (strongly recommended)

| ID | Recommendation | Benefit |
|---|---|---|
| S01 | Glossary for domain-specific terms. | Reduce interpretation drift across teams. |
| S02 | Migration/backward-compatibility strategy when changing contracts. | Lower rollout risk and regression risk. |
| S03 | Rollout and rollback plan. | Improve operational safety in production. |
| S04 | Monitoring and alerting expectations. | Enable quick issue detection after release. |
| S05 | Risk register with severity and mitigation. | Make tradeoffs explicit and reviewable. |
| S06 | Ownership mapping (who approves, who implements, who operates). | Improve execution accountability. |
| S07 | Timeline or phase plan for multi-stage delivery. | Align delivery sequencing across teams. |
| S08 | Repository-aligned implementation map for work spanning existing code paths. | Prevent agents from guessing edit targets or touching adjacent paths unintentionally. |

## Readiness decision

- Mark `Ready` only if all MUST items are present.
- Mark `Conditionally Ready` only if all MUST items are present and open questions are low-risk.
- Mark `Not Ready` if any MUST item is missing or ambiguous.

## Machine-checkable contract block

For M15, require the applicable subset of:

- canonical tokens, enums, identifiers, and versions;
- predicate or mapping tables;
- app-owned envelope versus generated/model/service output;
- validator order and failure semantics;
- retry and idempotency rules;
- redaction and observability rules;
- publication or rollout gates; and
- exact boundary-proof cases.

If the spec does not cross one of these boundaries, mark M15 `N/A` with a short rationale.
