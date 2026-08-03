# Content Blob Contract Mutation Audit v1

Snapshot recorded on 2026-08-03 against control commit `47c518e18066020861a4ed5efed089ae3c45006e` and the unchanged `content-blob/python-http-v1` policy.

## Result

The original protected contract is materially stronger than the public test, but it is not a broad delivery oracle.

| Corpus | Killed | Survived | Mutation score |
| --- | ---: | ---: | ---: |
| Public test | 3 / 53 | 50 / 53 | 5.7% |
| Protected v1 | 32 / 53 | 21 / 53 | 60.4% |

Of the 32 protected rejections, 30 were normal `unverified` assertion failures. Two were only `blocked` after the 60-second verifier timeout: a rejected readiness host left child processes alive, and an HTTP/1.1 blob response without framing left the client waiting. Those are kills, but not precise or efficient ones.

The machine-readable campaign is [mutation-latest.json](../python-api-pilot/results/mutation-latest.json). It records every mutation, public and protected status, TAP failure groups, durations, category scores, fixture hash, policy hash, and frozen control commit.

## Survivors

The 21 protected false greens were:

- process: extra stdout after readiness, wildcard binding, and ignored `SIGTERM`;
- CLI: invalid default port, optional storage directory, and accepted negative body limit;
- storage: ignored invalid names/non-regular entries, destructive invalid-storage handling, direct final-path writes, and missing file `fsync`;
- upload/resource: uppercase digest acceptance, zero-as-unlimited body limit, and reading an oversized body before rejection;
- read: writing bytes in a `HEAD` response;
- routing: nested path misclassification, accepted trailing slash, POST creation, DELETE of existing blobs, collection HEAD, and collection PUT.

Cache, concurrency, and Range mutations scored 100% in this corpus. Routing scored 14.3%, process 25%, CLI and resource handling 0%. This is a useful shape: v1 is strong on the feature examples it explicitly exercises and weak at the process, negative-space, and failure-mode boundaries.

## Method

The campaign uses one correct Python standard-library fixture with one named fault activated per isolated temporary Git repository. Each repository runs the same candidate-visible public test and the real Delivery Gate against the frozen v1 policy. A no-mutation baseline must pass both checks before any mutant is evaluated.

The 53 faults are explicit and reviewable rather than random line edits. They cover process, CLI, storage, upload, resource, concurrency, read, cache, Range, and routing behavior. Four workers run isolated verifier processes, so environment-selected mutations cannot bleed between cases.

## Limits

Mutation score is not a probability of correctness. The corpus is still authored by the same investigation and may omit entire failure families. Two durable-write mutations, `no_atomic_replace` and `no_file_fsync`, cannot be distinguished by a normal successful request/restart sequence; killing them requires crash or filesystem fault injection rather than more response assertions.

The campaign also exposed a helper defect: readiness rejection does not currently stop the rejected child process, turning one precise protocol violation into a verifier timeout. The next contract version should preserve v1, add adversarial process/storage/routing tests, repair readiness cleanup, and keep crash-durability survivors visible instead of claiming a synthetic 100% score.
