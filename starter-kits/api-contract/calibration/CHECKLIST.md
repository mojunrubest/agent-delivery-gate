# API Contract Calibration Checklist

Do not expose this calibration material, the reference implementation, or negative fixtures to the candidate Agent.

## Contract design

- [ ] Every task-packet claim maps to at least one observable assertion.
- [ ] Happy paths and stable response headers/body shapes are covered.
- [ ] Malformed JSON, schema failures, size limits, unknown routes, and unsupported methods are separated so validation precedence is intentional.
- [ ] Idempotency, conflicts, concurrency, ordering, pagination, persistence, restart, and corrupt-state behavior are covered when applicable.
- [ ] Tests assert behavior rather than reference-specific markup, wording, internal functions, timing, or file layout.
- [ ] The protected command uses a real listener and requests, not an in-process mock that bypasses the transport boundary.
- [ ] `controlAssets` names every protected contract, config, helper, and local transitive dependency used by the command.

## Reference pass

- [ ] Build the reference independently from the candidate implementation.
- [ ] Run the public test and record its count.
- [ ] Run the protected policy through Delivery Gate and require `verified`.
- [ ] Inspect the receipt's Git SHA, policy bundle hash and asset manifest, command hash, test counts, and unchanged tree digest.
- [ ] Correct any contract defect and rerun the same frozen reference before starting the Agent session.

## Negative calibration

- [ ] Plant at least one realistic false green that passes the public smoke test.
- [ ] Require the protected contract to reject it for the intended missing behavior.
- [ ] Add separate negatives for high-risk semantics such as conflict-vs-idempotent handling, concurrent races, partial writes, or corrupt persistence.
- [ ] Confirm a negative cannot pass by skipping tests, collecting zero tests, mutating the candidate tree, timing out, forging a receipt, or emitting green-looking TAP with a failing exit code.

## Freeze and run

- [ ] Freeze the final task packet, public test, protected policy/tests/helpers, reference, and negatives with hashes before the Agent turn.
- [ ] Give the Agent only the task packet, candidate stub, public test, and allowed workspace.
- [ ] Run the Agent with workspace writes, local HTTP access, no public outbound network, and no external filesystem writes.
- [ ] Run the unchanged public test, then the protected verifier against the same frozen candidate source.
- [ ] Record repair rounds and separate contract-authoring time from Agent time and verifier runtime.
