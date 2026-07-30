# Real Versioned Document Agent Pilot

Snapshot recorded on 2026-07-30.

## Result

The API Contract Starter Kit was reused for a second backend API and a third heterogeneous one-Agent task. One isolated Codex CLI session implemented a persistent Versioned Document service with strong ETags, conditional requests, optimistic concurrency, atomic persistence, and restart recovery.

| Contract preparation | Agent turn | Input / cached | Output / reasoning | Public | Protected | GitHub evidence |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 305 s core / 554 s ready | 421 s | 238,443 / 207,872 | 15,158 / 8,717 | 1 / 1 | 8 / 8 | [PR 1](https://github.com/mojunrubest/versioned-document-pilot/pull/1), [run 30555101927](https://github.com/mojunrubest/versioned-document-pilot/actions/runs/30555101927) |

The Agent changed only `src/server.mjs`. The frozen candidate and GitHub merge source have the same SHA-256, `70f26108a29c197b2e965f7a3346e68aa2c7e4a78126f3d862ee8bc6bc11dcb4`. Candidate repair rounds were zero.

The local protected receipt was `verified` in 260 ms. GitHub ran the same eight-group contract in 506 ms, completed the host-owned job in 15 seconds, and preserved a receipt artifact with digest `sha256:6dbcabc83a4d8851e2b195d9c9d8829a962d3dfea5283a290e3feba56cf8ae34`.

The durable machine-readable record is [real-agent-latest.json](../document-api-pilot/results/real-agent-latest.json).

## Task shape

The candidate received a stub, one public create/read test, and a behavior-first task packet. The hidden contract exercised:

- exact strong ETag creation and revision increments;
- `If-Match`, `If-None-Match`, `304`, `204`, `412`, and `428` semantics;
- serialized concurrent writes against one revision;
- media type, malformed JSON, schema, ID, and body-size failures;
- conditional deletion, atomic persistence, restart recovery, invalid storage, and unknown routes.

This differs materially from Webhook Inbox's idempotent event acceptance, ordering, filtering, and cursor pagination. The Agent could not reuse a prior implementation even though maintainers reused the contract structure and HTTP helpers.

## Starter kit reuse

Core task packet, candidate baseline, protected contract, reference, planted negative, and local calibration took 305 seconds. Including the immutable control commit, generated caller workflow, private GitHub repository, and clean-room clone, the system was ready for the Agent in 554 seconds.

The previous Webhook Inbox preparation took 3,655 seconds. The observed core derivation was 11.98 times faster; the conservative ready-for-Agent comparison was 6.60 times faster. This is one measured reuse result, not a general productivity claim: task complexity differs and the first pilot included more discovery work.

No contract repair was needed. The independent reference passed protected tests 8 / 8 on its first run. A planted implementation that accepted any present `If-Match` header still passed public 1 / 1 but failed protected 2 / 8 groups: sequential stale/weak tags and concurrent updates.

The reference stored documents as an array while the Agent independently chose an object map. Both passed, which is useful evidence that the contract constrained observable behavior rather than copying reference internals.

## Restricted Agent execution

This was the first real Agent run under the repository's Codex 0.145.0 `agent-loopback` permission profile. The Agent ran the unchanged real-socket public test itself and passed 1 / 1; unlike the Webhook Inbox run, it needed no in-process transport workaround.

The profile allowed workspace writes plus exact `localhost` / `127.0.0.1` traffic, denied other outbound destinations, disabled upstream proxy chaining, and allowed no approval escalation. The Agent performed ten command executions, two source change events, zero web searches, and modified only `src/server.mjs`.

The profile's documented macOS caveat remains: `allow_local_binding = true` can also permit wildcard listener binding, so it is a cooperative development boundary rather than hostile-code isolation.

## Interpretation

The reusable unit is not a role prompt. It is the combination of task-packet fields, a fail-closed policy, real-socket helpers, reference/negative calibration, immutable workflow wiring, and a receipt format. This run shows that those assets can reduce setup time without exposing protected behavior or forcing the candidate to share the reference implementation's structure.

One successful reuse is not enough to automate contract generation or introduce multi-Agent roles. The next useful test is cross-runtime reuse, where the candidate is not Node while the host-owned contract remains Node-based HTTP black-box testing.
