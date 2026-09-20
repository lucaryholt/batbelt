# Steamer

Compare and write OpenBao KV secrets across environments. Adapted from [`bao-helper`](/Users/luca/repos/bao-helper). Compare and Write are one **Secrets** page. Every write and every settings save asks for confirmation.

UI: `/steamer/secrets`, `/steamer/settings`.

All OpenBao traffic goes through the [`bao`](https://openbao.org/docs/commands/) CLI. Login is OIDC (`bao login -method=oidc`).

The host binds `127.0.0.1` only. Tokens live under `~/.config/batbelt/steamer/tokens/` so they never overwrite `~/.vault-token`.

## Requirements

- The `bao` CLI on `PATH`
- OIDC enabled on each OpenBao instance
- Redirect URI `http://localhost:8250/oidc/callback` allowed (bao’s callback port)

## Data

| Path | Contents |
| --- | --- |
| `~/.config/batbelt/steamer/config.yaml` | Environments |
| `~/.config/batbelt/steamer/tokens/` | Per-environment tokens (`0600`) |

The original bao-helper app still uses `~/.config/bao-helper/`. Copy that YAML by hand if you want the same environments.

```yaml
environments:
  - name: dev
    addr: https://bao-dev.example.com
    namespace: ""
    oidcMount: oidc
    oidcRole: ""
    kvMount: secret
```

## Pages

### Secrets

1. Pick KV mount and path
2. **Browse paths** to see which keys exist in which environment
3. **Load existing secret** from one environment or all
4. Edit the key × environment grid (values hidden until revealed)
5. Tick which environments to write
6. Confirm the summary (create vs overwrite, key list), then `bao kv put`

The server rejects writes without `confirm: true`, including first-time creates.

### Settings

Add name, address, optional namespace / KV mount / OIDC mount and role. **Save settings** opens a confirm list. **Log in** / **Log out** stay one-click. Login streams `bao` output; CLI lines are redacted.

## How writes work

`bao kv put` with a JSON payload file (`0600`, deleted afterwards). The entire secret is replaced.

## Security

- Localhost only
- Token files are `0600`
- Secret values are hidden by default
- Login logs are redacted
