# Codex Local HTTP Permission Profile

Snapshot recorded on 2026-07-30 with Codex CLI 0.145.0 on macOS.

## Result

The repository-owned `agent-loopback` beta permission profile lets a sandboxed command write in its workspace and run a real HTTP server on `127.0.0.1`, while the network proxy denies public outbound destinations and the filesystem sandbox denies writes outside the workspace and system temporary roots.

Run the four-boundary probe:

```bash
npm run test:loopback
```

Run any command with the same profile without modifying `~/.codex/config.toml`:

```bash
node scripts/run-agent-loopback.mjs --workspace /path/to/candidate -- npm test
```

The launcher copies [the profile](../profiles/agent-loopback.config.toml) into an ephemeral `CODEX_HOME`, selects both the config layer and permission profile, runs `codex sandbox`, then removes that temporary configuration.

## Why every switch exists

- `extends = ":workspace"` preserves Codex's workspace write boundary and its protected `.git` / `.codex` behavior.
- `permissions.agent-loopback.network.enabled = true` selects network-enabled sandbox behavior.
- `features.network_proxy = true` starts the enforcing proxy. Without it, a profile's domain map did not block `https://example.com` in the tested CLI.
- The only allowed destinations are the exact literals `127.0.0.1` and `localhost`; no wildcard is present.
- `allow_local_binding = true` is necessary for a test process to call `listen()` on macOS. With it unset, `listen(0, "127.0.0.1")` failed with `EPERM`.
- SOCKS5 and upstream proxy chaining are disabled because local HTTP tests do not need them.

Permission profiles are beta and do not compose with the older `sandbox_mode` or `[sandbox_workspace_write]` settings. The launcher isolates this profile from the user's normal config so an older setting cannot silently take precedence.

Official references: [Permissions](https://learn.chatgpt.com/docs/permissions), especially [Network permissions](https://learn.chatgpt.com/docs/permissions#network-permissions) and [Local and private networks](https://learn.chatgpt.com/docs/permissions#local-and-private-networks).

## Verified matrix

| Boundary | Expected | Codex 0.145.0 result |
| --- | --- | --- |
| Write within candidate workspace | allow | allowed |
| Write to a sibling path outside workspace | deny | `EPERM` |
| Bind and fetch `127.0.0.1` | allow | HTTP 200 |
| Fetch `https://example.com` | deny | network proxy cancellation |
| Frozen Webhook Inbox public socket test | allow | 1 / 1 passed |
| Frozen Webhook Inbox protected contract | allow | 9 / 9 verified in 289 ms |

The frozen candidate was also rerun as a real integration:

```bash
node scripts/run-agent-loopback.mjs \
  --workspace /tmp/webhook-inbox-agent-01.3TxYbc/workspace \
  -- npm test
```

## Residual risk

This profile restricts outbound destinations, but it is not a strict network namespace. On the tested macOS Seatbelt implementation, `allow_local_binding = true` also allowed an application to bind `0.0.0.0`; a host request to the machine's LAN address reached that listener. The probe reports this as `wildcardBindAllowed` so the limitation stays visible.

Therefore this profile is suitable for cooperative Agent development and acceptance-test execution, not for running hostile candidate code on a shared network. Use a disposable VM/container with host firewall isolation for adversarial workloads. Do not describe this beta profile as proof that listeners are reachable only through loopback.
