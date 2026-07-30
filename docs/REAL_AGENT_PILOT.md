# Real Agent Pilot

Snapshot recorded on 2026-07-30.

## Result

Three independent Codex CLI sessions implemented the checkout task from the same clean stub. All three passed the one candidate-owned public test, the 13-test local protected contract, and the real GitHub `Host-owned acceptance` check on their first attempt.

| Run | Wall clock | Input / cached | Output / reasoning | Local contract | GitHub evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| 01 | 205 s | 114,636 / 79,104 | 5,427 / 2,534 | 13 / 13 | [PR 21](https://github.com/mojunrubest/delivery-gate-pilot/pull/21), [run 30526941845](https://github.com/mojunrubest/delivery-gate-pilot/actions/runs/30526941845) |
| 02 | 198 s | 83,739 / 41,984 | 5,211 / 2,761 | 13 / 13 | [PR 23](https://github.com/mojunrubest/delivery-gate-pilot/pull/23), [run 30527015337](https://github.com/mojunrubest/delivery-gate-pilot/actions/runs/30527015337) |
| 03 | 258 s | 135,748 / 107,520 | 7,059 / 3,719 | 13 / 13 | [PR 22](https://github.com/mojunrubest/delivery-gate-pilot/pull/22), [run 30526962404](https://github.com/mojunrubest/delivery-gate-pilot/actions/runs/30526962404) |

First-attempt acceptance was 3 / 3. No repair round was needed. The three source SHA-256 values are distinct, and every GitHub job succeeded specifically at `Execute protected contract`; private-repository attestation remained intentionally skipped.

The machine-readable evidence is [real-agent-latest.json](../pilot/results/real-agent-latest.json).

## Protocol

- Codex CLI `0.145.0`, model `gpt-5.6-sol`, reasoning effort `xhigh`.
- Each ephemeral session received only `ISSUE.md`, `package.json`, the `src/checkout.mjs` stub, and one public test.
- Candidate fixture scripts, the control repository, other branches, and prior task history were absent from the session workspace. The clean snapshot had only one root baseline commit so normal Git-aware Agent tooling still worked.
- The prompt prohibited network access, external paths, test edits, package edits, history inspection, and commits. The observed tool events complied.
- The Agent could run the public test and temporary inline assertions. It could not run or read the protected contract.
- After the turn ended, the host committed the exact source blob, ran the protected verifier, and published the same blob on a one-file GitHub PR.
- Elapsed time measures clean-baseline readiness through host freeze. Token counts come from the CLI's `turn.completed` event.

An initial preflight session was excluded after it revealed that the normal pilot checkout contained `scripts/candidates.mjs`, which embeds the deterministic fixture implementations. It was terminated before that file was read and before code was edited. Excluding it is necessary; counting it would contaminate the experiment.

## Interpretation

This experiment proves the gate can accept real Agent output across the local and GitHub control boundaries. It does not establish a general 100% Agent success rate: `n=3`, one task, one model, one reasoning setting, and a precise issue specification are too narrow for that claim.

The configured custom model provider did not expose a billed amount or a pricing contract, so no dollar cost is invented. The recorded total is 334,123 input tokens, including 228,608 cached input tokens, plus 17,697 output tokens and 9,014 reasoning output tokens.

The next useful sample should vary task shape rather than repeat this implementation: a multi-file state transition, a browser interaction with Playwright evidence, and an intentionally ambiguous requirement that can exercise a repair round.
