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

## Contract

The command is an argv array and is launched with `shell: false`. File-based reporters must put `{report}` in one argv entry; every occurrence is replaced by a new, previously nonexistent path. `{artifactDir}` points to the current run's evidence directory.

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

## GitHub boundary

The included workflow extracts the verifier and contracts from the protected base SHA into `$RUNNER_TEMP`, then points that control-plane verifier at the candidate workspace. It pins GitHub Actions by commit and wraps successful receipts in a GitHub OIDC custom attestation.

For adoption, make `Host-owned acceptance` a required status check and protect changes to the workflow, policies, verifier package pin, and canonical tests with CODEOWNERS. Organization-wide use should move the control plane into a separately owned reusable workflow or repository.
