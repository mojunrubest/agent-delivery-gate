# API Contract Starter Kit

This directory is a protected-control-plane starting point for one HTTP API task. It separates the task packet an Agent may see from the canonical contract, helpers, calibration evidence, and gate policy the candidate must not control.

## Adopt it

1. Copy this directory into a maintainer-owned control location and replace every `REPLACE_ME` marker.
2. Write the task packet from observable behavior: inputs, outputs, error semantics, ordering, concurrency, persistence, and resource limits. Do not add a role persona as a substitute for requirements.
3. Implement the protected contract with `node:test` and the HTTP helpers. The placeholder test fails deliberately, so an uncustomized kit cannot become green evidence.
4. Build an independent reference implementation and at least one planted negative implementation. The reference must pass; every negative must fail the protected contract for the intended reason.
5. Freeze the policy and canonical tests outside the candidate workspace, then point the reusable Delivery Gate workflow at `contracts/api-v1.json` by immutable control commit.
6. Let the Agent see the task packet, candidate stub, and a narrow public smoke test, but not the reference, negative fixtures, or protected assertions.

For local real-socket Agent testing, use the repository's `agent-loopback` profile. Its outbound and filesystem boundaries, plus the current macOS bind caveat, are documented in [Codex Local HTTP Permission Profile](../../docs/CODEX_LOOPBACK_PROFILE.md).

## Layout

```text
task-packet.md                 Agent-visible execution contract template
contracts/api-v1.json         Host-owned Delivery Gate policy
tests/contract.test.mjs       Deliberately failing protected-test skeleton
tests/http-helpers.mjs        Reusable real-socket JSON helpers
tests/process-http-helpers.mjs Cross-runtime process/readiness helper
calibration/CHECKLIST.md      Reference/negative calibration procedure
```

Keep the control files in this directory maintainer-owned. The candidate repository should not be able to edit or replace them in the verification job.

## Validation

The kit was reused for the [Versioned Document Agent Pilot](../../docs/REAL_VERSIONED_DOCUMENT_AGENT_PILOT.md). Its 212-line, eight-group contract accepted an independent reference and rejected a planted public-test false green, then a clean-room Agent passed public, protected, and GitHub checks without a repair round. Core derivation and calibration took 305 seconds; the conservative setup-to-Agent-ready measure was 554 seconds.

The [Cross-Runtime Agent Pilot](../../docs/REAL_CROSS_RUNTIME_AGENT_PILOT.md) then kept its eight-group protected contract in Node while launching a Python 3.9 standard-library candidate through `process-http-helpers.mjs`. The independent reference and clean-room Agent passed 8 / 8, while a Range false green passed public 1 / 1 and failed one of eight protected groups. The exercise also removed an unconditional npm preparation step from the reusable workflow.
