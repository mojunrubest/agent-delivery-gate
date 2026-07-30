# Real Backend API Agent Pilot

Snapshot recorded on 2026-07-30.

## Result

One isolated Codex CLI session implemented a persistent Webhook Inbox HTTP service from a six-file stub. The frozen source passed the candidate-owned socket test, the nine-group protected TAP contract, and the real GitHub `delivery-gate / Host-owned acceptance` check on its first candidate attempt.

| Wall clock | Input / cached | Output / reasoning | Public | Protected | GitHub evidence |
| ---: | ---: | ---: | ---: | ---: | --- |
| 3,674 s | 282,353 / 214,528 | 17,895 / 10,374 | 1 / 1 | 9 / 9 | [PR 1](https://github.com/mojunrubest/webhook-inbox-pilot/pull/1), [run 30541074678](https://github.com/mojunrubest/webhook-inbox-pilot/actions/runs/30541074678) |

The Agent changed only `src/server.mjs`. The published PR blob has SHA-256 `03ee550930230185657ce981f916e0543b0c78177a34b122e9099d7a5db90f82`, identical to the source frozen before protected evaluation. Candidate repair rounds were zero.

The local receipt was `verified` in 261 ms. GitHub bound a separate verified receipt to its merge commit, ran the protected command in 718 ms, completed the full reusable workflow in 13 seconds, and preserved the receipt with artifact digest `sha256:b9e9dfbcae7628a7683dcaba0d1fe99961945ed19a5f885447cb7b06af036d74`.

The durable machine-readable record is [real-agent-latest.json](../api-pilot/results/real-agent-latest.json).

## Task shape

This sample deliberately differs from the previous checkout function and Incident Desk browser UI. It is a stateful Node HTTP service with:

- semantic idempotency and duplicate conflict detection;
- serialized concurrent submissions;
- atomic JSON persistence and restart recovery;
- corrupted-storage fail-closed behavior;
- body-size and schema validation;
- type filtering and cursor pagination.

The Agent received only `.gitignore`, `ISSUE.md`, `README.md`, `package.json`, the `src/server.mjs` stub, and one public happy-path test. The generated workflow, control repository, reference and negative implementations, other branches, prior task history, and host evidence were absent. The prompt prohibited network access, external paths, test or metadata edits, history inspection, and commits. The seven observed commands and four file-change events complied; no web search occurred.

## Contract calibration

The final contract accepts the independent reference at 9 / 9. A planted false green that treats every duplicate ID as an idempotent success still passes the public test at 1 / 1 but fails the protected contract at 7 / 9. The two failures cover sequential and concurrent conflicts.

The first reference run exposed one contract configuration error: a deliberately invalid 101-character field also exceeded the test's small body limit, so the implementation correctly returned 413 before schema validation. The contract separated those inputs and the same reference source then passed 9 / 9. This was verifier calibration before the Agent session, not an Agent failure.

The frozen contract contains 226 test lines and nine behavior groups. Commit-to-commit wall time for the task packet, baseline repository, reference implementation, negative implementation, calibration, local checks, and control commit was 3,655 seconds. It is an end-to-end contract-authoring cost, not a pure typing benchmark.

## Sandbox finding

Codex `workspace-write` denied the candidate public test's loopback `listen()` with `EPERM`. The Agent did not request broader access. It built a temporary in-process request harness over the same Node server request handler and used it to exercise the derived edge cases. After the turn, the host ran the unchanged candidate-owned socket test outside the Agent sandbox and it passed 1 / 1, followed by the protected real-socket contract at 9 / 9.

One host preflight is excluded: the isolated clone had no local Git author identity, so the host's freeze commit failed and the verifier rejected the dirty tree before launching the candidate command. Adding repository-local host identity did not change the source blob; the subsequent clean-tree run is the recorded local receipt.

## Cost and interpretation

The Agent turn took 3,674 seconds and used 282,353 input tokens, including 214,528 cached, plus 17,895 output tokens and 10,374 reasoning tokens. The configured provider did not expose a billed amount or pricing contract, so no dollar cost is invented.

This sample extends the evidence across another repository and a non-browser stateful API. It also changes the product conclusion: verifier execution is cheap relative to contract authoring and Agent reasoning. A production plan should optimize task/contract reuse and provide a safe loopback-capable Agent sandbox before spending effort on multi-Agent orchestration.
