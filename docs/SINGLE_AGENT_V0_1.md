# Single Agent Delivery v0.1

Status: implemented product contract, validated by the checkout and Incident Desk pilots.

## Product decision

Version 0.1 is a delivery boundary for one Coding Agent, not an Agent team or a role-prompt framework. A maintainer gives one Agent a task packet. The Agent changes a candidate repository and opens a pull request. A separately owned control repository decides whether that exact Git tree satisfies a protected executable contract.

```text
maintainer task packet
        |
        v
one Agent -> candidate commit -> pull request -> host-owned acceptance -> receipt
                                         |                 |
                                         |                 +-- verified / unverified / blocked
                                         +-- cannot edit verifier, policy, or protected tests
```

The product promise is narrow: an Agent cannot turn its own claim, log, screenshot, or public test into delivery approval. It does not promise that the contract fully captures product intent or that same-host execution contains actively malicious code.

## User and outcome

The v0.1 user is a repository maintainer delegating a bounded Node or browser task to one Coding Agent. The successful outcome is a pull request with one required host-owned check bound to its Git HEAD and a machine-readable receipt.

The primary measure is accepted-delivery integrity:

- a correct candidate passes the protected contract without access to it;
- a planted false green remains rejected even when candidate-owned tests pass;
- missing, stale, skipped, malformed, timed-out, or tree-mutating evidence fails closed;
- the candidate process never receives GitHub OIDC or attestation authority.

Throughput, persona variety, number of parallel Agents, and conversational realism are not v0.1 success metrics.

## Task packet

Do not begin with a persona such as “you are a senior frontend engineer.” Give the Agent an execution contract containing:

1. **Objective**: the user-visible or API-visible outcome, in one paragraph.
2. **Observable acceptance**: behaviors that an independent black-box test can observe.
3. **Scope**: files or subsystems the Agent may change.
4. **Constraints**: compatibility, accessibility, persistence, security, and responsive requirements.
5. **Candidate checks**: commands the Agent may run locally. These are feedback, not approval.
6. **Delivery shape**: expected source changes and artifacts, without prescribing an implementation.
7. **Escalation conditions**: facts that make the task ambiguous or impossible and require maintainer input.

Keep reference source, protected tests, negative fixtures, prior successful transcripts, and verifier configuration outside the Agent workspace. Acceptance wording should describe semantics, not reference-specific DOM structure or copy.

## Ownership boundary

Two repositories are required for the standard path.

| Asset | Candidate repository | Control repository |
| --- | --- | --- |
| Application source | Yes | No |
| Narrow public checks | Optional | No |
| Pull-request caller workflow | Yes, maintainer-owned | No |
| Verifier and adapters | No | Yes |
| Canonical policy and tests | No | Yes |
| Calibration fixtures | No | Yes |
| Receipt signing authority | No | Post-verification job only |

The workflow file and `CODEOWNERS` are governance surfaces. Require maintainer review for their changes and make the host-owned check mandatory. If the GitHub plan cannot enforce branch protection, the run is evidence but not merge enforcement.

## Standard setup

Requirements: Node 22+, a candidate repository, a separately maintained control repository, and a full 40-character control commit SHA. Candidates with npm dependencies must commit `package-lock.json` or `npm-shrinkwrap.json`; dependency-free candidates do not need a lockfile.

Build this repository, then generate the caller inside the candidate repository:

```bash
npm ci
npm run build
cd /path/to/candidate
node /path/to/agent-delivery-gate/dist/src/cli.js init \
  --control-repository owner/delivery-control \
  --control-ref 0123456789abcdef0123456789abcdef01234567 \
  --policy-path contracts/application-v1.json \
  --browser
```

The command creates `.github/workflows/agent-delivery-gate.yml` and refuses to overwrite an existing workflow. GitHub requires the caller to declare the reusable workflow's maximum permissions before any jobs start. The pinned reusable workflow then downgrades candidate verification to read-only contents and grants OIDC only to its separate post-verification job. Use `--attest` only where GitHub attestations are available; use `--force` only for an intentional maintainer-owned regeneration.

