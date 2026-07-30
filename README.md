# Agent Delivery Gate

An experimental GitHub-native acceptance gate for code produced by Coding Agents.

The Agent may produce a pull request, logs, screenshots, or its own receipt. It cannot declare delivery complete. A host-owned verifier launches the canonical command, captures the process and structured test result, checks the Git tree and artifacts, then atomically issues the only receipt used by the gate.

```text
Coding Agent -> candidate PR -> protected policy -> host verifier -> Delivery Receipt
```

This is deliberately not an Agent framework, role/persona system, Electron application, tmux wrapper, or replacement test runner.

## What the spike proves

- The verifier launched the recorded argv without a shell.
- The run is bound to a Git HEAD, content digest, policy hash, command hash, and unique run ID.
- Exit status, signal, timeout, stdout, stderr, structured test counts, and artifacts are captured by the verifier.
- Zero tests, all skipped, nonzero exit, failed/flaky tests, missing/stale evidence, dirty-tree mutation, launch failure, crash, timeout, and malformed results fail closed.
- A receipt written by the child process is atomically replaced by the verifier's receipt.
- TAP (`node:test`), JUnit (exercised with Vitest), and Playwright JSON are supported.

It does not prove that tests completely specify the task, that public tests were not gamed, or that a malicious project cannot attack a same-host runner. See [Threat Model](docs/THREAT_MODEL.md).

## Run it

Requirements: Node 22+, npm, Git, and Chromium for the browser fixture.

```bash
npm ci
npm run build
npx playwright install chromium
npm test
npm run test:e2e
npm run benchmark
```

Verify a contract directly:

```bash
node dist/src/cli.js verify \
  --config delivery-gate.json \
  --workspace . \
  --receipt .delivery-gate/receipt.json
```

Exit codes are `0` for `verified`, `1` for `unverified`, and `2` for `blocked` or verifier setup failure.

Generate a candidate repository's pinned caller workflow:

```bash
node dist/src/cli.js init \
  --control-repository owner/delivery-control \
  --control-ref 0123456789abcdef0123456789abcdef01234567 \
  --policy-path contracts/application-v1.json \
  --browser
```

The command requires a full commit SHA and refuses to overwrite an existing workflow unless `--force` is explicit. Add `--attest` only when the repository supports GitHub attestations. The candidate execution job has read-only contents permission; signing authority exists only in a separate job after successful verification.

## Contract

The command is an argv array and is launched with `shell: false`. File-based reporters must put `{report}` in one argv entry; every occurrence is replaced by a new, previously nonexistent path. `{artifactDir}` points to the current run's evidence directory. `{policyDir}` resolves to the protected contract directory, allowing canonical tests to live outside the candidate repository.

```json
{
  "schemaVersion": "1",
  "policyId": "checkout/acceptance-v3",
  "command": [
    "npx",
    "vitest",
    "run",
    "--reporter=junit",
    "--outputFile={report}"
  ],
  "timeoutMs": 120000,
  "result": { "adapter": "junit", "source": "file" },
  "requireCleanTree": true,
  "artifacts": [{ "path": "{artifactDir}/checkout.png" }]
}
```

The complete formats are in [gate-policy.schema.json](schema/gate-policy.schema.json) and [delivery-receipt.schema.json](schema/delivery-receipt.schema.json).

## Benchmark

`npm run benchmark` executes 18 deterministic planted scenarios with no LLM judge: 5 valid deliveries and 13 false-green cases. The latest run produced:

| Mode | False greens | Correct tasks accepted |
| --- | ---: | ---: |
| Agent self-report | 13 / 13 | 5 / 5 |
| Cooperative Agent-authored receipt | 11 / 13 | 5 / 5 |
| Host-owned atomic verifier | 0 / 13 | 5 / 5 |

The structured output is [benchmark/results/latest.json](benchmark/results/latest.json). The browser cases launch real Chromium; one verifies a correct flow, and one verifies that a real screenshot cannot override a failed DOM interaction assertion.

## Cross-repository pilot

The checkout pilot keeps its canonical policy and 13 contract tests in this control repository. The candidate repository contains only the implementation and one narrow public smoke test. The verifier expands `{policyDir}` so protected tests execute against the candidate working directory without being copied into it.

The local pilot evaluates 20 candidate Git branches:

| Mode | False greens | Correct tasks accepted |
| --- | ---: | ---: |
| Candidate-owned public test | 15 / 15 | 5 / 5 |
| External atomic verifier | 0 / 15 | 5 / 5 |

Run it with `npm run pilot -- --repo ../delivery-gate-pilot`. The machine-readable evidence is [pilot/results/latest.json](pilot/results/latest.json). These are deterministic candidate simulations for exercising the control boundary, not 20 claimed external Agent sessions.

A separate clean-room pilot then ran 3 real Codex CLI sessions with no fixture implementations, control tests, other branches, or prior task history visible. All 3 independently passed the protected contract and their real GitHub checks on the first attempt. See [Real Agent Pilot](docs/REAL_AGENT_PILOT.md) and its [machine-readable evidence](pilot/results/real-agent-latest.json).

The follow-up [Real Browser Agent Pilot](docs/REAL_BROWSER_AGENT_PILOT.md) ran 2 isolated multi-file UI sessions against a protected six-test Playwright contract with required desktop and mobile screenshots. Both passed GitHub on their first candidate attempt. The calibration process also exposed why acceptance contracts must test observable behavior instead of reference-specific markup or wording.

The resulting product boundary and standard one-Agent path are defined in [Single Agent Delivery v0.1](docs/SINGLE_AGENT_V0_1.md). It treats the task prompt as an execution contract rather than a persona and keeps multi-Agent orchestration out of scope until the single-Agent delivery boundary survives broader use.

The generated v0.1 workflow was then validated on a private consumer PR against control commit `f52602ba5e03df2b57e8ee5872f967ae25261626`. The final protected Chromium run passed 6 / 6 and preserved a digest-bound receipt artifact; its [machine-readable evidence](browser-pilot/results/single-agent-v0.1.json) also records two workflow calibration findings discovered before the successful run.

## GitHub boundary

The included workflow extracts the verifier and contracts from the protected base SHA into `$RUNNER_TEMP`, then points that control-plane verifier at the candidate workspace. It pins GitHub Actions by commit and wraps successful receipts in a GitHub OIDC custom attestation.

The live GitHub pilot completed with 5 / 5 correct candidates accepted and 15 / 15 planted false-green candidates rejected. The public control workflow also completed real unit and Chromium receipt attestations. See [GitHub Pilot Status](docs/GITHUB_PILOT_STATUS.md) for run links and the private-repository plan limits observed during execution.

[`reusable-delivery-gate.yml`](.github/workflows/reusable-delivery-gate.yml) is the cross-repository variant. It requires an immutable 40-character control commit, moves the control plane outside the candidate workspace, optionally installs protected Chromium, and executes the selected control-owned policy. The receipt is preserved from runner temporary storage; optional OIDC attestation happens in a separate job that never executes candidate code.

For adoption, make `Host-owned acceptance` a required status check and protect changes to the workflow, policies, verifier package pin, and canonical tests with CODEOWNERS. Organization-wide use should move the control plane into a separately owned reusable workflow or repository.
