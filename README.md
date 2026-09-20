# batbelt

Localhost toolbox with a shared UI shell. Modules:

- **Kubefwd** — Kubernetes port-forwards, GCP proxy pods, port checker, and cluster/GCP explore
- **Steamer** — OpenBao KV compare + write on one page, with confirmation before every write
- **Kickflip** — Tick YAML-configured services, then annotate ExternalSecrets and/or rollout-restart them

The server binds to `127.0.0.1` only.

## Requirements

- Node.js 20+
- [`kubectl`](https://kubernetes.io/docs/tasks/tools/) on your `PATH` for Kubefwd and Kickflip
- The [`bao`](https://openbao.org/docs/commands/) CLI on your `PATH` for Steamer
- OIDC already enabled on each OpenBao instance, with `http://localhost:8250/oidc/callback` allowed as a redirect URI

## Setup

```bash
npm install
npm run dev
```

This starts the API on [http://127.0.0.1:3870](http://127.0.0.1:3870) and the Vite UI on [http://127.0.0.1:3871](http://127.0.0.1:3871). Open the Vite URL during development.

Production:

```bash
npm run build
npm start
```

`npm start` serves the built UI from the API port (`3870` by default).

```bash
batbelt [--port 3870] [--db PATH] [--import-yaml PATH] [--debug] [--open] [--default] [--default-proxy]
```

| Flag | Meaning |
| --- | --- |
| `--port` | HTTP port (default `3870`) |
| `--db` | Kubefwd SQLite path (default `~/.config/batbelt/kubefwd.db`) |
| `--import-yaml` | Import a kubefwd YAML file into that SQLite database, then start |
| `--debug` | Kubefwd debug log (`/tmp/kubefwd-debug.log`) |
| `--open` | Open the UI in a browser |
| `--default` | Auto-start Kubefwd services marked `selected_by_default` |
| `--default-proxy` | Auto-start Kubefwd proxy services marked `selected_by_default` |

An empty SQLite database is valid. Explore and Add Service populate it.

## Data

| Path | Contents |
| --- | --- |
| `~/.config/batbelt/kubefwd.db` | Kubefwd services and settings |
| `~/.config/batbelt/steamer/config.yaml` | Steamer environments |
| `~/.config/batbelt/steamer/tokens/` | Per-environment OpenBao tokens (`0600`) |
| `~/.config/batbelt/kickflip/config.yaml` | Kickflip contexts, namespaces, and services |

The original kubefwd and bao-helper apps keep their own files. To bring an existing kubefwd YAML across:

```bash
npx tsx src/cli.ts --import-yaml ~/.kubefwd.yaml
```

## Modules

### Kubefwd

Pages: Services, Proxy, Port Checker, Explore. Add/edit/remove is persisted in SQLite. Cluster context comes from the imported YAML or from Explore when you add services.

### Steamer

Pages: Secrets, Settings. Secrets combines compare and write: browse a path, load values, edit the key×env grid, then confirm a summary before `bao kv put`. Settings save also asks for confirmation. Login and logout stay one-click.

OIDC still uses port `8250` for the `bao` callback.

### Kickflip

Page: Services. First start writes a seed YAML from the old `secret-service-restarter` script (gowish namespaces and the default GKE context). Edit the file on disk, then **Reload config**. The UI does not write the YAML.

Tick services, **Select all** / per-namespace select, pick a context, then **Restart** or **Secrets + restart**. Every run asks for confirmation. Kickflip streams `kubectl` output and does not wait for rollout status.

```yaml
contexts:
  - name: dev
    context: gke_gowish-devx_europe-west1_api-eu
    default: true
namespaces:
  - name: personalization-service
    services:
      - name: brands
      # optional: external_secret, deployment
```

Default ExternalSecret is `{name}-env`. Default deployment is `{name}`.