Commit the generated workflow to the protected base branch. After its first run, select the stable host-owned acceptance job as a required check. Protect both the caller workflow and `CODEOWNERS` from Agent-only approval.

The control policy remains an argv-based JSON document. Browser contracts should use the Playwright JSON reporter, keep tests under `{policyDir}`, and write required screenshots or other evidence under `{artifactDir}`. Calibrate every contract against at least one independent correct implementation and one plausible false green before making it required.

## Delivery lifecycle

1. A maintainer freezes the task packet and protected policy version.
2. The Agent works in a clean candidate checkout and runs only candidate-visible feedback.
3. The host freezes the produced Git tree and opens or updates its pull request.
4. GitHub checks out the candidate and the exact control commit separately.
5. The verifier launches the canonical command without a shell and captures structured results.
6. The host emits `verified`, `unverified`, or `blocked`, then preserves the receipt.
7. If enabled, a separate job downloads and attests only the verified receipt.
8. A maintainer reviews product judgment that executable contracts cannot encode.

`unverified` means the candidate ran but did not satisfy the contract. `blocked` means trustworthy evaluation could not be completed, for example because the command timed out or structured evidence was unavailable. Neither state is approval.

## Live v0.1 validation

The generated caller was exercised on [Incident Desk PR 3](https://github.com/mojunrubest/incident-desk-pilot/pull/3) without changing the frozen Run 02 application source. The final caller pinned control commit `f52602ba5e03df2b57e8ee5872f967ae25261626` and completed [run 30532650028](https://github.com/mojunrubest/incident-desk-pilot/actions/runs/30532650028) successfully in 47 seconds. The same control commit's own Unit, Chromium, and OIDC workflow completed in [run 30532629060](https://github.com/mojunrubest/agent-delivery-gate/actions/runs/30532629060).

The downloaded receipt was `verified` with 6 / 6 passing tests, no skips or flaky results, an unchanged clean tree, and required desktop and mobile screenshot hashes. GitHub preserved it with a separate artifact digest. The durable structured record is [single-agent-v0.1.json](../browser-pilot/results/single-agent-v0.1.json).

Two preceding workflow runs were useful integration calibration, not Agent repair rounds. The first exposed GitHub's static reusable-workflow permission ceiling: the caller must grant the pinned workflow's maximum permissions even though its candidate-execution job explicitly downgrades to read-only contents. The second exposed an invalid lockfile assumption in `setup-node` caching. Both constraints are now encoded in the generator or reusable workflow and covered by repository tests.

The next repository varied the task shape rather than repeating UI work. A real isolated Agent implemented a persistent Webhook Inbox HTTP API and passed a nine-group protected contract plus the generated GitHub workflow on its first candidate attempt. The full result is [Real Backend API Agent Pilot](REAL_API_AGENT_PILOT.md). That run also quantified the dominant cost: 3,655 seconds for end-to-end task and contract authoring plus 3,674 seconds for the Agent turn, versus 718 ms for protected execution on GitHub.

## Release boundary

Included in v0.1:

- Node 22+ candidates using npm;
- TAP, JUnit, and Playwright JSON result adapters;
- protected unit or Chromium contracts;
- immutable cross-repository control commits;
- GitHub receipt preservation and optional post-verification attestation;
- deterministic local receipts and explicit failure reasons.

Deferred beyond v0.1:

- multi-Agent roles, routing, planning, or shared memory;
- untrusted-code sandboxing stronger than an ephemeral GitHub runner;
- automatic generation or LLM judging of protected acceptance contracts;
- non-npm candidate preparation;
- deployment authorization based on attestation verification;
- a hosted control plane or GitHub App independent of candidate workflow governance.

The next release decision should be based on repeated real tasks from more than one repository, especially false-negative rate, contract authoring time, and how often maintainers must repair the task packet or contract.
