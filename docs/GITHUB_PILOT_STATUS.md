# GitHub Pilot Status

## Completed locally

- verifier and canonical tests are stored in a separate Git control repository
- the consumer pilot has 20 candidate branches with distinct commits
- all 20 branches pass the candidate-owned public smoke test
- the protected contract accepts all 5 correct candidates and rejects all 15 false-green candidates
- reusable and consumer GitHub workflows are syntactically valid YAML and pin third-party Actions by commit
- the package can be assembled with `npm pack` for a versioned verifier release

## External step still required

This machine currently has no `gh` executable, `GITHUB_TOKEN`, `GH_TOKEN`, configured Git remote, or GitHub repository identity. Consequently it cannot create repositories, configure branch protection or repository variables, open pull requests, request GitHub OIDC credentials, or verify a live Sigstore attestation.

That missing execution is an authorization boundary, not a verifier implementation task. The exact setup sequence is documented in the pilot repository at `docs/PILOT_SETUP.md`.
