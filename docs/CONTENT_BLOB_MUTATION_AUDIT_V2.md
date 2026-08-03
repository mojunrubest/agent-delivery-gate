# Content Blob Adversarial Contract and Mutation Audit v2

Snapshot recorded on 2026-08-03 against frozen control commit `e2fbcd5ab0c5293cea06c752f7e446662805ec57`. The final campaign used the same 53 explicit mutants as v1 and the repaired fixture SHA-256 `dcf279db855e1a7bfbfb612c5a8f90c6851df846c08e30639d70a070cca0e97c`.

## Result

The adversarial contract removes most of v1's known blind spots, but the result is still `GAPS_FOUND`, not a correctness claim.

| Corpus | Killed | Survived | Mutation score |
| --- | ---: | ---: | ---: |
| Public test | 3 / 53 | 50 / 53 | 5.7% |
| Protected v1 | 32 / 53 | 21 / 53 | 60.4% |
| Protected v2 | 51 / 53 | 2 / 53 | 96.2% |

All 51 v2 kills were normal `unverified` assertion failures. There were zero blocked evaluations and zero timeouts, compared with two timeout-only kills in v1. Nine of ten categories killed every mutant; storage killed 10 / 12.

The machine-readable campaign is [mutation-v2-latest.json](../python-api-pilot/results/mutation-v2-latest.json). It records each public and protected outcome, failure group, duration, category score, frozen commit, policy and fixture hashes, and the verifier-issued control bundle manifest.

## What v2 added

Seven adversarial groups extend the original eight groups across CLI validation, readiness output, actual listener scope, graceful termination, invalid-storage immutability, exact zero limits, early oversized-request rejection, raw HEAD framing, and all unsupported route/method combinations.

The process helper now terminates children after rejected readiness and exposes bounded shutdown results and post-readiness stdout. The final listener assertion reads the host kernel socket table through `lsof`, scoped to the child PID and advertised port. On the calibration host, the correct process was `127.0.0.1:<port>` and `bind_wildcard` was `*:<port>`; the earlier `127.0.0.2` connectivity probe could not reliably distinguish them on macOS.

The frozen real Agent source at `09a447099c0e214a4fa4e1d8bd9dd2b6c1168ff2` passed 15 / 15 after calibration. Its candidate tree digest was `eac31a21402b3aa97babad21fd7efd26e8221fc62ecc7e87518f05641428bbb8` before and after verification.

## Calibration trail

The first v2 run against the unchanged Agent passed 14 / 15. The failing assertion required `/blobs/` to be exactly `404 not_found`, while the task's digest-path wording also permits `400 invalid_digest`. The repaired contract accepts either documented interpretation but still rejects the routing mutant's `200` response. The same frozen Agent then passed 15 / 15.

A mutation-fixture route rejected an unknown method without closing a connection whose request body was not consumed. This polluted the next keep-alive request and was repaired before the final campaign. It was a fixture repair, not a candidate repair.

An initial v2 campaign killed 50 / 53 (94.3%) but left `bind_wildcard` alive because the remote-address probe was platform-dependent. Direct kernel socket inspection killed that mutant in the final campaign. These intermediate findings are retained here rather than presenting the final score as a first-draft result.

## Remaining survivors

`no_atomic_replace` writes directly to the final digest path. The task explicitly requires a unique temporary file followed by atomic replacement, but a successful request and clean restart leave the same final bytes in both implementations. A controlled short write, `ENOSPC`, or crash during publication is needed to observe the difference.

`no_file_fsync` omits `flush()` plus `fsync()` before replacement. This is not yet a clean contract miss: the task says "flush it" but does not define whether that means userspace flush, file `fsync`, directory `fsync`, process-crash survival, or power-loss durability. The reference fixture calls file `fsync` but does not `fsync` the directory after rename. A 100% mutation score obtained by secretly requiring one syscall sequence would overstate the written requirement and reject valid alternative implementations.

## Durability campaign gate

Before adding crash tests, the task packet must define the durability boundary: what a returned `201` guarantees, which crash model applies, whether temporary crash residue is allowed, and whether recovery must clean or merely fail closed.

The follow-up campaign should then:

1. Repair and calibrate an independent reference against the clarified rule, including directory durability if power loss is in scope.
2. Add explicit direct-final-write, missing-file-sync, and missing-directory-sync negatives.
3. Inject short writes, `ENOSPC`, sync failure, and rename failure at the filesystem boundary; inspect storage before restart and require that no partial file is published under a valid digest.
4. Run process-crash tests separately from VM or filesystem power-loss tests. `SIGKILL` alone is not evidence that acknowledged bytes reached durable media.
5. Record kernel, filesystem, mount options, fault mechanism, and every blocked run. Keep the two current survivors visible until this campaign exists.

## Control evidence

Earlier receipts bound only the policy JSON. They did not bind the tests and helpers reached through `{policyDir}`. The verifier now requires a protected policy to declare `controlAssets`, rejects declared assets inside the candidate workspace, hashes the policy plus sorted asset evidence, and compares the bundle again after execution.

The final campaign's baseline receipt records bundle SHA-256 `7bcda4e2f1cfdaba246df3213fa7bed02ce5e503f73f539c196cbfc7f28825a8` over the v2 policy, both contract files, and both local HTTP helpers. Declaration completeness remains a review responsibility. Node, Python, installed packages, `lsof`, the kernel, filesystem, verifier executable, and other host provenance are not covered by this bundle.

## Conclusion

v2 demonstrates that adversarial contract work and mutation analysis can turn 19 known false greens into precise rejections without changing the frozen Agent. It also demonstrates why the next milestone is not multi-Agent orchestration or another happy-path pilot: the remaining questions are requirement governance, durability fault injection, dependency completeness, and execution-environment provenance.
