# Kickflip

Tick YAML-configured Deployments, then annotate ExternalSecrets and/or `rollout restart`.

UI: `/kickflip/services`.

## Requirements

- `kubectl` on `PATH`
- Contexts in the YAML must exist in your kubeconfig

## Data

`~/.config/batbelt/kickflip/config.yaml`

First start writes a generic seed (`kind-dev` / `kind-prod` contexts and `a-team` / `b-team` namespaces). Later starts do **not** overwrite that file. Edit on disk, then **Reload config**. The UI never writes the YAML.

**Open YAML** runs `code` on that file (needs the Cursor/VS Code `code` shell command on `PATH`).

## Page

Click a service tile to select it. **Select all**, **Unselect all**, and per-namespace select work as well.

1. Pick a kubectl context (dropdown; initial value is `default: true`)
2. Mode: **Restart** or **Secrets + restart**
3. Confirm the summary
4. Live log streams `kubectl` stdout/stderr

Kickflip does not run `kubectl rollout status`. One run at a time; a second run returns HTTP 409. The server rejects `/run` without `confirm: true`.

### Modes

**Secrets + restart** (matches the bash script):

```bash
kubectl --context=… --namespace=… annotate es <external_secret> force-sync=<unix> --overwrite
kubectl --context=… --namespace=… rollout restart deployment/<deployment>
```

**Restart** skips the annotate.

Defaults: ExternalSecret `{name}-env`, Deployment `{name}`. Override per service with `external_secret` and `deployment`.

## YAML

```yaml
contexts:
  - name: dev
    context: kind-dev
    default: true
  - name: prod
    context: kind-prod
namespaces:
  - name: a-team
    services:
      - name: svc-1
      - name: svc-2
  - name: b-team
    services:
      - name: gateway
        external_secret: gateway-env
        # deployment: gateway
```

Exactly one context should set `default: true`. If none do, the first context is used.
