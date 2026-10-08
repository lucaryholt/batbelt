# Steamer

Compare and update OpenBao KV secrets across environments. Every secret write displays the exact `bao kv put` commands and requires explicit approval before any command runs.

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
4. Use **Search** to filter browse-path names and key rows (case-insensitive). Hidden values are not searched.
5. Compare values per key: each key is a collapsed row that expands to list every environment’s read-only value vertically (values hidden until revealed). Keys whose values disagree are marked and highlighted.
6. Edit values, explicitly add or remove environment-specific keys, select target environments, and choose **Review changes**
7. Review only the values that will be added, changed, or removed
8. Continue to inspect every exact `bao kv put` command, then approve the batch or reject it without running anything
9. Use **Open _environment_ in OpenBao** as an alternative editing path

Writes replace the complete secret in each selected environment. Each environment keeps its own key set: a key missing from one environment stays missing unless it is explicitly added there. Empty strings are values, not removals. Approval covers the displayed batch, but environments are written sequentially and a later failure cannot undo an earlier successful write.

### Settings

Add name, address, optional namespace / KV mount / OIDC mount and role. **Save settings** opens a confirm list. **Log in** / **Log out** stay one-click. Login streams `bao` output; CLI lines are redacted.

## Write approval

The first review shows the actual value changes. Continuing creates per-environment JSON payload files with mode `0600`; the second review shows exact commands referencing those files. Steamer keeps command arguments server-side under a single-use approval ID. Approving executes those unchanged arguments without a shell; rejecting deletes the files without running `bao`. Approvals expire after five minutes, and payload files are removed after approval, rejection, or execution failure.

## Security

- Localhost only
- Token files are `0600`
- Secret values are hidden by default
- Login logs are redacted
