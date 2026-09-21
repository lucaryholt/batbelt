# batbelt

Localhost toolbox with a shared UI shell. Modules:

- **[Homepage](src/modules/homepage/README.md)** — First page: collapsible sections of shortcuts, plus a starred row above them
- **[Kubefwd](src/modules/kubefwd/README.md)** — Kubernetes port-forwards, GCP proxy pods, port checker, and cluster/GCP explore
- **[Steamer](src/modules/steamer/README.md)** — OpenBao KV compare + write on one page, with confirmation before every write
- **[Kickflip](src/modules/kickflip/README.md)** — Tick YAML-configured services, then annotate ExternalSecrets and/or rollout-restart them

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
| `~/.config/batbelt/homepage/config.yaml` | Homepage sections and shortcuts |
| `~/.config/batbelt/kubefwd.db` | Kubefwd services and settings |
| `~/.config/batbelt/steamer/config.yaml` | Steamer environments |
| `~/.config/batbelt/steamer/tokens/` | Per-environment OpenBao tokens (`0600`) |
| `~/.config/batbelt/kickflip/config.yaml` | Kickflip contexts, namespaces, and services |

The original kubefwd and bao-helper apps keep their own files. To bring an existing kubefwd YAML across:

```bash
npx tsx src/cli.ts --import-yaml ~/.kubefwd.yaml
```

## Modules

- [Homepage](src/modules/homepage/README.md) — Links board with a starred row of pinned shortcuts. YAML + UI CRUD; confirm deletes only.
- [Kubefwd](src/modules/kubefwd/README.md) — Services, Proxy, Port Checker, Explore. SQLite only; YAML is `--import-yaml`.
- [Steamer](src/modules/steamer/README.md) — Secrets + Settings. Confirm every write and settings save. OIDC callback on port `8250`. Search filters browse paths and key names.
- [Kickflip](src/modules/kickflip/README.md) — Services tile grid. File-only YAML; first start seeds the old restarter lists.
