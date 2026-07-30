# GitHub Pilot Status

Snapshot recorded on 2026-07-30.

## Live GitHub execution

- Control repository: `mojunrubest/agent-delivery-gate` (public).
- Consumer repository: `mojunrubest/delivery-gate-pilot` (private).
- The consumer pins the control plane to full commit `9816c0d84e2756114ecc1c5c3c390040f17652aa`.
- Control workflow run [30523120522](https://github.com/mojunrubest/agent-delivery-gate/actions/runs/30523120522), attempt 2, completed successfully. The unit contract, real Chromium contract, unit receipt attestation, and browser receipt attestation all passed.
- Consumer PRs 1 through 20 each ran the `Host-owned acceptance` check against a distinct deterministic candidate commit.

| Candidate class | Public smoke test | Protected contract | Observed GitHub check |
| --- | ---: | ---: | ---: |
| 5 complete implementations | 5 / 5 passed | 5 / 5 accepted | 5 / 5 succeeded |
| 15 planted false-green implementations | 15 / 15 passed | 15 / 15 rejected | 15 / 15 failed |

Every rejected PR failed at `Execute protected contract`. Checkout, verifier build, and candidate preparation succeeded first, so infrastructure failures are not counted as verifier rejections. These branches are deterministic candidate simulations, not 20 claimed external Agent sessions.

The matching local evidence is [pilot/results/latest.json](../pilot/results/latest.json).

## Platform limits observed

GitHub returned `Feature not available for user-owned private repositories` when `actions/attest` ran in the private consumer repository. `DELIVERY_GATE_ATTEST` is therefore `false` there, and the `Attest receipt` step is intentionally skipped. The public control repository proves the real GitHub OIDC and custom-predicate attestation path.

GitHub also returned HTTP 403 with `Upgrade to GitHub Pro or make this repository public to enable this feature` for both branch-protection and repository-ruleset APIs on the private consumer repository. Consequently `Host-owned acceptance` cannot be enforced as a required merge check on the current account plan. A successful or failed check is still evidence, but it is not merge enforcement.

The public control repository supports branch protection but its `main` branch was unprotected at the time of this snapshot. Production adoption must protect both the control plane and the consumer workflow, use an immutable control ref, and enforce the verifier check through a GitHub plan or repository ownership model that supports those controls.
