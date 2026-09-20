# Kickflip

Tick YAML-configured Deployments, then annotate ExternalSecrets and/or `rollout restart`. Replaces [`secret-service-restarter`](/Users/luca/scripts/secret-service-restarter).

UI: `/kickflip/services`.

## Requirements

- `kubectl` on `PATH`
- Contexts in the YAML must exist in your kubeconfig

## Data

`~/.config/batbelt/kickflip/config.yaml`

First start writes a seed from the old script (gowish namespaces + default GKE context). Later starts do **not** overwrite that file. Edit on disk, then **Reload config**. The UI never writes the YAML.

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
    context: gke_gowish-devx_europe-west1_api-eu
    default: true
  - name: prod
    context: gke_gowish-prod_europe-west1_api-eu
namespaces:
  - name: personalization-service
    services:
      - name: brands
      - name: wish-genie
  - name: graphql-gateway
    services:
      - name: gateway
        external_secret: gateway-env
        # deployment: gateway
```

Exactly one context should set `default: true`. If none do, the first context is used.

### Seeded services

| Namespace | Services |
| --- | --- |
| `personalization-service` | brands, creators, activity, partners, product-updates, products, reactions, recommendations, wish-genie |
| `activation-service` | audiences, cards, followers, notifications, occasions, sharing, tracking, users |
| `wishing-experience` | search, wishlists |
| `graphql-gateway` | gateway (`gateway-env`) |
