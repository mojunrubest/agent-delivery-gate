# Threat Model

## Security objective

Prevent an unreliable or deceptively optimistic Coding Agent from turning an unverified code change into a green delivery status by controlling the narrative, choosing a narrow command, reusing evidence, or writing its own receipt.

The acceptance decision belongs to a protected control plane. The candidate code is data under evaluation, even though canonical tests necessarily execute it.

## Trust boundaries

Trusted for this spike:

- GitHub's hosted runner, OIDC issuer, Actions service, and repository protection rules
- the verifier implementation and policy obtained from the protected base SHA
- canonical tests and reporter configuration owned with the policy
- maintainers who can change protected control-plane files

Untrusted:

- Agent prose and completion claims
- Agent-authored logs, Markdown, screenshots, receipts, and test commands
- the candidate working tree and its test process
- report or artifact files from earlier verifier runs

## Enforced invariants

1. The policy selects one exact argv; the child cannot substitute a narrower command.
2. The verifier creates a unique run directory and report path before launch.
3. Process launch, capture, parsing, policy evaluation, and receipt issuance are one verifier operation.
4. A verified receipt requires a zero exit code, a parseable structured result, at least one passed test, no failed tests, no disallowed flaky tests, required current-run artifacts, and an unchanged clean Git tree.
5. Timeout, signal termination, launch failure, output overflow, missing/malformed report, Git inspection failure, and postflight failure are never green.
6. The final receipt is written atomically after the child exits and includes hashes for the policy, its declared control-asset bundle, argv, streams, report, artifacts, and candidate tree.
7. File evidence with an old modification time is rejected, and run-specific paths prevent accidental resume from consuming an earlier report.

## Attacks covered by the benchmark

- passing Agent claim with a failing canonical suite
- green-looking TAP paired with a nonzero process exit
- zero collected tests and all tests skipped
- narrow Agent test hiding a full-suite failure
- stale report and interrupted-run inode reuse
- forged cooperative receipt
- candidate mutation during verification
- timeout and process crash
- required artifact missing
- screenshot present while a Playwright DOM assertion fails

## Residual risks

The verifier is not a semantic oracle. A weak acceptance contract can still accept incorrect code, and a sufficiently malicious candidate can game public tests. Control-asset declarations are explicit rather than dependency-discovered, so an omitted imported helper remains a contract-review defect.

This spike also executes candidate code on the same host as the verifier. Malicious code could attack processes, files, credentials, or the runner. GitHub-hosted runners limit persistence, but this is not a sandbox boundary. A production version should run candidate commands in an isolated execution engine and return evidence over a narrow protocol to a separate receipt issuer.

The local receipt is deterministic evidence, not a signature. Its control bundle binds declared files, not host runtimes, installed dependency bytes, system inspection tools, the kernel, or the verifier executable. In GitHub, `actions/attest` supplies the identity-bound Sigstore/in-toto envelope. Local consumers must still trust the filesystem, verifier process, and execution environment.

Compromised maintainers, repository administrators, GitHub infrastructure, and organization policy are outside this spike's adversary model.
