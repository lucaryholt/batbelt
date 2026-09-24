# Steamer

Compare OpenBao KV secrets across environments. Secret writes are disabled in Steamer; each environment has an **Open in OpenBao** link for making changes in the OpenBao UI. Settings remain editable and every settings save asks for confirmation.

UI: `/steamer/secrets`, `/steamer/settings`.

Secret reads and login go through the [`bao`](https://openbao.org/docs/commands/) CLI. Login is OIDC (`bao login -method=oidc`).

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
4. Use **Search** to filter browse-path names and key-grid rows (case-insensitive). Hidden values are not searched.
5. Compare the read-only key × environment grid (values hidden until revealed)
6. Use **Open _environment_ in OpenBao** to change the current secret in that environment

The client write helper and `POST /api/steamer/secrets` both reject all secret writes. The existing `bao kv put` implementation remains in the code but is unreachable until the feature is ready.

### Settings

Add name, address, optional namespace / KV mount / OIDC mount and role. **Save settings** opens a confirm list. **Log in** / **Log out** stay one-click. Login streams `bao` output; CLI lines are redacted.

## Disabled write implementation

The retained implementation uses `bao kv put` with a JSON payload file (`0600`, deleted afterwards). It would replace the entire secret, but the API currently rejects the request before this code runs.

## Security

- Localhost only
- Token files are `0600`
- Secret values are hidden by default
- Login logs are redacted
