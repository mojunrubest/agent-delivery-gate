# Adoption Checklist

1. Put canonical acceptance policies and tests under maintainers who do not delegate approval to the Coding Agent.
2. Run the verifier from a protected base ref, pinned package, or separately owned reusable workflow. Do not execute a verifier implementation supplied by the candidate PR.
3. Make the verifier job's stable name a required branch-protection check. Do not treat “no checks found” as success.
4. Use clean, ephemeral runners and keep receipt issuance after the candidate process has exited.
5. Use structured reporter protocols. Never derive acceptance from Agent Markdown or a regex over human-oriented output.
6. Set time and output bounds, require nonzero test collection and at least one pass, and declare required artifacts explicitly.
7. Grant OIDC and attestation permissions only to a separate post-verification job. Step-level ordering does not remove job-scoped OIDC authority from the candidate command.
8. Verify GitHub attestations and receipt policy IDs at deployment time, not only in the pull-request UI.
9. Move candidate execution into a stronger sandbox before expanding the threat model to actively malicious code.

The included workflow demonstrates the base-SHA control-plane pattern for this repository. Fork pull requests still run the required verifier, but custom attestation is skipped when GitHub does not grant repository attestation authority.

For a separate consumer repository, generate a pinned caller with `delivery-gate init`; the full setup and ownership model are in [Single Agent Delivery v0.1](SINGLE_AGENT_V0_1.md). The checkout pilot under `../delivery-gate-pilot` demonstrates the earlier repository-variable configuration used before the generated caller was available.
