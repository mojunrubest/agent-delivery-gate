# Real Cross-Runtime Agent Pilot

Snapshot recorded on 2026-07-30.

## Result

The Node-owned API Contract Starter Kit verified a candidate implemented as a separate Python 3.9 standard-library process. One isolated Codex CLI session built a persistent content-addressed blob service with atomic storage, concurrent idempotency, ETags, byte ranges, restart recovery, and fail-closed storage validation.

| Contract preparation | Agent turn | Input / cached | Output / reasoning | Public | Protected | GitHub evidence |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 561 s core / 813 s ready | 637 s | 431,795 / 383,232 | 26,010 / 15,635 | 1 / 1 | 8 / 8 | [PR 1](https://github.com/mojunrubest/blob-store-python-pilot/pull/1), [run 30561322261](https://github.com/mojunrubest/blob-store-python-pilot/actions/runs/30561322261) |

The Agent changed only `src/blob_server.py`. The source at its frozen commit, the maintainer integration head, and the GitHub merge ref has SHA-256 `32481bb9cc6950157f569e7200791b24745747f6d40b3de8a944c69978445709`. Candidate repair rounds were zero.

The local protected receipt passed eight groups in 2.373 seconds. GitHub ran the same contract in 2.766 seconds, completed the host-owned job in 21 seconds, and preserved a receipt artifact with digest `sha256:703d9f021397f85340ae4beab9dad1a73a48d9ce6be2b9012f6b326837f3a6d6`.

The durable machine-readable record is [real-agent-latest.json](../python-api-pilot/results/real-agent-latest.json).

## Cross-runtime boundary

The protected tests remained JavaScript `node:test` code. A new business-neutral helper launched an argv-defined child process, bounded readiness output and startup time, required the advertised host to be `127.0.0.1`, and terminated the child with a bounded SIGTERM-to-SIGKILL sequence. The candidate needed no Node adapter, copied contract, or candidate-owned reporter.

The Python process printed one readiness JSON line and then exposed only HTTP behavior. This let the same verifier bind a Node TAP report to an unchanged Python Git tree. It is the first evidence in this repository that the reusable acceptance boundary is a process protocol rather than a shared application runtime.

## Calibration

Core task packet, candidate baseline, process helper, protected contract, reference, planted negative, and calibration took 561 seconds. Including immutable control publication, caller generation, private repository creation, and clean-room cloning, the system was Agent-ready in 813 seconds.

The independent reference passed public 1 / 1 and protected 8 / 8. A planted implementation that ignored `Range` still passed public 1 / 1 but failed exactly the protected range group, producing `200 !== 206` and protected 7 / 8.

Calibration was not perfect on the first attempt. One contract-local variable shadowed global `process` and caused a temporal-dead-zone failure. After that contract repair, the reference exposed an unread rejected-PUT body on a keep-alive connection and was repaired to close those connections. The machine record therefore reports one contract repair round and one reference repair round rather than presenting the final contract as first-draft correct.

## Restricted Agent execution

The Agent ran under Codex 0.145.0's `agent-loopback` permission profile. It could write only within the candidate workspace and communicate only with exact `localhost` / `127.0.0.1` destinations, with no approval escalation or upstream proxy. It ran the unchanged real-socket public test itself and passed 1 / 1.

The profile denied Python's attempted external bytecode-cache write. The Agent adapted by disabling bytecode output and placing ephemeral test storage under `src/`, then independently exercised concurrency, range, restart, invalid storage, chunked input, cleanup, compile, and import behavior. It made 26 command executions, four source change events, zero web searches, and changed only the permitted source file.

The profile's macOS caveat remains: `allow_local_binding = true` can also permit wildcard listener binding, so it is a cooperative development boundary rather than hostile-code isolation.

## Workflow findings

The first real GitHub run failed before protected execution because the reusable workflow still unconditionally ran `npm run build --if-present` in the candidate workspace. A pure Python repository has no `package.json`, so cross-runtime use exposed a hidden Node-only assumption. Control commit `015f335a527ebb01c0fcb4ee944e9bdf053efc7a` now skips candidate npm preparation unless a Node manifest exists and includes a regression assertion.

Updating the base workflow pin and reopening the existing PR still reused its stale merge ref. A maintainer-only merge synchronized the new base pin into the Agent branch without changing the Agent source or the PR implementation diff. The third workflow attempt then passed. These were two workflow calibration findings and zero candidate repair rounds; both failed runs stopped before the protected contract started.

## Interpretation

The single-Agent direction now has evidence across browser UI, two Node APIs, and one Python process API. Runtime independence came from a narrow process/readiness protocol plus observable HTTP behavior, not richer role prompts or multi-Agent orchestration.

This is one Python task, not a universal runtime claim. The next useful engineering step is to extract candidate preparation into an explicit optional workflow input or detected adapter set, then validate another non-Node runtime without changing the verifier or process helper.
