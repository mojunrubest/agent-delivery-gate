# REPLACE_ME: API Task

## Outcome

Implement `REPLACE_ME` so a caller can `REPLACE_ME`. Delivery means the observable contract below passes; an Agent-authored completion claim is not acceptance evidence.

## Candidate surface

- Runtime and version: `REPLACE_ME`
- Required export or start command: `REPLACE_ME`
- Files the implementation may change: `REPLACE_ME`
- Files and metadata it must not change: task packet, tests, package scripts, lockfiles, workflow, and Git history unless explicitly listed above.

## HTTP contract

| Operation | Request | Success | Errors |
| --- | --- | --- | --- |
| `REPLACE_ME` | method, path, headers, body schema and size limit | status, headers and response schema | status and stable error body |

Define these observable semantics explicitly:

- validation order and malformed-input behavior;
- idempotency and conflict behavior;
- ordering, filtering, pagination, and cursor rules;
- concurrent request behavior and winner selection;
- persistence, restart recovery, and invalid-state handling;
- response content type, unknown routes, and unsupported methods;
- maximum body, output, time, and storage constraints.

## Constraints

- Work only inside the candidate workspace.
- Do not access external network destinations.
- Do not inspect hidden acceptance tests, reference implementations, negative fixtures, other branches, or prior task history.
- Run the candidate-owned public tests before handing off.
- Do not commit unless the host explicitly requests it.

## Ambiguity rule

When this packet leaves observable behavior unspecified, choose the smallest conventional implementation and record the assumption. Do not invent additional endpoints or broaden the public API.

## Handoff

Report changed files, public test results, and remaining assumptions. The host-owned verifier, not the Agent response, decides whether delivery is accepted.
